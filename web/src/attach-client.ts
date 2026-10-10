import {
  AUTH_SUBPROTOCOL_PREFIX,
  encodeViewMessage,
  type HostMessage,
  ProtocolError,
  parseHostMessage,
  type Size,
  SUBPROTOCOL,
  type ViewConfig,
  type ViewMessage,
} from "./protocol.ts";

export type ConnectionState = "connecting" | "connected" | "disconnected";

/** Initial terminal settings from the host's `attached` message. */
export interface TerminalConfig extends Size, ViewConfig {}

/** The terminal engine a view draws with; the ghostty adapter implements it. */
export interface TerminalView {
  write(data: Uint8Array): void;
  reset(): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  /** The size that would fit the container. Only reported to the host, never applied locally. */
  proposeSize(): Size | undefined;
  onData(listener: (data: string) => void): void;
  onContainerResize(listener: () => void): void;
  dispose(): void;
}

/** The part of the browser WebSocket the client uses. */
export interface AttachSocket {
  binaryType: BinaryType;
  readonly readyState: number;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(): void;
}

export interface AttachClientOptions {
  /** WebSocket URL of `/attach/{sessionId}`. */
  url: string;
  token: string;
  /** Called on `attached` with the host's size and view config. */
  createTerminal(config: TerminalConfig): TerminalView;
  createSocket?: (url: string, protocols: string[]) => AttachSocket;
  /** When it returns false, local input is dropped (the main terminal while the editor overlay is open). */
  canSendInput?: () => boolean;
  onStateChange?: (state: ConnectionState) => void;
  onTitle?: (title: string) => void;
  onError?: (message: string) => void;
  onEditor?: (id: string) => void;
  /** The session's command exited; the socket closes right after. */
  onExit?: (code: number) => void;
}

const SOCKET_OPEN = 1; // WebSocket.OPEN

/**
 * Largest input frame. The host closes the connection on messages over 8 MiB,
 * so a big paste is split; the host writes the frames to the PTY in order.
 */
export const MAX_INPUT_FRAME_BYTES = 1 << 20;

/** Split UTF-8 into frames of at most `max` bytes, never inside a character. */
export function splitInput(bytes: Uint8Array<ArrayBuffer>, max = MAX_INPUT_FRAME_BYTES): Uint8Array<ArrayBuffer>[] {
  const frames: Uint8Array<ArrayBuffer>[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + max, bytes.length);
    // Back up over continuation bytes (10xxxxxx) to the start of the character.
    while (end < bytes.length && end > start + 1 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
    frames.push(bytes.subarray(start, end));
    start = end;
  }
  return frames;
}

function defaultCreateSocket(url: string, protocols: string[]): AttachSocket {
  return new WebSocket(url, protocols);
}

/**
 * One view attached to one host session (ADR 0017). The host owns the
 * terminal state and size: the client creates its terminal at the host's
 * size, writes the snapshot and live output, sends input, and only reports
 * the size its container could fit. There is no automatic reconnect.
 */
export class AttachClient {
  private readonly options: AttachClientOptions;
  private readonly encoder = new TextEncoder();
  private socket: AttachSocket | null = null;
  private terminal: TerminalView | null = null;
  private state: ConnectionState = "disconnected";
  private started = false;
  private writing = false;
  private reportedSize: Size | null = null;

  constructor(options: AttachClientOptions) {
    this.options = options;
  }

  /** Open the socket. One-shot: a closed client stays disconnected. */
  connect(): void {
    if (this.started) return;
    this.started = true;
    this.setState("connecting");

    let socket: AttachSocket;
    try {
      const createSocket = this.options.createSocket ?? defaultCreateSocket;
      socket = createSocket(this.options.url, [SUBPROTOCOL, `${AUTH_SUBPROTOCOL_PREFIX}${this.options.token}`]);
    } catch (error) {
      this.options.onError?.(`Failed to connect: ${String(error)}`);
      this.setState("disconnected");
      return;
    }

    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => this.handleFrame(event.data);
    socket.onclose = () => {
      this.socket = null;
      this.setState("disconnected");
    };
    this.socket = socket;
  }

  /** Ask the host (main session only) to open an editor session; answered by `editor` or `error`. */
  requestEditor(): void {
    if (this.state === "connected") this.send({ t: "open-editor" });
  }

  focus(): void {
    this.terminal?.focus();
  }

  dispose(): void {
    this.closeSocket();
    this.terminal?.dispose();
    this.terminal = null;
  }

  private handleFrame(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      this.write(new Uint8Array(data));
      return;
    }
    if (typeof data !== "string") return;

    let message: HostMessage;
    try {
      message = parseHostMessage(data);
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      this.fail(error.message);
      return;
    }
    this.handleMessage(message);
  }

  private handleMessage(message: HostMessage): void {
    switch (message.t) {
      case "attached": {
        if (this.terminal) {
          this.fail("attached received twice");
          return;
        }
        // The next binary frame is the snapshot, written at the host's size.
        const terminal = this.options.createTerminal({ ...message.size, ...message.view });
        this.terminal = terminal;
        terminal.onData((data) => this.sendInput(data));
        terminal.onContainerResize(() => this.reportSize());
        this.options.onTitle?.(message.title);
        this.setState("connected");
        this.reportSize();
        return;
      }
      case "snapshot":
        // Resync after lagging: the next binary frame is a full snapshot.
        this.requireTerminal(message.t)?.reset();
        return;
      case "size":
        this.requireTerminal(message.t)?.resize(message.cols, message.rows);
        return;
      case "title":
        this.options.onTitle?.(message.title);
        return;
      case "editor":
        this.options.onEditor?.(message.id);
        return;
      case "error":
        this.options.onError?.(message.message);
        return;
      case "exit":
        // The host closes the socket right after; the close handler takes it from there.
        this.options.onExit?.(message.code);
        return;
    }
  }

  private write(data: Uint8Array): void {
    const terminal = this.requireTerminal("terminal data");
    if (!terminal) return;
    this.writing = true;
    try {
      terminal.write(data);
    } finally {
      this.writing = false;
    }
  }

  private sendInput(data: string): void {
    // ghostty-web answers terminal queries (DSR, DA, ...) by emitting onData
    // synchronously inside write(). The host VT is the single responder
    // (ADR 0017), so anything emitted while writing is dropped.
    if (this.writing || this.state !== "connected") return;
    if (this.options.canSendInput && !this.options.canSendInput()) return;
    for (const frame of splitInput(this.encoder.encode(data))) this.send(frame);
  }

  private reportSize(): void {
    if (this.state !== "connected") return;
    const size = this.terminal?.proposeSize();
    if (!size) return;
    if (this.reportedSize && this.reportedSize.cols === size.cols && this.reportedSize.rows === size.rows) return;
    this.reportedSize = size;
    this.send({ t: "resize", cols: size.cols, rows: size.rows });
  }

  private requireTerminal(what: string): TerminalView | null {
    if (!this.terminal) this.fail(`${what} before attached`);
    return this.terminal;
  }

  /** A broken stream cannot be trusted any further: report it and drop the connection. */
  private fail(reason: string): void {
    this.options.onError?.(`Protocol error: ${reason}`);
    this.closeSocket();
  }

  /** Stop handling frames now; the close event still arrives and moves to "disconnected". */
  private closeSocket(): void {
    if (!this.socket) return;
    this.socket.onmessage = null;
    this.socket.close();
  }

  private send(data: ViewMessage | Uint8Array<ArrayBuffer>): void {
    if (this.socket?.readyState !== SOCKET_OPEN) return;
    this.socket.send(data instanceof Uint8Array ? data : encodeViewMessage(data));
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

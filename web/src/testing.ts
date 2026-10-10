// Test doubles for the browser WebSocket and the ghostty terminal.
import type { AttachSocket, TerminalConfig, TerminalView } from "./attach-client.ts";
import type { Size } from "./protocol.ts";

const decoder = new TextDecoder();

export class FakeSocket implements AttachSocket {
  binaryType: BinaryType = "blob";
  readyState = 1;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: (string | Uint8Array)[] = [];
  closeRequested = false;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeRequested = true;
  }

  /** Text frames that were sent, decoded. */
  get sentText(): string[] {
    return this.sent.filter((frame): frame is string => typeof frame === "string");
  }

  /** Binary frames that were sent, as UTF-8 text. */
  get sentInput(): string[] {
    return this.sent.filter((frame) => frame instanceof Uint8Array).map((frame) => decoder.decode(frame));
  }

  receiveText(message: unknown): void {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) } as MessageEvent);
  }

  receiveBinary(text: string): void {
    this.onmessage?.({ data: new TextEncoder().encode(text).buffer } as MessageEvent);
  }

  /** The connection ends (host closed it, or the close requested by the view completed). */
  closeFromHost(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

export function socketFactory() {
  const sockets: FakeSocket[] = [];
  const createSocket = (url: string, protocols: string[]) => {
    const socket = new FakeSocket(url, protocols);
    sockets.push(socket);
    return socket;
  };
  return { sockets, createSocket };
}

const DSR_CURSOR_POSITION = "\x1b[6n";

/**
 * Behaves like ghostty-web where it matters to the client: write() answers a
 * cursor position query by emitting onData synchronously.
 */
export class FakeTerminal implements TerminalView {
  proposal: Size | undefined = { cols: 100, rows: 30 };
  focused = false;
  disposed = false;
  private dataListener: ((data: string) => void) | null = null;
  private resizeListener: (() => void) | null = null;

  constructor(
    readonly config: TerminalConfig,
    readonly log: string[] = [],
  ) {
    this.log.push(`create ${config.cols}x${config.rows}`);
  }

  write(data: Uint8Array): void {
    const text = decoder.decode(data);
    this.log.push(`write ${text}`);
    if (text.includes(DSR_CURSOR_POSITION)) this.dataListener?.("\x1b[1;1R");
  }

  reset(): void {
    this.log.push("reset");
  }

  resize(cols: number, rows: number): void {
    this.log.push(`resize ${cols}x${rows}`);
  }

  focus(): void {
    this.focused = true;
  }

  proposeSize(): Size | undefined {
    return this.proposal;
  }

  onData(listener: (data: string) => void): void {
    this.dataListener = listener;
  }

  onContainerResize(listener: () => void): void {
    this.resizeListener = listener;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** The user types or pastes. */
  type(data: string): void {
    this.dataListener?.(data);
  }

  /** The container changed size; the debounced observer fires. */
  containerResized(proposal: Size | undefined): void {
    this.proposal = proposal;
    this.resizeListener?.();
  }
}

export function attachedMessage(overrides: { id?: string; kind?: "main" | "editor"; title?: string } = {}) {
  return {
    t: "attached",
    session: { id: overrides.id ?? "main", kind: overrides.kind ?? "main" },
    size: { cols: 80, rows: 24 },
    title: overrides.title ?? "zsh",
    view: { fontFamily: "", scrollback: 50000 },
  };
}

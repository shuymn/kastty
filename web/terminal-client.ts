import { dispatchServerMessage, type EditorOpenMessage, type ResizeMessage } from "../protocol/messages.ts";
import type { ConnectionState, TerminalHandle } from "./terminal.ts";
import { TitleParser } from "./title-parser.ts";

export type StateChangeCallback = (state: ConnectionState) => void;
export type ExitCallback = (code: number) => void;
export type TitleChangeCallback = (title: string) => void;
export type ErrorCallback = (message: string) => void;

export interface TerminalClientOptions {
  wsUrl: string;
  terminal: TerminalHandle;
}

export class TerminalClient {
  private state: ConnectionState = "disconnected";
  private ws: WebSocket | null = null;
  private readonly terminal: TerminalHandle;
  private readonly wsUrl: string;
  private readonly stateCallbacks: StateChangeCallback[] = [];
  private readonly exitCallbacks: ExitCallback[] = [];
  private readonly titleCallbacks: TitleChangeCallback[] = [];
  private readonly errorCallbacks: ErrorCallback[] = [];
  private readonly titleParser = new TitleParser();
  private pendingOpenMessage: string | null = null;

  constructor(options: TerminalClientOptions) {
    this.terminal = options.terminal;
    this.wsUrl = options.wsUrl;
  }

  connect(): void {
    if (this.ws) return;

    this.titleParser.reset();
    this.setState("connecting");
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      // Flush the editor-open request before the server replies `hello`: the
      // editor PTY is launched only once the server has received the buffer
      // content, so this must go out before the connection is "connected".
      if (this.pendingOpenMessage !== null) {
        ws.send(this.pendingOpenMessage);
        this.pendingOpenMessage = null;
      }
    });

    ws.addEventListener("message", (event) => {
      const { data } = event;
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        this.terminal.write(bytes);
        this.processTitleFromOutput(bytes);
      } else if (typeof data === "string") {
        this.handleControlMessage(data);
      }
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.titleParser.reset();
      this.setState("disconnected");
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  onStateChange(callback: StateChangeCallback): void {
    this.stateCallbacks.push(callback);
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback);
  }

  onTitleChange(callback: TitleChangeCallback): void {
    this.titleCallbacks.push(callback);
  }

  onError(callback: ErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Request an editor overlay carrying the extracted buffer `content`. The
   * message is queued and sent as soon as the socket opens (must precede
   * `hello`); call before {@link connect}.
   */
  requestOpen(content: string): void {
    const message = JSON.stringify({ t: "editor-open", content } satisfies EditorOpenMessage);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.pendingOpenMessage = message;
    }
  }

  sendInput(data: Uint8Array | ArrayBuffer): void {
    if (this.ws && this.state === "connected") {
      this.ws.send(data);
    }
  }

  sendResize(cols: number, rows: number): void {
    if (this.ws && this.state === "connected") {
      this.ws.send(JSON.stringify({ t: "resize", cols, rows } satisfies ResizeMessage));
    }
  }

  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const cb of this.stateCallbacks) {
      cb(newState);
    }
  }

  private handleControlMessage(raw: string): void {
    // No onInvalid: malformed control messages are ignored (unchanged behavior).
    dispatchServerMessage(raw, {
      hello: () => this.setState("connected"),
      exit: (msg) => {
        for (const cb of this.exitCallbacks) {
          cb(msg.code);
        }
      },
      error: (msg) => {
        for (const cb of this.errorCallbacks) {
          cb(msg.message);
        }
      },
      pong: () => {},
    });
  }

  private processTitleFromOutput(data: Uint8Array): void {
    for (const title of this.titleParser.push(data)) {
      for (const cb of this.titleCallbacks) {
        cb(title);
      }
    }
  }
}

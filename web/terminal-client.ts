import type { ServerMessage } from "../protocol/messages.ts";
import type { ConnectionState, TerminalHandle } from "./terminal.ts";

export type StateChangeCallback = (state: ConnectionState) => void;
export type ExitCallback = (code: number) => void;

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

  constructor(options: TerminalClientOptions) {
    this.terminal = options.terminal;
    this.wsUrl = options.wsUrl;
  }

  connect(): void {
    if (this.ws) return;

    this.setState("connecting");
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("message", (event) => {
      const { data } = event;
      if (data instanceof ArrayBuffer) {
        this.terminal.write(new Uint8Array(data));
      } else if (typeof data === "string") {
        this.handleControlMessage(data);
      }
    });

    ws.addEventListener("close", () => {
      this.ws = null;
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

  sendInput(data: Uint8Array | ArrayBuffer): void {
    if (this.ws && this.state === "connected") {
      this.ws.send(data);
    }
  }

  sendResize(cols: number, rows: number): void {
    if (this.ws && this.state === "connected") {
      this.ws.send(JSON.stringify({ t: "resize", cols, rows }));
    }
  }

  sendReadonly(enabled: boolean): void {
    if (this.ws && this.state === "connected") {
      this.ws.send(JSON.stringify({ t: "readonly", enabled }));
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
    try {
      const msg = JSON.parse(raw) as ServerMessage;
      switch (msg.t) {
        case "hello":
          this.setState("connected");
          break;
        case "exit":
          for (const cb of this.exitCallbacks) {
            cb(msg.code);
          }
          break;
        case "error":
        case "pong":
          break;
      }
    } catch {
      // ignore malformed control messages
    }
  }
}

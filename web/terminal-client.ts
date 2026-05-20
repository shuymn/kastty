import type { ServerMessage } from "../protocol/messages.ts";
import type { ConnectionState, TerminalHandle } from "./terminal.ts";

export type StateChangeCallback = (state: ConnectionState) => void;
export type ExitCallback = (code: number) => void;
export type TitleChangeCallback = (title: string) => void;
export type ReadonlyChangeCallback = (enabled: boolean) => void;

const ESC = "\u001b";
const OSC_PREFIX = `${ESC}]`;
const BEL = "\u0007";
const ST = `${ESC}\\`;
const MAX_TITLE_BUFFER_LENGTH = 8192;

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
  private readonly readonlyCallbacks: ReadonlyChangeCallback[] = [];
  private titleBuffer = "";
  private titleDecoder = new TextDecoder();

  constructor(options: TerminalClientOptions) {
    this.terminal = options.terminal;
    this.wsUrl = options.wsUrl;
  }

  connect(): void {
    if (this.ws) return;

    this.resetTitleParser();
    this.setState("connecting");
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

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
      this.resetTitleParser();
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

  onReadonlyChange(callback: ReadonlyChangeCallback): void {
    this.readonlyCallbacks.push(callback);
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
          for (const cb of this.readonlyCallbacks) {
            cb(msg.readonly);
          }
          this.setState("connected");
          break;
        case "readonly":
          for (const cb of this.readonlyCallbacks) {
            cb(msg.enabled);
          }
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

  private processTitleFromOutput(data: Uint8Array): void {
    const decoded = this.titleDecoder.decode(data, { stream: true });
    if (decoded.length === 0) return;
    this.titleBuffer += decoded;

    let cursor = 0;
    while (true) {
      const start = this.titleBuffer.indexOf(OSC_PREFIX, cursor);
      if (start === -1) break;

      const typeIndex = start + OSC_PREFIX.length;
      const type = this.titleBuffer[typeIndex];
      if ((type !== "0" && type !== "2") || this.titleBuffer[typeIndex + 1] !== ";") {
        cursor = typeIndex + 1;
        continue;
      }

      const titleStart = typeIndex + 2;
      const belIndex = this.titleBuffer.indexOf(BEL, titleStart);
      const stIndex = this.titleBuffer.indexOf(ST, titleStart);

      let titleEnd = -1;
      let terminatorLength = 0;
      if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
        titleEnd = belIndex;
        terminatorLength = BEL.length;
      } else if (stIndex !== -1) {
        titleEnd = stIndex;
        terminatorLength = ST.length;
      }

      if (titleEnd === -1) {
        this.titleBuffer = this.titleBuffer.slice(start);
        if (this.titleBuffer.length > MAX_TITLE_BUFFER_LENGTH) {
          this.titleBuffer = this.titleBuffer.slice(-MAX_TITLE_BUFFER_LENGTH);
        }
        return;
      }

      const title = this.titleBuffer.slice(titleStart, titleEnd);
      for (const cb of this.titleCallbacks) {
        cb(title);
      }

      cursor = titleEnd + terminatorLength;
    }

    const remaining = this.titleBuffer.slice(cursor);
    const partialStart = remaining.lastIndexOf(OSC_PREFIX);
    if (partialStart < 0) {
      this.titleBuffer = "";
      return;
    }

    this.titleBuffer = remaining.slice(partialStart);
    if (this.titleBuffer.length > MAX_TITLE_BUFFER_LENGTH) {
      this.titleBuffer = this.titleBuffer.slice(-MAX_TITLE_BUFFER_LENGTH);
    }
  }

  private resetTitleParser(): void {
    this.titleBuffer = "";
    this.titleDecoder = new TextDecoder();
  }
}

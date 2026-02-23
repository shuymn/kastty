import type { ReplayBuffer } from "../buffer/replay-buffer.ts";
import type { PtyAdapter } from "../pty/adapter.ts";

export interface ClientConnection {
  send(data: Uint8Array): void;
}

export class SessionManager {
  private pty: PtyAdapter;
  private replayBuffer: ReplayBuffer;
  private client: ClientConnection | null = null;
  private readonlyMode = false;
  private exitCallbacks: ((exitCode: number) => void)[] = [];

  constructor(pty: PtyAdapter, replayBuffer: ReplayBuffer) {
    this.pty = pty;
    this.replayBuffer = replayBuffer;
  }

  start(command: string, args?: string[], env?: Record<string, string>): void {
    this.pty.onData((data) => {
      this.replayBuffer.append(data);
      this.client?.send(data);
    });
    this.pty.onExit((code) => {
      for (const cb of this.exitCallbacks) cb(code);
    });
    this.pty.start(command, args, env);
  }

  connect(client: ClientConnection): Uint8Array {
    if (this.client !== null) {
      throw new Error("A client is already connected");
    }
    this.client = client;
    return this.replayBuffer.getContents();
  }

  disconnect(): void {
    this.client = null;
  }

  write(data: string | Uint8Array): void {
    if (this.readonlyMode) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  isReadonly(): boolean {
    return this.readonlyMode;
  }

  setReadonly(enabled: boolean): void {
    this.readonlyMode = enabled;
  }

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallbacks.push(callback);
  }

  destroy(): void {
    this.pty.destroy();
  }
}

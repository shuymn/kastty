import type { ReplayBuffer } from "../buffer/replay-buffer.ts";
import type { PtyAdapter } from "../pty/adapter.ts";

export interface ClientConnection {
  send(data: Uint8Array): void;
}

export class SessionManager {
  private pty: PtyAdapter;
  private replayBuffer: ReplayBuffer;
  private clients: Set<ClientConnection> = new Set();
  private exitCallbacks: ((exitCode: number) => void)[] = [];

  constructor(pty: PtyAdapter, replayBuffer: ReplayBuffer) {
    this.pty = pty;
    this.replayBuffer = replayBuffer;
  }

  start(command: string, args?: string[], env?: Record<string, string>): void {
    this.pty.onData((data) => {
      this.replayBuffer.append(data);
      for (const client of this.clients) {
        client.send(data);
      }
    });
    this.pty.onExit((code) => {
      for (const cb of this.exitCallbacks) cb(code);
    });
    this.pty.start(command, args, env);
  }

  connect(client: ClientConnection): Uint8Array {
    this.clients.add(client);
    return this.replayBuffer.getContents();
  }

  disconnect(client: ClientConnection): void {
    this.clients.delete(client);
  }

  write(data: string | Uint8Array): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallbacks.push(callback);
  }

  destroy(): void {
    this.pty.destroy();
  }
}

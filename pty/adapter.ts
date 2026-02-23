import { spawn as ptySpawn } from "bun-pty";

export interface PtyAdapter {
  onData(callback: (data: Uint8Array) => void): void;
  onExit(callback: (exitCode: number) => void): void;
  start(command: string, args?: string[], env?: Record<string, string>): void;
  resize(cols: number, rows: number): void;
  write(data: string | Uint8Array): void;
  destroy(): void;
}

export class BunPtyAdapter implements PtyAdapter {
  private ptyProcess: ReturnType<typeof ptySpawn> | null = null;
  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private exitCallback: ((exitCode: number) => void) | null = null;
  private encoder = new TextEncoder();

  onData(callback: (data: Uint8Array) => void): void {
    this.dataCallback = callback;
  }

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
  }

  start(command: string, args: string[] = [], env?: Record<string, string>): void {
    this.ptyProcess = ptySpawn(command, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        ...env,
      } as Record<string, string>,
    });

    this.ptyProcess.onData((data: string) => {
      const bytes = this.encoder.encode(data);
      this.dataCallback?.(bytes);
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.exitCallback?.(exitCode);
    });
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess?.resize(cols, rows);
  }

  write(data: string | Uint8Array): void {
    if (!this.ptyProcess) return;
    const str = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.ptyProcess.write(str);
  }

  destroy(): void {
    this.ptyProcess?.kill();
    this.ptyProcess = null;
  }
}

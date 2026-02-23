import type { Subprocess } from "bun";

export interface PtyAdapter {
  onData(callback: (data: Uint8Array) => void): void;
  onExit(callback: (exitCode: number) => void): void;
  start(command: string, args?: string[], env?: Record<string, string>): void;
  resize(cols: number, rows: number): void;
  write(data: string | Uint8Array): void;
  destroy(): void;
}

export class BunTerminalAdapter implements PtyAdapter {
  private terminal: InstanceType<typeof Bun.Terminal> | null = null;
  private process: Subprocess | null = null;
  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private exitCallback: ((exitCode: number) => void) | null = null;

  onData(callback: (data: Uint8Array) => void): void {
    this.dataCallback = callback;
  }

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
  }

  start(command: string, args: string[] = [], env?: Record<string, string>): void {
    this.terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      name: "xterm-256color",
      data: (_terminal, data) => {
        this.dataCallback?.(data);
      },
    });

    this.process = Bun.spawn([command, ...args], {
      terminal: this.terminal,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        ...env,
      },
    });

    this.process.exited.then((exitCode) => {
      this.exitCallback?.(exitCode);
    });
  }

  resize(cols: number, rows: number): void {
    this.terminal?.resize(cols, rows);
  }

  write(data: string | Uint8Array): void {
    this.terminal?.write(data);
  }

  destroy(): void {
    this.process?.kill();
    this.terminal?.close();
    this.terminal = null;
    this.process = null;
  }
}

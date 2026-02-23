import type { TerminalHandle } from "./terminal.ts";

export interface GhosttyTerminalInstance {
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array): void;
  onData: (listener: (data: string) => void) => { dispose(): void };
  onResize: (listener: (event: { cols: number; rows: number }) => void) => { dispose(): void };
  dispose(): void;
  focus(): void;
}

export interface GhosttyModule {
  init(): Promise<void>;
  createTerminal(options?: Record<string, unknown>): GhosttyTerminalInstance;
}

export interface GhosttyAdapterResult {
  handle: TerminalHandle;
  onData(callback: (data: string) => void): { dispose(): void };
  onResize(callback: (cols: number, rows: number) => void): { dispose(): void };
  focus(): void;
}

export async function createGhosttyTerminal(
  container: HTMLElement,
  ghostty: GhosttyModule,
  options?: Record<string, unknown>,
): Promise<GhosttyAdapterResult> {
  await ghostty.init();
  const terminal = ghostty.createTerminal(options);
  terminal.open(container);

  return {
    handle: {
      write(data: Uint8Array) {
        terminal.write(data);
      },
      dispose() {
        terminal.dispose();
      },
    },
    onData(callback) {
      return terminal.onData(callback);
    },
    onResize(callback) {
      return terminal.onResize(({ cols, rows }) => callback(cols, rows));
    },
    focus() {
      terminal.focus();
    },
  };
}

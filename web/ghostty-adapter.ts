import type { TerminalHandle } from "./terminal.ts";

export interface GhosttyTerminalAddon {
  activate(terminal: unknown): void;
  dispose(): void;
}

export interface GhosttyTerminalInstance {
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array): void;
  onData: (listener: (data: string) => void) => { dispose(): void };
  onResize: (listener: (event: { cols: number; rows: number }) => void) => { dispose(): void };
  loadAddon(addon: GhosttyTerminalAddon): void;
  dispose(): void;
  focus(): void;
  scrollToBottom(): void;
  options: { fontSize: number };
}

export interface GhosttyModule {
  init(): Promise<void>;
  createTerminal(options?: Record<string, unknown>): GhosttyTerminalInstance;
}

export interface GhosttyAdapterResult {
  handle: TerminalHandle;
  onData(callback: (data: string) => void): { dispose(): void };
  onResize(callback: (cols: number, rows: number) => void): { dispose(): void };
  loadAddon(addon: GhosttyTerminalAddon): void;
  focus(): void;
  setFontSize(size: number): void;
  scrollToBottom(): void;
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
    loadAddon(addon: GhosttyTerminalAddon) {
      terminal.loadAddon(addon);
    },
    focus() {
      terminal.focus();
    },
    setFontSize(size: number) {
      terminal.options.fontSize = size;
    },
    scrollToBottom() {
      terminal.scrollToBottom();
    },
  };
}

import type { TerminalHandle } from "./terminal.ts";

/**
 * Wrap a font-family name in double-quotes so it is always valid in a CSS
 * font shorthand (e.g. `ctx.font = "14px …"`).  Unquoted family names that
 * contain tokens starting with a digit (like "UDEV Gothic 35NF") are rejected
 * by the CSS parser.  ghostty-web currently does not quote the name itself, so
 * we do it here as a workaround.
 */
export function quoteFontFamily(family: string): string {
  if (family.startsWith('"') || family.startsWith("'")) return family;
  return `"${family}"`;
}

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
  scrollLines(amount: number): void;
  attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean): void;
  rows: number;
  options: { fontSize: number; fontFamily?: string };
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
  setFontFamily(family: string): void;
  scrollToBottom(): void;
}

/**
 * Workaround for ghostty-web rendering bug: fractional viewportY causes
 * off-by-one in the scrollback/active-buffer boundary during canvas rendering.
 * We intercept wheel events and use scrollLines() with integer amounts so
 * viewportY stays integer.
 */
function installIntegerScrollHandler(terminal: GhosttyTerminalInstance, container: HTMLElement): void {
  let pixelAccumulator = 0;

  terminal.attachCustomWheelEventHandler((event: WheelEvent) => {
    let lines: number;

    if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
      const canvas = container.querySelector("canvas");
      const lineHeight = canvas ? canvas.clientHeight / terminal.rows : 20;
      pixelAccumulator += event.deltaY;
      lines = Math.trunc(pixelAccumulator / lineHeight);
      if (lines !== 0) {
        pixelAccumulator -= lines * lineHeight;
      }
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      lines = Math.round(event.deltaY);
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      lines = Math.round(event.deltaY * terminal.rows);
    } else {
      lines = Math.round(event.deltaY / 33);
    }

    if (lines !== 0) {
      terminal.scrollLines(lines);
    }
    return true;
  });
}

export async function createGhosttyTerminal(
  container: HTMLElement,
  ghostty: GhosttyModule,
  options?: Record<string, unknown>,
): Promise<GhosttyAdapterResult> {
  await ghostty.init();

  const resolvedOptions = options ? { ...options } : undefined;
  if (resolvedOptions?.fontFamily && typeof resolvedOptions.fontFamily === "string") {
    resolvedOptions.fontFamily = quoteFontFamily(resolvedOptions.fontFamily);
  }

  const terminal = ghostty.createTerminal(resolvedOptions);
  terminal.open(container);

  installIntegerScrollHandler(terminal, container);

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
    setFontFamily(family: string) {
      terminal.options.fontFamily = quoteFontFamily(family);
    },
    scrollToBottom() {
      terminal.scrollToBottom();
    },
  };
}

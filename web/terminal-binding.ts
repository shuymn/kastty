import type { GhosttyTerminalAddon } from "./ghostty-adapter.ts";
import type { ConnectionState } from "./terminal.ts";

/** Subset of the ghostty adapter the binding drives. */
export interface TerminalAdapter {
  onData(callback: (data: string) => void): { dispose(): void };
  onResize(callback: (cols: number, rows: number) => void): { dispose(): void };
  loadAddon(addon: GhosttyTerminalAddon): void;
  focus(): void;
}

/** Subset of {@link TerminalClient} / {@link EditorOverlayClient} the binding drives. */
export interface BindableClient {
  sendInput(data: Uint8Array | ArrayBuffer): void;
  sendResize(cols: number, rows: number): void;
  onStateChange(callback: (state: ConnectionState) => void): void;
}

export interface BindableFitAddon extends GhosttyTerminalAddon {
  fit(): void;
  observeResize(): void;
}

export interface BindClientToTerminalOptions {
  adapter: TerminalAdapter;
  client: BindableClient;
  fitAddon: BindableFitAddon;
  /**
   * When provided and it returns false, the keystroke is dropped instead of
   * sent. The main terminal uses this to mute input while the editor overlay
   * is focused; the overlay omits it (always sends).
   */
  shouldSendInput?: () => boolean;
  /**
   * When provided and it returns false, skip connect-time focus. The main
   * terminal uses this to avoid stealing focus while the editor overlay is
   * active.
   */
  shouldFocus?: () => boolean;
}

export interface TerminalBinding {
  dispose(): void;
}

/**
 * Wire a ghostty terminal adapter to a {@link TerminalClient}: forward input,
 * track and forward resizes, install the fit addon, and on connect re-fit,
 * resend the latest size, and focus. Both the main terminal and the editor
 * overlay bind through here so the wiring lives—and is tested—in one place.
 */
export function bindClientToTerminal(options: BindClientToTerminalOptions): TerminalBinding {
  const { adapter, client, fitAddon, shouldSendInput, shouldFocus } = options;
  const encoder = new TextEncoder();

  let disposed = false;
  let lastCols = 0;
  let lastRows = 0;

  const dataSub = adapter.onData((data) => {
    if (shouldSendInput && !shouldSendInput()) return;
    client.sendInput(encoder.encode(data));
  });

  const resizeSub = adapter.onResize((cols, rows) => {
    lastCols = cols;
    lastRows = rows;
    client.sendResize(cols, rows);
  });

  adapter.loadAddon(fitAddon);

  client.onStateChange((state) => {
    if (disposed || state !== "connected") return;
    fitAddon.fit();
    if (lastCols > 0 && lastRows > 0) {
      client.sendResize(lastCols, lastRows);
    }
    if (!shouldFocus || shouldFocus()) {
      adapter.focus();
    }
  });

  fitAddon.fit();
  fitAddon.observeResize();

  return {
    dispose() {
      disposed = true;
      dataSub.dispose();
      resizeSub.dispose();
      fitAddon.dispose();
    },
  };
}

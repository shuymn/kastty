import { FitAddon, type ITerminalAddon, type ITerminalOptions, Terminal } from "ghostty-web";
import type { TerminalConfig, TerminalView } from "./attach-client.ts";
import type { Size } from "./protocol.ts";

export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_FONT_FAMILY = '"M PLUS 1 Code Variable", "Symbols Nerd Font Mono", monospace';

const SCROLLBACK_BYTES_PER_LINE = 2048;
const MIN_SCROLLBACK_BYTES = 1_000_000;
const MAX_SCROLLBACK_BYTES = 1_000_000_000;

// Same debounce as FitAddon.observeResize, so window drags do not flood the host.
const RESIZE_DEBOUNCE_MS = 100;

// WheelEvent.DOM_DELTA_*; spelled out so this module loads outside a browser (tests).
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

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

/** ghostty-web v0.4.0 treats `scrollback` as an internal byte capacity, not lines. */
export function toGhosttyScrollbackBytes(lines: number): number {
  const bytes = lines * SCROLLBACK_BYTES_PER_LINE;
  return Math.max(MIN_SCROLLBACK_BYTES, Math.min(MAX_SCROLLBACK_BYTES, bytes));
}

/** The subset of ghostty-web's Terminal the adapter drives. */
export interface GhosttyTerminal {
  readonly rows: number;
  open(parent: HTMLElement): void;
  write(data: Uint8Array): void;
  reset(): void;
  clearSelection(): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  dispose(): void;
  loadAddon(addon: ITerminalAddon): void;
  onData(listener: (data: string) => void): unknown;
  scrollLines(amount: number): void;
  attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean): void;
}

export interface GhosttyFitAddon extends ITerminalAddon {
  proposeDimensions(): Size | undefined;
}

export interface GhosttyFactory {
  createTerminal(options: ITerminalOptions): GhosttyTerminal;
  createFitAddon(): GhosttyFitAddon;
}

const defaultFactory: GhosttyFactory = {
  createTerminal: (options) => new Terminal(options),
  createFitAddon: () => new FitAddon(),
};

/**
 * Workaround for ghostty-web rendering bug: fractional viewportY causes
 * off-by-one in the scrollback/active-buffer boundary during canvas rendering.
 * We intercept wheel events and use scrollLines() with integer amounts so
 * viewportY stays integer.
 */
function installIntegerScrollHandler(terminal: GhosttyTerminal, container: HTMLElement): void {
  let pixelAccumulator = 0;

  terminal.attachCustomWheelEventHandler((event: WheelEvent) => {
    let lines: number;

    if (event.deltaMode === DOM_DELTA_PIXEL) {
      // Query every time: ghostty-web may replace the canvas node at runtime,
      // and the cost of querySelector on a small container is negligible.
      const canvas = container.querySelector("canvas");
      const lineHeight = canvas ? canvas.clientHeight / terminal.rows : 20;
      pixelAccumulator += event.deltaY;
      lines = Math.trunc(pixelAccumulator / lineHeight);
      if (lines !== 0) {
        pixelAccumulator -= lines * lineHeight;
      }
    } else if (event.deltaMode === DOM_DELTA_LINE) {
      lines = Math.round(event.deltaY);
    } else if (event.deltaMode === DOM_DELTA_PAGE) {
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

/** ghostty-web internals that resetTerminal() repairs. */
interface GhosttyResetInternals {
  wasmTerm?: unknown;
  selectionManager?: { wasmTerm?: unknown };
}

/**
 * Workaround for ghostty-web 0.4.0: reset() frees the WASM terminal and creates
 * a new one, but the SelectionManager keeps the freed instance and reads it on
 * the next selection or copy. Point it at the new terminal, then drop the
 * selection, whose coordinates belonged to the old contents.
 */
function resetTerminal(terminal: GhosttyTerminal): void {
  terminal.reset();
  const internals = terminal as unknown as GhosttyResetInternals;
  if (internals.selectionManager) {
    internals.selectionManager.wasmTerm = internals.wasmTerm;
  }
  terminal.clearSelection();
}

/**
 * Create a ghostty-web terminal in `container` at the host's size. `init()`
 * from ghostty-web must have resolved first.
 */
export function createGhosttyTerminal(
  container: HTMLElement,
  config: TerminalConfig,
  factory: GhosttyFactory = defaultFactory,
): TerminalView {
  const terminal = factory.createTerminal({
    cols: config.cols,
    rows: config.rows,
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: quoteFontFamily(config.fontFamily || DEFAULT_FONT_FAMILY),
    scrollback: toGhosttyScrollbackBytes(config.scrollback),
  });
  // Only proposeDimensions() is used: fit() would resize the local terminal
  // away from the host's size, which the host alone decides.
  const fitAddon = factory.createFitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  installIntegerScrollHandler(terminal, container);

  let observer: ResizeObserver | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    write: (data) => terminal.write(data),
    reset: () => resetTerminal(terminal),
    resize: (cols, rows) => terminal.resize(cols, rows),
    focus: () => terminal.focus(),
    proposeSize: () => fitAddon.proposeDimensions(),
    onData(listener) {
      terminal.onData(listener);
    },
    onContainerResize(listener) {
      observer?.disconnect();
      observer = new ResizeObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(listener, RESIZE_DEBOUNCE_MS);
      });
      observer.observe(container);
    },
    dispose() {
      observer?.disconnect();
      clearTimeout(debounceTimer);
      // ghostty-web 0.4.0 leaves a document listener that keeps the renderer,
      // and so the canvas, alive after dispose(); free the bitmap at least.
      const canvas = container.querySelector("canvas");
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      terminal.dispose();
    },
  };
}

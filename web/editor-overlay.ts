import { FitAddon, Terminal } from "ghostty-web";
import { createGhosttyTerminal, type GhosttyAdapterResult, type GhosttyTerminalAddon } from "./ghostty-adapter.ts";
import type { ConnectionState, TerminalHandle } from "./terminal.ts";
import { TerminalClient } from "./terminal-client.ts";

export interface EditorOverlayClient {
  connect(): void;
  disconnect(): void;
  /** Send the editor-open request (with buffer content) once the socket opens. */
  requestOpen(content: string): void;
  sendInput(data: Uint8Array | ArrayBuffer): void;
  sendResize(cols: number, rows: number): void;
  onStateChange(callback: (state: ConnectionState) => void): void;
  onExit(callback: (code: number) => void): void;
  onError(callback: (message: string) => void): void;
}

export interface EditorOverlayFitAddon extends GhosttyTerminalAddon {
  fit(): void;
  observeResize(): void;
}

export interface EditorOverlayOptions {
  /** The full-screen overlay container (toggled via `data-active`). */
  container: HTMLElement;
  /** The element the overlay ghostty terminal mounts into. */
  surface: HTMLElement;
  /** WebSocket URL for the editor PTY (`/editor-ws?t=…`). */
  wsUrl: string;
  /** ghostty terminal options, shared with the main terminal. */
  terminalOptions: Record<string, unknown>;
  /** Called after the overlay closes, so the caller can refocus the main terminal. */
  onClosed: () => void;
  /** Surface a user-visible error (defaults to `window.alert`). */
  onError?: (message: string) => void;
  createAdapter?: (surface: HTMLElement, terminalOptions: Record<string, unknown>) => Promise<GhosttyAdapterResult>;
  createClient?: (terminal: TerminalHandle, wsUrl: string) => EditorOverlayClient;
  createFitAddon?: () => EditorOverlayFitAddon;
}

function defaultCreateAdapter(
  surface: HTMLElement,
  terminalOptions: Record<string, unknown>,
): Promise<GhosttyAdapterResult> {
  // The WASM module is already initialized by the main terminal, so the overlay
  // only needs to create a new Terminal instance.
  return createGhosttyTerminal(
    surface,
    { init: () => Promise.resolve(), createTerminal: (opts) => new Terminal(opts) },
    terminalOptions,
  );
}

function defaultCreateClient(terminal: TerminalHandle, wsUrl: string): EditorOverlayClient {
  return new TerminalClient({ terminal, wsUrl });
}

function defaultCreateFitAddon(): EditorOverlayFitAddon {
  return new FitAddon();
}

/**
 * Manages the lifecycle of the in-browser editor overlay: a second ghostty
 * terminal connected to its own editor PTY WebSocket. At most one overlay is
 * active at a time; repeated `open()` calls are ignored while active.
 */
export class EditorOverlay {
  private readonly options: EditorOverlayOptions;
  private active = false;
  private client: EditorOverlayClient | null = null;
  private adapter: GhosttyAdapterResult | null = null;
  private disposers: Array<{ dispose(): void }> = [];

  constructor(options: EditorOverlayOptions) {
    this.options = options;
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Open the overlay, requesting an editor PTY seeded with `content` (the
   * extracted main-terminal buffer text). Ignored if already active.
   */
  async open(content: string): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.options.container.dataset.active = "true";

    try {
      const createAdapter = this.options.createAdapter ?? defaultCreateAdapter;
      this.adapter = await createAdapter(this.options.surface, this.options.terminalOptions);

      const createClient = this.options.createClient ?? defaultCreateClient;
      const client = createClient(this.adapter.handle, this.options.wsUrl);
      this.client = client;

      const encoder = new TextEncoder();
      this.disposers.push(
        this.adapter.onData((data) => {
          client.sendInput(encoder.encode(data));
        }),
      );

      const fitAddon = (this.options.createFitAddon ?? defaultCreateFitAddon)();
      this.adapter.loadAddon(fitAddon);
      this.disposers.push(fitAddon);

      let lastCols = 0;
      let lastRows = 0;
      this.disposers.push(
        this.adapter.onResize((cols, rows) => {
          lastCols = cols;
          lastRows = rows;
          client.sendResize(cols, rows);
        }),
      );

      client.onStateChange((state) => {
        if (state === "connected") {
          fitAddon.fit();
          if (lastCols > 0 && lastRows > 0) {
            client.sendResize(lastCols, lastRows);
          }
          this.adapter?.focus();
        } else if (state === "disconnected" && this.active) {
          this.teardown();
        }
      });

      client.onExit(() => {
        this.teardown();
      });

      client.onError((message) => {
        this.reportError(message);
        this.teardown();
      });

      fitAddon.fit();
      fitAddon.observeResize();

      client.requestOpen(content);
      client.connect();
    } catch (error) {
      this.reportError(`Failed to open editor overlay: ${String(error)}`);
      this.teardown();
    }
  }

  private reportError(message: string): void {
    if (this.options.onError) {
      this.options.onError(message);
    } else {
      window.alert(message);
    }
  }

  private teardown(): void {
    if (!this.active) return;
    this.active = false;

    for (const disposer of this.disposers) {
      disposer.dispose();
    }
    this.disposers = [];

    this.client?.disconnect();
    this.client = null;

    this.adapter?.handle.dispose();
    this.adapter = null;

    this.options.container.dataset.active = "false";
    this.options.surface.replaceChildren();

    this.options.onClosed();
  }
}

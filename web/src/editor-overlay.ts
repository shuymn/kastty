export const ALREADY_OPEN_MESSAGE = "An editor overlay is already open";

/** The view attached to the editor session. */
export interface OverlayClient {
  connect(): void;
  dispose(): void;
}

export interface EditorOverlayOptions {
  /** Send `open-editor` on the main session; the host answers with `editor` or `error`. */
  requestEditor(): void;
  /** Create the view of editor session `id`. It must call `onClosed` once its socket closes. */
  createClient(id: string, onClosed: () => void): OverlayClient;
  setVisible(visible: boolean): void;
  showToast(message: string): void;
  /** Called after the overlay closes, so the caller can refocus the main terminal. */
  onClosed(): void;
}

export type ShortcutEvent = Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "code">;

/**
 * The editor overlay (ADR 0017): Ctrl+Shift+E asks the host for an editor
 * session derived from the main one, and the overlay shows a second view
 * attached to it until that session's socket closes. At most one is open.
 */
export class EditorOverlay {
  private readonly options: EditorOverlayOptions;
  private client: OverlayClient | null = null;

  constructor(options: EditorOverlayOptions) {
    this.options = options;
  }

  isOpen(): boolean {
    return this.client !== null;
  }

  /**
   * Handle a keydown; returns true when it was the overlay shortcut, so the
   * caller can stop it before either terminal sees the keystroke.
   */
  handleKeydown(event: ShortcutEvent): boolean {
    if (!(event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyE")) return false;
    if (this.client) {
      this.options.showToast(ALREADY_OPEN_MESSAGE);
    } else {
      this.options.requestEditor();
    }
    return true;
  }

  /** Show editor session `id` (the host's answer to `open-editor`). */
  open(id: string): void {
    if (this.client) return;
    this.options.setVisible(true);
    const client = this.options.createClient(id, () => this.close(client));
    // Assigned before connect(): a socket that fails at once closes synchronously.
    this.client = client;
    client.connect();
  }

  private close(client: OverlayClient): void {
    if (this.client !== client) return;
    this.client = null;
    client.dispose();
    this.options.setVisible(false);
    this.options.onClosed();
  }
}

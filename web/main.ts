import { FitAddon, init, Terminal } from "ghostty-web";
import { DEFAULT_SCROLLBACK_LINES, toGhosttyScrollbackBytes } from "../config/scrollback.ts";
import { EditorOverlay } from "./editor-overlay.ts";
import { createGhosttyTerminal } from "./ghostty-adapter.ts";
import { formatTabTitle } from "./tab-title.ts";
import type { ConnectionState } from "./terminal.ts";
import { bindClientToTerminal } from "./terminal-binding.ts";
import { TerminalClient } from "./terminal-client.ts";

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_FONT_FAMILY = '"M PLUS 1 Code Variable", "Symbols Nerd Font Mono", monospace';

const TOAST_DURATION_MS = 4000;

/**
 * Show a transient, non-blocking notice. Used for editor-overlay errors
 * (missing editor, launch failure, server-side conflict) and the
 * already-open notice, so feedback never blocks the terminal like alert().
 */
function createToast(element: HTMLElement | null): (message: string) => void {
  if (!element) return (message) => console.error(message);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message: string) => {
    element.dataset.visible = "true";
    queueMicrotask(() => {
      element.textContent = message;
    });
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      element.dataset.visible = "false";
    }, TOAST_DURATION_MS);
  };
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function loadFontCss(): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/fonts.css";
    link.onload = () => {
      document.fonts
        .load(`${DEFAULT_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`)
        .then(() => resolve())
        .catch(() => resolve());
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

async function main() {
  const container = document.getElementById("terminal");
  if (!container) throw new Error("Terminal container element not found");

  await loadFontCss();

  const params = new URLSearchParams(window.location.search);
  const token = params.get("t");
  if (!token) throw new Error("Authentication token not found in URL");

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrlFor = (path: string) => `${wsProtocol}//${window.location.host}${path}?t=${encodeURIComponent(token)}`;
  const wsUrl = wsUrlFor("/ws");

  const requestedScrollbackLines = parsePositiveInt(params.get("scrollback")) ?? DEFAULT_SCROLLBACK_LINES;
  const terminalOptions: Record<string, unknown> = {
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    scrollback: toGhosttyScrollbackBytes(requestedScrollbackLines),
  };
  const fontFamily = params.get("fontFamily");
  if (fontFamily) {
    terminalOptions.fontFamily = fontFamily;
  }

  const adapter = await createGhosttyTerminal(
    container,
    { init, createTerminal: (opts) => new Terminal(opts) },
    terminalOptions,
  );

  const client = new TerminalClient({ terminal: adapter.handle, wsUrl });
  let connectionState: ConnectionState = "disconnected";
  let terminalTitle: string | null = null;

  const updateDocumentTitle = () => {
    document.title = formatTabTitle(connectionState, terminalTitle);
  };

  updateDocumentTitle();

  client.onStateChange((state) => {
    connectionState = state;
    updateDocumentTitle();
  });

  client.onTitleChange((title) => {
    terminalTitle = title;
    updateDocumentTitle();
  });

  const showToast = createToast(document.getElementById("toast"));

  const editorOverlayContainer = document.getElementById("editor-overlay");
  const editorOverlaySurface = document.getElementById("editor-overlay-surface");
  const editorWsUrl = wsUrlFor("/editor-ws");
  let editorOverlay: EditorOverlay | null = null;
  if (editorOverlayContainer && editorOverlaySurface) {
    editorOverlay = new EditorOverlay({
      container: editorOverlayContainer,
      surface: editorOverlaySurface,
      wsUrl: editorWsUrl,
      terminalOptions,
      onClosed: () => adapter.focus(),
      onError: showToast,
    });
  }

  // Open the editor overlay on Ctrl+Shift+E. We listen in the capture phase so
  // the shortcut is intercepted before either terminal consumes the keystroke;
  // all other keys fall through to the focused terminal untouched.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyE") {
        if (!editorOverlay) return;
        event.preventDefault();
        event.stopPropagation();
        if (editorOverlay.isActive()) {
          showToast("An editor overlay is already open");
          return;
        }
        // Snapshot the main terminal buffer now; the overlay seeds the editor
        // PTY's temporary file with this text.
        void editorOverlay.open(adapter.getBufferText());
      }
    },
    { capture: true },
  );

  // Bind after the overlay exists: this predicate reads it to mute input and
  // avoid stealing focus while the overlay is focused.
  const canUseMainTerminal = () => !editorOverlay?.isActive();
  const fitAddon = new FitAddon();
  bindClientToTerminal({
    adapter,
    client,
    fitAddon,
    shouldSendInput: canUseMainTerminal,
    shouldFocus: canUseMainTerminal,
  });

  client.connect();
  adapter.focus();
}

main().catch(console.error);

import {
  AttachClient,
  type AttachClientOptions,
  type ConnectionState,
  type TerminalConfig,
  type TerminalView,
} from "./attach-client.ts";
import { EditorOverlay, type ShortcutEvent } from "./editor-overlay.ts";
import { formatTabTitle } from "./tab-title.ts";

export const MAIN_SESSION_ID = "main";

// The shell's exit codes for a command it could not run.
const EXIT_NOT_EXECUTABLE = 126;
const EXIT_NOT_FOUND = 127;

/** Everything the app needs from the page, so the wiring can be tested without a browser. */
export interface AppEnvironment {
  token: string;
  /** WebSocket URL of `/attach/{sessionId}`. */
  attachUrl(sessionId: string): string;
  createSocket?: AttachClientOptions["createSocket"];
  /** Mount a terminal for the main session or inside the editor overlay. */
  createTerminal(target: "main" | "editor", config: TerminalConfig): TerminalView;
  setOverlayVisible(visible: boolean): void;
  showToast(message: string): void;
  setTitle(title: string): void;
}

export interface App {
  /** Returns true when the event was consumed (the editor shortcut). */
  handleKeydown(event: ShortcutEvent): boolean;
}

/** Attach the main session and wire the editor overlay, tab title, and toasts. */
export function startApp(env: AppEnvironment): App {
  let connectionState: ConnectionState = "disconnected";
  let terminalTitle: string | null = null;
  const updateTitle = () => env.setTitle(formatTabTitle(connectionState, terminalTitle));

  const overlay = new EditorOverlay({
    requestEditor: () => main.requestEditor(),
    createClient: (id, onClosed) =>
      new AttachClient({
        url: env.attachUrl(id),
        token: env.token,
        createSocket: env.createSocket,
        createTerminal: (config) => env.createTerminal("editor", config),
        onStateChange: (state) => {
          if (state === "disconnected") onClosed();
        },
        onError: env.showToast,
        // A misconfigured $EDITOR would otherwise only flash the overlay. Other codes are
        // left alone: the editor's own choice (:cq), or kastty ending it on shutdown.
        onExit: (code) => {
          if (code === EXIT_NOT_EXECUTABLE || code === EXIT_NOT_FOUND) {
            env.showToast(`Editor command failed (exit ${code}): check $VISUAL / $EDITOR`);
          }
        },
      }),
    setVisible: env.setOverlayVisible,
    showToast: env.showToast,
    onClosed: () => main.focus(),
  });

  const main = new AttachClient({
    url: env.attachUrl(MAIN_SESSION_ID),
    token: env.token,
    createSocket: env.createSocket,
    createTerminal: (config) => env.createTerminal("main", config),
    // Drop keystrokes that still reach the main terminal before the editor's terminal takes focus.
    canSendInput: () => !overlay.isOpen(),
    onStateChange: (state) => {
      connectionState = state;
      updateTitle();
    },
    onTitle: (title) => {
      terminalTitle = title;
      updateTitle();
    },
    onError: env.showToast,
    onEditor: (id) => overlay.open(id),
  });

  // connect() moves to "connecting" synchronously, which sets the first title.
  main.connect();

  return { handleKeydown: (event) => overlay.handleKeydown(event) };
}

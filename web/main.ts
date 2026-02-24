import { FitAddon, init, Terminal } from "ghostty-web";
import { createGhosttyTerminal } from "./ghostty-adapter.ts";
import { formatTabTitle } from "./tab-title.ts";
import type { ConnectionState } from "./terminal.ts";
import { TerminalClient } from "./terminal-client.ts";
import { UIControls } from "./ui-controls.ts";

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_FONT_FAMILY = '"M PLUS 1 Code Variable", "Symbols Nerd Font Mono", monospace';

function createControlsToolbar(controls: UIControls): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.id = "controls";
  Object.assign(toolbar.style, {
    display: "flex",
    gap: "8px",
    padding: "4px 8px",
    background: "#1e1e1e",
    color: "#ccc",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    alignItems: "center",
    userSelect: "none",
  });

  const status = document.createElement("span");
  status.id = "connection-status";
  status.textContent = controls.getState().connectionState;

  const fontLabel = document.createElement("span");
  fontLabel.textContent = "Font:";

  const fontMinus = document.createElement("button");
  fontMinus.textContent = "\u2212";
  fontMinus.title = "Decrease font size";
  fontMinus.addEventListener("click", () => controls.decreaseFontSize());

  const fontSize = document.createElement("span");
  fontSize.id = "font-size";
  fontSize.textContent = String(controls.getState().fontSize);

  const fontPlus = document.createElement("button");
  fontPlus.textContent = "+";
  fontPlus.title = "Increase font size";
  fontPlus.addEventListener("click", () => controls.increaseFontSize());

  const readonlyBtn = document.createElement("button");
  readonlyBtn.id = "readonly-toggle";
  readonlyBtn.textContent = "Readonly: OFF";
  readonlyBtn.addEventListener("click", () => controls.toggleReadonly());

  toolbar.append(status, fontLabel, fontMinus, fontSize, fontPlus, readonlyBtn);

  controls.onStateChange((state) => {
    status.textContent = state.connectionState;
    fontSize.textContent = String(state.fontSize);
    readonlyBtn.textContent = `Readonly: ${state.readonly ? "ON" : "OFF"}`;
  });

  return toolbar;
}

function loadFontCss(): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/fonts.css";
    link.onload = () => {
      document.fonts
        .load(`14px ${DEFAULT_FONT_FAMILY}`)
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
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?t=${token}`;

  const terminalOptions: Record<string, unknown> = {
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
  };
  const fontFamily = params.get("fontFamily");
  if (fontFamily) {
    terminalOptions.fontFamily = fontFamily;
  }

  const { handle, onData, onResize, loadAddon, focus, setFontSize } = await createGhosttyTerminal(
    container,
    { init, createTerminal: (opts) => new Terminal(opts) },
    terminalOptions,
  );

  let client: TerminalClient | null = null;
  let lastCols = 0;
  let lastRows = 0;
  let connectionState: ConnectionState = "disconnected";
  let terminalTitle: string | null = null;

  const updateDocumentTitle = () => {
    document.title = formatTabTitle(connectionState, terminalTitle);
  };

  onResize((cols, rows) => {
    lastCols = cols;
    lastRows = rows;
    client?.sendResize(cols, rows);
  });

  const fitAddon = new FitAddon();
  loadAddon(fitAddon);

  const controls = new UIControls(
    {
      sendReadonly(enabled: boolean) {
        client?.sendReadonly(enabled);
      },
      setFontSize,
    },
    DEFAULT_FONT_SIZE,
  );

  const toolbar = createControlsToolbar(controls);
  container.parentElement?.insertBefore(toolbar, container);

  fitAddon.fit();
  fitAddon.observeResize();

  client = new TerminalClient({ terminal: handle, wsUrl });
  updateDocumentTitle();

  client.onStateChange((state) => {
    connectionState = state;
    controls.setConnectionState(state);
    updateDocumentTitle();
    if (state === "connected" && lastCols > 0 && lastRows > 0) {
      client?.sendResize(lastCols, lastRows);
    }
  });

  client.onTitleChange((title) => {
    terminalTitle = title;
    updateDocumentTitle();
  });

  const encoder = new TextEncoder();
  onData((data) => {
    if (!controls.isReadonly()) {
      client?.sendInput(encoder.encode(data));
    }
  });

  client.connect();
  focus();
}

main().catch(console.error);

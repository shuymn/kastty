import { FitAddon, init, Terminal } from "ghostty-web";
import { DEFAULT_SCROLLBACK_LINES, toGhosttyScrollbackBytes } from "../config/scrollback.ts";
import { createGhosttyTerminal } from "./ghostty-adapter.ts";
import { formatTabTitle } from "./tab-title.ts";
import type { ConnectionState } from "./terminal.ts";
import { TerminalClient } from "./terminal-client.ts";

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_FONT_FAMILY = '"M PLUS 1 Code Variable", "Symbols Nerd Font Mono", monospace';

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
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?t=${token}`;

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

  const { handle, onData, onResize, loadAddon, focus } = await createGhosttyTerminal(
    container,
    { init, createTerminal: (opts) => new Terminal(opts) },
    terminalOptions,
  );

  const client = new TerminalClient({ terminal: handle, wsUrl });
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
    client.sendResize(cols, rows);
  });

  const fitAddon = new FitAddon();
  loadAddon(fitAddon);

  fitAddon.fit();
  fitAddon.observeResize();

  updateDocumentTitle();

  client.onStateChange((state) => {
    connectionState = state;
    updateDocumentTitle();
    if (state === "connected" && lastCols > 0 && lastRows > 0) {
      client.sendResize(lastCols, lastRows);
    }
  });

  client.onTitleChange((title) => {
    terminalTitle = title;
    updateDocumentTitle();
  });

  const encoder = new TextEncoder();
  onData((data) => {
    client.sendInput(encoder.encode(data));
  });

  client.connect();
  focus();
}

main().catch(console.error);

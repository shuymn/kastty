import { FitAddon, init, Terminal } from "ghostty-web";
import { createGhosttyTerminal } from "./ghostty-adapter.ts";
import type { TerminalHandle } from "./terminal.ts";
import { TerminalClient } from "./terminal-client.ts";
import { UIControls } from "./ui-controls.ts";

const DEFAULT_FONT_SIZE = 14;

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

  const autoScrollBtn = document.createElement("button");
  autoScrollBtn.id = "auto-scroll-toggle";
  autoScrollBtn.textContent = "Auto-scroll: ON";
  autoScrollBtn.addEventListener("click", () => controls.toggleAutoScroll());

  toolbar.append(status, fontLabel, fontMinus, fontSize, fontPlus, readonlyBtn, autoScrollBtn);

  controls.onStateChange((state) => {
    status.textContent = state.connectionState;
    fontSize.textContent = String(state.fontSize);
    readonlyBtn.textContent = `Readonly: ${state.readonly ? "ON" : "OFF"}`;
    autoScrollBtn.textContent = `Auto-scroll: ${state.autoScroll ? "ON" : "OFF"}`;
  });

  return toolbar;
}

async function main() {
  const container = document.getElementById("terminal");
  if (!container) throw new Error("Terminal container element not found");

  const token = new URLSearchParams(window.location.search).get("t");
  if (!token) throw new Error("Authentication token not found in URL");

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?t=${token}`;

  const { handle, onData, onResize, loadAddon, focus, setFontSize, scrollToBottom } = await createGhosttyTerminal(
    container,
    { init, createTerminal: (opts) => new Terminal(opts) },
    { fontSize: DEFAULT_FONT_SIZE },
  );

  const fitAddon = new FitAddon();
  loadAddon(fitAddon);
  fitAddon.fit();
  fitAddon.observeResize();

  let client: TerminalClient | null = null;

  const controls = new UIControls(
    {
      sendReadonly(enabled: boolean) {
        client?.sendReadonly(enabled);
      },
      setFontSize,
    },
    DEFAULT_FONT_SIZE,
  );

  const wrappedHandle: TerminalHandle = {
    write(data: Uint8Array) {
      handle.write(data);
      if (controls.isAutoScrollEnabled()) {
        scrollToBottom();
      }
    },
    dispose() {
      handle.dispose();
    },
  };

  client = new TerminalClient({ terminal: wrappedHandle, wsUrl });

  client.onStateChange((state) => controls.setConnectionState(state));

  const encoder = new TextEncoder();
  onData((data) => {
    if (!controls.isReadonly()) {
      client?.sendInput(encoder.encode(data));
    }
  });
  onResize((cols, rows) => client?.sendResize(cols, rows));

  const toolbar = createControlsToolbar(controls);
  container.parentElement?.insertBefore(toolbar, container);

  client.connect();
  focus();
}

main().catch(console.error);

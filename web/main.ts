import { init, Terminal } from "ghostty-web";
import { createGhosttyTerminal } from "./ghostty-adapter.ts";
import { TerminalClient } from "./terminal-client.ts";

async function main() {
  const container = document.getElementById("terminal");
  if (!container) throw new Error("Terminal container element not found");

  const token = new URLSearchParams(window.location.search).get("t");
  if (!token) throw new Error("Authentication token not found in URL");

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/ws?t=${token}`;

  const { handle, onData, onResize, focus } = await createGhosttyTerminal(
    container,
    { init, createTerminal: (opts) => new Terminal(opts) },
    { fontSize: 14 },
  );

  const client = new TerminalClient({ terminal: handle, wsUrl });

  const encoder = new TextEncoder();
  onData((data) => client.sendInput(encoder.encode(data)));
  onResize((cols, rows) => client.sendResize(cols, rows));

  client.connect();
  focus();
}

main().catch(console.error);

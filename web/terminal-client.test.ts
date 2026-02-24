import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { ConnectionState, TerminalHandle } from "./terminal.ts";
import { TerminalClient } from "./terminal-client.ts";

class MockTerminal implements TerminalHandle {
  written: Uint8Array[] = [];
  disposed = false;

  write(data: Uint8Array): void {
    this.written.push(new Uint8Array(data));
  }

  dispose(): void {
    this.disposed = true;
  }
}

async function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor timed out");
    }
    await Bun.sleep(10);
  }
}

function createTestServer() {
  const received: (string | Buffer)[] = [];
  let serverWs: ServerWebSocket<unknown> | null = null;
  let pendingResolve: (() => void) | null = null;
  let lastUpgradeUrl: URL | null = null;

  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      lastUpgradeUrl = new URL(req.url);
      if (server.upgrade(req)) return undefined;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        serverWs = ws;
        pendingResolve?.();
        pendingResolve = null;
      },
      message(_ws, msg) {
        received.push(msg);
      },
      close() {
        serverWs = null;
      },
    },
  });

  function requireWs(): ServerWebSocket<unknown> {
    if (!serverWs) throw new Error("No server WebSocket connection");
    return serverWs;
  }

  return {
    port: server.port,
    get isConnected() {
      return serverWs !== null;
    },
    get lastUpgradeUrl() {
      return lastUpgradeUrl;
    },
    received,
    waitForConnection(): Promise<void> {
      if (serverWs) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    },
    sendHello(readonly = false) {
      requireWs().send(JSON.stringify({ t: "hello", readonly }));
    },
    sendBinary(data: Uint8Array) {
      requireWs().send(data);
    },
    stop() {
      server.stop(true);
    },
  };
}

describe("TerminalClient", () => {
  let server: ReturnType<typeof createTestServer>;
  let client: TerminalClient | null = null;

  beforeAll(() => {
    server = createTestServer();
  });

  afterAll(() => {
    server.stop();
  });

  afterEach(async () => {
    if (client) {
      const c = client;
      c.disconnect();
      await waitFor(() => c.getState() === "disconnected" && !server.isConnected, 1000).catch(() => {});
      client = null;
    }
  });

  it("initializes terminal handle and starts with disconnected state", () => {
    const terminal = new MockTerminal();
    client = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    expect(client.getState()).toBe("disconnected");
  });

  it("establishes WS connection with token from URL query", async () => {
    const terminal = new MockTerminal();
    const token = "test-token-abc";
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}/ws?t=${token}`,
    });
    client = c;

    c.connect();
    await server.waitForConnection();

    expect(server.lastUpgradeUrl?.searchParams.get("t")).toBe(token);

    server.sendHello();
    await waitFor(() => c.getState() === "connected");
  });

  it("writes incoming binary frames to terminal", async () => {
    const terminal = new MockTerminal();
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    client = c;

    c.connect();
    await server.waitForConnection();
    server.sendHello();
    await waitFor(() => c.getState() === "connected");

    const testData = new Uint8Array([72, 101, 108, 108, 111]);
    server.sendBinary(testData);

    await waitFor(() => terminal.written.length > 0);
    expect(terminal.written[0]).toEqual(testData);
  });

  it("sends terminal input as WS binary frames", async () => {
    const terminal = new MockTerminal();
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    client = c;

    c.connect();
    await server.waitForConnection();
    server.sendHello();
    await waitFor(() => c.getState() === "connected");

    server.received.length = 0;
    const input = new Uint8Array([65, 66, 67]);
    c.sendInput(input);

    await waitFor(() => server.received.length > 0);
    expect(new Uint8Array(server.received[0] as Buffer)).toEqual(input);
  });

  it("sends resize events as WS resize messages", async () => {
    const terminal = new MockTerminal();
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    client = c;

    c.connect();
    await server.waitForConnection();
    server.sendHello();
    await waitFor(() => c.getState() === "connected");

    server.received.length = 0;
    c.sendResize(120, 40);

    await waitFor(() => server.received.length > 0);
    expect(JSON.parse(server.received[0] as string)).toEqual({ t: "resize", cols: 120, rows: 40 });
  });

  it("processes replay data on connection", async () => {
    const terminal = new MockTerminal();
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    client = c;

    c.connect();
    await server.waitForConnection();

    server.sendHello();
    const replayData = new Uint8Array([27, 91, 50, 74]);
    server.sendBinary(replayData);

    await waitFor(() => c.getState() === "connected");
    await waitFor(() => terminal.written.length > 0);
    expect(terminal.written[0]).toEqual(replayData);
  });

  it("extracts terminal title updates from OSC frames", async () => {
    const terminal = new MockTerminal();
    const titles: string[] = [];
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    client = c;
    c.onTitleChange((title) => titles.push(title));

    c.connect();
    await server.waitForConnection();
    server.sendHello();
    await waitFor(() => c.getState() === "connected");

    server.sendBinary(new TextEncoder().encode("\u001b]2;repo/kastty\u0007"));

    await waitFor(() => titles.length > 0);
    expect(titles).toEqual(["repo/kastty"]);
  });

  it("extracts terminal title when OSC sequence is split across frames", async () => {
    const terminal = new MockTerminal();
    const titles: string[] = [];
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    client = c;
    c.onTitleChange((title) => titles.push(title));

    c.connect();
    await server.waitForConnection();
    server.sendHello();
    await waitFor(() => c.getState() === "connected");

    server.sendBinary(new TextEncoder().encode("\u001b]2;repo/ka"));
    server.sendBinary(new TextEncoder().encode("stty\u001b\\"));

    await waitFor(() => titles.length > 0);
    expect(titles).toEqual(["repo/kastty"]);
  });

  it("tracks connection state transitions (connecting → connected → disconnected)", async () => {
    const terminal = new MockTerminal();
    const states: ConnectionState[] = [];
    const c = new TerminalClient({
      terminal,
      wsUrl: `ws://127.0.0.1:${server.port}`,
    });
    client = c;
    c.onStateChange((state) => states.push(state));

    expect(c.getState()).toBe("disconnected");

    c.connect();
    await server.waitForConnection();

    server.sendHello();
    await waitFor(() => c.getState() === "connected");

    c.disconnect();
    await waitFor(() => c.getState() === "disconnected");

    expect(states).toEqual(["connecting", "connected", "disconnected"]);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { ReplayBuffer } from "../buffer/replay-buffer.ts";
import type { PtyAdapter } from "../pty/adapter.ts";
import { SessionManager } from "../session/session-manager.ts";
import { createServer } from "./app.ts";

class MockPtyAdapter implements PtyAdapter {
  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private exitCallback: ((exitCode: number) => void) | null = null;
  written: (string | Uint8Array)[] = [];
  resizes: { cols: number; rows: number }[] = [];

  onData(callback: (data: Uint8Array) => void): void {
    this.dataCallback = callback;
  }

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
  }

  start(): void {}

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  write(data: string | Uint8Array): void {
    this.written.push(data);
  }

  destroy(): void {}

  emitData(data: Uint8Array): void {
    this.dataCallback?.(data);
  }

  emitExit(code: number): void {
    this.exitCallback?.(code);
  }
}

const TOKEN = "a".repeat(32);
const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const s of servers) s.stop(true);
  servers.length = 0;
});

function findPort(): number {
  const s = Bun.serve({ fetch: () => new Response(), port: 0, hostname: "127.0.0.1" });
  const p = s.port ?? 0;
  s.stop(true);
  return p;
}

function startServer(options: { replayData?: Uint8Array } = {}) {
  const mockPty = new MockPtyAdapter();
  const replayBuffer = new ReplayBuffer(1024);
  const session = new SessionManager(mockPty, replayBuffer);
  session.start("sh");

  if (options.replayData) {
    mockPty.emitData(options.replayData);
  }

  const port = findPort();
  const { fetch, websocket } = createServer({ session, token: TOKEN, port });
  const server = Bun.serve({ fetch, websocket, port, hostname: "127.0.0.1" });
  servers.push(server);

  return {
    mockPty,
    session,
    server,
    port: server.port,
    wsUrl: `ws://127.0.0.1:${server.port}/ws?t=${TOKEN}`,
    httpUrl: (p = "/") => `http://127.0.0.1:${server.port}${p}?t=${TOKEN}`,
  };
}

function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("open timeout")), 3000);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      },
      { once: true },
    );
  });
}

function waitForMessage(ws: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), 3000);
    ws.addEventListener(
      "message",
      (evt) => {
        clearTimeout(timer);
        resolve(evt);
      },
      { once: true },
    );
  });
}

describe("WebSocket", () => {
  it("upgrade succeeds with valid token", async () => {
    const { wsUrl } = startServer();
    const ws = new WebSocket(wsUrl);
    try {
      await waitForOpen(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      ws.close();
    }
  });

  it("sends hello message on connection", async () => {
    const { wsUrl } = startServer();
    const ws = new WebSocket(wsUrl);
    try {
      const msgPromise = waitForMessage(ws);
      await waitForOpen(ws);
      const msg = await msgPromise;
      const data = JSON.parse(msg.data as string);
      expect(data).toEqual({ t: "hello", readonly: false });
    } finally {
      ws.close();
    }
  });

  it("forwards binary frames to session write", async () => {
    const { wsUrl, mockPty } = startServer();
    const ws = new WebSocket(wsUrl);
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);
      await helloPromise;

      const input = new TextEncoder().encode("ls -la\n");
      ws.send(input);
      await Bun.sleep(100);

      expect(mockPty.written.length).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  });

  it("dispatches resize message to session", async () => {
    const { wsUrl, mockPty } = startServer();
    const ws = new WebSocket(wsUrl);
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);
      await helloPromise;

      ws.send(JSON.stringify({ t: "resize", cols: 120, rows: 40 }));
      await Bun.sleep(100);

      expect(mockPty.resizes).toContainEqual({ cols: 120, rows: 40 });
    } finally {
      ws.close();
    }
  });

  it("responds to ping with pong", async () => {
    const { wsUrl } = startServer();
    const ws = new WebSocket(wsUrl);
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);
      await helloPromise;

      ws.send(JSON.stringify({ t: "ping", ts: 12345 }));
      const msg = await waitForMessage(ws);
      const data = JSON.parse(msg.data as string);
      expect(data).toEqual({ t: "pong", ts: 12345 });
    } finally {
      ws.close();
    }
  });

  it("sends PTY output as binary frames", async () => {
    const { wsUrl, mockPty } = startServer();
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);
      await helloPromise;

      const output = new TextEncoder().encode("hello world");
      mockPty.emitData(output);

      const msg = await waitForMessage(ws);
      const received = new Uint8Array(msg.data as ArrayBuffer);
      expect(received).toEqual(output);
    } finally {
      ws.close();
    }
  });

  it("sends exit message when PTY exits", async () => {
    const { wsUrl, mockPty } = startServer();
    const ws = new WebSocket(wsUrl);
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);
      await helloPromise;

      mockPty.emitExit(0);

      const msg = await waitForMessage(ws);
      const data = JSON.parse(msg.data as string);
      expect(data).toEqual({ t: "exit", code: 0 });
    } finally {
      ws.close();
    }
  });

  it("sends replay buffer before live stream", async () => {
    const replayData = new TextEncoder().encode("previous output");
    const { wsUrl } = startServer({ replayData });
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);

      const helloMsg = await helloPromise;
      const hello = JSON.parse(helloMsg.data as string);
      expect(hello.t).toBe("hello");

      const replayMsg = await waitForMessage(ws);
      const received = new Uint8Array(replayMsg.data as ArrayBuffer);
      expect(received).toEqual(replayData);
    } finally {
      ws.close();
    }
  });
});

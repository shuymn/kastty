import { afterEach, describe, expect, it } from "bun:test";
import { ReplayBuffer } from "../buffer/replay-buffer.ts";
import { EditorSessionManager } from "../editor/editor-session-manager.ts";
import type { PtyAdapter } from "../pty/adapter.ts";
import { SessionManager } from "../session/session-manager.ts";
import { createServer } from "./app.ts";

class MockPtyAdapter implements PtyAdapter {
  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private exitCallback: ((exitCode: number) => void) | null = null;
  written: (string | Uint8Array)[] = [];
  resizes: { cols: number; rows: number }[] = [];
  destroyed = false;

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

  destroy(): void {
    this.destroyed = true;
  }

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

function startServer(
  options: { replayData?: Uint8Array; withEditor?: { editorEnv?: { VISUAL?: string; EDITOR?: string } } } = {},
) {
  const mockPty = new MockPtyAdapter();
  const replayBuffer = new ReplayBuffer(1024);
  const session = new SessionManager(mockPty, replayBuffer);
  session.start("sh");

  if (options.replayData) {
    mockPty.emitData(options.replayData);
  }

  const editorPtys: MockPtyAdapter[] = [];
  const removedTempFiles: string[] = [];
  const editorTempContents: string[] = [];
  let editor: EditorSessionManager | undefined;
  if (options.withEditor) {
    let counter = 0;
    editor = new EditorSessionManager({
      env: options.withEditor.editorEnv ?? { EDITOR: "vim" },
      createPty: () => {
        const pty = new MockPtyAdapter();
        editorPtys.push(pty);
        return pty;
      },
      createTempFile: async (content) => {
        editorTempContents.push(content);
        return `/tmp/kastty-editor-test-${counter++}.txt`;
      },
      removeTempFile: async (path) => {
        removedTempFiles.push(path);
      },
      logger: () => {},
    });
  }

  const port = findPort();
  const { fetch, websocket } = createServer({ session, token: TOKEN, port, editor });
  const server = Bun.serve({ fetch, websocket, port, hostname: "127.0.0.1" });
  servers.push(server);

  return {
    mockPty,
    session,
    editor,
    editorPtys,
    removedTempFiles,
    editorTempContents,
    server,
    port: server.port,
    wsUrl: `ws://127.0.0.1:${server.port}/ws?t=${TOKEN}`,
    editorWsUrl: `ws://127.0.0.1:${server.port}/editor-ws?t=${TOKEN}`,
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

async function waitForJsonMessage<T>(ws: WebSocket): Promise<T> {
  const msg = await waitForMessage(ws);
  return JSON.parse(msg.data as string) as T;
}

/**
 * Open an editor-overlay WebSocket and send the `editor-open` request that
 * triggers the editor PTY launch. The editor PTY is launched lazily, so the
 * server replies `hello`/`error` only after this message is received.
 */
async function connectEditor(url: string, content = ""): Promise<WebSocket> {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  await waitForOpen(ws);
  ws.send(JSON.stringify({ t: "editor-open", content }));
  return ws;
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
      const msgPromise = waitForJsonMessage<{ t: string }>(ws);
      await waitForOpen(ws);
      const data = await msgPromise;
      expect(data).toEqual({ t: "hello" });
    } finally {
      ws.close();
    }
  });

  it("accepts multiple clients with the same token and broadcasts PTY output", async () => {
    const { wsUrl, mockPty } = startServer();
    const wsA = new WebSocket(wsUrl);
    const wsB = new WebSocket(wsUrl);
    wsA.binaryType = "arraybuffer";
    wsB.binaryType = "arraybuffer";
    try {
      const helloA = waitForJsonMessage<{ t: string }>(wsA);
      const helloB = waitForJsonMessage<{ t: string }>(wsB);
      await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);
      expect(await helloA).toEqual({ t: "hello" });
      expect(await helloB).toEqual({ t: "hello" });

      const output = new TextEncoder().encode("shared output");
      mockPty.emitData(output);

      const [msgA, msgB] = await Promise.all([waitForMessage(wsA), waitForMessage(wsB)]);
      expect(new Uint8Array(msgA.data as ArrayBuffer)).toEqual(output);
      expect(new Uint8Array(msgB.data as ArrayBuffer)).toEqual(output);
    } finally {
      wsA.close();
      wsB.close();
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

  it("ignores editor-open messages on the main terminal websocket", async () => {
    const { wsUrl, mockPty } = startServer();
    const ws = new WebSocket(wsUrl);
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);
      await helloPromise;

      ws.send(JSON.stringify({ t: "editor-open", content: "buffer\n" }));
      await Bun.sleep(50);

      expect(mockPty.written).toHaveLength(0);
      expect(mockPty.resizes).toHaveLength(0);
      expect(ws.readyState).toBe(WebSocket.OPEN);
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

  it("sends Uint8Array subview (byteOffset != 0) correctly", async () => {
    const { wsUrl, mockPty } = startServer();
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    try {
      const helloPromise = waitForMessage(ws);
      await waitForOpen(ws);
      await helloPromise;

      const backing = new Uint8Array([0xff, 0x01, 0x02, 0x03, 0xff]);
      const subview = backing.subarray(1, 4);
      mockPty.emitData(subview);

      const msg = await waitForMessage(ws);
      const received = new Uint8Array(msg.data as ArrayBuffer);
      expect(received).toEqual(new Uint8Array([0x01, 0x02, 0x03]));
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

  it("sends exit message to all connected clients when PTY exits", async () => {
    const { wsUrl, mockPty } = startServer();
    const wsA = new WebSocket(wsUrl);
    const wsB = new WebSocket(wsUrl);
    try {
      const helloA = waitForJsonMessage<{ t: string }>(wsA);
      const helloB = waitForJsonMessage<{ t: string }>(wsB);
      await Promise.all([waitForOpen(wsA), waitForOpen(wsB)]);
      await helloA;
      await helloB;

      mockPty.emitExit(0);

      const [exitA, exitB] = await Promise.all([
        waitForJsonMessage<{ t: string; code: number }>(wsA),
        waitForJsonMessage<{ t: string; code: number }>(wsB),
      ]);
      expect(exitA).toEqual({ t: "exit", code: 0 });
      expect(exitB).toEqual({ t: "exit", code: 0 });
    } finally {
      wsA.close();
      wsB.close();
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

describe("editor overlay WebSocket", () => {
  it("returns 404 for /editor-ws when no editor manager is configured", async () => {
    const { httpUrl } = startServer();
    const res = await fetch(httpUrl("/editor-ws"));
    expect(res.status).toBe(404);
  });

  it("rejects /editor-ws upgrade without a valid token", async () => {
    const { server } = startServer({ withEditor: {} });
    const res = await fetch(`http://127.0.0.1:${server.port}/editor-ws?t=wrong`);
    expect(res.status).toBe(403);
  });

  it("launches the editor PTY and writes the buffer content on editor-open", async () => {
    const { editorWsUrl, editorPtys, editorTempContents } = startServer({ withEditor: {} });
    const ws = await connectEditor(editorWsUrl, "scrollback\nbuffer\n");
    try {
      const hello = await waitForJsonMessage<{ t: string }>(ws);
      expect(hello).toEqual({ t: "hello" });
      expect(editorPtys).toHaveLength(1);
      expect(editorTempContents).toEqual(["scrollback\nbuffer\n"]);
    } finally {
      ws.close();
    }
  });

  it("does not launch the editor PTY until editor-open is received", async () => {
    const { editorWsUrl, editor, editorPtys } = startServer({ withEditor: {} });
    const ws = new WebSocket(editorWsUrl);
    try {
      await waitForOpen(ws);
      await Bun.sleep(50);
      expect(editorPtys).toHaveLength(0);
      expect(editor?.hasActiveSession()).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("sends editor PTY output as binary frames", async () => {
    const { editorWsUrl, editorPtys } = startServer({ withEditor: {} });
    const ws = await connectEditor(editorWsUrl);
    try {
      await waitForJsonMessage<{ t: string }>(ws);
      const output = new TextEncoder().encode("editor screen");
      editorPtys[0]?.emitData(output);

      const msg = await waitForMessage(ws);
      expect(new Uint8Array(msg.data as ArrayBuffer)).toEqual(output);
    } finally {
      ws.close();
    }
  });

  it("forwards binary input and resize to the editor PTY", async () => {
    const { editorWsUrl, editorPtys } = startServer({ withEditor: {} });
    const ws = await connectEditor(editorWsUrl);
    try {
      await waitForJsonMessage<{ t: string }>(ws);

      ws.send(new TextEncoder().encode(":wq\n"));
      ws.send(JSON.stringify({ t: "resize", cols: 100, rows: 30 }));
      await Bun.sleep(100);

      expect(editorPtys[0]?.written.length).toBeGreaterThan(0);
      expect(editorPtys[0]?.resizes).toContainEqual({ cols: 100, rows: 30 });
    } finally {
      ws.close();
    }
  });

  it("reports an error and does not launch a PTY when no editor is configured", async () => {
    const { editorWsUrl, editorPtys } = startServer({ withEditor: { editorEnv: {} } });
    const ws = await connectEditor(editorWsUrl);
    try {
      const msg = await waitForJsonMessage<{ t: string; message: string }>(ws);
      expect(msg.t).toBe("error");
      expect(editorPtys).toHaveLength(0);
    } finally {
      ws.close();
    }
  });

  it("rejects a second concurrent editor overlay", async () => {
    const { editorWsUrl, editorPtys } = startServer({ withEditor: {} });
    const first = await connectEditor(editorWsUrl);
    try {
      const helloFirst = await waitForJsonMessage<{ t: string }>(first);
      expect(helloFirst).toEqual({ t: "hello" });

      const second = await connectEditor(editorWsUrl);
      try {
        const msg = await waitForJsonMessage<{ t: string; message: string }>(second);
        expect(msg.t).toBe("error");
        expect(msg.message).toContain("already open");
        expect(editorPtys).toHaveLength(1);
      } finally {
        second.close();
      }
    } finally {
      first.close();
    }
  });

  it("sends exit and cleans up the temp file when the editor PTY exits", async () => {
    const { editorWsUrl, editorPtys, removedTempFiles } = startServer({ withEditor: {} });
    const ws = await connectEditor(editorWsUrl);
    try {
      await waitForJsonMessage<{ t: string }>(ws);
      editorPtys[0]?.emitExit(0);

      const msg = await waitForJsonMessage<{ t: string; code: number }>(ws);
      expect(msg).toEqual({ t: "exit", code: 0 });
      await Bun.sleep(50);
      expect(removedTempFiles).toHaveLength(1);
    } finally {
      ws.close();
    }
  });

  it("cleans up the temp file and frees the slot when the client disconnects", async () => {
    const { editorWsUrl, editor, editorPtys, removedTempFiles } = startServer({ withEditor: {} });
    const ws = await connectEditor(editorWsUrl);
    await waitForJsonMessage<{ t: string }>(ws);
    expect(editor?.hasActiveSession()).toBe(true);

    ws.close();
    await Bun.sleep(100);

    expect(editorPtys[0]?.destroyed).toBe(true);
    expect(removedTempFiles).toHaveLength(1);
    expect(editor?.hasActiveSession()).toBe(false);
  });

  it("reports an error and closes on an invalid editor control payload", async () => {
    const { editorWsUrl, editorPtys } = startServer({ withEditor: {} });
    const ws = new WebSocket(editorWsUrl);
    ws.binaryType = "arraybuffer";
    await waitForOpen(ws);
    // A malformed editor-open (missing content) fails protocol parsing.
    ws.send(JSON.stringify({ t: "editor-open" }));

    const msg = await waitForJsonMessage<{ t: string; message: string }>(ws);
    expect(msg.t).toBe("error");
    expect(editorPtys).toHaveLength(0);
    // The server closes the connection after sending the error.
    await Bun.sleep(50);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});

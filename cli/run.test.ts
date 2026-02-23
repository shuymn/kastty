import { describe, expect, test } from "bun:test";
import type { PtyAdapter } from "../pty/adapter.ts";
import type { CliOptions } from "./args.ts";
import { type ReadyInfo, run } from "./run.ts";

class MockPtyAdapter implements PtyAdapter {
  private exitCallback: ((exitCode: number) => void) | null = null;

  onData(_callback: (data: Uint8Array) => void): void {}

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
  }

  start(): void {}

  resize(): void {}
  write(): void {}
  destroy(): void {}

  emitExit(code: number): void {
    this.exitCallback?.(code);
  }
}

function defaultOptions(overrides?: Partial<CliOptions>): CliOptions {
  return {
    command: "sh",
    args: [],
    readonly: false,
    port: 0,
    open: false,
    ...overrides,
  };
}

describe("run", () => {
  test("process blocks until PTY exits", async () => {
    const mockPty = new MockPtyAdapter();
    const runPromise = run(defaultOptions(), {
      createPty: () => mockPty,
    });

    let resolved = false;
    runPromise.then(() => {
      resolved = true;
    });
    await Bun.sleep(200);
    expect(resolved).toBe(false);

    mockPty.emitExit(0);
    const exitCode = await runPromise;
    expect(exitCode).toBe(0);
  });

  test("PTY exit causes process exit with appropriate code", async () => {
    const mockPty = new MockPtyAdapter();
    const runPromise = run(defaultOptions(), {
      createPty: () => mockPty,
    });

    await Bun.sleep(50);
    mockPty.emitExit(42);
    const exitCode = await runPromise;
    expect(exitCode).toBe(42);
  });

  test("--port 0 assigns automatic port", async () => {
    const mockPty = new MockPtyAdapter();
    let readyInfo: ReadyInfo | undefined;

    const runPromise = run(defaultOptions({ port: 0 }), {
      createPty: () => mockPty,
      onReady: (info) => {
        readyInfo = info;
      },
    });

    await Bun.sleep(100);
    if (readyInfo === undefined) throw new Error("onReady not called");
    expect(readyInfo.port).toBeGreaterThan(0);

    mockPty.emitExit(0);
    await runPromise;
  });

  test("opens browser when open=true", async () => {
    const mockPty = new MockPtyAdapter();
    const browserCalls: string[] = [];

    const runPromise = run(defaultOptions({ open: true }), {
      createPty: () => mockPty,
      openBrowser: async (url) => {
        browserCalls.push(url);
      },
    });

    await Bun.sleep(100);
    expect(browserCalls.length).toBeGreaterThan(0);

    mockPty.emitExit(0);
    await runPromise;
  });

  test("--open=false suppresses browser launch", async () => {
    const mockPty = new MockPtyAdapter();
    const browserCalls: string[] = [];

    const runPromise = run(defaultOptions({ open: false }), {
      createPty: () => mockPty,
      openBrowser: async (url) => {
        browserCalls.push(url);
      },
    });

    await Bun.sleep(100);
    expect(browserCalls).toHaveLength(0);

    mockPty.emitExit(0);
    await runPromise;
  });

  test("--readonly sets initial readonly on session", async () => {
    const mockPty = new MockPtyAdapter();
    let readyInfo: ReadyInfo | undefined;

    const runPromise = run(defaultOptions({ readonly: true, port: 0 }), {
      createPty: () => mockPty,
      onReady: (info) => {
        readyInfo = info;
      },
    });

    await Bun.sleep(100);
    if (readyInfo === undefined) throw new Error("onReady not called");

    const wsUrl = `ws://127.0.0.1:${readyInfo.port}/ws?t=${readyInfo.token}`;
    const ws = new WebSocket(wsUrl);
    const helloMsg = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      ws.onmessage = (evt) => {
        clearTimeout(timer);
        resolve(evt.data as string);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    });
    const hello = JSON.parse(helloMsg);
    expect(hello.readonly).toBe(true);
    ws.close();

    mockPty.emitExit(0);
    await runPromise;
  });
});

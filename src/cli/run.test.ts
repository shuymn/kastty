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
    port: 0,
    open: false,
    fontFamily: "",
    scrollback: 50000,
    replayBufferBytes: 8 * 1024 * 1024,
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

  test("includes configured scrollback in browser URL", async () => {
    const mockPty = new MockPtyAdapter();
    let readyInfo: ReadyInfo | undefined;

    const runPromise = run(defaultOptions({ scrollback: 120000 }), {
      createPty: () => mockPty,
      onReady: (info) => {
        readyInfo = info;
      },
    });

    await Bun.sleep(100);
    if (readyInfo === undefined) throw new Error("onReady not called");
    const url = new URL(readyInfo.url);
    expect(url.searchParams.get("scrollback")).toBe("120000");

    mockPty.emitExit(0);
    await runPromise;
  });
});

import { describe, expect, test } from "bun:test";
import { type ExitSource, runUntilExit, type SignalSource, type StoppableServer } from "./run-until-exit.ts";

class MockSession implements ExitSource {
  private exitCallback: ((exitCode: number) => void) | null = null;
  destroyCount = 0;

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
  }

  destroy(): void {
    this.destroyCount++;
  }

  emitExit(code: number): void {
    this.exitCallback?.(code);
  }
}

class MockServer implements StoppableServer {
  stopCount = 0;

  stop(): void {
    this.stopCount++;
  }
}

class MockSignals implements SignalSource {
  private handlers = new Map<string, Set<() => void>>();

  on(signal: "SIGINT" | "SIGTERM", handler: () => void): void {
    const set = this.handlers.get(signal) ?? new Set();
    set.add(handler);
    this.handlers.set(signal, set);
  }

  off(signal: "SIGINT" | "SIGTERM", handler: () => void): void {
    this.handlers.get(signal)?.delete(handler);
  }

  emit(signal: "SIGINT" | "SIGTERM"): void {
    for (const handler of [...(this.handlers.get(signal) ?? [])]) handler();
  }

  listenerCount(signal: "SIGINT" | "SIGTERM"): number {
    return this.handlers.get(signal)?.size ?? 0;
  }
}

function createHarness(): {
  session: MockSession;
  server: MockServer;
  signals: MockSignals;
  promise: Promise<number>;
} {
  const session = new MockSession();
  const server = new MockServer();
  const signals = new MockSignals();
  const promise = runUntilExit(session, server, signals);

  return { session, server, signals, promise };
}

describe("runUntilExit", () => {
  test("session exit resolves with the exit code and stops the server without destroying the session", async () => {
    const { session, server, promise } = createHarness();

    session.emitExit(7);

    expect(await promise).toBe(7);
    expect(server.stopCount).toBe(1);
    expect(session.destroyCount).toBe(0);
  });

  test("SIGINT destroys the session, stops the server, and resolves with 130", async () => {
    const { session, server, signals, promise } = createHarness();

    signals.emit("SIGINT");

    expect(await promise).toBe(130);
    expect(session.destroyCount).toBe(1);
    expect(server.stopCount).toBe(1);
  });

  test("SIGTERM destroys the session, stops the server, and resolves with 143", async () => {
    const { session, server, signals, promise } = createHarness();

    signals.emit("SIGTERM");

    expect(await promise).toBe(143);
    expect(session.destroyCount).toBe(1);
    expect(server.stopCount).toBe(1);
  });

  test("settles only once: a signal after exit is a no-op", async () => {
    const { session, server, signals, promise } = createHarness();

    session.emitExit(0);
    signals.emit("SIGINT");

    expect(await promise).toBe(0);
    expect(server.stopCount).toBe(1);
    expect(session.destroyCount).toBe(0);
  });

  test("settles only once: an exit after a signal keeps the first exit code", async () => {
    const { session, server, signals, promise } = createHarness();

    signals.emit("SIGINT");
    session.emitExit(0);

    // The signal wins the resolved code, and server shutdown is also guarded
    // so the later onExit callback cannot stop it a second time.
    expect(await promise).toBe(130);
    expect(session.destroyCount).toBe(1);
    expect(server.stopCount).toBe(1);
  });

  test("removes both signal listeners once settled", async () => {
    const { session, signals, promise } = createHarness();

    expect(signals.listenerCount("SIGINT")).toBe(1);
    expect(signals.listenerCount("SIGTERM")).toBe(1);

    session.emitExit(0);
    await promise;

    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
});

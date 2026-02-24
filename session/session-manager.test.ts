import { describe, expect, it } from "bun:test";
import { ReplayBuffer } from "../buffer/replay-buffer.ts";
import type { PtyAdapter } from "../pty/adapter.ts";
import { type ClientConnection, SessionManager } from "./session-manager.ts";

class MockPtyAdapter implements PtyAdapter {
  private dataCallback: ((data: Uint8Array) => void) | null = null;
  private exitCallback: ((exitCode: number) => void) | null = null;
  started = false;
  destroyed = false;
  writes: (string | Uint8Array)[] = [];

  onData(callback: (data: Uint8Array) => void): void {
    this.dataCallback = callback;
  }

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
  }

  start(_command: string, _args?: string[], _env?: Record<string, string>): void {
    this.started = true;
  }

  resize(_cols: number, _rows: number): void {}

  write(data: string | Uint8Array): void {
    this.writes.push(data);
  }

  destroy(): void {
    this.destroyed = true;
  }

  simulateData(data: Uint8Array): void {
    this.dataCallback?.(data);
  }

  simulateExit(code: number): void {
    this.exitCallback?.(code);
  }
}

function createMockClient(): ClientConnection & { received: Uint8Array[] } {
  const received: Uint8Array[] = [];
  return {
    received,
    send(data: Uint8Array): void {
      received.push(data);
    },
  };
}

describe("SessionManager", () => {
  function setup(opts?: { readonly?: boolean }) {
    const pty = new MockPtyAdapter();
    const replayBuffer = new ReplayBuffer(256);
    const session = new SessionManager(pty, replayBuffer);
    if (opts?.readonly) session.setReadonly(true);
    session.start("/bin/sh");
    return { pty, replayBuffer, session };
  }

  it("accepts multiple clients and forwards PTY output to all of them", () => {
    const { pty, session } = setup();
    const clientA = createMockClient();
    const clientB = createMockClient();
    const data = new Uint8Array([1, 2, 3]);

    session.connect(clientA);
    session.connect(clientB);
    pty.simulateData(data);

    expect(clientA.received).toEqual([data]);
    expect(clientB.received).toEqual([data]);
  });

  it("stops forwarding to a disconnected client", () => {
    const { pty, session } = setup();
    const clientA = createMockClient();
    const clientB = createMockClient();
    const data = new Uint8Array([4, 5, 6]);

    session.connect(clientA);
    session.connect(clientB);
    session.disconnect(clientA);

    pty.simulateData(data);

    expect(clientA.received).toEqual([]);
    expect(clientB.received).toEqual([data]);
  });

  it("accepts a new client after previous client disconnects", () => {
    const { session } = setup();
    const clientA = createMockClient();
    const clientB = createMockClient();

    session.connect(clientA);
    session.disconnect(clientA);
    expect(() => session.connect(clientB)).not.toThrow();
  });

  it("forwards PTY output to connected client AND appends to replay buffer", () => {
    const { pty, replayBuffer, session } = setup();
    const client = createMockClient();

    session.connect(client);
    const data = new Uint8Array([1, 2, 3]);
    pty.simulateData(data);

    expect(client.received).toEqual([data]);
    expect(replayBuffer.getContents()).toEqual(data);
  });

  it("provides replay buffer contents on new connection", () => {
    const { pty, session } = setup();

    const clientA = createMockClient();
    session.connect(clientA);
    pty.simulateData(new Uint8Array([10, 20, 30]));
    session.disconnect(clientA);

    const clientB = createMockClient();
    const replay = session.connect(clientB);

    expect(replay).toEqual(new Uint8Array([10, 20, 30]));
  });

  it("prevents PTY write when readonly is enabled", () => {
    const { pty, session } = setup({ readonly: true });
    const client = createMockClient();
    session.connect(client);

    session.write("should be discarded");
    expect(pty.writes).toEqual([]);
  });

  it("allows PTY write when readonly is disabled", () => {
    const { pty, session } = setup();
    const client = createMockClient();
    session.connect(client);

    session.write("allowed");
    expect(pty.writes).toEqual(["allowed"]);
  });

  it("propagates PTY exit event to session consumers", () => {
    const { pty, session } = setup();
    let exitCode: number | null = null;
    session.onExit((code) => {
      exitCode = code;
    });

    pty.simulateExit(42);

    expect(exitCode as number | null).toBe(42 as number | null);
  });

  it("keeps PTY alive when client disconnects", () => {
    const { pty, session } = setup();
    const client = createMockClient();
    session.connect(client);
    session.disconnect(client);

    expect(pty.destroyed).toBe(false);
    expect(pty.started).toBe(true);
  });

  it("accumulates PTY output in replay buffer even without a connected client", () => {
    const { pty, replayBuffer } = setup();

    pty.simulateData(new Uint8Array([1, 2, 3]));

    expect(replayBuffer.getContents()).toEqual(new Uint8Array([1, 2, 3]));
  });
});

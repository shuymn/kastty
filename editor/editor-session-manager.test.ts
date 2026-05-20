import { describe, expect, it } from "bun:test";
import type { ServerMessage } from "../protocol/messages.ts";
import type { PtyAdapter } from "../pty/adapter.ts";
import { type EditorClient, EditorSessionManager } from "./editor-session-manager.ts";
import { EDITOR_OVERLAY_PLACEHOLDER } from "./resolve.ts";

class FakePty implements PtyAdapter {
  dataCallback: ((data: Uint8Array) => void) | null = null;
  exitCallback: ((exitCode: number) => void) | null = null;
  started: { command: string; args?: string[] } | null = null;
  written: (string | Uint8Array)[] = [];
  resizes: { cols: number; rows: number }[] = [];
  destroyed = false;

  onData(callback: (data: Uint8Array) => void): void {
    this.dataCallback = callback;
  }
  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
  }
  start(command: string, args?: string[]): void {
    this.started = { command, args };
  }
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

class FakeClient implements EditorClient {
  binary: Uint8Array[] = [];
  notifications: ServerMessage[] = [];
  closed = false;

  send(data: Uint8Array): void {
    this.binary.push(data);
  }
  notify(message: ServerMessage): void {
    this.notifications.push(message);
  }
  close(): void {
    this.closed = true;
  }
}

interface Harness {
  manager: EditorSessionManager;
  ptys: FakePty[];
  created: string[];
  removed: string[];
}

function makeManager(env: { VISUAL?: string; EDITOR?: string }): Harness {
  const ptys: FakePty[] = [];
  const created: string[] = [];
  const removed: string[] = [];
  let counter = 0;
  const manager = new EditorSessionManager({
    env,
    createPty: () => {
      const pty = new FakePty();
      ptys.push(pty);
      return pty;
    },
    createTempFile: async (content) => {
      expect(content).toBe(EDITOR_OVERLAY_PLACEHOLDER);
      const path = `/tmp/fake-${counter++}.txt`;
      created.push(path);
      return path;
    },
    removeTempFile: async (path) => {
      removed.push(path);
    },
    logger: () => {},
  });
  return { manager, ptys, created, removed };
}

describe("EditorSessionManager", () => {
  it("opens a session, launches the editor, and sends hello", async () => {
    const { manager, ptys, created } = makeManager({ EDITOR: "vim" });
    const client = new FakeClient();

    await manager.open(client);

    expect(manager.hasActiveSession()).toBe(true);
    expect(created).toHaveLength(1);
    expect(ptys).toHaveLength(1);
    expect(ptys[0]?.started?.command).toBe("/bin/sh");
    expect(ptys[0]?.started?.args).toEqual(["-c", 'vim "$@"', "kastty-editor", created[0] as string]);
    expect(client.notifications).toEqual([{ t: "hello" }]);
    expect(client.closed).toBe(false);
  });

  it("streams PTY output to the client as binary frames", async () => {
    const { manager, ptys } = makeManager({ EDITOR: "vim" });
    const client = new FakeClient();
    await manager.open(client);

    const output = new TextEncoder().encode("editor output");
    ptys[0]?.emitData(output);

    expect(client.binary).toEqual([output]);
  });

  it("rejects a second session while one is active", async () => {
    const { manager, ptys } = makeManager({ EDITOR: "vim" });
    const first = new FakeClient();
    await manager.open(first);

    const second = new FakeClient();
    await manager.open(second);

    expect(ptys).toHaveLength(1);
    expect(second.notifications).toEqual([{ t: "error", message: "An editor overlay is already open" }]);
    expect(second.closed).toBe(true);
  });

  it("rejects when no editor is configured", async () => {
    const { manager, ptys, created } = makeManager({});
    const client = new FakeClient();

    await manager.open(client);

    expect(manager.hasActiveSession()).toBe(false);
    expect(ptys).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(client.notifications).toEqual([{ t: "error", message: "No editor configured: set $VISUAL or $EDITOR" }]);
    expect(client.closed).toBe(true);
  });

  it("forwards write and resize to the active PTY", async () => {
    const { manager, ptys } = makeManager({ EDITOR: "vim" });
    const client = new FakeClient();
    await manager.open(client);

    const input = new TextEncoder().encode(":wq\n");
    manager.write(client, input);
    manager.resize(client, 100, 30);

    expect(ptys[0]?.written).toEqual([input]);
    expect(ptys[0]?.resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it("ignores write/resize from a non-active client", async () => {
    const { manager, ptys } = makeManager({ EDITOR: "vim" });
    const client = new FakeClient();
    await manager.open(client);

    const stranger = new FakeClient();
    manager.write(stranger, new TextEncoder().encode("x"));
    manager.resize(stranger, 1, 1);

    expect(ptys[0]?.written).toHaveLength(0);
    expect(ptys[0]?.resizes).toHaveLength(0);
  });

  it("on PTY exit notifies, closes, cleans up the temp file, and frees the slot", async () => {
    const { manager, ptys, created, removed } = makeManager({ EDITOR: "vim" });
    const client = new FakeClient();
    await manager.open(client);

    ptys[0]?.emitExit(0);
    await Promise.resolve();

    expect(client.notifications).toEqual([{ t: "hello" }, { t: "exit", code: 0 }]);
    expect(client.closed).toBe(true);
    expect(removed).toEqual(created);
    expect(manager.hasActiveSession()).toBe(false);
  });

  it("on client disconnect destroys the PTY, cleans up, and frees the slot", async () => {
    const { manager, ptys, created, removed } = makeManager({ EDITOR: "vim" });
    const client = new FakeClient();
    await manager.open(client);

    manager.disconnect(client);
    await Promise.resolve();

    expect(ptys[0]?.destroyed).toBe(true);
    expect(removed).toEqual(created);
    expect(manager.hasActiveSession()).toBe(false);
  });

  it("allows a new session after the previous one exits", async () => {
    const { manager, ptys } = makeManager({ EDITOR: "vim" });
    const first = new FakeClient();
    await manager.open(first);
    ptys[0]?.emitExit(0);
    await Promise.resolve();

    const second = new FakeClient();
    await manager.open(second);

    expect(ptys).toHaveLength(2);
    expect(second.notifications).toEqual([{ t: "hello" }]);
    expect(manager.hasActiveSession()).toBe(true);
  });

  it("does not double clean up when exit follows disconnect", async () => {
    const { manager, ptys, removed } = makeManager({ EDITOR: "vim" });
    const client = new FakeClient();
    await manager.open(client);

    manager.disconnect(client);
    ptys[0]?.emitExit(0);
    await Promise.resolve();

    expect(removed).toHaveLength(1);
  });

  it("does not launch a PTY when the client disconnects while creating the temp file", async () => {
    let resolveTempFile!: (path: string) => void;
    const ptys: FakePty[] = [];
    const removed: string[] = [];
    const manager = new EditorSessionManager({
      env: { EDITOR: "vim" },
      createPty: () => {
        const pty = new FakePty();
        ptys.push(pty);
        return pty;
      },
      createTempFile: async () =>
        new Promise<string>((resolve) => {
          resolveTempFile = resolve;
        }),
      removeTempFile: async (path) => {
        removed.push(path);
      },
      logger: () => {},
    });
    const client = new FakeClient();

    const openPromise = manager.open(client);
    await Promise.resolve();
    expect(manager.hasActiveSession()).toBe(true);

    manager.disconnect(client);
    resolveTempFile("/tmp/disconnected.txt");
    await openPromise;

    expect(ptys).toHaveLength(0);
    expect(removed).toEqual(["/tmp/disconnected.txt"]);
    expect(client.notifications).toEqual([]);
    expect(manager.hasActiveSession()).toBe(false);
  });

  it("does not send hello if the PTY exits during start", async () => {
    class ExitingPty extends FakePty {
      override start(command: string, args?: string[]): void {
        super.start(command, args);
        this.emitExit(0);
      }
    }

    const removed: string[] = [];
    const manager = new EditorSessionManager({
      env: { EDITOR: "vim" },
      createPty: () => new ExitingPty(),
      createTempFile: async () => "/tmp/exits-during-start.txt",
      removeTempFile: async (path) => {
        removed.push(path);
      },
      logger: () => {},
    });
    const client = new FakeClient();

    await manager.open(client);
    await Promise.resolve();

    expect(client.notifications).toEqual([{ t: "exit", code: 0 }]);
    expect(client.closed).toBe(true);
    expect(removed).toEqual(["/tmp/exits-during-start.txt"]);
    expect(manager.hasActiveSession()).toBe(false);
  });
});

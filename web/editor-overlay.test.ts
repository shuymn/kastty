import { describe, expect, it, mock } from "bun:test";
import { EditorOverlay, type EditorOverlayClient, type EditorOverlayFitAddon } from "./editor-overlay.ts";
import type { GhosttyAdapterResult, GhosttyTerminalAddon } from "./ghostty-adapter.ts";
import type { ConnectionState, TerminalHandle } from "./terminal.ts";

class FakeClient implements EditorOverlayClient {
  stateCallbacks: Array<(state: ConnectionState) => void> = [];
  exitCallbacks: Array<(code: number) => void> = [];
  errorCallbacks: Array<(message: string) => void> = [];
  sentResizes: Array<{ cols: number; rows: number }> = [];
  sentInputs: Uint8Array[] = [];
  openRequests: string[] = [];
  calls: string[] = [];
  connected = false;
  disconnected = false;

  connect(): void {
    this.calls.push("connect");
    this.connected = true;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  requestOpen(content: string): void {
    this.calls.push(`requestOpen:${content}`);
    this.openRequests.push(content);
  }

  sendInput(data: Uint8Array | ArrayBuffer): void {
    this.sentInputs.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  sendResize(cols: number, rows: number): void {
    this.sentResizes.push({ cols, rows });
  }

  onStateChange(callback: (state: ConnectionState) => void): void {
    this.stateCallbacks.push(callback);
  }

  onExit(callback: (code: number) => void): void {
    this.exitCallbacks.push(callback);
  }

  onError(callback: (message: string) => void): void {
    this.errorCallbacks.push(callback);
  }

  emitState(state: ConnectionState): void {
    for (const callback of this.stateCallbacks) callback(state);
  }
}

function makeElement(): HTMLElement {
  return {
    dataset: {},
    replaceChildren: mock(() => {}),
  } as unknown as HTMLElement;
}

function makeAdapter() {
  let resizeCallback: ((cols: number, rows: number) => void) | null = null;
  const dispose = mock(() => {});
  const focus = mock(() => {});
  const adapter: GhosttyAdapterResult = {
    handle: {
      write() {},
      dispose,
    },
    onData() {
      return { dispose: mock(() => {}) };
    },
    onResize(callback) {
      resizeCallback = callback;
      return { dispose: mock(() => {}) };
    },
    loadAddon(_addon: GhosttyTerminalAddon) {},
    focus,
    setFontSize() {},
    setFontFamily() {},
    scrollToBottom() {},
    getBufferText: () => "",
  };
  return {
    adapter,
    dispose,
    focus,
    fireResize(cols: number, rows: number) {
      resizeCallback?.(cols, rows);
    },
  };
}

function makeFitAddon(): EditorOverlayFitAddon {
  return {
    activate() {},
    fit: mock(() => {}),
    observeResize: mock(() => {}),
    dispose: mock(() => {}),
  };
}

function setup(options: { createAdapterRejects?: boolean; connectThrows?: boolean } = {}) {
  const container = makeElement();
  const surface = makeElement();
  const adapterHarness = makeAdapter();
  const client = new FakeClient();
  if (options.connectThrows) {
    client.connect = () => {
      throw new Error("connect failed");
    };
  }
  const onClosed = mock(() => {});
  const errors: string[] = [];
  const overlay = new EditorOverlay({
    container,
    surface,
    wsUrl: "ws://127.0.0.1/editor-ws?t=token",
    terminalOptions: {},
    onClosed,
    onError: (message) => errors.push(message),
    createAdapter: async () => {
      if (options.createAdapterRejects) throw new Error("adapter failed");
      return adapterHarness.adapter;
    },
    createClient: (_terminal: TerminalHandle) => client,
    createFitAddon: makeFitAddon,
  });
  return { overlay, container, surface, adapterHarness, client, onClosed, errors };
}

describe("EditorOverlay", () => {
  it("tears down when the websocket disconnects before hello", async () => {
    const { overlay, container, surface, client, onClosed } = setup();

    await overlay.open("buffer text\n");
    expect(overlay.isActive()).toBe(true);

    client.emitState("disconnected");

    expect(overlay.isActive()).toBe(false);
    expect(container.dataset.active).toBe("false");
    expect(surface.replaceChildren).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("cleans up when terminal creation fails", async () => {
    const { overlay, container, surface, onClosed, errors } = setup({ createAdapterRejects: true });

    await overlay.open("buffer text\n");

    expect(overlay.isActive()).toBe(false);
    expect(container.dataset.active).toBe("false");
    expect(surface.replaceChildren).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(errors[0]).toContain("Failed to open editor overlay");
  });

  it("cleans up when websocket connection setup throws", async () => {
    const { overlay, container, surface, onClosed, errors } = setup({ connectThrows: true });

    await overlay.open("buffer text\n");

    expect(overlay.isActive()).toBe(false);
    expect(container.dataset.active).toBe("false");
    expect(surface.replaceChildren).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(errors[0]).toContain("Failed to open editor overlay");
  });

  it("requests the editor open with the buffer content before connecting", async () => {
    const { overlay, client } = setup();

    await overlay.open("scrollback content\n");

    expect(client.openRequests).toEqual(["scrollback content\n"]);
    expect(client.connected).toBe(true);
    expect(client.calls).toEqual(["requestOpen:scrollback content\n", "connect"]);
  });

  it("resends the latest terminal size after the websocket connects", async () => {
    const { overlay, adapterHarness, client } = setup();

    await overlay.open("buffer text\n");
    adapterHarness.fireResize(100, 30);
    client.sentResizes.length = 0;

    client.emitState("connected");

    expect(client.sentResizes).toContainEqual({ cols: 100, rows: 30 });
    expect(adapterHarness.focus).toHaveBeenCalledTimes(1);
  });
});

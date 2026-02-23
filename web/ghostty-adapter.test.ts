import { describe, expect, it, mock } from "bun:test";
import { createGhosttyTerminal, type GhosttyModule, quoteFontFamily } from "./ghostty-adapter.ts";

function setup() {
  const openMock = mock((_parent: HTMLElement) => {});
  const writeMock = mock((_data: string | Uint8Array) => {});
  const disposeMock = mock(() => {});
  const focusMock = mock(() => {});
  const scrollToBottomMock = mock(() => {});

  let dataCallback: ((data: string) => void) | null = null;
  let resizeCallback: ((event: { cols: number; rows: number }) => void) | null = null;

  const loadAddonMock = mock((_addon: { activate(terminal: unknown): void; dispose(): void }) => {});

  const terminal = {
    open: openMock,
    write: writeMock,
    onData(listener: (data: string) => void) {
      dataCallback = listener;
      return {
        dispose: () => {
          dataCallback = null;
        },
      };
    },
    onResize(listener: (event: { cols: number; rows: number }) => void) {
      resizeCallback = listener;
      return {
        dispose: () => {
          resizeCallback = null;
        },
      };
    },
    loadAddon: loadAddonMock,
    dispose: disposeMock,
    focus: focusMock,
    scrollToBottom: scrollToBottomMock,
    options: { fontSize: 14 },
  };

  const initMock = mock(() => Promise.resolve());
  const createTerminalMock = mock((_opts?: Record<string, unknown>) => terminal);

  const ghostty: GhosttyModule = {
    init: initMock,
    createTerminal: createTerminalMock,
  };

  return {
    ghostty,
    mocks: {
      init: initMock,
      createTerminal: createTerminalMock,
      open: openMock,
      write: writeMock,
      loadAddon: loadAddonMock,
      dispose: disposeMock,
      focus: focusMock,
      scrollToBottom: scrollToBottomMock,
    },
    fireData(data: string) {
      dataCallback?.(data);
    },
    fireResize(cols: number, rows: number) {
      resizeCallback?.({ cols, rows });
    },
  };
}

describe("createGhosttyTerminal", () => {
  it("initializes WASM and attaches terminal to container", async () => {
    const { ghostty, mocks } = setup();
    const container = {} as HTMLElement;

    await createGhosttyTerminal(container, ghostty);

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledWith(container);
  });

  it("passes options to createTerminal with quoted fontFamily", async () => {
    const { ghostty, mocks } = setup();
    const options = { fontSize: 16, fontFamily: "monospace" };

    await createGhosttyTerminal({} as HTMLElement, ghostty, options);

    expect(mocks.createTerminal).toHaveBeenCalledWith({ fontSize: 16, fontFamily: '"monospace"' });
  });

  it("handle.write delegates to terminal.write", async () => {
    const { ghostty, mocks } = setup();

    const { handle } = await createGhosttyTerminal({} as HTMLElement, ghostty);
    const data = new Uint8Array([72, 101, 108, 108, 111]);
    handle.write(data);

    expect(mocks.write).toHaveBeenCalledWith(data);
  });

  it("handle.dispose delegates to terminal.dispose", async () => {
    const { ghostty, mocks } = setup();

    const { handle } = await createGhosttyTerminal({} as HTMLElement, ghostty);
    handle.dispose();

    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("onData wires callback to terminal.onData", async () => {
    const { ghostty, fireData } = setup();

    const { onData } = await createGhosttyTerminal({} as HTMLElement, ghostty);
    const received: string[] = [];
    onData((data) => received.push(data));

    fireData("hello");

    expect(received).toEqual(["hello"]);
  });

  it("onResize destructures {cols, rows} into separate arguments", async () => {
    const { ghostty, fireResize } = setup();

    const { onResize } = await createGhosttyTerminal({} as HTMLElement, ghostty);
    const received: [number, number][] = [];
    onResize((cols, rows) => received.push([cols, rows]));

    fireResize(120, 40);

    expect(received).toEqual([[120, 40]]);
  });

  it("focus delegates to terminal.focus", async () => {
    const { ghostty, mocks } = setup();

    const { focus } = await createGhosttyTerminal({} as HTMLElement, ghostty);
    focus();

    expect(mocks.focus).toHaveBeenCalledTimes(1);
  });
});

describe("quoteFontFamily", () => {
  it("wraps an unquoted name in double quotes", () => {
    expect(quoteFontFamily("UDEV Gothic 35NF")).toBe('"UDEV Gothic 35NF"');
  });

  it("does not double-quote an already double-quoted name", () => {
    expect(quoteFontFamily('"Fira Code"')).toBe('"Fira Code"');
  });

  it("does not double-quote an already single-quoted name", () => {
    expect(quoteFontFamily("'Fira Code'")).toBe("'Fira Code'");
  });

  it("wraps a simple name in double quotes", () => {
    expect(quoteFontFamily("monospace")).toBe('"monospace"');
  });
});

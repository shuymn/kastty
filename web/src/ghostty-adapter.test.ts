import { describe, expect, it } from "bun:test";
import type { ITerminalOptions } from "ghostty-web";
import type { TerminalConfig } from "./attach-client.ts";
import {
  createGhosttyTerminal,
  DEFAULT_FONT_FAMILY,
  type GhosttyFitAddon,
  type GhosttyTerminal,
  quoteFontFamily,
  toGhosttyScrollbackBytes,
} from "./ghostty-adapter.ts";

const CONFIG: TerminalConfig = { cols: 80, rows: 24, fontFamily: "", scrollback: 50000 };

function setup(config: TerminalConfig = CONFIG) {
  const calls: string[] = [];
  let created: ITerminalOptions | undefined;
  let wheelHandler: ((event: WheelEvent) => boolean) | undefined;

  // Like ghostty-web 0.4.0, reset() replaces wasmTerm but not the selection manager's copy.
  const firstWasmTerm = {};
  const terminal: GhosttyTerminal & { wasmTerm: object; selectionManager: { wasmTerm: object } } = {
    wasmTerm: firstWasmTerm,
    selectionManager: { wasmTerm: firstWasmTerm },
    rows: config.rows,
    open: () => calls.push("open"),
    write: () => calls.push("write"),
    reset: () => {
      calls.push("reset");
      terminal.wasmTerm = {};
    },
    clearSelection: () => {
      // Clearing reads the selection manager's terminal, so it must be the live one by now.
      calls.push(
        `clearSelection on ${terminal.selectionManager.wasmTerm === terminal.wasmTerm ? "live" : "freed"} terminal`,
      );
    },
    resize: (cols, rows) => calls.push(`resize ${cols}x${rows}`),
    focus: () => calls.push("focus"),
    dispose: () => calls.push("dispose"),
    loadAddon: () => calls.push("loadAddon"),
    onData: () => undefined,
    scrollLines: (amount) => calls.push(`scroll ${amount}`),
    attachCustomWheelEventHandler: (handler) => {
      wheelHandler = handler;
    },
  };
  const fitAddon: GhosttyFitAddon = {
    activate: () => {},
    dispose: () => {},
    proposeDimensions: () => ({ cols: 132, rows: 43 }),
  };
  // 24 rows drawn 480px tall: 20px per line.
  const canvas = { clientHeight: 480, width: 1600, height: 960 };
  const container = { querySelector: () => canvas } as unknown as HTMLElement;

  const view = createGhosttyTerminal(container, config, {
    createTerminal(options) {
      created = options;
      return terminal;
    },
    createFitAddon: () => fitAddon,
  });

  const wheel = (deltaMode: number, deltaY: number) => wheelHandler?.({ deltaMode, deltaY } as WheelEvent);
  return { view, calls, canvas, options: () => created, wheel };
}

describe("createGhosttyTerminal", () => {
  it("creates the terminal at the host size with the default font and scrollback in bytes", () => {
    const { options } = setup();

    expect(options()).toEqual({
      cols: 80,
      rows: 24,
      fontSize: 14,
      fontFamily: DEFAULT_FONT_FAMILY,
      scrollback: toGhosttyScrollbackBytes(50000),
    });
  });

  it("quotes a configured font family for the canvas font shorthand", () => {
    const { options } = setup({ ...CONFIG, fontFamily: "UDEV Gothic 35NF" });

    expect(options()?.fontFamily).toBe('"UDEV Gothic 35NF"');
  });

  it("proposes the container size without resizing the terminal", () => {
    const { view, calls } = setup();

    expect(view.proposeSize()).toEqual({ cols: 132, rows: 43 });
    expect(calls.filter((call) => call.startsWith("resize"))).toEqual([]);
  });

  it("points the selection at the new WASM terminal after a reset and clears it", () => {
    const { view, calls } = setup();

    view.reset();

    expect(calls.slice(-2)).toEqual(["reset", "clearSelection on live terminal"]);
  });

  it("frees the canvas bitmap before disposing, since ghostty-web keeps the canvas referenced", () => {
    const { view, calls, canvas } = setup();

    view.dispose();

    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 0, height: 0 });
    expect(calls.at(-1)).toBe("dispose");
  });

  it("scrolls by whole lines, accumulating pixel deltas", () => {
    const { calls, wheel } = setup();

    wheel(0, 15);
    wheel(0, 15);
    wheel(0, 30);
    wheel(1, 2.6);
    wheel(2, -1);

    expect(calls.filter((call) => call.startsWith("scroll"))).toEqual([
      "scroll 1",
      "scroll 2",
      "scroll 3",
      "scroll -24",
    ]);
  });
});

describe("toGhosttyScrollbackBytes", () => {
  it("converts lines to bytes within ghostty-web's bounds", () => {
    expect(toGhosttyScrollbackBytes(50000)).toBe(102_400_000);
    expect(toGhosttyScrollbackBytes(0)).toBe(1_000_000);
    expect(toGhosttyScrollbackBytes(10_000_000)).toBe(1_000_000_000);
  });
});

describe("quoteFontFamily", () => {
  it("wraps an unquoted name in double quotes", () => {
    expect(quoteFontFamily("UDEV Gothic 35NF")).toBe('"UDEV Gothic 35NF"');
  });

  it("keeps an already quoted name or list", () => {
    expect(quoteFontFamily('"Fira Code"')).toBe('"Fira Code"');
    expect(quoteFontFamily("'Fira Code'")).toBe("'Fira Code'");
    expect(quoteFontFamily(DEFAULT_FONT_FAMILY)).toBe(DEFAULT_FONT_FAMILY);
  });
});

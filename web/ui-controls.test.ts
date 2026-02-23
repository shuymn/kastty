import { describe, expect, it } from "bun:test";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, UIControls, type UIControlsDeps, type UIControlsState } from "./ui-controls.ts";

function createMockDeps(): UIControlsDeps & {
  calls: { sendReadonly: boolean[]; setFontSize: number[] };
} {
  const calls = { sendReadonly: [] as boolean[], setFontSize: [] as number[] };
  return {
    calls,
    sendReadonly(enabled: boolean) {
      calls.sendReadonly.push(enabled);
    },
    setFontSize(size: number) {
      calls.setFontSize.push(size);
    },
  };
}

describe("UIControls", () => {
  describe("connection status", () => {
    it("displays current connection state", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);

      expect(controls.getState().connectionState).toBe("disconnected");

      controls.setConnectionState("connecting");
      expect(controls.getState().connectionState).toBe("connecting");

      controls.setConnectionState("connected");
      expect(controls.getState().connectionState).toBe("connected");

      controls.setConnectionState("disconnected");
      expect(controls.getState().connectionState).toBe("disconnected");
    });
  });

  describe("font size", () => {
    it("increases font size and calls setFontSize", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);

      controls.increaseFontSize();

      expect(controls.getState().fontSize).toBe(15);
      expect(deps.calls.setFontSize).toEqual([15]);
    });

    it("decreases font size and calls setFontSize", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);

      controls.decreaseFontSize();

      expect(controls.getState().fontSize).toBe(13);
      expect(deps.calls.setFontSize).toEqual([13]);
    });

    it("does not increase font size above maximum", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, MAX_FONT_SIZE);

      controls.increaseFontSize();

      expect(controls.getState().fontSize).toBe(MAX_FONT_SIZE);
      expect(deps.calls.setFontSize).toEqual([]);
    });

    it("does not decrease font size below minimum", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, MIN_FONT_SIZE);

      controls.decreaseFontSize();

      expect(controls.getState().fontSize).toBe(MIN_FONT_SIZE);
      expect(deps.calls.setFontSize).toEqual([]);
    });
  });

  describe("readonly toggle", () => {
    it("sends WS control message on toggle", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);

      controls.toggleReadonly();
      expect(deps.calls.sendReadonly).toEqual([true]);

      controls.toggleReadonly();
      expect(deps.calls.sendReadonly).toEqual([true, false]);
    });

    it("blocks input when readonly is enabled", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);

      expect(controls.isReadonly()).toBe(false);

      controls.toggleReadonly();
      expect(controls.isReadonly()).toBe(true);

      controls.toggleReadonly();
      expect(controls.isReadonly()).toBe(false);
    });

    it("reflects readonly state in getState()", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);

      expect(controls.getState().readonly).toBe(false);

      controls.toggleReadonly();
      expect(controls.getState().readonly).toBe(true);
    });
  });

  describe("auto-scroll toggle", () => {
    it("defaults to enabled and can be toggled", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);

      expect(controls.isAutoScrollEnabled()).toBe(true);
      expect(controls.getState().autoScroll).toBe(true);

      controls.toggleAutoScroll();
      expect(controls.isAutoScrollEnabled()).toBe(false);
      expect(controls.getState().autoScroll).toBe(false);

      controls.toggleAutoScroll();
      expect(controls.isAutoScrollEnabled()).toBe(true);
      expect(controls.getState().autoScroll).toBe(true);
    });
  });

  describe("state change notifications", () => {
    it("notifies listeners on connection state changes", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);
      const states: UIControlsState[] = [];
      controls.onStateChange((state) => states.push(state));

      controls.setConnectionState("connecting");
      controls.setConnectionState("connected");

      expect(states).toHaveLength(2);
      expect(states[0]?.connectionState).toBe("connecting");
      expect(states[1]?.connectionState).toBe("connected");
    });

    it("notifies listeners on font size changes", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);
      const sizes: number[] = [];
      controls.onStateChange((state) => sizes.push(state.fontSize));

      controls.increaseFontSize();
      controls.decreaseFontSize();

      expect(sizes).toEqual([15, 14]);
    });

    it("notifies listeners on readonly toggle", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);
      const readonlyStates: boolean[] = [];
      controls.onStateChange((state) => readonlyStates.push(state.readonly));

      controls.toggleReadonly();
      controls.toggleReadonly();

      expect(readonlyStates).toEqual([true, false]);
    });

    it("notifies listeners on auto-scroll toggle", () => {
      const deps = createMockDeps();
      const controls = new UIControls(deps, 14);
      const scrollStates: boolean[] = [];
      controls.onStateChange((state) => scrollStates.push(state.autoScroll));

      controls.toggleAutoScroll();
      controls.toggleAutoScroll();

      expect(scrollStates).toEqual([false, true]);
    });
  });
});

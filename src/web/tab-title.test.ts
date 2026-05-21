import { describe, expect, it } from "bun:test";
import { CONNECTING_TAB_PREFIX, DEFAULT_TAB_TITLE, DISCONNECTED_TAB_PREFIX, formatTabTitle } from "./tab-title.ts";

describe("formatTabTitle", () => {
  it("uses terminal title in connected state", () => {
    expect(formatTabTitle("connected", "my-project")).toBe("my-project");
  });

  it("falls back to default title when terminal title is empty", () => {
    expect(formatTabTitle("connected", "")).toBe(DEFAULT_TAB_TITLE);
    expect(formatTabTitle("connected", "   ")).toBe(DEFAULT_TAB_TITLE);
    expect(formatTabTitle("connected", null)).toBe(DEFAULT_TAB_TITLE);
  });

  it("adds connecting prefix while websocket is connecting", () => {
    expect(formatTabTitle("connecting", "my-project")).toBe(`${CONNECTING_TAB_PREFIX} my-project`);
  });

  it("adds disconnected prefix after websocket closes", () => {
    expect(formatTabTitle("disconnected", "my-project")).toBe(`${DISCONNECTED_TAB_PREFIX} my-project`);
  });
});

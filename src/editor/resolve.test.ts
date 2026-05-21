import { describe, expect, it } from "bun:test";
import { buildEditorSpawn, resolveEditorCommand } from "./resolve.ts";

describe("resolveEditorCommand", () => {
  it("prefers VISUAL over EDITOR", () => {
    expect(resolveEditorCommand({ VISUAL: "nvim", EDITOR: "vi" })).toBe("nvim");
  });

  it("falls back to EDITOR when VISUAL is unset", () => {
    expect(resolveEditorCommand({ EDITOR: "vim" })).toBe("vim");
  });

  it("falls back to EDITOR when VISUAL is empty or whitespace", () => {
    expect(resolveEditorCommand({ VISUAL: "   ", EDITOR: "vim" })).toBe("vim");
  });

  it("preserves arguments embedded in the value", () => {
    expect(resolveEditorCommand({ EDITOR: "nvim -R" })).toBe("nvim -R");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveEditorCommand({ EDITOR: "  vim  " })).toBe("vim");
  });

  it("returns null when both are unset", () => {
    expect(resolveEditorCommand({})).toBeNull();
  });

  it("returns null when both are empty/whitespace", () => {
    expect(resolveEditorCommand({ VISUAL: "", EDITOR: "  " })).toBeNull();
  });
});

describe("buildEditorSpawn", () => {
  it("launches the editor through a controlled shell invocation", () => {
    const spawn = buildEditorSpawn("nvim", "/tmp/kastty-editor-x.txt");
    expect(spawn.command).toBe("/bin/sh");
    expect(spawn.args).toEqual(["-c", 'nvim "$@"', "kastty-editor", "/tmp/kastty-editor-x.txt"]);
  });

  it("keeps editor arguments inside the script and passes the file as a positional param", () => {
    const spawn = buildEditorSpawn("nvim -R", "/tmp/has space.txt");
    expect(spawn.args).toEqual(["-c", 'nvim -R "$@"', "kastty-editor", "/tmp/has space.txt"]);
  });
});

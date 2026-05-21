import { describe, expect, it } from "bun:test";
import { type ExtractableBuffer, type ExtractableBufferLine, extractBufferText } from "./buffer-extract.ts";

interface FakeLine {
  text: string;
  isWrapped?: boolean;
}

/**
 * Build an ExtractableBuffer from raw line specs. `translateToString(true)`
 * trims trailing whitespace, mirroring ghostty-web's IBufferLine; the extractor
 * passes `false`, so we return the text verbatim then.
 */
function makeBuffer(lines: FakeLine[]): ExtractableBuffer {
  const buildLine = (spec: FakeLine): ExtractableBufferLine => ({
    isWrapped: spec.isWrapped ?? false,
    translateToString: (trimRight?: boolean) => (trimRight ? spec.text.replace(/[ \t]+$/u, "") : spec.text),
  });
  return {
    length: lines.length,
    getLine: (y: number) => {
      const spec = lines[y];
      return spec ? buildLine(spec) : undefined;
    },
  };
}

describe("extractBufferText", () => {
  it("returns an empty string for an empty buffer", () => {
    expect(extractBufferText(makeBuffer([]))).toBe("");
  });

  it("returns an empty string for a buffer of only blank lines", () => {
    expect(extractBufferText(makeBuffer([{ text: "" }, { text: "   " }, { text: "" }]))).toBe("");
  });

  it("joins non-wrapped lines with newlines and ends with a trailing newline", () => {
    const buffer = makeBuffer([{ text: "first" }, { text: "second" }, { text: "third" }]);
    expect(extractBufferText(buffer)).toBe("first\nsecond\nthird\n");
  });

  it("trims trailing whitespace per line", () => {
    const buffer = makeBuffer([{ text: "padded   " }, { text: "tabbed\t\t" }]);
    expect(extractBufferText(buffer)).toBe("padded\ntabbed\n");
  });

  it("drops trailing blank lines but keeps interior blanks", () => {
    const buffer = makeBuffer([{ text: "a" }, { text: "" }, { text: "b" }, { text: "" }, { text: "   " }]);
    expect(extractBufferText(buffer)).toBe("a\n\nb\n");
  });

  it("rejoins soft-wrapped continuation rows into one logical line", () => {
    const buffer = makeBuffer([
      { text: "echo this-is-a-very-" },
      { text: "long-command", isWrapped: true },
      { text: "next" },
    ]);
    expect(extractBufferText(buffer)).toBe("echo this-is-a-very-long-command\nnext\n");
  });

  it("ignores a leading wrapped flag when there is no line to continue", () => {
    const buffer = makeBuffer([{ text: "orphan", isWrapped: true }, { text: "tail" }]);
    expect(extractBufferText(buffer)).toBe("orphan\ntail\n");
  });

  it("treats out-of-range/undefined lines as blank lines", () => {
    const buffer: ExtractableBuffer = {
      length: 3,
      getLine: (y: number) => {
        if (y === 0) return { isWrapped: false, translateToString: () => "top" };
        return undefined;
      },
    };
    // Lines 1 and 2 are blank; trailing blanks are dropped.
    expect(extractBufferText(buffer)).toBe("top\n");
  });
});

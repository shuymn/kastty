import { describe, expect, it } from "bun:test";
import { TitleParser } from "./title-parser.ts";

const encoder = new TextEncoder();
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ST = `${ESC}\\`; // String Terminator: ESC backslash
const OVERSIZED_TITLE = "x".repeat(100000);

/** Encode a string built from ESC/BEL/ST into a single output frame. */
function frame(text: string): Uint8Array {
  return encoder.encode(text);
}

describe("TitleParser", () => {
  it("extracts an OSC 2 title terminated by BEL", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(`${ESC}]2;repo/kastty${BEL}`))).toEqual(["repo/kastty"]);
  });

  it("extracts an OSC 0 title terminated by BEL", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(`${ESC}]0;window${BEL}`))).toEqual(["window"]);
  });

  it("extracts a title terminated by ST (ESC backslash)", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(`${ESC}]2;via-st${ST}`))).toEqual(["via-st"]);
  });

  it("returns multiple titles found in a single chunk", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(`${ESC}]2;first${BEL}${ESC}]2;second${BEL}`))).toEqual(["first", "second"]);
  });

  it("ignores OSC sequences other than types 0 and 2", () => {
    const parser = new TitleParser();
    // OSC 1 (icon name) and OSC 8 (hyperlink) must be skipped, then OSC 2 found.
    const input = `${ESC}]1;icon${BEL}${ESC}]8;;https://example.com${BEL}${ESC}]2;real${BEL}`;
    expect(parser.push(frame(input))).toEqual(["real"]);
  });

  it("returns no titles for a chunk without ESC", () => {
    const parser = new TitleParser();
    expect(parser.push(frame("plain output, no escape"))).toEqual([]);
  });

  it("buffers a sequence split across two pushes", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(`${ESC}]2;repo/ka`))).toEqual([]);
    expect(parser.push(frame(`stty${BEL}`))).toEqual(["repo/kastty"]);
  });

  it("buffers an OSC prefix split between ESC and bracket", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(ESC))).toEqual([]);
    expect(parser.push(frame(`]2;repo/kastty${BEL}`))).toEqual(["repo/kastty"]);
  });

  it("prefers the earliest terminator when both BEL and ST appear", () => {
    const parser = new TitleParser();
    // BEL appears before ST, so the title ends at BEL; the trailing ST text is
    // ordinary content and yields no further title.
    expect(parser.push(frame(`${ESC}]2;early${BEL} then ${ST}`))).toEqual(["early"]);
  });

  it("decodes a multi-byte UTF-8 title split across frame boundaries", () => {
    const parser = new TitleParser();
    const bytes = encoder.encode(`${ESC}]2;あ${BEL}`); // "あ" is 3 bytes in UTF-8
    // Split inside the 3-byte "あ": prefix carries ESC ] 2 ; and its first byte.
    const split = 5;
    expect(parser.push(bytes.slice(0, split))).toEqual([]);
    expect(parser.push(bytes.slice(split))).toEqual(["あ"]);
  });

  it("discards a partial sequence after reset", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(`${ESC}]2;repo/ka`))).toEqual([]);
    parser.reset();
    // The buffered prefix is gone, so the completion alone yields no title.
    expect(parser.push(frame(`stty${BEL}`))).toEqual([]);
  });

  it("stays bounded on a long unterminated sequence and recovers afterwards", () => {
    const parser = new TitleParser();
    // A huge unterminated OSC must not throw; a later complete sequence still parses.
    expect(parser.push(frame(`${ESC}]2;${OVERSIZED_TITLE}`))).toEqual([]);
    expect(parser.push(frame(`${ESC}]2;recovered${BEL}`))).toEqual(["recovered"]);
  });

  it("does not emit embedded OSC text after discarding a long unterminated sequence", () => {
    const parser = new TitleParser();
    const embedded = `${OVERSIZED_TITLE}${ESC}]2;fake`;
    expect(parser.push(frame(`${ESC}]2;${embedded}`))).toEqual([]);
    expect(parser.push(frame(BEL))).toEqual([]);
  });

  it("recovers after a long unterminated sequence is terminated", () => {
    const parser = new TitleParser();
    expect(parser.push(frame(`${ESC}]2;${OVERSIZED_TITLE}`))).toEqual([]);
    expect(parser.push(frame(`${BEL}${ESC}]2;recovered${BEL}`))).toEqual(["recovered"]);
  });
});

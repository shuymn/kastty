const ESC = "\u001b";
const ESC_CODE = 0x1b;
const OSC_PREFIX = `${ESC}]`;
const BEL = "\u0007";
const ST = `${ESC}\\`;
const MAX_TITLE_BUFFER_LENGTH = 8192;

/**
 * Streaming parser for OSC 0/2 window-title sequences in raw terminal output.
 *
 * Terminal output arrives as a stream of binary frames, so a title sequence
 * (`ESC ] 0;<title> BEL` or `ESC ] 2;<title> ST`) may be split across frames.
 * {@link push} accumulates partial sequences in an internal buffer and a
 * streaming `TextDecoder` so multi-byte UTF-8 split across a frame boundary is
 * decoded correctly, returning any complete titles found so far.
 *
 * The buffer is capped at {@link MAX_TITLE_BUFFER_LENGTH} so an unterminated
 * sequence cannot grow without bound.
 */
export class TitleParser {
  private buffer = "";
  private decoder = new TextDecoder();

  /** Feed a chunk of raw terminal output; returns any complete titles found. */
  push(data: Uint8Array): string[] {
    const titles: string[] = [];
    if (this.buffer.length === 0 && !data.includes(ESC_CODE)) return titles;

    const decoded = this.decoder.decode(data, { stream: true });
    if (decoded.length === 0) return titles;
    this.buffer += decoded;

    let cursor = 0;
    while (true) {
      const start = this.buffer.indexOf(OSC_PREFIX, cursor);
      if (start === -1) break;

      const typeIndex = start + OSC_PREFIX.length;
      const type = this.buffer[typeIndex];
      if ((type !== "0" && type !== "2") || this.buffer[typeIndex + 1] !== ";") {
        cursor = typeIndex + 1;
        continue;
      }

      const titleStart = typeIndex + 2;
      const belIndex = this.buffer.indexOf(BEL, titleStart);
      const stIndex = this.buffer.indexOf(ST, titleStart);

      let titleEnd = -1;
      let terminatorLength = 0;
      if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
        titleEnd = belIndex;
        terminatorLength = BEL.length;
      } else if (stIndex !== -1) {
        titleEnd = stIndex;
        terminatorLength = ST.length;
      }

      if (titleEnd === -1) {
        this.buffer = this.buffer.slice(start);
        if (this.buffer.length > MAX_TITLE_BUFFER_LENGTH) {
          this.buffer = "";
        }
        return titles;
      }

      titles.push(this.buffer.slice(titleStart, titleEnd));
      cursor = titleEnd + terminatorLength;
    }

    const remaining = this.buffer.slice(cursor);
    const partialStart = remaining.lastIndexOf(OSC_PREFIX);
    if (partialStart < 0) {
      this.buffer = remaining.endsWith(ESC) ? ESC : "";
      return titles;
    }

    this.buffer = remaining.slice(partialStart);
    if (this.buffer.length > MAX_TITLE_BUFFER_LENGTH) {
      this.buffer = "";
    }
    return titles;
  }

  /** Reset the internal buffer and decoder (on connect/disconnect). */
  reset(): void {
    this.buffer = "";
    this.decoder = new TextDecoder();
  }
}

/**
 * A single line in a terminal buffer, as exposed by ghostty-web's xterm.js
 * compatible `IBufferLine`. Only the members needed for plain-text extraction
 * are declared here so the extractor stays testable without a real terminal.
 */
export interface ExtractableBufferLine {
  /** Whether this line is a soft-wrap continuation of the previous line. */
  readonly isWrapped: boolean;
  /** Render the line to text. `trimRight` strips trailing whitespace cells. */
  translateToString(trimRight?: boolean): string;
}

/**
 * A terminal buffer (ghostty-web `IBuffer`). For the normal buffer, `length`
 * spans scrollback plus the active screen, and `getLine(0)` is the oldest
 * scrollback line.
 */
export interface ExtractableBuffer {
  readonly length: number;
  getLine(y: number): ExtractableBufferLine | undefined;
}

/**
 * Extract the buffer contents as plain text in display order.
 *
 * Soft-wrapped rows are rejoined into a single logical line so a long command
 * that wrapped across the terminal width comes back as one editable line.
 * Trailing whitespace is trimmed per logical line, and trailing blank lines are
 * dropped. An empty or whitespace-only buffer yields an empty string (which the
 * server turns into a valid empty temporary file).
 *
 * This only reads the buffer (`getLine`/`translateToString`); it never touches
 * selection or scroll state.
 */
export function extractBufferText(buffer: ExtractableBuffer): string {
  const logicalLines: string[] = [];
  let current: string | null = null;

  const pushCurrent = (): void => {
    if (current === null) return;
    logicalLines.push(current.replace(/[ \t]+$/u, ""));
  };

  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    const text = line ? line.translateToString(false) : "";
    const isWrapped = line?.isWrapped ?? false;

    if (isWrapped && current !== null) {
      current += text;
    } else {
      pushCurrent();
      current = text;
    }
  }
  pushCurrent();

  while (logicalLines.length > 0 && logicalLines[logicalLines.length - 1] === "") {
    logicalLines.pop();
  }

  if (logicalLines.length === 0) return "";
  return `${logicalLines.join("\n")}\n`;
}

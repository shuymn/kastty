export const DEFAULT_SCROLLBACK_LINES = 50000;
export const GHOSTTY_SCROLLBACK_BYTES_PER_LINE = 2048;
export const GHOSTTY_MIN_SCROLLBACK_BYTES = 1_000_000;
export const GHOSTTY_MAX_SCROLLBACK_BYTES = 1_000_000_000;

export function toGhosttyScrollbackBytes(lines: number): number {
  // ghostty-web v0.4.0 treats scrollback as an internal capacity value.
  const bytes = lines * GHOSTTY_SCROLLBACK_BYTES_PER_LINE;
  return Math.max(GHOSTTY_MIN_SCROLLBACK_BYTES, Math.min(GHOSTTY_MAX_SCROLLBACK_BYTES, bytes));
}

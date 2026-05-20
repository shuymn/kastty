import { describe, expect, test } from "bun:test";
import { DEFAULT_SCROLLBACK_LINES, toGhosttyScrollbackBytes } from "../config/scrollback.ts";
import { CliHelpError, CliParseError, parseCliArgs } from "./args.ts";

describe("parseCliArgs", () => {
  test("default invocation starts the default shell", () => {
    const opts = parseCliArgs([]);
    const defaultShell = process.env.SHELL || "/bin/sh";
    expect(opts.command).toBe(defaultShell);
    expect(opts.args).toEqual([]);
  });

  test("-- cmd args starts specified command", () => {
    const opts = parseCliArgs(["--", "vim", "file.txt"]);
    expect(opts.command).toBe("vim");
    expect(opts.args).toEqual(["file.txt"]);
  });

  test("--readonly sets initial readonly mode", () => {
    const opts = parseCliArgs(["--readonly"]);
    expect(opts.readonly).toBe(true);
  });

  test("--port 0 enables automatic port assignment", () => {
    const opts = parseCliArgs(["--port", "0"]);
    expect(opts.port).toBe(0);
  });

  test("--open=false is rejected", () => {
    expect(() => parseCliArgs(["--open=false"])).toThrow(CliParseError);
  });

  test("--no-open suppresses browser launch", () => {
    const opts = parseCliArgs(["--no-open"]);
    expect(opts.open).toBe(false);
  });

  test("defaults to open=true, readonly=false, port=0", () => {
    const opts = parseCliArgs([]);
    expect(opts.readonly).toBe(false);
    expect(opts.port).toBe(0);
    expect(opts.open).toBe(true);
  });

  test("--scrollback sets terminal scrollback lines", () => {
    const opts = parseCliArgs(["--scrollback", "120000"]);
    expect(opts.scrollback).toBe(120000);
  });

  test("defaults scrollback to configured constant", () => {
    const opts = parseCliArgs([]);
    expect(opts.scrollback).toBe(DEFAULT_SCROLLBACK_LINES);
  });

  test("--replay-buffer-bytes sets replay buffer size", () => {
    const opts = parseCliArgs(["--replay-buffer-bytes", "16777216"]);
    expect(opts.replayBufferBytes).toBe(16777216);
  });

  test("defaults replay buffer size from default scrollback", () => {
    const opts = parseCliArgs([]);
    expect(opts.replayBufferBytes).toBe(toGhosttyScrollbackBytes(DEFAULT_SCROLLBACK_LINES));
  });

  test("derives replay buffer size from --scrollback when replay option is omitted", () => {
    const opts = parseCliArgs(["--scrollback", "120000"]);
    expect(opts.replayBufferBytes).toBe(toGhosttyScrollbackBytes(120000));
  });

  test("prioritizes explicit --replay-buffer-bytes over derived value", () => {
    const opts = parseCliArgs(["--scrollback", "120000", "--replay-buffer-bytes", "16777216"]);
    expect(opts.replayBufferBytes).toBe(16777216);
  });

  test("--font-family sets terminal font family", () => {
    const opts = parseCliArgs(["--font-family", "JetBrains Mono"]);
    expect(opts.fontFamily).toBe("JetBrains Mono");
  });

  test("defaults to empty fontFamily", () => {
    const opts = parseCliArgs([]);
    expect(opts.fontFamily).toBe("");
  });

  test("--help throws CliHelpError with usage", () => {
    expect(() => parseCliArgs(["--help"])).toThrow(CliHelpError);

    try {
      parseCliArgs(["--help"]);
    } catch (error: unknown) {
      if (error instanceof CliHelpError) {
        expect(error.output).toContain("Usage: kastty [options] [-- command [args...]]");
      } else {
        throw error;
      }
    }
  });

  test("--version throws CliHelpError with version output", () => {
    expect(() => parseCliArgs(["--version"])).toThrow(CliHelpError);

    try {
      parseCliArgs(["--version"]);
    } catch (error: unknown) {
      if (error instanceof CliHelpError) {
        expect(error.output).toBe("dev+HEAD\n");
      } else {
        throw error;
      }
    }
  });

  test("--version includes short sha when KASTTY_SHORT_SHA is set", () => {
    const previous = process.env.KASTTY_SHORT_SHA;
    process.env.KASTTY_SHORT_SHA = "abcdef1234567890";

    try {
      expect(() => parseCliArgs(["--version"])).toThrow(CliHelpError);
      try {
        parseCliArgs(["--version"]);
      } catch (error: unknown) {
        if (error instanceof CliHelpError) {
          expect(error.output).toBe("dev+abcdef1\n");
        } else {
          throw error;
        }
      }
    } finally {
      if (previous === undefined) {
        delete process.env.KASTTY_SHORT_SHA;
      } else {
        process.env.KASTTY_SHORT_SHA = previous;
      }
    }
  });

  test("unknown leading option is rejected", () => {
    expect(() => parseCliArgs(["--totally-unknown-option"])).toThrow(CliParseError);
  });

  test("dashed arguments after -- are passed through as command args", () => {
    const opts = parseCliArgs(["--", "htop", "-d", "10"]);
    expect(opts.command).toBe("htop");
    expect(opts.args).toEqual(["-d", "10"]);
  });
});

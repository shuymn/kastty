import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "./args.ts";

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

  test("--open=false suppresses browser launch", () => {
    const opts = parseCliArgs(["--open=false"]);
    expect(opts.open).toBe(false);
  });

  test("defaults to open=true, readonly=false, port=0", () => {
    const opts = parseCliArgs([]);
    expect(opts.readonly).toBe(false);
    expect(opts.port).toBe(0);
    expect(opts.open).toBe(true);
  });
});

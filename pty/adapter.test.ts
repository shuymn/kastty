import { afterEach, describe, expect, it } from "bun:test";
import { BunPtyAdapter } from "./adapter.ts";

describe("BunPtyAdapter", () => {
  let adapter: BunPtyAdapter;

  afterEach(() => {
    adapter?.destroy();
  });

  it("starts with TERM=xterm-256color and initial size 80×24", async () => {
    adapter = new BunPtyAdapter();

    const output: string[] = [];
    const done = new Promise<void>((resolve) => {
      adapter.onExit(() => resolve());
    });
    adapter.onData((data: Uint8Array) => output.push(new TextDecoder().decode(data)));

    adapter.start("/bin/sh", ["-c", 'printf "TERM=%s\\n" "$TERM"; stty size']);

    await done;

    const text = output.join("");
    expect(text).toContain("TERM=xterm-256color");
    expect(text).toContain("24 80");
  });

  it("can be resized to arbitrary cols/rows", async () => {
    adapter = new BunPtyAdapter();

    const output: string[] = [];
    adapter.onData((data: Uint8Array) => output.push(new TextDecoder().decode(data)));

    adapter.start("/bin/sh", []);

    await Bun.sleep(500);

    adapter.resize(120, 40);
    await Bun.sleep(100);

    output.length = 0;
    adapter.write("stty size\n");
    await Bun.sleep(500);

    const text = output.join("");
    expect(text).toContain("40 120");
  });

  it("forwards written data to the spawned process", async () => {
    adapter = new BunPtyAdapter();

    const output: string[] = [];
    adapter.onData((data: Uint8Array) => output.push(new TextDecoder().decode(data)));

    adapter.start("/bin/sh", []);

    await Bun.sleep(500);
    output.length = 0;
    adapter.write("echo pty_write_test_marker\n");
    await Bun.sleep(500);

    const text = output.join("");
    expect(text).toContain("pty_write_test_marker");
  });

  it("emits PTY output via onData callback", async () => {
    adapter = new BunPtyAdapter();

    const output: string[] = [];
    const done = new Promise<void>((resolve) => {
      adapter.onExit(() => resolve());
    });
    adapter.onData((data: Uint8Array) => output.push(new TextDecoder().decode(data)));

    adapter.start("/bin/sh", ["-c", "echo pty_output_test_marker"]);

    await done;

    const text = output.join("");
    expect(text).toContain("pty_output_test_marker");
  });

  it("triggers exit callback with process exit code", async () => {
    adapter = new BunPtyAdapter();
    adapter.onData(() => {});

    const exitCode = await new Promise<number>((resolve) => {
      adapter.onExit((code: number) => resolve(code));
      adapter.start("/bin/sh", ["-c", "exit 42"]);
    });

    expect(exitCode).toBe(42);
  });
});

import { dirname, join } from "node:path";
import { ReplayBuffer } from "../buffer/replay-buffer.ts";
import { BunPtyAdapter, type PtyAdapter } from "../pty/adapter.ts";
import { generateToken } from "../security/token.ts";
import { createServer } from "../server/app.ts";
import { SessionManager } from "../session/session-manager.ts";
import homepage from "../web/index.html";
import type { CliOptions } from "./args.ts";

export interface ReadyInfo {
  url: string;
  port: number;
  token: string;
}

export interface RunDeps {
  createPty?: () => PtyAdapter;
  openBrowser?: (url: string) => Promise<void>;
  onReady?: (info: ReadyInfo) => void;
}

async function defaultOpenBrowser(url: string): Promise<void> {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
}

async function loadWasm(): Promise<ArrayBuffer> {
  const wasmPath = join(dirname(require.resolve("ghostty-web")), "ghostty-vt.wasm");
  return Bun.file(wasmPath).arrayBuffer();
}

function resolvePort(requested: number): number {
  if (requested !== 0) return requested;
  const tmp = Bun.serve({
    fetch: () => new Response(),
    port: 0,
    hostname: "127.0.0.1",
  });
  const assigned = tmp.port ?? 0;
  tmp.stop(true);
  return assigned;
}

export async function run(options: CliOptions, deps?: RunDeps): Promise<number> {
  const pty = deps?.createPty?.() ?? new BunPtyAdapter();
  const replayBuffer = new ReplayBuffer();
  const session = new SessionManager(pty, replayBuffer);
  const token = generateToken();

  if (options.readonly) {
    session.setReadonly(true);
  }

  const port = resolvePort(options.port);
  const wasmBuffer = await loadWasm();
  const { fetch: appFetch, websocket } = createServer({ session, token, port, wasmBuffer });

  const server = Bun.serve({
    routes: {
      "/": homepage,
    },
    fetch: appFetch,
    websocket,
    port,
    hostname: "127.0.0.1",
  });

  const actualPort = server.port ?? port;
  const params = new URLSearchParams({ t: token });
  if (options.fontFamily) {
    params.set("fontFamily", options.fontFamily);
  }
  const url = `http://127.0.0.1:${actualPort}/?${params}`;
  console.log(url);

  deps?.onReady?.({ url, port: actualPort, token });

  session.start(options.command, options.args);

  if (options.open) {
    const openFn = deps?.openBrowser ?? defaultOpenBrowser;
    await openFn(url);
  }

  const exitCode = await new Promise<number>((resolve) => {
    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      resolve(code);
    };

    session.onExit((code) => {
      server.stop();
      settle(code);
    });

    const handleSignal = () => {
      session.destroy();
      server.stop();
      settle(128 + 2);
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
  });

  return exitCode;
}

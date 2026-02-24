import { parseArgs } from "node:util";
import { DEFAULT_SCROLLBACK_LINES, toGhosttyScrollbackBytes } from "../config/scrollback.ts";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export interface CliOptions {
  command: string;
  args: string[];
  readonly: boolean;
  port: number;
  open: boolean;
  fontFamily: string;
  scrollback: number;
  replayBufferBytes: number;
}

function defaultShell(): string {
  return process.env.SHELL || "/bin/sh";
}

export function parseCliArgs(argv: string[]): CliOptions {
  let openOverride: boolean | undefined;
  const filtered: string[] = [];
  for (const arg of argv) {
    if (arg === "--open=false") {
      openOverride = false;
    } else if (arg === "--open=true" || arg === "--open") {
      openOverride = true;
    } else {
      filtered.push(arg);
    }
  }

  const { values, positionals } = parseArgs({
    args: filtered,
    options: {
      readonly: { type: "boolean", default: false },
      port: { type: "string", default: "0" },
      "font-family": { type: "string", default: "" },
      scrollback: { type: "string", default: String(DEFAULT_SCROLLBACK_LINES) },
      "replay-buffer-bytes": { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  let command: string;
  let commandArgs: string[];

  const first = positionals[0];
  if (first !== undefined) {
    command = first;
    commandArgs = positionals.slice(1);
  } else {
    command = defaultShell();
    commandArgs = [];
  }

  const scrollback = parsePositiveInt(values.scrollback as string, DEFAULT_SCROLLBACK_LINES);
  const replayBufferBytes = parsePositiveInt(
    values["replay-buffer-bytes"] as string | undefined,
    toGhosttyScrollbackBytes(scrollback),
  );

  return {
    command,
    args: commandArgs,
    readonly: Boolean(values.readonly),
    port: Number.parseInt(values.port as string, 10),
    open: openOverride ?? true,
    fontFamily: (values["font-family"] as string) || "",
    scrollback,
    replayBufferBytes,
  };
}

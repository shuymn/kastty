import { parseArgs } from "node:util";

export interface CliOptions {
  command: string;
  args: string[];
  readonly: boolean;
  port: number;
  open: boolean;
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

  return {
    command,
    args: commandArgs,
    readonly: Boolean(values.readonly),
    port: Number.parseInt(values.port as string, 10),
    open: openOverride ?? true,
  };
}

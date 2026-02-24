import { Command, CommanderError } from "commander";
import { DEFAULT_SCROLLBACK_LINES, toGhosttyScrollbackBytes } from "../config/scrollback.ts";

declare const KASTTY_VERSION: string | undefined;
declare const KASTTY_SHORT_SHA: string | undefined;

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

export class CliHelpError extends Error {
  output: string;
  exitCode: number;

  constructor(output: string, exitCode = 0) {
    super("CLI help displayed");
    this.name = "CliHelpError";
    this.output = output;
    this.exitCode = exitCode;
  }
}

export class CliParseError extends Error {
  output: string;
  exitCode: number;

  constructor(output: string, exitCode = 1) {
    super("CLI parse failed");
    this.name = "CliParseError";
    this.output = output;
    this.exitCode = exitCode;
  }
}

function defaultShell(): string {
  return process.env.SHELL || "/bin/sh";
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

function toShortSha(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const short = value.slice(0, 7);
  if (!/^[0-9a-fA-F]{7}$/.test(short)) return undefined;
  return short.toLowerCase();
}

function cliVersion(): string {
  const buildVersion = typeof KASTTY_VERSION !== "undefined" ? KASTTY_VERSION : undefined;
  const buildShortSha = typeof KASTTY_SHORT_SHA !== "undefined" ? KASTTY_SHORT_SHA : undefined;
  const version = firstNonEmpty([buildVersion, process.env.KASTTY_VERSION]) ?? "dev";
  const shortSha = toShortSha(firstNonEmpty([buildShortSha, process.env.KASTTY_SHORT_SHA]));
  if (shortSha !== undefined) {
    const separator = version.includes("+") ? "." : "+";
    return `${version}${separator}${shortSha}`;
  }
  if (version === "dev") return "dev+HEAD";
  return version;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let stdout = "";
  let stderr = "";
  const version = cliVersion();
  const program = new Command();
  program
    .name("kastty")
    .usage("[options] [-- command [args...]]")
    .description("Browser-based terminal sharing tool")
    .showHelpAfterError()
    .allowExcessArguments(true)
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        stdout += str;
      },
      writeErr: (str) => {
        stderr += str;
      },
    })
    .argument("[command]", "Command to run in PTY")
    .argument("[args...]", "Arguments for the command")
    .option("--readonly", "Start in readonly mode", false)
    .option("--port <n>", "Port to listen on (0 for auto)", "0")
    .option("--font-family <name>", "Terminal font family", "")
    .option("--scrollback <lines>", "Terminal scrollback lines", String(DEFAULT_SCROLLBACK_LINES))
    .option("--replay-buffer-bytes <n>", "Replay buffer size in bytes")
    .option("--open", "Auto-open browser")
    .option("--no-open", "Disable browser auto-open")
    .version(version);

  try {
    program.parse(argv, { from: "user" });
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        throw new CliHelpError(stdout || stderr, error.exitCode);
      }
      throw new CliParseError(stderr || error.message, error.exitCode);
    }
    throw error;
  }

  const parsed = program.opts<Record<string, string | boolean | undefined>>();
  const [positionalCommand, positionalArgs] = program.processedArgs as [string | undefined, string[] | undefined];

  let command: string;
  let commandArgs: string[];

  const first = positionalCommand;
  if (first !== undefined) {
    command = first;
    commandArgs = positionalArgs ?? [];
  } else {
    command = defaultShell();
    commandArgs = [];
  }

  const scrollback = parsePositiveInt(parsed.scrollback as string, DEFAULT_SCROLLBACK_LINES);
  const replayBufferBytes = parsePositiveInt(
    parsed.replayBufferBytes as string | undefined,
    toGhosttyScrollbackBytes(scrollback),
  );

  return {
    command,
    args: commandArgs,
    readonly: Boolean(parsed.readonly),
    port: Number.parseInt(parsed.port as string, 10),
    open: (parsed.open as boolean | undefined) ?? true,
    fontFamily: (parsed.fontFamily as string) || "",
    scrollback,
    replayBufferBytes,
  };
}

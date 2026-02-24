import { CliHelpError, type CliOptions, CliParseError, parseCliArgs } from "./cli/args.ts";
import { run } from "./cli/run.ts";

function parseCliArgsOrExit(argv: string[]): CliOptions {
  try {
    return parseCliArgs(argv);
  } catch (error: unknown) {
    if (error instanceof CliHelpError) {
      process.stdout.write(error.output);
      process.exit(error.exitCode);
    }
    if (error instanceof CliParseError) {
      process.stderr.write(error.output);
      process.exit(error.exitCode);
    }
    throw error;
  }
}

const options = parseCliArgsOrExit(process.argv.slice(2));

const exitCode = await run(options);
process.exit(exitCode);

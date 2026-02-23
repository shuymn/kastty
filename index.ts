import { parseCliArgs } from "./cli/args.ts";
import { run } from "./cli/run.ts";

const options = parseCliArgs(process.argv.slice(2));
const exitCode = await run(options);
process.exit(exitCode);

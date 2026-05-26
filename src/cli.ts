import { parseArgs } from "util";

const VERSION = "0.2.0";

const HELP = `naiou - OpenTUI yes/no oracle

Usage: naiou [options]

Options:
  -h, --help       Show this help
  -v, --version    Show version

Examples:
  naiou            Launch the oracle`;

export interface CliResult {
  command: "tui" | "help" | "version";
}

export function parseCli(argv: string[]): CliResult {
  let values: { help?: boolean; version?: boolean };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: argv.slice(2),
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}\n\nRun 'naiou --help' for usage.`);
    process.exit(1);
  }

  if (values.help) return { command: "help" };
  if (values.version) return { command: "version" };

  if (positionals.length > 0) {
    console.error(`Unknown command: ${positionals[0]}\n\nRun 'naiou --help' for usage.`);
    process.exit(1);
  }

  return { command: "tui" };
}

export function runCli(cli: CliResult): void {
  switch (cli.command) {
    case "help":
      console.log(HELP);
      return;
    case "version":
      console.log(VERSION);
      return;
    case "tui":
      return;
  }
}

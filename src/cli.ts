import { parseArgs } from "util";

import { ensureOpenAIConfigured } from "./agent.js";
import { runApp } from "./app.js";

const VERSION = "0.3.1";

const HELP = `naiou - OpenTUI yes/no oracle

Usage: naiou [options]

Options:
  -h, --help       Show this help
  -v, --version    Show version
  -d, --debug      Show agent reasoning and raw response at the top (debug mode)

Examples:
  naiou            Launch the oracle
  naiou --debug    Launch with full agent trace visible`;

export interface CliResult {
  command: "tui" | "help" | "version";
  debug?: boolean;
}

export function parseCli(argv: string[]): CliResult {
  let values: { help?: boolean; version?: boolean; debug?: boolean };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: argv.slice(2),
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        debug: { type: "boolean", short: "d", default: false },
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

  return { command: "tui", debug: values.debug };
}

export async function runCli(cli: CliResult): Promise<void> {
  switch (cli.command) {
    case "help":
      console.log(HELP);
      return;
    case "version":
      console.log(VERSION);
      return;
    case "tui":
      ensureOpenAIConfigured();
      await runApp(cli.debug);
      return;
  }
}

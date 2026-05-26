#!/usr/bin/env bun

import { runApp } from "./app.js";
import { parseCli, runCli } from "./cli.js";
import { ensureOpenAIConfigured } from "./agent.js";

const cli = parseCli(process.argv);

switch (cli.command) {
  case "tui":
    ensureOpenAIConfigured();
    await runApp(cli.debug);
    break;
  case "help":
  case "version":
    runCli(cli);
    break;
}

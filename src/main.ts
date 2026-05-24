#!/usr/bin/env bun

import { runApp } from "./app.js";
import { parseCli, runCli } from "./cli.js";

const cli = parseCli(process.argv);

switch (cli.command) {
  case "tui":
    await runApp();
    break;
  case "help":
  case "version":
    runCli(cli);
    break;
}

#!/usr/bin/env bun

import { parseCli, runCli } from "./cli.js";

const cli = parseCli(process.argv);
await runCli(cli);

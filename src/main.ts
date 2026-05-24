#!/usr/bin/env bun

import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { parseCli, runCli } from "./cli.js";
import { hex } from "./theme.js";

async function runOracle(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    targetFps: 30,
    backgroundColor: hex.background,
  });

  renderer.start();

  const root = new BoxRenderable(renderer, {
    id: "naiou-root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: hex.background,
  });

  const title = new TextRenderable(renderer, {
    id: "naiou-title",
    content: "NAIOU",
    fg: hex.star,
    marginBottom: 1,
  });

  const prompt = new TextRenderable(renderer, {
    id: "naiou-prompt",
    content: "Ask a yes/no question",
    fg: hex.muted,
    marginBottom: 1,
  });

  const input = new TextRenderable(renderer, {
    id: "naiou-input",
    content: "> ",
    fg: hex.text,
  });

  const footer = new TextRenderable(renderer, {
    id: "naiou-footer",
    content: "Enter: decide | Ctrl+C: quit",
    fg: hex.muted,
    marginTop: 2,
  });

  root.add(title);
  root.add(prompt);
  root.add(input);
  root.add(footer);
  renderer.root.add(root);

  let question = "";

  const redraw = () => {
    input.content = `> ${question}`;
    renderer.requestRender();
  };

  const onKey = (key: KeyEvent) => {
    if (key.name === "return") {
      prompt.content = "The oracle is still forming.";
      prompt.fg = hex.starWarm;
      footer.content = "Agent and hyperspace phases are wired in later batches.";
      renderer.requestRender();
      return;
    }

    if (key.name === "backspace") {
      question = question.slice(0, -1);
      redraw();
      return;
    }

    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      question += key.sequence;
      redraw();
    }
  };

  renderer.keyInput.on("keypress", onKey);
}

const cli = parseCli(process.argv);

switch (cli.command) {
  case "tui":
    await runOracle();
    break;
  case "help":
  case "version":
    runCli(cli);
    break;
}

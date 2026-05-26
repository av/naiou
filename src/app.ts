import { createCliRenderer, type KeyEvent } from "@opentui/core";
import { askOracle, type OracleResult } from "./agent.js";
import { createHyperspace, type Decision } from "./hyperspace.js";
import { hex } from "./theme.js";

type AppMode = "input" | "processing" | "final";

export async function runApp(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    targetFps: 30,
    backgroundColor: hex.background,
  });
  const hyperspace = await createHyperspace(renderer);

  let question = "";
  let mode: AppMode = "input";
  let finalPoll: Timer | null = null;

  const syncQuestion = () => {
    hyperspace.setQuestion(question);
    renderer.requestRender();
  };

  const cleanup = () => {
    renderer.keyInput.off("keypress", onKey);
    if (finalPoll) clearInterval(finalPoll);
    hyperspace.cleanup();
  };

  const reset = () => {
    if (finalPoll) clearInterval(finalPoll);
    finalPoll = null;
    question = "";
    mode = "input";
    hyperspace.setDebug("");
    hyperspace.reset();
    syncQuestion();
  };

  const waitForFinal = () => {
    finalPoll = setInterval(() => {
      if (hyperspace.getPhase() !== "final") return;
      if (finalPoll) clearInterval(finalPoll);
      finalPoll = null;
      mode = "final";
    }, 50);
  };

  const finish = (result: OracleResult) => {
    const decision: Decision = result.decision;
    const label = decision;

    hyperspace.setDebug(result.reasoning || result.raw || "");
    hyperspace.resolveDecision(decision, label);
    waitForFinal();
  };

  const submit = () => {
    if (mode !== "input" || question.trim().length === 0) return;
    mode = "processing";
    hyperspace.setDebug("");
    hyperspace.setStatus("processing");
    hyperspace.startProcessing();
    void askOracle(question, {
      status(message) {
        hyperspace.setStatus(message);
        if (message === "deciding") hyperspace.startDeciding();
      },
    })
      .then(finish)
      .catch((error) => {
        hyperspace.setStatus(error instanceof Error ? error.message : "oracle error");
        finish({ type: "decision", decision: "No" });
      });
  };

  function onKey(key: KeyEvent) {
    if (key.name === "escape") {
      cleanup();
      renderer.destroy();
      process.exit(0);
    }

    if (mode === "final" && (key.name === "return" || key.name === "enter")) {
      reset();
      return;
    }

    if (mode !== "input") return;

    if (key.name === "return" || key.name === "enter") {
      submit();
      return;
    }

    if (key.name === "backspace") {
      question = question.slice(0, -1);
      syncQuestion();
      return;
    }

    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      question += key.sequence;
      syncQuestion();
    }
  }

  renderer.keyInput.on("keypress", onKey);
  syncQuestion();
}

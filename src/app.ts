import {
  Box,
  createCliRenderer,
  engine,
  type BoxRenderable,
  type KeyEvent,
  type OptimizedBuffer,
  type RGBA,
} from "@opentui/core";
import { drawAsciiText, renderAsciiText } from "./ascii.js";
import { askOracle, type OracleResult } from "./agent.js";
import { createHyperspace, type Decision, type HyperspaceController, type HyperspacePhase } from "./hyperspace.js";
import { colors, hex } from "./theme.js";

type AppMode = "input" | "processing" | "final";

function drawCenteredLine(buffer: OptimizedBuffer, text: string, y: number, fg: RGBA, bg: RGBA) {
  const x = Math.max(0, Math.floor((buffer.width - text.length) / 2));
  for (let i = 0; i < text.length && x + i < buffer.width; i++) {
    buffer.setCell(x + i, y, text[i]!, fg, bg);
  }
}

function noise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;

  return x - Math.floor(x);
}

function drawBackdrop(buffer: OptimizedBuffer, mode: AppMode, tintDecision: Decision | null, now: number, bg: RGBA) {
  const width = buffer.width;
  const height = buffer.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const processing = mode === "processing";
  const speed = processing ? now / 26 : now / 140;
  const tint = tintDecision ? (tintDecision === "Yes" ? colors.yes : colors.no) : colors.starCool;
  const count = Math.max(80, Math.min(280, Math.floor((width * height) / 28)));

  for (let i = 0; i < count; i++) {
    const sx = noise(i * 3 + 1);
    const sy = noise(i * 5 + 2);
    const depth = 0.25 + noise(i * 7 + 3) * 0.75;
    let x = Math.floor((sx * width + speed * depth) % width);
    let y = Math.floor((sy * height + (processing ? speed * 0.14 * depth : 0)) % height);
    let ch = noise(i * 11) > 0.82 ? "*" : ".";
    let fg = noise(i * 13) > 0.72 ? colors.starWarm : colors.star;

    if (processing) {
      const dx = x - centerX;
      const dy = y - centerY;
      x = Math.floor(centerX + dx * (1 + depth * 0.9));
      y = Math.floor(centerY + dy * (1 + depth * 0.45));
      ch = Math.abs(dx) > Math.abs(dy) * 2 ? "-" : Math.abs(dy) > Math.abs(dx) ? "|" : dx * dy > 0 ? "\\" : "/";
      fg = tintDecision ? tint : colors.starCool;
    }

    if (x >= 0 && x < width && y >= 0 && y < height) {
      buffer.setCell(x, y, ch, fg, bg);
    }
  }
}

function drawPlanet(buffer: OptimizedBuffer, text: string, tintDecision: Decision, scale: number, fg: RGBA, bg: RGBA) {
  const maxRadius = Math.max(3, Math.floor(Math.min(buffer.width, buffer.height) * 0.16));
  const radius = Math.max(1, Math.floor(maxRadius * scale));
  const cx = Math.floor(buffer.width / 2);
  const cy = Math.floor(buffer.height / 2);
  const light = tintDecision === "Yes" ? colors.yes : colors.no;
  const shadeChars = " .:-=+*#%@";

  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius * 2; x <= radius * 2; x++) {
      const nx = x / 2;
      const d = Math.sqrt(nx * nx + y * y);
      if (d > radius) continue;
      const highlight = Math.max(0, 1 - Math.sqrt((nx + radius * 0.35) ** 2 + (y + radius * 0.35) ** 2) / radius);
      const limb = 1 - d / radius;
      const shade = Math.max(0, Math.min(1, limb * 0.75 + highlight * 0.55 + (x < 0 ? 0.08 : -0.08)));
      const ch = shadeChars[Math.max(0, Math.min(shadeChars.length - 1, Math.floor(shade * (shadeChars.length - 1))))]!;
      buffer.setCell(cx + x, cy + y, ch, light, bg);
    }
  }

  const art = renderAsciiText(text, Math.max(4, radius * 4 - 2), Math.max(5, radius * 2 - 1));
  drawAsciiText(
    buffer,
    art,
    Math.max(0, cx - Math.floor(art.width / 2)),
    Math.max(0, cy - Math.floor(art.height / 2)),
    fg,
    bg,
  );
}

function createFallbackHyperspace(): HyperspaceController {
  let phase: HyperspacePhase = "idle";

  return {
    startProcessing() {
      phase = "cruise";
    },
    resolveDecision() {
      phase = "tint";
      setTimeout(() => {
        phase = "final";
      }, 1200);
    },
    reset() {
      phase = "idle";
    },
    getPhase() {
      return phase;
    },
    cleanup() {},
  };
}

export async function runApp(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    targetFps: 60,
    backgroundColor: hex.background,
  });
  engine.attach(renderer);
  renderer.start();

  const hyperspace = await createHyperspace(renderer).catch(() => createFallbackHyperspace());
  let question = "";
  let mode: AppMode = "input";
  let decision: Decision | null = null;
  let finalText = "";
  let status = "processing";
  let processingStarted = 0;
  let finalStarted = 0;
  let finalPoll: Timer | null = null;

  const root = Box({
    id: "naiou-root",
    width: "100%",
    height: "100%",
    backgroundColor: hex.background,
    live: true,
    renderAfter(this: BoxRenderable, buffer: OptimizedBuffer) {
      const now = Date.now();
      const centralWidth = Math.max(12, Math.floor(this.width * 0.7));
      const centralHeight = Math.max(6, Math.floor(this.height * 0.7));
      const cursorVisible = mode === "input" && Math.floor(now / 480) % 2 === 0;
      const rendered = renderAsciiText(question || "ASK", centralWidth, centralHeight);
      const startX = this.screenX + Math.max(0, Math.floor((this.width - rendered.width) / 2));
      const startY = this.screenY + Math.max(1, Math.floor((this.height - rendered.height) / 2));

      drawBackdrop(buffer, mode, mode === "processing" ? decision : null, now, colors.bg);
      drawAsciiText(buffer, rendered, startX, startY, mode === "final" ? colors.textDim : colors.text, colors.bg);

      if (cursorVisible) {
        const cursor = renderAsciiText("_", 4, 5);
        const cursorY = startY + Math.max(0, rendered.height - cursor.height);
        drawAsciiText(buffer, cursor, startX + rendered.width + 1, cursorY, colors.text, colors.bg);
      }

      if (mode === "input") {
        drawCenteredLine(buffer, "type a yes/no question, enter to ask", this.screenY + this.height - 2, colors.muted, colors.bg);
      }

      if (mode === "processing") {
        const seconds = ((now - processingStarted) / 1000).toFixed(1);
        drawCenteredLine(buffer, `${status} ${seconds}s`, this.screenY, colors.muted, colors.bg);
      }

      if (mode === "final" && decision) {
        const t = Math.min(1, (now - finalStarted) / 900);
        const eased = 1 - (1 - t) * (1 - t);
        drawPlanet(buffer, finalText, decision, eased, colors.text, colors.bg);
        drawCenteredLine(buffer, "enter to ask again, esc to quit", this.screenY + this.height - 2, colors.muted, colors.bg);
      }
    },
  });
  renderer.root.add(root);

  const cleanup = () => {
    renderer.keyInput.off("keypress", onKey);
    renderer.off("resize", onResize);
    if (finalPoll) clearInterval(finalPoll);
    hyperspace.cleanup();
  };

  const reset = () => {
    if (finalPoll) clearInterval(finalPoll);
    finalPoll = null;
    question = "";
    mode = "input";
    decision = null;
    finalText = "";
    status = "processing";
    processingStarted = 0;
    finalStarted = 0;
    hyperspace.reset();
    renderer.requestRender();
  };

  const finish = (result: OracleResult, hyper: HyperspaceController) => {
    decision = result.type === "decision" ? result.decision : "No";
    finalText = result.type === "decision" ? result.decision : "YES/NO?";
    if (result.type === "refusal") status = result.message;
    hyper.resolveDecision(decision);
    finalPoll = setInterval(() => {
      if (hyper.getPhase() !== "final") return;
      if (finalPoll) clearInterval(finalPoll);
      finalPoll = null;
      mode = "final";
      finalStarted = Date.now();
      renderer.requestRender();
    }, 50);
  };

  const submit = () => {
    if (mode !== "input" || question.trim().length === 0) return;
    mode = "processing";
    status = "processing";
    processingStarted = Date.now();
    hyperspace.startProcessing();
    renderer.requestRender();
    void askOracle(question, {
      status(message) {
        status = message;
        renderer.requestRender();
      },
    }).then((result) => finish(result, hyperspace)).catch(() => finish({ type: "decision", decision: "No" }, hyperspace));
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
      renderer.requestRender();
      return;
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      question += key.sequence;
      renderer.requestRender();
    }
  }

  function onResize() {
    renderer.requestRender();
  }

  renderer.keyInput.on("keypress", onKey);
  renderer.on("resize", onResize);
}

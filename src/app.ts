import {
  Box,
  createCliRenderer,
  engine,
  RGBA,
  type BoxRenderable,
  type KeyEvent,
  type OptimizedBuffer,
} from "@opentui/core";
import { drawAsciiText, renderAsciiText } from "./ascii.js";
import { askOracle } from "./agent.js";
import { createHyperspace, type Decision, type HyperspaceController } from "./hyperspace.js";
import { colors, hex } from "./theme.js";

type AppMode = "input" | "processing" | "final";

function drawCenteredLine(buffer: OptimizedBuffer, text: string, y: number, fg: RGBA, bg: RGBA) {
  const x = Math.max(0, Math.floor((buffer.width - text.length) / 2));
  for (let i = 0; i < text.length && x + i < buffer.width; i++) {
    buffer.setCell(x + i, y, text[i]!, fg, bg);
  }
}

function drawPlanet(buffer: OptimizedBuffer, decision: Decision, scale: number, fg: RGBA, bg: RGBA) {
  const maxRadius = Math.max(3, Math.floor(Math.min(buffer.width, buffer.height) * 0.16));
  const radius = Math.max(1, Math.floor(maxRadius * scale));
  const cx = Math.floor(buffer.width / 2);
  const cy = Math.floor(buffer.height / 2);
  const light = decision === "Yes" ? colors.yes : colors.no;
  const shade = RGBA.fromHex(decision === "Yes" ? "#14532D" : "#7F1D1D");

  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius * 2; x <= radius * 2; x++) {
      const nx = x / 2;
      const d = Math.sqrt(nx * nx + y * y);
      if (d > radius) continue;
      const tone = x < -radius * 0.35 || y > radius * 0.45 ? shade : light;
      buffer.setCell(cx + x, cy + y, "█", tone, tone);
    }
  }

  drawCenteredLine(buffer, decision, cy, fg, bg);
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

  const hyperspace = await createHyperspace(renderer);
  let question = "";
  let mode: AppMode = "input";
  let decision: Decision | null = null;
  let status = "processing";
  let processingStarted = 0;
  let finalStarted = 0;

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
      const rendered = renderAsciiText(`${question || "ASK"}${cursorVisible ? "_" : ""}`, centralWidth, centralHeight);
      const startX = this.screenX + Math.max(0, Math.floor((this.width - rendered.width) / 2));
      const startY = this.screenY + Math.max(1, Math.floor((this.height - rendered.height) / 2));

      drawAsciiText(buffer, rendered, startX, startY, mode === "final" ? colors.textDim : colors.text, colors.bg);

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
        drawPlanet(buffer, decision, eased, colors.text, colors.bg);
      }
    },
  });
  renderer.root.add(root);

  const cleanup = () => {
    renderer.keyInput.off("keypress", onKey);
    renderer.off("resize", onResize);
    hyperspace.cleanup();
  };

  const finish = (nextDecision: Decision, hyper: HyperspaceController) => {
    decision = nextDecision;
    hyper.resolveDecision(nextDecision);
    const checkFinal = setInterval(() => {
      if (hyper.getPhase() !== "final") return;
      clearInterval(checkFinal);
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
    }).then((result) => finish(result, hyperspace)).catch(() => finish("No", hyperspace));
  };

  function onKey(key: KeyEvent) {
    if (key.name === "escape") {
      cleanup();
      renderer.destroy();
      process.exit(0);
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

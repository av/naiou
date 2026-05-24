import { ThreeCliRenderer, THREE } from "@opentui/three";
import type * as ThreeCore from "three/src/Three.js";
import { RGBA, type CliRenderer, type KeyEvent } from "@opentui/core";
import { renderAsciiText, type AsciiArt } from "./ascii.js";
import { hex } from "./theme.js";

const Three = THREE as unknown as typeof ThreeCore;
const {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
} = Three;

type ThreeGroup = InstanceType<typeof Three.Group>;
type ThreePerspectiveCamera = InstanceType<typeof Three.PerspectiveCamera>;
type ThreeFloat32BufferAttribute = InstanceType<typeof Three.Float32BufferAttribute>;

export type Decision = "Yes" | "No";
export type HyperspacePhase = "idle" | "spool" | "punch" | "cruise" | "tint" | "decel" | "exit" | "final";

const STAR_COUNT = 12000;
const STAR_RADIUS = 25;
const STREAK_DZ = 0.3;
const SPOOL_DUR = 2.5;
const PUNCH_DUR = 2.0;
const TINT_DUR = 1.2;
const DECEL_DUR = 2.5;
const EXIT_DUR = 2.0;
const HUD_Z = -10;
const STATUS_Z = -8;
const PLANET_Z = -12;
const TEXT_CELL_FILL = 1.04;
const PLANET_CELL_FILL = 1.02;

interface Starfield extends ThreeGroup {
  baseLineColors: Float32Array;
  baseDotColors: Float32Array;
  lineColors: ThreeFloat32BufferAttribute;
  dotColors: ThreeFloat32BufferAttribute;
}

type SceneText = {
  group: ThreeGroup;
  key: string;
  dispose(): void;
  set(text: string, options: TextOptions): void;
};

type TextOptions = {
  maxColumns: number;
  maxRows: number;
  cellSize: number;
  color: string;
  align?: "center" | "left";
  x: number;
  y: number;
  z: number;
};

type Planet = {
  group: ThreeGroup;
  key: string;
  dispose(): void;
  set(label: string, decision: Decision, scale: number, x: number, y: number, z: number): void;
};

function hexRgb(color: string): [number, number, number] {
  return [
    parseInt(color.slice(1, 3), 16) / 255,
    parseInt(color.slice(3, 5), 16) / 255,
    parseInt(color.slice(5, 7), 16) / 255,
  ];
}

function mixColors(target: Float32Array, base: Float32Array, tint: [number, number, number] | null, amount: number) {
  for (let i = 0; i < base.length; i += 3) {
    target[i] = tint ? base[i]! * (1 - amount) + tint[0] * amount : base[i]!;
    target[i + 1] = tint ? base[i + 1]! * (1 - amount) + tint[1] * amount : base[i + 1]!;
    target[i + 2] = tint ? base[i + 2]! * (1 - amount) + tint[2] * amount : base[i + 2]!;
  }
}

function visibleSize(camera: ThreePerspectiveCamera, distance: number) {
  const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;

  return { width: height * camera.aspect, height };
}

function makeMaterial(color: string) {
  return new MeshBasicMaterial({
    color,
    transparent: false,
    opacity: 1,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  });
}

function disposeGroup(group: ThreeGroup) {
  const geometries = new Set<object>();
  const materials = new Set<object>();

  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof Mesh) {
      if (!geometries.has(child.geometry)) {
        geometries.add(child.geometry);
        child.geometry.dispose();
      }
      if (Array.isArray(child.material)) {
        for (const material of child.material) {
          if (materials.has(material)) continue;
          materials.add(material);
          material.dispose();
        }
      } else if (!materials.has(child.material)) {
        materials.add(child.material);
        child.material.dispose();
      }
    } else if (child instanceof Group) {
      disposeGroup(child);
    }
  }
}

function createSceneText(parent: ThreeGroup): SceneText {
  const group = new Group();
  parent.add(group);

  return {
    group,
    key: "",
    dispose() {
      disposeGroup(group);
      parent.remove(group);
    },
    set(text, options) {
      const key = JSON.stringify({ text, ...options });
      if (key === this.key) return;
      this.key = key;
      disposeGroup(group);

      const art = renderAsciiText(text, options.maxColumns, options.maxRows);
      const material = makeMaterial(options.color);
      const geometry = new PlaneGeometry(options.cellSize * TEXT_CELL_FILL, options.cellSize * TEXT_CELL_FILL);
      const startX = options.align === "left" ? 0 : -((art.width - 1) * options.cellSize) / 2;
      const startY = ((art.height - 1) * options.cellSize) / 2;

      group.position.set(options.x, options.y, options.z);

      for (let row = 0; row < art.lines.length; row++) {
        const line = art.lines[row]!;
        for (let col = 0; col < line.length; col++) {
          if (line[col] === " ") continue;
          const mesh = new Mesh(geometry, material);
          mesh.renderOrder = 1000;
          mesh.position.set(startX + col * options.cellSize, startY - row * options.cellSize, 0);
          group.add(mesh);
        }
      }
    },
  };
}

function createPlanet(parent: ThreeGroup): Planet {
  const group = new Group();
  parent.add(group);

  return {
    group,
    key: "",
    dispose() {
      disposeGroup(group);
      parent.remove(group);
    },
    set(label, decision, scale, x, y, z) {
      group.position.set(x, y, z);
      group.scale.setScalar(Math.max(0.05, scale));
      const key = `${label}:${decision}:${x.toFixed(2)}:${y.toFixed(2)}:${z.toFixed(2)}`;
      if (key === this.key) return;
      this.key = key;
      disposeGroup(group);

      const rows = buildPlanetRows(decision);
      const cell = 0.095;
      const geometry = new PlaneGeometry(cell * PLANET_CELL_FILL, cell * PLANET_CELL_FILL);
      const startX = -((rows[0]!.length - 1) * cell) / 2;
      const startY = ((rows.length - 1) * cell) / 2;
      const materials = planetMaterials(decision);

      for (let row = 0; row < rows.length; row++) {
        const line = rows[row]!;
        for (let col = 0; col < line.length; col++) {
          const shade = line[col]!;
          if (shade === " ") continue;
          const mesh = new Mesh(geometry, materials[shadeIndex(shade)]!);
          mesh.renderOrder = 1000;
          mesh.position.set(startX + col * cell, startY - row * cell, 0);
          group.add(mesh);
        }
      }

      const art = buildTextMeshes(renderAsciiText(label, 24, 7), 0.16, "#E5E7EB");
      art.position.set(0, 0, 0.03);
      group.add(art);
    },
  };
}

function buildPlanetRows(decision: Decision): string[] {
  const columns = 45;
  const rows = 21;
  const shades = " .:-=+*#%@";
  const lines: string[] = [];
  const lightX = -0.48;
  const lightY = -0.58;
  const lightZ = 0.66;

  for (let row = 0; row < rows; row++) {
    let line = "";
    const y = (row - (rows - 1) / 2) / ((rows - 1) / 2);
    for (let col = 0; col < columns; col++) {
      const x = (col - (columns - 1) / 2) / ((columns - 1) / 2);
      const d = x * x + y * y;
      if (d > 1) {
        line += " ";
        continue;
      }

      const z = Math.sqrt(Math.max(0, 1 - d));
      const diffuse = Math.max(0, x * lightX + y * lightY + z * lightZ);
      const rim = Math.max(0, 1 - Math.sqrt(d));
      const band = 0.08 * Math.sin((x * 7 + y * 2) * Math.PI);
      const answerGlow = decision === "Yes" ? 0.05 : 0.02;
      const brightness = Math.max(0, Math.min(1, diffuse * 0.72 + rim * 0.34 + band + answerGlow));
      line += shades[Math.max(1, Math.min(shades.length - 1, Math.floor(brightness * (shades.length - 1))))]!;
    }
    lines.push(line);
  }

  return lines;
}

function shadeIndex(shade: string) {
  return Math.max(0, " .:-=+*#%@".indexOf(shade));
}

function planetMaterials(decision: Decision) {
  const yes = ["#062A1A", "#0B3F27", "#14532D", "#166534", "#15803D", "#22C55E", "#4ADE80", "#86EFAC", "#BBF7D0", "#F0FDF4"];
  const no = ["#310B0B", "#450A0A", "#7F1D1D", "#991B1B", "#B91C1C", "#DC2626", "#EF4444", "#F87171", "#FCA5A5", "#FEF2F2"];

  return (decision === "Yes" ? yes : no).map((color) => makeMaterial(color));
}

function buildTextMeshes(art: AsciiArt, cellSize: number, color: string): ThreeGroup {
  const group = new Group();
  const geometry = new PlaneGeometry(cellSize * TEXT_CELL_FILL, cellSize * TEXT_CELL_FILL);
  const material = makeMaterial(color);
  const startX = -((art.width - 1) * cellSize) / 2;
  const startY = ((art.height - 1) * cellSize) / 2;

  for (let row = 0; row < art.lines.length; row++) {
    const line = art.lines[row]!;
    for (let col = 0; col < line.length; col++) {
      if (line[col] === " ") continue;
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = 1001;
      mesh.position.set(startX + col * cellSize, startY - row * cellSize, 0);
      group.add(mesh);
    }
  }

  return group;
}

export function createStarfield(): Starfield {
  const group = new Group() as Starfield;
  const linePositions = new Float32Array(STAR_COUNT * 2 * 3);
  const lineColors = new Float32Array(STAR_COUNT * 2 * 3);
  const dotPositions = new Float32Array(STAR_COUNT * 3);
  const dotColors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = STAR_RADIUS * (0.3 + Math.random() * 0.7);
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = radius * Math.cos(phi);
    const brightness = Math.random() ** 2 * 0.9 + 0.1;
    const temp = Math.random();
    const cr = temp < 0.2 ? brightness : temp < 0.4 ? brightness * 0.6 : brightness;
    const cg = temp < 0.2 ? brightness * 0.85 : temp < 0.4 ? brightness * 0.8 : brightness;
    const cb = temp < 0.2 ? brightness * 0.6 : brightness;

    const head = i * 2 * 3;
    linePositions[head] = x;
    linePositions[head + 1] = y;
    linePositions[head + 2] = z;
    lineColors[head] = cr;
    lineColors[head + 1] = cg;
    lineColors[head + 2] = cb;

    const tail = (i * 2 + 1) * 3;
    linePositions[tail] = x;
    linePositions[tail + 1] = y;
    linePositions[tail + 2] = z - STREAK_DZ;
    lineColors[tail] = cr * 0.2;
    lineColors[tail + 1] = cg * 0.3;
    lineColors[tail + 2] = Math.min(1, cb * 1.4) * 0.5;

    dotPositions[i * 3] = x;
    dotPositions[i * 3 + 1] = y;
    dotPositions[i * 3 + 2] = z;
    dotColors[i * 3] = cr;
    dotColors[i * 3 + 1] = cg;
    dotColors[i * 3 + 2] = cb;
  }

  const lineGeometry = new BufferGeometry();
  const lineColorAttr = new Float32BufferAttribute(lineColors, 3);
  lineGeometry.setAttribute("position", new Float32BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute("color", lineColorAttr);
  group.add(new LineSegments(lineGeometry, new LineBasicMaterial({
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })));

  const dotGeometry = new BufferGeometry();
  const dotColorAttr = new Float32BufferAttribute(dotColors, 3);
  dotGeometry.setAttribute("position", new Float32BufferAttribute(dotPositions, 3));
  dotGeometry.setAttribute("color", dotColorAttr);
  group.add(new Points(dotGeometry, new PointsMaterial({
    size: 0.05,
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })));

  group.baseLineColors = new Float32Array(lineColors);
  group.baseDotColors = new Float32Array(dotColors);
  group.lineColors = lineColorAttr;
  group.dotColors = dotColorAttr;
  return group;
}

export interface HyperspaceController {
  setQuestion(question: string): void;
  setStatus(status: string): void;
  startProcessing(): void;
  resolveDecision(decision: Decision, label?: string): void;
  reset(): void;
  getPhase(): HyperspacePhase;
  cleanup(): void;
}

export async function createHyperspace(renderer: CliRenderer): Promise<HyperspaceController> {
  renderer.start();

  const engine = new ThreeCliRenderer(renderer, {
    width: Math.max(1, renderer.terminalWidth),
    height: Math.max(1, renderer.terminalHeight),
    focalLength: 8,
    backgroundColor: RGBA.fromValues(0.0, 0.0, 0.01, 1.0),
  });
  await engine.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, engine.aspectRatio, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  engine.setActiveCamera(camera);
  scene.add(camera);

  const stars = createStarfield();
  scene.add(stars);

  const hud = new Group();
  scene.add(hud);
  const questionText = createSceneText(hud);
  const cursorText = createSceneText(hud);
  const statusText = createSceneText(hud);
  const controlsText = createSceneText(hud);
  const planet = createPlanet(hud);

  let phase: HyperspacePhase = "idle";
  let decision: Decision | null = null;
  let finalLabel = "";
  let question = "";
  let status = "processing";
  let phaseTime = 0;
  let cameraZ = 0;
  let groupZ = 0;
  let speed = 0;
  let fov = 60;
  let roll = 0;
  let scaleZ = 1;
  let driftAngle = 0;
  let lastCursor = false;
  let lastTintKey = "";

  const setPhase = (next: HyperspacePhase) => {
    phase = next;
    phaseTime = 0;
  };

  const onResize = (w: number, h: number) => {
    engine.setSize(Math.max(1, w), Math.max(1, h));
    camera.aspect = engine.aspectRatio;
    camera.updateProjectionMatrix();
    questionText.key = "";
    cursorText.key = "";
    statusText.key = "";
    controlsText.key = "";
    planet.key = "";
  };

  const onKey = (_key: KeyEvent) => {
    // App owns input; this listener exists so cleanup releases every local subscription.
  };

  const updateHud = () => {
    const size = visibleSize(camera, Math.abs(HUD_Z));
    const terminalW = Math.max(20, renderer.terminalWidth);
    const terminalH = Math.max(10, renderer.terminalHeight);
    const cursor = phase === "idle" && Math.floor(Date.now() / 480) % 2 === 0;
    const baseText = question || "ASK";
    lastCursor = cursor;

    questionText.group.visible = phase !== "final";
    cursorText.group.visible = phase === "idle" && cursor;
    statusText.group.visible = phase !== "idle";
    controlsText.group.visible = true;
    planet.group.visible = phase === "final";

    if (questionText.group.visible) {
      const maxColumns = Math.floor(terminalW * 0.7);
      const maxRows = Math.floor(terminalH * 0.7);
      const art = renderAsciiText(baseText, maxColumns, maxRows);
      const cellSize = Math.min((size.width * 0.7) / Math.max(1, art.width), (size.height * 0.55) / Math.max(1, art.height), 0.28);
      questionText.set(baseText, {
        maxColumns,
        maxRows,
        cellSize,
        color: phase === "idle" ? "#E5E7EB" : "#9CA3AF",
        x: 0,
        y: 0,
        z: HUD_Z,
      });

      if (cursorText.group.visible) {
        const cursorX = ((art.width - 1) * cellSize) / 2 + cellSize * 1.25;
        const cursorY = -((art.height - 1) * cellSize) / 2;
        cursorText.set("_", {
          maxColumns: 4,
          maxRows: 5,
          cellSize,
          color: "#E5E7EB",
          x: cursorX,
          y: cursorY,
          z: HUD_Z,
        });
      }
    }

    const statusSize = visibleSize(camera, Math.abs(STATUS_Z));
    if (statusText.group.visible) {
      statusText.set(status, {
        maxColumns: Math.floor(terminalW * 0.8),
        maxRows: 5,
        cellSize: Math.min(0.055, (statusSize.width * 0.75) / Math.max(1, status.length * 4)),
        color: "#6B7280",
        x: -statusSize.width * 0.38,
        y: statusSize.height * 0.43,
        z: STATUS_Z,
        align: "left",
      });
    }

    const prompt = phase === "final" ? "ENTER TO ASK AGAIN  ESC TO QUIT" : "ENTER TO ASK  ESC TO QUIT";
    controlsText.set(prompt, {
      maxColumns: Math.floor(terminalW * 0.8),
      maxRows: 5,
      cellSize: Math.min(0.05, (statusSize.width * 0.75) / Math.max(1, prompt.length * 4)),
      color: "#556677",
      x: -statusSize.width * 0.38,
      y: -statusSize.height * 0.43,
      z: STATUS_Z,
      align: "left",
    });

    if (phase === "final" && decision) {
      const t = Math.min(1, phaseTime / 1.1);
      const eased = 1 - (1 - t) * (1 - t);
      planet.set(finalLabel || decision, decision, eased, 0, 0, PLANET_Z);
    }
  };

  renderer.on("resize", onResize);
  renderer.keyInput.on("keypress", onKey);

  renderer.setFrameCallback(async (deltaMs) => {
    const dt = deltaMs / 1000;
    phaseTime += dt;
    driftAngle += dt * 0.08;

    let shake = 0;
    let followRate = 100;
    let tint: [number, number, number] | null = null;
    let tintAmount = 0;

    switch (phase) {
      case "idle": {
        speed *= 0.95;
        scaleZ += (1 - scaleZ) * Math.min(1, dt * 2);
        fov += (60 - fov) * Math.min(1, dt * 2);
        roll *= 0.95;
        followRate = 100;
        break;
      }
      case "spool": {
        const t = Math.min(phaseTime / SPOOL_DUR, 1);
        const eased = t * t;
        speed = eased * 8;
        scaleZ = 1 + eased * 3;
        fov = 60 + eased * 8;
        shake = eased * 0.08;
        roll = Math.sin(phaseTime * 6) * eased * 0.03;
        followRate = 0.5;
        if (phaseTime >= SPOOL_DUR) setPhase("punch");
        break;
      }
      case "punch": {
        const t = Math.min(phaseTime / PUNCH_DUR, 1);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        speed = 8 + eased * 92;
        scaleZ = 4 + eased * 36;
        fov = 68 + eased * 42;
        shake = 0.08 + eased * 0.22;
        roll = eased * 0.04 + Math.sin(phaseTime * 8) * (1 - eased) * 0.04;
        followRate = 0.3;
        if (phaseTime >= PUNCH_DUR) setPhase("cruise");
        break;
      }
      case "cruise": {
        speed += (80 - speed) * Math.min(1, dt * 2);
        scaleZ += (40 - scaleZ) * Math.min(1, dt * 2);
        fov += (95 - fov) * Math.min(1, dt * 1.5);
        shake = 0.06;
        roll = Math.sin(phaseTime * 0.5) * 0.02;
        followRate = 0.2;
        if (decision) setPhase("tint");
        break;
      }
      case "tint": {
        const t = Math.min(phaseTime / TINT_DUR, 1);
        speed += (62 - speed) * Math.min(1, dt * 3);
        scaleZ += (34 - scaleZ) * Math.min(1, dt * 3);
        fov += (88 - fov) * Math.min(1, dt * 2);
        shake = 0.04 * (1 - t);
        followRate = 0.4;
        tint = hexRgb(decision === "No" ? hex.no : hex.yes);
        tintAmount = Math.sin(t * Math.PI);
        if (phaseTime >= TINT_DUR) setPhase("decel");
        break;
      }
      case "decel": {
        const t = Math.min(phaseTime / DECEL_DUR, 1);
        const eased = 1 - (1 - t) * (1 - t);
        speed = 80 * (1 - eased) + 4 * eased;
        scaleZ = 40 * (1 - eased) + 4 * eased;
        fov = 95 - eased * 30;
        shake = 0.06 * (1 - eased);
        roll *= 0.97;
        followRate = 4;
        if (phaseTime >= DECEL_DUR) setPhase("exit");
        break;
      }
      case "exit": {
        const t = Math.min(phaseTime / EXIT_DUR, 1);
        speed = 4 * (1 - t);
        scaleZ = 4 * (1 - t) + 1 * t;
        fov += (60 - fov) * Math.min(1, dt * 2);
        roll *= 0.95;
        followRate = 8;
        if (phaseTime >= EXIT_DUR) {
          cameraZ = 0;
          groupZ = 0;
          speed = 0;
          setPhase("final");
        }
        break;
      }
      case "final": {
        speed = 0;
        scaleZ += (1 - scaleZ) * Math.min(1, dt * 2);
        fov += (60 - fov) * Math.min(1, dt * 2);
        followRate = 100;
        break;
      }
    }

    const tintKey = tint ? `${tint.join(",")}:${tintAmount.toFixed(3)}` : "normal";
    if (tintKey !== lastTintKey) {
      lastTintKey = tintKey;
      mixColors(stars.lineColors.array as Float32Array, stars.baseLineColors, tint, tintAmount);
      mixColors(stars.dotColors.array as Float32Array, stars.baseDotColors, tint, tintAmount);
      stars.lineColors.needsUpdate = true;
      stars.dotColors.needsUpdate = true;
    }

    cameraZ -= speed * dt;
    groupZ += (cameraZ - groupZ) * Math.min(1, dt * followRate);
    stars.position.z = groupZ;
    stars.scale.z = scaleZ;

    const idleDrift = phase === "idle" || phase === "final" ? 1 : 0;
    camera.position.x = (Math.random() - 0.5) * shake + Math.sin(driftAngle) * 0.2 * idleDrift;
    camera.position.y = (Math.random() - 0.5) * shake + Math.cos(driftAngle * 0.7) * 0.15 * idleDrift;
    camera.position.z = cameraZ;
    camera.fov = fov;
    camera.rotation.z = roll;
    camera.updateProjectionMatrix();
    camera.lookAt(camera.position.x * 0.3, camera.position.y * 0.3, cameraZ - 10);
    hud.position.copy(camera.position);
    hud.rotation.copy(camera.rotation);

    const cursorNow = phase === "idle" && Math.floor(Date.now() / 480) % 2 === 0;
    if (cursorNow !== lastCursor) cursorText.key = "";
    updateHud();

    await engine.drawScene(scene, renderer.nextRenderBuffer, deltaMs);
  });

  return {
    setQuestion(nextQuestion) {
      question = nextQuestion;
      questionText.key = "";
    },
    setStatus(nextStatus) {
      status = nextStatus;
      statusText.key = "";
    },
    startProcessing() {
      if (phase === "idle") setPhase("spool");
    },
    resolveDecision(nextDecision, label) {
      decision = nextDecision;
      finalLabel = label || nextDecision;
      if (phase === "idle") setPhase("tint");
      statusText.key = "";
    },
    reset() {
      decision = null;
      finalLabel = "";
      question = "";
      status = "processing";
      cameraZ = 0;
      groupZ = 0;
      speed = 0;
      fov = 60;
      roll = 0;
      scaleZ = 1;
      lastTintKey = "";
      questionText.key = "";
      cursorText.key = "";
      statusText.key = "";
      controlsText.key = "";
      planet.key = "";
      setPhase("idle");
    },
    getPhase() {
      return phase;
    },
    cleanup() {
      renderer.off("resize", onResize);
      renderer.keyInput.off("keypress", onKey);
      renderer.clearFrameCallbacks();
      questionText.dispose();
      cursorText.dispose();
      statusText.dispose();
      controlsText.dispose();
      planet.dispose();
      engine.destroy();
    },
  };
}

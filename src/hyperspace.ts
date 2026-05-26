import { ThreeCliRenderer, THREE } from "@opentui/three";
import type * as ThreeCore from "three/src/Three.js";
import { RGBA, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { renderAsciiText, type AsciiArt } from "./ascii.js";
import { hex } from "./theme.js";

const Three = THREE as unknown as typeof ThreeCore;
const {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
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

const STAR_COUNT = 2048;
const SPHERE_RADIUS = 80;
const RECYCLE_BEHIND = 3;
const STREAK_FACTOR = 0.15;
const MAX_STREAK = 20;
const RECYCLE_POOL_SIZE = 8192;
const RECYCLE_POOL_MASK = RECYCLE_POOL_SIZE - 1;
const SPOOL_DUR = 2.5;
const PUNCH_DUR = 2.0;
const DECEL_DUR = 2.5;
const EXIT_DUR = 2.0;
const EXPLODE_DUR = 0.5;
const HUD_Z = -10;
const PLANET_Z = -12;
const TEXT_CELL_FILL = 1.04;
const PLANET_CELL_FILL = 1.15;
const PLANET_COLUMNS = 41;
const PLANET_ROWS = 41;
const PLANET_CELL = 0.0487;
const PLANET_WORLD_WIDTH = PLANET_COLUMNS * PLANET_CELL;
const PLANET_WORLD_HEIGHT = PLANET_ROWS * PLANET_CELL;

interface Starfield extends ThreeGroup {
  starX: Float32Array;
  starY: Float32Array;
  starZ: Float32Array;
  baseLineColors: Float32Array;
  baseDotColors: Float32Array;
  lineColors: ThreeFloat32BufferAttribute;
  dotColors: ThreeFloat32BufferAttribute;
  linePositions: ThreeFloat32BufferAttribute;
  dotPositions: ThreeFloat32BufferAttribute;
}

type SceneText = {
  group: ThreeGroup;
  key: string;
  dispose(): void;
  set(text: string, options: TextOptions): void;
  setOpacity(value: number): void;
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

function applyOscillatingTint(
  lineTarget: Float32Array,
  lineBase: Float32Array,
  dotTarget: Float32Array,
  dotBase: Float32Array,
  decision: Decision,
  spreadT: number,
  time: number,
  settleT: number,
) {
  const yesTint = hexRgb(hex.yes);
  const noTint = hexRgb(hex.no);
  const correct = decision === "Yes" ? yesTint : noTint;
  const wrong = decision === "Yes" ? noTint : yesTint;

  for (let i = 0; i < STAR_COUNT; i++) {
    const head = i * 2 * 3;
    const dotIdx = i * 3;

    // Deterministic per-star hash for spread ordering
    const hash = Math.abs(Math.sin(i * 127.1 + 311.7));
    const threshold = hash * hash;

    if (threshold < spreadT) {
      // This star is tinted — oscillate between green and red
      const freq = 1 + Math.abs(Math.sin(i * 17.3)) * 2;
      const phase = i * 13.7;
      const rawOsc = Math.sin(time * freq + phase);

      // Dampen oscillation as settling progresses
      const dampen = Math.max(0, 1 - settleT * settleT);
      const oscillation = rawOsc * dampen;

      // Bias toward correct color as settling progresses
      const bias = settleT * settleT * 1.5;
      const mixed = oscillation + bias - 0.5;

      const tint = mixed > 0 ? correct : wrong;
      const amount = 0.4 + spreadT * 0.4 + settleT * 0.2;

      // Apply to line head and tail
      for (let j = 0; j < 6; j += 3) {
        lineTarget[head + j] = lineBase[head + j]! * (1 - amount) + tint[0] * amount;
        lineTarget[head + j + 1] = lineBase[head + j + 1]! * (1 - amount) + tint[1] * amount;
        lineTarget[head + j + 2] = lineBase[head + j + 2]! * (1 - amount) + tint[2] * amount;
      }

      // Apply to dot
      dotTarget[dotIdx] = dotBase[dotIdx]! * (1 - amount) + tint[0] * amount;
      dotTarget[dotIdx + 1] = dotBase[dotIdx + 1]! * (1 - amount) + tint[1] * amount;
      dotTarget[dotIdx + 2] = dotBase[dotIdx + 2]! * (1 - amount) + tint[2] * amount;
    } else {
      // Keep base color
      for (let j = 0; j < 6; j++) {
        lineTarget[head + j] = lineBase[head + j]!;
      }
      dotTarget[dotIdx] = dotBase[dotIdx]!;
      dotTarget[dotIdx + 1] = dotBase[dotIdx + 1]!;
      dotTarget[dotIdx + 2] = dotBase[dotIdx + 2]!;
    }
  }
}

function visibleSize(camera: ThreePerspectiveCamera, distance: number) {
  const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;

  return { width: height * camera.aspect, height };
}

function makeMaterial(color: string) {
  return new MeshBasicMaterial({
    color,
    transparent: true,
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
      const instanceCount = countLitCells(art);
      const mesh = new InstancedMesh(geometry, material, Math.max(1, instanceCount));
      const matrix = new Matrix4();
      const startX = options.align === "left" ? 0 : -((art.width - 1) * options.cellSize) / 2;
      const startY = ((art.height - 1) * options.cellSize) / 2;
      let instance = 0;

      group.position.set(options.x, options.y, options.z);
      mesh.renderOrder = 1000;

      for (let row = 0; row < art.lines.length; row++) {
        const line = art.lines[row]!;
        for (let col = 0; col < line.length; col++) {
          if (line[col] === " ") continue;
          matrix.makeTranslation(startX + col * options.cellSize, startY - row * options.cellSize, 0);
          mesh.setMatrixAt(instance, matrix);
          instance += 1;
        }
      }

      mesh.count = instance;
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    },
    setOpacity(value) {
      for (const child of group.children) {
        if ((child instanceof InstancedMesh || child instanceof Mesh) && child.material) {
          if (Array.isArray(child.material)) {
            for (const mat of child.material) {
              if (mat instanceof MeshBasicMaterial) mat.opacity = value;
            }
          } else if (child.material instanceof MeshBasicMaterial) {
            child.material.opacity = value;
          }
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
      const geometry = new PlaneGeometry(PLANET_CELL * PLANET_CELL_FILL, PLANET_CELL * PLANET_CELL_FILL);
      const startX = -((rows[0]!.length - 1) * PLANET_CELL) / 2;
      const startY = ((rows.length - 1) * PLANET_CELL) / 2;
      const materials = planetMaterials(decision);
      const positionsByShade = Array.from({ length: materials.length }, () => [] as Array<[number, number]>);

      for (let row = 0; row < rows.length; row++) {
        const line = rows[row]!;
        for (let col = 0; col < line.length; col++) {
          const shade = line[col]!;
          if (shade === " ") continue;
          positionsByShade[shadeIndex(shade)]!.push([startX + col * PLANET_CELL, startY - row * PLANET_CELL]);
        }
      }

      const matrix = new Matrix4();
      for (let shade = 0; shade < positionsByShade.length; shade++) {
        const positions = positionsByShade[shade]!;
        if (!positions.length) continue;
        const mesh = new InstancedMesh(geometry, materials[shade]!, positions.length);
        mesh.renderOrder = 1000;
        for (let i = 0; i < positions.length; i++) {
          const [px, py] = positions[i]!;
          matrix.makeTranslation(px, py, 0);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }

      const art = buildTextMeshes(renderAsciiText(label, 24, 7), 0.16, "#E5E7EB");
      art.position.set(0, 0, 0.03);
      group.add(art);
    },
  };
}

function buildPlanetRows(decision: Decision): string[] {
  const shades = " .,'-~:;=!+*/?o#%&@$"
  const lines: string[] = [];
  const lightX = -0.48;
  const lightY = -0.58;
  const lightZ = 0.66;

  const r = (PLANET_ROWS - 1) / 2;
  for (let row = 0; row < PLANET_ROWS; row++) {
    let line = "";
    const dy = row - (PLANET_ROWS - 1) / 2;
    for (let col = 0; col < PLANET_COLUMNS; col++) {
      const dx = col - (PLANET_COLUMNS - 1) / 2;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) {
        line += " ";
        continue;
      }

      const x = dx / r;
      const y = dy / r;
      const d = x * x + y * y;
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
  return Math.max(0, " .,'-~:;=!+*/?o#%&@$".indexOf(shade));
}

function planetMaterials(decision: Decision) {
  const yes = ["#000000", "#062A1A", "#083420", "#0B3F27", "#0F492A", "#14532D", "#155C30", "#166534", "#157238", "#15803D", "#1BA24D", "#22C55E", "#36D16F", "#4ADE80", "#68E696", "#86EFAC", "#A0F3BE", "#BBF7D0", "#D5FAE2", "#F0FDF4"];
  const no = ["#000000", "#310B0B", "#3B0A0A", "#450A0A", "#621414", "#7F1D1D", "#8C1C1C", "#991B1B", "#A91C1C", "#B91C1C", "#CA2121", "#DC2626", "#E53535", "#EF4444", "#F35B5B", "#F87171", "#FA8B8B", "#FCA5A5", "#FCCBCB", "#FEF2F2"];

  return (decision === "Yes" ? yes : no).map((color) => makeMaterial(color));
}

function buildTextMeshes(art: AsciiArt, cellSize: number, color: string): ThreeGroup {
  const group = new Group();
  const geometry = new PlaneGeometry(cellSize * TEXT_CELL_FILL, cellSize * TEXT_CELL_FILL);
  const material = makeMaterial(color);
  const mesh = new InstancedMesh(geometry, material, Math.max(1, countLitCells(art)));
  const matrix = new Matrix4();
  const startX = -((art.width - 1) * cellSize) / 2;
  const startY = ((art.height - 1) * cellSize) / 2;
  let instance = 0;

  for (let row = 0; row < art.lines.length; row++) {
    const line = art.lines[row]!;
    for (let col = 0; col < line.length; col++) {
      if (line[col] === " ") continue;
      matrix.makeTranslation(startX + col * cellSize, startY - row * cellSize, 0);
      mesh.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }

  mesh.count = instance;
  mesh.renderOrder = 1001;
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);

  return group;
}

function countLitCells(art: AsciiArt) {
  let count = 0;

  for (const line of art.lines) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== " ") count += 1;
    }
  }

  return count;
}

function planetScaleForViewport(camera: ThreePerspectiveCamera) {
  const size = visibleSize(camera, Math.abs(PLANET_Z));

  return Math.min((size.width * 0.8) / PLANET_WORLD_WIDTH, (size.height * 0.8) / PLANET_WORLD_HEIGHT);
}

function randomSpherePoint(radius: number): [number, number, number] {
  const theta = Math.random() * Math.PI * 2;
  const cosPhi = 2 * Math.random() - 1;
  const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
  const r = radius * Math.cbrt(Math.random());
  return [r * sinPhi * Math.cos(theta), r * cosPhi, r * sinPhi * Math.sin(theta)];
}

const recyclePoolX = new Float32Array(RECYCLE_POOL_SIZE);
const recyclePoolY = new Float32Array(RECYCLE_POOL_SIZE);
const recyclePoolZ = new Float32Array(RECYCLE_POOL_SIZE);
let recyclePoolIdx = 0;

for (let i = 0; i < RECYCLE_POOL_SIZE; i++) {
  const [x, y, z] = randomSpherePoint(SPHERE_RADIUS);
  recyclePoolX[i] = x;
  recyclePoolY[i] = y;
  recyclePoolZ[i] = z;
}

export function createStarfield(): Starfield {
  const group = new Group() as Starfield;
  const starX = new Float32Array(STAR_COUNT);
  const starY = new Float32Array(STAR_COUNT);
  const starZ = new Float32Array(STAR_COUNT);
  const linePositions = new Float32Array(STAR_COUNT * 2 * 3);
  const lineColors = new Float32Array(STAR_COUNT * 2 * 3);
  const dotPositions = new Float32Array(STAR_COUNT * 3);
  const dotColors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    const [x, y, z] = randomSpherePoint(SPHERE_RADIUS);
    starX[i] = x;
    starY[i] = y;
    starZ[i] = z;

    const brightness = Math.random() ** 2 * 0.9 + 0.1;
    const temp = Math.random();
    const cr = temp < 0.2 ? brightness : temp < 0.4 ? brightness * 0.6 : brightness;
    const cg = temp < 0.2 ? brightness * 0.85 : temp < 0.4 ? brightness * 0.8 : brightness;
    const cb = temp < 0.2 ? brightness * 0.6 : brightness;

    const head = i * 6;
    linePositions[head] = x;
    linePositions[head + 1] = y;
    linePositions[head + 2] = z;
    lineColors[head] = cr;
    lineColors[head + 1] = cg;
    lineColors[head + 2] = cb;
    linePositions[head + 3] = x;
    linePositions[head + 4] = y;
    linePositions[head + 5] = z;
    lineColors[head + 3] = cr * 0.2;
    lineColors[head + 4] = cg * 0.3;
    lineColors[head + 5] = Math.min(1, cb * 1.4) * 0.5;

    const di = i * 3;
    dotPositions[di] = x;
    dotPositions[di + 1] = y;
    dotPositions[di + 2] = z;
    dotColors[di] = cr;
    dotColors[di + 1] = cg;
    dotColors[di + 2] = cb;
  }

  const lineGeometry = new BufferGeometry();
  const linePosAttr = new Float32BufferAttribute(linePositions, 3);
  const lineColorAttr = new Float32BufferAttribute(lineColors, 3);
  lineGeometry.setAttribute("position", linePosAttr);
  lineGeometry.setAttribute("color", lineColorAttr);
  const linesMesh = new LineSegments(lineGeometry, new LineBasicMaterial({
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  }));
  linesMesh.frustumCulled = false;
  group.add(linesMesh);

  const dotGeometry = new BufferGeometry();
  const dotPosAttr = new Float32BufferAttribute(dotPositions, 3);
  const dotColorAttr = new Float32BufferAttribute(dotColors, 3);
  dotGeometry.setAttribute("position", dotPosAttr);
  dotGeometry.setAttribute("color", dotColorAttr);
  const dotsMesh = new Points(dotGeometry, new PointsMaterial({
    size: 0.05,
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  }));
  dotsMesh.frustumCulled = false;
  group.add(dotsMesh);

  group.starX = starX;
  group.starY = starY;
  group.starZ = starZ;
  group.baseLineColors = new Float32Array(lineColors);
  group.baseDotColors = new Float32Array(dotColors);
  group.lineColors = lineColorAttr;
  group.dotColors = dotColorAttr;
  group.linePositions = linePosAttr;
  group.dotPositions = dotPosAttr;
  return group;
}

function updateStarfield(stars: Starfield, cameraZ: number, speed: number) {
  const streak = Math.min(MAX_STREAK, Math.max(0.05, speed * STREAK_FACTOR));
  const linePos = stars.linePositions.array as Float32Array;
  const dotPos = stars.dotPositions.array as Float32Array;
  const nearZ = cameraZ + RECYCLE_BEHIND;
  const r2 = SPHERE_RADIUS * SPHERE_RADIUS;

  for (let i = 0; i < STAR_COUNT; i++) {
    let x = stars.starX[i]!;
    let y = stars.starY[i]!;
    let z = stars.starZ[i]!;

    const dx = x;
    const dy = y;
    const dz = z - cameraZ;
    if (z > nearZ || dx * dx + dy * dy + dz * dz > r2) {
      const pi = recyclePoolIdx & RECYCLE_POOL_MASK;
      recyclePoolIdx++;
      x = recyclePoolX[pi]!;
      y = recyclePoolY[pi]!;
      z = cameraZ - Math.abs(recyclePoolZ[pi]!) - SPHERE_RADIUS * 0.1;
      stars.starX[i] = x;
      stars.starY[i] = y;
      stars.starZ[i] = z;
    }

    const head = i * 6;
    linePos[head] = x;
    linePos[head + 1] = y;
    linePos[head + 2] = z;
    linePos[head + 3] = x;
    linePos[head + 4] = y;
    linePos[head + 5] = z - streak;

    const di = i * 3;
    dotPos[di] = x;
    dotPos[di + 1] = y;
    dotPos[di + 2] = z;
  }

  stars.linePositions.needsUpdate = true;
  stars.dotPositions.needsUpdate = true;
}

function redistributeStars(stars: Starfield, cameraZ: number) {
  for (let i = 0; i < STAR_COUNT; i++) {
    const [x, y, z] = randomSpherePoint(SPHERE_RADIUS);
    stars.starX[i] = x;
    stars.starY[i] = y;
    stars.starZ[i] = cameraZ + z;
  }
}

export interface HyperspaceController {
  setQuestion(question: string): void;
  setStatus(status: string): void;
  setDebug(text: string): void;
  startProcessing(): void;
  startDeciding(): void;
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
  const camera = new PerspectiveCamera(60, engine.aspectRatio, 0.1, 50000);
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
  const planet = createPlanet(hud);
  const debugLine = new TextRenderable(renderer, {
    id: "naiou-debug",
    content: "",
    fg: "#FFFFFF",
    position: "absolute",
    top: 0,
    left: 1,
    zIndex: 31,
  });
  const statusLine = new TextRenderable(renderer, {
    id: "naiou-status",
    content: "",
    fg: "#6B7280",
    position: "absolute",
    top: 1,
    left: 1,
    zIndex: 30,
  });
  const controlsLine = new TextRenderable(renderer, {
    id: "naiou-controls",
    content: " ENTER TO ASK  ESC TO QUIT ",
    fg: "#556677",
    position: "absolute",
    top: Math.max(0, renderer.terminalHeight - 1),
    left: 1,
    zIndex: 30,
  });
  renderer.root.add(debugLine);
  renderer.root.add(statusLine);
  renderer.root.add(controlsLine);

  let phase: HyperspacePhase = "idle";
  let decision: Decision | null = null;
  let deciding = false;
  let finalLabel = "";
  let question = "";
  let status = "processing";
  let phaseTime = 0;
  let cameraZ = 0;
  let speed = 0;
  let fov = 60;
  let roll = 0;
  let driftAngle = 0;
  let starRotZ = 0;
  let tintAmount = 0;
  let explodeTime = 0;
  let lastCursor = false;

  const setPhase = (next: HyperspacePhase) => {
    phase = next;
    phaseTime = 0;
  };

  const onResize = (w: number, h: number) => {
    engine.setSize(Math.max(1, w), Math.max(1, h));
    camera.aspect = engine.aspectRatio;
    camera.updateProjectionMatrix();
    controlsLine.y = Math.max(0, h - 1);
    questionText.key = "";
    cursorText.key = "";
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

    const textFading = phase === "spool" || phase === "punch";
    questionText.group.visible = phase === "idle" || textFading;
    cursorText.group.visible = phase === "idle" && cursor;
    const exploding = explodeTime > 0;
    planet.group.visible = phase === "exit" || phase === "final" || exploding;
    statusLine.content = phase === "idle" ? "" : ` ${status} `;
    controlsLine.content = phase === "final" ? " ENTER TO ASK AGAIN  ESC TO QUIT " : " ENTER TO ASK  ESC TO QUIT ";

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

      if (phase === "spool") {
        const fade = Math.max(0, 1 - phaseTime / (SPOOL_DUR * 0.6));
        questionText.setOpacity(fade);
      } else if (phase !== "idle") {
        questionText.setOpacity(0);
      }

      if (cursorText.group.visible) {
        const cursorX = ((art.width - 1) * cellSize) / 2 + cellSize * 3.25;
        const cursorY = -((art.height - 1) * cellSize) / 2 + cellSize;
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

    if (decision && (phase === "exit" || phase === "final")) {
      let eased = 1;
      if (phase === "exit") {
        const t = Math.min(1, phaseTime / EXIT_DUR);
        eased = 1 - (1 - t) * (1 - t);
      }
      planet.set(finalLabel || decision, decision, eased * planetScaleForViewport(camera), 0, 0, PLANET_Z);
    }

    if (exploding) {
      const t = Math.min(explodeTime / EXPLODE_DUR, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      planet.group.scale.setScalar(Math.max(0.05, (1 + eased * 5) * planetScaleForViewport(camera)));
      for (const child of planet.group.children) {
        if ((child instanceof InstancedMesh || child instanceof Mesh) && child.material instanceof MeshBasicMaterial) {
          child.material.opacity = 1 - eased;
        }
      }
    }
  };

  renderer.on("resize", onResize);
  renderer.keyInput.on("keypress", onKey);

  renderer.setFrameCallback(async (deltaMs) => {
    const dt = deltaMs / 1000;
    phaseTime += dt;
    driftAngle += dt * 0.08;

    let shake = 0;
    let needsTint = false;

    switch (phase) {
      case "idle": {
        starRotZ += dt * 0.008;
        speed *= 0.95;
        fov += (60 - fov) * Math.min(1, dt * 2);
        roll *= 0.95;
        break;
      }
      case "spool": {
        const t = Math.min(phaseTime / SPOOL_DUR, 1);
        const eased = t * t;
        starRotZ += dt * (0.008 + eased * 0.05);
        speed = eased * 15;
        fov = 60 - eased * 35;
        shake = eased * 0.3;
        roll = Math.sin(phaseTime * 6) * eased * 0.1;
        if (phaseTime >= SPOOL_DUR) setPhase("punch");
        break;
      }
      case "punch": {
        const t = Math.min(phaseTime / PUNCH_DUR, 1);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        starRotZ += dt * (0.058 + eased * 0.04);
        speed = 15 + eased * 85;
        fov = 25 + eased * 115;
        shake = 0.3 + eased * 0.6;
        roll = eased * 0.12 + Math.sin(phaseTime * 8) * (1 - eased) * 0.1;
        if (phaseTime >= PUNCH_DUR) setPhase("cruise");
        break;
      }
      case "cruise": {
        starRotZ += dt * 0.06;
        const targetSpeed = 80 + Math.sin(phaseTime * 0.4) * 12 + Math.sin(phaseTime * 1.1) * 4;
        speed += (targetSpeed - speed) * Math.min(1, dt * 2);
        const breathe = Math.sin(phaseTime * 0.5) * 16 + Math.sin(phaseTime * 1.1) * 8;
        fov += (110 + breathe - fov) * Math.min(1, dt * 1.5);
        shake = 0.18 + Math.sin(phaseTime * 0.7) * 0.08;
        roll = Math.sin(phaseTime * 0.5) * 0.07 + Math.sin(phaseTime * 0.9) * 0.04;
        if (deciding || decision) setPhase("tint");
        break;
      }
      case "tint": {
        starRotZ += dt * 0.06;
        speed = 80;
        const breathe = Math.sin(phaseTime * 0.5) * 16 + Math.sin(phaseTime * 1.1) * 8;
        fov += (110 + breathe - fov) * Math.min(1, dt * 1.5);
        shake = 0.18;
        roll = Math.sin(phaseTime * 0.5) * 0.07;
        tintAmount = 1;
        needsTint = true;
        if (decision) setPhase("decel");
        break;
      }
      case "decel": {
        const t = Math.min(phaseTime / DECEL_DUR, 1);
        const eased = 1 - (1 - t) * (1 - t);
        starRotZ += dt * (0.06 - eased * 0.052);
        speed = 80 * (1 - eased) + 4 * eased;
        fov = 110 - eased * 45;
        shake = 0.18 * (1 - eased);
        roll *= 0.97;
        tintAmount = 1;
        needsTint = true;
        if (phaseTime >= DECEL_DUR) setPhase("exit");
        break;
      }
      case "exit": {
        starRotZ += dt * 0.008;
        const t = Math.min(phaseTime / EXIT_DUR, 1);
        const eased = t * t;
        speed = 4 * (1 - t) + 0.3 * t;
        fov += (60 - fov) * Math.min(1, dt * 2);
        roll *= 0.95;
        tintAmount = 1 - eased;
        needsTint = tintAmount > 0.01;
        if (phaseTime >= EXIT_DUR) setPhase("final");
        break;
      }
      case "final": {
        starRotZ += dt * 0.008;
        speed *= 0.95;
        fov += (60 - fov) * Math.min(1, dt * 2);
        tintAmount *= 0.92;
        needsTint = tintAmount > 0.01;
        break;
      }
    }

    if (needsTint) {
      (stars.lineColors.array as Float32Array).set(stars.baseLineColors);
      (stars.dotColors.array as Float32Array).set(stars.baseDotColors);

      if (phase === "tint") {
        const spreadT = Math.pow(Math.min(phaseTime / 3, 1), 3) * 0.6;
        applyOscillatingTint(
          stars.lineColors.array as Float32Array,
          stars.baseLineColors,
          stars.dotColors.array as Float32Array,
          stars.baseDotColors,
          decision || "Yes",
          spreadT,
          phaseTime,
          0,
        );
      } else if (phase === "decel" && decision) {
        const spreadT = 0.6 + Math.min(phaseTime / DECEL_DUR, 1) * 0.4;
        const settleT = Math.min(phaseTime / DECEL_DUR, 1);
        applyOscillatingTint(
          stars.lineColors.array as Float32Array,
          stars.baseLineColors,
          stars.dotColors.array as Float32Array,
          stars.baseDotColors,
          decision,
          spreadT,
          phaseTime + 6,
          settleT,
        );
      } else if (decision) {
        const tint = hexRgb(decision === "No" ? hex.no : hex.yes);
        mixColors(stars.lineColors.array as Float32Array, stars.baseLineColors, tint, tintAmount);
        mixColors(stars.dotColors.array as Float32Array, stars.baseDotColors, tint, tintAmount);
      }

      stars.lineColors.needsUpdate = true;
      stars.dotColors.needsUpdate = true;
    }

    if (explodeTime > 0) {
      explodeTime += dt;
      if (explodeTime >= EXPLODE_DUR) explodeTime = 0;
    }

    cameraZ -= speed * dt;

    if (Math.abs(cameraZ) > 10000) {
      for (let i = 0; i < STAR_COUNT; i++) stars.starZ[i] = stars.starZ[i]! - cameraZ;
      cameraZ = 0;
    }

    updateStarfield(stars, cameraZ, speed);
    stars.rotation.z = starRotZ;

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
      statusLine.content = phase === "idle" ? "" : ` ${status} `;
    },
    setDebug(text) {
      if (!text) {
        debugLine.content = "";
        return;
      }
      const maxW = renderer.terminalWidth - 2;
      const lines = text.split(/\r?\n/)
        .flatMap(line => {
          const chunks = [];
          for (let i = 0; i < line.length; i += maxW) {
            chunks.push(line.slice(i, i + maxW));
          }
          return chunks;
        })
        .map(chunk => ` ${chunk} `)
        .join("\n");
      debugLine.content = lines;
    },
    startProcessing() {
      if (phase === "idle") setPhase("spool");
    },
    startDeciding() {
      deciding = true;
      if (phase === "cruise") setPhase("tint");
    },
    resolveDecision(nextDecision, label) {
      decision = nextDecision;
      deciding = true;
      finalLabel = label || nextDecision;
      if (phase === "idle") {
        setPhase("tint");
      } else if (phase === "cruise") {
        setPhase("tint");
      }
      statusLine.content = ` ${status} `;
    },
    reset() {
      if (decision && (phase === "exit" || phase === "final")) {
        explodeTime = 0.001;
      }
      decision = null;
      deciding = false;
      finalLabel = "";
      question = "";
      status = "processing";
      cameraZ = 0;
      speed = 0;
      fov = 60;
      roll = 0;
      starRotZ = 0;
      tintAmount = 0;
      redistributeStars(stars, 0);
      (stars.lineColors.array as Float32Array).set(stars.baseLineColors);
      (stars.dotColors.array as Float32Array).set(stars.baseDotColors);
      stars.lineColors.needsUpdate = true;
      stars.dotColors.needsUpdate = true;
      questionText.key = "";
      cursorText.key = "";
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
      renderer.root.remove("naiou-debug");
      renderer.root.remove("naiou-status");
      renderer.root.remove("naiou-controls");
      questionText.dispose();
      cursorText.dispose();
      planet.dispose();
      engine.destroy();
    },
  };
}

import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
} from "three";
import { ThreeCliRenderer } from "@opentui/three";
import { RGBA, type CliRenderer, type KeyEvent } from "@opentui/core";
import { hex } from "./theme.js";

export type Decision = "Yes" | "No";
export type HyperspacePhase = "idle" | "spool" | "punch" | "cruise" | "tint" | "exit" | "final";

const STAR_COUNT = 7000;
const STAR_RADIUS = 25;
const STREAK_DZ = 0.3;

interface Starfield extends Group {
  baseLineColors: Float32Array;
  baseDotColors: Float32Array;
  lineColors: Float32BufferAttribute;
  dotColors: Float32BufferAttribute;
}

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
  startProcessing(): void;
  resolveDecision(decision: Decision): void;
  getPhase(): HyperspacePhase;
  cleanup(): void;
}

export async function createHyperspace(renderer: CliRenderer): Promise<HyperspaceController> {
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

  let phase: HyperspacePhase = "idle";
  let decision: Decision | null = null;
  let phaseTime = 0;
  let cameraZ = 0;
  let groupZ = 0;
  let speed = 0;
  let fov = 60;
  let roll = 0;
  let scaleZ = 1;
  let driftAngle = 0;

  const setPhase = (next: HyperspacePhase) => {
    phase = next;
    phaseTime = 0;
  };

  const onResize = (w: number, h: number) => {
    engine.setSize(Math.max(1, w), Math.max(1, h));
    camera.aspect = engine.aspectRatio;
    camera.updateProjectionMatrix();
  };

  const onKey = (_key: KeyEvent) => {
    // App owns input; this listener exists so cleanup releases every local subscription.
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
        break;
      }
      case "spool": {
        const t = Math.min(phaseTime / 1.4, 1);
        const eased = t * t;
        speed = eased * 8;
        scaleZ = 1 + eased * 3;
        fov = 60 + eased * 8;
        shake = eased * 0.08;
        roll = Math.sin(phaseTime * 6) * eased * 0.03;
        followRate = 0.5;
        if (t >= 1) setPhase("punch");
        break;
      }
      case "punch": {
        const t = Math.min(phaseTime / 1.1, 1);
        const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        speed = 8 + eased * 92;
        scaleZ = 4 + eased * 36;
        fov = 68 + eased * 42;
        shake = 0.08 + eased * 0.22;
        roll = eased * 0.04 + Math.sin(phaseTime * 8) * (1 - eased) * 0.04;
        followRate = 0.3;
        if (t >= 1) setPhase("cruise");
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
        const t = Math.min(phaseTime / 1.2, 1);
        speed += (62 - speed) * Math.min(1, dt * 3);
        scaleZ += (34 - scaleZ) * Math.min(1, dt * 3);
        fov += (88 - fov) * Math.min(1, dt * 2);
        shake = 0.04 * (1 - t);
        followRate = 0.4;
        tint = hexRgb(decision === "No" ? hex.no : hex.yes);
        tintAmount = Math.sin(t * Math.PI);
        if (t >= 1) setPhase("exit");
        break;
      }
      case "exit": {
        const t = Math.min(phaseTime / 1.6, 1);
        const eased = 1 - (1 - t) * (1 - t);
        speed = 62 * (1 - eased) + 2 * eased;
        scaleZ = 34 * (1 - eased) + 1 * eased;
        fov += (60 - fov) * Math.min(1, dt * 2);
        roll *= 0.95;
        followRate = 8;
        if (t >= 1) {
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

    mixColors(stars.lineColors.array as Float32Array, stars.baseLineColors, tint, tintAmount);
    mixColors(stars.dotColors.array as Float32Array, stars.baseDotColors, tint, tintAmount);
    stars.lineColors.needsUpdate = true;
    stars.dotColors.needsUpdate = true;

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

    await engine.drawScene(scene, renderer.nextRenderBuffer, deltaMs);
  });

  return {
    startProcessing() {
      if (phase === "idle") setPhase("spool");
    },
    resolveDecision(nextDecision: Decision) {
      decision = nextDecision;
      if (phase === "idle") setPhase("tint");
    },
    getPhase() {
      return phase;
    },
    cleanup() {
      renderer.off("resize", onResize);
      renderer.keyInput.off("keypress", onKey);
      renderer.clearFrameCallbacks();
      engine.destroy();
    },
  };
}

declare module "three" {
  export const AdditiveBlending: unknown;
  export class BufferGeometry {
    setAttribute(name: string, attribute: unknown): void;
  }
  export class Float32BufferAttribute {
    constructor(array: Float32Array, itemSize: number);
    array: ArrayLike<number>;
    needsUpdate: boolean;
  }
  export class Group {
    position: { z: number };
    scale: { z: number };
    add(child: unknown): void;
  }
  export class LineBasicMaterial {
    constructor(options: Record<string, unknown>);
  }
  export class LineSegments {
    constructor(geometry: BufferGeometry, material: LineBasicMaterial);
  }
  export class PerspectiveCamera {
    constructor(fov: number, aspect: number, near: number, far: number);
    aspect: number;
    fov: number;
    position: {
      x: number;
      y: number;
      z: number;
      set(x: number, y: number, z: number): void;
    };
    rotation: { z: number };
    lookAt(x: number, y: number, z: number): void;
    updateProjectionMatrix(): void;
  }
  export class Points {
    constructor(geometry: BufferGeometry, material: PointsMaterial);
  }
  export class PointsMaterial {
    constructor(options: Record<string, unknown>);
  }
  export class Scene {
    add(child: unknown): void;
  }
}

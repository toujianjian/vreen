// RoomEnvironment — procedural room environment for PBR image-based lighting.
//
// Adapted from three.js `src/environments/RoomEnvironment.js`. The three.js
// version builds a simple room geometry (box with lights) and renders it to a
// cube map via PMREMGenerator. VREEN's renderer does not expose a testable
// render-to-cubemap path, so this implementation is *simplified*: it directly
// synthesizes a 6-face cube data structure (Float32Array per face) using
// procedural patterns. The result can be fed to an IBL pre-filter pass or
// sampled directly for diffuse ambient lighting in headless / test
// environments.
//
// Face layout (looking down the -Z axis, right-handed, three.js cube-map
// convention):
//   +y  ceiling  — bright ceilingColor with light strips
//   -y  floor    — flat floorColor
//   +x  wall    — wallColor with a horizontal light strip
//   -x  wall    — wallColor with a horizontal light strip
//   +z  wall    — wallColor with a window rectangle
//   -z  wall    — wallColor with a window rectangle
//
// Light pixels use `lightIntensity` directly as their RGB value, so when
// `lightIntensity > 1` the data is HDR (values exceed 1.0).

import { createLogger } from '@/lib/logger';

const log = createLogger('RoomEnvironment');

export interface RoomEnvironmentOptions {
  /** Cube face size in pixels (default 256). Clamped to a minimum of 16. */
  size?: number;
  /** Ambient wall color (default 0.5 grey). */
  wallColor?: [number, number, number];
  /** Floor color (default 0.3 darker). */
  floorColor?: [number, number, number];
  /** Ceiling color (default 0.8 brighter). */
  ceilingColor?: [number, number, number];
  /** Light intensity for the ceiling light strips (default 3.0). */
  lightIntensity?: number;
}

export interface CubeFaceData {
  /** Face name: '+x' | '-x' | '+y' | '-y' | '+z' | '-z' */
  face: string;
  /** RGB pixel data, length = size * size * 3, values in [0, ∞) (HDR). */
  data: Float32Array;
  width: number;
  height: number;
}

export interface EnvironmentCubeData {
  faces: CubeFaceData[];
  size: number;
}

/**
 * Procedural room environment for PBR image-based lighting.
 * Generates a 6-face cube map representing a simple room with lights.
 *
 * Adapted from three.js RoomEnvironment. Simplified to produce data
 * (not a renderable scene) so it works in headless/test environments.
 *
 * Usage: feed the cube data to your IBL pre-filter pass, or sample
 * directly for diffuse ambient lighting.
 */
export class RoomEnvironment {
  readonly size: number;
  readonly wallColor: [number, number, number];
  readonly floorColor: [number, number, number];
  readonly ceilingColor: [number, number, number];
  readonly lightIntensity: number;

  constructor(options: RoomEnvironmentOptions = {}) {
    this.size = Math.max(16, Math.floor(options.size ?? 256));
    this.wallColor = options.wallColor ?? [0.5, 0.5, 0.5];
    this.floorColor = options.floorColor ?? [0.3, 0.3, 0.3];
    this.ceilingColor = options.ceilingColor ?? [0.8, 0.8, 0.8];
    this.lightIntensity = options.lightIntensity ?? 3.0;
  }

  /**
   * Generate the environment cube data.
   * Each face is a 2D grid of RGB float values laid out row-major:
   * pixel (x, y) → data[(y * size + x) * 3 + 0..2].
   *
   * Faces are returned in three.js cube-map order:
   * '+x', '-x', '+y', '-y', '+z', '-z'.
   */
  generate(): EnvironmentCubeData {
    const size = this.size;
    const layout: Array<{ name: string; kind: FaceKind }> = [
      { name: '+x', kind: 'strip' },
      { name: '-x', kind: 'strip' },
      { name: '+y', kind: 'ceiling' },
      { name: '-y', kind: 'floor' },
      { name: '+z', kind: 'window' },
      { name: '-z', kind: 'window' },
    ];

    const faces: CubeFaceData[] = layout.map(({ name, kind }) => this.makeFace(name, kind));

    log.debug('generated room environment', { size, faces: faces.length });
    return { faces, size };
  }

  /** Rasterize one face by sampling the procedural pattern for `kind`. */
  private makeFace(face: string, kind: FaceKind): CubeFaceData {
    const size = this.size;
    const data = new Float32Array(size * size * 3);
    const denom = size > 1 ? size - 1 : 1;
    let i = 0;
    for (let y = 0; y < size; y++) {
      const v = y / denom;
      for (let x = 0; x < size; x++) {
        const u = x / denom;
        const rgb = this.sample(kind, u, v);
        data[i++] = rgb[0];
        data[i++] = rgb[1];
        data[i++] = rgb[2];
      }
    }
    return { face, data, width: size, height: size };
  }

  /**
   * Procedural BRDF-free pattern sampler. (u, v) ∈ [0, 1]² with origin at
   * the bottom-left corner of the face. No ray tracing — just analytic
   * rectangle tests so the output is deterministic and cheap.
   */
  private sample(kind: FaceKind, u: number, v: number): [number, number, number] {
    switch (kind) {
      case 'floor':
        return [this.floorColor[0], this.floorColor[1], this.floorColor[2]];

      case 'ceiling': {
        // Three light strips running along v at fixed u bands.
        const inStrip =
          (u >= 0.15 && u <= 0.25) ||
          (u >= 0.45 && u <= 0.55) ||
          (u >= 0.75 && u <= 0.85);
        if (inStrip) {
          return [this.lightIntensity, this.lightIntensity, this.lightIntensity];
        }
        return [this.ceilingColor[0], this.ceilingColor[1], this.ceilingColor[2]];
      }

      case 'strip': {
        // Horizontal light strip near the ceiling edge.
        if (v >= 0.7 && v <= 0.8) {
          const intensity = this.lightIntensity * 0.8;
          return [intensity, intensity, intensity];
        }
        return [this.wallColor[0], this.wallColor[1], this.wallColor[2]];
      }

      case 'window': {
        // A single bright window rectangle in the wall centre.
        if (u >= 0.3 && u <= 0.7 && v >= 0.4 && v <= 0.8) {
          return [this.lightIntensity, this.lightIntensity, this.lightIntensity];
        }
        return [this.wallColor[0], this.wallColor[1], this.wallColor[2]];
      }
    }
  }
}

type FaceKind = 'strip' | 'ceiling' | 'floor' | 'window';

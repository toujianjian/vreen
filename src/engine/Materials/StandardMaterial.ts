// StandardMaterial — Cook-Torrance metallic-roughness. Pairs with the
// shaders in `shaders.ts`. Holds a reference to a program the renderer
// compiled; the renderer owns the cache.

import type { Material, ShaderObject } from '../Core/Material';
import { Texture } from '../Core/Texture';
import { ShaderProgram } from '../Renderer/ShaderProgram';
import { PBR_FRAG, PBR_VERT } from './shaders';

let _standardId = 0;
function nextStandardUuid(): string {
  return ((++_standardId) * 0x9e3779b1 & 0xffffffff).toString(16).padStart(8, '0');
}

export class StandardMaterial implements Material {
  readonly uuid: string = nextStandardUuid();
  readonly type: string = 'Standard';
  renderOrder: number = 0;
  depthTest: boolean = true;
  depthWrite: boolean = true;
  wireframe: boolean = false;
  userData: Record<string, unknown> = {};

  baseColor: { r: number; g: number; b: number } = { r: 0.8, g: 0.8, b: 0.8 };
  metallic: number = 0;
  roughness: number = 0.5;
  emissive: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 };
  emissiveIntensity: number = 1;
  opacity: number = 1;

  /** Whether this material receives shadows. */
  receiveShadow: boolean = true;

  /** Optional PBR texture maps. All four maps are fully wired into the
   *  PBR_FRAG shader and renderer: albedo (`map`), normal (`normalMap`
   *  with derivative-based TBN, no tangent attribute required),
   *  metallic-roughness (`metallicRoughnessMap`, GLTF G=roughness B=metallic),
   *  and emissive (`emissiveMap`, multiplied by `emissive` uniform). */
  map: Texture | null = null;
  normalMap: Texture | null = null;
  /** Normal map strength (0 = no effect, 1 = full, >1 = exaggerated). */
  normalScale: number = 1.0;
  metallicRoughnessMap: Texture | null = null;
  emissiveMap: Texture | null = null;

  /** Renderer fills this in after compiling. */
  program: ShaderProgram | null = null;
  /** Optional: position of the program in the renderer's cache. */
  programKey: string = 'standard';

  /** Convenience constructor for the common hex-color case. */
  static fromHex(hex: string): StandardMaterial {
    const m = new StandardMaterial();
    m.baseColor = hexToRgb(hex);
    return m;
  }

  onBeforeCompile(_shader: ShaderObject, _renderer?: unknown): void {
    // 默认 no-op;PhysicalMaterial 或用户可覆盖以注入 PBR 扩展 chunk。
  }

  customProgramCacheKey(): string {
    return this.onBeforeCompile.toString();
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}

/** Program key + vert/frag source pair. The renderer reads this to know
 *  which shaders to compile for a material. */
export function getStandardProgramKey(): string {
  return 'standard';
}

export const STANDARD_VERTEX_SRC = PBR_VERT;
export const STANDARD_FRAGMENT_SRC = PBR_FRAG;

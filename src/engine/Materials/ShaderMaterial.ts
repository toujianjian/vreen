// ShaderMaterial — 用户可编程材质。
//
// 持有 GLSL 源 + uniform 字典,Renderer 负责编译并应用。Uniform 支持类型:
//   number / boolean / number[2-4] / THREE-like 数组 / sampler2D (Texture)
//
// 用法:
//   const mat = new ShaderMaterial({
//     vertexSrc: `...`,
//     fragmentSrc: `...`,
//     uniforms: { u_time: 0, u_color: new Vector3(1, 0, 0) },
//     defines: ['USE_FOG'],
//   });
//   const mesh = new Mesh(geom, mat);
//   // 每帧更新 uniform:
//   mat.uniforms.u_time = performance.now() / 1000;

import { BasicMaterial } from '../Core/Material';
import type { ShaderProgram } from '../Renderer/ShaderProgram';
import type { Texture } from '../Core/Texture';

export type UniformValue =
  | number
  | boolean
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number]
  | { x: number; y: number; z: number; w?: number }
  | Float32Array
  | Texture;

export interface ShaderMaterialOptions {
  /** Vertex shader source. Must start with `#version 300 es` (the renderer
   *  prepends defines after that). */
  vertexSrc: string;
  /** Fragment shader source. Same version rules. */
  fragmentSrc: string;
  /** Uniform name → value. Values are sent every frame via uniform setters. */
  uniforms?: Record<string, UniformValue>;
  /** `#define` lines inserted after `#version 300 es`. */
  defines?: string[];
  /** Whether this material receives shadow. (Renderer 在 _drawMesh 中读取) */
  receiveShadow?: boolean;
  /** Whether to enable backface culling. (尚未被 renderer 实现) */
  transparent?: boolean;
}

/** Hash FNV-1a — 用于 cache key(快速但不抗碰撞,只用于同源程序去重)。 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class ShaderMaterial extends BasicMaterial {
  override readonly type: string = 'Shader';
  override readonly uuid: string;
  readonly vertexSrc: string;
  readonly fragmentSrc: string;
  readonly defines: string[];
  uniforms: Record<string, UniformValue>;
  receiveShadow: boolean;
  transparent: boolean;

  /** 缓存的 program(由 Renderer 填入)。 */
  program: ShaderProgram | null = null;
  /** 自定义 cache key,可选覆盖;默认 hash(vertSrc + fragSrc + defines)。 */
  programKey: string;

  constructor(opts: ShaderMaterialOptions) {
    super();
    this.uuid = `sm_${fnv1a(opts.vertexSrc + '|' + opts.fragmentSrc)}_${nextShaderId()}`;
    this.vertexSrc = opts.vertexSrc;
    this.fragmentSrc = opts.fragmentSrc;
    this.defines = opts.defines ?? [];
    this.uniforms = { ...(opts.uniforms ?? {}) } as Record<string, UniformValue>;
    this.receiveShadow = opts.receiveShadow ?? false;
    this.transparent = opts.transparent ?? false;
    this.programKey = fnv1a(
      this.defines.join('|') + '|' + opts.vertexSrc + '|' + opts.fragmentSrc,
    );
  }

  /** Update a uniform (sugar; same as mat.uniforms.u_time = v). */
  setUniform(name: string, value: UniformValue): void {
    this.uniforms[name] = value;
  }
}

let _shaderId = 0;
function nextShaderId(): string {
  return ((++_shaderId) * 0x9e3779b1 & 0xffffffff).toString(16).padStart(8, '0');
}

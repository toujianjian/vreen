// FilmGrainPass — 胶片颗粒后处理 Pass (o3de Atom FilmGrain class)。
//
// 适配自 o3de Atom `FilmGrain.azsl` + `FilmGrainSettings` + `FilmGrainConstants`。
// o3de 算法 (来自 FilmGrain.azsl MainCS):
//   1. grainUV = tilingScale * pixelCoord / grainTextureSize
//                 + float2(0.6379, 1.7358) * trunc(time * 24)   // 24fps 动画
//   2. grain = grainTexture.Sample(grainUV).r   // 或程序化 hash 噪声
//   3. lum = dot(rgb, float3(0.21, 0.72, 0.07))  // Rec.601 luma
//   4. grain *= lerp(1, (lum - lum*lum) * 4, luminanceDampening)
//      // 4x(1-x) 阻尼:纯黑(lum=0)/纯白(lum=1)处颗粒消失,中间调(lum=0.5)峰值
//   5. rgb = lerp(rgb, grain, intensity)          // 替换式混合(非叠加)
//
// 与 three.js FilmShader 的差异:
//   * three.js 用 hash 噪声 + scanline,纯叠加 (color += noise * amount);
//     本实现支持 grain 纹理 + 程序化噪声两种路径,采用 o3de 替换式 lerp。
//   * three.js 无亮度阻尼;本实现采用 o3de 4x(1-x) 公式,
//     纯黑/纯白处颗粒消失 (模拟胶片在极暗/极亮处无颗粒的物理特性)。
//   * 24fps 动画 (trunc(time*24) 模拟胶片帧率,与 o3de 一致),
//     而非 three.js 的连续 fract(time)。
//
// 1:1 CPU/GPU 参考:filmGrainPixel() 纯函数不依赖 WebGL,可在无头环境测试。
// hash21() CPU 实现与 GLSL hash21() 位精确一致 (相同输入 → 相同输出)。
//
// 与 soup3D 对比:
//   - soup3D 无任何后处理 (无 bloom、无 tonemapping、无 film grain),
//     仅有一张全屏图覆盖做 HUD。
//   - VREEN FilmGrainPass 提供 o3de 级胶片颗粒 (亮度阻尼 + 纹理/程序化双路径 +
//     24fps 动画),为电影感渲染管线补齐最后一块拼图。

import { RenderPass, type PassContext } from '../RenderPass';
import { POST_VERT as POST_VERT_SRC, FILM_GRAIN_FRAG } from '../../Materials/shaders';

// ─── 类型 ──────────────────────────────────────────────────────────

/** RGB 颜色三元组 (0..1)。 */
export type FGColor = [r: number, g: number, b: number];

/** 噪声生成路径。 */
export type GrainNoiseType = 'hash' | 'texture';

/** FilmGrain 配置 (与 o3de FilmGrainParams 1:1 对应 + 扩展)。 */
export interface FilmGrainOptions {
  /** 颗粒强度 (0..1, o3de default 0.2)。 */
  intensity?: number;
  /** 亮度阻尼 (0..1, o3de default 0.0; 0=全亮度均匀, 1=4x(1-x) 中间调峰值)。 */
  luminanceDampening?: number;
  /** 平铺缩放 (o3de default 1.0; 控制 grain 纹理 UV 缩放)。 */
  tilingScale?: number;
  /** 颗粒大小 (texel 倍数, 程序化噪声用, 典型 1..4, default 1.5)。 */
  size?: number;
  /** 噪声类型 ('hash'=程序化, 'texture'=预计算纹理, default 'hash')。 */
  noiseType?: GrainNoiseType;
  /** 是否每帧动画 (24fps 模拟胶片帧率, default true)。 */
  animated?: boolean;
  /** 当前时间种子 (秒)。 */
  time?: number;
  /** 是否启用 (default false)。 */
  enabled?: boolean;
}

/** filmGrainPixel() 的运行时参数 (已展开默认值)。 */
export interface FilmGrainParams {
  intensity: number;
  luminanceDampening: number;
  tilingScale: number;
  size: number;
  animated: boolean;
  time: number;
  /** grain 纹理尺寸 (texture 路径用, 程序化路径用 screenWidth 作为虚拟尺寸)。 */
  grainTextureSize: number;
}

/** o3de 默认参数 (FilmGrainConstants.h)。 */
export const DEFAULT_FILM_GRAIN_PARAMS: FilmGrainParams = {
  intensity: 0.2,
  luminanceDampening: 0.0,
  tilingScale: 1.0,
  size: 1.5,
  animated: true,
  time: 0.0,
  grainTextureSize: 1024,
};

// ─── CPU 参考实现 (1:1 对应 GLSL) ──────────────────────────────────

/** fract() — GLSL fract 的 JS 等价 (x - floor(x))。 */
function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * hash21 — 2D → 1D 哈希噪声 (与 GLSL hash21 位精确一致)。
 *
 * GLSL 源:
 *   vec3 p3 = fract(vec3(p.xyx) * 0.1031);
 *   p3 += dot(p3, p3.yzx + 33.33);
 *   return fract((p3.x + p3.y) * p3.z);
 *
 * @param px  整数 x 坐标 (GLSL floor 后传入)。
 * @param py  整数 y 坐标。
 * @returns 0..1 哈希值。
 */
export function hash21(px: number, py: number): number {
  // vec3 p3 = fract(vec3(p.xyx) * 0.1031)
  let p3x = fract(px * 0.1031);
  let p3y = fract(py * 0.1031);
  let p3z = fract(px * 0.1031); // p.xyx → (x, y, x)
  // p3 += dot(p3, p3.yzx + 33.33)
  // p3.yzx = (p3y, p3z, p3x)
  // dot(p3, p3.yzx + 33.33) = p3x*(p3y+33.33) + p3y*(p3z+33.33) + p3z*(p3x+33.33)
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d;
  p3y += d;
  p3z += d;
  // return fract((p3.x + p3.y) * p3.z)
  return fract((p3x + p3y) * p3z);
}

/**
 * mirrorWrap — Mirror 地址模式 (o3de AddressU/V = Mirror)。
 * 将 UV 折回 [0, 1] 范围:0→0, 0.5→0.5, 1→0/1, 1.5→0.5, 2→0。
 */
function mirrorWrap(u: number): number {
  const m = u % 2;
  const r = m < 0 ? m + 2 : m;
  return r > 1 ? 2 - r : r;
}

/**
 * filmGrainPixel — CPU 参考像素计算 (1:1 对应 GLSL main())。
 *
 * 完整复现 o3de FilmGrain.azsl MainCS 的算法:
 *   1. 计算 grain UV (24fps 动画)
 *   2. 采样 grain (纹理 or 程序化 hash)
 *   3. 亮度阻尼 4x(1-x)
 *   4. 替换式 lerp
 *
 * @param rgb      输入颜色 [r, g, b] (0..1)。
 * @param pixelX   像素 x 坐标 (0..width-1)。
 * @param pixelY   像素 y 坐标 (0..height-1)。
 * @param params   FilmGrain 参数。
 * @param sampleGrainTexture  可选:grain 纹理采样函数 (u, v) → [0,1]。
 *                             提供时走 texture 路径,否则走 hash 路径。
 * @returns 处理后颜色 [r, g, b]。
 */
export function filmGrainPixel(
  rgb: FGColor,
  pixelX: number,
  pixelY: number,
  params: FilmGrainParams,
  sampleGrainTexture?: (u: number, v: number) => number,
): FGColor {
  // ── 1. 计算 grain UV (o3de: tilingScale * pixelCoord / grainSize + 24fps) ──
  let grainU = (params.tilingScale * pixelX) / params.grainTextureSize;
  let grainV = (params.tilingScale * pixelY) / params.grainTextureSize;
  if (params.animated) {
    // o3de: grainUV += float2(0.6379, 1.7358) * trunc(time * 24)
    const frame = Math.trunc(params.time * 24);
    grainU += 0.6379 * frame;
    grainV += 1.7358 * frame;
  }

  // ── 2. 采样 grain ──────────────────────────────────────────────────
  let grain: number;
  if (sampleGrainTexture) {
    // Mirror 地址模式 (o3de AddressU/V = Mirror)。
    grain = sampleGrainTexture(mirrorWrap(grainU), mirrorWrap(grainV));
  } else {
    // 程序化 hash 噪声:对像素坐标按 size 量化后取 hash。
    const sx = pixelX / Math.max(params.size, 1);
    const sy = pixelY / Math.max(params.size, 1);
    if (params.animated) {
      // 24fps 动画 (与 o3de texture 路径一致:trunc(time * 24))。
      const frame = Math.trunc(params.time * 24);
      grain = hash21(
        Math.floor(sx + 0.6379 * frame),
        Math.floor(sy + 1.7358 * frame),
      );
    } else {
      grain = hash21(Math.floor(sx), Math.floor(sy));
    }
  }

  // ── 3. 亮度阻尼 (o3de: 4x(1-x), 峰值在 lum=0.5) ───────────────────
  // lum = dot(rgb, vec3(0.21, 0.72, 0.07))  — Rec.601 luma (o3de 用此系数)
  const lum = rgb[0] * 0.21 + rgb[1] * 0.72 + rgb[2] * 0.07;
  // dampening = (lum - lum*lum) * 4 = 4 * lum * (1 - lum)
  // lum=0 → 0, lum=0.5 → 1, lum=1 → 0
  const dampening = (lum - lum * lum) * 4;
  // grain *= lerp(1, dampening, luminanceDampening)
  grain *= 1 * (1 - params.luminanceDampening) + dampening * params.luminanceDampening;

  // ── 4. 替换式 lerp (o3de: rgb = lerp(rgb, grain, intensity)) ──────
  const r = rgb[0] * (1 - params.intensity) + grain * params.intensity;
  const g = rgb[1] * (1 - params.intensity) + grain * params.intensity;
  const b = rgb[2] * (1 - params.intensity) + grain * params.intensity;

  // clamp [0, 1] (与 GLSL clamp(result, 0, 1) 一致)
  return [
    Math.min(1, Math.max(0, r)),
    Math.min(1, Math.max(0, g)),
    Math.min(1, Math.max(0, b)),
  ];
}

// ─── GPU Pass ─────────────────────────────────────────────────────

/**
 * FilmGrainPass — 胶片颗粒后处理 Pass。
 *
 * ```ts
 * const pass = new FilmGrainPass({ intensity: 0.3, luminanceDampening: 0.8 });
 * pass.time = elapsedTime;  // 每帧更新
 * pass.enabled = true;
 * // 在后处理管线中:
 * const output = pass.apply(inputTexture, ctx);
 * ```
 *
 * CPU 测试 (无 WebGL):
 * ```ts
 * import { filmGrainPixel, DEFAULT_FILM_GRAIN_PARAMS } from './FilmGrainPass';
 * const [r, g, b] = filmGrainPixel([0.5, 0.5, 0.5], 100, 200, {
 *   ...DEFAULT_FILM_GRAIN_PARAMS,
 *   intensity: 0.3,
 *   luminanceDampening: 0.8,
 * });
 * ```
 */
export class FilmGrainPass extends RenderPass {
  readonly name = 'film-grain';
  enabled = false;

  /** 颗粒强度 (0..1, o3de default 0.2)。 */
  intensity = DEFAULT_FILM_GRAIN_PARAMS.intensity;
  /** 亮度阻尼 (0..1, o3de default 0.0; 0=均匀, 1=4x(1-x) 峰值)。 */
  luminanceDampening = DEFAULT_FILM_GRAIN_PARAMS.luminanceDampening;
  /** 平铺缩放 (o3de default 1.0)。 */
  tilingScale = DEFAULT_FILM_GRAIN_PARAMS.tilingScale;
  /** 颗粒大小 (texel 倍数, 程序化噪声用, default 1.5)。 */
  size = DEFAULT_FILM_GRAIN_PARAMS.size;
  /** 噪声类型。 */
  noiseType: GrainNoiseType = 'hash';
  /** 是否动画 (24fps)。 */
  animated = DEFAULT_FILM_GRAIN_PARAMS.animated;
  /** 当前时间种子 (秒)。由外部每帧更新。 */
  time = DEFAULT_FILM_GRAIN_PARAMS.time;

  /** 可选:预计算 grain 纹理 (noiseType='texture' 时使用)。 */
  grainTexture: WebGLTexture | null = null;
  /** grain 纹理尺寸 (宽=高, 用于 UV 计算)。 */
  grainTextureSize = DEFAULT_FILM_GRAIN_PARAMS.grainTextureSize;

  constructor(opts: FilmGrainOptions = {}) {
    super();
    if (opts.intensity !== undefined) this.intensity = opts.intensity;
    if (opts.luminanceDampening !== undefined) this.luminanceDampening = opts.luminanceDampening;
    if (opts.tilingScale !== undefined) this.tilingScale = opts.tilingScale;
    if (opts.size !== undefined) this.size = opts.size;
    if (opts.noiseType !== undefined) this.noiseType = opts.noiseType;
    if (opts.animated !== undefined) this.animated = opts.animated;
    if (opts.time !== undefined) this.time = opts.time;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
  }

  apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    const gl = ctx.gl;
    const res = ctx.resources;

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = ctx.getProgram('film-grain', POST_VERT_SRC, FILM_GRAIN_FRAG);
    prog.use();

    // 输入颜色纹理。
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    prog.setUniformSampler('u_colorMap', 0);

    // 基础参数。
    prog.setUniform1f('u_intensity', this.intensity);
    prog.setUniform1f('u_size', this.size);
    prog.setUniform1i('u_animated', this.animated ? 1 : 0);
    prog.setUniform1f('u_time', this.time);
    prog.setUniform2f('u_screenSize', res.width, res.height);

    // o3de 扩展参数。
    prog.setUniform1f('u_luminanceDampening', this.luminanceDampening);
    prog.setUniform1f('u_tilingScale', this.tilingScale);
    prog.setUniform1i('u_useGrainTexture', this.noiseType === 'texture' && this.grainTexture ? 1 : 0);
    prog.setUniform1f('u_grainTextureSize', this.grainTextureSize);

    // 可选 grain 纹理 (TEXTURE1)。
    if (this.noiseType === 'texture' && this.grainTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
      prog.setUniformSampler('u_grainTexture', 1);
    }

    gl.bindVertexArray(ctx.fullscreenQuad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return res.finalTexture;
  }
}

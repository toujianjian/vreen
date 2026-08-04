// OutputTransformPass — ACES 输出变换 + 多色调映射器后处理 Pass。
//
// 适配 o3de Atom OutputTransform.azsl + Tonemap.azsli,实现 10 种色调映射算子:
//   - Reinhard         : 经典 Reinhard (2002)
//   - ReinhardExtended : 带白点的扩展 Reinhard (亮度域)
//   - AcesFitted       : Stephen Hill 拟合 ACES RRT+ODT
//   - AcesFilmic       : Narkowicz 2015 ACES Filmic 近似
//   - Filmic           : John Hable Uncharted 2 Filmic
//   - Agx              : Troy Sobotka AgX (2023, Blender/Filament)
//   - AgxGolden        : AgX + 暖金色调
//   - AgxPunchy        : AgX + 高对比/高饱和
//   - AgxWarm          : AgX + 微暖
//   - PbrNeutral       : Khronos PBR Neutral (保持 PBR 色彩准确性)
//
// 支持 2 种传输函数:
//   - Gamma22           : sRGB Gamma 2.2 (标准 LDR 输出)
//   - PerceptualQuantizer: SMPTE ST 2084 PQ (HDR10 输出)
//
// 色彩空间:输入 ACEScg 线性 → 输出 sRGB (Gamma 或 PQ)
// 管线位置:所有 HDR 效果之后、最终显示之前。
//
// 参考:
//   - o3de Atom: OutputTransform.azsl, Tonemap.azsli, Aces.azsli
//   - ACES 1.0: RRT + ODT
//   - AgX: https://github.com/sobotka/AgX
//   - PBR Neutral: https://github.com/KhronosGroup/ToneMapping
//   - SMPTE ST 2084-2014 (PQ)

import { OUTPUT_TRANSFORM_FRAG, POST_VERT } from '../../Materials/shaders';
import { ShaderProgram } from '../ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('OutputTransformPass');

// ── 类型 ──────────────────────────────────────────────────────────

/** 色调映射算子类型。 */
export type TonemapperType =
  | 'none'
  | 'reinhard'
  | 'reinhardExtended'
  | 'acesFitted'
  | 'acesFilmic'
  | 'filmic'
  | 'agx'
  | 'agxGolden'
  | 'agxPunchy'
  | 'agxWarm'
  | 'pbrNeutral';

/** 传输函数类型。 */
export type TransferFunctionType = 'none' | 'gamma22' | 'perceptualQuantizer';

/** RGB 颜色三元组 [r, g, b]。 */
export type OTColor = [r: number, g: number, b: number];

/** OutputTransform 选项。 */
export interface OutputTransformOptions {
  /** 色调映射算子(默认 'agx')。 */
  tonemapper?: TonemapperType;
  /** 传输函数(默认 'gamma22')。 */
  transferFunction?: TransferFunctionType;
  /** 曝光补偿 EV(默认 0)。color *= 2^exposure。 */
  exposure?: number;
  /** HDR 影院黑点(cd/m²,默认 0,PQ 模式使用)。 */
  cinemaBlack?: number;
  /** HDR 影院白点(cd/m²,默认 100,PQ 模式使用)。 */
  cinemaWhite?: number;
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
}

// ── 矩阵工具 ──────────────────────────────────────────────────────

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  // 行主序: a[row*3+col]
  // (a * b)[i][j] = sum_k a[i][k] * b[k][j]
  const r: number[] = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] =
        a[i * 3 + 0] * b[0 * 3 + j] +
        a[i * 3 + 1] * b[1 * 3 + j] +
        a[i * 3 + 2] * b[2 * 3 + j];
    }
  }
  return r as unknown as Mat3;
}

function mulMat3Vec3(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// ── ACES 色彩空间矩阵 (o3de AcesColorSpaceConversion.azsli) ──────

/** AP1 (ACEScg) → XYZ (行主序)。 */
const AP1_TO_XYZ: Mat3 = [
  0.66245413, 0.13400421, 0.15618768,
  0.27222872, 0.67408168, 0.05368952,
  -0.00557466, 0.00406073, 1.01033902,
];

/** XYZ → sRGB (行主序)。 */
const XYZ_TO_SRGB: Mat3 = [
  3.24096942, -1.53738296, -0.49861076,
  -0.96924388, 1.87596786, 0.04155510,
  0.05563002, -0.20397684, 1.05697131,
];

/** D60 → D65 色度适应 (行主序)。 */
const D60_TO_D65: Mat3 = [
  0.987224, -0.00611327, 0.0159533,
  -0.00759836, 1.00186, 0.00533002,
  0.00307257, -0.00509595, 1.08168,
];

/** ACEScg → Linear sRGB 组合矩阵 = XYZ_TO_SRGB * D60_TO_D65 * AP1_TO_XYZ。 */
export const ACESCG_TO_SRGB: Mat3 = mulMat3(XYZ_TO_SRGB, mulMat3(D60_TO_D65, AP1_TO_XYZ));

// ── PQ 常量 (SMPTE ST 2084-2014) ─────────────────────────────────

const PQ_M1 = 0.1593017578125;
const PQ_M2 = 78.84375;
const PQ_C1 = 0.8359375;
const PQ_C2 = 18.8515625;
const PQ_C3 = 18.6875;
const PQ_C = 10000.0;

/** Rec709 亮度权重。 */
const REC709_LUMA: [number, number, number] = [0.2126, 0.7152, 0.0722];

// ── 纯 CPU 色调映射函数 (与 GLSL 1:1 对应) ──────────────────────

/** Reinhard: x / (1 + x)。 */
export function tonemapReinhard(color: OTColor | ArrayLike<number>): OTColor {
  return [
    color[0] / (1 + color[0]),
    color[1] / (1 + color[1]),
    color[2] / (1 + color[2]),
  ];
}

/** 扩展 Reinhard(带白点,亮度域)。 */
export function tonemapReinhardExtended(
  color: OTColor | ArrayLike<number>,
  maxWhiteLuminance = 6.0,
): OTColor {
  const r = color[0], g = color[1], b = color[2];
  const inputLuma = Math.max(r * REC709_LUMA[0] + g * REC709_LUMA[1] + b * REC709_LUMA[2], 1e-10);
  const num = inputLuma * (1 + inputLuma / (maxWhiteLuminance * maxWhiteLuminance));
  const outLuma = num / (1 + inputLuma);
  const scale = outLuma / inputLuma;
  return [r * scale, g * scale, b * scale];
}

/** ACES Fitted (Stephen Hill,输入 ACEScg)。 */
export function tonemapAcesFitted(color: OTColor | ArrayLike<number>): OTColor {
  const a = 0.0245786, b = 0.000090537, c = 0.983729, d = 0.4329510, e = 0.238081;
  const f = (x: number) => {
    const v = (x * (x + a) - b) / (x * (c * x + d) + e);
    return Math.max(0, Math.min(1, v));
  };
  return [f(color[0]), f(color[1]), f(color[2])];
}

/** ACES Filmic (Narkowicz 2015 近似)。 */
export function tonemapAcesFilmic(color: OTColor | ArrayLike<number>): OTColor {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  const f = (x: number) => {
    const v = (x * (a * x + b)) / (x * (c * x + d) + e);
    return Math.max(0, Math.min(1, v));
  };
  return [f(color[0]), f(color[1]), f(color[2])];
}

/** Filmic (John Hable, Uncharted 2)。 */
export function tonemapFilmic(color: OTColor | ArrayLike<number>): OTColor {
  const f = (x: number) => {
    const c = Math.max(0, x - 0.004);
    return (c * (6.2 * c + 0.5)) / (c * (6.2 * c + 1.7) + 0.06);
  };
  return [f(color[0]), f(color[1]), f(color[2])];
}

// ── AgX 色调映射 ─────────────────────────────────────────────────

/** AgX inset 矩阵 (列主序 → 转为行主序使用)。 */
const AGX_INSET: Mat3 = [
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859,
];

/** AgX outset 矩阵 (列主序 → 转为行主序使用)。 */
const AGX_OUTSET: Mat3 = [
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
];

const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;

/** AgX 内部实现(支持自定义 CDL 参数)。 */
export function tonemapAgxInternal(
  color: OTColor | ArrayLike<number>,
  slope: [number, number, number] = [1, 1, 1],
  offset: [number, number, number] = [0, 0, 0],
  power: [number, number, number] = [1, 1, 1],
  saturation = 1.0,
): OTColor {
  const input: [number, number, number] = [color[0], color[1], color[2]];

  // 1. AgX 变换
  let c = mulMat3Vec3(AGX_INSET, input.map(v => Math.max(v, 0)) as [number, number, number]);

  // Log2 编码
  c = c.map(v => Math.max(v, 1e-10)) as [number, number, number];
  c = c.map(v => Math.log2(v)) as [number, number, number];
  c = c.map(v => (v - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)) as [number, number, number];
  c = c.map(v => Math.max(0, Math.min(1, v))) as [number, number, number];

  // Sigmoid 近似 (7 阶多项式,来自 Filament)
  const sigmoid = (x: number) => {
    const x2 = x * x;
    const x4 = x2 * x2;
    const x6 = x4 * x2;
    return -17.86 * x6 * x
      + 78.01 * x6
      - 126.7 * x4 * x
      + 92.06 * x4
      - 28.72 * x2 * x
      + 4.361 * x2
      - 0.1718 * x
      + 0.002857;
  };
  c = c.map(sigmoid) as [number, number, number];

  // 2. AgX Look (ASC-CDL)
  const luma = c[0] * REC709_LUMA[0] + c[1] * REC709_LUMA[1] + c[2] * REC709_LUMA[2];
  c = [
    Math.pow(c[0] * slope[0] + offset[0], power[0]),
    Math.pow(c[1] * slope[1] + offset[1], power[1]),
    Math.pow(c[2] * slope[2] + offset[2], power[2]),
  ];
  c = [
    luma + saturation * (c[0] - luma),
    luma + saturation * (c[1] - luma),
    luma + saturation * (c[2] - luma),
  ];

  // 3. AgX EOTF
  c = mulMat3Vec3(AGX_OUTSET, c);
  c = c.map(v => Math.pow(Math.max(v, 0), 2.2)) as [number, number, number];

  return [c[0], c[1], c[2]];
}

/** AgX 基础(中性)。 */
export function tonemapAgx(color: OTColor | ArrayLike<number>): OTColor {
  return tonemapAgxInternal(color, [1, 1, 1], [0, 0, 0], [1, 1, 1], 1.0);
}

/** AgX Golden(暖金色调)。 */
export function tonemapAgxGolden(color: OTColor | ArrayLike<number>): OTColor {
  return tonemapAgxInternal(color, [1, 0.9, 0.5], [0, 0, 0], [0.8, 0.8, 0.8], 1.3);
}

/** AgX Punchy(高对比/高饱和)。 */
export function tonemapAgxPunchy(color: OTColor | ArrayLike<number>): OTColor {
  return tonemapAgxInternal(color, [1, 1, 1], [0, 0, 0], [1.35, 1.35, 1.35], 1.4);
}

/** AgX Warm(微暖)。 */
export function tonemapAgxWarm(color: OTColor | ArrayLike<number>): OTColor {
  return tonemapAgxInternal(color, [1, 0.95, 0.85], [0, 0, 0], [0.95, 0.95, 0.95], 1.1);
}

// ── PBR Neutral (Khronos) ────────────────────────────────────────

/** Khronos PBR Neutral 色调映射(保持 PBR 色彩准确性)。 */
export function tonemapPbrNeutral(color: OTColor | ArrayLike<number>): OTColor {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;

  const r = color[0], g = color[1], b = color[2];
  let rr = r, gg = g, bb = b;

  const x = Math.min(rr, Math.min(gg, bb));
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  rr -= off; gg -= off; bb -= off;

  const peak = Math.max(rr, Math.max(gg, bb));
  if (peak < startCompression) {
    return [rr, gg, bb];
  }

  const d = 1.0 - startCompression;
  const newPeak = 1.0 - d * d / (peak + d - startCompression);
  const scale = newPeak / peak;
  rr *= scale; gg *= scale; bb *= scale;

  const gr = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return [
    rr + gr * (newPeak - rr),
    gg + gr * (newPeak - gg),
    bb + gr * (newPeak - bb),
  ];
}

// ── 传输函数 ─────────────────────────────────────────────────────

/** ACEScg → Linear sRGB 色彩空间转换。 */
export function acescgToLinearSrgb(color: OTColor | ArrayLike<number>): OTColor {
  const out = mulMat3Vec3(ACESCG_TO_SRGB, [color[0], color[1], color[2]]);
  return [out[0], out[1], out[2]];
}

/** 线性 → PQ 编码 (SMPTE ST 2084)。输入:线性 cd/m²,输出:0..1。 */
export function perceptualQuantizerRev(C: number): number {
  const L = C / PQ_C;
  const Lm = Math.pow(L, PQ_M1);
  const N = (PQ_C1 + PQ_C2 * Lm) / (1 + PQ_C3 * Lm);
  return Math.pow(N, PQ_M2);
}

/** 线性 → PQ 编码 (vec3)。 */
export function perceptualQuantizerRevF3(color: OTColor | ArrayLike<number>): OTColor {
  return [
    perceptualQuantizerRev(color[0]),
    perceptualQuantizerRev(color[1]),
    perceptualQuantizerRev(color[2]),
  ];
}

/** Linear CV → cd/m²。 */
export function linearCVToY(linCV: number, yMax: number, yMin: number): number {
  return linCV * (yMax - yMin) + yMin;
}

// ── 统一输出变换函数 ─────────────────────────────────────────────

/**
 * 完整的输出变换(纯 CPU,与 GPU Pass 1:1 对应)。
 *
 * 流程:
 * 1. 曝光补偿:color *= 2^exposure
 * 2. 色调映射(在 ACEScg 或 Linear sRGB 中,取决于算子)
 * 3. 传输函数(Gamma 2.2 或 PQ)
 *
 * @param color    输入颜色 [r, g, b](ACEScg 线性,HDR)
 * @param opts     选项
 * @returns        输出颜色 [r, g, b](LDR 或 PQ 编码)
 */
export function outputTransform(
  color: OTColor | ArrayLike<number>,
  opts: OutputTransformOptions = {},
): OTColor {
  const tm = opts.tonemapper ?? 'agx';
  const tf = opts.transferFunction ?? 'gamma22';
  const exposure = opts.exposure ?? 0;

  // 1. 曝光补偿
  let c: [number, number, number] = [
    color[0] * Math.pow(2, exposure),
    color[1] * Math.pow(2, exposure),
    color[2] * Math.pow(2, exposure),
  ];

  // 2. 色调映射
  // AcesFitted 在 ACEScg 空间工作,先 tonemap 再转换
  // 其他算子先转换到 Linear sRGB 再 tonemap
  if (tm === 'acesFitted') {
    const tm_c = tonemapAcesFitted(c);
    c = mulMat3Vec3(ACESCG_TO_SRGB, tm_c) as [number, number, number];
  } else if (tm !== 'none') {
    c = mulMat3Vec3(ACESCG_TO_SRGB, c) as [number, number, number];
    switch (tm) {
      case 'reinhard': c = tonemapReinhard(c) as [number, number, number]; break;
      case 'reinhardExtended': c = tonemapReinhardExtended(c) as [number, number, number]; break;
      case 'acesFilmic': c = tonemapAcesFilmic(c) as [number, number, number]; break;
      case 'filmic': c = tonemapFilmic(c) as [number, number, number]; break;
      case 'agx': c = tonemapAgx(c) as [number, number, number]; break;
      case 'agxGolden': c = tonemapAgxGolden(c) as [number, number, number]; break;
      case 'agxPunchy': c = tonemapAgxPunchy(c) as [number, number, number]; break;
      case 'agxWarm': c = tonemapAgxWarm(c) as [number, number, number]; break;
      case 'pbrNeutral': c = tonemapPbrNeutral(c) as [number, number, number]; break;
    }
  }

  // 3. 传输函数
  if (tf === 'gamma22') {
    c = [Math.pow(c[0], 1 / 2.2), Math.pow(c[1], 1 / 2.2), Math.pow(c[2], 1 / 2.2)];
  } else if (tf === 'perceptualQuantizer') {
    // PQ 模式:先缩放到影院限制范围
    const yMin = opts.cinemaBlack ?? 0;
    const yMax = opts.cinemaWhite ?? 100;
    c = [
      linearCVToY(c[0], yMax, yMin),
      linearCVToY(c[1], yMax, yMin),
      linearCVToY(c[2], yMax, yMin),
    ];
    c = perceptualQuantizerRevF3(c) as [number, number, number];
  }

  return [c[0], c[1], c[2]];
}

// ── GPU Pass ─────────────────────────────────────────────────────

/** 色调映射算子 → shader uniform 值。 */
const TM_MAP: Record<TonemapperType, number> = {
  none: 0,
  reinhard: 1,
  reinhardExtended: 2,
  acesFitted: 3,
  acesFilmic: 4,
  filmic: 5,
  agx: 6,
  agxGolden: 7,
  agxPunchy: 8,
  agxWarm: 9,
  pbrNeutral: 10,
};

const TF_MAP: Record<TransferFunctionType, number> = {
  none: 0,
  gamma22: 1,
  perceptualQuantizer: 2,
};

/**
 * Output Transform Pass — ACES 输出变换 + 多色调映射器。
 *
 * 在场景 HDR 颜色上应用色调映射 + 传输函数,完成 HDR → 显示空间变换。
 * 支持 10 种色调映射算子和 2 种传输函数(Gamma 2.2 / PQ HDR10)。
 *
 * @example
 * ```ts
 * const pass = new OutputTransformPass({
 *   tonemapper: 'agx',
 *   transferFunction: 'gamma22',
 *   exposure: 0,
 * });
 * const ldr = pass.apply(gl, hdrColorTexture);
 * ```
 */
export class OutputTransformPass {
  readonly name = 'output-transform';

  tonemapper: TonemapperType;
  transferFunction: TransferFunctionType;
  exposure: number;
  cinemaBlack: number;
  cinemaWhite: number;
  enabled: boolean;

  private _outputTexture: WebGLTexture | null = null;
  private _fbo: WebGLFramebuffer | null = null;
  private _program: ShaderProgram | null = null;
  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _fullscreenQuadBuf: WebGLBuffer | null = null;
  private _width: number = 0;
  private _height: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: OutputTransformOptions = {}) {
    this.tonemapper = opts.tonemapper ?? 'agx';
    this.transferFunction = opts.transferFunction ?? 'gamma22';
    this.exposure = opts.exposure ?? 0;
    this.cinemaBlack = opts.cinemaBlack ?? 0;
    this.cinemaWhite = opts.cinemaWhite ?? 100;
    this.enabled = opts.enabled ?? true;
  }

  /**
   * 应用输出变换。
   *
   * @param gl            WebGL2 上下文
   * @param colorTexture  输入 HDR 颜色纹理(ACEScg 线性)
   * @returns             输出纹理(LDR sRGB 或 PQ 编码)
   */
  apply(gl: WebGL2RenderingContext, colorTexture: WebGLTexture): WebGLTexture {
    if (!this.enabled) {
      return colorTexture;
    }

    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this._dirty || !this._initialized || this._width !== w || this._height !== h) {
      this._initResources(gl, w, h);
      this._dirty = false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo as WebGLFramebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getProgram(gl);
    prog.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    prog.setUniformSampler('u_colorMap', 0);

    prog.setUniform1i('u_tonemapper', TM_MAP[this.tonemapper] ?? 6);
    prog.setUniform1i('u_transferFunction', TF_MAP[this.transferFunction] ?? 1);
    prog.setUniform1f('u_exposure', this.exposure);
    prog.setUniform2f('u_cinemaLimits', this.cinemaBlack, this.cinemaWhite);

    gl.bindVertexArray(this._fullscreenQuadVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);

    return this._outputTexture as WebGLTexture;
  }

  /** 标记下一帧需要重建资源。 */
  setDirty(): void {
    this._dirty = true;
  }

  /** 释放 GPU 资源。可重复调用。 */
  dispose(gl?: WebGL2RenderingContext): void {
    if (gl) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
      if (this._fullscreenQuadVao) gl.deleteVertexArray(this._fullscreenQuadVao);
      if (this._fullscreenQuadBuf) gl.deleteBuffer(this._fullscreenQuadBuf);
      if (this._program) this._program.dispose();
    }
    this._outputTexture = null;
    this._fbo = null;
    this._fullscreenQuadVao = null;
    this._fullscreenQuadBuf = null;
    this._program = null;
    this._initialized = false;
    this._dirty = true;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext, w: number, h: number): void {
    if (this._initialized) {
      if (this._outputTexture) gl.deleteTexture(this._outputTexture);
      if (this._fbo) gl.deleteFramebuffer(this._fbo);
    }

    // PQ 模式需要更高精度(RGBA16F),Gamma 模式用 RGBA8
    const internalFormat = this.transferFunction === 'perceptualQuantizer'
      ? gl.RGBA16F
      : gl.RGBA8;

    this._outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outputTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!this._fullscreenQuadVao) {
      this._fullscreenQuadBuf = gl.createBuffer();
      this._fullscreenQuadVao = gl.createVertexArray();
      gl.bindVertexArray(this._fullscreenQuadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenQuadBuf);
      const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }

    this._width = w;
    this._height = h;
    this._initialized = true;
    log.debug(`init: ${w}×${h}`);
  }

  private _getProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._program) {
      this._program = new ShaderProgram(gl, POST_VERT, OUTPUT_TRANSFORM_FRAG);
    }
    return this._program;
  }
}

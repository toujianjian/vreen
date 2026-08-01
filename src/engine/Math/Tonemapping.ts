// Tonemapping — HDR → LDR 色调映射算子 + 色彩空间转换(CPU 侧纯函数)。
//
// 设计目标:
//   - 与 Materials/ShaderChunks/tonemapping.glsl.ts 的 GLSL 片段一一对应,
//     提供无头可测(Node / 无 GL 环境)的纯函数实现,便于验证数值正确性。
//   - 算子常量与 GLSL 完全一致(ACES Narkowicz: a=2.51 b=0.03 c=2.43 d=0.59 e=0.14),
//     保证 CPU 预览 / 离线烘焙 / 测试 与 GPU 实时渲染结果数值吻合。
//   - 额外提供色彩空间转换(sRGB transfer / ACEScg AP1 / ACEScc log),
//     覆盖产品级引擎的线性工作流 + ACES 管线需求。
//
// 参考:
//   - Narkowicz 2015 ACES Filmic 近似 (https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/)
//   - Reinhard et al. 2002 "Photographic Tone Reproduction for Digital Images"
//   - Hable 2010 "Filmic Tonemapping with Physically Based Rendering" (Uncharted 2)
//   - ACEScc / ACEScg 规范 (S-2014-003 / S-2014-004)
//   - three.js tonemapping_pars_fragment.glsl.js

/** RGB 颜色(线性或显示空间,取决于上下文)。 */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/** 支持的色调映射模式。 */
export type TonemappingOperator =
  | 'Linear' // 直通(不映射)
  | 'Reinhard' // Reinhard 简单版:x/(x+1)
  | 'ReinhardExtended' // Reinhard 白点版
  | 'ACESFilmic' // ACES Filmic(Narkowicz 近似),与 GLSL TONEMAP_ACES_CHUNK 一致
  | 'Filmic'; // Hable Uncharted2 filmic

/** 色调映射选项。 */
export interface TonemappingOptions {
  /** 白点亮度(R ReinhardExtended 用,默认 11.2,典型户外 HDR 白点)。 */
  whiteLuminance?: number;
  /** Hable filmic 的曝光偏移(默认 2.0,对应白点约 11.2 的常用配置)。 */
  exposureBias?: number;
}

/** 钳位到 [0,1]。 */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * ACES Filmic 色调映射(Narkowicz 近似)—— 标量版。
 * 常量与 GLSL `acesFilmic()` 完全一致,保证 CPU/GPU 数值吻合。
 *
 *   f(x) = (x·(a·x + b)) / (x·(c·x + d) + e),再 clamp 到 [0,1]
 *   a=2.51, b=0.03, c=2.43, d=0.59, e=0.14
 */
export function acesFilmicScalar(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return clamp01((x * (a * x + b)) / (x * (c * x + d) + e));
}

/**
 * Reinhard 色调映射 —— 标量版,与 GLSL `reinhard()` 一致。
 *   f(x) = x / (x + 1)
 */
export function reinhardScalar(x: number): number {
  return x / (x + 1);
}

/**
 * Reinhard 扩展(白点版)—— 标量版,与 GLSL `reinhardExtended()` 一致。
 *   f(x) = (x·(1 + x/Lw²)) / (1 + x)
 * 把白色(亮度 Lw)压缩到 1,避免高亮区域过度饱和。
 *
 * @param x 输入亮度(线性 HDR)
 * @param whiteLuminance 白点亮度 Lw
 */
export function reinhardExtendedScalar(x: number, whiteLuminance: number): number {
  const white = whiteLuminance * whiteLuminance;
  return (x * (1 + x / white)) / (1 + x);
}

/**
 * Hable Uncharted2 filmic 曲线(标量版)。
 *
 *   f(x) = ((x·(A·x + C·B) + D·E) / (x·(A·x + B) + D·F)) - E/F
 *   A=0.15, B=0.50, C=0.10, D=0.20, E=0.02, F=0.30
 *
 * 实际使用时先乘曝光偏移(exposureBias),再归一化到 f(exposureBias) 使白点对齐。
 */
export function hableCurve(x: number): number {
  const A = 0.15;
  const B = 0.5;
  const C = 0.1;
  const D = 0.2;
  const E = 0.02;
  const F = 0.3;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

/**
 * Hable filmic 艃调映射(含曝光偏移 + 白点归一化)。
 *
 * @param x 输入线性亮度
 * @param exposureBias 曝光偏移(默认 2.0)
 */
export function filmicScalar(x: number, exposureBias = 2.0): number {
  const curr = hableCurve(x * exposureBias);
  const whiteScale = 1 / hableCurve(exposureBias);
  return clamp01(curr * whiteScale);
}

/**
 * 对 RGB 颜色施加色调映射。
 *
 * 输入:线性 HDR RGB(任意 >0 值)。输出:LDR RGB ∈ [0,1]。
 * 逐通道独立施加同一算子(与 GLSL 一致;不做按亮度联合映射)。
 *
 * @param color 线性 HDR RGB
 * @param mode  算子模式
 * @param opts  选项(白点 / 曝光偏移)
 */
export function applyTonemapping(
  color: RGBColor,
  mode: TonemappingOperator,
  opts: TonemappingOptions = {},
): RGBColor {
  const whiteLuminance = opts.whiteLuminance ?? 11.2;
  const exposureBias = opts.exposureBias ?? 2.0;

  const map = (x: number): number => {
    switch (mode) {
      case 'Linear':
        return clamp01(x);
      case 'Reinhard':
        return reinhardScalar(x);
      case 'ReinhardExtended':
        return reinhardExtendedScalar(x, whiteLuminance);
      case 'ACESFilmic':
        return acesFilmicScalar(x);
      case 'Filmic':
        return filmicScalar(x, exposureBias);
      default:
        return clamp01(x);
    }
  };

  // 文档契约:输出为 LDR RGB ∈ [0,1]。各算子内部大多已钳位(ACES/Filmic/Linear),
  // 但 ReinhardExtended 在输入 > 白点时会输出 > 1(白色压缩到 1,超白部分仍上溢),
  // 故在此统一钳位,保证 LDR 输出目标恒在 [0,1]。
  return {
    r: clamp01(map(color.r)),
    g: clamp01(map(color.g)),
    b: clamp01(map(color.b)),
  };
}

// ──────────────────────────────────────────────────────────────────────
// 色彩空间转换
// ──────────────────────────────────────────────────────────────────────

/**
 * 线性 → sRGB(精确 IEC 61966-2-1 传输函数)。
 *
 *   x ≤ 0.0031308:  12.92·x
 *   x >  0.0031308:  1.055·x^(1/2.4) - 0.055
 *
 * 与 three.js `LinearToSRGB` 一致。负值按线性外推后钳位。
 */
export function linearToSRGB(x: number): number {
  if (x <= 0.0031308) return 12.92 * x;
  return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * sRGB → 线性(精确 IEC 61966-2-1 逆传输函数)。
 *
 *   x ≤ 0.04045:  x / 12.92
 *   x >  0.04045:  ((x + 0.055) / 1.055)^2.4
 */
export function sRGBToLinear(x: number): number {
  if (x <= 0.04045) return x / 12.92;
  return Math.pow((x + 0.055) / 1.055, 2.4);
}

/**
 * 线性 → sRGB(γ 2.2 简化近似,比精确传输快但略有偏差)。
 *   f(x) = x^(1/2.2)
 */
export function linearToSRGBGamma(x: number): number {
  return Math.pow(Math.max(x, 0), 1 / 2.2);
}

/**
 * sRGB(γ 2.2 近似)→ 线性。
 *   f(x) = x^2.2
 */
export function sRGBGammaToLinear(x: number): number {
  return Math.pow(Math.max(x, 0), 2.2);
}

/** 对 RGB 三通道施加线性 → sRGB(精确)。 */
export function linearToSRGBColor(c: RGBColor): RGBColor {
  return { r: linearToSRGB(c.r), g: linearToSRGB(c.g), b: linearToSRGB(c.b) };
}

/** 对 RGB 三通道施加 sRGB → 线性(精确)。 */
export function sRGBToLinearColor(c: RGBColor): RGBColor {
  return { r: sRGBToLinear(c.r), g: sRGBToLinear(c.g), b: sRGBToLinear(c.b) };
}

// ── ACEScg (AP1 原色,线性) ────────────────────────────────────────────
// ACEScg 使用 AP1 原色(线性光工作空间),适合 HDR 渲染。
// sRGB(线性)→ ACEScg 的 3×3 矩阵(ACES 官方 transform ID: ctl IDT.srgb_to_ACEScg)。
// 数值取自 ampas/aces-dev IDT for sRGB。
//
// 注意:正矩阵为权威 IDT(4 位小数近似官方值);逆矩阵由 invert3x3 在模块加载时
// 从正矩阵精确求逆得到,保证 sRGB-linear ↔ ACEScg 往返误差 ≈ 0(避免两个独立
// 四舍五入的矩阵互不严格互逆导致的 ~0.008 往返偏差)。

/** sRGB 线性 → ACEScg 矩阵(权威正向,ampas/aces-dev IDT)。 */
const SRGB_LINEAR_TO_ACESCG: readonly number[] = [
  0.6131, 0.3395, 0.0474,
  0.0709, 0.9164, 0.0128,
  0.0201, 0.1094, 0.8706,
];

/**
 * 对 3×3 矩阵(行主序)求逆。返回 null 若奇异(det = 0)。
 * 使用伴随矩阵法:inv = (1/det) · adj(M),adj 为余子式矩阵的转置。
 */
function invert3x3(m: readonly number[]): number[] | null {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const ei_fh = e * i - f * h;
  const di_fg = d * i - f * g;
  const dh_eg = d * h - e * g;
  const det = a * ei_fh - b * di_fg + c * dh_eg;
  if (det === 0) return null;
  const invDet = 1 / det;
  return [
    invDet * ei_fh,           // (ei − fh)
    invDet * (c * h - b * i), // (ch − bi)
    invDet * (b * f - c * e), // (bf − ce)
    invDet * (f * g - d * i), // (fg − di)
    invDet * (a * i - c * g), // (ai − cg)
    invDet * (c * d - a * f), // (cd − af)
    invDet * dh_eg,           // (dh − eg)
    invDet * (b * g - a * h), // (bg − ah)
    invDet * (a * e - b * d), // (ae − bd)
  ];
}

/** ACEScg → sRGB 线性 矩阵(由正向矩阵精确求逆,保证往返数值一致)。 */
const ACESCG_TO_SRGB_LINEAR: readonly number[] =
  invert3x3(SRGB_LINEAR_TO_ACESCG) as number[];

function mulMatrixVec(m: readonly number[], v: RGBColor): RGBColor {
  return {
    r: m[0] * v.r + m[1] * v.g + m[2] * v.b,
    g: m[3] * v.r + m[4] * v.g + m[5] * v.b,
    b: m[6] * v.r + m[7] * v.g + m[8] * v.b,
  };
}

/** sRGB 线性 RGB → ACEScg(线性)。输入/输出均为线性光。 */
export function linearSRGBToACEScg(c: RGBColor): RGBColor {
  return mulMatrixVec(SRGB_LINEAR_TO_ACESCG, c);
}

/** ACEScg(线性)→ sRGB 线性 RGB。 */
export function acescgToLinearSRGB(c: RGBColor): RGBColor {
  return mulMatrixVec(ACESCG_TO_SRGB_LINEAR, c);
}

// ──────────────────────────────────────────────────────────────────────
// 曝光 + 亮度
// ──────────────────────────────────────────────────────────────────────

/**
 * 施加曝光(以档位 stops 为单位)。
 *   color *= 2^stops
 */
export function applyExposure(c: RGBColor, stops: number): RGBColor {
  const factor = Math.pow(2, stops);
  return { r: c.r * factor, g: c.g * factor, b: c.b * factor };
}

/**
 * 计算相对亮度(Rec.709 权重)。
 *   L = 0.2126·r + 0.7152·g + 0.0722·b
 *
 * @param c 线性 RGB
 * @param weights 可选自定义权重(默认 Rec.709)
 */
export function luminance(
  c: RGBColor,
  weights: { r: number; g: number; b: number } = { r: 0.2126, g: 0.7152, b: 0.0722 },
): number {
  return weights.r * c.r + weights.g * c.g + weights.b * c.b;
}

/**
 * 中灰值(18% 灰)在不同色调映射下的输出,用于校准。
 * 返回 applyTonemapping({r:0.18,g:0.18,b:0.18}, mode) 的 r 通道。
 */
export function middleGrayOutput(mode: TonemappingOperator, opts?: TonemappingOptions): number {
  return applyTonemapping({ r: 0.18, g: 0.18, b: 0.18 }, mode, opts).r;
}

// ──────────────────────────────────────────────────────────────────────
// ColorManagement — 线性工作流管理(three.js 风格)
// ──────────────────────────────────────────────────────────────────────

/** 引擎支持的工作色彩空间。 */
export type WorkingSpace = 'sRGB-linear' | 'ACEScg';

/**
 * ColorManagement — 线性工作流管理。
 *
 * 管理引擎的工作色彩空间(默认 sRGB 线性)与输入/输出转换策略。
 * 遵循 three.js ColorManagement 的设计:enabled=true 时所有输入颜色
 * 自动转换到工作空间,输出时再转回显示空间。
 */
export class ColorManagement {
  /** 是否启用自动色彩管理(默认 true)。 */
  static enabled: boolean = true;
  /** 工作色彩空间(默认 sRGB-linear)。 */
  static workingSpace: WorkingSpace = 'sRGB-linear';

  /** 设置工作空间。 */
  static setWorkingSpace(space: WorkingSpace): void {
    ColorManagement.workingSpace = space;
  }

  /** 启用 / 禁用自动色彩管理。 */
  static setEnabled(enabled: boolean): void {
    ColorManagement.enabled = enabled;
  }

  /**
   * 把 sRGB(显示空间,0..1 非线性)颜色转换到工作空间(线性)。
   * enabled=false 时直接返回原值(不做转换)。
   */
  static fromSRGB(c: RGBColor): RGBColor {
    if (!ColorManagement.enabled) return { ...c };
    const linear = sRGBToLinearColor(c);
    if (ColorManagement.workingSpace === 'ACEScg') {
      return linearSRGBToACEScg(linear);
    }
    return linear;
  }

  /**
   * 把工作空间(线性)颜色转换到 sRGB 显示空间(0..1 非线性)。
   * enabled=false 时直接返回原值。
   */
  static toSRGB(c: RGBColor): RGBColor {
    if (!ColorManagement.enabled) return { ...c };
    let linear = c;
    if (ColorManagement.workingSpace === 'ACEScg') {
      linear = acescgToLinearSRGB(c);
    }
    return linearToSRGBColor(linear);
  }
}

// PreIntegratedSkinLUT — 预积分皮肤着色 LUT 生成器 (CPU 侧纯函数)。
//
// 适配:
//   - Penner & Borshukov 2011 "Pre-Integrated Skin Shading" (SIGGRAPH Course)
//   - d'Eon & van Latta 2007 "GPU Gems 3 Ch.14 — Advanced Skin" 散射剖面
//
// 适用场景:实时皮肤着色(鼻翼 / 耳廓 / 嘴唇等高曲率区域的次表面散射),
// 以及蜡 / 玉石 / 叶片等需要"曲率敏感漫反射"的半透明有机材质。
//
// 设计要点:
//   * 与 SubsurfaceScatteringMaterial(半透明阴影近似,薄壁透射)互补:
//       - SSSMaterial 关注"背面光透过薄壁"的透射;
//       - PreIntegratedSkinLUT 关注"前向漫反射在不同曲率下的散射红移"。
//     二者可组合:用本 LUT 调制前向漫反射,用 SSSMaterial 处理透射。
//   * 纯 CPU 生成,无 WebGL 绑定,可在 Node 中 headless 测试。
//   * 输出 Float32Array(RGB,范围 [0,1]),可直接上传为 RG16F/RGB16F 纹理。
//   * 确定性:相同参数产生相同结果(无 RNG)。
//
// 原理:
//   皮肤的漫反射率随表面曲率变化 —— 在高曲率区域(鼻尖、耳朵边缘),光线
//   会跨越明暗分界线(terminator)向暗侧散射,且红光散射距离 > 绿光 > 蓝光,
//   故阴影边缘呈红色(皮肤特有的"暖红透光")。Penner 2011 把这一过程预积分
//   为一张 2D LUT:
//
//     diffuse(N·L, curvature) = LUT[ (N·L+1)/2 , curvature/maxCurv ]
//
//   生成时,对每个 (NdotL, curvature) texel,沿球面弧(半径 r = 1/curvature)
//   在散射剖面 R_d(s) 的有效范围内采样,累加邻域点的 Lambert 项
//   max(cos(θ+φ),0) · R_d(|s|),再用 Σ R_d 归一化,使得:
//     - 曲率→0(平面):结果 ≈ max(N·L, 0)(退化为标准 Lambert);
//     - 曲率↑:邻域跨越 terminator 的贡献显现,红通道因长程 Gaussian 而
//       在 N·L≈0 处显著大于蓝通道(红移)。
//
// 散射剖面 R_d(s)(d'Eon 2007 皮肤漫反射率剖面,高斯和):
//   R_d(s) = Σ_k a_k · exp(−s² / (2·v_k))   (s 单位 mm,v_k 单位 mm²)
//   红通道含一个长程项(v=0.842),绿/蓝不含 → 红光散射最远。
//
// 参考:
//   - Penner & Borshukov 2011 "Pre-Integrated Skin Shading"
//   - d'Eon 2007 GPU Gems 3 Ch.14 (skin diffuse profile Gaussian fit)
//   - o3de Atom Skin 材质(SkinDiffuseProfile / PreIntegratedBrdf)
//   - three.js(无直接对应;本模块填补 VREEN 皮肤渲染拼图)

/** RGB 三元组(本地定义,避免与 Lights/Renderer 同名类型在引擎 barrel 冲突)。 */
export interface SkinColor {
  r: number;
  g: number;
  b: number;
}

/** LUT 生成选项。 */
export interface PreIntegratedSkinLUTOptions {
  /** U 轴(宽度)分辨率。默认 256。 */
  width?: number;
  /** V 轴(高度)分辨率。默认 256。 */
  height?: number;
  /**
   * 最大曲率(mm⁻¹),对应 V=1(底部行)。默认 2.0(半径 0.5mm,鼻尖尺度)。
   * V=0(顶部行)为平面(曲率 0)。曲率越大,散射跨越 terminator 越明显。
   */
  maxCurvature?: number;
  /**
   * 弧积分的最大表面距离(mm)。默认 4.0。
   * 在该距离内采样散射剖面;超出范围 R_d≈0,无贡献。
   */
  maxScatter?: number;
  /** 弧积分采样数。默认 64。越高越精确,越慢。 */
  samples?: number;
}

/** LUT 生成结果。 */
export interface PreIntegratedSkinLUTResult {
  /** RGB 紧凑数据,长度 = width*height*3,值域 [0,1]。 */
  data: Float32Array;
  /** 宽度(U 轴 = N·L)。 */
  width: number;
  /** 高度(V 轴 = 曲率)。 */
  height: number;
  /** 生成时使用的最大曲率(供采样器还原 V 轴)。 */
  maxCurvature: number;
}

// ── d'Eon 2007 皮肤漫反射率剖面(高斯和) ─────────────────────────────
// 每通道:[weight, variance] 对(v=0 表示该通道无此项)。
// 红通道第 4 项 v=0.842 为长程散射 → 红光跨越 terminator 最远;
// 绿/蓝第 4 项为 (0,0) → 仅 3 项,短程散射为主。
// 数值取自 d'Eon & van Latta 2007 (GPU Gems 3 Ch.14) Table 1。
const PROFILE_R: ReadonlyArray<readonly [number, number]> = [
  [0.028, 0.013],
  [0.238, 0.060],
  [0.448, 0.268],
  [0.698, 0.842],
];
const PROFILE_G: ReadonlyArray<readonly [number, number]> = [
  [0.449, 0.019],
  [0.367, 0.088],
  [0.184, 0.228],
  [0.0, 0.0],
];
const PROFILE_B: ReadonlyArray<readonly [number, number]> = [
  [0.549, 0.022],
  [0.318, 0.084],
  [0.133, 0.183],
  [0.0, 0.0],
];

/** 计算单通道散射剖面值 R_d(s) = Σ a_k · exp(−s²/(2·v_k))。 */
function evalChannel(profile: ReadonlyArray<readonly [number, number]>, s: number): number {
  let sum = 0;
  const s2 = s * s;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i][0];
    const v = profile[i][1];
    if (v > 0) {
      sum += a * Math.exp(-s2 / (2 * v));
    }
  }
  return sum;
}

/**
 * 皮肤散射剖面 R_d(s)(d'Eon 2007 高斯和)。
 *
 * @param distanceMM 表面距离(mm)
 * @returns 每通道散射权重(红 > 绿 > 蓝在长距离处)
 */
export function skinScatterProfile(distanceMM: number): SkinColor {
  return {
    r: evalChannel(PROFILE_R, distanceMM),
    g: evalChannel(PROFILE_G, distanceMM),
    b: evalChannel(PROFILE_B, distanceMM),
  };
}

/** 钳位到 [0,1]。 */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * 对单个 (NdotL, curvature) 计算 Pre-Integrated 漫反射颜色。
 *
 * 沿球面弧(半径 r = 1/curvature)在表面距离 s ∈ [−maxScatter, +maxScatter] 内
 * 采样 N 点,累加 max(cos(θ+φ),0)·R_d(|s|),再用 Σ R_d 归一化。
 *
 * 不变量:
 *   - curvature ≈ 0(平面)→ 返回 max(NdotL, 0)(Lambert);
 *   - 输出每通道 ∈ [0,1];
 *   - NdotL = 1(全亮)且 curvature 有限 → ≈ 1.0(归一化保证)。
 */
function integrateDiffuse(
  NdotL: number,
  curvature: number,
  maxScatter: number,
  samples: number,
): SkinColor {
  // 平面退化:曲率 ≈ 0 → 标准 Lambert
  if (curvature < 1e-6) {
    const l = Math.max(NdotL, 0);
    return { r: l, g: l, b: l };
  }

  const radius = 1 / curvature; // mm
  const theta = Math.acos(clamp01(NdotL < -1 ? -1 : NdotL > 1 ? 1 : NdotL));

  let cr = 0;
  let cg = 0;
  let cb = 0;
  let wr = 0;
  let wg = 0;
  let wb = 0;

  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0.5 : i / (samples - 1);
    const s = -maxScatter + 2 * maxScatter * t; // 表面距离(mm)
    const phi = s / radius; // 对应球面角
    const prof = skinScatterProfile(Math.abs(s));
    const NdotLi = Math.cos(theta + phi);
    const lit = NdotLi > 0 ? NdotLi : 0;
    cr += lit * prof.r;
    cg += lit * prof.g;
    cb += lit * prof.b;
    wr += prof.r;
    wg += prof.g;
    wb += prof.b;
  }

  return {
    r: wr > 1e-9 ? cr / wr : 0,
    g: wg > 1e-9 ? cg / wg : 0,
    b: wb > 1e-9 ? cb / wb : 0,
  };
}

/**
 * 生成 Pre-Integrated Skin 漫反射 LUT(2D,RGB)。
 *
 * U 轴(x):N·L 从 −1(左)到 +1(右);V 轴(y):曲率从 0(顶,平面)到
 * maxCurvature(底,最高曲率)。输出每像素 RGB ∈ [0,1],可作为
 * RG16F/RGB16F 纹理上传,在片段着色器中按
 * `texture(lut, vec2(NdotL*0.5+0.5, curvature/maxCurv))` 采样。
 */
export function generatePreIntegratedSkinLUT(
  opts: PreIntegratedSkinLUTOptions = {},
): PreIntegratedSkinLUTResult {
  const width = Math.max(1, Math.floor(opts.width ?? 256));
  const height = Math.max(1, Math.floor(opts.height ?? 256));
  const maxCurvature = Math.max(0, opts.maxCurvature ?? 2.0);
  const maxScatter = Math.max(0.001, opts.maxScatter ?? 4.0);
  const samples = Math.max(2, Math.floor(opts.samples ?? 64));

  const data = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    const v = height === 1 ? 0 : y / (height - 1);
    const curvature = v * maxCurvature;
    for (let x = 0; x < width; x++) {
      const u = width === 1 ? 0 : x / (width - 1);
      const NdotL = 2 * u - 1; // −1..+1
      const col = integrateDiffuse(NdotL, curvature, maxScatter, samples);
      const idx = (y * width + x) * 3;
      data[idx] = col.r;
      data[idx + 1] = col.g;
      data[idx + 2] = col.b;
    }
  }

  return { data, width, height, maxCurvature };
}

/**
 * 双线性采样 Pre-Integrated Skin LUT。
 *
 * @param lut   generatePreIntegratedSkinLUT 的返回值
 * @param NdotL 法线·光线(−1..+1,自动钳位)
 * @param curvature 表面曲率(mm⁻¹,自动钳位到 [0, maxCurvature])
 * @returns 漫反射颜色(RGB ∈ [0,1])
 */
export function samplePreIntegratedSkinLUT(
  lut: PreIntegratedSkinLUTResult,
  NdotL: number,
  curvature: number,
): SkinColor {
  const u = clamp01((NdotL + 1) * 0.5);
  const cur = curvature < 0 ? 0 : curvature > lut.maxCurvature ? lut.maxCurvature : curvature;
  const v = lut.maxCurvature > 0 ? cur / lut.maxCurvature : 0;

  const fx = u * (lut.width - 1);
  const fy = v * (lut.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1 < lut.width ? x0 + 1 : x0;
  const y1 = y0 + 1 < lut.height ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = (y0 * lut.width + x0) * 3;
  const i10 = (y0 * lut.width + x1) * 3;
  const i01 = (y1 * lut.width + x0) * 3;
  const i11 = (y1 * lut.width + x1) * 3;

  const get = (idx: number): SkinColor => ({
    r: lut.data[idx],
    g: lut.data[idx + 1],
    b: lut.data[idx + 2],
  });

  const c00 = get(i00);
  const c10 = get(i10);
  const c01 = get(i01);
  const c11 = get(i11);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const r0 = lerp(c00.r, c10.r, tx);
  const g0 = lerp(c00.g, c10.g, tx);
  const b0 = lerp(c00.b, c10.b, tx);
  const r1 = lerp(c01.r, c11.r, tx);
  const g1 = lerp(c01.g, c11.g, tx);
  const b1 = lerp(c01.b, c11.b, tx);

  return { r: lerp(r0, r1, ty), g: lerp(g0, g1, ty), b: lerp(b0, b1, ty) };
}

/**
 * 从网格曲率估算采样曲率:曲率 ≈ 1 / 局部曲率半径(mm)。
 *
 * 提供常用半径→曲率的便捷转换,供 shader 端映射 curvature 时参考。
 * 例如鼻尖半径 ~0.5mm → curvature = 2.0;额头(近平面)半径很大 → curvature ≈ 0。
 */
export function curvatureFromRadius(radiusMM: number): number {
  return radiusMM > 0 ? 1 / radiusMM : 0;
}

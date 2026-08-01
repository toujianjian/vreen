// SeparableSSS — 可分离屏幕空间次表面散射核生成器 (CPU 侧纯函数) + GLSL chunk。
//
// 适配:
//   - Jorge Jimenez 2014/2015 "Separable Subsurface Scattering" (SIGGRAPH)
//   - d3xter/separable-sss(GitHub 参考实现)
//   - d'Eon 2007 皮肤扩散剖面(高斯和)
//
// 适用场景:实时皮肤 / 蜡 / 玉石的屏幕空间漫反射散射模糊。
//
// 与 VREEN 现有 SSS 模块的关系(完整皮肤管线):
//   * SubsurfaceScatteringMaterial — 薄壁背面透射(耳廓透光),逐材质;
//   * PreIntegratedSkinLUT         — 前向漫反射的曲率红移(鼻翼 terminator),逐像素;
//   * SeparableSSS(本模块)         — 屏幕空间漫反射扩散模糊(整体红光弥散),后处理。
//   * 现有 SSSSPass                 — 已有的标量高斯模糊 Pass(可升级为消费本核)。
//   四者互补,组合实现顶级实时皮肤渲染。
//
// 原理:
//   皮肤的漫反射率剖面 R_d(r) 是径向对称的 2D 函数(d'Eon 高斯和)。直接 2D 卷积
//   代价 O(N²)。Jimenez 2015 关键洞察:每个 2D 高斯 G_2D(r,σ) 可分离为
//   G_2D(x,y) = g_1D(x,σ)·g_1D(y,σ),故 2D 卷积可分解为两趟 1D 卷积(水平 + 垂直),
//   代价降为 O(2N)。把多高斯组合成单一 1D 核(按通道 RGB 权重),两趟 1D 卷积
//   近似原 2D 扩散。
//
//   红通道在宽高斯上有更高权重 → 红核更宽 → 红光弥散更远(皮肤红润感来源)。
//
// 核生成算法:
//   1. 皮肤剖面 = Σ_k (sigma_k, color_k) 的高斯和(d3xter 发布值);
//   2. 在 [0, spread] 内取 N 个均匀采样点(半核,对称);
//   3. 每点权重 w_c(d) = Σ_k color_{c,k} · exp(−d²/(2·σ_k²));
//   4. 按通道归一化:使全对称核 Σ = 1(中心计一次,其余计两次)→ 2D 能量守恒
//      (Σ_x Σ_y w_c(x)·w_c(y) = (Σ w_c)² = 1);
//   5. offset = d · strength(strength = 每毫米对应像素数)。
//
// 不变量(测试覆盖):
//   - 每通道全对称核和 = 1(能量守恒);
//   - 红核有效宽度(方差)> 绿 > 蓝(红弥散更远);
//   - convolve1D 保持总能量(常数输入 → 常数输出,值不变);
//   - convolve2DSeparable(H+V)≈ 解析 2D 卷积(对单高斯剖面精确,对多高斯近似)。
//
// 参考:
//   - Jimenez 2015 "Separable Subsurface Scattering"
//   - d3xter/separable-sss(Profile + calculateKernel)
//   - d'Eon 2007 GPU Gems 3 Ch.14

import type { SkinColor } from './PreIntegratedSkinLUT';

/** 单个高斯分量:{sigma (mm), RGB color weight}。 */
export interface SSSGaussianComponent {
  /** 高斯标准差(mm)。 */
  sigma: number;
  /** 该高斯的 RGB 权重(红在宽高斯上更大 → 红弥散更远)。 */
  color: SkinColor;
}

/** 核采样点:{offset (像素), RGB weight}。 */
export interface SSSKernelSample {
  /** 距中心的偏移(像素,沿 blur 方向)。 */
  offset: number;
  /** 该采样点的 RGB 权重(已归一化)。 */
  weight: SkinColor;
}

/** 生成选项。 */
export interface SeparableSSSKernelOptions {
  /** 半核采样数(含中心),即每边采样数。默认 11。最终全核 = 2*samples−1。 */
  samples?: number;
  /** 强度:每毫米对应像素数(控制散射半径)。默认 1.0。 */
  strength?: number;
  /** 采样最大表面距离(mm)。默认 = 3 × profile 最大 sigma(覆盖 ~99.7%)。 */
  spread?: number;
  /** 扩散剖面(高斯分量数组)。默认 SKIN_PROFILE_JIMENEZ。 */
  profile?: ReadonlyArray<SSSGaussianComponent>;
}

/** 生成结果(半核,对称)。 */
export interface SeparableSSSKernelResult {
  /** 半核采样点(索引 0 = 中心)。 */
  samples: SSSKernelSample[];
  /** 半核大小(含中心)。 */
  halfSize: number;
  /** 全核大小 = 2*halfSize − 1。 */
  fullSize: number;
  /** 使用的强度。 */
  strength: number;
}

/**
 * Jimenez 2015 皮肤扩散剖面(d3xter/separable-sss 发布值)。
 *
 * 6 个高斯,每个 {sigma_mm, RGB_color}。红通道在较宽的高斯(sigma 大)上权重更高,
 * 故红光弥散更远。数值取自 d3xter/separable-sss `SSS_SKIN` 默认 profile。
 */
export const SKIN_PROFILE_JIMENEZ: ReadonlyArray<SSSGaussianComponent> = [
  { sigma: 0.5328, color: { r: 0.17, g: 0.18, b: 0.08 } },
  { sigma: 0.6894, color: { r: 0.34, g: 0.33, b: 0.17 } },
  { sigma: 0.7063, color: { r: 0.26, g: 0.27, b: 0.18 } },
  { sigma: 0.7298, color: { r: 0.18, g: 0.09, b: 0.09 } },
  { sigma: 0.8295, color: { r: 0.25, g: 0.28, b: 0.08 } },
  { sigma: 0.8864, color: { r: 0.11, g: 0.06, b: 0.04 } },
];

/** 钳位 [0,1]。 */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * 计算剖面在距离 d 处的 RGB 值:Σ_k color_k · exp(−d²/(2·σ_k²))。
 */
export function sampleSSSProfile(
  profile: ReadonlyArray<SSSGaussianComponent>,
  distanceMM: number,
): SkinColor {
  let r = 0;
  let g = 0;
  let b = 0;
  const d2 = distanceMM * distanceMM;
  for (let i = 0; i < profile.length; i++) {
    const sigma = profile[i].sigma;
    const w = Math.exp(-d2 / (2 * sigma * sigma));
    r += profile[i].color.r * w;
    g += profile[i].color.g * w;
    b += profile[i].color.b * w;
  }
  return { r, g, b };
}

/**
 * 生成可分离 SSS 半核(对称)。
 *
 * @returns 半核(索引 0 = 中心,offset=0);全核通过对称镜像得到。
 */
export function generateSeparableSSSKernel(
  opts: SeparableSSSKernelOptions = {},
): SeparableSSSKernelResult {
  const halfSize = Math.max(1, Math.floor(opts.samples ?? 11));
  const strength = Math.max(0, opts.strength ?? 1.0);
  const profile = opts.profile ?? SKIN_PROFILE_JIMENEZ;
  const maxSigma = profile.reduce((m, c) => (c.sigma > m ? c.sigma : m), 0);
  const spread = Math.max(0.001, opts.spread ?? 3 * maxSigma);

  const samples: SSSKernelSample[] = [];

  // 采样:半核在 [0, spread] 内均匀分布(中心 0,边缘 spread)
  for (let i = 0; i < halfSize; i++) {
    const t = halfSize === 1 ? 0 : i / (halfSize - 1);
    const d = t * spread; // mm
    const w = sampleSSSProfile(profile, d);
    samples.push({ offset: d * strength, weight: { r: w.r, g: w.g, b: w.b } });
  }

  // 按通道归一化:全对称核和 = 1(中心计一次,其余计两次)
  // → 2D 可分离响应 Σ_x Σ_y w_c(x)·w_c(y) = (Σ w_c)² = 1(能量守恒)
  let sumR = samples[0].weight.r;
  let sumG = samples[0].weight.g;
  let sumB = samples[0].weight.b;
  for (let i = 1; i < samples.length; i++) {
    sumR += 2 * samples[i].weight.r;
    sumG += 2 * samples[i].weight.g;
    sumB += 2 * samples[i].weight.b;
  }
  if (sumR > 0) for (const s of samples) s.weight.r /= sumR;
  if (sumG > 0) for (const s of samples) s.weight.g /= sumG;
  if (sumB > 0) for (const s of samples) s.weight.b /= sumB;

  return {
    samples,
    halfSize,
    fullSize: 2 * halfSize - 1,
    strength,
  };
}

/**
 * CPU 参考:1D 对称卷积(半核)。
 *
 * @param row    输入像素行(RGBA 平铺:[R,G,B,A, R,G,B,A, ...],长度 = width*4)
 * @param width  像素宽度
 * @param kernel 半核(索引 0 = 中心)
 * @param axis   0 = 水平(沿 x),1 = 垂直(沿 y)— 对单行无差别,这里仅做 1D
 * @returns      新的 RGBA 行(长度同输入)
 */
export function convolve1D(
  row: Float32Array | number[],
  width: number,
  kernel: SeparableSSSKernelResult,
): Float32Array {
  const out = new Float32Array(width * 4);
  const half = kernel.samples; // 半核
  for (let x = 0; x < width; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    // 中心
    {
      const px = x;
      const idx = px * 4;
      r += half[0].weight.r * row[idx];
      g += half[0].weight.g * row[idx + 1];
      b += half[0].weight.b * row[idx + 2];
    }
    // 对称邻域
    for (let i = 1; i < half.length; i++) {
      const off = i; // 整数像素偏移(参考实现;GPU 用 offset 浮点)
      const xl = x - off >= 0 ? x - off : x; // 边缘 clamp
      const xr = x + off < width ? x + off : x;
      const il = xl * 4;
      const ir = xr * 4;
      r += half[i].weight.r * (row[il] + row[ir]);
      g += half[i].weight.g * (row[il + 1] + row[ir + 1]);
      b += half[i].weight.b * (row[il + 2] + row[ir + 2]);
    }
    const o = x * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = row[o + 3]; // alpha 直通
  }
  return out;
}

/**
 * CPU 参考:2D 可分离卷积(水平 + 垂直两趟)。
 *
 * @param image  RGBA 平铺图像(行优先,长度 = width*height*4)
 * @param width  图像宽度
 * @param height 图像高度
 * @param kernel 半核
 * @returns      新图像(长度同输入)
 */
export function convolve2DSeparable(
  image: Float32Array | number[],
  width: number,
  height: number,
  kernel: SeparableSSSKernelResult,
): Float32Array {
  // 第一趟:水平模糊每行 → 中间图像
  const mid = new Float32Array(width * height * 4);
  const rowBuf = new Float32Array(width * 4);
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let i = 0; i < width * 4; i++) rowBuf[i] = image[rowStart + i];
    const out = convolve1D(rowBuf, width, kernel);
    mid.set(out, rowStart);
  }
  // 第二趟:垂直模糊每列 → 输出图像
  const out = new Float32Array(width * height * 4);
  const half = kernel.samples;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let r = mid[(y * width + x) * 4] * half[0].weight.r;
      let g = mid[(y * width + x) * 4 + 1] * half[0].weight.g;
      let b = mid[(y * width + x) * 4 + 2] * half[0].weight.b;
      for (let i = 1; i < half.length; i++) {
        const off = i;
        const yu = y - off >= 0 ? y - off : y;
        const yd = y + off < height ? y + off : y;
        const iu = (yu * width + x) * 4;
        const id = (yd * width + x) * 4;
        r += half[i].weight.r * (mid[iu] + mid[id]);
        g += half[i].weight.g * (mid[iu + 1] + mid[id + 1]);
        b += half[i].weight.b * (mid[iu + 2] + mid[id + 2]);
      }
      const o = (y * width + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = mid[o + 3];
    }
  }
  return out;
}

/**
 * 计算核的有效宽度(方差)per channel,用于验证"红 > 绿 > 蓝"。
 * 方差 = Σ w_i · offset_i² / Σ w_i(以中心 0 为均值)。
 */
export function kernelVariance(kernel: SeparableSSSKernelResult): SkinColor {
  let rNum = 0;
  let gNum = 0;
  let bNum = 0;
  let rDen = 0;
  let gDen = 0;
  let bDen = 0;
  for (const s of kernel.samples) {
    const o2 = s.offset * s.offset;
    const count = s === kernel.samples[0] ? 1 : 2; // 中心 1,其余 2(对称)
    rNum += count * s.weight.r * o2;
    gNum += count * s.weight.g * o2;
    bNum += count * s.weight.b * o2;
    rDen += count * s.weight.r;
    gDen += count * s.weight.g;
    bDen += count * s.weight.b;
  }
  return {
    r: rDen > 0 ? rNum / rDen : 0,
    g: gDen > 0 ? gNum / gDen : 0,
    b: bDen > 0 ? bNum / bDen : 0,
  };
}

// ── GLSL chunk:可分离 SSS 模糊片段 ──────────────────────────────────
// 两趟共用:u_blurDir = (1,0) 水平 / (0,1) 垂直。
// u_kernelOffset[N] / u_kernelWeight[N](RGB) 由 generateSeparableSSSKernel 上传。
// 深度感知:深度差超阈值时降低权重(避免背景渗透)。

/** 可分离 SSS 模糊顶点(全屏四边形,标准)。 */
export const SEPARABLE_SSS_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * 可分离 SSS 模糊片段。
 *
 * uniform:
 *   u_colorMap      — 输入颜色纹理
 *   u_depthMap      — NDC 深度纹理(0..1)
 *   u_blurDir       — (1,0) 水平 / (0,1) 垂直
 *   u_texelSize     — (1/width, 1/height)
 *   u_samples       — 半核采样数(含中心)
 *   u_kernelOffset  — 半核偏移(像素,沿 blurDir)
 *   u_kernelWeightR/G/B — 半核 RGB 权重
 *   u_depthFalloff  — 深度差衰减(越大越锐利,0 = 关闭深度感知)
 *   u_subsurfaceColor — 次表面色调(散射光向此色偏移)
 *   u_subsurfaceMix — 色调混合度 [0,1]
 */
export const SEPARABLE_SSS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_colorMap;
uniform sampler2D u_depthMap;
uniform vec2  u_blurDir;
uniform vec2  u_texelSize;
uniform int   u_samples;
uniform float u_kernelOffset[25];   // 半核偏移(像素)
uniform float u_kernelWeightR[25];  // 半核 R 权重
uniform float u_kernelWeightG[25];
uniform float u_kernelWeightB[25];
uniform float u_depthFalloff;
uniform vec3  u_subsurfaceColor;
uniform float u_subsurfaceMix;

// 线性化 NDC 深度(透视相机)。near/far 由调用方注入;此处简化为直接用非线性深度差。
float linearDepth(float d) {
  return d; // 调用方可在 shader 外做线性化;此处用原始 NDC 差
}

void main() {
  float centerDepth = texture(u_depthMap, v_uv).r;
  vec3 sumR = vec3(0.0);
  vec3 sumG = vec3(0.0);
  vec3 sumB = vec3(0.0);

  for (int i = 0; i < 25; i++) {
    if (i >= u_samples) break;
    vec2 offset = u_blurDir * u_kernelOffset[i] * u_texelSize;
    // 中心 + 对称两侧
    vec3 colC = texture(u_colorMap, v_uv).rgb;
    vec3 colP = texture(u_colorMap, v_uv + offset).rgb;
    vec3 colN = texture(u_colorMap, v_uv - offset).rgb;

    // 深度感知权重:邻域深度差大 → 衰减
    float dC = texture(u_depthMap, v_uv).r;
    float dP = texture(u_depthMap, v_uv + offset).r;
    float dN = texture(u_depthMap, v_uv - offset).r;
    float wP = u_depthFalloff > 0.0
      ? exp(-abs(dP - dC) * u_depthFalloff) : 1.0;
    float wN = u_depthFalloff > 0.0
      ? exp(-abs(dN - dC) * u_depthFalloff) : 1.0;

    float wCenter = (i == 0) ? 1.0 : 1.0;
    float wr = u_kernelWeightR[i];
    float wg = u_kernelWeightG[i];
    float wb = u_kernelWeightB[i];

    if (i == 0) {
      sumR += wr * colC.r;
      sumG += wg * colC.g;
      sumB += wb * colC.b;
    } else {
      sumR += wr * (colP.r * wP + colN.r * wN);
      sumG += wg * (colP.g * wP + colN.g * wN);
      sumB += wb * (colP.b * wP + colN.b * wN);
    }
  }

  vec3 result = vec3(sumR.r, sumG.g, sumB.b);
  // 向次表面色调偏移(模拟内部散射光颜色)
  result = mix(result, result * u_subsurfaceColor, u_subsurfaceMix);
  outColor = vec4(result, texture(u_colorMap, v_uv).a);
}
`;

// 工具:把半核结果转为可上传 GLSL 的 uniform 数组(便于 SSSSPass 消费)。
/**
 * 把半核转为 GLSL uniform 平铺数组。
 *
 * @returns { offsets, weightsR, weightsG, weightsB } 各为 Float32Array(长度 = halfSize)。
 *           调用方按 `u_kernelOffset` / `u_kernelWeightR/G/B` 上传。
 */
export function kernelToUniforms(kernel: SeparableSSSKernelResult): {
  offsets: Float32Array;
  weightsR: Float32Array;
  weightsG: Float32Array;
  weightsB: Float32Array;
} {
  const n = kernel.halfSize;
  const offsets = new Float32Array(n);
  const weightsR = new Float32Array(n);
  const weightsG = new Float32Array(n);
  const weightsB = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    offsets[i] = kernel.samples[i].offset;
    weightsR[i] = kernel.samples[i].weight.r;
    weightsG[i] = kernel.samples[i].weight.g;
    weightsB[i] = kernel.samples[i].weight.b;
  }
  return { offsets, weightsR, weightsG, weightsB };
}

export { clamp01 };

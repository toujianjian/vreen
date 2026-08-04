// SVGFDenoiserPass — Spatiotemporal Variance-Guided Filtering 去噪器。
//
// 设计目标:
//   - 对 SSR / SSGI / 路径追踪 / 随机阴影等低样本随机输入进行高质量去噪,
//     匹配 UE5 / o3de Atom / NVIDIA RTX Denoiser 的质量级别。
//   - SVGF (Schied et al. 2017) 三阶段管线:
//     1. 时序累积 — 用速度缓冲重投影上一帧,按置信度混合;
//     2. 方差估计 — 3×3 邻域亮度方差,指导后续空间滤波强度;
//     3. A-trous 小波滤波 — 5×5 边缘保持滤波器,深度/法线/亮度感知,
//        迭代 4-5 次(步长 1→2→4→8),等效 17×17 大核但开销仅 5×5×N。
//   - 与 MotionBlurEnhancedPass / TSR 同构:CPU 纯函数不依赖 WebGL,
//     可在 Node/无头环境测试,与 GLSL `SVGF_*` chunks 1:1 对应。
//
// 算法(参考 Schied et al. 2017 "Spatiotemporal Variance-Guided Filtering"):
//   1. **时序累积**:
//      - 用速度缓冲把当前像素映射到上一帧位置 → 双线性采样历史;
//      - 计算置信度:遮挡 / 速度过大 → 低置信度(更多当前帧);
//      - 混合:output = history * confidence + current * (1 - confidence);
//      - 输出:累积颜色 + 累积样本数(用于方差归一化)。
//   2. **方差估计**:
//      - 在 3×3 邻域上计算亮度方差 σ² = E[X²] - E[X]²;
//      - 用累积样本数加权,样本越多方差越小(更信任历史);
//      - 输出:每像素方差图,指导 a-trous 滤波器在低方差区域用大权重
//        (平滑),高方差区域用小权重 (保留细节)。
//   3. **A-trous 小波滤波** (迭代 4 次,步长 1,2,4,8):
//      - 5×5 cross 核(中心 + 4 邻居 + 4 对角,共 9 tap);
//      - 三重边缘停止权重:
//        w_depth = exp(-|depth_x - depth_p| / (σ_z * |grad_z| * step + ε));
//        w_normal = max(0, dot(N_x, N_p))^σ_n;
//        w_luminance = exp(-|lum_x - lum_p|² / (σ_l * variance + ε));
//      - 总权重 w = w_depth * w_normal * w_luminance;
//      - 归一化输出:Σ(w * color) / Σ(w);
//      - 每次迭代步长翻倍,4 次迭代等效 33×33 全核覆盖但仅 9×4=36 次 tap。
//
// 不变量:
//   - 纯函数不修改输入数据,返回新分配的缓冲;
//   - 首帧(history === null)输出 = 当前帧,样本数 = 1;
//   - 方差非负(0 表示均匀区域,滤波器退化为高斯);
//   - a-trous 滤波不跨深度/法线边缘(边缘停止权重保证);
//   - dispose / reset 后下一帧视为首帧。
//
// 参考:
//   - Schied et al. 2017 "Spatiotemporal Variance-Guided Filtering"
//   - UE5 Denoiser (temporal + spatial)
//   - o3de Atom DenoiserPass
//   - NVIDIA RTX Denoiser (NRD)

import { createLogger } from '@/lib/logger';

const log = createLogger('SVGFDenoiserPass');

// ── 类型 ──────────────────────────────────────────────────────────

/** RGBA 像素数据(Uint8,0-255)。 */
export interface SVGFPixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 速度缓冲(Float32,RG 逐像素,像素单位)。 */
export interface SVGFVelocityBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

/** 深度缓冲(Float32,逐像素,[0,1])。 */
export interface SVGFDepthBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

/** 法线缓冲(Float32,RGB 逐像素,世界空间,归一化)。 */
export interface SVGFNormalBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

/** SVGF 选项。 */
export interface SVGFOptions {
  /** 时序累积混合因子(0..1,默认 0.2)。值越大当前帧权重越高(响应快但噪声多)。 */
  temporalAlpha?: number;
  /** a-trous 迭代次数(1..8,默认 4)。步长 2^i,4 次等效 33×33 核。 */
  atrousIterations?: number;
  /** 深度边缘停止 sigma(默认 1.0)。越大越容忍深度差。 */
  depthSigma?: number;
  /** 法线边缘停止指数(默认 32.0)。越大越锐利(法线差异更易停止)。 */
  normalPower?: number;
  /** 亮度边缘停止 sigma(默认 4.0)。越大越容忍亮度差。 */
  luminanceSigma?: number;
  /** 方差放大因子(默认 1.0)。增大则高方差区域更激进滤波。 */
  varianceBoost?: number;
}

/** SVGF 统计(调试用)。 */
export interface SVGFStats {
  /** 处理的像素数。 */
  pixelsProcessed: number;
  /** 时序累积重置像素数(遮挡 / 首帧)。 */
  temporalResets: number;
  /** 平均样本数(时序累积后)。 */
  avgSamples: number;
  /** 平均方差(0-1 归一化)。 */
  avgVariance: number;
  /** a-trous 实际迭代次数。 */
  atrousIterations: number;
  /** 上一帧总耗时(ms)。 */
  lastFrameTimeMs: number;
}

// ── 工具函数 ──────────────────────────────────────────────────────

/**
 * RGB → 亮度(Rec. 709)。
 *
 * @param r,g,b  RGB 分量(0-255)
 * @returns       亮度(0-255)
 */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 读取像素缓冲在 (x, y) 处的 RGBA 颜色。越界返回黑色。
 */
function getPixel(
  buf: SVGFPixelBuffer, x: number, y: number,
): [number, number, number, number] {
  if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) {
    return [0, 0, 0, 0];
  }
  const i = (y * buf.width + x) * 4;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
}

/**
 * 读取深度缓冲在 (x, y) 处的值。越界返回 1.0(最远)。
 */
function getDepth(buf: SVGFDepthBuffer, x: number, y: number): number {
  if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) return 1.0;
  return buf.data[y * buf.width + x];
}

/**
 * 读取法线缓冲在 (x, y) 处的 RGB 法线。越界返回 (0,0,0)。
 */
function getNormal(
  buf: SVGFNormalBuffer, x: number, y: number,
): [number, number, number] {
  if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) return [0, 0, 0];
  const i = (y * buf.width + x) * 3;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2]];
}

/**
 * 读取速度缓冲在 (x, y) 处的 RG 速度(像素单位)。越界返回 (0,0)。
 */
function getVelocity(
  buf: SVGFVelocityBuffer, x: number, y: number,
): [number, number] {
  if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) return [0, 0];
  const i = (y * buf.width + x) * 2;
  return [buf.data[i], buf.data[i + 1]];
}

/**
 * 双线性采样 RGBA 像素缓冲在 (u, v) 处的颜色。UV 越界钳制到边缘。
 */
function bilinearSample(
  buf: SVGFPixelBuffer, u: number, v: number,
): [number, number, number, number] {
  const cu = u < 0 ? 0 : u > 1 ? 1 : u;
  const cv = v < 0 ? 0 : v > 1 ? 1 : v;
  const fx = cu * (buf.width - 1);
  const fy = cv * (buf.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(buf.width - 1, x0 + 1);
  const y1 = Math.min(buf.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = (y0 * buf.width + x0) * 4;
  const i10 = (y0 * buf.width + x1) * 4;
  const i01 = (y1 * buf.width + x0) * 4;
  const i11 = (y1 * buf.width + x1) * 4;
  const d = buf.data;

  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;

  return [
    d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11,
    d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11,
    d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11,
    d[i00 + 3] * w00 + d[i10 + 3] * w10 + d[i01 + 3] * w01 + d[i11 + 3] * w11,
  ];
}

// ── 阶段 1:时序累积 ──────────────────────────────────────────────

/**
 * 时序累积:用速度缓冲重投影历史帧,与当前帧混合。
 *
 * 逐像素:
 *   1. 读速度 → 计算历史 UV = (px - velX, py - velY) / dims;
 *   2. 历史 UV 越界 → 遮挡,output = current, samples = 1;
 *   3. 否则双线性采样历史 → 混合:
 *      output = history * (1 - alpha) + current * alpha;
 *      samples = historySamples * (1 - alpha) + 1;
 *   4. samples 上限 256 防止无限累积。
 *
 * @param current      当前帧颜色
 * @param history      上一帧累积颜色(null = 首帧)
 * @param historySamples 上一帧累积样本数(null = 首帧)
 * @param velocity     速度缓冲
 * @param alpha        时序混合因子(0..1,越大越偏当前帧)
 * @returns            { color: 累积颜色, samples: 累积样本数, resets: 重置数 }
 */
export function temporalAccumulation(
  current: SVGFPixelBuffer,
  history: SVGFPixelBuffer | null,
  historySamples: Float32Array | null,
  velocity: SVGFVelocityBuffer,
  alpha: number = 0.2,
): { color: SVGFPixelBuffer; samples: Float32Array; resets: number } {
  const { width: w, height: h } = current;
  const colorData = new Uint8ClampedArray(w * h * 4);
  const samplesData = new Float32Array(w * h);
  let resets = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const curR = current.data[idx];
      const curG = current.data[idx + 1];
      const curB = current.data[idx + 2];
      const curA = current.data[idx + 3];

      // 首帧 → 直接拷贝
      if (!history || !historySamples) {
        colorData[idx] = curR;
        colorData[idx + 1] = curG;
        colorData[idx + 2] = curB;
        colorData[idx + 3] = curA;
        samplesData[y * w + x] = 1;
        resets++;
        continue;
      }

      // 速度 → 历史 UV
      const [vx, vy] = getVelocity(velocity, x, y);
      const histU = (x - vx) / w;
      const histV = (y - vy) / h;

      // 遮挡判定:历史 UV 超界
      if (histU < 0 || histU > 1 || histV < 0 || histV > 1) {
        colorData[idx] = curR;
        colorData[idx + 1] = curG;
        colorData[idx + 2] = curB;
        colorData[idx + 3] = curA;
        samplesData[y * w + x] = 1;
        resets++;
        continue;
      }

      // 双线性采样历史颜色
      const [hR, hG, hB, hA] = bilinearSample(history, histU, histV);

      // 采样历史样本数(最近邻)
      const sx = Math.max(0, Math.min(w - 1, Math.floor(histU * w)));
      const sy = Math.max(0, Math.min(h - 1, Math.floor(histV * h)));
      const histS = historySamples[sy * w + sx];

      // 混合
      const invAlpha = 1 - alpha;
      colorData[idx] = hR * invAlpha + curR * alpha;
      colorData[idx + 1] = hG * invAlpha + curG * alpha;
      colorData[idx + 2] = hB * invAlpha + curB * alpha;
      colorData[idx + 3] = hA * invAlpha + curA * alpha;

      // 样本累积(上限 256)
      const newS = histS * invAlpha + 1;
      samplesData[y * w + x] = Math.min(256, newS);
    }
  }

  return {
    color: { data: colorData, width: w, height: h },
    samples: samplesData,
    resets,
  };
}

// ── 阶段 2:方差估计 ──────────────────────────────────────────────

/**
 * 在 3×3 邻域上计算亮度方差。
 *
 * σ² = E[X²] - E[X]²
 *
 * 用累积样本数加权:样本越多方差越可信(除以 min(samples, maxSamples))。
 * 输出方差归一化到 [0, 1] 范围(clamp)。
 *
 * @param color     时序累积后的颜色
 * @param samples   时序累积样本数
 * @returns         每像素方差(Float32Array,长度 = w*h)
 */
export function estimateVariance(
  color: SVGFPixelBuffer,
  samples: Float32Array,
): Float32Array {
  const { width: w, height: h } = color;
  const variance = new Float32Array(w * h);
  const MAX_SAMPLES = 4; // 超过此样本数则方差不再缩小

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sumL = 0;
      let sumL2 = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(w - 1, x + dx));
          const sy = Math.max(0, Math.min(h - 1, y + dy));
          const idx = (sy * w + sx) * 4;
          const l = luminance(
            color.data[idx],
            color.data[idx + 1],
            color.data[idx + 2],
          );
          sumL += l;
          sumL2 += l * l;
          count++;
        }
      }

      const mean = sumL / count;
      const meanSq = sumL2 / count;
      let var_ = meanSq - mean * mean;
      if (var_ < 0) var_ = 0;

      // 样本数衰减:样本越多方差越小(时序累积已经平滑了)
      const s = samples[y * w + x];
      const sampleWeight = 1.0 / Math.min(MAX_SAMPLES, Math.max(1, s));
      var_ *= sampleWeight;

      // 归一化到 [0, 1](255² = 65025 是最大可能方差)
      variance[y * w + x] = Math.min(1, var_ / (255 * 255));
    }
  }

  return variance;
}

// ── 阶段 3:A-trous 小波滤波 ──────────────────────────────────────

/**
 * 计算三重边缘停止权重(深度 + 法线 + 亮度)。
 *
 * @param depthP    中心深度
 * @param depthX    邻居深度
 * @param normalP   中心法线 [x,y,z]
 * @param normalX   邻居法线 [x,y,z]
 * @param lumP      中心亮度
 * @param lumX      邻居亮度
 * @param variance  中心方差
 * @param depthSigma   深度 sigma
 * @param normalPower  法线 power
 * @param luminanceSigma 亮度 sigma
 * @returns           权重 [0,1]
 */
export function edgeStoppingWeight(
  depthP: number, depthX: number,
  normalP: [number, number, number], normalX: [number, number, number],
  lumP: number, lumX: number,
  variance: number,
  depthSigma: number = 1.0,
  normalPower: number = 32.0,
  luminanceSigma: number = 4.0,
): number {
  // 深度权重:exp(-|Δdepth| / (σ_z * step + ε))
  // step 由调用方传入(已在 depthX 中体现步长)
  const depthDiff = Math.abs(depthP - depthX);
  const wDepth = Math.exp(-depthDiff / (depthSigma + 1e-6));

  // 法线权重:max(0, dot(N_p, N_x))^σ_n
  const dotN =
    normalP[0] * normalX[0] +
    normalP[1] * normalX[1] +
    normalP[2] * normalX[2];
  const wNormal = Math.pow(Math.max(0, dotN), normalPower);

  // 亮度权重:exp(-|Δlum|² / (σ_l * variance + ε))
  // variance=0 表示该区域已稳定(无噪声),不需要亮度滤波 → wLum = 1。
  const lumDiff = lumP - lumX;
  const wLum = variance < 1e-6
    ? 1.0
    : Math.exp(-(lumDiff * lumDiff) / (luminanceSigma * variance * 255 * 255 + 1e-6));

  return wDepth * wNormal * wLum;
}

/** A-trous 5×5 cross 核的偏移和权重(中心 + 4 邻居 + 4 对角)。 */
const ATROUS_OFFSETS: Array<[number, number, number]> = [
  // [dx, dy, weight] — 5×5 cross: 中心(1.0) + 4 直邻(0.5) + 4 对角(0.25)
  [0, 0, 1.0],
  [-1, 0, 0.5], [1, 0, 0.5], [0, -1, 0.5], [0, 1, 0.5],
  [-1, -1, 0.25], [1, -1, 0.25], [-1, 1, 0.25], [1, 1, 0.25],
];

/**
 * 单次 a-trous 5×5 滤波迭代。
 *
 * @param color      输入颜色
 * @param depth      深度缓冲
 * @param normal     法线缓冲
 * @param variance   方差图
 * @param step       步长(1, 2, 4, 8, ...)
 * @param opts       边缘停止参数
 * @returns          滤波后的颜色
 */
export function atrousFilterIteration(
  color: SVGFPixelBuffer,
  depth: SVGFDepthBuffer,
  normal: SVGFNormalBuffer,
  variance: Float32Array,
  step: number,
  opts: { depthSigma?: number; normalPower?: number; luminanceSigma?: number } = {},
): SVGFPixelBuffer {
  const { width: w, height: h } = color;
  const out = new Uint8ClampedArray(w * h * 4);
  const depthSigma = opts.depthSigma ?? 1.0;
  const normalPower = opts.normalPower ?? 32.0;
  const luminanceSigma = opts.luminanceSigma ?? 4.0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const centerR = color.data[idx];
      const centerG = color.data[idx + 1];
      const centerB = color.data[idx + 2];
      const centerA = color.data[idx + 3];
      const centerLum = luminance(centerR, centerG, centerB);
      const centerDepth = getDepth(depth, x, y);
      const centerNormal = getNormal(normal, x, y);
      const centerVar = variance[y * w + x] || 0;

      let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
      let sumW = 0;

      for (const [dx, dy, kernelW] of ATROUS_OFFSETS) {
        const sx = x + dx * step;
        const sy = y + dy * step;

        // 邻居采样
        const [nR, nG, nB, nA] = getPixel(color, sx, sy);
        const nDepth = getDepth(depth, sx, sy);
        const nNormal = getNormal(normal, sx, sy);
        const nLum = luminance(nR, nG, nB);

        // 边缘停止权重
        const w = edgeStoppingWeight(
          centerDepth, nDepth,
          centerNormal, nNormal,
          centerLum, nLum,
          centerVar,
          depthSigma, normalPower, luminanceSigma,
        ) * kernelW;

        sumR += nR * w;
        sumG += nG * w;
        sumB += nB * w;
        sumA += nA * w;
        sumW += w;
      }

      // 归一化
      if (sumW > 1e-6) {
        out[idx] = sumR / sumW;
        out[idx + 1] = sumG / sumW;
        out[idx + 2] = sumB / sumW;
        out[idx + 3] = sumA / sumW;
      } else {
        // 退化:直接拷贝中心
        out[idx] = centerR;
        out[idx + 1] = centerG;
        out[idx + 2] = centerB;
        out[idx + 3] = centerA;
      }
    }
  }

  return { data: out, width: w, height: h };
}

// ── 主 denoise ────────────────────────────────────────────────────

/**
 * SVGF 完整去噪管线:时序累积 → 方差估计 → A-trous 迭代滤波。
 *
 * @param current         当前帧噪声颜色(SSR/SSGI/PathTracer 输出)
 * @param history         上一帧去噪后颜色(null = 首帧)
 * @param historySamples  上一帧累积样本数(null = 首帧)
 * @param velocity        速度缓冲
 * @param depth           深度缓冲
 * @param normal          法线缓冲
 * @param opts            选项
 * @returns               { output: 去噪颜色, history: 更新后历史, samples: 更新后样本数, stats: 统计 }
 */
export function svgfDenoise(
  current: SVGFPixelBuffer,
  history: SVGFPixelBuffer | null,
  historySamples: Float32Array | null,
  velocity: SVGFVelocityBuffer,
  depth: SVGFDepthBuffer,
  normal: SVGFNormalBuffer,
  opts: SVGFOptions = {},
): {
  output: SVGFPixelBuffer;
  history: SVGFPixelBuffer;
  samples: Float32Array;
  stats: SVGFStats;
} {
  const temporalAlpha = opts.temporalAlpha ?? 0.2;
  const atrousIterations = Math.max(1, Math.min(8, opts.atrousIterations ?? 4));
  const depthSigma = opts.depthSigma ?? 1.0;
  const normalPower = opts.normalPower ?? 32.0;
  const luminanceSigma = opts.luminanceSigma ?? 4.0;
  const varianceBoost = opts.varianceBoost ?? 1.0;

  const startTime = typeof performance !== 'undefined' ? performance.now() : 0;

  // 阶段 1:时序累积
  const { color: accumulated, samples, resets } = temporalAccumulation(
    current, history, historySamples, velocity, temporalAlpha,
  );

  // 阶段 2:方差估计
  let variance = estimateVariance(accumulated, samples);
  if (varianceBoost !== 1.0) {
    variance = variance.map(v => Math.min(1, v * varianceBoost));
  }

  // 阶段 3:A-trous 迭代滤波
  let filtered = accumulated;
  for (let i = 0; i < atrousIterations; i++) {
    const step = 1 << i; // 1, 2, 4, 8, ...
    filtered = atrousFilterIteration(
      filtered, depth, normal, variance, step,
      { depthSigma, normalPower, luminanceSigma },
    );
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : 0;

  // 统计
  let totalSamples = 0;
  let totalVariance = 0;
  const pixelCount = filtered.width * filtered.height;
  for (let i = 0; i < pixelCount; i++) {
    totalSamples += samples[i];
    totalVariance += variance[i];
  }

  const stats: SVGFStats = {
    pixelsProcessed: pixelCount,
    temporalResets: resets,
    avgSamples: pixelCount > 0 ? totalSamples / pixelCount : 0,
    avgVariance: pixelCount > 0 ? totalVariance / pixelCount : 0,
    atrousIterations,
    lastFrameTimeMs: endTime - startTime,
  };

  log.debug(
    `SVGF: ${filtered.width}x${filtered.height}, resets=${resets}, ` +
    `avgSamples=${stats.avgSamples.toFixed(1)}, ` +
    `avgVar=${stats.avgVariance.toFixed(4)}, ` +
    `iters=${atrousIterations}, ${stats.lastFrameTimeMs.toFixed(1)}ms`,
  );

  return {
    output: filtered,
    history: filtered,
    samples,
    stats,
  };
}

// ── 辅助:构造测试缓冲 ──────────────────────────────────────────

/**
 * 构造纯色像素缓冲(测试用)。
 */
export function makeSolidPixelBuffer(
  width: number, height: number,
  r: number, g: number, b: number, a: number = 255,
): SVGFPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width, height };
}

/**
 * 构造零速度缓冲(静态场景,测试用)。
 */
export function makeZeroVelocity(width: number, height: number): SVGFVelocityBuffer {
  return { data: new Float32Array(width * height * 2), width, height };
}

/**
 * 构造常量深度缓冲(测试用)。
 */
export function makeConstantDepth(
  width: number, height: number, value: number = 0.5,
): SVGFDepthBuffer {
  const data = new Float32Array(width * height);
  data.fill(value);
  return { data, width, height };
}

/**
 * 构造常量法线缓冲(测试用,默认指向 +Z)。
 */
export function makeConstantNormal(
  width: number, height: number,
  nx: number = 0, ny: number = 0, nz: number = 1,
): SVGFNormalBuffer {
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = nx;
    data[i + 1] = ny;
    data[i + 2] = nz;
  }
  return { data, width, height };
}

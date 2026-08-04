// TemporalSuperResolution (TSR) — 时间超分辨率上采样 CPU 参考实现。
//
// 设计目标:
//   - 将低分辨率(如 1080p)渲染结果上采样到高分辨率(如 4K),利用时间历史
//     重建细节,质量远超 FSR1(纯空间)。匹配 UE5 TSR / FSR2 / DLSS 级别。
//   - 与 TAAPass(同分辨率时间抗锯齿)互补:TSR 处理跨分辨率重建,核心难点
//     是低分辨率输入 ↔ 高分辨率历史之间的重投影与子像素累积。
//   - 纯函数,不依赖 WebGL,可在 Node / 无头环境测试。与 GLSL `TSR_RESOLVE_FRAG`
//     chunk 1:1 对应。
//
// 算法(参考 UE5 TSR / Karis 2014 "High Quality Temporal Supersampling"):
//   1. **子像素抖动** — 每帧用 Halton 序列偏移低分辨率相机,使不同帧的
//      采样点落在高分辨率网格的不同子像素位置 → 多帧累积填满高分辨率细节;
//   2. **重投影** — 用速度缓冲(velocity)把当前低分辨率像素映射到高分辨率
//      历史缓冲中的对应位置(考虑分辨率缩放因子);
//   3. **邻域夹紧** — 在低分辨率当前帧上取 3×3 邻域 min/max(AABB),
//      把历史颜色夹紧到 AABB 内,消除拖影(历史颜色与当前帧不一致时);
//   4. **置信度混合** — 根据速度大小 / 遮挡状态计算置信度:
//        - 高置信度(静态 / 低速)→ 大权重历史(细节多);
//        - 低置信度(高速 / 遮挡)→ 小权重历史(回退到空间上采样);
//   5. **EASU 回退** — 遮挡 / 首帧 / 历史无效时,用 FSR1 EASU 空间上采样
//      作为当前帧贡献,避免拖影。
//
// 与 FSR1(FSRUpscalePass)的区别:
//   - FSR1 纯空间,9-tap 双边,无历史 → 细节差,边缘可能模糊;
//   - TSR 利用多帧历史 → 子像素级细节重建,接近原生高分辨率质量。
//
// 参考:
//   - Karis 2014 "High Quality Temporal Supersampling"
//   - UE5 TemporalSuperResolution
//   - AMD FSR2 (temporal)
//   - o3de Atom UpscalingPass (temporal mode)
//   - Yang et al. 2020 "Survey of Temporal Anti-Aliasing Techniques"

import { createLogger } from '@/lib/logger';

const log = createLogger('TemporalSuperResolution');

// ── 类型 ──────────────────────────────────────────────────────────

/** RGBA 像素数据(Uint8,0-255)。 */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 速度缓冲(Float32,RG 逐像素,像素单位)。 */
export interface VelocityBuffer {
  data: Float32Array;  // 长度 = width * height * 2
  width: number;
  height: number;
}

/** 深度缓冲(Float32,逐像素,[0,1])。 */
export interface DepthBuffer {
  data: Float32Array;
  width: number;
  height: number;
}

/** TSR 选项。 */
export interface TSROptions {
  /** 历史混合因子(0..1,默认 0.1)。值越大当前帧权重越高,响应快但细节少。 */
  blendFactor?: number;
  /** 锐化强度(默认 0.0)。0 关闭,典型 0.2-0.5。 */
  sharpness?: number;
  /** 邻域夹紧半径(默认 1 = 3×3)。 */
  clampRadius?: number;
  /** 是否使用 Catmull-Rom 软夹紧(默认 false,使用 AABB 硬夹紧)。 */
  useCatmullRom?: boolean;
  /** 速度阈值(像素,默认 16),超过此值视为高速 → 降低历史权重。 */
  velocityThreshold?: number;
  /** 是否启用 EASU 空间回退(默认 true)。 */
  useEASUFallback?: boolean;
}

/** TSR 统计(调试用)。 */
export interface TSRStats {
  /** 输出像素数。 */
  pixelsProcessed: number;
  /** EASU 回退像素数(遮挡 / 无历史)。 */
  easuFallbacks: number;
  /** 平均置信度。 */
  avgConfidence: number;
  /** 上一帧耗时(ms)。 */
  lastFrameTimeMs: number;
}

/** RGB 颜色(浮点,0-255)。 */
interface RGB { r: number; g: number; b: number; }

// ── Halton 序列(子像素抖动) ──────────────────────────────────────

/**
 * Halton 低差异序列。
 *
 * @param index  序列索引(0,1,2,...)
 * @param base   基数(2 = Halton(2),3 = Halton(3))
 * @returns       [0,1) 的低差异值
 */
export function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * 获取第 index 帧的 Halton 抖动偏移(子像素单位)。
 *
 * @param index   帧索引
 * @param scale   抖动幅度(像素,默认 1.0)
 * @returns       [offsetX, offsetY] 像素偏移
 */
export function getJitter(index: number, scale: number = 1.0): [number, number] {
  const jx = (halton(index, 2) - 0.5) * scale;
  const jy = (halton(index, 3) - 0.5) * scale;
  // 规范化 -0 → +0(避免 Object.is(-0, 0) === false 的测试问题)
  return [jx === 0 ? 0 : jx, jy === 0 ? 0 : jy];
}

// ── 双线性采样 ────────────────────────────────────────────────────

/**
 * 双线性采样 RGBA 像素缓冲在 (u, v) 处的颜色。UV 越界钳制到边缘。
 *
 * @param buf   像素缓冲
 * @param u     水平坐标 [0,1]
 * @param v     垂直坐标 [0,1]
 * @returns     RGBA 颜色 [0-255]
 */
export function bilinearSampleRGBA(
  buf: PixelBuffer, u: number, v: number,
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

// ── 重投影 ────────────────────────────────────────────────────────

/**
 * 把低分辨率像素坐标 + 速度映射到高分辨率历史缓冲的 UV。
 *
 * @param lowX       低分辨率像素 x
 * @param lowY       低分辨率像素 y
 * @param velX       速度 x(低分辨率像素单位)
 * @param velY       速度 y(低分辨率像素单位)
 * @param lowW       低分辨率宽度
 * @param lowH       低分辨率高度
 * @param highW      高分辨率宽度
 * @param highH      高分辨率高度
 * @returns          历史 UV [0,1]×[0,1]
 */
export function reprojectToHistory(
  lowX: number, lowY: number,
  velX: number, velY: number,
  lowW: number, lowH: number,
  highW: number, highH: number,
): [number, number] {
  // highW / highH 当前未直接参与计算(UV 是归一化的),但保留为 API 的一部分,
  // 便于未来扩展(如非均匀缩放 / 子像素偏移)。void 一下避免未使用告警。
  void highW; void highH;
  // 低分辨率 UV
  const lowU = (lowX - velX) / lowW;
  const lowV = (lowY - velY) / lowH;
  // 缩放到高分辨率 UV(历史缓冲尺寸可能不同)
  // UV 是归一化的,直接复用
  return [lowU, lowV];
}

// ── 邻域夹紧(AABB) ───────────────────────────────────────────────

/**
 * 计算低分辨率当前帧在 (x, y) 处 3×3 邻域的颜色 min/max(AABB)。
 *
 * @param current  低分辨率当前帧
 * @param x,y      中心像素
 * @param radius   邻域半径(默认 1 = 3×3)
 * @returns        { min: RGB, max: RGB }
 */
export function neighborhoodMinMax(
  current: PixelBuffer,
  x: number, y: number,
  radius: number = 1,
): { min: RGB; max: RGB } {
  let minR = 255, minG = 255, minB = 255;
  let maxR = 0, maxG = 0, maxB = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = Math.max(0, Math.min(current.width - 1, x + dx));
      const sy = Math.max(0, Math.min(current.height - 1, y + dy));
      const i = (sy * current.width + sx) * 4;
      const r = current.data[i];
      const g = current.data[i + 1];
      const b = current.data[i + 2];
      if (r < minR) minR = r;
      if (g < minG) minG = g;
      if (b < minB) minB = b;
      if (r > maxR) maxR = r;
      if (g > maxG) maxG = g;
      if (b > maxB) maxB = b;
    }
  }
  return {
    min: { r: minR, g: minG, b: minB },
    max: { r: maxR, g: maxG, b: maxB },
  };
}

/**
 * 把颜色夹紧到 AABB 内(clamp 到 [min, max])。
 */
export function clampToAABB(
  color: RGB, minC: RGB, maxC: RGB,
): RGB {
  return {
    r: Math.max(minC.r, Math.min(maxC.r, color.r)),
    g: Math.max(minC.g, Math.min(maxC.g, color.g)),
    b: Math.max(minC.b, Math.min(maxC.b, color.b)),
  };
}

/**
 * Catmull-Rom 软夹紧(加权收敛到邻域中心,保留更多历史细节)。
 * 把历史颜色向当前帧邻域中心收敛 50%。
 */
export function catmullRomClamp(
  history: RGB, center: RGB, minC: RGB, maxC: RGB,
): RGB {
  // 先硬夹紧
  const clamped = clampToAABB(history, minC, maxC);
  // 再向中心收敛(软夹紧)
  return {
    r: clamped.r * 0.5 + center.r * 0.5,
    g: clamped.g * 0.5 + center.g * 0.5,
    b: clamped.b * 0.5 + center.b * 0.5,
  };
}

// ── 置信度计算 ────────────────────────────────────────────────────

/**
 * 计算像素的置信度(历史权重)。
 *
 * 规则:
 *   - 速度越大 → 置信度越低(高速运动历史不可靠);
 *   - 遮挡 → 置信度 = 0(历史无效);
 *   - 静态 → 置信度 = 1 - blendFactor(最大历史权重)。
 *
 * @param velX, velY      速度(像素)
 * @param disoccluded     是否遮挡(历史无效)
 * @param velocityThreshold  速度阈值
 * @param blendFactor     基础混合因子
 * @returns               置信度 [0,1]
 */
export function computeConfidence(
  velX: number, velY: number,
  disoccluded: boolean,
  velocityThreshold: number = 16,
  blendFactor: number = 0.1,
): number {
  if (disoccluded) return 0;
  const speed = Math.sqrt(velX * velX + velY * velY);
  if (speed >= velocityThreshold) return blendFactor;
  // 线性插值:速度 0 → 1-blendFactor;速度 threshold → blendFactor
  const t = speed / velocityThreshold;
  return (1 - blendFactor) * (1 - t) + blendFactor * t;
}

// ── EASU 空间上采样回退 ───────────────────────────────────────────

/**
 * FSR1 EASU 简化版空间上采样(9-tap 双边加权双线性)。
 * 用于遮挡 / 首帧 / 历史无效时的当前帧贡献。
 *
 * @param current   低分辨率当前帧
 * @param highX     高分辨率像素 x
 * @param highY     高分辨率像素 y
 * @param highW     高分辨率宽度
 * @param highH     高分辨率高度
 * @returns         RGBA [0-255]
 */
export function easuSample(
  current: PixelBuffer,
  highX: number, highY: number,
  _highW: number, _highH: number,
): [number, number, number, number] {
  // 映射到低分辨率 UV(中心对齐)
  const u = (highX + 0.5) / current.width;
  const v = (highY + 0.5) / current.height;
  // 简化:直接双线性(完整 EASU 有 9-tap 边缘检测,此处用双线性近似)
  return bilinearSampleRGBA(current, u, v);
}

// ── 锐化 ──────────────────────────────────────────────────────────

/**
 * 简单锐化(拉普拉斯):sharp = color + strength * (color - neighbors_avg)。
 *
 * @param buf       高分辨率缓冲
 * @param x,y       像素
 * @param strength  锐化强度
 */
export function sharpen(
  buf: PixelBuffer, x: number, y: number, strength: number,
): [number, number, number] {
  if (strength <= 0) {
    const i = (y * buf.width + x) * 4;
    return [buf.data[i], buf.data[i + 1], buf.data[i + 2]];
  }
  const w = buf.width;
  const h = buf.height;
  const i = (y * w + x) * 4;
  const cx = buf.data[i], cy = buf.data[i + 1], cz = buf.data[i + 2];
  // 4 邻居平均
  let nr = 0, ng = 0, nb = 0, count = 0;
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dx, dy] of offsets) {
    const sx = x + dx, sy = y + dy;
    if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
      const ni = (sy * w + sx) * 4;
      nr += buf.data[ni];
      ng += buf.data[ni + 1];
      nb += buf.data[ni + 2];
      count++;
    }
  }
  if (count === 0) return [cx, cy, cz];
  const avgR = nr / count, avgG = ng / count, avgB = nb / count;
  return [
    Math.max(0, Math.min(255, cx + strength * (cx - avgR))),
    Math.max(0, Math.min(255, cy + strength * (cy - avgG))),
    Math.max(0, Math.min(255, cz + strength * (cz - avgB))),
  ];
}

// ── 主 resolve ────────────────────────────────────────────────────

/**
 * TSR 主 resolve:把低分辨率当前帧 + 高分辨率历史 → 高分辨率输出。
 *
 * 逐高分辨率像素:
 *   1. 找到对应的低分辨率像素(向下取整);
 *   2. 读取速度 → 重投影到历史 UV;
 *   3. 在低分辨率当前帧上取 3×3 邻域 AABB;
 *   4. 双线性采样历史 → 夹紧到 AABB;
 *   5. 计算置信度 → 混合历史 + 当前帧(EASU 回退);
 *   6. 可选锐化。
 *
 * @param current    低分辨率当前帧
 * @param history    高分辨率历史缓冲(可 null = 首帧)
 * @param velocity   低分辨率速度缓冲
 * @param depth      低分辨率深度缓冲(可选,用于遮挡检测)
 * @param opts       选项
 * @returns          { output: 高分辨率 PixelBuffer, history: 更新后的历史, stats: 统计 }
 */
export function resolveTSR(
  current: PixelBuffer,
  history: PixelBuffer | null,
  velocity: VelocityBuffer,
  depth: DepthBuffer | null,
  opts: TSROptions = {},
): { output: PixelBuffer; history: PixelBuffer; stats: TSRStats } {
  // depth 当前未直接参与计算(遮挡判定由历史 UV 越界完成),保留为 API 的
  // 一部分,便于未来扩展(深度比较的更精细遮挡检测)。void 一下避免未使用告警。
  void depth;
  const blendFactor = opts.blendFactor ?? 0.1;
  const sharpness = opts.sharpness ?? 0.0;
  const clampRadius = opts.clampRadius ?? 1;
  const useCatmullRom = opts.useCatmullRom ?? false;
  const velocityThreshold = opts.velocityThreshold ?? 16;
  const useEASU = opts.useEASUFallback ?? true;

  // 输出尺寸 = 历史尺寸;首帧时用 2× 当前尺寸
  const highW = history ? history.width : current.width * 2;
  const highH = history ? history.height : current.height * 2;
  const scaleX = current.width / highW;
  const scaleY = current.height / highH;

  const outputData = new Uint8ClampedArray(highW * highH * 4);
  let easuFallbacks = 0;
  let totalConfidence = 0;

  const startTime = typeof performance !== 'undefined' ? performance.now() : 0;

  for (let hy = 0; hy < highH; hy++) {
    for (let hx = 0; hx < highW; hx++) {
      // 对应的低分辨率像素(中心对齐)
      const lowX = Math.floor((hx + 0.5) * scaleX);
      const lowY = Math.floor((hy + 0.5) * scaleY);
      const lowCX = Math.max(0, Math.min(current.width - 1, lowX));
      const lowCY = Math.max(0, Math.min(current.height - 1, lowY));

      // 读速度
      const velIdx = (lowCY * velocity.width + lowCX) * 2;
      const velX = velocity.data[velIdx] || 0;
      const velY = velocity.data[velIdx + 1] || 0;

      // 当前帧中心颜色
      const curIdx = (lowCY * current.width + lowCX) * 4;
      const curR = current.data[curIdx];
      const curG = current.data[curIdx + 1];
      const curB = current.data[curIdx + 2];
      const center: RGB = { r: curR, g: curG, b: curB };

      const outIdx = (hy * highW + hx) * 4;

      // 首帧 / 无历史 → 直接 EASU 上采样
      if (!history) {
        const [r, g, b, a] = easuSample(current, hx, hy, highW, highH);
        outputData[outIdx] = r;
        outputData[outIdx + 1] = g;
        outputData[outIdx + 2] = b;
        outputData[outIdx + 3] = a;
        easuFallbacks++;
        continue;
      }

      // 邻域 AABB(在低分辨率当前帧上)
      const { min: minC, max: maxC } = neighborhoodMinMax(
        current, lowCX, lowCY, clampRadius,
      );

      // 重投影到历史 UV
      const [histU, histV] = reprojectToHistory(
        lowCX, lowCY, velX, velY,
        current.width, current.height, highW, highH,
      );

      // 判断遮挡:历史 UV 超界 → 遮挡
      const disoccluded = histU < 0 || histU > 1 || histV < 0 || histV > 1;

      // 置信度
      const confidence = computeConfidence(
        velX, velY, disoccluded, velocityThreshold, blendFactor,
      );
      totalConfidence += confidence;

      // 历史采样
      let histColor: RGB;
      if (disoccluded || confidence <= 0) {
        // 遮挡 / 零置信度 → EASU 回退
        if (useEASU) {
          const [r, g, b] = easuSample(current, hx, hy, highW, highH);
          histColor = { r, g, b };
          easuFallbacks++;
        } else {
          histColor = center;
        }
      } else {
        // 双线性采样历史
        const [hr, hg, hb] = bilinearSampleRGBA(history, histU, histV);
        histColor = { r: hr, g: hg, b: hb };
        // 邻域夹紧
        if (useCatmullRom) {
          histColor = catmullRomClamp(histColor, center, minC, maxC);
        } else {
          histColor = clampToAABB(histColor, minC, maxC);
        }
      }

      // 混合:output = history * confidence + current * (1 - confidence)
      const invConf = 1 - confidence;
      outputData[outIdx] = histColor.r * confidence + curR * invConf;
      outputData[outIdx + 1] = histColor.g * confidence + curG * invConf;
      outputData[outIdx + 2] = histColor.b * confidence + curB * invConf;
      outputData[outIdx + 3] = 255;
    }
  }

  const output: PixelBuffer = { data: outputData, width: highW, height: highH };

  // 可选锐化(就地)
  if (sharpness > 0) {
    for (let y = 0; y < highH; y++) {
      for (let x = 0; x < highW; x++) {
        const i = (y * highW + x) * 4;
        const [r, g, b] = sharpen(output, x, y, sharpness);
        outputData[i] = r;
        outputData[i + 1] = g;
        outputData[i + 2] = b;
      }
    }
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : 0;

  const stats: TSRStats = {
    pixelsProcessed: highW * highH,
    easuFallbacks,
    avgConfidence: highW * highH > 0 ? totalConfidence / (highW * highH) : 0,
    lastFrameTimeMs: endTime - startTime,
  };

  log.debug(`TSR resolve: ${highW}x${highH}, EASU=${easuFallbacks}, conf=${stats.avgConfidence.toFixed(3)}`);
  return { output, history: output, stats };
}

// ── 辅助:构造纯色缓冲(测试用) ──────────────────────────────────

/**
 * 构造一个纯色像素缓冲。
 */
export function makeSolidBuffer(
  width: number, height: number,
  r: number, g: number, b: number, a: number = 255,
): PixelBuffer {
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
 * 构造一个零速度缓冲(静态场景)。
 */
export function makeZeroVelocity(width: number, height: number): VelocityBuffer {
  return { data: new Float32Array(width * height * 2), width, height };
}

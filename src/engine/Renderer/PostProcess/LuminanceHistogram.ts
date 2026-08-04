// LuminanceHistogram — 亮度直方图生成 + 自动曝光(eye adaptation)CPU 工具。
//
// 适配自 o3de Atom LuminanceHistogramGeneratorPass + ExposureControlSettings。
// 生成 128-bin 对数空间(EV100)亮度直方图,然后从直方图百分位数计算目标曝光值,
// 再用非对称指数适应(亮适应快/暗适应慢)模拟人眼适应过程。
//
// 与 AutoExposurePass(对数平均亮度)互补:
//   - AutoExposurePass: 计算全屏对数平均亮度 → 简单但被天空/阴影主导
//   - LuminanceHistogram: 128-bin 直方图 + 百分位数 → 更鲁棒,可忽略极端像素
//
// 直方图法的优势:
//   1. 可通过 lowPercentile/highPercentile 裁剪极端值(天空过曝/阴影死黑不影响)
//   2. 直方图数据可用于调试可视化(亮度热力图)
//   3. 与 UE5 / o3de / HDR 显示器标准对齐
//
// 算法:
//   1. 遍历像素 → Rec709 亮度 → EV100 → bin(对数映射)
//   2. 累积直方图 → 找 [lowPercentile, highPercentile] 范围内的加权平均 EV
//   3. targetExposure = clamp(weightedEV, minExposure, maxExposure)
//   4. 适应:exposure += (target - exposure) * (1 - exp(-dt * speed))
//
// 参考:
//   - o3de Atom: LuminanceHistogramGenerator.azsl + ExposureControlSettings.cpp
//   - UE5: AutoExposure histogram (EyeAdaptation)
//   - Reinhard et al. 2005: "Dynamic Range Reduction Inspired by Photoreceptor Physiology"
//   - Photographic EV100: EV100 = log2(L * S / K), S=100, K=12.5 → EV100 = log2(L * 8)

/** 直方图 bin 数量(与 o3de NUM_HISTOGRAM_BINS 对齐)。 */
export const NUM_HISTOGRAM_BINS = 128;

/** EV100 显示范围默认值(与 o3de GetEvDisplayRangeMinMax 对齐)。 */
export const DEFAULT_EV_MIN = -8;
export const DEFAULT_EV_MAX = 16;

/** Rec709 亮度权重。 */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** 直方图生成选项。 */
export interface HistogramOptions {
  /** EV100 范围下限(默认 -8)。 */
  evMin?: number;
  /** EV100 范围上限(默认 16)。 */
  evMax?: number;
  /** 降采样因子(默认 4,即每 4×4=16 像素取 1 个,提速)。0 或 1 = 全分辨率。 */
  downsample?: number;
}

/** 自动曝光选项。 */
export interface AutoExposureOptions extends HistogramOptions {
  /** 低端百分位裁剪(默认 0.8,即忽略最暗 0.8% 像素)。 */
  lowPercentile?: number;
  /** 高端百分位裁剪(默认 0.8,即忽略最亮 0.8% 像素)。 */
  highPercentile?: number;
  /** 最小曝光值 EV100(默认 -4)。 */
  minExposure?: number;
  /** 最大曝光值 EV100(默认 4)。 */
  maxExposure?: number;
  /** 眼睛适应速度(变亮时,默认 3.0,单位 1/秒)。 */
  speedUp?: number;
  /** 眼睛适应速度(变暗时,默认 1.0,单位 1/秒)。 */
  speedDown?: number;
  /** 手动曝光补偿 EV100(默认 0)。 */
  manualCompensation?: number;
}

/** 直方图 + 统计数据。 */
export interface HistogramResult {
  /** 128-bin 直方图(每 bin 的像素计数)。 */
  bins: Uint32Array;
  /** 总采样像素数。 */
  totalCount: number;
  /** EV100 范围。 */
  evMin: number;
  evMax: number;
}

/**
 * 将线性 RGB 亮度转换为 EV100。
 *
 * EV100 = log2(luminance * 8)
 * (摄影标准:S=100 ISO, K=12.5 → EV100 = log2(L * S / K) = log2(L * 8))
 *
 * 0 亮度 → evMin(避免 log(0) = -Inf)
 */
export function luminanceToEV100(luminance: number, evMin: number = DEFAULT_EV_MIN): number {
  if (luminance <= 0) return evMin;
  return Math.log2(luminance * 8.0);
}

/**
 * 将 EV100 转换为线性亮度。
 *
 * luminance = 2^(EV100 - 3) = 2^EV100 / 8
 */
export function ev100ToLuminance(ev: number): number {
  return Math.pow(2, ev) / 8.0;
}

/**
 * 将 EV100 映射到直方图 bin 索引。
 *
 * bin = clamp((ev - evMin) / (evMax - evMin) * NUM_HISTOGRAM_BINS, 0, NUM_HISTOGRAM_BINS - 1)
 */
export function ev100ToBin(ev: number, evMin: number = DEFAULT_EV_MIN, evMax: number = DEFAULT_EV_MAX): number {
  const range = evMax - evMin;
  if (range <= 0) return 0;
  const bin = (ev - evMin) / range * NUM_HISTOGRAM_BINS;
  return Math.max(0, Math.min(NUM_HISTOGRAM_BINS - 1, Math.floor(bin)));
}

/**
 * 将 bin 索引转换回 EV100(取 bin 中心)。
 */
export function binToEV100(bin: number, evMin: number = DEFAULT_EV_MIN, evMax: number = DEFAULT_EV_MAX): number {
  const range = evMax - evMin;
  return evMin + (bin + 0.5) / NUM_HISTOGRAM_BINS * range;
}

/**
 * 从 RGBA 像素数据计算 128-bin 亮度直方图(纯函数)。
 *
 * @param pixels   RGBA 像素数据(Uint8Array 或 Float32Array,每像素 4 通道)
 * @param width    图像宽度
 * @param height   图像高度
 * @param options  直方图选项
 * @returns 直方图结果
 */
export function computeHistogram(
  pixels: Uint8Array | Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  options: HistogramOptions = {},
): HistogramResult {
  const evMin = options.evMin ?? DEFAULT_EV_MIN;
  const evMax = options.evMax ?? DEFAULT_EV_MAX;
  const downsample = options.downsample ?? 4;
  const step = downsample > 1 ? downsample : 1;

  const bins = new Uint32Array(NUM_HISTOGRAM_BINS);
  let totalCount = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      // 判断是 Uint8 还是 Float 数据
      // Uint8: [0,255] → 归一化到 [0,1]
      // Float: 假设已是线性 [0,1] 或 HDR
      const isUint8 = pixels instanceof Uint8Array;
      const rn = isUint8 ? r / 255 : r;
      const gn = isUint8 ? g / 255 : g;
      const bn = isUint8 ? b / 255 : b;

      // sRGB → 线性(近似 gamma 2.2,仅 Uint8 数据需要)
      const rl = isUint8 ? sRGBToLinear(rn) : rn;
      const gl = isUint8 ? sRGBToLinear(gn) : gn;
      const bl = isUint8 ? sRGBToLinear(bn) : bn;

      // Rec709 亮度
      const lum = rl * LUMA_R + gl * LUMA_G + bl * LUMA_B;
      const ev = luminanceToEV100(lum, evMin);
      const bin = ev100ToBin(ev, evMin, evMax);
      bins[bin]++;
      totalCount++;
    }
  }

  return { bins, totalCount, evMin, evMax };
}

/**
 * 从直方图计算目标曝光值(EV100)。
 *
 * 使用百分位数裁剪:忽略最暗 lowPercentile% 和最亮 highPercentile% 的像素,
 * 然后在剩余范围内取加权平均 EV。
 *
 * 算法:对每个 bin,计算其像素在累积直方图中落在 [lowCount, totalCount-highCount]
 * 区间内的部分,按比例计入加权平均。这样可正确处理"所有像素在同一 bin"等边界情况。
 *
 * @param histogram  直方图数据
 * @param options    自动曝光选项
 * @returns 目标曝光值 EV100
 */
export function histogramToExposure(
  histogram: HistogramResult,
  options: AutoExposureOptions = {},
): number {
  const {
    lowPercentile = 0.8,
    highPercentile = 0.8,
    minExposure = -4,
    maxExposure = 4,
    manualCompensation = 0,
  } = options;

  const { bins, totalCount, evMin, evMax } = histogram;

  if (totalCount === 0) {
    return clamp(manualCompensation, minExposure, maxExposure);
  }

  // 计算裁剪阈值(像素数)
  const lowCount = totalCount * (lowPercentile / 100);
  const highCount = totalCount * (highPercentile / 100);
  const validUpper = totalCount - highCount; // 累积直方图有效区上界
  const validCount = validUpper - lowCount;

  if (validCount <= 0) {
    // 所有像素都被裁剪 → 取中间 bin
    const midBin = Math.floor(NUM_HISTOGRAM_BINS / 2);
    return clamp(binToEV100(midBin, evMin, evMax) + manualCompensation, minExposure, maxExposure);
  }

  // 遍历所有 bin,对每个 bin 计算其落入 [lowCount, validUpper] 区间的像素比例,
  // 然后按比例计入加权平均(部分 bin 贡献)。
  let cumulative = 0;
  let weightedEVSum = 0;
  let validPixels = 0;

  for (let i = 0; i < NUM_HISTOGRAM_BINS; i++) {
    const binCount = bins[i];
    if (binCount === 0) continue;

    const cumAfter = cumulative + binCount;
    // 该 bin 中落入有效区间的像素数:
    //   lower = max(累积前, lowCount)
    //   upper = min(累积后, validUpper)
    //   pixelsInBin = max(0, upper - lower)
    const lower = Math.max(cumulative, lowCount);
    const upper = Math.min(cumAfter, validUpper);
    if (upper > lower) {
      const pixelsInBin = upper - lower;
      const ev = binToEV100(i, evMin, evMax);
      weightedEVSum += ev * pixelsInBin;
      validPixels += pixelsInBin;
    }
    cumulative = cumAfter;
  }

  if (validPixels <= 0) {
    // 极端情况:无像素落入有效区间 → 取中间 bin
    const midBin = Math.floor(NUM_HISTOGRAM_BINS / 2);
    return clamp(binToEV100(midBin, evMin, evMax) + manualCompensation, minExposure, maxExposure);
  }

  const targetEV = weightedEVSum / validPixels + manualCompensation;
  return clamp(targetEV, minExposure, maxExposure);
}

/**
 * 应用眼睛适应(非对称指数)。
 *
 * 亮环境 → 暗环境:瞳孔放大,速度慢(speedDown)
 * 暗环境 → 亮环境:瞳孔缩小,速度快(speedUp)
 *
 * @param currentExposure  当前曝光值 EV100
 * @param targetExposure   目标曝光值 EV100
 * @param dt               帧间隔(秒)
 * @param speedUp          变亮时适应速度(1/秒)
 * @param speedDown        变暗时适应速度(1/秒)
 * @returns 适应后的曝光值
 */
export function adaptExposure(
  currentExposure: number,
  targetExposure: number,
  dt: number,
  speedUp: number = 3.0,
  speedDown: number = 1.0,
): number {
  if (dt <= 0) return currentExposure;

  // target > current → 场景变亮 → 用 speedUp(快速适应)
  // target < current → 场景变暗 → 用 speedDown(慢速适应)
  const speed = targetExposure > currentExposure ? speedUp : speedDown;
  const factor = 1.0 - Math.exp(-dt * speed);

  return currentExposure + (targetExposure - currentExposure) * factor;
}

// ── 内部工具 ──────────────────────────────────────────────────────

function sRGBToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * LuminanceHistogram — 有状态的自动曝光管理器。
 *
 * 封装 computeHistogram + histogramToExposure + adaptExposure 为可复用对象。
 * 每帧调用 update(),内部自动管理适应状态。
 *
 * @example
 * ```ts
 * const meter = new LuminanceHistogram({
 *   minExposure: -4,
 *   maxExposure: 4,
 *   speedUp: 3.0,
 *   speedDown: 1.0,
 * });
 *
 * // 每帧:
 * const exposure = meter.update(pixelData, width, height, dt);
 * // exposure = 当前适应后的 EV100
 * ```
 */
export class LuminanceHistogram {
  private _options: AutoExposureOptions;
  private _currentExposure: number;
  private _targetExposure: number;
  private _lastHistogram: HistogramResult | null = null;

  constructor(options: AutoExposureOptions = {}) {
    this._options = options;
    // 初始曝光设为范围中点
    const min = options.minExposure ?? -4;
    const max = options.maxExposure ?? 4;
    this._currentExposure = (min + max) / 2;
    this._targetExposure = this._currentExposure;
  }

  /**
   * 每帧更新:计算直方图 → 目标曝光 → 适应。
   *
   * @param pixels   RGBA 像素数据
   * @param width    图像宽度
   * @param height   图像高度
   * @param dt       帧间隔(秒)
   * @returns 适应后的曝光值 EV100
   */
  update(
    pixels: Uint8Array | Float32Array | ArrayLike<number>,
    width: number,
    height: number,
    dt: number,
  ): number {
    // 1. 计算直方图
    this._lastHistogram = computeHistogram(pixels, width, height, this._options);

    // 2. 从直方图计算目标曝光
    this._targetExposure = histogramToExposure(this._lastHistogram, this._options);

    // 3. 应用眼睛适应
    const speedUp = this._options.speedUp ?? 3.0;
    const speedDown = this._options.speedDown ?? 1.0;
    this._currentExposure = adaptExposure(
      this._currentExposure,
      this._targetExposure,
      dt,
      speedUp,
      speedDown,
    );

    return this._currentExposure;
  }

  /** 当前适应后的曝光值 EV100。 */
  get currentExposure(): number {
    return this._currentExposure;
  }

  /** 目标曝光值 EV100(未适应)。 */
  get targetExposure(): number {
    return this._targetExposure;
  }

  /** 上次计算的直方图(可用于调试可视化)。 */
  get lastHistogram(): HistogramResult | null {
    return this._lastHistogram;
  }

  /** 更新选项(运行时可调)。 */
  setOptions(options: Partial<AutoExposureOptions>): void {
    this._options = { ...this._options, ...options };
  }

  /** 获取当前选项。 */
  getOptions(): AutoExposureOptions {
    return this._options;
  }

  /** 手动设置当前曝光(重置适应状态)。 */
  setExposure(ev: number): void {
    this._currentExposure = ev;
    this._targetExposure = ev;
  }
}

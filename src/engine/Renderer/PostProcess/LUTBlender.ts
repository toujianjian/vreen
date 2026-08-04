// LUTBlender — 多 LUT 层级混合器(CPU 实现)。
//
// 适配自 o3de Atom BlendColorGradingLutsPass + LookModificationSettings。
// 将最多 4 个颜色分级 LUT 按优先级 + intensity + overrideStrength 层级混合,
// 生成单个 blended LUT 供 LUTPass 使用。适用于:
//   - 昼夜循环颜色过渡(白天 LUT ↔ 黄昏 LUT ↔ 夜晚 LUT)
//   - 区域/心情切换(室内暖色 ↔ 室外冷色)
//   - 叙事效果(健康 → 受伤红色渐变)
//
// 与 LUTPass 互补:LUTPass 应用单个 LUT 到场景,LUTBlender 在应用前
// 把多个 LUT 预混合为一个。这样每帧只需 1 次 LUT 采样(而非 N 次),
// 显著降低 GPU 开销。
//
// o3de 层级混合权重公式 (CheckLutBlendSettings):
//   对 N 个 LUT(按优先级从低到高排列),每个有 intensity[i] 和 override[i]:
//     weight[0] (未分级基色) = Σ (1-intensity[i]) * override[i] * Π_{j>i} (1-override[j])
//     weight[i+1] (LUT i)    = intensity[i] * override[i] * Π_{j>i} (1-override[j])
//   所有权重之和 = 1(能量守恒)。
//
//   intuition:
//   - intensity = 该 LUT 的"染色强度"(0=不染色,1=完全染色)
//   - override  = 该 LUT 对低优先级 LUT 的"覆盖强度"(1=完全覆盖低优先级)
//   - 高优先级 LUT 的 override 越高,低优先级 LUT 的贡献越被压制
//
// 参考:
//   - o3de Atom: PostProcessing/BlendColorGradingLutsPass.cpp + .azsl
//   - o3de LookModificationSettings: MaxBlendLuts = 4
//   - ACES 1.0: Look Modification Transform

import { createLogger } from '@/lib/logger';

const log = createLogger('LUTBlender');

/** 最大混合 LUT 数(与 o3de LookModificationSettings::MaxBlendLuts 对齐)。 */
export const MAX_BLEND_LUTS = 4;

/** 3D LUT 数据(扁平 Float32Array,size³ × 3 通道,线性 RGB [0..1])。 */
export interface LUT3DData {
  /** 扁平 RGB 数据,长度 = size³ × 3。索引: [(z*size+y)*size+x]*3 + c。 */
  data: Float32Array;
  /** 每轴格点数(典型 16 或 32)。 */
  size: number;
}

/** 单个待混合 LUT 的输入(数据 + 混合参数)。 */
export interface LUTBlendItem {
  /** LUT 数据(3D,线性 RGB)。 */
  lut: LUT3DData;
  /** 染色强度(0..1)。0=不染色(贡献基色),1=完全染色。 */
  intensity: number;
  /**
   * 覆盖强度(0..1)。该 LUT 对低优先级 LUT 的覆盖程度。
   * 1=完全覆盖低优先级 LUT,0=与低优先级 LUT 平等混合。
   */
  overrideStrength: number;
}

/** 混合选项。 */
export interface LUTBlendOptions {
  /** 输出 LUT 的每轴格点数(默认取第一个 LUT 的 size)。 */
  outputSize?: number;
}

/**
 * 计算 o3de 层级混合权重(纯函数,无副作用)。
 *
 * 给定 N 个 LUT 的 intensity 和 overrideStrength(按优先级从低到高),
 * 计算每个 LUT 的权重 + 基色权重。所有权重的和 = 1。
 *
 * @param intensities       每个 LUT 的染色强度(长度 ≤ MAX_BLEND_LUTS)
 * @param overrideStrengths 每个 LUT 的覆盖强度(长度 ≤ MAX_BLEND_LUTS)
 * @returns 长度 MAX_BLEND_LUTS+1 的数组: [baseWeight, lutWeight0, lutWeight1, ...]
 *
 * @example
 * ```ts
 * // 2 个 LUT,LUT0 intensity=1 override=1,LUT1 intensity=1 override=0.5
 * const w = computeBlendWeights([1, 1], [1, 0.5]);
 * // w[0] = base weight (未分级)
 * // w[1] = LUT0 weight
 * // w[2] = LUT1 weight
 * ```
 */
export function computeBlendWeights(
  intensities: readonly number[],
  overrideStrengths: readonly number[],
): number[] {
  const n = Math.min(intensities.length, overrideStrengths.length, MAX_BLEND_LUTS);
  const weights = new Array<number>(MAX_BLEND_LUTS + 1).fill(0);

  if (n === 0) {
    // 无 LUT → 纯基色(identity)
    weights[0] = 1.0;
    return weights;
  }

  const intensity: number[] = new Array(MAX_BLEND_LUTS).fill(0);
  const oneIntensity: number[] = new Array(MAX_BLEND_LUTS).fill(1);
  const over: number[] = new Array(MAX_BLEND_LUTS).fill(0);
  const oneOver: number[] = new Array(MAX_BLEND_LUTS).fill(1);

  for (let i = 0; i < n; i++) {
    intensity[i] = intensities[i];
    oneIntensity[i] = 1.0 - intensities[i];
    over[i] = overrideStrengths[i];
    oneOver[i] = 1.0 - overrideStrengths[i];
  }

  // weight[0] = 基色(未分级)权重
  weights[0] = 0;
  for (let i = 0; i < n; i++) {
    let w = oneIntensity[i] * over[i];
    for (let j = i + 1; j < MAX_BLEND_LUTS; j++) {
      w *= oneOver[j];
    }
    weights[0] += w;
  }

  // weight[i+1] = LUT i 的权重
  for (let i = 0; i < n; i++) {
    let w = intensity[i] * over[i];
    for (let j = i + 1; j < MAX_BLEND_LUTS; j++) {
      w *= oneOver[j];
    }
    weights[i + 1] = w;
  }

  return weights;
}

/**
 * 三线性采样 3D LUT(纯函数)。
 *
 * @param lut   LUT 数据
 * @param size  每轴格点数
 * @param r     R 通道坐标 [0..1]
 * @param g     G 通道坐标 [0..1]
 * @param b     B 通道坐标 [0..1]
 * @returns 采样后的 [r, g, b]
 */
export function sampleLUT3D(
  data: Float32Array,
  size: number,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  // 把 [0,1] 映射到 [0, size-1],然后做三线性插值
  const fx = clamp(r, 0, 1) * (size - 1);
  const fy = clamp(g, 0, 1) * (size - 1);
  const fz = clamp(b, 0, 1) * (size - 1);

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const z1 = Math.min(z0 + 1, size - 1);

  const dx = fx - x0;
  const dy = fy - y0;
  const dz = fz - z0;

  // 8 个角的采样
  const idx = (x: number, y: number, z: number): number => ((z * size + y) * size + x) * 3;

  const c000 = idx(x0, y0, z0);
  const c100 = idx(x1, y0, z0);
  const c010 = idx(x0, y1, z0);
  const c110 = idx(x1, y1, z0);
  const c001 = idx(x0, y0, z1);
  const c101 = idx(x1, y0, z1);
  const c011 = idx(x0, y1, z1);
  const c111 = idx(x1, y1, z1);

  const out: [number, number, number] = [0, 0, 0];

  for (let ch = 0; ch < 3; ch++) {
    // X 轴插值
    const a = lerp(data[c000 + ch], data[c100 + ch], dx);
    const b_ = lerp(data[c010 + ch], data[c110 + ch], dx);
    const c = lerp(data[c001 + ch], data[c101 + ch], dx);
    const d = lerp(data[c011 + ch], data[c111 + ch], dx);

    // Y 轴插值
    const e = lerp(a, b_, dy);
    const f = lerp(c, d, dy);

    // Z 轴插值
    out[ch] = lerp(e, f, dz);
  }

  return out;
}

/**
 * 混合多个 3D LUT(纯函数,无副作用)。
 *
 * 使用 o3de 层级权重公式,将最多 4 个 LUT 混合为单个 LUT。
 * 生成的 LUT 可直接传给 LUTPass。
 *
 * @param items   待混合的 LUT 列表(按优先级从低到高,长度 ≤ MAX_BLEND_LUTS)
 * @param options 输出选项(outputSize)
 * @returns 混合后的 LUT
 *
 * @example
 * ```ts
 * // 昼夜过渡:50% 白天 LUT + 50% 黄昏 LUT
 * const blended = blendLUTs([
 *   { lut: dayLUT,   intensity: 1.0, overrideStrength: 1.0 },
 *   { lut: duskLUT,  intensity: 1.0, overrideStrength: 0.5 },
 * ]);
 * // 传给 LUTPass
 * lutPass.lut = blendedToTexture(blended);
 * ```
 */
export function blendLUTs(
  items: readonly LUTBlendItem[],
  options: LUTBlendOptions = {},
): LUT3DData {
  const n = Math.min(items.length, MAX_BLEND_LUTS);
  if (n === 0) {
    // 无 LUT → 返回 identity LUT
    const size = options.outputSize ?? 16;
    return makeIdentityLUT(size);
  }

  const outSize = options.outputSize ?? items[0].lut.size;
  const outData = new Float32Array(outSize * outSize * outSize * 3);

  // 计算混合权重
  const intensities = items.slice(0, n).map(it => it.intensity);
  const overrides = items.slice(0, n).map(it => it.overrideStrength);
  const weights = computeBlendWeights(intensities, overrides);

  // 遍历输出 LUT 的每个 texel
  for (let z = 0; z < outSize; z++) {
    for (let y = 0; y < outSize; y++) {
      for (let x = 0; x < outSize; x++) {
        // 输出 texel 坐标 → [0,1] 线性 RGB(基色 = identity)
        const r = x / (outSize - 1);
        const g = y / (outSize - 1);
        const b = z / (outSize - 1);

        // 基色贡献
        let or = r * weights[0];
        let og = g * weights[0];
        let ob = b * weights[0];

        // 各 LUT 贡献
        for (let i = 0; i < n; i++) {
          const w = weights[i + 1];
          if (w === 0) continue;
          const lut = items[i].lut;
          const sampled = sampleLUT3D(lut.data, lut.size, r, g, b);
          or += sampled[0] * w;
          og += sampled[1] * w;
          ob += sampled[2] * w;
        }

        const idx = ((z * outSize + y) * outSize + x) * 3;
        outData[idx] = or;
        outData[idx + 1] = og;
        outData[idx + 2] = ob;
      }
    }
  }

  log.debug(`blended ${n} LUTs → ${outSize}³`);
  return { data: outData, size: outSize };
}

/**
 * 生成 identity LUT(恒等变换,LUT 输入 = 输出)。
 * 用于无 LUT 时的 fallback 或测试。
 */
export function makeIdentityLUT(size: number): LUT3DData {
  const data = new Float32Array(size * size * size * 3);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = ((z * size + y) * size + x) * 3;
        data[idx] = x / (size - 1);
        data[idx + 1] = y / (size - 1);
        data[idx + 2] = z / (size - 1);
      }
    }
  }
  return { data, size };
}

/**
 * 生成纯色 LUT(所有 texel 同一颜色,用于测试)。
 */
export function makeSolidLUT(size: number, r: number, g: number, b: number): LUT3DData {
  const data = new Float32Array(size * size * size * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return { data, size };
}

// ── 内部工具 ──────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * LUTBlender — 有状态的多 LUT 混合管理器。
 *
 * 封装 blendLUTs() 为可复用对象,支持增量更新(只在一项变化时重新混合)。
 * 与 LUTPass 配合使用:
 *
 * @example
 * ```ts
 * const blender = new LUTBlender();
 * blender.setItems([
 *   { lut: dayLUT,   intensity: 1.0, overrideStrength: 1.0 },
 *   { lut: duskLUT,  intensity: dayToDuskFactor, overrideStrength: 0.5 },
 * ]);
 *
 * // 每帧(仅在变化时重新混合):
 * if (blender.isDirty()) {
 *   const blended = blender.blend();
 *   lutPass.lut = uploadToTexture(blended);
 * }
 * ```
 */
export class LUTBlender {
  private _items: LUTBlendItem[] = [];
  private _outputSize: number = 16;
  private _dirty: boolean = true;
  private _cachedWeights: number[] = [];

  /** 设置待混合的 LUT 列表(按优先级从低到高)。 */
  setItems(items: readonly LUTBlendItem[]): void {
    this._items = items.slice(0, MAX_BLEND_LUTS);
    this._dirty = true;
  }

  /** 获取当前 LUT 列表(只读)。 */
  getItems(): readonly LUTBlendItem[] {
    return this._items;
  }

  /** 设置输出 LUT 格点数。 */
  setOutputSize(size: number): void {
    if (size !== this._outputSize) {
      this._outputSize = size;
      this._dirty = true;
    }
  }

  /** 更新某个 LUT 的 intensity(无需重建整个列表)。 */
  setIntensity(index: number, intensity: number): void {
    if (index >= 0 && index < this._items.length) {
      this._items[index].intensity = intensity;
      this._dirty = true;
    }
  }

  /** 更新某个 LUT 的 overrideStrength。 */
  setOverrideStrength(index: number, overrideStrength: number): void {
    if (index >= 0 && index < this._items.length) {
      this._items[index].overrideStrength = overrideStrength;
      this._dirty = true;
    }
  }

  /** 标记需要重新混合。 */
  markDirty(): void {
    this._dirty = true;
  }

  /** 是否需要重新混合(有变化未应用)。 */
  isDirty(): boolean {
    return this._dirty;
  }

  /** 获取当前权重(未混合时也可查看)。 */
  getWeights(): number[] {
    if (this._dirty || this._cachedWeights.length === 0) {
      this._cachedWeights = computeBlendWeights(
        this._items.map(it => it.intensity),
        this._items.map(it => it.overrideStrength),
      );
    }
    return this._cachedWeights;
  }

  /**
   * 执行混合,生成 blended LUT。
   * 调用后 isDirty() 返回 false,直到下次变化。
   */
  blend(): LUT3DData {
    const result = blendLUTs(this._items, { outputSize: this._outputSize });
    this._cachedWeights = computeBlendWeights(
      this._items.map(it => it.intensity),
      this._items.map(it => it.overrideStrength),
    );
    this._dirty = false;
    return result;
  }
}

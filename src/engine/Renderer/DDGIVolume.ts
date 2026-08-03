// DDGIVolume — 动态漫反射全局光照 (Dynamic Diffuse Global Illumination)。
//
// 设计目标:
//   - 在场景 AABB 内布置 3D 探针网格,每个探针存储 SH2 辐照度(27 floats RGB)。
//   - 运行时:对任意世界位置 + 法线,三线性插值 8 个邻近探针的 SH2,
//     evaluateSH 得到该点的漫反射间接光。
//   - 动态更新:每帧(或每 N 帧)从探针位置发射射线,采样场景颜色,
//     累积到 SH2 系数(指数移动平均,实现实时重新照明)。
//   - 探针遮挡:背面投影深度测试,跳过几何体内部的探针(避免漏光)。
//
// 与 GlobalIllumination(LightProbes)的区别:
//   - GI.LightProbes:任意位置放置,静态烘焙(bake 一次),SH2 系数不变。
//   - DDGIVolume:规则 3D 网格,动态更新(每帧/N 帧),支持实时重新照明。
//   - DDGI 适合动态场景(移动物体、改变光照);LightProbes 适合静态场景。
//
// 算法(Zinke et al. 2020 "Dynamic Diffuse GI with Ray-Traced Irradiance Fields"):
//   1. 探针网格:origin + (probeCountX, probeCountY, probeCountZ) + cellSize
//      探针 i 的世界位置 = origin + (ix, iy, iz) * cellSize
//   2. 更新(每帧或每 N 帧):
//      a. 从每个探针发射 R 条射线(均匀半球或余弦加权)
//      b. 每条射线:ray-march / 屏幕空间追踪 → 命中点颜色 + 距离
//      c. 累积到 SH2:computeSH(rayDir, hitColor) → 指数移动平均混合
//      d. 存储最近命中距离 → 背面投影遮挡测试
//   3. 采样(运行时,每像素):
//      a. worldPos → 找到所在 cell(8 个角探针)
//      b. 计算 trilinear weights(8 个权重,和为 1)
//      c. 遮挡测试:背面投影(参考探针 depth 与目标点 depth)
//      d. 加权混合 8 个探针的 SH2 系数 → evaluateSH(normal) → RGB 辐照度
//
// 不变量:
//   - probeCountX/Y/Z >= 1(至少 1 个探针);
//   - SH2 系数数组长度 = probeCount * 27;
//   - 采样位置在 volume AABB 外时返回边缘探针的辐照度(clamp);
//   - 所有探针未更新时(uninitialized),sampleIrradiance 返回 {0,0,0}。
//
// 参考:
//   - Zinke et al. 2020 "Dynamic Diffuse Global Illumination with Ray-Traced Irradiance Fields"
//   - UE5 Lumen IrradianceField / DDGIVolume
//   - o3de Atom ImageBasedLight + DiffuseGlobalIllumination
//   - three.js IrradianceVolume(本实现在其基础上增加动态更新框架)

import { Vector3 } from '../Math/Vector3';
import { evaluateSH, SH2_RGB_FLOATS } from './GlobalIllumination';
import { createLogger } from '@/lib/logger';

const log = createLogger('DDGIVolume');

// ── CPU 可测纯函数(无需 GL) ──────────────────────────────────────

/** 3D 整数索引。 */
export interface IVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 3D → 1D 探针索引(行优先:z 外层、y 中层、x 内层)。
 *
 * @param idx    3D 索引 (ix, iy, iz)
 * @param dims   网格尺寸 (countX, countY, countZ)
 * @returns       1D 索引 = ix + iy*countX + iz*countX*countY
 */
export function packProbeIndex(idx: IVec3, dims: IVec3): number {
  return idx.x + idx.y * dims.x + idx.z * dims.x * dims.y;
}

/**
 * 1D → 3D 探针索引(行优先解包)。
 *
 * @param linear 1D 索引
 * @param dims   网格尺寸
 * @returns       3D 索引
 */
export function unpackProbeIndex(linear: number, dims: IVec3): IVec3 {
  const xy = dims.x * dims.y;
  const z = Math.floor(linear / xy);
  const y = Math.floor((linear - z * xy) / dims.x);
  const x = linear - z * xy - y * dims.x;
  return { x, y, z };
}

/**
 * 计算三线性插值权重(8 个角点的权重,和为 1)。
 *
 * 输入 localPos 是在 cell 内的归一化位置 [0,1]³。
 * 权重排列顺序与 8 个角点一致:
 *   [0]=(0,0,0) [1]=(1,0,0) [2]=(0,1,0) [3]=(1,1,0)
 *   [4]=(0,0,1) [5]=(1,0,1) [6]=(0,1,1) [7]=(1,1,1)
 *
 * 数学:
 *   wx = localPos.x,  wy = localPos.y,  wz = localPos.z
 *   w[0] = (1-wx)(1-wy)(1-wz)   w[1] = wx(1-wy)(1-wz)
 *   w[2] = (1-wx)wy(1-wz)       w[3] = wx*wy*(1-wz)
 *   w[4] = (1-wx)(1-wy)wz       w[5] = wx(1-wy)wz
 *   w[6] = (1-wx)wy*wz          w[7] = wx*wy*wz
 *
 * @param localPos cell 内归一化位置 [0,1]³(各分量自动 clamp)
 * @returns         8 个权重(和为 1)
 */
export function computeTrilinearWeights(localPos: IVec3): number[] {
  const wx = Math.min(1, Math.max(0, localPos.x));
  const wy = Math.min(1, Math.max(0, localPos.y));
  const wz = Math.min(1, Math.max(0, localPos.z));
  const ix = 1 - wx, iy = 1 - wy, iz = 1 - wz;
  return [
    ix * iy * iz,  // (0,0,0)
    wx * iy * iz,  // (1,0,0)
    ix * wy * iz,  // (0,1,0)
    wx * wy * iz,  // (1,1,0)
    ix * iy * wz,  // (0,0,1)
    wx * iy * wz,  // (1,0,1)
    ix * wy * wz,  // (0,1,1)
    wx * wy * wz,  // (1,1,1)
  ];
}

/** 8 个角点的 3D 偏移(与 computeTrilinearWeights 的权重顺序一致)。 */
const CORNER_OFFSETS: IVec3[] = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 },
  { x: 0, y: 1, z: 1 }, { x: 1, y: 1, z: 1 },
];

/**
 * 从 8 个角探针的 SH2 系数按三线性权重混合,得到插值后的 SH2 系数。
 *
 * @param probeSH    8 个探针的 SH2 系数(每个 27 floats),顺序与 CORNER_OFFSETS 一致
 * @param weights    8 个三线性权重(和为 1)
 * @returns           插值后的 SH2 系数(27 floats)
 */
export function blendProbeSH(
  probeSH: Float32Array[],
  weights: number[],
): Float32Array {
  const out = new Float32Array(SH2_RGB_FLOATS);
  for (let c = 0; c < 8; c++) {
    const w = weights[c];
    if (w === 0) continue;
    const sh = probeSH[c];
    for (let i = 0; i < SH2_RGB_FLOATS; i++) {
      out[i] += w * sh[i];
    }
  }
  return out;
}

/**
 * 探针遮挡权重(背面投影深度测试)。
 *
 * DDGI 的核心创新:当一个探针在几何体内部时,直接用它的辐照度会导致漏光。
 * 通过存储每个探针最近命中距离(probeDepth),可以检测探针是否被几何遮挡:
 *   - 如果目标点到探针的距离 > probeDepth * threshold,说明探针被几何遮挡,
 *     降低该探针的权重(趋向 0)。
 *   - 否则权重保持 1。
 *
 * @param probeDistance  目标点到探针的距离
 * @param probeDepth     探针存储的最近命中距离(射线追踪平均距离)
 * @param bias           深度偏移(避免自遮挡,默认 0.2)
 * @returns               遮挡权重 [0, 1]
 */
export function probeOcclusionWeight(
  probeDistance: number,
  probeDepth: number,
  bias: number = 0.2,
): number {
  if (probeDepth <= 0) return 1.0; // 无深度数据 → 不遮挡
  // 目标点比探针能看到的更远 → 被遮挡
  const diff = probeDistance - probeDepth - bias;
  if (diff <= 0) return 1.0; // 在探针可视范围内
  // 平滑衰减(diff 越大权重越低)
  return Math.max(0, 1.0 - diff / Math.max(probeDepth, 0.001));
}

// ── DDGIVolume 类 ─────────────────────────────────────────────────

export interface DDGIVolumeOptions {
  /** volume AABB 起点(最小角,世界空间)。 */
  origin?: Vector3;
  /** 每轴探针数(默认 4×4×4 = 64 探针)。 */
  probeCount?: IVec3;
  /** 每个 cell 的尺寸(世界单位,默认 4×4×4)。 */
  cellSize?: Vector3;
  /** 每探针射线数(默认 32;更多=更高质量但更慢)。 */
  raysPerProbe?: number;
  /** 时序累积权重(0=不累积,0.95=强累积。默认 0.9)。 */
  historyWeight?: number;
  /** 遮挡深度偏移(默认 0.2)。 */
  occlusionBias?: number;
}

/**
 * 动态漫反射全局光照体积。
 *
 * 3D 探针网格,每探针存储 SH2 辐照度(27 floats RGB)+ 最近命中距离。
 * 运行时三线性插值 8 个邻近探针 → evaluateSH → 漫反射间接光。
 *
 * 典型用法:
 *   const ddgi = new DDGIVolume({
 *     origin: new Vector3(-20, 0, -20),
 *     probeCount: { x: 8, y: 4, z: 8 },
 *     cellSize: new Vector3(5, 3, 5),
 *   });
 *   // 每帧更新(简化:外部喂入射线结果)
 *   ddgi.updateProbe(probeIdx, rayResults);
 *   // 每像素采样
 *   const irradiance = ddgi.sampleIrradiance(worldPos, normal);
 */
export class DDGIVolume {
  /** volume AABB 起点。 */
  origin: Vector3;
  /** 每轴探针数。 */
  probeCount: IVec3;
  /** cell 尺寸。 */
  cellSize: Vector3;
  /** 每探针射线数。 */
  raysPerProbe: number;
  /** 时序累积权重。 */
  historyWeight: number;
  /** 遮挡深度偏移。 */
  occlusionBias: number;

  /** 所有探针的 SH2 系数(长度 = probeCount * 27,行优先)。 */
  readonly probes: Float32Array;
  /** 每探针最近命中距离(平均射线距离,用于遮挡测试)。 */
  readonly probeDepths: Float32Array;
  /** 探针是否已更新过(首帧前为 false)。 */
  readonly probeValidity: Uint8Array;
  /** 总探针数。 */
  readonly totalProbes: number;

  /** 是否有任何探针已更新(用于早退采样)。 */
  private _anyValid: boolean = false;

  constructor(opts: DDGIVolumeOptions = {}) {
    this.origin = opts.origin ?? new Vector3(0, 0, 0);
    this.probeCount = opts.probeCount ?? { x: 4, y: 4, z: 4 };
    this.cellSize = opts.cellSize ?? new Vector3(4, 4, 4);
    this.raysPerProbe = opts.raysPerProbe ?? 32;
    this.historyWeight = opts.historyWeight ?? 0.9;
    this.occlusionBias = opts.occlusionBias ?? 0.2;

    this.totalProbes = this.probeCount.x * this.probeCount.y * this.probeCount.z;
    this.probes = new Float32Array(this.totalProbes * SH2_RGB_FLOATS);
    this.probeDepths = new Float32Array(this.totalProbes);
    this.probeValidity = new Uint8Array(this.totalProbes);

    log.info(`DDGIVolume: ${this.probeCount.x}x${this.probeCount.y}x${this.probeCount.z} = ${this.totalProbes} probes`);
  }

  /** volume AABB 最大角。 */
  get maxCorner(): Vector3 {
    return new Vector3(
      this.origin.x + (this.probeCount.x - 1) * this.cellSize.x,
      this.origin.y + (this.probeCount.y - 1) * this.cellSize.y,
      this.origin.z + (this.probeCount.z - 1) * this.cellSize.z,
    );
  }

  /** 探针 i 的世界位置。 */
  getProbePosition(linearIdx: number): Vector3 {
    const idx = unpackProbeIndex(linearIdx, this.probeCount);
    return new Vector3(
      this.origin.x + idx.x * this.cellSize.x,
      this.origin.y + idx.y * this.cellSize.y,
      this.origin.z + idx.z * this.cellSize.z,
    );
  }

  /**
   * 用一批射线结果更新单个探针的 SH2 辐照度(指数移动平均)。
   *
   * @param probeIdx    探针 1D 索引
   * @param rayResults  射线结果数组:{ dir, color, distance }
   */
  updateProbe(
    probeIdx: number,
    rayResults: Array<{ dir: Vector3; color: { r: number; g: number; b: number }; distance: number }>,
  ): void {
    if (probeIdx < 0 || probeIdx >= this.totalProbes) return;
    const offset = probeIdx * SH2_RGB_FLOATS;
    const isNew = this.probeValidity[probeIdx] === 0;

    // 累积射线到 SH2
    const newSH = new Float32Array(SH2_RGB_FLOATS);
    let avgDist = 0;
    let validRays = 0;
    for (const ray of rayResults) {
      // computeSH 生成单条射线的 SH2 贡献
      const sh = computeSHLocal(ray.dir, ray.color);
      for (let i = 0; i < SH2_RGB_FLOATS; i++) {
        newSH[i] += sh[i];
      }
      avgDist += ray.distance;
      validRays++;
    }
    if (validRays > 0) {
      avgDist /= validRays;
      // 归一化 SH2(除以射线数 × π)
      const norm = 1.0 / (validRays * Math.PI);
      for (let i = 0; i < SH2_RGB_FLOATS; i++) {
        newSH[i] *= norm;
      }
    }

    if (isNew) {
      // 首帧:直接写入
      this.probes.set(newSH, offset);
      this.probeDepths[probeIdx] = avgDist;
      this.probeValidity[probeIdx] = 1;
      this._anyValid = true;
    } else {
      // 时序累积:指数移动平均
      const hw = this.historyWeight;
      for (let i = 0; i < SH2_RGB_FLOATS; i++) {
        this.probes[offset + i] = hw * this.probes[offset + i] + (1 - hw) * newSH[i];
      }
      this.probeDepths[probeIdx] = hw * this.probeDepths[probeIdx] + (1 - hw) * avgDist;
    }
  }

  /**
   * 采样某点的漫反射辐照度(三线性插值 8 个邻近探针 + SH2 评估)。
   *
   * @param worldPos  世界位置
   * @param normal    表面法线(归一化)
   * @returns          RGB 辐照度(线性,0..n)
   */
  sampleIrradiance(worldPos: Vector3, normal: Vector3): { r: number; g: number; b: number } {
    if (!this._anyValid) return { r: 0, g: 0, b: 0 };

    // 找到 worldPos 所在的 cell
    const localX = (worldPos.x - this.origin.x) / this.cellSize.x;
    const localY = (worldPos.y - this.origin.y) / this.cellSize.y;
    const localZ = (worldPos.z - this.origin.z) / this.cellSize.z;

    // clamp 到 [0, probeCount-1]
    const cx = Math.min(this.probeCount.x - 2, Math.max(0, Math.floor(localX)));
    const cy = Math.min(this.probeCount.y - 2, Math.max(0, Math.floor(localY)));
    const cz = Math.min(this.probeCount.z - 2, Math.max(0, Math.floor(localZ)));

    // cell 内归一化位置 [0,1]³
    const localPos: IVec3 = {
      x: localX - cx,
      y: localY - cy,
      z: localZ - cz,
    };

    const weights = computeTrilinearWeights(localPos);

    // 收集 8 个角探针的 SH2 + 遮挡权重
    const probeSH: Float32Array[] = [];
    const adjustedWeights: number[] = [];

    for (let c = 0; c < 8; c++) {
      const off = CORNER_OFFSETS[c];
      const ix = cx + off.x;
      const iy = cy + off.y;
      const iz = cz + off.z;
      // 边界 clamp
      const cx2 = Math.min(this.probeCount.x - 1, Math.max(0, ix));
      const cy2 = Math.min(this.probeCount.y - 1, Math.max(0, iy));
      const cz2 = Math.min(this.probeCount.z - 1, Math.max(0, iz));
      const linear = packProbeIndex({ x: cx2, y: cy2, z: cz2 }, this.probeCount);

      if (this.probeValidity[linear] === 0) {
        probeSH.push(new Float32Array(SH2_RGB_FLOATS));
        adjustedWeights.push(0);
        continue;
      }

      const sh = this.probes.subarray(linear * SH2_RGB_FLOATS, (linear + 1) * SH2_RGB_FLOATS);
      probeSH.push(sh);

      // 遮挡权重
      const px = this.origin.x + cx2 * this.cellSize.x;
      const py = this.origin.y + cy2 * this.cellSize.y;
      const pz = this.origin.z + cz2 * this.cellSize.z;
      const dist = Math.hypot(worldPos.x - px, worldPos.y - py, worldPos.z - pz);
      const occW = probeOcclusionWeight(dist, this.probeDepths[linear], this.occlusionBias);
      adjustedWeights.push(weights[c] * occW);
    }

    // 归一化调整后的权重(遮挡可能导致权重和 < 1)
    let wsum = 0;
    for (const w of adjustedWeights) wsum += w;
    if (wsum < 1e-6) return { r: 0, g: 0, b: 0 };
    for (let c = 0; c < 8; c++) adjustedWeights[c] /= wsum;

    // 混合 SH2 + 评估
    const blendedSH = blendProbeSH(probeSH, adjustedWeights);
    return evaluateSH(blendedSH, normal);
  }

  /** 重置所有探针(清零)。 */
  reset(): void {
    this.probes.fill(0);
    this.probeDepths.fill(0);
    this.probeValidity.fill(0);
    this._anyValid = false;
    log.debug('all probes reset');
  }

  /** 已更新的探针数。 */
  get validProbeCount(): number {
    let n = 0;
    for (let i = 0; i < this.totalProbes; i++) {
      if (this.probeValidity[i]) n++;
    }
    return n;
  }
}

// ── 内部:SH2 计算(避免循环导入,复制 GlobalIllumination.computeSH 逻辑) ──

function computeSHLocal(
  dir: Vector3,
  color: { r: number; g: number; b: number },
): Float32Array {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  const inv = len > 0 ? 1 / len : 0;
  const x = dir.x * inv;
  const y = dir.y * inv;
  const z = dir.z * inv;

  const Y00 = 0.282095;
  const Y1m1 = 0.488603 * y;
  const Y10 = 0.488603 * z;
  const Y11 = 0.488603 * x;
  const Y2m2 = 1.092548 * x * y;
  const Y2m1 = 1.092548 * y * z;
  const Y20 = 0.315392 * (3 * z * z - 1);
  const Y21 = 1.092548 * x * z;
  const Y22 = 0.546274 * (x * x - y * y);

  const out = new Float32Array(SH2_RGB_FLOATS);
  out[0] = color.r * Y00; out[1] = color.g * Y00; out[2] = color.b * Y00;
  out[3] = color.r * Y1m1; out[4] = color.g * Y1m1; out[5] = color.b * Y1m1;
  out[6] = color.r * Y10; out[7] = color.g * Y10; out[8] = color.b * Y10;
  out[9] = color.r * Y11; out[10] = color.g * Y11; out[11] = color.b * Y11;
  out[12] = color.r * Y2m2; out[13] = color.g * Y2m2; out[14] = color.b * Y2m2;
  out[15] = color.r * Y2m1; out[16] = color.g * Y2m1; out[17] = color.b * Y2m1;
  out[18] = color.r * Y20; out[19] = color.g * Y20; out[20] = color.b * Y20;
  out[21] = color.r * Y21; out[22] = color.g * Y21; out[23] = color.b * Y21;
  out[24] = color.r * Y22; out[25] = color.g * Y22; out[26] = color.b * Y22;
  return out;
}

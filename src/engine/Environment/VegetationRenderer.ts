// VegetationRenderer — 大规模植被渲染系统(实例化 + LOD + 风摆动 + 季节变化)。
//
// 设计:
//   * 与 VegetationSystem 互补:VegetationSystem 直接构建 InstancedMesh,
//     本类只产出渲染所需的「数据描述」(patch 列表 + LOD + 风参数 + 季节),
//     由调用方按需映射到具体渲染后端(自研引擎 InstancedMesh / Three.js / 自定义 shader)。
//   * LOD:4 级(0 最高 ~ 3 最低),超过 lodDistances[3] 则剔除(visible=false)。
//   * 风摆动:每帧推进内部 _time,patch.swayPhase 与 windDirection/windStrength
//     共同决定该实例的渲染偏移(由调用方按公式 offset = sin(time*freq + swayPhase)
//     * windStrength * windDirection 计算,本类仅提供参数与时间)。
//   * 季节:影响密度乘子(秋冬降低)与颜色色调(调用方读取 season 应用)。
//   * densityMap:可选,作为额外密度系数叠加到 baseDensity。
//
// 与 VegetationSystem 的关系:
//   * VegetationSystem 是「自包含渲染管线」(直接产 InstancedMesh);
//   * 本类是「数据层」(产 VegetationPatch[] 描述),解耦渲染后端,便于跨引擎移植。
//   * 二者可共存:VegetationSystem 用于直接渲染,本类用于自定义 shader 管线。

import { Vector3 } from '../Math/Vector3';
import type { TerrainGeometry } from '../Terrain/TerrainGeometry';

/** 植被类型种类。 */
export type VegetationTypeKind = 'grass' | 'tree' | 'bush' | 'flower';

/** 季节枚举。 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** 单个植被实例的渲染描述。 */
export interface VegetationPatch {
  /** 植被类型。 */
  type: VegetationTypeKind;
  /** 实例世界位置(已贴地形高度)。 */
  position: Vector3;
  /** 缩放(均匀)。 */
  scale: number;
  /** 绕 Y 轴旋转(弧度)。 */
  rotation: number;
  /** 当前 LOD 级别(0=最高,3=最低,-1=剔除)。由 update 写入。 */
  lod: number;
  /** 风摆动相位偏移(随机 [0,2π]),与 wind + time 决定摆动偏移。 */
  swayPhase: number;
  /** 是否可见(由 update 写入,false=超出最远 LOD)。 */
  visible: boolean;
}

/** VegetationRenderer 构造参数。 */
export interface VegetationRendererOptions {
  /** 最大实例数(超出时 addPatch 拒绝)。默认 100000。 */
  maxInstances?: number;
  /** 风方向(默认 +X)。会被归一化。 */
  windDirection?: Vector3;
  /** 风强度(0=无风,1=强风)。默认 0.3。 */
  windStrength?: number;
  /** 初始季节。默认 'summer'。 */
  season?: Season;
  /** 4 级 LOD 距离阈值(近→远)。默认 [20, 60, 120, 240]。 */
  lodDistances?: number[];
  /** 密度图分辨率(densityMap 长度 = resolution²)。默认 0(无密度图)。 */
  densityMapResolution?: number;
  /** 随机种子(决定性植被分布)。默认 1。 */
  seed?: number;
}

/** LOD 统计信息。 */
export interface VegetationLODInfo {
  /** LOD 0 实例数(最高细节)。 */
  lod0: number;
  /** LOD 1 实例数。 */
  lod1: number;
  /** LOD 2 实例数。 */
  lod2: number;
  /** LOD 3 实例数(最低细节)。 */
  lod3: number;
  /** 被剔除的实例数(超出最远 LOD)。 */
  hidden: number;
  /** 总实例数。 */
  total: number;
}

/** VegetationRenderer.getStats() 返回的统计信息。 */
export interface VegetationRendererStats {
  /** 总实例数。 */
  patchCount: number;
  /** 最大实例数。 */
  maxInstances: number;
  /** 可见实例数(最近一次 update 后)。 */
  visibleCount: number;
  /** 风强度。 */
  windStrength: number;
  /** 当前季节。 */
  season: Season;
  /** 内部时间(秒,用于风摆动)。 */
  time: number;
  /** 密度图分辨率(0=无密度图)。 */
  densityMapResolution: number;
}

/** 默认 4 级 LOD 距离阈值(米)。 */
const DEFAULT_LOD_DISTANCES = [20, 60, 120, 240];

/** 季节密度乘子(autumn/winter 降低活跃实例数)。 */
const SEASON_DENSITY_FACTOR: Record<Season, number> = {
  spring: 1.0,
  summer: 1.0,
  autumn: 0.7,
  winter: 0.3,
};

/** mulberry32 — 确定性 PRNG,返回 [0,1)。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 各类型的默认缩放区间。 */
const TYPE_SCALE_RANGE: Record<VegetationTypeKind, [number, number]> = {
  grass: [0.5, 1.2],
  tree: [2.0, 5.0],
  bush: [0.8, 1.8],
  flower: [0.3, 0.7],
};

/** 各类型的默认坡度阈值(弧度)。 */
const TYPE_SLOPE_THRESHOLD: Record<VegetationTypeKind, number> = {
  grass: Math.PI / 3,        // 60°,草能在较陡处生长
  tree: Math.PI / 6,         // 30°,树需缓坡
  bush: Math.PI / 4,         // 45°
  flower: Math.PI / 5,       // 36°
};

/**
 * 植被渲染系统 — 在地形上生成并管理大规模植被(数据描述层)。
 *
 * 用法:
 *   const vr = new VegetationRenderer();
 *   vr.generateVegetation(terrain, 0.5, ['grass', 'tree']);
 *   vr.setWind(new Vector3(1, 0, 0), 0.5);
 *   vr.setSeason('autumn');
 *   // 每帧:
 *   vr.update(dt, cameraPosition);
 *   const visible = vr.getVisiblePatches(cameraPosition);
 *   // 调用方按 patch.type / patch.lod / patch.swayPhase 渲染
 */
export class VegetationRenderer {
  /** 所有植被实例。 */
  vegetationPatches: VegetationPatch[] = [];
  /** 最大实例数。 */
  maxInstances: number;
  /** 风方向(归一化)。 */
  windDirection: Vector3;
  /** 风强度 [0,∞)。 */
  windStrength: number;
  /** 当前季节。 */
  season: Season;
  /** 4 级 LOD 距离阈值(近→远)。 */
  lodDistances: number[];
  /** 密度图(可选,每格 0..1 密度系数,长度 = densityMapResolution²)。 */
  densityMap: Float32Array | null = null;
  /** 密度图分辨率(0=无密度图)。 */
  densityMapResolution: number = 0;

  /** 内部累积时间(秒,用于风摆动)。 */
  private _time: number = 0;
  /** 随机种子。 */
  private _seed: number = 1;
  /** 风摆动频率(弧度/秒)。 */
  private _swayFrequency: number = 2.0;
  /** 最近一次 update 的可见数缓存。 */
  private _visibleCount: number = 0;
  /** 最近一次 update 的 LOD 计数缓存。 */
  private _lodCounts: number[] = [0, 0, 0, 0, 0];

  constructor(opts: VegetationRendererOptions = {}) {
    this.maxInstances = opts.maxInstances ?? 100000;
    this.windDirection = (opts.windDirection ?? new Vector3(1, 0, 0)).clone();
    if (this.windDirection.lengthSq() > 1e-12) {
      this.windDirection.normalize();
    } else {
      this.windDirection.set(1, 0, 0);
    }
    this.windStrength = opts.windStrength ?? 0.3;
    this.season = opts.season ?? 'summer';
    this.lodDistances = (opts.lodDistances ?? DEFAULT_LOD_DISTANCES).slice();
    this.densityMapResolution = opts.densityMapResolution ?? 0;
    this._seed = (opts.seed ?? 1) >>> 0;
  }

  /** 添加一个植被实例。返回新索引,达到 maxInstances 时返回 -1。 */
  addPatch(patch: VegetationPatch): number {
    if (this.vegetationPatches.length >= this.maxInstances) return -1;
    this.vegetationPatches.push({
      type: patch.type,
      position: patch.position.clone(),
      scale: patch.scale,
      rotation: patch.rotation,
      lod: patch.lod,
      swayPhase: patch.swayPhase,
      visible: patch.visible,
    });
    return this.vegetationPatches.length - 1;
  }

  /** 移除指定索引的实例(swap-with-tail O(1),不保证顺序)。 */
  removePatch(index: number): this {
    if (index < 0 || index >= this.vegetationPatches.length) {
      throw new Error(`VegetationRenderer.removePatch: index out of range (${index})`);
    }
    const last = this.vegetationPatches.length - 1;
    if (index !== last) {
      this.vegetationPatches[index] = this.vegetationPatches[last];
    }
    this.vegetationPatches.pop();
    return this;
  }

  /**
   * 在地形上生成植被。
   *
   * @param terrain 目标地形几何体。
   * @param density 每平方米期望实例数。
   * @param types   植被类型表(至少 1 个)。
   */
  generateVegetation(
    terrain: TerrainGeometry,
    density: number,
    types: VegetationTypeKind[],
  ): this {
    if (types.length === 0) {
      throw new Error('VegetationRenderer.generateVegetation: types 不能为空');
    }
    this.vegetationPatches = [];
    const rng = mulberry32(this._seed);
    const terrainHalfW = terrain.width * 0.5;
    const terrainHalfH = terrain.height * 0.5;
    const area = terrain.width * terrain.height;
    // 季节密度乘子
    const seasonFactor = SEASON_DENSITY_FACTOR[this.season];
    const expected = Math.floor(area * density * seasonFactor);

    const _up = new Vector3(0, 1, 0);
    const _normal = new Vector3();
    const eps = Math.max(terrain.width / terrain.widthSegments, 0.001);

    let placed = 0;
    for (let i = 0; i < expected; i++) {
      // 在地形范围内均匀采样
      const x = -terrainHalfW + rng() * terrain.width;
      const z = -terrainHalfH + rng() * terrain.height;

      const y = terrain.getHeightAt(x, z);
      // 法线(中心差分)
      const yL = terrain.getHeightAt(x - eps, z);
      const yR = terrain.getHeightAt(x + eps, z);
      const yD = terrain.getHeightAt(x, z - eps);
      const yU = terrain.getHeightAt(x, z + eps);
      _normal.set(-(yR - yL) / (2 * eps), 1, -(yU - yD) / (2 * eps)).normalize();
      const cosSlope = Math.max(-1, Math.min(1, _normal.dot(_up)));
      const slope = Math.acos(cosSlope);

      // 密度图采样(可选)
      let densityFactor = 1;
      if (this.densityMap && this.densityMapResolution > 0) {
        const u = (x + terrainHalfW) / terrain.width;
        const v = (z + terrainHalfH) / terrain.height;
        const ix = Math.min(this.densityMapResolution - 1, Math.max(0, Math.floor(u * this.densityMapResolution)));
        const iy = Math.min(this.densityMapResolution - 1, Math.max(0, Math.floor(v * this.densityMapResolution)));
        densityFactor = this.densityMap[iy * this.densityMapResolution + ix];
        if (densityFactor <= 0) continue;
      }
      // 概率接受
      if (rng() > densityFactor) continue;

      // 随机选一个类型(满足坡度阈值的候选)
      const candidates = types.filter((t) => slope <= TYPE_SLOPE_THRESHOLD[t]);
      if (candidates.length === 0) continue;
      const chosenType = candidates[Math.floor(rng() * candidates.length)];

      // 缩放
      const [smin, smax] = TYPE_SCALE_RANGE[chosenType];
      const scale = smin + rng() * (smax - smin);
      // 绕 Y 旋转
      const rotY = rng() * Math.PI * 2;
      // 风摆动相位
      const swayPhase = rng() * Math.PI * 2;

      const patch: VegetationPatch = {
        type: chosenType,
        position: new Vector3(x, y, z),
        scale,
        rotation: rotY,
        lod: 0,
        swayPhase,
        visible: true,
      };
      this.vegetationPatches.push(patch);
      placed++;
      if (this.vegetationPatches.length >= this.maxInstances) break;
    }
    return this;
  }

  /**
   * 每帧更新:推进风时间 + LOD 选择 + 剔除。
   *
   * @param dt             帧时间(秒)。
   * @param cameraPosition 相机世界位置(用于 LOD 距离判定)。
   */
  update(dt: number, cameraPosition: Vector3): void {
    this._time += dt;
    // 重置 LOD 计数
    this._lodCounts = [0, 0, 0, 0, 0];
    let visibleCount = 0;
    const maxLod = this.lodDistances.length;
    for (const patch of this.vegetationPatches) {
      // 水平距离(忽略 Y,因为植被在地表)
      const dx = patch.position.x - cameraPosition.x;
      const dz = patch.position.z - cameraPosition.z;
      const dist = Math.hypot(dx, dz);
      // 选择 LOD:落在 [lodDistances[i-1], lodDistances[i]) 区间则为 LOD i
      let lod = -1;
      for (let i = 0; i < maxLod; i++) {
        if (dist < this.lodDistances[i]) {
          lod = i;
          break;
        }
      }
      patch.lod = lod;
      patch.visible = lod >= 0;
      if (patch.visible) {
        visibleCount++;
        this._lodCounts[lod]++;
      } else {
        this._lodCounts[maxLod]++; // hidden 桶
      }
    }
    this._visibleCount = visibleCount;
  }

  /**
   * 计算指定 patch 当前的风摆动偏移向量(供调用方应用渲染偏移)。
   * offset = windDirection * windStrength * sin(time * freq + swayPhase)
   */
  getSwayOffset(patch: VegetationPatch, target: Vector3 = new Vector3()): Vector3 {
    const s = Math.sin(this._time * this._swayFrequency + patch.swayPhase) * this.windStrength;
    target.set(
      this.windDirection.x * s,
      this.windDirection.y * s,
      this.windDirection.z * s,
    );
    return target;
  }

  /** 设置风参数(方向会被归一化)。 */
  setWind(direction: Vector3, strength: number): this {
    if (direction.lengthSq() > 1e-12) {
      this.windDirection.copy(direction).normalize();
    }
    this.windStrength = Math.max(0, strength);
    return this;
  }

  /** 设置季节(影响后续 generateVegetation 的密度乘子)。 */
  setSeason(season: Season): this {
    this.season = season;
    return this;
  }

  /** 设置 LOD 距离阈值(必须 4 级)。 */
  setLODDistances(distances: number[]): this {
    if (distances.length !== 4) {
      throw new Error(
        `VegetationRenderer.setLODDistances: 需要 4 级 LOD 距离 (got ${distances.length})`,
      );
    }
    this.lodDistances = distances.slice();
    return this;
  }

  /**
   * 设置密度图。
   * @param map        Float32Array 长度需 = resolution²;传 null 清除。
   * @param resolution 分辨率(map 为 null 时忽略)。
   */
  setDensityMap(map: Float32Array | null, resolution: number = 0): this {
    if (map !== null) {
      if (resolution <= 0) {
        throw new Error('VegetationRenderer.setDensityMap: resolution 必须 > 0');
      }
      if (map.length !== resolution * resolution) {
        throw new Error(
          `VegetationRenderer.setDensityMap: map 长度 ${map.length} 与 resolution²=${resolution * resolution} 不匹配`,
        );
      }
      this.densityMapResolution = resolution;
    } else {
      this.densityMapResolution = 0;
    }
    this.densityMap = map;
    return this;
  }

  /** 设置随机种子(仅在下次 generateVegetation 时生效)。 */
  setSeed(seed: number): this {
    this._seed = seed >>> 0;
    return this;
  }

  /** 设置风摆动频率(弧度/秒)。 */
  setSwayFrequency(freq: number): this {
    if (freq < 0) throw new Error(`VegetationRenderer.setSwayFrequency: freq 必须 >= 0 (got ${freq})`);
    this._swayFrequency = freq;
    return this;
  }

  /** 获取所有植被实例(引用,调用方不应破坏数组结构)。 */
  getPatches(): VegetationPatch[] {
    return this.vegetationPatches;
  }

  /** 获取当前实例数。 */
  getPatchCount(): number {
    return this.vegetationPatches.length;
  }

  /** 获取内部累积时间(秒,用于风摆动)。 */
  getTime(): number {
    return this._time;
  }

  /**
   * 获取可见植被实例(基于 lod >= 0)。
   * 若之前调用过 update(cameraPosition),会使用缓存;否则即时计算。
   */
  getVisiblePatches(cameraPosition: Vector3): VegetationPatch[] {
    const result: VegetationPatch[] = [];
    const maxLod = this.lodDistances.length;
    for (const patch of this.vegetationPatches) {
      const dx = patch.position.x - cameraPosition.x;
      const dz = patch.position.z - cameraPosition.z;
      const dist = Math.hypot(dx, dz);
      let lod = -1;
      for (let i = 0; i < maxLod; i++) {
        if (dist < this.lodDistances[i]) {
          lod = i;
          break;
        }
      }
      if (lod >= 0) result.push(patch);
    }
    return result;
  }

  /** 获取最近一次 update 后的 LOD 统计。 */
  getLODInfo(): VegetationLODInfo {
    return {
      lod0: this._lodCounts[0] ?? 0,
      lod1: this._lodCounts[1] ?? 0,
      lod2: this._lodCounts[2] ?? 0,
      lod3: this._lodCounts[3] ?? 0,
      hidden: this._lodCounts[4] ?? 0,
      total: this.vegetationPatches.length,
    };
  }

  /** 清除所有实例(并重置内部时间与 LOD 计数)。 */
  clear(): this {
    this.vegetationPatches = [];
    this._time = 0;
    this._visibleCount = 0;
    this._lodCounts = [0, 0, 0, 0, 0];
    return this;
  }

  /** 返回统计信息。 */
  getStats(): VegetationRendererStats {
    return {
      patchCount: this.vegetationPatches.length,
      maxInstances: this.maxInstances,
      visibleCount: this._visibleCount,
      windStrength: this.windStrength,
      season: this.season,
      time: this._time,
      densityMapResolution: this.densityMapResolution,
    };
  }
}

// VegetationSystem — 大规模植被渲染系统。
//
// 设计:
//   * 把地形划分为若干 VegetationPatch,每块持有自己的 InstancedMesh
//   * 在每块内按 density 撒点,用 TerrainGeometry.getHeightAt + 法线坡度
//     判断每种植被能否放置,按概率加权选择一种
//   * LOD 由相机距离决定:lodDistances[i] 内使用第 i 级 LOD(简单实现:
//     远距离直接 visible=false,中距离降低渲染计数)
//   * densityMap 可选,作为额外密度系数叠加到 baseDensity
//
// 与 Terrain 的关系:
//   * 仅依赖 TerrainGeometry.getHeightAt / 法线(由外部从地形法线采样)
//   * 不修改地形,只在表面撒点
//
// PRNG:
//   * 使用 mulberry32(确定性,种子可控),保证 setSeed 后结果可复现

import { Vector3 } from '../Math';
import { Matrix4 } from '../Math';
import { Quaternion } from '../Math';
import { InstancedMesh } from '../Core';
import type { TerrainGeometry } from '../Terrain/TerrainGeometry';
import { VegetationType } from './VegetationType';

/** 单个植被实例的运行时数据。 */
export interface VegetationInstance {
  /** 实例世界位置。 */
  position: Vector3;
  /** 缩放。 */
  scale: number;
  /** 绕 Y 轴旋转(弧度)。 */
  rotationY: number;
  /** 所属植被类型名。 */
  typeName: string;
}

/** 单个植被块。 */
export interface VegetationPatch {
  /** 块中心(世界空间)。 */
  position: Vector3;
  /** 块边长(世界单位,正方形)。 */
  size: number;
  /** 该块的 InstancedMesh(每种类型一个;主类型放 mesh 字段)。 */
  mesh: InstancedMesh | null;
  /** 该块所有实例数据。 */
  instances: VegetationInstance[];
  /** 当前 LOD 级别(0=最高,n-1=最低,-1=隐藏)。 */
  lodLevel: number;
  /** 是否可见。 */
  visible: boolean;
}

/** VegetationSystem.getStats() 返回的统计信息。 */
export interface VegetationStats {
  /** 块数。 */
  patchCount: number;
  /** 总实例数(所有块累加)。 */
  instanceCount: number;
  /** 可见实例数。 */
  visibleInstanceCount: number;
  /** 可见块数。 */
  visiblePatchCount: number;
}

/** 默认 LOD 距离(米)。 */
const DEFAULT_LOD_DISTANCES = [50, 120, 240];

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

/**
 * 植被系统 — 在地形上生成并管理大规模植被。
 */
export class VegetationSystem {
  /** 所有植被块。 */
  patches: VegetationPatch[] = [];
  /** 密度图(可选,每格 0..1 的密度系数)。 */
  densityMap: Float32Array | null = null;
  /** 密度图分辨率(densityMap 长度 = resolution*resolution)。 */
  densityMapResolution: number = 0;
  /** 随机种子。 */
  seed: number = 1;
  /** LOD 距离阈值(米)。索引 i 对应 LOD i 的最近距离。 */
  lodDistances: number[];
  /** 基础密度(每平方米期望实例数)。 */
  density: number = 0.5;
  /** 植被类型表。 */
  types: VegetationType[] = [];

  /**
   * @param seed 随机种子。
   * @param lodDistances LOD 距离阈值。
   */
  constructor(seed: number = 1, lodDistances: number[] = DEFAULT_LOD_DISTANCES) {
    this.seed = seed >>> 0;
    this.lodDistances = lodDistances.slice();
  }

  /**
   * 在地形上生成植被。
   *
   * @param terrain 目标地形几何体。
   * @param density 每平方米期望实例数。
   * @param types   植被类型表(至少 1 个)。
   */
  generate(
    terrain: TerrainGeometry,
    density: number,
    types: VegetationType[],
  ): this {
    if (types.length === 0) {
      throw new Error('VegetationSystem.generate: types 不能为空');
    }
    this.types = types.slice();
    this.density = Math.max(0, density);
    this.patches = [];

    // 整个地形作为一个初始 patch;调用方可后续 addPatch 切分更细。
    const cx = 0;
    const cz = 0;
    this.addPatch(new Vector3(cx, 0, cz), Math.max(terrain.width, terrain.height));

    // 为每个 patch 生成实例
    const rng = mulberry32(this.seed);
    for (const patch of this.patches) {
      this.populatePatch(patch, terrain, rng);
    }
    return this;
  }

  /**
   * 添加一个植被块(以 position 为中心,size 为边长)。
   * 不会自动填充实例 — 调用方需要后续 generate 或手动 populate。
   */
  addPatch(position: Vector3, size: number): this {
    const patch: VegetationPatch = {
      position: position.clone(),
      size: Math.max(0, size),
      mesh: null,
      instances: [],
      lodLevel: 0,
      visible: true,
    };
    this.patches.push(patch);
    return this;
  }

  /** 移除指定索引的块。 */
  removePatch(index: number): this {
    if (index < 0 || index >= this.patches.length) return this;
    this.patches.splice(index, 1);
    return this;
  }

  /**
   * 更新 LOD / 可见性。
   *
   * @param camera 相机世界位置。
   */
  update(camera: Vector3): this {
    let visiblePatchCount = 0;
    let visibleInstanceCount = 0;
    for (const patch of this.patches) {
      // 块中心到相机的水平距离
      const dx = patch.position.x - camera.x;
      const dz = patch.position.z - camera.z;
      const dist = Math.hypot(dx, dz);
      // 块半径近似为 size/2,加上 LOD 距离判断
      const effectiveDist = Math.max(0, dist - patch.size * 0.5);

      let lod = -1;
      for (let i = 0; i < this.lodDistances.length; i++) {
        if (effectiveDist < this.lodDistances[i]) {
          lod = i;
          break;
        }
      }
      // 超过最大 LOD 距离 → 隐藏
      patch.lodLevel = lod;
      patch.visible = lod >= 0;
      if (patch.mesh) patch.mesh.visible = patch.visible;

      if (patch.visible) {
        visiblePatchCount++;
        visibleInstanceCount += patch.instances.length;
      }
    }
    this._visiblePatchCount = visiblePatchCount;
    this._visibleInstanceCount = visibleInstanceCount;
    return this;
  }

  /** 获取所有实例数据(扁平拼接)。 */
  getInstances(): VegetationInstance[] {
    const out: VegetationInstance[] = [];
    for (const patch of this.patches) {
      for (const inst of patch.instances) out.push(inst);
    }
    return out;
  }

  /** 设置基础密度(不立即重建,需调用 generate 重新撒点)。 */
  setDensity(density: number): this {
    this.density = Math.max(0, density);
    return this;
  }

  /** 设置随机种子(不立即重建)。 */
  setSeed(seed: number): this {
    this.seed = seed >>> 0;
    return this;
  }

  /** 设置密度图(可选)。 */
  setDensityMap(map: Float32Array | null, resolution: number): this {
    if (map !== null && map.length !== resolution * resolution) {
      throw new Error(
        `VegetationSystem.setDensityMap: map 长度 ${map.length} 与 resolution²=${resolution * resolution} 不匹配`,
      );
    }
    this.densityMap = map;
    this.densityMapResolution = resolution;
    return this;
  }

  /** 返回统计信息。 */
  getStats(): VegetationStats {
    let instanceCount = 0;
    let visibleInstanceCount = 0;
    let visiblePatchCount = 0;
    for (const patch of this.patches) {
      instanceCount += patch.instances.length;
      if (patch.visible) {
        visiblePatchCount++;
        visibleInstanceCount += patch.instances.length;
      }
    }
    // 若 update 已计算过可见数,优先用其值
    if (this._visiblePatchCount >= 0) {
      visiblePatchCount = this._visiblePatchCount;
      visibleInstanceCount = this._visibleInstanceCount;
    }
    return {
      patchCount: this.patches.length,
      instanceCount,
      visibleInstanceCount,
      visiblePatchCount,
    };
  }

  // ---- 内部状态 ----
  /** update() 缓存的可见块数;-1 表示尚未 update。 */
  private _visiblePatchCount: number = -1;
  /** update() 缓存的可见实例数。 */
  private _visibleInstanceCount: number = 0;

  /**
   * 在指定 patch 内撒点,生成实例并构建 InstancedMesh。
   * 假设 patch 已经加入到 this.patches。
   */
  private populatePatch(
    patch: VegetationPatch,
    terrain: TerrainGeometry,
    rng: () => number,
  ): void {
    const half = patch.size * 0.5;
    const area = patch.size * patch.size;
    // 期望实例数 = 面积 × 密度
    const expected = Math.floor(area * this.density);

    // 临时按类型收集实例
    const byType: Map<string, VegetationInstance[]> = new Map();
    for (const t of this.types) byType.set(t.name, []);

    const _up = new Vector3(0, 1, 0);
    const _normal = new Vector3();
    const _quat = new Quaternion();
    const _mat = new Matrix4();

    for (let i = 0; i < expected; i++) {
      // 在 patch 内均匀采样
      const x = patch.position.x - half + rng() * patch.size;
      const z = patch.position.z - half + rng() * patch.size;
      // 越界检查(地形范围)
      const terrainHalfW = terrain.width * 0.5;
      const terrainHalfH = terrain.height * 0.5;
      if (x < -terrainHalfW || x > terrainHalfW || z < -terrainHalfH || z > terrainHalfH) continue;

      const y = terrain.getHeightAt(x, z);
      // 法线 ≈ 上方向受高度梯度影响(简化:直接用中心差分)
      const eps = Math.max(terrain.width / terrain.widthSegments, 0.001);
      const yL = terrain.getHeightAt(x - eps, z);
      const yR = terrain.getHeightAt(x + eps, z);
      const yD = terrain.getHeightAt(x, z - eps);
      const yU = terrain.getHeightAt(x, z + eps);
      _normal.set(-(yR - yL) / (2 * eps), 1, -(yU - yD) / (2 * eps)).normalize();
      // 坡度 = 上方向与法线的夹角
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
      // 概率接受(降低密度时不重建网格)
      if (rng() > densityFactor) continue;

      // 按概率加权选择类型
      const candidates = this.types.filter((t) => t.canPlace(y, slope));
      if (candidates.length === 0) continue;
      const totalProb = candidates.reduce((s, t) => s + t.probability, 0);
      if (totalProb <= 0) continue;
      let r = rng() * totalProb;
      let chosen = candidates[0];
      for (const c of candidates) {
        r -= c.probability;
        if (r <= 0) {
          chosen = c;
          break;
        }
      }

      // 缩放
      const scale = chosen.minScale + rng() * (chosen.maxScale - chosen.minScale);
      // 绕 Y 旋转
      const rotY = rng() * Math.PI * 2;

      const inst: VegetationInstance = {
        position: new Vector3(x, y, z),
        scale,
        rotationY: rotY,
        typeName: chosen.name,
      };
      patch.instances.push(inst);
      byType.get(chosen.name)!.push(inst);
    }

    // 为主类型(实例数最多)构建 InstancedMesh
    let primaryName: string | null = null;
    let primaryCount = -1;
    for (const [name, list] of byType) {
      if (list.length > primaryCount) {
        primaryCount = list.length;
        primaryName = name;
      }
    }
    if (primaryName !== null && primaryCount > 0) {
      const type = this.types.find((t) => t.name === primaryName)!;
      const mesh = new InstancedMesh(type.geometry, type.material, primaryCount);
      const list = byType.get(primaryName)!;
      for (let i = 0; i < list.length; i++) {
        const inst = list[i];
        _quat.setFromAxisAngle(_up, inst.rotationY);
        _mat.compose(inst.position, _quat, new Vector3(inst.scale, inst.scale, inst.scale));
        mesh.setMatrixAt(i, _mat);
      }
      mesh.instanceMatrixVersion++;
      mesh.visible = patch.visible;
      patch.mesh = mesh;
    }
  }
}

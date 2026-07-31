// SpawnerArea — 植被生成区域:在 bounds 内按 density 撒点,经过滤器链筛选,经修改器链变换,产出实例。
// 参考 o3de Gems/Vegetation:SpawnerArea 的 rejection sampling 架构。
//
// 流程:
//   1. 计算 area = bounds.size.x * bounds.size.z
//   2. targetCount = min(maxInstances, floor(area * density))
//   3. rejection sampling (最多 targetCount * 10 次尝试):
//      a. 在 bounds 内随机 x,z;y 从 surfaceData 查询或 bounds.min.y
//      b. 查询 surfaceData 获取 SurfacePoint + normal + slope
//      c. 构建 FilterContext,运行过滤器 (跳过 disabled)
//      d. 全部通过:加权挑选 descriptor,构建 ModifierContext,运行修改器,push 实例
//      e. 达到 targetCount 停止
//   4. 追加到 this.instances,返回新实例
//
// 确定性:使用 mulberry32 PRNG (seed 来自 config.seed,默认 1),相同 seed + 相同配置 → 相同输出。

import { Box3 } from '../Math/Box3';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import type { Shape } from '../Shapes/Shape';
import { SurfaceDataSystem } from '../SurfaceData/SurfaceDataSystem';
import type { SurfacePoint } from '../SurfaceData/SurfacePoint';
import type { VegetationDescriptor } from './VegetationDescriptor';
import { VegetationFilter } from './VegetationFilter';
import type { VegetationFilterContext } from './VegetationFilter';
import { DistanceBetweenFilter } from './VegetationFilter';
import { VegetationModifier } from './VegetationModifier';
import type { VegetationModifierContext } from './VegetationModifier';

export interface SpawnedInstance {
  descriptorId: string;
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}

export interface SpawnerAreaConfig {
  id: string;
  /** Bounding box of the area (used for sampling). */
  bounds: Box3;
  /** Optional shape filter (bounds + shape intersection). */
  shape?: Shape;
  /** Density = instances per square unit (world). */
  density: number;
  /** Descriptors to spawn (weighted pick). */
  descriptors: VegetationDescriptor[];
  /** Filters every candidate must pass. */
  filters: VegetationFilter[];
  /** Modifiers applied to accepted candidates. */
  modifiers: VegetationModifier[];
  /** Max instances per spawn pass (safety cap). */
  maxInstances: number;
  /** PRNG seed for deterministic output. Default 1. */
  seed?: number;
}

/** mulberry32 — deterministic PRNG, returns [0, 1). */
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

/** Weighted pick: returns a descriptor chosen by weight using the PRNG. */
function pickWeighted(
  descriptors: VegetationDescriptor[],
  prng: () => number,
): VegetationDescriptor {
  const total = descriptors.reduce((sum, d) => sum + d.weight, 0);
  let r = prng() * total;
  for (const d of descriptors) {
    r -= d.weight;
    if (r < 0) return d;
  }
  return descriptors[descriptors.length - 1];
}

const UP_Y = new Vector3(0, 1, 0);

export class SpawnerArea {
  config: SpawnerAreaConfig;
  instances: SpawnedInstance[] = [];

  constructor(config: SpawnerAreaConfig) {
    this.config = config;
  }

  /**
   * Run one spawn pass over the area. Returns newly-spawned instances.
   * Uses rejection sampling: pick N candidate positions uniformly in bounds,
   * for each: query SurfaceDataSystem, build filter context, run filters,
   * if all pass: pick weighted descriptor, run modifiers, push instance.
   */
  spawn(surfaceData: SurfaceDataSystem | null): SpawnedInstance[] {
    const { bounds, density, descriptors, filters, modifiers, maxInstances } = this.config;
    const size = new Vector3();
    bounds.getSize(size);
    const area = size.x * size.z;
    const targetCount = Math.min(maxInstances, Math.floor(area * density));

    const newInstances: SpawnedInstance[] = [];
    if (descriptors.length === 0 || targetCount === 0) return newInstances;

    const prng = mulberry32(this.config.seed ?? 1);
    const maxAttempts = targetCount * 10;

    for (let attempt = 0; attempt < maxAttempts && newInstances.length < targetCount; attempt++) {
      // a. random position in bounds (x,z random, y from surfaceData query or bounds.min.y)
      const px = bounds.min.x + prng() * size.x;
      const pz = bounds.min.z + prng() * size.z;
      const candidatePos = new Vector3(px, bounds.min.y, pz);

      // b. query surfaceData for SurfacePoint + normal
      let surface: SurfacePoint | null = null;
      let normal = new Vector3(0, 1, 0);

      if (surfaceData) {
        surface = surfaceData.query(candidatePos);
        if (surface) {
          candidatePos.y = surface.position.y;
          if (surface.normal.lengthSq() > 0) {
            normal = surface.normal.clone();
          }
        }
      }

      const altitude = candidatePos.y;

      // shape intersection check
      if (this.config.shape && !this.config.shape.containsPoint(candidatePos)) {
        continue;
      }

      // pick weighted descriptor
      const descriptor = pickWeighted(descriptors, prng);

      // compute slope (radians from up)
      const slope = Math.acos(Math.min(1, Math.max(-1, normal.dot(UP_Y))));

      // c. build filter context
      const filterCtx: VegetationFilterContext = {
        position: candidatePos,
        surface,
        normal,
        slope,
        altitude,
        descriptor,
      };

      // run filters (skip disabled)
      let accepted = true;
      for (const filter of filters) {
        if (!filter.enabled) continue;
        if (!filter.accept(filterCtx)) {
          accepted = false;
          break;
        }
      }
      if (!accepted) continue;

      // d. build modifier context
      const rotation = new Quaternion();
      const scale = new Vector3(1, 1, 1);
      const modifierCtx: VegetationModifierContext = {
        position: candidatePos.clone(),
        surface,
        normal: normal.clone(),
        slope,
        altitude,
        descriptor,
        rotation,
        scale,
      };

      // run modifiers (skip disabled)
      for (const modifier of modifiers) {
        if (!modifier.enabled) continue;
        modifier.apply(modifierCtx);
      }

      // push instance
      const instance: SpawnedInstance = {
        descriptorId: descriptor.id,
        position: modifierCtx.position,
        rotation: modifierCtx.rotation,
        scale: modifierCtx.scale,
      };
      newInstances.push(instance);
      this.instances.push(instance);

      // update DistanceBetweenFilter.placed
      for (const filter of filters) {
        if (filter instanceof DistanceBetweenFilter) {
          filter.placed.push(instance.position.clone());
        }
      }
    }

    return newInstances;
  }

  clear(): void {
    this.instances.length = 0;
    // also clear any DistanceBetweenFilter's placed list
    for (const filter of this.config.filters) {
      if (filter instanceof DistanceBetweenFilter) {
        filter.placed.length = 0;
      }
    }
  }
}

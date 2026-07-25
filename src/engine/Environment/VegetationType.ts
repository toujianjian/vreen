// VegetationType — 植被类型定义。
//
// 描述一种植被(草地/灌木/松树/阔叶树等)的几何/材质/放置规则。
// VegetationSystem.generate() 依据 VegetationType.canPlace() 在地形上
// 撒点,生成 InstancedMesh 实例。
//
// 字段说明:
//   * geometry / material:实例渲染用的几何体与材质(可被 InstancedMesh 共享)
//   * minScale / maxScale:实例缩放区间,uniform 随机
//   * slopeThreshold:坡度阈值(弧度),超过则不放置(树木不生于陡坡)
//   * heightThreshold:[minHeight, maxHeight] 世界 Y 区间,控制植被垂直分布
//   * probability:相对概率(0..1),多类型竞争同一格点时按概率加权选择

import type { BufferGeometry } from '../Core/BufferGeometry';
import type { Material } from '../Core/Material';

/** VegetationType 构造参数。 */
export interface VegetationTypeOptions {
  /** 类型名(如 'grass' / 'pine' / 'bush')。 */
  name: string;
  /** 实例几何体(由 InstancedMesh 共享)。 */
  geometry: BufferGeometry;
  /** 实例材质。 */
  material: Material;
  /** 最小缩放。 */
  minScale?: number;
  /** 最大缩放。 */
  maxScale?: number;
  /** 坡度阈值(弧度),地形坡度 > 此值时不放置。默认 PI/4 (45°)。 */
  slopeThreshold?: number;
  /** 高度区间 [minY, maxY],世界 Y。默认 [-∞, +∞]。 */
  heightThreshold?: [number, number];
  /** 相对概率(0..1)。默认 1。 */
  probability?: number;
}

/**
 * 植被类型 — 描述一种植被的渲染与放置规则。
 */
export class VegetationType {
  /** 类型名。 */
  name: string;
  /** 实例几何体。 */
  geometry: BufferGeometry;
  /** 实例材质。 */
  material: Material;
  /** 最小缩放。 */
  minScale: number;
  /** 最大缩放。 */
  maxScale: number;
  /** 坡度阈值(弧度)。 */
  slopeThreshold: number;
  /** 高度区间 [minY, maxY]。 */
  heightThreshold: [number, number];
  /** 相对概率(0..1)。 */
  probability: number;

  constructor(opts: VegetationTypeOptions) {
    this.name = opts.name;
    this.geometry = opts.geometry;
    this.material = opts.material;
    this.minScale = opts.minScale ?? 1;
    this.maxScale = opts.maxScale ?? 1;
    if (this.minScale > this.maxScale) {
      const t = this.minScale;
      this.minScale = this.maxScale;
      this.maxScale = t;
    }
    this.slopeThreshold = opts.slopeThreshold ?? Math.PI / 4;
    this.heightThreshold = opts.heightThreshold
      ? [opts.heightThreshold[0], opts.heightThreshold[1]]
      : [-Infinity, Infinity];
    this.probability = opts.probability ?? 1;
  }

  /**
   * 判断此类型是否可放置在给定高度与坡度处。
   *
   * @param height 世界 Y 高度。
   * @param slope  地形坡度(弧度,0=水平,π/2=垂直)。
   * @returns true 表示可放置。
   */
  canPlace(height: number, slope: number): boolean {
    if (slope > this.slopeThreshold) return false;
    if (height < this.heightThreshold[0]) return false;
    if (height > this.heightThreshold[1]) return false;
    return true;
  }
}

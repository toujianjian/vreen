// TerrainLayer — 地形纹理层定义。
// 每一层绑定一张可平铺纹理 + 在 splatmap 生成时的高度/坡度判定区间。
// 最多 4 层(R / G / B / A 四通道),通常用于 沙 → 草 → 岩石 → 雪 的过渡。
//
// 字段语义:
//   * texture        — 该层的可平铺颜色纹理(由调用方负责加载)
//   * scale          — UV 平铺缩放,> 1 表示纹理在地面上重复更多次
//   * minHeight/maxHeight — 该层在高度域(Y 轴,世界单位)上"活跃"的区间
//   * maxSlope       — 该层能覆盖的最大坡度(角度,度数,0=水平 / 90=垂直)
//                       例如草地 maxSlope=30,岩石 maxSlope=90

import { Texture } from '../Core/Texture';

/** TerrainLayer 构造参数。 */
export interface TerrainLayerOptions {
  /** 该层颜色纹理。 */
  texture: Texture;
  /** UV 平铺缩放,默认 1。 */
  scale?: number;
  /** 该层起始高度(世界 Y),默认 -Infinity。 */
  minHeight?: number;
  /** 该层结束高度(世界 Y),默认 +Infinity。 */
  maxHeight?: number;
  /** 该层最大坡度(度数),默认 90(任意坡度)。 */
  maxSlope?: number;
}

/**
 * 地形层 — 描述 splatmap 中一层的纹理与分布规则。
 *
 * 规则定义:当顶点高度 ∈ [minHeight, maxHeight] 且坡度 ≤ maxSlope 时,
 * 该层获得较高权重。TerrainSplat 会把所有层权重归一化后写入 splatmap。
 */
export class TerrainLayer {
  /** 该层颜色纹理。 */
  texture: Texture;
  /** UV 平铺缩放。 */
  scale: number;
  /** 该层起始高度(世界 Y)。 */
  minHeight: number;
  /** 该层结束高度(世界 Y)。 */
  maxHeight: number;
  /** 该层最大坡度(度数)。 */
  maxSlope: number;

  constructor(opts: TerrainLayerOptions) {
    this.texture = opts.texture;
    this.scale = opts.scale ?? 1;
    this.minHeight = opts.minHeight ?? -Infinity;
    this.maxHeight = opts.maxHeight ?? Infinity;
    this.maxSlope = opts.maxSlope ?? 90;
  }
}

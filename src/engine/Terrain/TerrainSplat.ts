// TerrainSplat — 地形纹理混合(splatmap)。
//
// 概念:地形表面用一张 RGBA splatmap 控制最多 4 层纹理的权重,
// 每个顶点/纹素对应 RGBA 四个通道,R=层0(沙) G=层1(草)
// B=层2(岩石) A=层3(雪)。shader 中按权重混合 4 张可平铺纹理。
//
// 生成规则:对每个顶点 v
//   1. 取高度 h = position.y,坡度 slopeDeg = acos(normal.y) * 180/π
//   2. 对每层计算 weight_i:
//        heightFit = 帐篷函数,在 [minH, maxH] 区间内为 1,外侧线性衰减
//        slopeFit  = slopeDeg ≤ maxSlope 时为 1,超出则线性衰减到 0
//        weight_i  = heightFit * slopeFit
//   3. 归一化所有 weight,使 Σ=1,写入 RGBA(0..255)
//   4. 若所有 weight 为 0,默认填层 0(避免空洞)
//
// 典型用法:
//   const splat = new TerrainSplat();
//   splat.generateSplatmap(geometry, [
//     new TerrainLayer({ texture: sandTex,  minHeight: 0,  maxHeight: 2,  maxSlope: 15 }),
//     new TerrainLayer({ texture: grassTex, minHeight: 1,  maxHeight: 8,  maxSlope: 35 }),
//     new TerrainLayer({ texture: rockTex,  minHeight: 5,  maxHeight: 20, maxSlope: 90 }),
//     new TerrainLayer({ texture: snowTex,  minHeight: 15, maxHeight: 30, maxSlope: 25 }),
//   ]);

import { TerrainGeometry } from './TerrainGeometry';
import { TerrainLayer } from './TerrainLayer';

/** 度数/弧度转换常量。 */
const RAD2DEG = 180 / Math.PI;

/** 坡度衰减带宽度(度数):超过 maxSlope 后线性衰减到 0 的区间。 */
const SLOPE_FALLOFF = 30;

/** 高度帐篷函数:在 [minH, maxH] 内为 1,两侧线性衰减到 0(半宽 = 区间一半)。 */
function heightTent(h: number, minH: number, maxH: number): number {
  if (minH === -Infinity && maxH === Infinity) return 1;
  if (maxH <= minH) {
    // 退化:单点匹配
    return Math.abs(h - minH) < 1e-6 ? 1 : 0;
  }
  const mid = (minH + maxH) * 0.5;
  const half = (maxH - minH) * 0.5;
  if (half <= 0) return Math.abs(h - mid) < 1e-6 ? 1 : 0;
  const d = Math.abs(h - mid);
  if (d >= half) {
    // 区间外:线性衰减到 0(衰减带宽 = half)
    const falloff = half; // 衰减带与区间等宽,保证平滑过渡
    return Math.max(0, 1 - (d - half) / falloff);
  }
  return 1;
}

/** 坡度衰减:slopeDeg ≤ maxSlope 时为 1,超出则线性衰减到 0。 */
function slopeFit(slopeDeg: number, maxSlope: number): number {
  if (slopeDeg <= maxSlope) return 1;
  if (maxSlope >= 90) return 1;
  return Math.max(0, 1 - (slopeDeg - maxSlope) / SLOPE_FALLOFF);
}

/**
 * 地形 splatmap 生成器。
 *
 * 持有最多 4 层 TerrainLayer,根据几何体顶点的世界高度/坡度生成 RGBA 权重图。
 */
export class TerrainSplat {
  /** 已注册的地形层(最多 4)。 */
  layers: TerrainLayer[] = [];
  /** 生成的 splatmap(RGBA,每顶点 4 字节),未生成前为 null。 */
  splatmap: Uint8Array | null = null;
  /** splatmap 的宽度(= 几何体 gridX1)。 */
  splatmapWidth: number = 0;
  /** splatmap 的高度(= 几何体 gridY1)。 */
  splatmapHeight: number = 0;

  /** 最大层数(RGBA 四通道)。 */
  static readonly MAX_LAYERS = 4;

  /**
   * 添加一个地形层。
   * @throws 超过 4 层时抛错
   */
  addLayer(layer: TerrainLayer): this {
    if (this.layers.length >= TerrainSplat.MAX_LAYERS) {
      throw new Error(`TerrainSplat: 最大 ${TerrainSplat.MAX_LAYERS} 层,已无法添加`);
    }
    this.layers.push(layer);
    return this;
  }

  /**
   * 根据高度/坡度规则生成 splatmap。
   *
   * @param geometry    目标地形几何体(需含 position 与 normal 属性)
   * @param layerRules  层规则数组(每个 TerrainLayer 的 minHeight/maxHeight/maxSlope 定义该层分布)
   * @returns Uint8Array,长度 = vertexCount * 4,RGBA 顺序对应 layerRules 顺序
   */
  generateSplatmap(geometry: TerrainGeometry, layerRules: TerrainLayer[]): Uint8Array {
    if (layerRules.length === 0) {
      throw new Error('TerrainSplat.generateSplatmap: 至少需要 1 条 layerRule');
    }
    if (layerRules.length > TerrainSplat.MAX_LAYERS) {
      throw new Error(
        `TerrainSplat.generateSplatmap: 最多 ${TerrainSplat.MAX_LAYERS} 层,收到 ${layerRules.length}`,
      );
    }

    // 写入 layers(覆盖)
    this.layers = layerRules.slice(0, TerrainSplat.MAX_LAYERS);

    const pos = geometry.attributes.position;
    const nrm = geometry.attributes.normal;
    if (!pos || !nrm) {
      throw new Error('TerrainSplat.generateSplatmap: 几何体缺少 position 或 normal 属性');
    }
    const vc = pos.count;
    const pa = pos.array;
    const na = nrm.array;

    const splat = new Uint8Array(vc * 4);
    const nLayers = this.layers.length;
    const weights = new Array<number>(nLayers);

    for (let i = 0; i < vc; i++) {
      const h = pa[i * 3 + 1];
      const ny = na[i * 3 + 1];
      // 坡度(度数):法线 Y 分量 = 1 时水平,0 时垂直
      const slopeDeg = Math.acos(Math.max(-1, Math.min(1, ny))) * RAD2DEG;

      let sum = 0;
      for (let l = 0; l < nLayers; l++) {
        const rule = this.layers[l];
        const hFit = heightTent(h, rule.minHeight, rule.maxHeight);
        const sFit = slopeFit(slopeDeg, rule.maxSlope);
        const w = hFit * sFit;
        weights[l] = w;
        sum += w;
      }

      // 归一化到 0..255;若全 0 则默认层 0
      if (sum <= 0) {
        splat[i * 4 + 0] = 255;
        for (let l = 1; l < 4; l++) splat[i * 4 + l] = 0;
      } else {
        // 逐通道四舍五入,并修正舍入误差使 RGBA 之和精确为 255
        let roundedSum = 0;
        let maxIdx = 0;
        let maxVal = -1;
        for (let l = 0; l < 4; l++) {
          const w = l < nLayers ? weights[l] / sum : 0;
          const r = Math.round(w * 255);
          splat[i * 4 + l] = r;
          roundedSum += r;
          if (r > maxVal) {
            maxVal = r;
            maxIdx = l;
          }
        }
        if (roundedSum !== 255) {
          // 把舍入差值加到权重最大的通道(相对误差最小)
          splat[i * 4 + maxIdx] += 255 - roundedSum;
        }
      }
    }

    this.splatmap = splat;
    this.splatmapWidth = geometry.gridX1;
    this.splatmapHeight = geometry.gridY1;
    return splat;
  }

  /** 获取已生成的 splatmap(未生成时为 null)。 */
  getSplatmap(): Uint8Array | null {
    return this.splatmap;
  }
}

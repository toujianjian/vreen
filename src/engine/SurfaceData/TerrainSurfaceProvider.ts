// TerrainSurfaceProvider — 把 VREEN TerrainGeometry 适配为 SurfaceDataProvider。
// 参考 o3de TerrainSurfaceDataModifier:按高度带 (altitudeBands) 与坡度带 (slopeBands)
// 给表面点打标签。
//
// 适配方式:constructor 注入 getHeightAt / getNormalAt 回调 (TerrainGeometry 提供
// getHeightAt,但法线需从 attribute 采样或由调用方提供),避免硬依赖 TerrainGeometry
// 的内部结构,也便于单测用纯函数 mock。

import { Vector3 } from '../Math/Vector3';
import type { SurfaceDataProvider } from './SurfaceDataProvider';
import { SurfacePoint, createSurfacePoint } from './SurfacePoint';
import type { SurfaceTag } from './SurfaceTag';

export interface TerrainSurfaceConfig {
  /** 高度带:y ∈ [minAltitude, maxAltitude] 时打对应标签 (权重 1)。 */
  altitudeBands: Array<{ tag: string; minAltitude: number; maxAltitude: number }>;
  /** 可选坡度带:法线与 up 夹角 (弧度) ∈ [minSlope, maxSlope] 时打标签。 */
  slopeBands?: Array<{ tag: string; minSlope: number; maxSlope: number }>;
}

export class TerrainSurfaceProvider implements SurfaceDataProvider {
  readonly id: string;

  constructor(
    id: string,
    private getHeightAt: (x: number, z: number) => number,
    private getNormalAt: (x: number, z: number) => Vector3,
    private config: TerrainSurfaceConfig,
  ) {
    this.id = id;
  }

  getSurfacePoints(worldPosition: Vector3, maxPoints: number): SurfacePoint[] {
    if (maxPoints <= 0) return [];

    const x = worldPosition.x;
    const z = worldPosition.z;
    const y = this.getHeightAt(x, z);
    const normal = this.getNormalAt(x, z);
    const position = new Vector3(x, y, z);
    const tags: SurfaceTag[] = [];

    for (const band of this.config.altitudeBands) {
      if (y >= band.minAltitude && y <= band.maxAltitude) {
        tags.push({ id: band.tag, weight: 1 });
      }
    }

    const slopeBands = this.config.slopeBands;
    if (slopeBands && slopeBands.length > 0) {
      const upY = normal.y; // normal 假定已归一化;up=(0,1,0)
      const cos = upY < -1 ? -1 : upY > 1 ? 1 : upY;
      const slope = Math.acos(cos);
      for (const band of slopeBands) {
        if (slope >= band.minSlope && slope <= band.maxSlope) {
          tags.push({ id: band.tag, weight: 1 });
        }
      }
    }

    return [createSurfacePoint(position, normal, tags)];
  }
}

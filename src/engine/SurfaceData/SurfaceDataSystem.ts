// SurfaceDataSystem — 表面数据查询入口。
// 参考 o3de SurfaceDataSystem:遍历所有已注册 provider,合并为单个最佳 SurfacePoint。
//
// 合并规则:
//   * 标签权重按 id 求和并钳制到 [0,1];
//   * position 取第一个返回点;
//   * normal 取第一个非零法线 (无则默认 up);
//   * 无任何点返回 null。

import { Vector3 } from '../Math/Vector3';
import { SurfacePoint, createSurfacePoint, getDominantTag } from './SurfacePoint';
import type { SurfaceDataProviderRegistry } from './SurfaceDataProvider';

export class SurfaceDataSystem {
  constructor(private registry: SurfaceDataProviderRegistry) {}

  /** 查询所有 provider,合并为单个 SurfacePoint (每标签权重求和并钳制到 1)。 */
  query(worldPosition: Vector3, maxPointsPerProvider = 4): SurfacePoint | null {
    const tagWeights = new Map<string, number>();
    let position: Vector3 | null = null;
    let normal: Vector3 | null = null;
    let found = false;

    for (const provider of this.registry.getAll()) {
      const points = provider.getSurfacePoints(worldPosition, maxPointsPerProvider);
      for (const p of points) {
        found = true;
        if (position === null) position = p.position;
        if (normal === null && p.normal.lengthSq() > 0) normal = p.normal;
        for (const t of p.tags) {
          const sum = (tagWeights.get(t.id) ?? 0) + t.weight;
          tagWeights.set(t.id, sum > 1 ? 1 : sum);
        }
      }
    }

    if (!found) return null;

    const tags = Array.from(tagWeights, ([id, weight]) => ({ id, weight }));
    return createSurfacePoint(
      position ?? worldPosition,
      normal ?? new Vector3(0, 1, 0),
      tags,
    );
  }

  /** 查询并返回主标签 (或 null)。 */
  queryTag(worldPosition: Vector3): string | null {
    const p = this.query(worldPosition);
    return p ? getDominantTag(p) : null;
  }

  /** 批量查询。 */
  queryBatch(positions: Vector3[]): (SurfacePoint | null)[] {
    return positions.map((p) => this.query(p));
  }
}

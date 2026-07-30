// SurfacePoint — 表面采样点:世界坐标 + 法线 + 标签权重列表。
// 参考 o3de SurfaceDataPoint:provider 返回的点结构,system 合并多 provider 结果。

import { Vector3 } from '../Math/Vector3';
import type { SurfaceTag } from './SurfaceTag';

export interface SurfacePoint {
  position: Vector3;
  normal: Vector3;
  /** 每个标签的权重 (0..1)。 */
  tags: SurfaceTag[];
}

/** 构造一个 SurfacePoint,position/normal 均克隆以保证所有权独立。 */
export function createSurfacePoint(
  position: Vector3,
  normal: Vector3,
  tags: SurfaceTag[] = [],
): SurfacePoint {
  return { position: position.clone(), normal: normal.clone(), tags };
}

/** 返回权重最高的标签 id;若全部为 0 或无标签返回 null。 */
export function getDominantTag(point: SurfacePoint): string | null {
  if (point.tags.length === 0) return null;
  let best = point.tags[0];
  for (const t of point.tags) if (t.weight > best.weight) best = t;
  return best.weight > 0 ? best.id : null;
}

/** 返回指定标签的权重,不存在返回 0。 */
export function getTagWeight(point: SurfacePoint, id: string): number {
  for (const t of point.tags) if (t.id === id) return t.weight;
  return 0;
}

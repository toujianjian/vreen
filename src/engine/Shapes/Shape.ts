// Shape — 形状组件抽象基类。
// 参考 o3de Gems/LmbrCentral/Shape:每个 Shape 提供 AABB / 射线相交 / 点包含 /
// 点距离 四个核心查询,供碰撞拾取、SurfaceData 采样、ECS 触发器复用。
//
// 与 Math/Box3、Math/Sphere、Math/Ray 协作:Shape 是有“语义”的体积组件
// (可变换、可组合),Math 类型是纯几何值对象。

import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export abstract class Shape {
  abstract readonly type: string;
  /** 轴对齐包围盒。 */
  abstract getAabb(): Box3;
  /** 射线相交,返回沿射线方向的参数 t (≥0),不相交返回 null。 */
  abstract intersectRay(ray: Ray): number | null;
  /** 点是否在形状内 (含边界)。 */
  abstract containsPoint(point: Vector3): boolean;
  /** 点到形状的最短距离 (点在内部返回 0)。 */
  abstract distanceToPoint(point: Vector3): number;
  /** 基类返回 this;子类应覆写为独立副本。 */
  clone(): Shape {
    return this;
  }
}

// SphereShape — 球形状 (中心 + 半径)。
// 参考 o3de SphereShapeComponent。射线相交用几何法 (二次方程)。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class SphereShape extends Shape {
  readonly type = 'sphere';
  center: Vector3;
  radius: number;

  constructor(center: Vector3 = new Vector3(), radius: number = 0.5) {
    super();
    this.center = center;
    this.radius = radius;
  }

  getAabb(): Box3 {
    const r = this.radius;
    const c = this.center;
    return new Box3(
      new Vector3(c.x - r, c.y - r, c.z - r),
      new Vector3(c.x + r, c.y + r, c.z + r),
    );
  }

  intersectRay(ray: Ray): number | null {
    const c = this.center;
    const ox = ray.origin.x - c.x;
    const oy = ray.origin.y - c.y;
    const oz = ray.origin.z - c.z;
    const d = ray.direction;
    const a = d.x * d.x + d.y * d.y + d.z * d.z;
    const b = 2 * (ox * d.x + oy * d.y + oz * d.z);
    const r = this.radius;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t0 = (-b - sq) / (2 * a);
    const t1 = (-b + sq) / (2 * a);
    if (t1 < 0) return null; // 球在射线后方
    return t0 >= 0 ? t0 : t1; // 起点在球外取入射,球内取出口
  }

  containsPoint(p: Vector3): boolean {
    return p.distanceToSquared(this.center) <= this.radius * this.radius;
  }

  distanceToPoint(p: Vector3): number {
    return Math.max(0, p.distanceTo(this.center) - this.radius);
  }

  clone(): SphereShape {
    return new SphereShape(this.center.clone(), this.radius);
  }
}

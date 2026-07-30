// DiskShape — 平面圆盘 (center + radius + normal)。
// 参考 o3de DiskShapeComponent。零厚度;normal 默认 up (0,1,0)。
// containsPoint 要求点在平面内且径向 ≤ radius。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class DiskShape extends Shape {
  readonly type = 'disk';
  center: Vector3;
  radius: number;
  normal: Vector3;

  constructor(
    center: Vector3 = new Vector3(),
    radius: number = 0.5,
    normal: Vector3 = new Vector3(0, 1, 0),
  ) {
    super();
    this.center = center;
    this.radius = radius;
    this.normal = normal;
  }

  private normalUnit(): Vector3 {
    return this.normal.lengthSq() > 0 ? this.normal.clone().normalize() : new Vector3(0, 1, 0);
  }

  getAabb(): Box3 {
    const n = this.normalUnit();
    const r = this.radius;
    // 圆盘在世界轴 i 上的投影半宽 = r * sqrt(1 - n_i²)
    const ex = r * Math.sqrt(Math.max(0, 1 - n.x * n.x));
    const ey = r * Math.sqrt(Math.max(0, 1 - n.y * n.y));
    const ez = r * Math.sqrt(Math.max(0, 1 - n.z * n.z));
    const c = this.center;
    return new Box3(
      new Vector3(c.x - ex, c.y - ey, c.z - ez),
      new Vector3(c.x + ex, c.y + ey, c.z + ez),
    );
  }

  intersectRay(ray: Ray): number | null {
    const n = this.normalUnit();
    const denom = n.dot(ray.direction);
    if (Math.abs(denom) < 1e-12) return null; // 射线与盘平行
    const t = (n.dot(this.center) - n.dot(ray.origin)) / denom;
    if (t < 0) return null;
    const hx = ray.origin.x + ray.direction.x * t - this.center.x;
    const hy = ray.origin.y + ray.direction.y * t - this.center.y;
    const hz = ray.origin.z + ray.direction.z * t - this.center.z;
    if (hx * hx + hy * hy + hz * hz <= this.radius * this.radius) return t;
    return null;
  }

  containsPoint(p: Vector3): boolean {
    const n = this.normalUnit();
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const dz = p.z - this.center.z;
    if (Math.abs(n.x * dx + n.y * dy + n.z * dz) > 1e-9) return false; // 不在平面内
    return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
  }

  distanceToPoint(p: Vector3): number {
    const n = this.normalUnit();
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const dz = p.z - this.center.z;
    const distToPlane = n.x * dx + n.y * dy + n.z * dz;
    // 投影到平面
    const px = dx - n.x * distToPlane;
    const py = dy - n.y * distToPlane;
    const pz = dz - n.z * distToPlane;
    const rad = Math.sqrt(px * px + py * py + pz * pz);
    const dRad = rad - this.radius;
    if (dRad <= 0) return Math.abs(distToPlane); // 投影落在盘内 → 到平面距离
    return Math.sqrt(dRad * dRad + distToPlane * distToPlane); // 到盘缘
  }

  clone(): DiskShape {
    return new DiskShape(this.center.clone(), this.radius, this.normal.clone());
  }
}

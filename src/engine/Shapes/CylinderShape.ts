// CylinderShape — Y 轴实心圆柱 (侧面 + 两个圆盘端面)。
// 参考 o3de CylinderShapeComponent。center 为圆柱中心,halfHeight 为半高。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class CylinderShape extends Shape {
  readonly type = 'cylinder';
  center: Vector3;
  radius: number;
  halfHeight: number;

  constructor(center: Vector3 = new Vector3(), radius: number = 0.5, halfHeight: number = 0.5) {
    super();
    this.center = center;
    this.radius = radius;
    this.halfHeight = halfHeight;
  }

  getAabb(): Box3 {
    const r = this.radius;
    const hh = this.halfHeight;
    const c = this.center;
    return new Box3(
      new Vector3(c.x - r, c.y - hh, c.z - r),
      new Vector3(c.x + r, c.y + hh, c.z + r),
    );
  }

  intersectRay(ray: Ray): number | null {
    const o = ray.origin;
    const d = ray.direction;
    const cx = this.center.x;
    const cz = this.center.z;
    const r = this.radius;
    const yTop = this.center.y + this.halfHeight;
    const yBot = this.center.y - this.halfHeight;
    let best = Infinity;

    // 侧面:有限高圆柱
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-12) {
      const dx = o.x - cx;
      const dz = o.z - cz;
      const b = 2 * (d.x * dx + d.z * dz);
      const cc = dx * dx + dz * dz - r * r;
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
          if (t >= 0 && t < best) {
            const y = o.y + d.y * t;
            if (y >= yBot && y <= yTop) best = t;
          }
        }
      }
    }

    // 端面圆盘:y = yTop / yBot,径向 ≤ r
    if (Math.abs(d.y) > 1e-12) {
      for (const planeY of [yTop, yBot]) {
        const t = (planeY - o.y) / d.y;
        if (t >= 0 && t < best) {
          const px = o.x + d.x * t - cx;
          const pz = o.z + d.z * t - cz;
          if (px * px + pz * pz <= r * r) best = t;
        }
      }
    }

    return best === Infinity ? null : best;
  }

  containsPoint(p: Vector3): boolean {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    if (dx * dx + dz * dz > this.radius * this.radius) return false;
    return Math.abs(p.y - this.center.y) <= this.halfHeight;
  }

  distanceToPoint(p: Vector3): number {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const rad = Math.sqrt(dx * dx + dz * dz);
    const ay = Math.abs(p.y - this.center.y);
    const r = this.radius;
    const hh = this.halfHeight;
    if (rad <= r && ay <= hh) return 0;
    const dRad = rad - r; // >0 表示在径向外
    const dY = ay - hh; // >0 表示在轴向外
    if (dRad > 0 && dY > 0) return Math.sqrt(dRad * dRad + dY * dY); // 到环口
    if (dRad > 0) return dRad; // 正对侧面
    return dY; // 正对端面
  }

  clone(): CylinderShape {
    return new CylinderShape(this.center.clone(), this.radius, this.halfHeight);
  }
}

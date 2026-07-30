// TubeShape — 管形 (Y 轴环形截面 extruded:外圆柱减内圆柱)。
// 参考 o3de 管状碰撞体。center 为中心,outerRadius/innerRadius 为外/内半径,
// halfHeight 为半高。中空内腔 (径向 < innerRadius 且 |y| ≤ halfHeight) 不算固体。
//
// distanceToPoint 用环形 (annulus) 沿 Y 拉伸的精确 SDF:
//   max(|rad - midR| - thickness, |y-cy| - halfHeight)。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class TubeShape extends Shape {
  readonly type = 'tube';
  center: Vector3;
  outerRadius: number;
  innerRadius: number;
  halfHeight: number;

  constructor(
    center: Vector3 = new Vector3(),
    outerRadius: number = 0.5,
    innerRadius: number = 0.25,
    halfHeight: number = 0.5,
  ) {
    super();
    this.center = center;
    this.outerRadius = outerRadius;
    this.innerRadius = innerRadius;
    this.halfHeight = halfHeight;
  }

  getAabb(): Box3 {
    const r = this.outerRadius;
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
    const outerR = this.outerRadius;
    const innerR = this.innerRadius;
    const yTop = this.center.y + this.halfHeight;
    const yBot = this.center.y - this.halfHeight;
    let best = Infinity;

    // 侧面:外圆柱 + 内圆柱 (径向命中且 y 在范围内)
    const tryLateral = (radius: number): void => {
      const a = d.x * d.x + d.z * d.z;
      if (a <= 1e-12) return;
      const dx = o.x - cx;
      const dz = o.z - cz;
      const b = 2 * (d.x * dx + d.z * dz);
      const cc = dx * dx + dz * dz - radius * radius;
      const disc = b * b - 4 * a * cc;
      if (disc < 0) return;
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t >= 0 && t < best) {
          const y = o.y + d.y * t;
          if (y >= yBot && y <= yTop) best = t;
        }
      }
    };
    tryLateral(outerR);
    tryLateral(innerR);

    // 端面环:y = yTop / yBot,径向 ∈ [innerR, outerR]
    if (Math.abs(d.y) > 1e-12) {
      for (const planeY of [yTop, yBot]) {
        const t = (planeY - o.y) / d.y;
        if (t >= 0 && t < best) {
          const px = o.x + d.x * t - cx;
          const pz = o.z + d.z * t - cz;
          const r2 = px * px + pz * pz;
          if (r2 >= innerR * innerR && r2 <= outerR * outerR) best = t;
        }
      }
    }

    return best === Infinity ? null : best;
  }

  containsPoint(p: Vector3): boolean {
    if (Math.abs(p.y - this.center.y) > this.halfHeight) return false;
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const r2 = dx * dx + dz * dz;
    if (r2 > this.outerRadius * this.outerRadius) return false;
    if (r2 < this.innerRadius * this.innerRadius) return false; // 中空内腔
    return true;
  }

  distanceToPoint(p: Vector3): number {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const rad = Math.sqrt(dx * dx + dz * dz);
    const midR = (this.outerRadius + this.innerRadius) * 0.5;
    const thickness = (this.outerRadius - this.innerRadius) * 0.5;
    const ringSdf = Math.abs(rad - midR) - thickness;
    const ySdf = Math.abs(p.y - this.center.y) - this.halfHeight;
    const outside = Math.max(ringSdf, ySdf);
    return outside > 0 ? outside : 0;
  }

  clone(): TubeShape {
    return new TubeShape(
      this.center.clone(),
      this.outerRadius,
      this.innerRadius,
      this.halfHeight,
    );
  }
}

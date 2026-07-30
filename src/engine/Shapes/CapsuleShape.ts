// CapsuleShape — 胶囊 (Y 轴圆柱 + 两端半球)。
// 参考 o3de CapsuleShapeComponent。center 为胶囊中心;halfHeight 为圆柱半高
// (端面球心在 center.y ∓ halfHeight),总高 = 2*halfHeight + 2*radius。
//
// 相交:侧面用有限高圆柱 (轴 = Y),端面用两个完整球但只接受落在半球区域的命中。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class CapsuleShape extends Shape {
  readonly type = 'capsule';
  center: Vector3;
  radius: number;
  halfHeight: number;

  constructor(
    center: Vector3 = new Vector3(),
    radius: number = 0.4,
    halfHeight: number = 0.6,
  ) {
    super();
    this.center = center;
    this.radius = radius;
    this.halfHeight = halfHeight;
  }

  /** 点到中心线段 (Y 轴向, 端点 y = center.y ∓ halfHeight) 的距离。 */
  private distanceToSegment(p: Vector3): number {
    const ay = this.center.y - this.halfHeight;
    const by = this.center.y + this.halfHeight;
    let t = by === ay ? 0 : (p.y - ay) / (by - ay);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cy = ay + t * (by - ay);
    const dx = p.x - this.center.x;
    const dy = p.y - cy;
    const dz = p.z - this.center.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  getAabb(): Box3 {
    const r = this.radius;
    const hh = this.halfHeight;
    const c = this.center;
    return new Box3(
      new Vector3(c.x - r, c.y - hh - r, c.z - r),
      new Vector3(c.x + r, c.y + hh + r, c.z + r),
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

    // 侧面:有限高圆柱 (径向 = XZ 平面)
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

    // 端面半球:中心 (cx, yTop, cz) / (cx, yBot, cz),半径 r。
    // 仅接受命中点落在半球区域 (顶半球 y ≥ yTop,底半球 y ≤ yBot)。
    const tryHemisphere = (scy: number, acceptAbove: boolean): void => {
      const ox = o.x - cx;
      const oy = o.y - scy;
      const oz = o.z - cz;
      const aa = d.x * d.x + d.y * d.y + d.z * d.z;
      const bb = 2 * (ox * d.x + oy * d.y + oz * d.z);
      const ccc = ox * ox + oy * oy + oz * oz - r * r;
      const disc = bb * bb - 4 * aa * ccc;
      if (disc < 0) return;
      const sq = Math.sqrt(disc);
      for (const t of [(-bb - sq) / (2 * aa), (-bb + sq) / (2 * aa)]) {
        if (t >= 0 && t < best) {
          const y = o.y + d.y * t;
          if (acceptAbove ? y >= yTop : y <= yBot) best = t;
        }
      }
    };
    tryHemisphere(yTop, true);
    tryHemisphere(yBot, false);

    return best === Infinity ? null : best;
  }

  containsPoint(p: Vector3): boolean {
    return this.distanceToSegment(p) <= this.radius;
  }

  distanceToPoint(p: Vector3): number {
    return Math.max(0, this.distanceToSegment(p) - this.radius);
  }

  clone(): CapsuleShape {
    return new CapsuleShape(this.center.clone(), this.radius, this.halfHeight);
  }
}

// BoxShape — 轴对齐盒形状 (由 min/max 定义)。
// 参考 o3de BoxShapeComponent。射线相交用斯拉布斯法。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class BoxShape extends Shape {
  readonly type = 'box';
  min: Vector3;
  max: Vector3;

  constructor(
    min: Vector3 = new Vector3(-0.5, -0.5, -0.5),
    max: Vector3 = new Vector3(0.5, 0.5, 0.5),
  ) {
    super();
    this.min = min;
    this.max = max;
  }

  getAabb(): Box3 {
    return new Box3(this.min.clone(), this.max.clone());
  }

  intersectRay(ray: Ray): number | null {
    const { min, max } = this;
    const o = ray.origin;
    const d = ray.direction;
    let tmin = -Infinity;
    let tmax = Infinity;

    // X 轴
    if (Math.abs(d.x) < 1e-12) {
      if (o.x < min.x || o.x > max.x) return null;
    } else {
      const inv = 1 / d.x;
      let t1 = (min.x - o.x) * inv;
      let t2 = (max.x - o.x) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    // Y 轴
    if (Math.abs(d.y) < 1e-12) {
      if (o.y < min.y || o.y > max.y) return null;
    } else {
      const inv = 1 / d.y;
      let t1 = (min.y - o.y) * inv;
      let t2 = (max.y - o.y) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    // Z 轴
    if (Math.abs(d.z) < 1e-12) {
      if (o.z < min.z || o.z > max.z) return null;
    } else {
      const inv = 1 / d.z;
      let t1 = (min.z - o.z) * inv;
      let t2 = (max.z - o.z) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }

    if (tmax < 0) return null; // 整个盒在射线后方
    return tmin >= 0 ? tmin : tmax; // 起点在盒外取入射,盒内取出口
  }

  containsPoint(p: Vector3): boolean {
    return p.x >= this.min.x && p.x <= this.max.x
      && p.y >= this.min.y && p.y <= this.max.y
      && p.z >= this.min.z && p.z <= this.max.z;
  }

  distanceToPoint(p: Vector3): number {
    const dx = Math.max(this.min.x - p.x, 0, p.x - this.max.x);
    const dy = Math.max(this.min.y - p.y, 0, p.y - this.max.y);
    const dz = Math.max(this.min.z - p.z, 0, p.z - this.max.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  clone(): BoxShape {
    return new BoxShape(this.min.clone(), this.max.clone());
  }
}

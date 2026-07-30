// CompoundShape — 形状并集。
// 参考 o3de CompoundShapeComponent。AABB/距离/相交取各子形状的合并或最小,
// containsPoint 任一子形状命中即为真。

import { Shape } from './Shape';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Ray } from '../Math/Ray';

export class CompoundShape extends Shape {
  readonly type = 'compound';
  shapes: Shape[];

  constructor(shapes: Shape[] = []) {
    super();
    this.shapes = shapes;
  }

  getAabb(): Box3 {
    const box = new Box3();
    for (const s of this.shapes) box.union(s.getAabb());
    return box;
  }

  intersectRay(ray: Ray): number | null {
    let best: number | null = null;
    for (const s of this.shapes) {
      const t = s.intersectRay(ray);
      if (t !== null && (best === null || t < best)) best = t;
    }
    return best;
  }

  containsPoint(p: Vector3): boolean {
    for (const s of this.shapes) if (s.containsPoint(p)) return true;
    return false;
  }

  distanceToPoint(p: Vector3): number {
    let min = Infinity;
    for (const s of this.shapes) {
      const dist = s.distanceToPoint(p);
      if (dist < min) min = dist;
    }
    return min === Infinity ? 0 : min;
  }

  add(shape: Shape): this {
    this.shapes.push(shape);
    return this;
  }

  clone(): CompoundShape {
    return new CompoundShape(this.shapes.map((s) => s.clone()));
  }
}

// SplineCurve — 2D Catmull-Rom 样条,适配自 three.js src/extras/curves/SplineCurve.js (MIT)。
// 使用 uniform Catmull-Rom 基函数 (tension=0.5)。

import { Curve } from './Curve';
import { Vector2 } from '../Math/Vector2';
import { CatmullRom } from './Interpolations';

export class SplineCurve extends Curve<Vector2> {
  isSplineCurve = true;
  type = 'SplineCurve';

  points: Vector2[];

  constructor(points: Vector2[] = []) {
    super();
    this.points = points;
  }

  getPoint(t: number, optionalTarget: Vector2 = new Vector2()): Vector2 {
    const point = optionalTarget;
    const points = this.points;
    const p = (points.length - 1) * t;
    const intPoint = Math.floor(p);
    const weight = p - intPoint;

    const p0 = points[intPoint === 0 ? intPoint : intPoint - 1];
    const p1 = points[intPoint];
    const p2 = points[intPoint > points.length - 2 ? points.length - 1 : intPoint + 1];
    const p3 = points[intPoint > points.length - 3 ? points.length - 1 : intPoint + 2];

    point.set(
      CatmullRom(weight, p0.x, p1.x, p2.x, p3.x),
      CatmullRom(weight, p0.y, p1.y, p2.y, p3.y),
    );
    return point;
  }

  copy(source: this): this {
    super.copy(source);
    this.points = [];
    for (const p of source.points) {
      this.points.push(p.clone());
    }
    return this;
  }
}

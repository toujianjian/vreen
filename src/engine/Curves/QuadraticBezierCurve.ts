// QuadraticBezierCurve — 2D 二次贝塞尔曲线 (3 控制点)。
// Adapted from three.js src/extras/curves/QuadraticBezierCurve.js (MIT)。

import { Curve } from './Curve';
import { Vector2 } from '../Math/Vector2';
import { QuadraticBezier } from './Interpolations';

export class QuadraticBezierCurve extends Curve<Vector2> {
  isQuadraticBezierCurve = true;
  type = 'QuadraticBezierCurve';

  v0: Vector2;
  v1: Vector2;
  v2: Vector2;

  constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2()) {
    super();
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
  }

  getPoint(t: number, optionalTarget: Vector2 = new Vector2()): Vector2 {
    const point = optionalTarget;
    const { v0, v1, v2 } = this;
    point.set(
      QuadraticBezier(t, v0.x, v1.x, v2.x),
      QuadraticBezier(t, v0.y, v1.y, v2.y),
    );
    return point;
  }

  copy(source: this): this {
    super.copy(source);
    this.v0.copy(source.v0);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);
    return this;
  }
}

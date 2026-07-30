// CubicBezierCurve — 2D 三次贝塞尔曲线 (4 控制点)。
// Adapted from three.js src/extras/curves/CubicBezierCurve.js (MIT)。

import { Curve } from './Curve';
import { Vector2 } from '../Math/Vector2';
import { CubicBezier } from './Interpolations';

export class CubicBezierCurve extends Curve<Vector2> {
  isCubicBezierCurve = true;
  type = 'CubicBezierCurve';

  v0: Vector2;
  v1: Vector2;
  v2: Vector2;
  v3: Vector2;

  constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2(), v3 = new Vector2()) {
    super();
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
  }

  getPoint(t: number, optionalTarget: Vector2 = new Vector2()): Vector2 {
    const point = optionalTarget;
    const { v0, v1, v2, v3 } = this;
    point.set(
      CubicBezier(t, v0.x, v1.x, v2.x, v3.x),
      CubicBezier(t, v0.y, v1.y, v2.y, v3.y),
    );
    return point;
  }

  copy(source: this): this {
    super.copy(source);
    this.v0.copy(source.v0);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);
    this.v3.copy(source.v3);
    return this;
  }
}

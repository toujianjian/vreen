// CubicBezierCurve3 — 3D 三次贝塞尔曲线 (4 控制点)。
// Adapted from three.js src/extras/curves/CubicBezierCurve3.js (MIT)。

import { Curve } from './Curve';
import { Vector3 } from '../Math/Vector3';
import { CubicBezier } from './Interpolations';

export class CubicBezierCurve3 extends Curve<Vector3> {
  isCubicBezierCurve3 = true;
  type = 'CubicBezierCurve3';

  v0: Vector3;
  v1: Vector3;
  v2: Vector3;
  v3: Vector3;

  constructor(v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3()) {
    super();
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
  }

  getPoint(t: number, optionalTarget: Vector3 = new Vector3()): Vector3 {
    const point = optionalTarget;
    const { v0, v1, v2, v3 } = this;
    point.set(
      CubicBezier(t, v0.x, v1.x, v2.x, v3.x),
      CubicBezier(t, v0.y, v1.y, v2.y, v3.y),
      CubicBezier(t, v0.z, v1.z, v2.z, v3.z),
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

// LineCurve — 2D 直线段,适配自 three.js src/extras/curves/LineCurve.js (MIT)。

import { Curve } from './Curve';
import { Vector2 } from '../Math/Vector2';

export class LineCurve extends Curve<Vector2> {
  isLineCurve = true;
  type = 'LineCurve';

  v1: Vector2;
  v2: Vector2;

  constructor(v1 = new Vector2(), v2 = new Vector2()) {
    super();
    this.v1 = v1;
    this.v2 = v2;
  }

  getPoint(t: number, optionalTarget: Vector2 = new Vector2()): Vector2 {
    const point = optionalTarget;
    if (t === 1) {
      point.copy(this.v2);
    } else {
      point.copy(this.v2).sub(this.v1);
      point.multiplyScalar(t).add(this.v1);
    }
    return point;
  }

  getPointAt(u: number, optionalTarget?: Vector2): Vector2 {
    return this.getPoint(u, optionalTarget);
  }

  getTangent(_t: number, optionalTarget: Vector2 = new Vector2()): Vector2 {
    return optionalTarget.subVectors(this.v2, this.v1).normalize();
  }

  getTangentAt(u: number, optionalTarget?: Vector2): Vector2 {
    return this.getTangent(u, optionalTarget);
  }

  copy(source: this): this {
    super.copy(source);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);
    return this;
  }
}

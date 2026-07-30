// LineCurve3 — 3D 直线段,适配自 three.js src/extras/curves/LineCurve3.js (MIT)。

import { Curve } from './Curve';
import { Vector3 } from '../Math/Vector3';

export class LineCurve3 extends Curve<Vector3> {
  isLineCurve3 = true;
  type = 'LineCurve3';

  v1: Vector3;
  v2: Vector3;

  constructor(v1 = new Vector3(), v2 = new Vector3()) {
    super();
    this.v1 = v1;
    this.v2 = v2;
  }

  getPoint(t: number, optionalTarget: Vector3 = new Vector3()): Vector3 {
    const point = optionalTarget;
    if (t === 1) {
      point.copy(this.v2);
    } else {
      point.copy(this.v2).sub(this.v1);
      point.multiplyScalar(t).add(this.v1);
    }
    return point;
  }

  // 直线弧长均匀,直接用 u 作 t
  getPointAt(u: number, optionalTarget?: Vector3): Vector3 {
    return this.getPoint(u, optionalTarget);
  }

  getTangent(_t: number, optionalTarget: Vector3 = new Vector3()): Vector3 {
    return optionalTarget.subVectors(this.v2, this.v1).normalize();
  }

  getTangentAt(u: number, optionalTarget?: Vector3): Vector3 {
    return this.getTangent(u, optionalTarget);
  }

  copy(source: this): this {
    super.copy(source);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);
    return this;
  }
}

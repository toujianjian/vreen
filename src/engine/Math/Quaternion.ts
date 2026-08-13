// Quaternion — unit quaternion for rotations, x/y/z/w layout (same as
// three.js). Composable with Vector3 + scale via Matrix4.compose().

import type { Vector3 } from './Vector3';

export class Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * 变更回调:每个修改分量的 mutator 末尾调用。默认 no-op。
   * Object3D 的 _BoundQuaternion 把它接到 markDirty,使
   * `obj.rotation.setFromAxisAngle(...)` 等一切修改自动标记脏矩阵
   * (three.js Quaternion._onChangeCallback 适配,解决 setFromAxisAngle/
   * slerp/fromArray 等非 set/copy mutator 不触发脏标记的系统性缺口)。
   */
  /**
   * 变更回调(three.js 适配):原型方法,默认 no-op。`onChange(callback)`
   * 在实例上覆盖为自有属性 —— 未调 onChange 的实例**没有**自有
   * `_onChangeCallback` 属性(three.js 同款),避免 toEqual 等深比较
   * 因实例级函数引用差异误判不等。
   */
  protected _onChangeCallback(): void {}

  onChange(callback: () => void): this {
    this._onChangeCallback = callback;
    return this;
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    this._onChangeCallback();
    return this;
  }

  identity(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
    this._onChangeCallback();
    return this;
  }

  copy(q: Quaternion): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    this._onChangeCallback();
    return this;
  }

  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  /** 逐分量相等比较(与 Vector3.equals 一致的便捷方法,three.js Quaternion.equals)。 */
  equals(q: Quaternion): boolean {
    return q.x === this.x && q.y === this.y && q.z === this.z && q.w === this.w;
  }

  /** Euler XYZ in radians (matches three.js default order). */
  setFromEuler(x: number, y: number, z: number, order: 'XYZ' | 'YXZ' = 'XYZ'): this {
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);
    switch (order) {
      case 'XYZ':
        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * s3 + s1 * s2 * c3;
        this.w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'YXZ':
        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * s3 - s1 * s2 * c3;
        this.w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
    }
    this._onChangeCallback();
    return this;
  }

  multiply(q: Quaternion): this {
    const qax = this.x, qay = this.y, qaz = this.z, qaw = this.w;
    const qbx = q.x, qby = q.y, qbz = q.z, qbw = q.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._onChangeCallback();
    return this;
  }

  normalize(): this {
    const l = Math.hypot(this.x, this.y, this.z, this.w);
    if (l === 0) {
      this.x = 0; this.y = 0; this.z = 0; this.w = 1;
    } else {
      const inv = 1 / l;
      this.x *= inv; this.y *= inv; this.z *= inv; this.w *= inv;
    }
    this._onChangeCallback();
    return this;
  }

  /** 写入数组(three.js 兼容:可指定目标数组与偏移,便于连续帧写入 Float32Array)。
   *  无参数调用时返回 `[x, y, z, w]` 元组(向后兼容);带参时写入调用方数组。 */
  toArray(): [number, number, number, number];
  toArray(array: number[], offset?: number): number[];
  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    array[offset + 3] = this.w;
    return array;
  }

  /** 从数组读取(three.js 兼容:可指定偏移)。`ArrayLike<number>` 接受 number[]、
   *  readonly number[] 与 Float32Array。 */
  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    this.w = array[offset + 3];
    this._onChangeCallback();
    return this;
  }

  /** 从 4x4 矩阵(列主序 16 元素)的上 3x3 旋转子块提取单位四元数。
   *  three.js Quaternion.setFromRotationMatrix 标准算法,支持任意正交旋转矩阵。 */
  setFromRotationMatrix(m: { elements: Float32Array | number[] }): this {
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      this.w = 0.25 / s;
      this.x = (m32 - m23) * s;
      this.y = (m13 - m31) * s;
      this.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this.w = (m32 - m23) / s;
      this.x = 0.25 * s;
      this.y = (m12 + m21) / s;
      this.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this.w = (m13 - m31) / s;
      this.x = (m12 + m21) / s;
      this.y = 0.25 * s;
      this.z = (m23 + m32) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this.w = (m21 - m12) / s;
      this.x = (m13 + m31) / s;
      this.y = (m23 + m32) / s;
      this.z = 0.25 * s;
    }
    this._onChangeCallback();
    return this;
  }

  /** Conjugate (negate xyz, keep w). For a unit quaternion this equals the inverse. */
  conjugate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this._onChangeCallback();
    return this;
  }

  /** Inverse. For a unit quaternion, identical to conjugate(). */
  invert(): this {
    return this.conjugate();
  }

  /** Dot product with another quaternion (cosine of half-angle between them on the 4-sphere). */
  dot(q: Quaternion): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  /** this = a * b (composition: first apply b, then apply a). */
  multiplyQuaternions(a: Quaternion, b: Quaternion): this {
    const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w;
    const qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._onChangeCallback();
    return this;
  }

  /** this = q * this (premultiply). */
  premultiply(q: Quaternion): this {
    return this.multiplyQuaternions(q, this);
  }

  /** Set this quaternion to the rotation that rotates unit vector `vFrom` to unit vector `vTo`.
   *  Caller must normalize vFrom/vTo beforehand. Implements the standard shortest-arc algorithm. */
  setFromUnitVectors(vFrom: Vector3, vTo: Vector3): this {
    let r = vFrom.dot(vTo) + 1;
    if (r < Number.EPSILON) {
      // vFrom and vTo point in opposite directions — pick any orthogonal axis
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this.set(-vFrom.y, vFrom.x, 0, r);
      } else {
        this.set(0, -vFrom.z, vFrom.y, r);
      }
    } else {
      // xyz = cross(vFrom, vTo), w = 1 + dot(vFrom, vTo)
      this.set(
        vFrom.y * vTo.z - vFrom.z * vTo.y,
        vFrom.z * vTo.x - vFrom.x * vTo.z,
        vFrom.x * vTo.y - vFrom.y * vTo.x,
        r,
      );
    }
    return this.normalize();
  }

  /** Set this quaternion to a rotation of `angle` radians around `axis` (need not be unit). */
  setFromAxisAngle(axis: Vector3, angle: number): this {
    const half = angle / 2;
    const s = Math.sin(half);
    const len = axis.length();
    const inv = len > 0 ? 1 / len : 0;
    this.x = axis.x * inv * s;
    this.y = axis.y * inv * s;
    this.z = axis.z * inv * s;
    this.w = Math.cos(half);
    this._onChangeCallback();
    return this;
  }

  /** Spherical linear interpolation: this → qb over parameter t in [0,1]. Mutates this. */
  slerp(qb: Quaternion, t: number): this {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);

    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    let cosHalfTheta = aw * qb.w + ax * qb.x + ay * qb.y + az * qb.z;

    // Pick the shorter of the two arcs (negate qb if dot < 0)
    let bSign = 1;
    if (cosHalfTheta < 0) {
      bSign = -1;
      cosHalfTheta = -cosHalfTheta;
    }
    if (cosHalfTheta >= 1.0) {
      // Quaternions are parallel — linear interp is sufficient
      this.w = aw + (qb.w * bSign - aw) * t;
      this.x = ax + (qb.x * bSign - ax) * t;
      this.y = ay + (qb.y * bSign - ay) * t;
      this.z = az + (qb.z * bSign - az) * t;
      return this.normalize();
    }

    const sinHalfTheta = Math.sqrt(Math.max(0, 1 - cosHalfTheta * cosHalfTheta));
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta * bSign;

    this.w = aw * ratioA + qb.w * ratioB;
    this.x = ax * ratioA + qb.x * ratioB;
    this.y = ay * ratioA + qb.y * ratioB;
    this.z = az * ratioA + qb.z * ratioB;
    this._onChangeCallback();
    return this;
  }

  /** Extract the rotation angle (radians, [0, 2π)) and write the rotation axis into `outAxis`.
   *  Returns the angle. If the quaternion is identity, returns 0 and outAxis = (1,0,0). */
  toAxisAngle(outAxis: Vector3): number {
    const angle = 2 * Math.acos(Math.min(1, Math.max(-1, this.w)));
    const s = Math.sqrt(1 - this.w * this.w);
    if (s < Number.EPSILON) {
      // Identity or near-identity: axis is undefined, pick arbitrary
      outAxis.set(1, 0, 0);
      return 0;
    }
    outAxis.set(this.x / s, this.y / s, this.z / s);
    return angle;
  }

  /** Apply this quaternion's rotation to vector v (in place). Mutates and returns v. */
  applyToVector(v: Vector3): Vector3 {
    return v.applyQuaternion(this);
  }
}

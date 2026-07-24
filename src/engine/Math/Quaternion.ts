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

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  identity(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
    return this;
  }

  copy(q: Quaternion): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
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
    return this;
  }

  multiply(q: Quaternion): this {
    const qax = this.x, qay = this.y, qaz = this.z, qaw = this.w;
    const qbx = q.x, qby = q.y, qbz = q.z, qbw = q.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
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
    return this;
  }

  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }

  /** Conjugate (negate xyz, keep w). For a unit quaternion this equals the inverse. */
  conjugate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
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

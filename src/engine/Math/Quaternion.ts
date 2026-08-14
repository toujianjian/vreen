// Quaternion — unit quaternion for rotations, x/y/z/w layout (same as
// three.js). Composable with Vector3 + scale via Matrix4.compose().

import type { Vector3 } from './Vector3';
import type { EulerOrder } from './Euler';
import { clamp } from './MathUtils';
import type { BufferAttribute } from '../Core/BufferAttribute';
// 仅类型导入(编译期擦除,无运行时循环依赖):
// WritableNumberArray 定义在 Interpolant.ts,这里复用其「可写数值数组」约束,
// 供静态方法 slerpFlat 的扁平数组形参类型。Interpolant 基类不反向 import Quaternion
// (只有其子类 QuaternionLinearInterpolant 依赖),无循环。
import type { WritableNumberArray } from './Interpolant';

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
  setFromEuler(x: number, y: number, z: number, order: EulerOrder = 'XYZ'): this {
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
      case 'ZXY':
        this.x = s1 * c2 * c3 - c1 * s2 * s3;
        this.y = c1 * s2 * c3 + s1 * c2 * s3;
        this.z = c1 * c2 * s3 + s1 * s2 * c3;
        this.w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'ZYX':
        this.x = s1 * c2 * c3 - c1 * s2 * s3;
        this.y = c1 * s2 * c3 + s1 * c2 * s3;
        this.z = c1 * c2 * s3 - s1 * s2 * c3;
        this.w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case 'YZX':
        this.x = s1 * c2 * c3 + c1 * s2 * s3;
        this.y = c1 * s2 * c3 + s1 * c2 * s3;
        this.z = c1 * c2 * s3 - s1 * s2 * c3;
        this.w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'XZY':
        this.x = s1 * c2 * c3 - c1 * s2 * s3;
        this.y = c1 * s2 * c3 - s1 * c2 * s3;
        this.z = c1 * c2 * c3 + s1 * s2 * c3;
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

  /** Dot product based (4-sphere) angle between two quaternions, in radians. */
  angleTo(q: Quaternion): number {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
  }

  /** Rotate this quaternion toward `q` by at most `step` radians. Mutates this. */
  rotateTowards(q: Quaternion, step: number): this {
    const angle = this.angleTo(q);
    if (angle === 0) return this;
    const t = Math.min(1, step / angle);
    this.slerp(q, t);
    return this;
  }

  /** Squared length (x²+y²+z²+w²). */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  /** Euclidean length of the 4-vector. */
  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  /** this = slerp(qa → qb, t). Composes copy + slerp, matching three.js. */
  slerpQuaternions(qa: Quaternion, qb: Quaternion, t: number): this {
    return this.copy(qa).slerp(qb, t);
  }

  /** Set this to a uniformly random rotation (Shoemake algorithm). */
  random(): this {
    const theta1 = 2 * Math.PI * Math.random();
    const theta2 = 2 * Math.PI * Math.random();
    const x0 = Math.random();
    const r1 = Math.sqrt(1 - x0);
    const r2 = Math.sqrt(x0);
    return this.set(
      r1 * Math.sin(theta1),
      r1 * Math.cos(theta1),
      r2 * Math.sin(theta2),
      r2 * Math.cos(theta2),
    );
  }

  /** Read x/y/z/w from a BufferAttribute at the given index. */
  fromBufferAttribute(attribute: BufferAttribute, index: number): this {
    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    this.z = attribute.getZ(index);
    this.w = attribute.getW(index);
    this._onChangeCallback();
    return this;
  }

  /** JSON-serializable form: [x, y, z, w] array (matches three.js). */
  toJSON(): [number, number, number, number] {
    return this.toArray();
  }

  /**
   * 扁平数组版 slerp（Spherical linear interpolation of flat quaternion buffers）。
   *
   * 直接在 TypedArray/普通数组上做四元数球面插值,无需构造 Quaternion 实例。
   * 这是 three.js `Quaternion.slerpFlat` 的等价实现,供 `QuaternionLinearInterpolant`
   * (关键帧四元数动画轨道)消费 —— Interpolant 写入 `resultBuffer` 时只持有扁平 buffer,
   * 不触达面向对象 API,因此需要一个「就地扁平 slerp」静态方法。
   *
   * 算法与实例方法 {@link Quaternion#slerp} 完全一致(最短弧选择 + 平行退化回退线性):
   *   1. 计算 dot(src0, src1),取绝对值以走最短弧(dot<0 时翻转 src1 符号);
   *   2. 平行(dot≈±1)时线性插值 + 归一;
   *   3. 否则按半角 θ 的正弦加权: result = src0·sin((1-t)θ)/sinθ + src1·sin(tθ)/sinθ;
   *   4. 写入 dst[dstOffset..dstOffset+3]。
   *
   * @param dst 目标数组,写入结果的 x/y/z/w 四个分量
   * @param dstOffset 写入起始下标
   * @param src0 源四元数 0 所在数组
   * @param srcOffset0 src0 的起始下标
   * @param src1 源四元数 1 所在数组(可与 src0 相同)
   * @param srcOffset1 src1 的起始下标
   * @param t 插值因子 ∈ [0,1]
   * @returns 传入的 dst 数组
   */
  static slerpFlat(
    dst: WritableNumberArray,
    dstOffset: number,
    src0: WritableNumberArray,
    srcOffset0: number,
    src1: WritableNumberArray,
    srcOffset1: number,
    t: number,
  ): WritableNumberArray {
    // 取出两个源四元数的分量
    let x0 = src0[srcOffset0];
    let y0 = src0[srcOffset0 + 1];
    let z0 = src0[srcOffset0 + 2];
    let w0 = src0[srcOffset0 + 3];

    const x1 = src1[srcOffset1];
    const y1 = src1[srcOffset1 + 1];
    const z1 = src1[srcOffset1 + 2];
    const w1 = src1[srcOffset1 + 3];

    if (t === 0) {
      dst[dstOffset] = x0;
      dst[dstOffset + 1] = y0;
      dst[dstOffset + 2] = z0;
      dst[dstOffset + 3] = w0;
      return dst;
    }
    if (t === 1) {
      dst[dstOffset] = x1;
      dst[dstOffset + 1] = y1;
      dst[dstOffset + 2] = z1;
      dst[dstOffset + 3] = w1;
      return dst;
    }

    let cosHalfTheta = w0 * w1 + x0 * x1 + y0 * y1 + z0 * z1;

    // 取最短弧:dot<0 时翻转 src1 符号(等价于使用 -src1)
    let bSign = 1;
    if (cosHalfTheta < 0) {
      bSign = -1;
      cosHalfTheta = -cosHalfTheta;
    }

    if (cosHalfTheta >= 1.0) {
      // 两个四元数平行 —— 线性插值后归一即可
      dst[dstOffset + 3] = w0 + (w1 * bSign - w0) * t;
      dst[dstOffset] = x0 + (x1 * bSign - x0) * t;
      dst[dstOffset + 1] = y0 + (y1 * bSign - y0) * t;
      dst[dstOffset + 2] = z0 + (z1 * bSign - z0) * t;

      // 归一化(t四元数长度需为 1)
      const invLen =
        1 /
        Math.sqrt(
          dst[dstOffset] * dst[dstOffset] +
            dst[dstOffset + 1] * dst[dstOffset + 1] +
            dst[dstOffset + 2] * dst[dstOffset + 2] +
            dst[dstOffset + 3] * dst[dstOffset + 3],
        );
      dst[dstOffset] *= invLen;
      dst[dstOffset + 1] *= invLen;
      dst[dstOffset + 2] *= invLen;
      dst[dstOffset + 3] *= invLen;
      return dst;
    }

    const sinHalfTheta = Math.sqrt(Math.max(0, 1 - cosHalfTheta * cosHalfTheta));
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = (Math.sin(t * halfTheta) / sinHalfTheta) * bSign;

    dst[dstOffset + 3] = w0 * ratioA + w1 * ratioB;
    dst[dstOffset] = x0 * ratioA + x1 * ratioB;
    dst[dstOffset + 1] = y0 * ratioA + y1 * ratioB;
    dst[dstOffset + 2] = z0 * ratioA + z1 * ratioB;

    return dst;
  }
}

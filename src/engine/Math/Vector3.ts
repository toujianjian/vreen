// Vector3 — minimal three.js-compatible 3-component vector.
// API mirrors three.js for drop-in familiarity, but written from scratch
// so the engine has zero external runtime dependencies (no three.js).

import type { Quaternion } from './Quaternion';

export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * 变更回调:每个修改分量的 mutator 末尾调用。默认 no-op。
   * Object3D 的 _BoundVector3 把它接到 markDirty,使
   * `obj.position.add(...)` / `obj.scale.multiplyScalar(...)` 等一切修改
   * 自动标记脏矩阵 (three.js Vector3._onChangeCallback 适配,与
   * Quaternion._onChangeCallback 对称)。
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

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this._onChangeCallback();
    return this;
  }

  copy(v: Vector3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this._onChangeCallback();
    return this;
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  add(v: Vector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this._onChangeCallback();
    return this;
  }

  sub(v: Vector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this._onChangeCallback();
    return this;
  }

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    this._onChangeCallback();
    return this;
  }

  divideScalar(s: number): this {
    return this.multiplyScalar(1 / s);
  }

  /** Component-wise multiply: this = this * v. Mirrors three.js Vector3.multiply. */
  multiply(v: Vector3): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    this._onChangeCallback();
    return this;
  }

  /** Component-wise divide: this = this / v. Mirrors three.js Vector3.divide. */
  divide(v: Vector3): this {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    this._onChangeCallback();
    return this;
  }

  /** Component-wise: this = a * b. Mirrors three.js Vector3.multiplyVectors. */
  multiplyVectors(a: Vector3, b: Vector3): this {
    this.x = a.x * b.x;
    this.y = a.y * b.y;
    this.z = a.z * b.z;
    this._onChangeCallback();
    return this;
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * Angle (radians) between this and v. Both vectors are treated as directions;
   * zero-length vectors return 0. Mirrors three.js Vector3.angleTo.
   */
  angleTo(v: Vector3): number {
    const denom = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (denom === 0) return 0;
    const cos = Math.max(-1, Math.min(1, this.dot(v) / denom));
    return Math.acos(cos);
  }

  cross(v: Vector3): this {
    const ax = this.x;
    const ay = this.y;
    const az = this.z;
    const bx = v.x;
    const by = v.y;
    const bz = v.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    this._onChangeCallback();
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const len = this.length();
    if (len > 0) this.divideScalar(len);
    return this;
  }

  distanceTo(v: Vector3): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v: Vector3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Linear interpolation: this = this + (v - this) * alpha. */
  lerp(v: Vector3, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    this._onChangeCallback();
    return this;
  }

  /** Sets this = a + (b - a) * alpha. Mirrors three.js Vector3.lerpVectors. */
  lerpVectors(a: Vector3, b: Vector3, alpha: number): this {
    this.x = a.x + (b.x - a.x) * alpha;
    this.y = a.y + (b.y - a.y) * alpha;
    this.z = a.z + (b.z - a.z) * alpha;
    this._onChangeCallback();
    return this;
  }

  /** Transform this vector as a POINT (includes translation, perspective divide).
   *  Matrix is column-major 16-float (Matrix4.elements). For affine world
   *  matrices w=1 so no perspective divide occurs; for projection matrices
   *  the divide is applied. Mutates and returns this. */
  applyMatrix4(m: { elements: Float32Array | number[] }): this {
    const e = m.elements;
    const x = this.x, y = this.y, z = this.z;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    this._onChangeCallback();
    return this;
  }

  /** 写入数组(three.js 兼容:可指定目标数组与偏移,便于连续帧写入 Float32Array)。
   *  无参数调用时返回 `[x, y, z]` 元组(向后兼容,消费者可解构为定点元组);
   *  带参时把分量写入调用方数组并返回该数组。 */
  toArray(): [number, number, number];
  toArray(array: number[], offset?: number): number[];
  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    return array;
  }

  /** 从数组读取(three.js 兼容:可指定偏移)。`ArrayLike<number>` 接受 number[]、
   *  readonly number[] 与 Float32Array(Matrix4.elements 即 Float32Array)。 */
  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    this._onChangeCallback();
    return this;
  }

  /** 从 4x4 矩阵(列主序 16 元素)提取平移分量到 this。 */
  setFromMatrixPosition(m: { elements: Float32Array | number[] }): this {
    const e = m.elements;
    this.x = e[12];
    this.y = e[13];
    this.z = e[14];
    this._onChangeCallback();
    return this;
  }

  /** 从 4x4 矩阵(列主序 16 元素)提取第 `index` 列的前 3 个元素到 this。
   *  与 three.js Vector3.setFromMatrixColumn 语义一致。 */
  setFromMatrixColumn(index: number, m: { elements: Float32Array | number[] }): this {
    return this.fromArray(m.elements, index * 4);
  }

  /** 从 4x4 矩阵的上 3x3 旋转/缩放子块提取各列向量长度作为缩放分量。
   *  与 three.js Vector3.setFromMatrixScale 语义一致(SkeletonUtils 依赖)。 */
  setFromMatrixScale(m: { elements: Float32Array | number[] }): this {
    const e = m.elements;
    const sx = this.set(e[0], e[1], e[2]).length();
    const sy = this.set(e[4], e[5], e[6]).length();
    const sz = this.set(e[8], e[9], e[10]).length();
    this.x = sx;
    this.y = sy;
    this.z = sz;
    this._onChangeCallback();
    return this;
  }

  /** 加标量到三分量。 */
  addScalar(s: number): this {
    this.x += s;
    this.y += s;
    this.z += s;
    this._onChangeCallback();
    return this;
  }

  /** this = a + b。 */
  addVectors(a: Vector3, b: Vector3): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    this._onChangeCallback();
    return this;
  }

  /** this = a - b。 */
  subVectors(a: Vector3, b: Vector3): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    this._onChangeCallback();
    return this;
  }

  /** this += v * s。 */
  addScaledVector(v: Vector3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    this._onChangeCallback();
    return this;
  }

  /** 分量取最小值。 */
  min(v: Vector3): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    this._onChangeCallback();
    return this;
  }

  /** 分量取最大值。 */
  max(v: Vector3): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    this._onChangeCallback();
    return this;
  }

  /** 分量限制在 [min, max] 之间。 */
  clamp(min: Vector3, max: Vector3): this {
    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));
    this.z = Math.max(min.z, Math.min(max.z, this.z));
    this._onChangeCallback();
    return this;
  }

  /** 取反 this = -this。 */
  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this._onChangeCallback();
    return this;
  }

  /** 缩放到指定长度(方向不变)。 */
  setLength(len: number): this {
    const l = this.length();
    if (l > 0) this.multiplyScalar(len / l);
    return this;
  }

  /** 值相等比较。 */
  equals(v: Vector3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  /** 变换方向向量(仅取 4x4 矩阵的 3x3 部分,忽略平移,结果归一化)。
   *  常用于 Ray.applyMatrix4 把方向向量变换到新坐标系。 */
  transformDirection(m: { elements: Float32Array | number[] }): this {
    const e = m.elements;
    const x = this.x, y = this.y, z = this.z;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }

  /** 应用 3x3 矩阵(列主序 9 元素)。
   *  VREEN 没有 Matrix3 类,这里用结构类型 `{ elements }` 接受任意 9 元素数组。 */
  applyMatrix3(m: { elements: Float32Array | number[] }): this {
    const e = m.elements;
    const x = this.x, y = this.y, z = this.z;
    this.x = e[0] * x + e[3] * y + e[6] * z;
    this.y = e[1] * x + e[4] * y + e[7] * z;
    this.z = e[2] * x + e[5] * y + e[8] * z;
    this._onChangeCallback();
    return this;
  }

  /** Apply quaternion rotation to this vector (rotate by q). Mutates this.
   *  Uses the optimized form: v + 2*qw*cross(q.xyz, v) + 2*cross(q.xyz, cross(q.xyz, v)). */
  applyQuaternion(q: Quaternion): this {
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const x = this.x, y = this.y, z = this.z;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    // result = v + qw * t + cross(q.xyz, t)
    this.x = x + qw * tx + (qy * tz - qz * ty);
    this.y = y + qw * ty + (qz * tx - qx * tz);
    this.z = z + qw * tz + (qx * ty - qy * tx);
    this._onChangeCallback();
    return this;
  }

  /** Drop-in for `console.log(vec)` debugging. */
  toString(): string {
    return `Vector3(${this.x.toFixed(3)}, ${this.y.toFixed(3)}, ${this.z.toFixed(3)})`;
  }
}

export const _v3 = new Vector3();

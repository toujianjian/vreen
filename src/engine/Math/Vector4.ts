// Vector4 — 4D 向量 (x, y, z, w),参考 three.js Vector4.js。
// 与 VREEN Vector3/Vector2 风格保持一致。applyMatrix4 接受任意带
// `elements: ArrayLike<number>` 的对象(兼容 Matrix4),避免运行时 import。

/** Matrix4 最小结构类型,用于 applyMatrix4。 */
interface Matrix4Like {
  elements: ArrayLike<number>;
}

export class Vector4 {
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

  /** width/height 别名,映射到 z/w,与 three.js 一致。 */
  get width(): number { return this.z; }
  set width(v: number) { this.z = v; }
  get height(): number { return this.w; }
  set height(v: number) { this.w = v; }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  setScalar(s: number): this {
    this.x = s;
    this.y = s;
    this.z = s;
    this.w = s;
    return this;
  }

  setX(x: number): this { this.x = x; return this; }
  setY(y: number): this { this.y = y; return this; }
  setZ(z: number): this { this.z = z; return this; }
  setW(w: number): this { this.w = w; return this; }

  setComponent(index: number, value: number): this {
    switch (index) {
      case 0: this.x = value; break;
      case 1: this.y = value; break;
      case 2: this.z = value; break;
      case 3: this.w = value; break;
      default: throw new Error(`Vector4: index out of range: ${index}`);
    }
    return this;
  }

  getComponent(index: number): number {
    switch (index) {
      case 0: return this.x;
      case 1: return this.y;
      case 2: return this.z;
      case 3: return this.w;
      default: throw new Error(`Vector4: index out of range: ${index}`);
    }
  }

  clone(): Vector4 {
    return new Vector4(this.x, this.y, this.z, this.w);
  }

  /** 兼容从 Vector3 拷贝(无 w 时取 1)。 */
  copy(v: { x: number; y: number; z: number; w?: number }): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = v.w !== undefined ? v.w : 1;
    return this;
  }

  add(v: Vector4): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.w += v.w;
    return this;
  }

  addScalar(s: number): this {
    this.x += s;
    this.y += s;
    this.z += s;
    this.w += s;
    return this;
  }

  addVectors(a: Vector4, b: Vector4): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    this.w = a.w + b.w;
    return this;
  }

  addScaledVector(v: Vector4, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    this.w += v.w * s;
    return this;
  }

  sub(v: Vector4): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.w -= v.w;
    return this;
  }

  subScalar(s: number): this {
    this.x -= s;
    this.y -= s;
    this.z -= s;
    this.w -= s;
    return this;
  }

  subVectors(a: Vector4, b: Vector4): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    this.w = a.w - b.w;
    return this;
  }

  multiply(v: Vector4): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    this.w *= v.w;
    return this;
  }

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    this.w *= s;
    return this;
  }

  divide(v: Vector4): this {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    this.w /= v.w;
    return this;
  }

  divideScalar(s: number): this {
    return this.multiplyScalar(1 / s);
  }

  /** 应用 4x4 矩阵,不做透视除法(与 three.js Vector4.applyMatrix4 一致)。 */
  applyMatrix4(m: Matrix4Like): this {
    const x = this.x, y = this.y, z = this.z, w = this.w;
    const e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
    this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.w = -this.w;
    return this;
  }

  dot(v: Vector4): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  manhattanLength(): number {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);
  }

  normalize(): this {
    return this.divideScalar(this.length() || 1);
  }

  setLength(length: number): this {
    return this.normalize().multiplyScalar(length);
  }

  distanceTo(v: Vector4): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v: Vector4): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    const dw = this.w - v.w;
    return dx * dx + dy * dy + dz * dz + dw * dw;
  }

  lerp(v: Vector4, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    this.w += (v.w - this.w) * alpha;
    return this;
  }

  lerpVectors(a: Vector4, b: Vector4, alpha: number): this {
    this.x = a.x + (b.x - a.x) * alpha;
    this.y = a.y + (b.y - a.y) * alpha;
    this.z = a.z + (b.z - a.z) * alpha;
    this.w = a.w + (b.w - a.w) * alpha;
    return this;
  }

  equals(v: Vector4): boolean {
    return (
      v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w
    );
  }

  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }

  fromArray(a: [number, number, number, number]): this {
    this.x = a[0];
    this.y = a[1];
    this.z = a[2];
    this.w = a[3];
    return this;
  }
}

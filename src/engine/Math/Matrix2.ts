// Matrix2 — 2x2 矩阵,4 个元素以 column-major 存储在 `number[]` 中,
// 与 three.js Matrix2 风格一致(列主序存储,构造参数与 set() 按 row-major 传入),
// 也是 VGREEN 自研引擎 Matrix3/Matrix4 的二维等价物。
//
// 说明(three.js Matrix2 注释要点):
//   构造与 set() 按 row-major 传入,内部转置为 column-major;调用
//   `m.set(11,12, 21,22)` 后 `m.elements = [11,21, 12,22]`。文档用 row-major
//   展示矩阵,源码计算用 column-major。
//
// 超越 three.js Matrix2 之处:three.js r169 的 Matrix2 只有 constructor/identity/
// set/fromArray 四个方法(外加 isMatrix2 标记),缺少行列式、求逆、转置、乘法与
// 2D 仿射构造等核心线性代数能力。本实现按 Matrix3 的完整方法面补齐这些常用运算,
// 使 Matrix2 成为可直接用于 2D 变换/纹理 UV/小矩阵数学的完整类。

import type { Vector2 } from './Vector2';

export class Matrix2 {
  /**
   * Column-major 4 元素存储:
   *   elements[0..1] = col0 = (n11, n21),
   *   elements[2..3] = col1 = (n12, n22)。
   */
  elements: number[];

  isMatrix2 = true;

  constructor();
  constructor(
    n11: number, n12: number,
    n21: number, n22: number,
  );
  constructor(
    n11?: number, n12?: number,
    n21?: number, n22?: number,
  ) {
    this.elements = [
      1, 0,
      0, 1,
    ];
    if (n11 !== undefined) {
      this.set(
        n11, n12 as number,
        n21 as number, n22 as number,
      );
    }
  }

  /** 按 row-major 设置元素(n11 是第 1 行第 1 列)。内部转置为 column-major。 */
  set(
    n11: number, n12: number,
    n21: number, n22: number,
  ): this {
    const te = this.elements;
    te[0] = n11; te[1] = n21;
    te[2] = n12; te[3] = n22;
    return this;
  }

  /** 单位矩阵。 */
  identity(): this {
    this.set(
      1, 0,
      0, 1,
    );
    return this;
  }

  copy(m: Matrix2): this {
    const te = this.elements;
    const me = m.elements;
    te[0] = me[0]; te[1] = me[1];
    te[2] = me[2]; te[3] = me[3];
    return this;
  }

  clone(): Matrix2 {
    return new Matrix2().fromArray(this.elements);
  }

  /** 后乘:m = this * m。 */
  multiply(m: Matrix2): this {
    return this.multiplyMatrices(this, m);
  }

  /** 前乘:m = m * this。 */
  premultiply(m: Matrix2): this {
    return this.multiplyMatrices(m, this);
  }

  /** this = a * b(列主序标准矩阵乘)。 */
  multiplyMatrices(a: Matrix2, b: Matrix2): this {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;

    const a11 = ae[0], a12 = ae[2];
    const a21 = ae[1], a22 = ae[3];

    const b11 = be[0], b12 = be[2];
    const b21 = be[1], b22 = be[3];

    te[0] = a11 * b11 + a12 * b21;
    te[2] = a11 * b12 + a12 * b22;
    te[1] = a21 * b11 + a22 * b21;
    te[3] = a21 * b12 + a22 * b22;

    return this;
  }

  /** 逐元素标量乘。 */
  multiplyScalar(s: number): this {
    const te = this.elements;
    te[0] *= s; te[2] *= s;
    te[1] *= s; te[3] *= s;
    return this;
  }

  /** 行列式 det = n11*n22 - n12*n21。 */
  determinant(): number {
    const te = this.elements;
    const a = te[0], b = te[1];
    const c = te[2], d = te[3];
    return a * d - b * c;
  }

  /**
   * 就地求逆。det=0 时清零(与 three.js Matrix3.invert 的奇异处理一致)。
   * 2×2 逆:inv = (1/det) * [[n22,-n12],[-n21,n11]]。
   */
  invert(): this {
    const te = this.elements;
    const n11 = te[0], n21 = te[1];
    const n12 = te[2], n22 = te[3];

    const det = n11 * n22 - n12 * n21;

    if (det === 0) {
      this.set(0, 0, 0, 0);
      return this;
    }

    const detInv = 1 / det;
    te[0] = n22 * detInv;
    te[1] = -n21 * detInv;
    te[2] = -n12 * detInv;
    te[3] = n11 * detInv;
    return this;
  }

  /** 就地转置(交换 te[1] 与 te[2])。 */
  transpose(): this {
    const m = this.elements;
    const tmp = m[1];
    m[1] = m[2];
    m[2] = tmp;
    return this;
  }

  /** 把 this 的转置写入 r(4 元素),this 本身不变。 */
  transposeIntoArray(r: number[]): this {
    const m = this.elements;
    r[0] = m[0];
    r[1] = m[2];
    r[2] = m[1];
    r[3] = m[3];
    return this;
  }

  /** 后乘缩放(先缩放后原变换):this = makeScale(sx,sy) * this。 */
  scale(sx: number, sy: number): this {
    this.premultiply(_m2.makeScale(sx, sy));
    return this;
  }

  /** 后乘旋转(先旋转后原变换),逆时针为正。 */
  rotate(theta: number): this {
    this.premultiply(_m2.makeRotation(-theta));
    return this;
  }

  /** 平移 2×2 矩阵不是仿射 3×3,2×2 平移无意义;为对齐 Matrix3 API 保留但抛错提示。
   *  2D 平移请使用 Matrix3 或 3×3 仿射矩阵(Matrix3.makeTranslation/translate)。 */
  translate(_tx: number, _ty: number): this {
    throw new Error(
      'Matrix2.translate: 2x2 linear matrices cannot represent translation. ' +
        'Use Matrix3 (affine 3x3) for 2D translation.',
    );
  }

  /** 逆时针旋转矩阵(线性,不含平移)。 */
  makeRotation(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    this.set(c, -s, s, c);
    return this;
  }

  /** 缩放矩阵(各轴独立)。 */
  makeScale(x: number, y: number): this {
    this.set(x, 0, 0, y);
    return this;
  }

  fromArray(array: number[] | ArrayLike<number>, offset = 0): this {
    for (let i = 0; i < 4; i++) {
      this.elements[i] = (array as ArrayLike<number>)[i + offset];
    }
    return this;
  }

  toArray(array: number[] = [], offset = 0): number[] {
    const te = this.elements;
    array[offset] = te[0];
    array[offset + 1] = te[1];
    array[offset + 2] = te[2];
    array[offset + 3] = te[3];
    return array;
  }

  /** 逐元素相等比较(与 Matrix3.equals 一致)。 */
  equals(m: Matrix2): boolean {
    const te = this.elements;
    const me = m.elements;
    for (let i = 0; i < 4; i++) {
      if (te[i] !== me[i]) return false;
    }
    return true;
  }

  /**
   * 把本线性变换作用到一个二维向量(就地):v = this * v。
   * 列主序下 v.x' = n11*v.x + n12*v.y,v.y' = n21*v.x + n22*v.y。
   * 便于直接用 Matrix2 旋转/缩放 Vector2,无需经 Matrix3。
   */
  applyToVector(v: Vector2): Vector2 {
    const te = this.elements;
    const x = v.x;
    const y = v.y;
    v.x = te[0] * x + te[2] * y;
    v.y = te[1] * x + te[3] * y;
    return v;
  }
}

/** 模块级共享临时矩阵,避免 scale/rotate 每次调用分配(three.js Matrix3 同款)。 */
const _m2 = new Matrix2();

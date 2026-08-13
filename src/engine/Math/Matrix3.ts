// Matrix3 — 3x3 矩阵,9 个元素以 column-major 存储在 `number[]` 中,
// 与 three.js Matrix3 完全一致。构造参数与 set() 按 row-major 传入,
// 内部转置为 column-major。getNormalMatrix 接受 Matrix4(仅 type import)。

import type { Matrix4 } from './Matrix4';
import type { Vector2 } from './Vector2';
import type { Vector3 } from './Vector3';

export class Matrix3 {
  /** Column-major 9 元素存储:elements[0..2] = col0, [3..5] = col1, [6..8] = col2。 */
  elements: number[];

  constructor();
  constructor(
    n11: number, n12: number, n13: number,
    n21: number, n22: number, n23: number,
    n31: number, n32: number, n33: number,
  );
  constructor(
    n11?: number, n12?: number, n13?: number,
    n21?: number, n22?: number, n23?: number,
    n31?: number, n32?: number, n33?: number,
  ) {
    this.elements = [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ];
    if (n11 !== undefined) {
      this.set(
        n11, n12 as number, n13 as number,
        n21 as number, n22 as number, n23 as number,
        n31 as number, n32 as number, n33 as number,
      );
    }
  }

  /** 按 row-major 设置元素。 */
  set(
    n11: number, n12: number, n13: number,
    n21: number, n22: number, n23: number,
    n31: number, n32: number, n33: number,
  ): this {
    const te = this.elements;
    te[0] = n11; te[1] = n21; te[2] = n31;
    te[3] = n12; te[4] = n22; te[5] = n32;
    te[6] = n13; te[7] = n23; te[8] = n33;
    return this;
  }

  identity(): this {
    this.set(
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    );
    return this;
  }

  copy(m: Matrix3): this {
    const te = this.elements;
    const me = m.elements;
    te[0] = me[0]; te[1] = me[1]; te[2] = me[2];
    te[3] = me[3]; te[4] = me[4]; te[5] = me[5];
    te[6] = me[6]; te[7] = me[7]; te[8] = me[8];
    return this;
  }

  clone(): Matrix3 {
    return new Matrix3().fromArray(this.elements);
  }

  /** 把矩阵的三根基向量分别提取到 xAxis/yAxis/zAxis(three.js Matrix3.extractBasis)。 */
  extractBasis(xAxis: Vector3, yAxis: Vector3, zAxis: Vector3): this {
    xAxis.setFromMatrix3Column(this, 0);
    yAxis.setFromMatrix3Column(this, 1);
    zAxis.setFromMatrix3Column(this, 2);
    return this;
  }

  /** 从 4x4 矩阵的左上 3x3 复制。 */
  setFromMatrix4(m: Matrix4): this {
    const me = m.elements;
    this.set(
      me[0], me[4], me[8],
      me[1], me[5], me[9],
      me[2], me[6], me[10],
    );
    return this;
  }

  /** 后乘:m = this * m。 */
  multiply(m: Matrix3): this {
    return this.multiplyMatrices(this, m);
  }

  /** 前乘:m = m * this。 */
  premultiply(m: Matrix3): this {
    return this.multiplyMatrices(m, this);
  }

  multiplyMatrices(a: Matrix3, b: Matrix3): this {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;

    const a11 = ae[0], a12 = ae[3], a13 = ae[6];
    const a21 = ae[1], a22 = ae[4], a23 = ae[7];
    const a31 = ae[2], a32 = ae[5], a33 = ae[8];

    const b11 = be[0], b12 = be[3], b13 = be[6];
    const b21 = be[1], b22 = be[4], b23 = be[7];
    const b31 = be[2], b32 = be[5], b33 = be[8];

    te[0] = a11 * b11 + a12 * b21 + a13 * b31;
    te[3] = a11 * b12 + a12 * b22 + a13 * b32;
    te[6] = a11 * b13 + a12 * b23 + a13 * b33;

    te[1] = a21 * b11 + a22 * b21 + a23 * b31;
    te[4] = a21 * b12 + a22 * b22 + a23 * b32;
    te[7] = a21 * b13 + a22 * b23 + a23 * b33;

    te[2] = a31 * b11 + a32 * b21 + a33 * b31;
    te[5] = a31 * b12 + a32 * b22 + a33 * b32;
    te[8] = a31 * b13 + a32 * b23 + a33 * b33;

    return this;
  }

  multiplyScalar(s: number): this {
    const te = this.elements;
    te[0] *= s; te[3] *= s; te[6] *= s;
    te[1] *= s; te[4] *= s; te[7] *= s;
    te[2] *= s; te[5] *= s; te[8] *= s;
    return this;
  }

  determinant(): number {
    const te = this.elements;
    const a = te[0], b = te[1], c = te[2];
    const d = te[3], e = te[4], f = te[5];
    const g = te[6], h = te[7], i = te[8];
    return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
  }

  /** 就地求逆。det=0 时清零,与 three.js 一致。 */
  invert(): this {
    const te = this.elements;
    const n11 = te[0], n21 = te[1], n31 = te[2];
    const n12 = te[3], n22 = te[4], n32 = te[5];
    const n13 = te[6], n23 = te[7], n33 = te[8];

    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;
    const det = n11 * t11 + n21 * t12 + n31 * t13;

    if (det === 0) {
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
      return this;
    }

    const detInv = 1 / det;
    te[0] = t11 * detInv;
    te[1] = (n31 * n23 - n33 * n21) * detInv;
    te[2] = (n32 * n21 - n31 * n22) * detInv;
    te[3] = t12 * detInv;
    te[4] = (n33 * n11 - n31 * n13) * detInv;
    te[5] = (n31 * n12 - n32 * n11) * detInv;
    te[6] = t13 * detInv;
    te[7] = (n21 * n13 - n23 * n11) * detInv;
    te[8] = (n22 * n11 - n21 * n12) * detInv;
    return this;
  }

  transpose(): this {
    let tmp: number;
    const m = this.elements;
    tmp = m[1]; m[1] = m[3]; m[3] = tmp;
    tmp = m[2]; m[2] = m[6]; m[6] = tmp;
    tmp = m[5]; m[5] = m[7]; m[7] = tmp;
    return this;
  }

  /** 取 4x4 矩阵左上 3x3 的逆转置,用于法线矩阵。 */
  getNormalMatrix(matrix4: Matrix4): this {
    return this.setFromMatrix4(matrix4).invert().transpose();
  }

  /** 2D UV 变换矩阵:平移 (tx,ty) + 缩放 (sx,sy) + 绕 (cx,cy) 旋转(three.js 同款公式)。 */
  setUvTransform(
    tx: number, ty: number, sx: number, sy: number, rotation: number, cx: number, cy: number,
  ): this {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);

    this.set(
      sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx,
      -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty,
      0, 0, 1,
    );

    return this;
  }

  /** 后乘缩放(先缩放后原变换):this = makeScale(sx,sy) * this。 */
  scale(sx: number, sy: number): this {
    this.premultiply(_m3.makeScale(sx, sy));
    return this;
  }

  /** 后乘旋转(先旋转后原变换),逆时针为正。 */
  rotate(theta: number): this {
    this.premultiply(_m3.makeRotation(-theta));
    return this;
  }

  /** 后乘平移(先平移后原变换):this = makeTranslation(tx,ty) * this。 */
  translate(tx: number, ty: number): this {
    this.premultiply(_m3.makeTranslation(tx, ty));
    return this;
  }

  /** 平移矩阵。接受 (x,y) 或 Vector2(three.js 同款双形态)。 */
  makeTranslation(x: Vector2): this;
  makeTranslation(x: number, y: number): this;
  makeTranslation(x: number | Vector2, y?: number): this {
    if (typeof x === 'number') {
      this.set(1, 0, x, 0, 1, y as number, 0, 0, 1);
    } else {
      this.set(1, 0, x.x, 0, 1, x.y, 0, 0, 1);
    }
    return this;
  }

  /** 逆时针旋转矩阵。 */
  makeRotation(theta: number): this {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    this.set(c, -s, 0, s, c, 0, 0, 0, 1);
    return this;
  }

  /** 缩放矩阵。 */
  makeScale(x: number, y: number): this {
    this.set(x, 0, 0, 0, y, 0, 0, 0, 1);
    return this;
  }

  /** 把 this 的转置写入 r(9 元素),this 本身不变。 */
  transposeIntoArray(r: number[]): this {
    const m = this.elements;
    r[0] = m[0];
    r[1] = m[3];
    r[2] = m[6];
    r[3] = m[1];
    r[4] = m[4];
    r[5] = m[7];
    r[6] = m[2];
    r[7] = m[5];
    r[8] = m[8];
    return this;
  }

  fromArray(array: number[], offset = 0): this {
    for (let i = 0; i < 9; i++) {
      this.elements[i] = array[i + offset];
    }
    return this;
  }

  toArray(array: number[] = [], offset = 0): number[] {
    const te = this.elements;
    array[offset] = te[0];
    array[offset + 1] = te[1];
    array[offset + 2] = te[2];
    array[offset + 3] = te[3];
    array[offset + 4] = te[4];
    array[offset + 5] = te[5];
    array[offset + 6] = te[6];
    array[offset + 7] = te[7];
    array[offset + 8] = te[8];
    return array;
  }

  /** 逐元素相等比较 (与 three.js Matrix3.equals 一致)。 */
  equals(m: Matrix3): boolean {
    const te = this.elements;
    const me = m.elements;
    for (let i = 0; i < 9; i++) {
      if (te[i] !== me[i]) return false;
    }
    return true;
  }
}

/** 模块级共享临时矩阵,避免 scale/rotate/translate 每次调用分配(three.js 同款)。 */
const _m3 = new Matrix3();

// Matrix4 — column-major 4x4 matrix laid out as 16 floats, matching
// three.js and WebGL's `uniformMatrix4fv` layout exactly. The internal
// array is `Float32Array` so it can be uploaded to a shader with a
// zero-copy `gl.uniformMatrix4fv(loc, false, m.elements)` call.

export class Matrix4 {
  /** Column-major 16-float storage: m[0..3] = col0, m[4..7] = col1, … */
  elements: Float32Array;

  constructor() {
    this.elements = new Float32Array(16);
    this.identity();
  }

  identity(): this {
    const e = this.elements;
    e[0] = 1; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return this;
  }

  copy(m: Matrix4): this {
    this.elements.set(m.elements);
    return this;
  }

  clone(): Matrix4 {
    return new Matrix4().copy(this);
  }

  multiply(m: Matrix4): this {
    return this.multiplyMatrices(this, m);
  }

  premultiply(m: Matrix4): this {
    return this.multiplyMatrices(m, this);
  }

  /** 标准列主序矩阵乘法:this = a × b。与 three.js 语义一致
   *  (multiply = this×m, premultiply = m×this)。
   *  注意:历史版本曾错误实现为 b×a,导致 Object3D 世界矩阵组合
   *  (parent×local) 被算成 local×parent,现已修正为本标准语义。 */
  multiplyMatrices(a: Matrix4, b: Matrix4): this {
    const ae = a.elements;
    const be = b.elements;
    const e = this.elements;
    // Manual unroll — perf matters; we call this every frame.
    // 结果第 (i,j) 项 = a 第 i 行 · b 第 j 列。
    const a11 = ae[0],  a12 = ae[4],  a13 = ae[8],  a14 = ae[12];
    const a21 = ae[1],  a22 = ae[5],  a23 = ae[9],  a24 = ae[13];
    const a31 = ae[2],  a32 = ae[6],  a33 = ae[10], a34 = ae[14];
    const a41 = ae[3],  a42 = ae[7],  a43 = ae[11], a44 = ae[15];
    let b11 = be[0],  b21 = be[1],  b31 = be[2],  b41 = be[3];
    e[0]  = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    e[1]  = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    e[2]  = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    e[3]  = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    b11 = be[4];  b21 = be[5];  b31 = be[6];  b41 = be[7];
    e[4]  = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    e[5]  = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    e[6]  = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    e[7]  = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    b11 = be[8];  b21 = be[9];  b31 = be[10]; b41 = be[11];
    e[8]  = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    e[9]  = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    e[10] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    e[11] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    b11 = be[12]; b21 = be[13]; b31 = be[14]; b41 = be[15];
    e[12] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    e[13] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    e[14] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    e[15] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    return this;
  }

  /** Right-handed perspective projection (WebGL depth [-1, 1]). */
  makePerspective(fovYRad: number, aspect: number, near: number, far: number): this {
    const f = 1 / Math.tan(fovYRad / 2);
    const nf = 1 / (near - far);
    const e = this.elements;
    e[0] = f / aspect; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0;          e[5] = f; e[6] = 0; e[7] = 0;
    e[8] = 0;          e[9] = 0; e[10] = (far + near) * nf; e[11] = -1;
    e[12] = 0;         e[13] = 0; e[14] = 2 * far * near * nf; e[15] = 0;
    return this;
  }

  /** Right-handed orthographic projection (WebGL depth [-1, 1]). */
  makeOrthographic(left: number, right: number, top: number, bottom: number, near: number, far: number): this {
    const w = 1 / (right - left);
    const h = 1 / (top - bottom);
    const p = 1 / (far - near);
    const e = this.elements;
    e[0] = 2 * w;  e[1] = 0;     e[2] = 0;        e[3] = 0;
    e[4] = 0;      e[5] = 2 * h;  e[6] = 0;        e[7] = 0;
    e[8] = 0;      e[9] = 0;      e[10] = -2 * p;   e[11] = 0;
    e[12] = -(right + left) * w;  e[13] = -(top + bottom) * h;  e[14] = -(far + near) * p;  e[15] = 1;
    return this;
  }

  /** Right-handed lookAt view matrix (camera at `eye`, looking at `target`, `up` world up). */
  makeLookAt(eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }): this {
    const zx = eye.x - target.x;
    const zy = eye.y - target.y;
    const zz = eye.z - target.z;
    let zl = Math.hypot(zx, zy, zz) || 1;
    const zXn = zx / zl, zYn = zy / zl, zZn = zz / zl;
    let xx = up.y * zZn - up.z * zYn;
    let xy = up.z * zXn - up.x * zZn;
    let xz = up.x * zYn - up.y * zXn;
    let xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zYn * xz - zZn * xy;
    const yy = zZn * xx - zXn * xz;
    const yz = zXn * xy - zYn * xx;
    const e = this.elements;
    e[0] = xx; e[1] = yx; e[2]  = zXn; e[3]  = 0;
    e[4] = xy; e[5] = yy; e[6]  = zYn; e[7]  = 0;
    e[8] = xz; e[9] = yz; e[10] = zZn; e[11] = 0;
    e[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
    e[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
    e[14] = -(zXn * eye.x + zYn * eye.y + zZn * eye.z);
    e[15] = 1;
    return this;
  }

  /** Composed translation × rotation × scale. */
  compose(
    pos: { x: number; y: number; z: number },
    quat: { x: number; y: number; z: number; w: number },
    scl: { x: number; y: number; z: number },
  ): this {
    const x = quat.x, y = quat.y, z = quat.z, w = quat.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scl.x, sy = scl.y, sz = scl.z;
    const e = this.elements;
    e[0] = (1 - (yy + zz)) * sx;
    e[1] = (xy + wz) * sx;
    e[2] = (xz - wy) * sx;
    e[3] = 0;
    e[4] = (xy - wz) * sy;
    e[5] = (1 - (xx + zz)) * sy;
    e[6] = (yz + wx) * sy;
    e[7] = 0;
    e[8] = (xz + wy) * sz;
    e[9] = (yz - wx) * sz;
    e[10] = (1 - (xx + yy)) * sz;
    e[11] = 0;
    e[12] = pos.x;
    e[13] = pos.y;
    e[14] = pos.z;
    e[15] = 1;
    return this;
  }

  /** Invert this matrix in place. Returns identity when det=0. */
  getInverse(m: Matrix4): this {
    const a = m.elements;
    const e = this.elements;

    const a00 = a[0],  a01 = a[1],  a02 = a[2],  a03 = a[3];
    const a10 = a[4],  a11 = a[5],  a12 = a[6],  a13 = a[7];
    const a20 = a[8],  a21 = a[9],  a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    // Co-factor expansion — standard 4x4 inverse, same pattern as three.js.
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (det === 0) {
      return this.identity();
    }
    const id = 1 / det;

    e[0]  = ( a11 * b11 - a12 * b10 + a13 * b09) * id;
    e[1]  = (-a01 * b11 + a02 * b10 - a03 * b09) * id;
    e[2]  = ( a31 * b05 - a32 * b04 + a33 * b03) * id;
    e[3]  = (-a21 * b05 + a22 * b04 - a23 * b03) * id;
    e[4]  = (-a10 * b11 + a12 * b08 - a13 * b07) * id;
    e[5]  = ( a00 * b11 - a02 * b08 + a03 * b07) * id;
    e[6]  = (-a30 * b05 + a32 * b02 - a33 * b01) * id;
    e[7]  = ( a20 * b05 - a22 * b02 + a23 * b01) * id;
    e[8]  = ( a10 * b10 - a11 * b08 + a13 * b06) * id;
    e[9]  = (-a00 * b10 + a01 * b08 - a03 * b06) * id;
    e[10] = ( a30 * b04 - a31 * b02 + a33 * b00) * id;
    e[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * id;
    e[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * id;
    e[13] = ( a00 * b09 - a01 * b07 + a02 * b06) * id;
    e[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * id;
    e[15] = ( a20 * b03 - a21 * b01 + a22 * b00) * id;
    return this;
  }

  /** 3x3 inverse transpose, written into the upper-left of `out` for normals. */
  getNormalMatrix(out: Float32Array): this {
    // We compute a 3x3 inverse-transpose. Caller supplies a 9-element out.
    const e = this.elements;
    const m00 = e[0], m01 = e[1], m02 = e[2];
    const m10 = e[4], m11 = e[5], m12 = e[6];
    const m20 = e[8], m21 = e[9], m22 = e[10];
    const a = m11 * m22 - m12 * m21;
    const b = m12 * m20 - m10 * m22;
    const c = m10 * m21 - m11 * m20;
    const det = m00 * a + m01 * b + m02 * c;
    if (det === 0) {
      out[0] = 1; out[1] = 0; out[2] = 0;
      out[3] = 0; out[4] = 1; out[5] = 0;
      out[6] = 0; out[7] = 0; out[8] = 1;
      return this;
    }
    const id = 1 / det;
    out[0] = a * id;
    out[1] = (m02 * m21 - m01 * m22) * id;
    out[2] = (m01 * m12 - m02 * m11) * id;
    out[3] = b * id;
    out[4] = (m00 * m22 - m02 * m20) * id;
    out[5] = (m02 * m10 - m00 * m12) * id;
    out[6] = c * id;
    out[7] = (m01 * m20 - m00 * m21) * id;
    out[8] = (m00 * m11 - m01 * m10) * id;
    return this;
  }

  /** Column-major JSON-friendly array. Useful for IPC / Java interop. */
  toArray(): number[] {
    return Array.from(this.elements);
  }

  /** Set this matrix to a pure translation. */
  makeTranslation(x: number, y: number, z: number): this {
    const e = this.elements;
    e[0] = 1; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
    e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
    return this;
  }

  /** Set this matrix to a pure scale. */
  makeScale(x: number, y: number, z: number): this {
    const e = this.elements;
    e[0] = x; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = y; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = z; e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return this;
  }

  /** Set this matrix to a pure rotation from a quaternion. */
  makeRotationFromQuaternion(q: { x: number; y: number; z: number; w: number }): this {
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const e = this.elements;
    e[0] = 1 - (yy + zz);
    e[1] = xy + wz;
    e[2] = xz - wy;
    e[3] = 0;
    e[4] = xy - wz;
    e[5] = 1 - (xx + zz);
    e[6] = yz + wx;
    e[7] = 0;
    e[8] = xz + wy;
    e[9] = yz - wx;
    e[10] = 1 - (xx + yy);
    e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return this;
  }

  /**
   * Invert this matrix in place. Wrapper around `getInverse(this)`.
   * Returns identity when determinant is 0.
   */
  invert(): this {
    // getInverse 写入 this = inv(this),但需要先备份原始元素。
    const tmp = new Matrix4();
    tmp.copy(this);
    return this.getInverse(tmp);
  }

  /**
   * Decompose this matrix into translation / rotation / scale.
   * Mirrors three.js Matrix4.decompose.
   *
   * 注意:对于含负缩放(镜像)或剪切(非正交上 3x3)的矩阵,
   * 提取的 quaternion 可能不精确;此处只做标准 polar 分解,
   * 满足常规场景图变换需求。
   *
   * @param targetPosition 写入位置
   * @param targetQuaternion 写入旋转
   * @param targetScale 写入缩放
   */
  decompose(
    targetPosition: { x: number; y: number; z: number },
    targetQuaternion: { x: number; y: number; z: number; w: number },
    targetScale: { x: number; y: number; z: number },
  ): this {
    const e = this.elements;
    // 位置:最后一列前 3 行
    targetPosition.x = e[12];
    targetPosition.y = e[13];
    targetPosition.z = e[14];

    // 缩放:取上 3x3 各列向量长度
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    targetScale.x = sx;
    targetScale.y = sy;
    targetScale.z = sz;

    // 旋转:把上 3x3 每列除以缩放,得到纯旋转矩阵,再转为 quaternion
    // 处理 0 缩放(避免 NaN)
    const invSX = sx !== 0 ? 1 / sx : 0;
    const invSY = sy !== 0 ? 1 / sy : 0;
    const invSZ = sz !== 0 ? 1 / sz : 0;
    const m11 = e[0] * invSX, m12 = e[4] * invSY, m13 = e[8] * invSZ;
    const m21 = e[1] * invSX, m22 = e[5] * invSY, m23 = e[9] * invSZ;
    const m31 = e[2] * invSX, m32 = e[6] * invSY, m33 = e[10] * invSZ;

    // 标准 rotation matrix → quaternion(shepperd's method)
    const trace = m11 + m22 + m33;
    let qw: number, qx: number, qy: number, qz: number;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      qw = 0.25 / s;
      qx = (m32 - m23) * s;
      qy = (m13 - m31) * s;
      qz = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      qw = (m32 - m23) / s;
      qx = 0.25 * s;
      qy = (m12 + m21) / s;
      qz = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      qw = (m13 - m31) / s;
      qx = (m12 + m21) / s;
      qy = 0.25 * s;
      qz = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      qw = (m21 - m12) / s;
      qx = (m13 + m31) / s;
      qy = (m23 + m32) / s;
      qz = 0.25 * s;
    }
    targetQuaternion.x = qx;
    targetQuaternion.y = qy;
    targetQuaternion.z = qz;
    targetQuaternion.w = qw;
    return this;
  }
}

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

  multiplyMatrices(a: Matrix4, b: Matrix4): this {
    const ae = a.elements;
    const be = b.elements;
    const e = this.elements;
    // Manual unroll — perf matters; we call this every frame.
    const a11 = ae[0],  a12 = ae[4],  a13 = ae[8],  a14 = ae[12];
    const a21 = ae[1],  a22 = ae[5],  a23 = ae[9],  a24 = ae[13];
    const a31 = ae[2],  a32 = ae[6],  a33 = ae[10], a34 = ae[14];
    const a41 = ae[3],  a42 = ae[7],  a43 = ae[11], a44 = ae[15];
    let b11 = be[0],  b12 = be[4],  b13 = be[8],  b14 = be[12];
    e[0]  = b11 * a11 + b12 * a21 + b13 * a31 + b14 * a41;
    e[4]  = b11 * a12 + b12 * a22 + b13 * a32 + b14 * a42;
    e[8]  = b11 * a13 + b12 * a23 + b13 * a33 + b14 * a43;
    e[12] = b11 * a14 + b12 * a24 + b13 * a34 + b14 * a44;
    b11 = be[1];  b12 = be[5];  b13 = be[9];  b14 = be[13];
    e[1]  = b11 * a11 + b12 * a21 + b13 * a31 + b14 * a41;
    e[5]  = b11 * a12 + b12 * a22 + b13 * a32 + b14 * a42;
    e[9]  = b11 * a13 + b12 * a23 + b13 * a33 + b14 * a43;
    e[13] = b11 * a14 + b12 * a24 + b13 * a34 + b14 * a44;
    b11 = be[2];  b12 = be[6];  b13 = be[10]; b14 = be[14];
    e[2]  = b11 * a11 + b12 * a21 + b13 * a31 + b14 * a41;
    e[6]  = b11 * a12 + b12 * a22 + b13 * a32 + b14 * a42;
    e[10] = b11 * a13 + b12 * a23 + b13 * a33 + b14 * a43;
    e[14] = b11 * a14 + b12 * a24 + b13 * a34 + b14 * a44;
    b11 = be[3];  b12 = be[7];  b13 = be[11]; b14 = be[15];
    e[3]  = b11 * a11 + b12 * a21 + b13 * a31 + b14 * a41;
    e[7]  = b11 * a12 + b12 * a22 + b13 * a32 + b14 * a42;
    e[11] = b11 * a13 + b12 * a23 + b13 * a33 + b14 * a43;
    e[15] = b11 * a14 + b12 * a24 + b13 * a34 + b14 * a44;
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
    // Co-factor expansion (4x4). We unroll the inner 3x3 determinants.
    const n11 = a[0], n21 = a[1], n31 = a[2], n41 = a[3];
    const n12 = a[4], n22 = a[5], n32 = a[6], n42 = a[7];
    const n13 = a[8], n23 = a[9], n33 = a[10], n43 = a[11];
    const n14 = a[12], n24 = a[13], n34 = a[14], n44 = a[15];

    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) {
      return this.identity();
    }
    const id = 1 / det;
    e[0]  = t11 * id;
    e[4]  = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * id;
    e[8]  = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * id;
    e[12] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * id;
    e[1]  = t12 * id;
    e[5]  = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * id;
    e[9]  = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * id;
    e[13] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * id;
    e[2]  = t13 * id;
    e[6]  = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * id;
    e[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * id;
    e[14] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * id;
    e[3]  = t14 * id;
    e[7]  = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * id;
    e[11] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * id;
    e[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * id;
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
}

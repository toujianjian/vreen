// Matrix4 — column-major 4x4 matrix laid out as 16 floats, matching
// three.js and WebGL's `uniformMatrix4fv` layout exactly. The internal
// array is `Float32Array` so it can be uploaded to a shader with a
// zero-copy `gl.uniformMatrix4fv(loc, false, m.elements)` call.

import { Vector3 } from './Vector3';
import type { EulerOrder } from './Euler';

/** WebGL 坐标系统:深度映射到 [-1, 1](three.js 常量)。 */
export const WebGLCoordinateSystem = 2000;
/** WebGPU 坐标系统:深度映射到 [0, 1](three.js 常量)。 */
export const WebGPUCoordinateSystem = 2001;

// three.js 同款模块级临时向量,供 lookAt / extractRotation 复用,
// 避免每帧分配 (three.js 也用模块级 _x/_y/_z/_v1)。
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _v1 = new Vector3();

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

  /**
   * Right-handed perspective projection from a frustum, matching three.js
   * `Matrix4.makePerspective(left, right, top, bottom, near, far,
   * coordinateSystem)` exactly. `coordinateSystem` selects the depth range:
   * WebGL [-1, 1] or WebGPU [0, 1].
   *
   * 注:历史版本签名 `makePerspective(fovYRad, aspect, near, far)` 是对称
   * 视锥 (left=-right, bottom=-top) 的快捷形式,与 three.js 在
   * `top = near * tan(fov/2)`, `right = top * aspect` 转换下数值完全等价;
   * 现已改为 three.js 标准 7 参形式以完全对齐 API。
   */
  makePerspective(
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
    coordinateSystem = WebGLCoordinateSystem,
  ): this {
    const e = this.elements;
    const x = 2 * near / (right - left);
    const y = 2 * near / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    let c: number;
    let d: number;
    if (coordinateSystem === WebGLCoordinateSystem) {
      c = -(far + near) / (far - near);
      d = (-2 * far * near) / (far - near);
    } else if (coordinateSystem === WebGPUCoordinateSystem) {
      c = -far / (far - near);
      d = (-far * near) / (far - near);
    } else {
      throw new Error(`Matrix4.makePerspective(): Invalid coordinate system: ${coordinateSystem}`);
    }
    e[0] = x; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = y; e[6] = 0; e[7] = 0;
    e[8] = a; e[9] = b; e[10] = c; e[11] = -1;
    e[12] = 0; e[13] = 0; e[14] = d; e[15] = 0;
    return this;
  }

  /**
   * Right-handed orthographic projection, matching three.js
   * `Matrix4.makeOrthographic(left, right, top, bottom, near, far,
   * coordinateSystem)`. Default `coordinateSystem` (WebGL) yields depth
   * [-1, 1] identical to the historical 6-arg VREEN form; WebGPU maps depth
   * to [0, 1].
   */
  makeOrthographic(
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
    coordinateSystem = WebGLCoordinateSystem,
  ): this {
    const e = this.elements;
    const w = 1 / (right - left);
    const h = 1 / (top - bottom);
    const p = 1 / (far - near);
    const x = (right + left) * w;
    const y = (top + bottom) * h;
    let z: number;
    let zInv: number;
    if (coordinateSystem === WebGLCoordinateSystem) {
      z = (far + near) * p;
      zInv = -2 * p;
    } else if (coordinateSystem === WebGPUCoordinateSystem) {
      z = near * p;
      zInv = -1 * p;
    } else {
      throw new Error(`Matrix4.makeOrthographic(): Invalid coordinate system: ${coordinateSystem}`);
    }
    e[0] = 2 * w;  e[1] = 0;      e[2] = 0;      e[3] = 0;
    e[4] = 0;      e[5] = 2 * h;  e[6] = 0;      e[7] = 0;
    e[8] = 0;      e[9] = 0;      e[10] = zInv;  e[11] = 0;
    e[12] = -x;    e[13] = -y;    e[14] = -z;    e[15] = 1;
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

  /**
   * Write the 16 elements into `array` at `offset` (three.js semantics).
   * When `array` is omitted a fresh `number[]` is returned — compatible with
   * the historical column-major JSON-friendly form used for IPC / interop.
   */
  toArray(array: number[] = [], offset = 0): number[] {
    const te = this.elements;
    for (let i = 0; i < 16; i++) {
      array[offset + i] = te[i];
    }
    return array;
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
   * 写入方式对齐 three.js:目标若有 `.set()`(即 Vector3 / Quaternion 实例),
   * 经 `set()` 写入以触发 `_onChangeCallback` —— Object3D 的 _Bound* 绑定向量
   * 会把回调接到 `markDirty(MATRIX | MATRIX_WORLD)`,使
   * `matrix.decompose(obj.position, obj.rotation, obj.scale)` 后无需 force
   * 即可重算世界矩阵(three.js decompose 同款语义)。
   *
   * 注意:对于含负缩放(镜像)或剪切(非正交上 3x3)的矩阵,
   * 提取的 quaternion 可能不精确;此处只做标准 polar 分解,
   * 满足常规场景图变换需求。
   *
   * @param targetPosition 写入位置(Vector3 实例,或结构对象回退直接写字段)
   * @param targetQuaternion 写入旋转(Quaternion 实例,或结构对象回退直接写字段)
   * @param targetScale 写入缩放(Vector3 实例,或结构对象回退直接写字段)
   */
  decompose(
    targetPosition: { x: number; y: number; z: number },
    targetQuaternion: { x: number; y: number; z: number; w: number },
    targetScale: { x: number; y: number; z: number },
  ): this {
    const e = this.elements;
    // 位置:最后一列前 3 行(经 set() 触发 onChange,见 setVec3Like)
    setVec3Like(targetPosition, e[12], e[13], e[14]);

    // 缩放:取上 3x3 各列向量长度
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    setVec3Like(targetScale, sx, sy, sz);

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
    setQuatLike(targetQuaternion, qx, qy, qz, qw);
    return this;
  }

  /** 只把 `m` 的平移分量(第 4 列)复制到本矩阵,旋转/缩放保持不变。
   *  与 three.js Matrix4.copyPosition 语义一致,供 SkeletonUtils 重定向时
   *  在保留相对旋转的前提下把源骨骼位移写入全局矩阵。 */
  copyPosition(m: Matrix4): this {
    const te = this.elements;
    const me = m.elements;
    te[12] = me[12];
    te[13] = me[13];
    te[14] = me[14];
    return this;
  }

  /** 对矩阵的旋转/缩放三列按 `v` 逐分量缩放(不触碰平移列)。
   *  与 three.js Matrix4.scale 语义一致。注意:用本方法消除相对矩阵缩放前,
   *  调用方需先用 `scale.setFromMatrixScale` 读回缩放,再传入其倒数。 */
  scale(v: { x: number; y: number; z: number }): this {
    const te = this.elements;
    const x = v.x, y = v.y, z = v.z;
    te[0] *= x; te[4] *= y; te[8] *= z;
    te[1] *= x; te[5] *= y; te[9] *= z;
    te[2] *= x; te[6] *= y; te[10] *= z;
    te[3] *= x; te[7] *= y; te[11] *= z;
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 以下方法为 three.js r169 Matrix4 API 对齐补齐 (three.js 源逐字移植)。
  // ─────────────────────────────────────────────────────────────────────

  /** 一次性写入全部 16 个元素 (column-major),three.js 逐字语义。 */
  set(
    n11: number, n12: number, n13: number, n14: number,
    n21: number, n22: number, n23: number, n24: number,
    n31: number, n32: number, n33: number, n34: number,
    n41: number, n42: number, n43: number, n44: number,
  ): this {
    const te = this.elements;
    te[0] = n11; te[4] = n12; te[8] = n13; te[12] = n14;
    te[1] = n21; te[5] = n22; te[9] = n23; te[13] = n24;
    te[2] = n31; te[6] = n32; te[10] = n33; te[14] = n34;
    te[3] = n41; te[7] = n42; te[11] = n43; te[15] = n44;
    return this;
  }

  /** 从 3x3 矩阵 (Matrix3 或任意 `{ elements: ArrayLike<number> }`) 扩为 4x4。
   *  与 three.js Matrix4.setFromMatrix3 语义一致。 */
  setFromMatrix3(m: { elements: ArrayLike<number> }): this {
    const me = m.elements;
    this.set(
      me[0], me[3], me[6], 0,
      me[1], me[4], me[7], 0,
      me[2], me[5], me[8], 0,
      0, 0, 0, 1,
    );
    return this;
  }

  /** 把本矩阵的三个轴向量写入 xAxis/yAxis/zAxis (three.js extractBasis)。 */
  extractBasis(
    xAxis: { x: number; y: number; z: number },
    yAxis: { x: number; y: number; z: number },
    zAxis: { x: number; y: number; z: number },
  ): this {
    (xAxis as Vector3).setFromMatrixColumn(this, 0);
    (yAxis as Vector3).setFromMatrixColumn(this, 1);
    (zAxis as Vector3).setFromMatrixColumn(this, 2);
    return this;
  }

  /** 由三个轴向量组装基矩阵 (three.js makeBasis)。 */
  makeBasis(
    xAxis: { x: number; y: number; z: number },
    yAxis: { x: number; y: number; z: number },
    zAxis: { x: number; y: number; z: number },
  ): this {
    this.set(
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      0, 0, 0, 1,
    );
    return this;
  }

  /**
   * 提取 `m` 的旋转部分 (丢弃平移/缩放),写入本矩阵。
   * three.js 逐字实现:每列除以列向量长度 → 正交化,平移清零。
   * 注意:与 three.js 一致,不支持反射矩阵 (det<0 不翻转符号)。
   */
  extractRotation(m: Matrix4): this {
    const te = this.elements;
    const me = m.elements;
    const scaleX = 1 / _v1.setFromMatrixColumn(m, 0).length();
    const scaleY = 1 / _v1.setFromMatrixColumn(m, 1).length();
    const scaleZ = 1 / _v1.setFromMatrixColumn(m, 2).length();
    te[0] = me[0] * scaleX;
    te[1] = me[1] * scaleX;
    te[2] = me[2] * scaleX;
    te[3] = 0;
    te[4] = me[4] * scaleY;
    te[5] = me[5] * scaleY;
    te[6] = me[6] * scaleY;
    te[7] = 0;
    te[8] = me[8] * scaleZ;
    te[9] = me[9] * scaleZ;
    te[10] = me[10] * scaleZ;
    te[11] = 0;
    te[12] = 0;
    te[13] = 0;
    te[14] = 0;
    te[15] = 1;
    return this;
  }

  /**
   * 由欧拉角生成旋转矩阵,支持全部 6 种旋转顺序。
   * three.js makeRotationFromEuler 逐字移植 (含 ZXY 分支 `te[6] = b`)。
   */
  makeRotationFromEuler(euler: { x: number; y: number; z: number; order: EulerOrder }): this {
    const te = this.elements;
    const x = euler.x, y = euler.y, z = euler.z;
    const a = Math.cos(x), b = Math.sin(x);
    const c = Math.cos(y), d = Math.sin(y);
    const e = Math.cos(z), f = Math.sin(z);

    if (euler.order === 'XYZ') {
      const ae = a * e, af = a * f, be = b * e, bf = b * f;
      te[0] = c * e;  te[4] = -c * f; te[8] = d;
      te[1] = af + be * d; te[5] = ae - bf * d; te[9] = -b * c;
      te[2] = bf - ae * d; te[6] = be + af * d; te[10] = a * c;
    } else if (euler.order === 'YXZ') {
      const ce = c * e, cf = c * f, de = d * e, df = d * f;
      te[0] = ce + df * b; te[4] = de * b - cf; te[8] = a * d;
      te[1] = a * f;       te[5] = a * e;       te[9] = -b;
      te[2] = cf * b - de; te[6] = df + ce * b; te[10] = a * c;
    } else if (euler.order === 'ZXY') {
      const ce = c * e, cf = c * f, de = d * e, df = d * f;
      te[0] = ce - df * b; te[4] = -a * f;      te[8] = de + cf * b;
      te[1] = cf + de * b; te[5] = a * e;       te[9] = df - ce * b;
      te[2] = -a * d;      te[6] = b;           te[10] = a * c;
    } else if (euler.order === 'ZYX') {
      const ae = a * e, af = a * f, be = b * e, bf = b * f;
      te[0] = c * e;       te[4] = be * d - af; te[8] = ae * d + bf;
      te[1] = c * f;       te[5] = bf * d + ae; te[9] = af * d - be;
      te[2] = -d;          te[6] = b * c;       te[10] = a * c;
    } else if (euler.order === 'YZX') {
      const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
      te[0] = c * e;       te[4] = bd - ac * f; te[8] = bc * f + ad;
      te[1] = f;           te[5] = a * e;       te[9] = -b * e;
      te[2] = -d * e;      te[6] = ad * f + bc; te[10] = ac - bd * f;
    } else if (euler.order === 'XZY') {
      const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
      te[0] = c * e;       te[4] = -f;          te[8] = d * e;
      te[1] = ac * f + bd; te[5] = a * e;       te[9] = ad * f - bc;
      te[2] = bc * f - ad; te[6] = b * e;       te[10] = bd * f + ac;
    }

    // 底部行清零 (three.js tail)。
    te[3] = 0; te[7] = 0; te[11] = 0;
    te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
    return this;
  }

  /**
   * 旋转基矩阵:相机在 `eye`,看向 `target`,`up` 为世界向上。
   * three.js Matrix4.lookAt 逐字移植 —— 只写左上 3x3 旋转基,
   * **不动**平移列 (与 VREEN 既有 `makeLookAt` 全视矩阵区分:
   * makeLookAt 含平移,本方法对齐 three.js 只旋转)。
   */
  lookAt(
    eye: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number },
  ): this {
    const te = this.elements;
    // z 基 = normalize(eye − target) (three.js lookAt 约定)
    _z.set(eye.x - target.x, eye.y - target.y, eye.z - target.z);
    if (_z.lengthSq() === 0) {
      _z.z = 1;
    }
    _z.normalize();
    // x 基 = normalize(up × z)
    _x.set(up.y * _z.z - up.z * _z.y, up.z * _z.x - up.x * _z.z, up.x * _z.y - up.y * _z.x);
    if (_x.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) {
        _z.x += 0.0001;
      } else {
        _z.z += 0.0001;
      }
      _z.normalize();
      _x.set(up.y * _z.z - up.z * _z.y, up.z * _z.x - up.x * _z.z, up.x * _z.y - up.y * _z.x);
    }
    _x.normalize();
    // y 基 = z × x
    _y.set(_z.y * _x.z - _z.z * _x.y, _z.z * _x.x - _z.x * _x.z, _z.x * _x.y - _z.y * _x.x);
    te[0] = _x.x; te[4] = _y.x; te[8] = _z.x;
    te[1] = _x.y; te[5] = _y.y; te[9] = _z.y;
    te[2] = _x.z; te[6] = _y.z; te[10] = _z.z;
    return this;
  }

  /** 全部 16 个元素乘以标量 `s` (three.js multiplyScalar)。 */
  multiplyScalar(s: number): this {
    const te = this.elements;
    te[0] *= s; te[4] *= s; te[8] *= s; te[12] *= s;
    te[1] *= s; te[5] *= s; te[9] *= s; te[13] *= s;
    te[2] *= s; te[6] *= s; te[10] *= s; te[14] *= s;
    te[3] *= s; te[7] *= s; te[11] *= s; te[15] *= s;
    return this;
  }

  /** 行列式,4 项余子式展开 (three.js determinant 逐字)。 */
  determinant(): number {
    const te = this.elements;
    const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12];
    const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
    const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14];
    const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
    return (
      n41 * (n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 +
        n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 * (n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 -
        n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 * (n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 +
        n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 +
        n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
    );
  }

  /** 原地转置 (three.js transpose 的 6 对交换)。 */
  transpose(): this {
    const te = this.elements;
    let tmp: number;
    tmp = te[1]; te[1] = te[4]; te[4] = tmp;
    tmp = te[2]; te[2] = te[8]; te[8] = tmp;
    tmp = te[6]; te[6] = te[9]; te[9] = tmp;
    tmp = te[3]; te[3] = te[12]; te[12] = tmp;
    tmp = te[7]; te[7] = te[13]; te[13] = tmp;
    tmp = te[11]; te[11] = te[14]; te[14] = tmp;
    return this;
  }

  /**
   * 设置平移列 (第 4 列)。接受 Vector3 实例 / 结构对象 / 三个数字。
   * three.js 用 `x.isVector3` 分支;VREEN Vector3 无 isVector3 标志,
   * 故用结构鸭子类型判断 (有 x/y/z 字段的对象走向量分支)。
   */
  setPosition(
    x: number | { x: number; y: number; z: number },
    y?: number,
    z?: number,
  ): this {
    const te = this.elements;
    if (typeof x === 'object' && x !== null) {
      te[12] = x.x;
      te[13] = x.y;
      te[14] = x.z;
    } else {
      te[12] = x;
      te[13] = y as number;
      te[14] = z as number;
    }
    return this;
  }

  /** 最大轴向缩放 (三个轴向量长度最大者,three.js getMaxScaleOnAxis)。 */
  getMaxScaleOnAxis(): number {
    const te = this.elements;
    const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
    const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
    const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];
    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }

  /** 绕 X 轴旋转矩阵 (three.js makeRotationX)。 */
  makeRotationX(theta: number): this {
    const c = Math.cos(theta), s = Math.sin(theta);
    this.set(
      1, 0, 0, 0,
      0, c, -s, 0,
      0, s, c, 0,
      0, 0, 0, 1,
    );
    return this;
  }

  /** 绕 Y 轴旋转矩阵 (three.js makeRotationY)。 */
  makeRotationY(theta: number): this {
    const c = Math.cos(theta), s = Math.sin(theta);
    this.set(
      c, 0, s, 0,
      0, 1, 0, 0,
      -s, 0, c, 0,
      0, 0, 0, 1,
    );
    return this;
  }

  /** 绕 Z 轴旋转矩阵 (three.js makeRotationZ)。 */
  makeRotationZ(theta: number): this {
    const c = Math.cos(theta), s = Math.sin(theta);
    this.set(
      c, -s, 0, 0,
      s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    return this;
  }

  /** 绕任意轴旋转矩阵,轴须为单位向量 (three.js makeRotationAxis)。 */
  makeRotationAxis(axis: { x: number; y: number; z: number }, angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const x = axis.x, y = axis.y, z = axis.z;
    const tx = t * x, ty = t * y;
    this.set(
      tx * x + c, tx * y - s * z, tx * z + s * y, 0,
      tx * y + s * z, ty * y + c, ty * z - s * x, 0,
      tx * z - s * y, ty * z + s * x, t * z * z + c, 0,
      0, 0, 0, 1,
    );
    return this;
  }

  /**
   * 剪切变换矩阵。参数为 shear 分量:
   * xy = X 被 Y 剪切, xz = X 被 Z 剪切, yx = Y 被 X 剪切,
   * yz = Y 被 Z 剪切, zx = Z 被 X 剪切, zy = Z 被 Y 剪切。
   * three.js makeShear 逐字。
   */
  makeShear(xy: number, xz: number, yx: number, yz: number, zx: number, zy: number): this {
    this.set(
      1, yx, zx, 0,
      xy, 1, zy, 0,
      xz, yz, 1, 0,
      0, 0, 0, 1,
    );
    return this;
  }

  /** 逐元素相等 (three.js equals)。 */
  equals(matrix: Matrix4): boolean {
    const te = this.elements;
    const me = matrix.elements;
    for (let i = 0; i < 16; i++) {
      if (te[i] !== me[i]) return false;
    }
    return true;
  }

  /** 从 `array` 的 `offset` 处读入 16 元素 (three.js fromArray)。 */
  fromArray(array: ArrayLike<number>, offset = 0): this {
    const te = this.elements;
    for (let i = 0; i < 16; i++) {
      te[i] = array[i + offset];
    }
    return this;
  }
}

/**
 * 写入三维分量:目标有 `.set(x, y, z)`(Vector3 实例)时经 set() 写入,
 * 触发 `_onChangeCallback` —— Object3D 的 _BoundVector3 借此标记脏矩阵;
 * 无 set() 的结构对象(纯 `{x,y,z}`)回退直接写字段。
 * 对齐 three.js Matrix4.decompose 的 `position.set()` / `scale.set()`。
 */
function setVec3Like(
  target: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
): void {
  const set = (target as { set?: (x: number, y: number, z: number) => unknown }).set;
  if (set !== undefined) {
    set.call(target, x, y, z);
  } else {
    target.x = x;
    target.y = y;
    target.z = z;
  }
}

/**
 * 写入四元数分量:目标有 `.set(x, y, z, w)`(Quaternion 实例)时经 set() 写入,
 * 触发 `_onChangeCallback` —— Object3D 的 _BoundQuaternion 借此标记脏矩阵;
 * 无 set() 的结构对象(纯 `{x,y,z,w}`)回退直接写字段。
 * 对齐 three.js Matrix4.decompose 的 `quaternion.setFromRotationMatrix(_m1)`
 * (set 与 setFromRotationMatrix 都会触发 onChange)。
 */
function setQuatLike(
  target: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const set = (target as { set?: (x: number, y: number, z: number, w: number) => unknown }).set;
  if (set !== undefined) {
    set.call(target, x, y, z, w);
  } else {
    target.x = x;
    target.y = y;
    target.z = z;
    target.w = w;
  }
}

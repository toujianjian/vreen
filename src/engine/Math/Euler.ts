// Euler — 欧拉角,用三个轴上的旋转角 + 旋转顺序描述姿态。
// 参考 three.js Euler.js,去掉 EventDispatcher/onChange 回调机制,
// 使用 `import type` 引用 Matrix4/Quaternion 以避免运行时循环依赖。
// 内部存储为公开字段 x/y/z/order,与 VREEN 的 Vector3/Quaternion 风格一致。

import type { Matrix4 } from './Matrix4';
import type { Quaternion } from './Quaternion';
import { clamp } from './MathUtils';

/** Euler 旋转顺序,与 three.js 完全一致。 */
export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';

/** 能够提供 column-major elements 的最小结构,兼容 Matrix4 与纯 number[]。 */
interface MatrixLike {
  elements: ArrayLike<number>;
}

export class Euler {
  /** 默认旋转顺序。 */
  static readonly DEFAULT_ORDER: EulerOrder = 'XYZ';

  x: number;
  y: number;
  z: number;
  order: EulerOrder;

  constructor(x = 0, y = 0, z = 0, order: EulerOrder = Euler.DEFAULT_ORDER) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.order = order;
  }

  set(x: number, y: number, z: number, order: EulerOrder = this.order): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.order = order;
    return this;
  }

  /** 从 Vector3 复制分量设置欧拉角 (three.js Euler.setFromVector3)。 */
  setFromVector3(v: { x: number; y: number; z: number }, order: EulerOrder = this.order): this {
    return this.set(v.x, v.y, v.z, order);
  }

  clone(): Euler {
    return new Euler(this.x, this.y, this.z, this.order);
  }

  copy(e: Euler): this {
    this.x = e.x;
    this.y = e.y;
    this.z = e.z;
    this.order = e.order;
    return this;
  }

  /**
   * 从纯旋转矩阵(左上 3x3)设置欧拉角。
   * `m` 接受 Matrix4 或任意带 `elements: ArrayLike<number>` 的对象。
   * `update` 参数仅为兼容 three.js API,本类无 onChange 回调,实际被忽略。
   */
  setFromRotationMatrix(
    m: Matrix4 | MatrixLike,
    order: EulerOrder = this.order,
    update = true,
  ): this {
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];

    switch (order) {
      case 'XYZ':
        this.y = Math.asin(clamp(m13, -1, 1));
        if (Math.abs(m13) < 0.9999999) {
          this.x = Math.atan2(-m23, m33);
          this.z = Math.atan2(-m12, m11);
        } else {
          this.x = Math.atan2(m32, m22);
          this.z = 0;
        }
        break;
      case 'YXZ':
        this.x = Math.asin(-clamp(m23, -1, 1));
        if (Math.abs(m23) < 0.9999999) {
          this.y = Math.atan2(m13, m33);
          this.z = Math.atan2(m21, m22);
        } else {
          this.y = Math.atan2(-m31, m11);
          this.z = 0;
        }
        break;
      case 'ZXY':
        this.x = Math.asin(clamp(m32, -1, 1));
        if (Math.abs(m32) < 0.9999999) {
          this.y = Math.atan2(-m31, m33);
          this.z = Math.atan2(-m12, m22);
        } else {
          this.y = 0;
          this.z = Math.atan2(m21, m11);
        }
        break;
      case 'ZYX':
        this.y = Math.asin(-clamp(m31, -1, 1));
        if (Math.abs(m31) < 0.9999999) {
          this.x = Math.atan2(m32, m33);
          this.z = Math.atan2(m21, m11);
        } else {
          this.x = 0;
          this.z = Math.atan2(-m12, m22);
        }
        break;
      case 'YZX':
        this.z = Math.asin(clamp(m21, -1, 1));
        if (Math.abs(m21) < 0.9999999) {
          this.x = Math.atan2(-m23, m22);
          this.y = Math.atan2(-m31, m11);
        } else {
          this.x = 0;
          this.y = Math.atan2(m13, m33);
        }
        break;
      case 'XZY':
        this.z = Math.asin(-clamp(m12, -1, 1));
        if (Math.abs(m12) < 0.9999999) {
          this.x = Math.atan2(m32, m22);
          this.y = Math.atan2(m13, m11);
        } else {
          this.x = Math.atan2(-m23, m33);
          this.y = 0;
        }
        break;
      default:
        // 未知顺序保持原值
        break;
    }

    this.order = order;
    void update;
    return this;
  }

  /**
   * 从归一化四元数设置欧拉角。
   * 内联构建旋转矩阵,避免运行时依赖 Matrix4 实例。
   */
  setFromQuaternion(
    q: Quaternion,
    order: EulerOrder = this.order,
    update = true,
  ): this {
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    const elements: number[] = [
      1 - (yy + zz), xy + wz, xz - wy, 0,
      xy - wz, 1 - (xx + zz), yz + wx, 0,
      xz + wy, yz - wx, 1 - (xx + yy), 0,
      0, 0, 0, 1,
    ];
    return this.setFromRotationMatrix({ elements }, order, update);
  }

  /**
   * 改变旋转顺序。先把这个欧拉角转成四元数(内联,支持全部 6 种顺序),
   * 再用新顺序从四元数导出欧拉角。注意:会丢失圈数(revolution)信息。
   */
  reorder(newOrder: EulerOrder): this {
    const x = this.x, y = this.y, z = this.z, order = this.order;
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);

    let qx = 0, qy = 0, qz = 0, qw = 1;
    switch (order) {
      case 'XYZ':
        qx = s1 * c2 * c3 + c1 * s2 * s3;
        qy = c1 * s2 * c3 - s1 * c2 * s3;
        qz = c1 * c2 * s3 + s1 * s2 * c3;
        qw = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'YXZ':
        qx = s1 * c2 * c3 + c1 * s2 * s3;
        qy = c1 * s2 * c3 - s1 * c2 * s3;
        qz = c1 * c2 * s3 - s1 * s2 * c3;
        qw = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case 'ZXY':
        qx = s1 * c2 * c3 - c1 * s2 * s3;
        qy = c1 * s2 * c3 + s1 * c2 * s3;
        qz = c1 * c2 * s3 + s1 * s2 * c3;
        qw = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'ZYX':
        qx = s1 * c2 * c3 - c1 * s2 * s3;
        qy = c1 * s2 * c3 + s1 * c2 * s3;
        qz = c1 * c2 * s3 - s1 * s2 * c3;
        qw = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case 'YZX':
        qx = s1 * c2 * c3 + c1 * s2 * s3;
        qy = c1 * s2 * c3 + s1 * c2 * s3;
        qz = c1 * c2 * s3 - s1 * s2 * c3;
        qw = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'XZY':
        qx = s1 * c2 * c3 - c1 * s2 * s3;
        qy = c1 * s2 * c3 - s1 * c2 * s3;
        qz = c1 * c2 * s3 + s1 * s2 * c3;
        qw = c1 * c2 * c3 + s1 * s2 * s3;
        break;
    }

    return this.setFromQuaternion(
      { x: qx, y: qy, z: qz, w: qw } as Quaternion,
      newOrder,
    );
  }

  equals(e: Euler): boolean {
    return (
      e.x === this.x && e.y === this.y && e.z === this.z && e.order === this.order
    );
  }

  toArray(): [number, number, number, EulerOrder] {
    return [this.x, this.y, this.z, this.order];
  }

  fromArray(a: [number, number, number, EulerOrder]): this {
    this.x = a[0];
    this.y = a[1];
    this.z = a[2];
    this.order = a[3];
    return this;
  }
}

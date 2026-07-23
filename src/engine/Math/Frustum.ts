// Frustum — 视锥体,用于 Frustum culling(Phase 2.2.1)。
//
// 从 viewProjection 矩阵提取 6 个裁剪平面(left/right/bottom/top/near/far),
// 每个 plane 用 (normal, constant) 表示,满足 plane.dot(point) >= 0 时点在
// 平面内侧(视锥体内)。球体相交测试:球心到每个平面有符号距离 >= -radius
// 则球与视锥体相交(可能在内部或跨越平面)。
//
// 矩阵约定:column-major(Matrix4.elements),与 WebGL uniformMatrix4fv 一致。
// viewProjection = projection * view = projection * matrixWorldInverse(camera)。
//
// 平面提取公式(Gribb-Hartmann 方法,列主序):
//   设 m = viewProjection.elements (column-major),
//   plane_left   = (m[3] + m[0], m[7] + m[4], m[11] + m[8],  m[15] + m[12])
//   plane_right  = (m[3] - m[0], m[7] - m[4], m[11] - m[8],  m[15] - m[12])
//   plane_bottom = (m[3] + m[1], m[7] + m[5], m[11] + m[9],  m[15] + m[13])
//   plane_top    = (m[3] - m[1], m[7] - m[5], m[11] - m[9],  m[15] - m[13])
//   plane_near   = (m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14])
//   plane_far    = (m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14])
// 其中 column-major 下 m[i*4 + col] 不对 —— 直接用展开索引:
//   col0 = m[0..3], col1 = m[4..7], col2 = m[8..11], col3 = m[12..15]
//   row r 的元素 = m[r + col*4]
//   所以 plane_left = row0+m_col0... 即 (m[3]+m[0]) 对应 row3+row0 的 col0。
//   上面的公式中 m[k] 就是 column-major 线性索引,直接套用即可。

import { Matrix4 } from './Matrix4';
import { Vector3 } from './Vector3';
import { Plane } from './Plane';

// 重新导出 Plane,保持 index.ts 的 `export { type Plane } from './Frustum'` 仍可用。
// 旧的 `interface Plane` 已被 `class Plane` 替代,Frustum 内部 6 个裁剪平面
// 现在使用 Plane 实例(normal + constant 仍可读写,API 完全兼容)。
export { Plane };

/** 6 平面视锥体。顺序: left, right, bottom, top, near, far。 */
export class Frustum {
  readonly planes: Plane[] = [
    new Plane(),
    new Plane(),
    new Plane(),
    new Plane(),
    new Plane(),
    new Plane(),
  ];

  /** 从 viewProjection 矩阵(column-major)提取 6 平面。返回 this。 */
  setFromViewProjectionMatrix(m: Matrix4): this {
    const e = m.elements;
    // column-major: col c 的第 r 行 = e[r + c*4]
    // row0 = e[0],e[4],e[8],e[12]; row1 = e[1],e[5],e[9],e[13]; ...
    // Gribb-Hartmann: plane_i = row3 ± row_i_axis
    //   left   = row3 + col0 → (e[3]+e[0], e[7]+e[4], e[11]+e[8],  e[15]+e[12])
    //   right  = row3 - col0
    //   bottom = row3 + col1
    //   top    = row3 - col1
    //   near   = row3 + col2
    //   far    = row3 - col2
    this._setPlane(0, e[3] + e[0], e[7] + e[4], e[11] + e[8],  e[15] + e[12]);
    this._setPlane(1, e[3] - e[0], e[7] - e[4], e[11] - e[8],  e[15] - e[12]);
    this._setPlane(2, e[3] + e[1], e[7] + e[5], e[11] + e[9],  e[15] + e[13]);
    this._setPlane(3, e[3] - e[1], e[7] - e[5], e[11] - e[9],  e[15] - e[13]);
    this._setPlane(4, e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]);
    this._setPlane(5, e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]);
    return this;
  }

  /** 归一化平面(normal 单位化,constant 等比缩放)。 */
  private _setPlane(i: number, a: number, b: number, c: number, d: number): void {
    const plane = this.planes[i];
    const len = Math.hypot(a, b, c);
    if (len === 0) {
      plane.normal.set(0, 0, 0);
      plane.constant = 0;
      return;
    }
    const inv = 1 / len;
    plane.normal.set(a * inv, b * inv, c * inv);
    plane.constant = d * inv;
  }

  /** 点是否在视锥体内(所有平面内侧)。 */
  containsPoint(point: Vector3): boolean {
    for (let i = 0; i < 6; i++) {
      const p = this.planes[i];
      // signed distance = normal·point + constant
      if (p.normal.dot(point) + p.constant < 0) return false;
    }
    return true;
  }

  /** 球体是否与视锥体相交(可能在内部、跨越、或完全包含)。
   *  center + radius 表示世界空间球。 */
  intersectsSphere(center: Vector3, radius: number): boolean {
    for (let i = 0; i < 6; i++) {
      const p = this.planes[i];
      const dist = p.normal.dot(center) + p.constant;
      // 球心在平面外侧且距离 > radius → 完全在外 → 不相交
      if (dist < -radius) return false;
    }
    return true;
  }

  /** 球体是否完全在视锥体内(严格内含,用于 conservative culling 细分)。 */
  containsSphere(center: Vector3, radius: number): boolean {
    for (let i = 0; i < 6; i++) {
      const p = this.planes[i];
      const dist = p.normal.dot(center) + p.constant;
      if (dist < radius) return false; // 球触碰/跨越平面 → 不完全在内
    }
    return true;
  }
}

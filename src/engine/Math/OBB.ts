// OBB — Oriented Bounding Box (有向包围盒)。
//
// 适配 three.js `examples/jsm/math/OBB.js` (r169) 并扩展。
// 与轴对齐包围盒 (Box3) 不同,OBB 的三轴可任意旋转,因此对斜置物体
// (如倒下的柱子、旋转的载具) 包裹更紧致,减少错误剔除与碰撞误报。
//
// 表示:
//   center   — 盒中心 (世界坐标)
//   halfSize — 半边长 (x=半宽, y=半高, z=半深),均为非负
//   rotation — 3×3 正交矩阵,列向量为盒的三个局部轴 (右/上/前)
//
// 不变量:
//   - rotation 的三列应为单位正交向量 (用户负责,构造时不验证);
//   - halfSize 各分量 ≥ 0;
//   - 所有 intersect 方法不修改参与方;
//   - fromBox3 生成的 OBB 旋转为单位矩阵 (与 AABB 等价)。
//
// 参考:
//   - Ericson, C. "Real-Time Collision Detection" ch. 4 (OBB-OBB SAT)
//   - three.js examples/jsm/math/OBB.js
//   - Schneider & Eberly "Geometric Tools for Computer Graphics"

import { Vector3 } from './Vector3';
import { Matrix3 } from './Matrix3';
import { Box3 } from './Box3';
import { Sphere } from './Sphere';
import { Ray } from './Ray';
import { Plane } from './Plane';

// 复用的临时向量 (避免在 SAT 循环中反复分配)
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

/**
 * 有向包围盒。
 *
 * ```ts
 * const obb = new OBB(
 *   new Vector3(0, 0, 0),       // center
 *   new Vector3(1, 2, 0.5),     // halfSize (半边长)
 *   new Matrix3(),               // rotation (identity = AABB)
 * );
 * obb.intersectsSphere(sphere);
 * obb.intersectsOBB(otherOBB);
 * ```
 */
export class OBB {
  /** 盒中心 (世界坐标)。 */
  center: Vector3;
  /** 半边长 (x=半宽, y=半高, z=半深),各分量 ≥ 0。 */
  halfSize: Vector3;
  /** 3×3 旋转矩阵,列向量为盒的三个局部轴。单位矩阵 = 轴对齐。 */
  rotation: Matrix3;

  constructor(
    center = new Vector3(),
    halfSize = new Vector3(1, 1, 1),
    rotation = new Matrix3(),
  ) {
    this.center = center;
    this.halfSize = halfSize;
    this.rotation = rotation;
  }

  /** 全字段设置 (链式)。 */
  set(center: Vector3, halfSize: Vector3, rotation: Matrix3): this {
    this.center.copy(center);
    this.halfSize.copy(halfSize);
    this.rotation.copy(rotation);
    return this;
  }

  copy(obb: OBB): this {
    this.center.copy(obb.center);
    this.halfSize.copy(obb.halfSize);
    this.rotation.copy(obb.rotation);
    return this;
  }

  clone(): OBB {
    return new OBB().copy(this);
  }

  /** 全尺寸 (非半边长),写入 target。 */
  getSize(target: Vector3): Vector3 {
    return target.copy(this.halfSize).multiplyScalar(2);
  }

  /**
   * 计算轴对齐包围盒 (AABB),写入 target。
   * 遍历 OBB 的 8 个角点取 min/max。
   */
  computeBoundingBox(target: Box3): Box3 {
    const c = this.center;
    const hs = this.halfSize;
    const r = this.rotation;
    const re = r.elements;

    // 8 角点 = center ± hs.x*col0 ± hs.y*col1 ± hs.z*col2
    // col_i = (re[3i], re[3i+1], re[3i+2])
    const hx = hs.x, hy = hs.y, hz = hs.z;
    const c0x = re[0] * hx, c0y = re[1] * hx, c0z = re[2] * hx;
    const c1x = re[3] * hy, c1y = re[4] * hy, c1z = re[5] * hy;
    const c2x = re[6] * hz, c2y = re[7] * hz, c2z = re[8] * hz;

    // 对 8 种符号组合取 min/max
    const signs = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
    ];

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const [sx, sy, sz] of signs) {
      const px = c.x + sx * c0x + sy * c1x + sz * c2x;
      const py = c.y + sx * c0y + sy * c1y + sz * c2y;
      const pz = c.z + sx * c0z + sy * c1z + sz * c2z;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;
    }

    target.min.set(minX, minY, minZ);
    target.max.set(maxX, maxY, maxZ);
    return target;
  }

  /** 从 AABB 构造 OBB (rotation = identity)。 */
  fromBox3(box: Box3): this {
    box.getCenter(this.center);
    box.getSize(this.halfSize).multiplyScalar(0.5);
    this.rotation.identity();
    return this;
  }

  /** 判空:任一半边长 ≤ 0。 */
  isEmpty(): boolean {
    return this.halfSize.x <= 0 || this.halfSize.y <= 0 || this.halfSize.z <= 0;
  }

  /**
   * 点是否在 OBB 内。
   * 把点变换到 OBB 局部坐标系 (p' = R^T · (p - center)),再检查 |p'.i| ≤ hs.i。
   */
  containsPoint(point: Vector3): boolean {
    _v1.subVectors(point, this.center);
    // 应用 R^T (逆转置=逆,因 R 正交)
    _v1.applyMatrix3(this._invRotation());
    return (
      Math.abs(_v1.x) <= this.halfSize.x &&
      Math.abs(_v1.y) <= this.halfSize.y &&
      Math.abs(_v1.z) <= this.halfSize.z
    );
  }

  /** 是否完全包含另一个 OBB (检查 8 角点)。 */
  containsBox(obb: OBB): boolean {
    const obbCorners = obb._getCorners();
    for (const c of obbCorners) {
      if (!this.containsPoint(c)) return false;
    }
    return true;
  }

  /**
   * 与球相交测试。
   * 把球心变换到 OBB 局部坐标系,计算到盒的最近点,比较距离平方与半径平方。
   */
  intersectsSphere(sphere: Sphere): boolean {
    // 局部坐标球心
    _v1.subVectors(sphere.center, this.center);
    _v1.applyMatrix3(this._invRotation());

    // 最近点:clamp 到 [-hs, +hs]
    _v2.set(
      Math.max(-this.halfSize.x, Math.min(this.halfSize.x, _v1.x)),
      Math.max(-this.halfSize.y, Math.min(this.halfSize.y, _v1.y)),
      Math.max(-this.halfSize.z, Math.min(this.halfSize.z, _v1.z)),
    );

    // 局部距离 (因旋转正交,长度不变)
    const dx = _v1.x - _v2.x;
    const dy = _v1.y - _v2.y;
    const dz = _v1.z - _v2.z;
    return dx * dx + dy * dy + dz * dz <= sphere.radius * sphere.radius;
  }

  /**
   * 与 AABB 相交测试。
   * 把 AABB 看作 rotation=identity 的 OBB,复用 OBB-OBB SAT。
   */
  intersectsBox3(box: Box3): boolean {
    const obb2 = _tmpOBB.fromBox3(box);
    return this.intersectsOBB(obb2);
  }

  /**
   * 与平面相交测试。
   * 把 OBB 8 角点投影到平面法线,检查是否有正负跨越 (或都在面上)。
   */
  intersectsPlane(plane: Plane): boolean {
    // OBB 在法线方向的有效半径 = Σ hs.i · |col_i · normal|
    const n = plane.normal;
    const re = this.rotation.elements;
    const effectiveRadius =
      this.halfSize.x * Math.abs(re[0] * n.x + re[1] * n.y + re[2] * n.z) +
      this.halfSize.y * Math.abs(re[3] * n.x + re[4] * n.y + re[5] * n.z) +
      this.halfSize.z * Math.abs(re[6] * n.x + re[7] * n.y + re[8] * n.z);

    // 中心到平面的有符号距离
    const centerDist = plane.distanceToPoint(this.center);
    return Math.abs(centerDist) <= effectiveRadius;
  }

  /**
   * 与另一个 OBB 相交测试 (SAT — 分离轴定理)。
   * 检查 15 条候选轴:A 的 3 面法线 + B 的 3 面法线 + 9 条叉积。
   * 若任一轴上投影区间不重叠,则不相交。
   *
   * 参考: Ericson "RTCD" 4.4.4, three.js OBB.js
   */
  intersectsOBB(obb: OBB, epsilon = 1e-10): boolean {
    const a = this;
    const b = obb;

    // A 的局部轴 (rotation 的列)
    const ae = a.rotation.elements;
    const aAxisX = _aAxisX.set(ae[0], ae[1], ae[2]);
    const aAxisY = _aAxisY.set(ae[3], ae[4], ae[5]);
    const aAxisZ = _aAxisZ.set(ae[6], ae[7], ae[8]);

    // B 的局部轴
    const be = b.rotation.elements;
    const bAxisX = _bAxisX.set(be[0], be[1], be[2]);
    const bAxisY = _bAxisY.set(be[3], be[4], be[5]);
    const bAxisZ = _bAxisZ.set(be[6], be[7], be[8]);

    // 平移向量 (A → B)
    _v3.subVectors(b.center, a.center);

    // A 与 B 的旋转点积矩阵 R[i][j] = aAxis[i] · bAxis[j]
    const r00 = aAxisX.dot(bAxisX);
    const r01 = aAxisX.dot(bAxisY);
    const r02 = aAxisX.dot(bAxisZ);
    const r10 = aAxisY.dot(bAxisX);
    const r11 = aAxisY.dot(bAxisY);
    const r12 = aAxisY.dot(bAxisZ);
    const r20 = aAxisZ.dot(bAxisX);
    const r21 = aAxisZ.dot(bAxisY);
    const r22 = aAxisZ.dot(bAxisZ);

    // A 的投影半径
    const aHs = a.halfSize;
    const bHs = b.halfSize;

    // 平移在 A 局部坐标系的分量
    const t0 = _v3.dot(aAxisX);
    const t1 = _v3.dot(aAxisY);
    const t2 = _v3.dot(aAxisZ);

    // --- 测试 A 的 3 条面法线 ---
    // |t·a_i| > aHs[i] + Σ_j bHs[j] |R[i][j]|
    if (Math.abs(t0) > aHs.x + bHs.x * Math.abs(r00) + bHs.y * Math.abs(r01) + bHs.z * Math.abs(r02)) return false;
    if (Math.abs(t1) > aHs.y + bHs.x * Math.abs(r10) + bHs.y * Math.abs(r11) + bHs.z * Math.abs(r12)) return false;
    if (Math.abs(t2) > aHs.z + bHs.x * Math.abs(r20) + bHs.y * Math.abs(r21) + bHs.z * Math.abs(r22)) return false;

    // --- 测试 B 的 3 条面法线 ---
    // |t·b_j| > bHs[j] + Σ_i aHs[i] |R[i][j]|
    const tb0 = _v3.dot(bAxisX);
    const tb1 = _v3.dot(bAxisY);
    const tb2 = _v3.dot(bAxisZ);

    if (Math.abs(tb0) > bHs.x + aHs.x * Math.abs(r00) + aHs.y * Math.abs(r10) + aHs.z * Math.abs(r20)) return false;
    if (Math.abs(tb1) > bHs.y + aHs.x * Math.abs(r01) + aHs.y * Math.abs(r11) + aHs.z * Math.abs(r21)) return false;
    if (Math.abs(tb2) > bHs.z + aHs.x * Math.abs(r02) + aHs.y * Math.abs(r12) + aHs.z * Math.abs(r22)) return false;

    // --- 测试 9 条叉积轴 a_i × b_j ---
    // 对每条轴,计算 A 与 B 的投影半径 (表达式中含 R 分量与 t 分量)
    // 公式来自 Ericson RTCD 4.4.4

    // a0 × b0
    if (Math.abs(t2 * r10 - t1 * r20) > aHs.y * Math.abs(r20) + aHs.z * Math.abs(r10) + bHs.y * Math.abs(r02) + bHs.z * Math.abs(r01) + epsilon) return false;
    // a0 × b1
    if (Math.abs(t2 * r11 - t1 * r21) > aHs.y * Math.abs(r21) + aHs.z * Math.abs(r11) + bHs.x * Math.abs(r02) + bHs.z * Math.abs(r00) + epsilon) return false;
    // a0 × b2
    if (Math.abs(t2 * r12 - t1 * r22) > aHs.y * Math.abs(r22) + aHs.z * Math.abs(r12) + bHs.x * Math.abs(r01) + bHs.y * Math.abs(r00) + epsilon) return false;

    // a1 × b0
    if (Math.abs(t0 * r20 - t2 * r00) > aHs.x * Math.abs(r20) + aHs.z * Math.abs(r00) + bHs.y * Math.abs(r12) + bHs.z * Math.abs(r11) + epsilon) return false;
    // a1 × b1
    if (Math.abs(t0 * r21 - t2 * r01) > aHs.x * Math.abs(r21) + aHs.z * Math.abs(r01) + bHs.x * Math.abs(r12) + bHs.z * Math.abs(r10) + epsilon) return false;
    // a1 × b2
    if (Math.abs(t0 * r22 - t2 * r02) > aHs.x * Math.abs(r22) + aHs.z * Math.abs(r02) + bHs.x * Math.abs(r11) + bHs.y * Math.abs(r10) + epsilon) return false;

    // a2 × b0
    if (Math.abs(t1 * r00 - t0 * r10) > aHs.x * Math.abs(r10) + aHs.y * Math.abs(r00) + bHs.y * Math.abs(r22) + bHs.z * Math.abs(r21) + epsilon) return false;
    // a2 × b1
    if (Math.abs(t1 * r01 - t0 * r11) > aHs.x * Math.abs(r11) + aHs.y * Math.abs(r01) + bHs.x * Math.abs(r22) + bHs.z * Math.abs(r20) + epsilon) return false;
    // a2 × b2
    if (Math.abs(t1 * r02 - t0 * r12) > aHs.x * Math.abs(r12) + aHs.y * Math.abs(r02) + bHs.x * Math.abs(r21) + bHs.y * Math.abs(r20) + epsilon) return false;

    return true;
  }

  /**
   * 射线-OBB 相交测试 (Slab 法,在 OBB 局部坐标系中)。
   * 返回最近交点的参数 t (≥0),或 null 表示不相交。
   */
  intersectsRay(ray: Ray, target?: Vector3): number | null {
    // 把射线变换到 OBB 局部坐标系
    const invR = this._invRotation();
    _v1.subVectors(ray.origin, this.center).applyMatrix3(invR);
    _v2.copy(ray.direction).applyMatrix3(invR);

    // 局部 Slab 法
    let tMin = -Infinity;
    let tMax = +Infinity;
    const hs = this.halfSize;

    for (let i = 0; i < 3; i++) {
      const d = i === 0 ? _v2.x : i === 1 ? _v2.y : _v2.z;
      const o = i === 0 ? _v1.x : i === 1 ? _v1.y : _v1.z;
      const h = i === 0 ? hs.x : i === 1 ? hs.y : hs.z;

      if (Math.abs(d) < 1e-10) {
        // 射线与 slab 平行:原点必须在 slab 内
        if (Math.abs(o) > h) return null;
      } else {
        const invD = 1 / d;
        let t1 = (-h - o) * invD;
        let t2 = (h - o) * invD;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
      }
    }

    // tMin < 0 表示射线起点在盒内 (或盒在射线后方)
    const t = tMin >= 0 ? tMin : tMax;
    if (t < 0) return null; // 交点在射线后方

    if (target) {
      ray.at(t, target);
    }
    return t;
  }

  /**
   * 对 OBB 应用 4×4 变换矩阵 (旋转/缩放/平移)。
   * center 应用完整 4×4;rotation 应用左上 3×3;halfSize 缩放。
   */
  applyMatrix4(matrix: { elements: Float32Array | number[] }): this {
    const me = matrix.elements as number[];
    // 提取 3×3 部分
    _m3.set(
      me[0], me[4], me[8],
      me[1], me[5], me[9],
      me[2], me[6], me[10],
    );
    // center = M * center
    this.center.applyMatrix4(matrix);
    // rotation = M3 * rotation
    this.rotation.premultiply(_m3);
    // halfSize: 取 3×3 各列长度作为缩放
    const sx = Math.hypot(me[0], me[1], me[2]);
    const sy = Math.hypot(me[4], me[5], me[6]);
    const sz = Math.hypot(me[8], me[9], me[10]);
    this.halfSize.x *= sx;
    this.halfSize.y *= sy;
    this.halfSize.z *= sz;
    return this;
  }

  /** 平移 OBB 中心。 */
  translate(offset: Vector3): this {
    this.center.add(offset);
    return this;
  }

  /** 值相等比较。 */
  equals(obb: OBB): boolean {
    return (
      this.center.equals(obb.center) &&
      this.halfSize.equals(obb.halfSize) &&
      this.rotation.equals(obb.rotation)
    );
  }

  // ── 内部辅助 ──────────────────────────────────────────────────

  /** 返回 R^T (旋转矩阵的逆 = 转置,因 R 正交)。每次调用会复用 _invR 缓存。 */
  private _invRotation(): Matrix3 {
    _invR.copy(this.rotation).invert();
    return _invR;
  }

  /** 计算 8 个角点 (世界坐标),返回复用数组。 */
  private _getCorners(): Vector3[] {
    const c = this.center;
    const hs = this.halfSize;
    const re = this.rotation.elements;
    const hx = hs.x, hy = hs.y, hz = hs.z;
    const c0x = re[0] * hx, c0y = re[1] * hx, c0z = re[2] * hx;
    const c1x = re[3] * hy, c1y = re[4] * hy, c1z = re[5] * hy;
    const c2x = re[6] * hz, c2y = re[7] * hz, c2z = re[8] * hz;

    const signs = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
    ];

    for (let i = 0; i < 8; i++) {
      const [sx, sy, sz] = signs[i];
      _corners[i].set(
        c.x + sx * c0x + sy * c1x + sz * c2x,
        c.y + sx * c0y + sy * c1y + sz * c2y,
        c.z + sx * c0z + sy * c1z + sz * c2z,
      );
    }
    return _corners;
  }
}

// 复用的临时对象 (模块级,避免每次调用分配)
const _invR = new Matrix3();
const _m3 = new Matrix3();
const _tmpOBB = new OBB();
const _corners: Vector3[] = Array.from({ length: 8 }, () => new Vector3());
const _aAxisX = new Vector3();
const _aAxisY = new Vector3();
const _aAxisZ = new Vector3();
const _bAxisX = new Vector3();
const _bAxisY = new Vector3();
const _bAxisZ = new Vector3();

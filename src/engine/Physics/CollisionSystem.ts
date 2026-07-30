// CollisionSystem — 碰撞检测系统 (BVH + SAT + GJK + EPA)。
//
// 设计:
//   * Collider 用扁平数据描述 (id/type/position/rotation/scale/data/isTrigger),
//     与具体物理后端解耦,便于编辑器拾取 / 触发器 / 射线检测复用。
//   * 三段式管线: update(dt) = 宽相 (候选对) → 窄相 (精确求交) → 接触流形。
//   * 宽相: bruteforce (O(n²) AABB) / sweep (排序扫描) / bvh (层次包围盒)。
//   * 窄相: sat (分离轴,球/盒精确,其余回退 EPA) / gjk (Minkowski 差,仅判交) /
//     epa (GJK + EPA 扩展,给出精确穿透深度与法线)。
//   * 特化快速路径: testSphereSphere / testSphereBox / testBoxBox (SAT OBB-OBB),
//     比通用 GJK 更快且数值更稳;窄相入口会优先走快速路径。
//   * testRaycast 支持球/盒/胶囊/凸包/网格,返回最近命中 (point/normal/distance)。
//
// 说明:
//   * manifold.normal 约定从 colliderA 指向 colliderB (即 B 相对 A 的方向)。
//   * 凸包/网格碰撞器在窄相走 GJK/EPA 时,网格被视为顶点的凸包 (非凸网格的凹腔
//     会被忽略);射线检测对网格做逐三角形精确求交。

import { Vector3 } from '../Math/Vector3';
import type { Quaternion } from '../Math/Quaternion';

/** 碰撞器类型。 */
export type ColliderType = 'sphere' | 'box' | 'capsule' | 'convex' | 'mesh';

/** 宽相算法。 */
export type BroadphaseType = 'bruteforce' | 'sweep' | 'bvh';

/** 窄相算法。 */
export type NarrowphaseType = 'sat' | 'gjk' | 'epa';

/** AABB (轴对齐包围盒)。 */
export interface AABB {
  min: Vector3;
  max: Vector3;
}

/** 碰撞器。 */
export interface Collider {
  /** 唯一 id (由 registerCollider 时确定)。 */
  id: number;
  /** 形状类型。 */
  type: ColliderType;
  /** 世界位置。 */
  position: Vector3;
  /** 世界旋转。 */
  rotation: Quaternion;
  /** 缩放 (本地→世界)。 */
  scale: Vector3;
  /** 形状数据:
   *  - sphere:  { radius: number }
   *  - box:     { halfExtents: Vector3 }
   *  - capsule: { radius: number, height: number } (height 为圆柱段长度,沿本地 Y)
   *  - convex:  { vertices: Vector3[] }
   *  - mesh:    { vertices: number[] | Float32Array, indices?: number[] }
   */
  data: any;
  /** 是否为触发器 (触发器仅产生流形,不参与物理响应;本系统不区分,统一上报)。 */
  isTrigger: boolean;
}

/** 接触点。 */
export interface ContactPoint {
  /** 世界空间接触点。 */
  point: Vector3;
  /** 接触法线 (A→B)。 */
  normal: Vector3;
  /** 穿透深度 (>=0)。 */
  depth: number;
}

/** 接触流形 (一对碰撞器的全部接触点)。 */
export interface ContactManifold {
  colliderA: Collider;
  colliderB: Collider;
  contacts: ContactPoint[];
  /** 主接触法线 (A→B)。 */
  normal: Vector3;
  /** 最大穿透深度。 */
  depth: number;
}

/** BVH 节点。 */
export interface BVHNode {
  bounds: AABB;
  left: BVHNode | null;
  right: BVHNode | null;
  /** 叶子节点的碰撞器 id;内部节点为 null。 */
  colliderId: number | null;
}

/** 射线命中结果。 */
export interface RaycastHit {
  colliderId: number;
  point: Vector3;
  normal: Vector3;
  distance: number;
}

/** 系统统计。 */
export interface CollisionStats {
  colliderCount: number;
  broadphase: BroadphaseType;
  narrowphase: NarrowphaseType;
  /** 上次 update 的宽相候选对数。 */
  candidatePairs: number;
  contactCount: number;
  bvhDepth: number;
  bvhNodes: number;
}

/** (a × b) × c。 */
function tripleCross(a: Vector3, b: Vector3, c: Vector3, out: Vector3): Vector3 {
  // out = (a × b) × c
  const ab = new Vector3().copy(a).cross(b);
  return out.copy(ab).cross(c);
}

/**
 * 碰撞检测系统。
 *
 * 用法:
 *   const sys = new CollisionSystem();
 *   sys.registerCollider(1, { id: 1, type: 'sphere', position: new Vector3(),
 *     rotation: new Quaternion(), scale: new Vector3(1,1,1), data: { radius: 1 }, isTrigger: false });
 *   sys.setBroadphase('bvh');
 *   sys.setNarrowphase('epa');
 *   sys.update(1/60);
 *   const manifolds = sys.getContactManifolds();
 */
export class CollisionSystem {
  /** 注册的碰撞器 (id → collider)。 */
  colliders: Map<number, Collider> = new Map();
  /** 宽相算法。 */
  broadphase: BroadphaseType = 'bruteforce';
  /** 窄相算法。 */
  narrowphase: NarrowphaseType = 'sat';
  /** BVH 根节点 (bvh 宽相用,lazy 构建)。 */
  bvh: BVHNode | null = null;
  /** 当前帧接触流形。 */
  contactManifolds: ContactManifold[] = [];

  private lastCandidatePairs: number = 0;

  // ---- 碰撞器管理 -----------------------------------------------------

  /** 注册碰撞器 (会用传入 id 覆盖 collider.id,并失效 BVH 缓存)。 */
  registerCollider(id: number, collider: Collider): void {
    collider.id = id;
    this.colliders.set(id, collider);
    this.bvh = null;
  }

  /** 注销碰撞器。 */
  unregisterCollider(id: number): void {
    this.colliders.delete(id);
    this.bvh = null;
  }

  /** 获取碰撞器。 */
  getCollider(id: number): Collider | undefined {
    return this.colliders.get(id);
  }

  /** 获取所有碰撞器。 */
  getColliders(): Collider[] {
    return Array.from(this.colliders.values());
  }

  // ---- 配置 -----------------------------------------------------------

  /** 设置宽相算法。 */
  setBroadphase(type: BroadphaseType): void {
    this.broadphase = type;
  }

  /** 设置窄相算法。 */
  setNarrowphase(type: NarrowphaseType): void {
    this.narrowphase = type;
  }

  // ---- 主循环 ---------------------------------------------------------

  /** 每帧更新:清空接触 → 宽相候选对 → 窄相求交 → 累积流形。 */
  update(_dt: number): void {
    this.clearContacts();
    if (this.broadphase === 'bvh') this.buildBVH();
    const pairs = this.broadphasePairs();
    this.lastCandidatePairs = pairs.length;
    for (const [idA, idB] of pairs) {
      const a = this.colliders.get(idA);
      const b = this.colliders.get(idB);
      if (!a || !b) continue;
      const manifold = this.runNarrowphase(a, b);
      if (manifold) this.contactManifolds.push(manifold);
    }
  }

  private broadphasePairs(): [number, number][] {
    switch (this.broadphase) {
      case 'bruteforce': return this.broadphaseBruteForce();
      case 'sweep': return this.broadphaseSweep();
      case 'bvh': return this.broadphaseBVH();
    }
  }

  private runNarrowphase(a: Collider, b: Collider): ContactManifold | null {
    switch (this.narrowphase) {
      case 'sat': return this.narrowphaseSAT(a, b);
      case 'gjk': return this.narrowphaseGJK(a, b);
      case 'epa': return this.narrowphaseEPA(a, b);
    }
  }

  // ---- 宽相 -----------------------------------------------------------

  /** 暴力宽相:O(n²) AABB 两两测试。 */
  broadphaseBruteForce(): [number, number][] {
    const pairs: [number, number][] = [];
    const ids = Array.from(this.colliders.keys());
    const aabbs = new Map<number, AABB>();
    for (const id of ids) aabbs.set(id, this.computeAABB(this.colliders.get(id)!));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (this.aabbOverlap(aabbs.get(ids[i])!, aabbs.get(ids[j])!)) {
          pairs.push([ids[i], ids[j]]);
        }
      }
    }
    return pairs;
  }

  /** 扫掠宽相:按 min.x 排序后单轴扫描。 */
  broadphaseSweep(): [number, number][] {
    const pairs: [number, number][] = [];
    const ids = Array.from(this.colliders.keys());
    if (ids.length === 0) return pairs;
    const aabbs = new Map<number, AABB>();
    for (const id of ids) aabbs.set(id, this.computeAABB(this.colliders.get(id)!));
    ids.sort((a, b) => aabbs.get(a)!.min.x - aabbs.get(b)!.min.x);
    for (let i = 0; i < ids.length; i++) {
      const aabbI = aabbs.get(ids[i])!;
      for (let j = i + 1; j < ids.length; j++) {
        const aabbJ = aabbs.get(ids[j])!;
        if (aabbJ.min.x > aabbI.max.x) break; // 后续更远,不再可能重叠
        if (this.aabbOverlap(aabbI, aabbJ)) pairs.push([ids[i], ids[j]]);
      }
    }
    return pairs;
  }

  /** BVH 宽相:对每个碰撞器查询 BVH,收集重叠叶子对。 */
  broadphaseBVH(): [number, number][] {
    const pairs: [number, number][] = [];
    if (!this.bvh) return pairs;
    const ids = Array.from(this.colliders.keys());
    for (const id of ids) {
      const aabb = this.computeAABB(this.colliders.get(id)!);
      const hits = this.queryBVH(this.bvh, aabb);
      for (const hitId of hits) {
        if (hitId > id) pairs.push([id, hitId]); // 去重:只保留 id 小的在前
      }
    }
    return pairs;
  }

  /** 构建 BVH (按最长轴中位数递归划分)。 */
  buildBVH(): BVHNode | null {
    const ids = Array.from(this.colliders.keys());
    if (ids.length === 0) {
      this.bvh = null;
      return null;
    }
    this.bvh = this.buildBVHRecursive(ids);
    return this.bvh;
  }

  private buildBVHRecursive(ids: number[]): BVHNode {
    const bounds = this.computeBoundsForIds(ids);
    if (ids.length === 1) {
      return { bounds, left: null, right: null, colliderId: ids[0] };
    }
    const sx = bounds.max.x - bounds.min.x;
    const sy = bounds.max.y - bounds.min.y;
    const sz = bounds.max.z - bounds.min.z;
    const axis = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
    const sorted = ids.slice().sort((a, b) =>
      this.colliderCenterAxis(a, axis) - this.colliderCenterAxis(b, axis),
    );
    const mid = Math.floor(sorted.length / 2);
    const left = this.buildBVHRecursive(sorted.slice(0, mid));
    const right = this.buildBVHRecursive(sorted.slice(mid));
    return { bounds, left, right, colliderId: null };
  }

  private queryBVH(node: BVHNode | null, aabb: AABB): number[] {
    if (!node) return [];
    if (!this.aabbOverlap(node.bounds, aabb)) return [];
    if (node.colliderId !== null) return [node.colliderId];
    const result: number[] = [];
    result.push(...this.queryBVH(node.left, aabb));
    result.push(...this.queryBVH(node.right, aabb));
    return result;
  }

  private bvhStats(node: BVHNode | null, depth: number): { depth: number; nodes: number } {
    if (!node) return { depth: 0, nodes: 0 };
    if (node.colliderId !== null) return { depth: depth + 1, nodes: 1 };
    const l = this.bvhStats(node.left, depth + 1);
    const r = this.bvhStats(node.right, depth + 1);
    return { depth: Math.max(l.depth, r.depth), nodes: l.nodes + r.nodes + 1 };
  }

  // ---- 窄相入口 -------------------------------------------------------

  /**
   * SAT 窄相:球/盒走特化精确路径,其余 (capsule/convex/mesh) 回退到 EPA。
   * SAT 对非多胞体 (球/胶囊) 不直接适用,故回退。
   */
  narrowphaseSAT(a: Collider, b: Collider): ContactManifold | null {
    if (a.type === 'sphere' && b.type === 'sphere') return this.testSphereSphere(a, b);
    if (a.type === 'sphere' && b.type === 'box') return this.testSphereBox(a, b);
    if (a.type === 'box' && b.type === 'sphere') {
      const m = this.testSphereBox(b, a);
      return m ? this.flipManifold(m) : null;
    }
    if (a.type === 'box' && b.type === 'box') return this.testBoxBox(a, b);
    // 其余组合回退到 EPA (GJK+EPA 通用凸求交)
    return this.narrowphaseEPA(a, b);
  }

  /**
   * GJK 窄相:球/盒走特化精确路径,其余用 GJK 判交。
   * GJK 只判定是否重叠,不能给出穿透深度 (返回 depth=0,法线用质心方向近似)。
   */
  narrowphaseGJK(a: Collider, b: Collider): ContactManifold | null {
    if (a.type === 'sphere' && b.type === 'sphere') return this.testSphereSphere(a, b);
    if (a.type === 'sphere' && b.type === 'box') return this.testSphereBox(a, b);
    if (a.type === 'box' && b.type === 'sphere') {
      const m = this.testSphereBox(b, a);
      return m ? this.flipManifold(m) : null;
    }
    if (a.type === 'box' && b.type === 'box') return this.testBoxBox(a, b);
    const result = this.gjk(a, b);
    if (!result.overlap) return null;
    const normal = new Vector3().subVectors(b.position, a.position);
    if (normal.lengthSq() < 1e-12) normal.set(1, 0, 0);
    else normal.normalize();
    const point = new Vector3().addVectors(a.position, b.position).multiplyScalar(0.5);
    return {
      colliderA: a,
      colliderB: b,
      contacts: [{ point, normal: normal.clone(), depth: 0 }],
      normal,
      depth: 0,
    };
  }

  /**
   * EPA 窄相:球/盒走特化精确路径,其余用 GJK 判交后 EPA 求精确穿透。
   */
  narrowphaseEPA(a: Collider, b: Collider): ContactManifold | null {
    if (a.type === 'sphere' && b.type === 'sphere') return this.testSphereSphere(a, b);
    if (a.type === 'sphere' && b.type === 'box') return this.testSphereBox(a, b);
    if (a.type === 'box' && b.type === 'sphere') {
      const m = this.testSphereBox(b, a);
      return m ? this.flipManifold(m) : null;
    }
    if (a.type === 'box' && b.type === 'box') return this.testBoxBox(a, b);
    const gjk = this.gjk(a, b);
    if (!gjk.overlap) return null;
    const epa = this.epa(a, b, gjk.simplex);
    if (epa) {
      const depth = Math.max(0, epa.depth);
      return {
        colliderA: a,
        colliderB: b,
        contacts: [{ point: epa.point, normal: epa.normal.clone(), depth }],
        normal: epa.normal,
        depth,
      };
    }
    // EPA 未收敛:回退到 GJK 近似
    const normal = new Vector3().subVectors(b.position, a.position);
    if (normal.lengthSq() < 1e-12) normal.set(1, 0, 0);
    else normal.normalize();
    const point = new Vector3().addVectors(a.position, b.position).multiplyScalar(0.5);
    return {
      colliderA: a,
      colliderB: b,
      contacts: [{ point, normal: normal.clone(), depth: 0 }],
      normal,
      depth: 0,
    };
  }

  // ---- 特化碰撞测试 ---------------------------------------------------

  /** 球-球碰撞。 */
  testSphereSphere(a: Collider, b: Collider): ContactManifold | null {
    const ra = this.effectiveRadius(a);
    const rb = this.effectiveRadius(b);
    const delta = new Vector3().subVectors(b.position, a.position); // A→B
    const distSq = delta.lengthSq();
    const rSum = ra + rb;
    if (distSq > rSum * rSum) return null;
    const dist = Math.sqrt(distSq);
    let normal: Vector3;
    let depth: number;
    let point: Vector3;
    if (dist > 1e-9) {
      normal = delta.multiplyScalar(1 / dist);
      depth = rSum - dist;
      point = new Vector3().copy(a.position).addScaledVector(normal, ra);
    } else {
      normal = new Vector3(1, 0, 0);
      depth = rSum;
      point = a.position.clone();
    }
    return {
      colliderA: a,
      colliderB: b,
      contacts: [{ point, normal: normal.clone(), depth }],
      normal,
      depth,
    };
  }

  /** 球-盒碰撞 (OBB)。normal 约定 sphere(A)→box(B)。 */
  testSphereBox(sphere: Collider, box: Collider): ContactManifold | null {
    const r = this.effectiveRadius(sphere);
    const [ax, ay, az] = this.boxWorldAxes(box);
    const he = this.effectiveHalfExtents(box);
    const d = new Vector3().subVectors(sphere.position, box.position); // box→sphere
    const dx = d.dot(ax);
    const dy = d.dot(ay);
    const dz = d.dot(az);
    const cx = Math.max(-he.x, Math.min(he.x, dx));
    const cy = Math.max(-he.y, Math.min(he.y, dy));
    const cz = Math.max(-he.z, Math.min(he.z, dz));
    // box 表面最近点
    const closest = new Vector3()
      .copy(box.position)
      .addScaledVector(ax, cx)
      .addScaledVector(ay, cy)
      .addScaledVector(az, cz);
    // delta = box - sphere (A→B 方向)
    const delta = new Vector3().subVectors(closest, sphere.position);
    const distSq = delta.lengthSq();
    if (distSq > r * r) return null;
    let normal: Vector3;
    let depth: number;
    let point: Vector3;
    if (distSq > 1e-12) {
      const dist = Math.sqrt(distSq);
      normal = delta.multiplyScalar(1 / dist); // sphere→box = A→B
      depth = r - dist;
      point = closest;
    } else {
      // 球心在盒内:选最小穿透轴
      const penX = he.x - Math.abs(dx);
      const penY = he.y - Math.abs(dy);
      const penZ = he.z - Math.abs(dz);
      if (penX <= penY && penX <= penZ) {
        normal = ax.clone().multiplyScalar(dx >= 0 ? 1 : -1);
        depth = penX + r;
      } else if (penY <= penZ) {
        normal = ay.clone().multiplyScalar(dy >= 0 ? 1 : -1);
        depth = penY + r;
      } else {
        normal = az.clone().multiplyScalar(dz >= 0 ? 1 : -1);
        depth = penZ + r;
      }
      point = sphere.position.clone();
    }
    return {
      colliderA: sphere,
      colliderB: box,
      contacts: [{ point, normal: normal.clone(), depth }],
      normal,
      depth,
    };
  }

  /** 盒-盒碰撞 (SAT OBB-OBB,15 轴)。normal 约定 A→B。 */
  testBoxBox(a: Collider, b: Collider): ContactManifold | null {
    const ca = a.position;
    const cb = b.position;
    const [aax, aay, aaz] = this.boxWorldAxes(a);
    const [bax, bay, baz] = this.boxWorldAxes(b);
    const heA = this.effectiveHalfExtents(a);
    const heB = this.effectiveHalfExtents(b);
    const axes: Vector3[] = [aax, aay, aaz, bax, bay, baz];
    const crosses: Vector3[] = [
      new Vector3().copy(aax).cross(bax),
      new Vector3().copy(aax).cross(bay),
      new Vector3().copy(aax).cross(baz),
      new Vector3().copy(aay).cross(bax),
      new Vector3().copy(aay).cross(bay),
      new Vector3().copy(aay).cross(baz),
      new Vector3().copy(aaz).cross(bax),
      new Vector3().copy(aaz).cross(bay),
      new Vector3().copy(aaz).cross(baz),
    ];
    for (const c of crosses) axes.push(c);

    let minOverlap = Infinity;
    let minAxis: Vector3 | null = null;
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      if (axis.lengthSq() < 1e-12) continue; // 退化 (平行) 叉轴
      axis.normalize();
      const rA = heA.x * Math.abs(aax.dot(axis)) + heA.y * Math.abs(aay.dot(axis)) + heA.z * Math.abs(aaz.dot(axis));
      const rB = heB.x * Math.abs(bax.dot(axis)) + heB.y * Math.abs(bay.dot(axis)) + heB.z * Math.abs(baz.dot(axis));
      const d = new Vector3().subVectors(cb, ca).dot(axis);
      const overlap = rA + rB - Math.abs(d);
      if (overlap <= 0) return null; // 找到分离轴
      if (overlap < minOverlap) {
        minOverlap = overlap;
        minAxis = axis.clone();
        if (d < 0) minAxis.negate(); // 保证 A→B 方向
      }
    }
    if (!minAxis) return null;
    const point = new Vector3().addVectors(ca, cb).multiplyScalar(0.5);
    return {
      colliderA: a,
      colliderB: b,
      contacts: [{ point, normal: minAxis.clone(), depth: minOverlap }],
      normal: minAxis,
      depth: minOverlap,
    };
  }

  // ---- GJK / EPA ------------------------------------------------------

  /** Minkowski 和的支撑点: supportA(d) - supportB(-d)。 */
  private minkowskiSupport(a: Collider, b: Collider, d: Vector3): Vector3 {
    const sa = this.support(a, d);
    const negD = new Vector3().copy(d).negate();
    const sb = this.support(b, negD);
    return new Vector3().subVectors(sa, sb);
  }

  /** 碰撞器在方向 d 上的世界空间支撑点。 */
  private support(c: Collider, d: Vector3): Vector3 {
    switch (c.type) {
      case 'sphere': {
        const r = this.effectiveRadius(c);
        const out = new Vector3().copy(d);
        const len = d.length();
        if (len > 1e-9) out.multiplyScalar(r / len); else out.set(0, 0, 0);
        out.add(c.position);
        return out;
      }
      case 'box': {
        const he = this.effectiveHalfExtents(c);
        const local = new Vector3(
          d.x >= 0 ? he.x : -he.x,
          d.y >= 0 ? he.y : -he.y,
          d.z >= 0 ? he.z : -he.z,
        );
        return this.localToWorld(c, local, new Vector3());
      }
      case 'capsule': {
        const r = this.effectiveRadius(c);
        const h = (c.data.height as number) * Math.abs(c.scale.y);
        const top = this.localToWorld(c, new Vector3(0, h / 2, 0), new Vector3());
        const bot = this.localToWorld(c, new Vector3(0, -h / 2, 0), new Vector3());
        const seg = top.dot(d) >= bot.dot(d) ? top : bot;
        const out = new Vector3().copy(d);
        const len = d.length();
        if (len > 1e-9) out.multiplyScalar(r / len); else out.set(0, 0, 0);
        out.add(seg);
        return out;
      }
      case 'convex':
      case 'mesh': {
        const verts = c.data.vertices;
        if (c.type === 'convex') {
          const arr = verts as Vector3[];
          if (arr.length === 0) return c.position.clone();
          let best = this.localToWorld(c, arr[0], new Vector3());
          let bestDot = best.dot(d);
          for (let i = 1; i < arr.length; i++) {
            const w = this.localToWorld(c, arr[i], new Vector3());
            const dot = w.dot(d);
            if (dot > bestDot) { bestDot = dot; best = w; }
          }
          return best;
        } else {
          const arr = verts as number[] | Float32Array;
          const count = Math.floor(arr.length / 3);
          if (count === 0) return c.position.clone();
          const local0 = new Vector3(arr[0], arr[1], arr[2]);
          let best = this.localToWorld(c, local0, new Vector3());
          let bestDot = best.dot(d);
          for (let i = 1; i < count; i++) {
            const local = new Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
            const w = this.localToWorld(c, local, new Vector3());
            const dot = w.dot(d);
            if (dot > bestDot) { bestDot = dot; best = w; }
          }
          return best;
        }
      }
    }
    return c.position.clone();
  }

  /** GJK:判定两碰撞器 (凸) 是否重叠,返回最终单纯形。 */
  private gjk(a: Collider, b: Collider): { overlap: boolean; simplex: Vector3[] } {
    let d = new Vector3().subVectors(b.position, a.position);
    if (d.lengthSq() < 1e-12) d = new Vector3(1, 0, 0);
    const simplex: Vector3[] = [this.minkowskiSupport(a, b, d)];
    d = new Vector3().copy(simplex[0]).multiplyScalar(-1); // 朝原点方向
    const MAX_ITER = 64;
    for (let i = 0; i < MAX_ITER; i++) {
      const s = this.minkowskiSupport(a, b, d);
      if (s.dot(d) < -1e-9) return { overlap: false, simplex: [] };
      // 重复点检查:新支撑点已在单纯形中 → 原点在单纯形内 (无法再扩展)
      let duplicate = false;
      for (const p of simplex) {
        if (p.distanceToSquared(s) < 1e-12) { duplicate = true; break; }
      }
      if (duplicate) return { overlap: true, simplex };
      simplex.push(s);
      if (this.simplexContainsOrigin(simplex, d)) return { overlap: true, simplex };
    }
    return { overlap: false, simplex: [] };
  }

  /** GJK 单纯形演化:返回 true 表示单纯形包含原点 (重叠)。 */
  private simplexContainsOrigin(simplex: Vector3[], d: Vector3): boolean {
    if (simplex.length === 2) {
      const b = simplex[0];
      const a = simplex[1];
      const ab = new Vector3().subVectors(b, a);
      const ao = new Vector3().copy(a).multiplyScalar(-1);
      if (ab.dot(ao) > 0) {
        tripleCross(ab, ao, ab, d);
        // 退化:ab 与 ao 共线 (叉积为零 → d 为零向量),选任意正交于 ab 的方向
        if (d.lengthSq() < 1e-12) {
          if (Math.abs(ab.x) <= Math.abs(ab.y) && Math.abs(ab.x) <= Math.abs(ab.z)) {
            d.set(1, 0, 0);
          } else if (Math.abs(ab.y) <= Math.abs(ab.z)) {
            d.set(0, 1, 0);
          } else {
            d.set(0, 0, 1);
          }
          // Gram-Schmidt:减去 ab 方向分量,得到正交向量
          const abLenSq = ab.lengthSq();
          if (abLenSq > 1e-12) {
            d.addScaledVector(ab, -ab.dot(d) / abLenSq);
          }
        }
      } else {
        simplex.length = 1;
        simplex[0] = a;
        d.copy(ao);
      }
      return false;
    }
    if (simplex.length === 3) {
      const c = simplex[0];
      const b = simplex[1];
      const a = simplex[2];
      const ab = new Vector3().subVectors(b, a);
      const ac = new Vector3().subVectors(c, a);
      const ao = new Vector3().copy(a).multiplyScalar(-1);
      const abc = new Vector3().copy(ab).cross(ac);
      // 边测试:用 abc×ac / ab×abc (三角形平面内垂直于边的方向),
      // 不能用 tripleCross((abc,ac,abc)) — 因 abc⊥ac 时 BAC-CAB 退化为 |abc|²·ac。
      const abcXac = new Vector3().copy(abc).cross(ac); // 垂直于 ac,指向 b 侧
      if (abcXac.dot(ao) > 0) {
        if (ac.dot(ao) > 0) {
          simplex.length = 2;
          simplex[0] = a; simplex[1] = c;
          tripleCross(ac, ao, ac, d);
        } else if (ab.dot(ao) > 0) {
          simplex.length = 2;
          simplex[0] = a; simplex[1] = b;
          tripleCross(ab, ao, ab, d);
        } else {
          simplex.length = 1;
          simplex[0] = a;
          d.copy(ao);
        }
      } else {
        const abXabc = new Vector3().copy(ab).cross(abc); // 垂直于 ab,指向 c 侧
        if (abXabc.dot(ao) > 0) {
          if (ab.dot(ao) > 0) {
            simplex.length = 2;
            simplex[0] = a; simplex[1] = b;
            tripleCross(ab, ao, ab, d);
          } else {
            simplex.length = 1;
            simplex[0] = a;
            d.copy(ao);
          }
        } else {
          if (abc.dot(ao) > 0) {
            d.copy(abc);
          } else {
            simplex[1] = c; simplex[2] = b;
            d.copy(abc).negate();
          }
        }
      }
      return false;
    }
    if (simplex.length === 4) {
      const d3 = simplex[0];
      const c = simplex[1];
      const b = simplex[2];
      const a = simplex[3];
      const ab = new Vector3().subVectors(b, a);
      const ac = new Vector3().subVectors(c, a);
      const ad = new Vector3().subVectors(d3, a);
      const ao = new Vector3().copy(a).multiplyScalar(-1);
      const abc = new Vector3().copy(ab).cross(ac);
      const acd = new Vector3().copy(ac).cross(ad);
      const adb = new Vector3().copy(ad).cross(ab);
      if (abc.dot(ao) > 0) {
        simplex.length = 3;
        simplex[0] = c; simplex[1] = b; simplex[2] = a;
        return this.simplexContainsOrigin(simplex, d);
      }
      if (acd.dot(ao) > 0) {
        simplex.length = 3;
        simplex[0] = d3; simplex[1] = c; simplex[2] = a;
        return this.simplexContainsOrigin(simplex, d);
      }
      if (adb.dot(ao) > 0) {
        simplex.length = 3;
        simplex[0] = b; simplex[1] = d3; simplex[2] = a;
        return this.simplexContainsOrigin(simplex, d);
      }
      return true; // 原点在四面体内 → 重叠
    }
    return false;
  }

  /** EPA:从 GJK 单纯形 (含原点) 扩展,求最近面 → 穿透深度与法线。 */
  private epa(
    a: Collider,
    b: Collider,
    simplex: Vector3[],
  ): { normal: Vector3; depth: number; point: Vector3 } | null {
    const polytope: Vector3[] = simplex.map((p) => p.clone());

    // GJK 可能因重复点检测提前返回 < 4 点的单纯形 (原点在线段/三角形上)。
    // 用支撑函数沿正交方向扩展到四面体,供 EPA 构建初始多胞体。
    while (polytope.length < 4) {
      let dir: Vector3;
      if (polytope.length === 1) {
        dir = new Vector3(1, 0, 0);
        if (Math.abs(polytope[0].x) > 0.9) dir.set(0, 1, 0);
      } else if (polytope.length === 2) {
        const ab = new Vector3().subVectors(polytope[1], polytope[0]);
        dir = Math.abs(ab.x) <= Math.abs(ab.y) && Math.abs(ab.x) <= Math.abs(ab.z)
          ? new Vector3(1, 0, 0)
          : Math.abs(ab.y) <= Math.abs(ab.z)
            ? new Vector3(0, 1, 0)
            : new Vector3(0, 0, 1);
        const abLenSq = ab.lengthSq();
        if (abLenSq > 1e-12) dir.addScaledVector(ab, -ab.dot(dir) / abLenSq);
      } else {
        // 3 点:用三角形法线
        const ab = new Vector3().subVectors(polytope[1], polytope[0]);
        const ac = new Vector3().subVectors(polytope[2], polytope[0]);
        dir = new Vector3().copy(ab).cross(ac);
        if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
      }
      dir.normalize();
      const sup = this.minkowskiSupport(a, b, dir);
      let dup = false;
      for (const p of polytope) {
        if (p.distanceToSquared(sup) < 1e-12) { dup = true; break; }
      }
      if (dup) {
        dir.negate();
        const sup2 = this.minkowskiSupport(a, b, dir);
        let dup2 = false;
        for (const p of polytope) {
          if (p.distanceToSquared(sup2) < 1e-12) { dup2 = true; break; }
        }
        if (dup2) break;
        polytope.push(sup2);
      } else {
        polytope.push(sup);
      }
    }
    if (polytope.length < 4) return null;

    const centroid = new Vector3();
    for (const p of polytope) centroid.add(p);
    centroid.multiplyScalar(1 / polytope.length);

    interface Face { idx: [number, number, number]; normal: Vector3; dist: number; }
    const initialFaces: [number, number, number][] = [
      [0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2],
    ];
    let faces: Face[] = [];
    for (const f of initialFaces) {
      const n = this.faceNormalOutward(polytope[f[0]], polytope[f[1]], polytope[f[2]], centroid);
      faces.push({ idx: f, normal: n, dist: polytope[f[0]].dot(n) });
    }

    const MAX_ITER = 32;
    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (faces.length === 0) return null; // 退化:面集为空
      let bestI = 0;
      for (let i = 1; i < faces.length; i++) {
        if (faces[i].dist < faces[bestI].dist) bestI = i;
      }
      const bestFace = faces[bestI];
      const sup = this.minkowskiSupport(a, b, bestFace.normal);
      const supDist = sup.dot(bestFace.normal);
      if (supDist - bestFace.dist < 1e-6) {
        // 收敛:bestFace 即最近面
        const [ia, ib, ic] = bestFace.idx;
        const point = new Vector3()
          .add(polytope[ia])
          .add(polytope[ib])
          .add(polytope[ic])
          .multiplyScalar(1 / 3);
        const normal = bestFace.normal.clone();
        return { normal, depth: Math.max(0, bestFace.dist), point };
      }
      // 扩展:移除面向 sup 的面,收集唯一边,用 sup 构造新面
      const newIdx = polytope.length;
      polytope.push(sup);
      // 用 Map 做边去重:出现两次的边为内部边 (被两面共享),出现一次的为边界边
      const edgeMap = new Map<string, [number, number]>();
      const remaining: Face[] = [];
      for (const f of faces) {
        if (sup.dot(f.normal) - f.dist > 1e-8) {
          const fe: [number, number][] = [
            [f.idx[0], f.idx[1]],
            [f.idx[1], f.idx[2]],
            [f.idx[2], f.idx[0]],
          ];
          for (const e of fe) {
            const key = e[0] < e[1] ? `${e[0]},${e[1]}` : `${e[1]},${e[0]}`;
            if (edgeMap.has(key)) edgeMap.delete(key); // 两次 → 内部边
            else edgeMap.set(key, e);
          }
        } else {
          remaining.push(f);
        }
      }
      const uniqueEdges = Array.from(edgeMap.values());
      if (uniqueEdges.length === 0) {
        // 退化:sup 在多胞体内部或所有面法线有误。返回当前最近面作为结果。
        const [ia, ib, ic] = bestFace.idx;
        const point = new Vector3()
          .add(polytope[ia])
          .add(polytope[ib])
          .add(polytope[ic])
          .multiplyScalar(1 / 3);
        return { normal: bestFace.normal.clone(), depth: Math.max(0, bestFace.dist), point };
      }
      faces = remaining;
      for (const e of uniqueEdges) {
        const n = this.faceNormalOutward(polytope[e[0]], polytope[e[1]], polytope[newIdx], centroid);
        faces.push({ idx: [e[0], e[1], newIdx], normal: n, dist: polytope[e[0]].dot(n) });
      }
    }
    return null; // 未收敛
  }

  /** 计算三角形面法线,并保证朝外 (远离 centroid)。 */
  private faceNormalOutward(a: Vector3, b: Vector3, c: Vector3, centroid: Vector3): Vector3 {
    const ab = new Vector3().subVectors(b, a);
    const ac = new Vector3().subVectors(c, a);
    const n = new Vector3().copy(ab).cross(ac);
    const len = n.length();
    if (len < 1e-12) {
      n.set(0, 1, 0);
      return n;
    }
    n.multiplyScalar(1 / len);
    const toVertex = new Vector3().subVectors(a, centroid);
    if (n.dot(toVertex) < 0) n.negate();
    return n;
  }

  // ---- 射线检测 -------------------------------------------------------

  /** 射线检测:返回最近命中 (origin/direction 为世界空间,maxDistance 默认无穷)。 */
  testRaycast(origin: Vector3, direction: Vector3, maxDistance: number = Infinity): RaycastHit | null {
    const dir = direction.clone();
    const len = dir.length();
    if (len < 1e-9) return null;
    dir.multiplyScalar(1 / len);
    let best: RaycastHit | null = null;
    for (const c of this.colliders.values()) {
      const hit = this.raycastCollider(c, origin, dir, maxDistance);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  private raycastCollider(c: Collider, origin: Vector3, dir: Vector3, maxDist: number): RaycastHit | null {
    switch (c.type) {
      case 'sphere': return this.raySphere(c, origin, dir, maxDist);
      case 'box': return this.rayBox(c, origin, dir, maxDist);
      case 'capsule': return this.rayCapsule(c, origin, dir, maxDist);
      case 'convex':
      case 'mesh': return this.raycastTriangles(c, origin, dir, maxDist)
        ?? this.raycastAABB(c, origin, dir, maxDist);
    }
    return null;
  }

  private raySphere(c: Collider, origin: Vector3, dir: Vector3, maxDist: number): RaycastHit | null {
    const r = this.effectiveRadius(c);
    const oc = new Vector3().subVectors(origin, c.position);
    const b = oc.dot(dir);
    const cc = oc.lengthSq() - r * r;
    if (cc > 0 && b > 0) return null;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    let t = -b - sqrtDisc;
    if (t < 0) {
      t = -b + sqrtDisc;
      if (t < 0) return null;
    }
    if (t > maxDist) return null;
    const point = new Vector3().copy(origin).addScaledVector(dir, t);
    const normal = new Vector3().subVectors(point, c.position).normalize();
    return { colliderId: c.id, point, normal, distance: t };
  }

  private rayBox(c: Collider, origin: Vector3, dir: Vector3, maxDist: number): RaycastHit | null {
    const [ax, ay, az] = this.boxWorldAxes(c);
    const he = this.effectiveHalfExtents(c);
    const d = new Vector3().subVectors(origin, c.position);
    const axesData = [
      { axis: ax, he: he.x },
      { axis: ay, he: he.y },
      { axis: az, he: he.z },
    ];
    let tMin = -Infinity;
    let tMax = Infinity;
    let hitAxis: Vector3 = ax;
    let hitSign = -1;
    for (const ad of axesData) {
      const e = d.dot(ad.axis);
      const f = dir.dot(ad.axis);
      if (Math.abs(f) > 1e-9) {
        // Slab method: constraint -he <= e + t*f <= he  →  (-he-e)/f <= t <= (he-e)/f
        const t1 = (-ad.he - e) / f;
        const t2 = (ad.he - e) / f;
        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);
        if (tNear > tMin) {
          tMin = tNear;
          hitAxis = ad.axis;
          hitSign = f > 0 ? -1 : 1;
        }
        if (tFar < tMax) tMax = tFar;
        if (tMin > tMax) return null;
      } else if (e < -ad.he || e > ad.he) {
        return null;
      }
    }
    let t = tMin;
    if (t < 0) {
      t = tMax;
      if (t < 0) return null;
    }
    if (t > maxDist) return null;
    const point = new Vector3().copy(origin).addScaledVector(dir, t);
    const normal = hitAxis.clone().multiplyScalar(hitSign);
    return { colliderId: c.id, point, normal, distance: t };
  }

  private rayCapsule(c: Collider, origin: Vector3, dir: Vector3, maxDist: number): RaycastHit | null {
    const r = this.effectiveRadius(c);
    const h = (c.data.height as number) * Math.abs(c.scale.y);
    const top = this.localToWorld(c, new Vector3(0, h / 2, 0), new Vector3());
    const bot = this.localToWorld(c, new Vector3(0, -h / 2, 0), new Vector3());
    const sphereTop: Collider = { ...c, position: top, type: 'sphere', data: { radius: r } };
    const sphereBot: Collider = { ...c, position: bot, type: 'sphere', data: { radius: r } };
    let best: RaycastHit | null = this.raySphere(sphereTop, origin, dir, maxDist);
    const hBot = this.raySphere(sphereBot, origin, dir, maxDist);
    if (hBot && (!best || hBot.distance < best.distance)) best = hBot;
    const hCyl = this.rayCylinder(bot, top, r, origin, dir, maxDist, c.id);
    if (hCyl && (!best || hCyl.distance < best.distance)) best = hCyl;
    return best;
  }

  /** 无限圆柱 (轴 bot→top,半径 r) 体侧面射线求交,裁剪到 [bot,top] 段。 */
  private rayCylinder(
    bot: Vector3, top: Vector3, r: number,
    origin: Vector3, dir: Vector3, maxDist: number, id: number,
  ): RaycastHit | null {
    const axis = new Vector3().subVectors(top, bot);
    const axisLen = axis.length();
    if (axisLen < 1e-9) return null;
    axis.multiplyScalar(1 / axisLen);
    const m = new Vector3().subVectors(origin, bot);
    const md = m.dot(axis);
    const nd = dir.dot(axis);
    const mPerp = new Vector3().copy(m).addScaledVector(axis, -md);
    const dPerp = new Vector3().copy(dir).addScaledVector(axis, -nd);
    const a = dPerp.lengthSq();
    const b = mPerp.dot(dPerp);
    const cc = mPerp.lengthSq() - r * r;
    let t: number;
    if (a < 1e-12) {
      // 射线平行于轴:仅在半径内才可能命中端面 (此处由端球处理),侧面无命中
      if (cc > 0) return null;
      const tBot = nd !== 0 ? -md / nd : Infinity;
      const tTop = nd !== 0 ? (axisLen - md) / nd : Infinity;
      t = nd > 0 ? tTop : tBot;
      if (t < 0) return null;
    } else {
      const disc = b * b - a * cc;
      if (disc < 0) return null;
      t = (-b - Math.sqrt(disc)) / a;
      if (t < 0) {
        t = (-b + Math.sqrt(disc)) / a;
        if (t < 0) return null;
      }
    }
    if (t > maxDist) return null;
    const point = new Vector3().copy(origin).addScaledVector(dir, t);
    const s = new Vector3().subVectors(point, bot).dot(axis);
    if (s < 0 || s > axisLen) return null; // 命中在圆柱段外 (端球处理)
    const axisPoint = new Vector3().copy(bot).addScaledVector(axis, s);
    const normal = new Vector3().subVectors(point, axisPoint).normalize();
    return { colliderId: id, point, normal, distance: t };
  }

  /** 凸包/网格:逐三角形 (Möller–Trumbore) 射线求交,取最近命中。 */
  private raycastTriangles(c: Collider, origin: Vector3, dir: Vector3, maxDist: number): RaycastHit | null {
    const verts = c.data.vertices as Vector3[] | number[] | Float32Array;
    const indices = c.data.indices as number[] | undefined;
    let triCount: number;
    if (indices) triCount = Math.floor(indices.length / 3);
    else if (c.type === 'convex') triCount = Math.floor((verts as Vector3[]).length / 3);
    else triCount = Math.floor((verts as number[] | Float32Array).length / 9);
    if (triCount === 0) return null;
    let best: { point: Vector3; normal: Vector3; distance: number } | null = null;
    for (let i = 0; i < triCount; i++) {
      let ia: number, ib: number, ic: number;
      if (indices) { ia = indices[i * 3]; ib = indices[i * 3 + 1]; ic = indices[i * 3 + 2]; }
      else { ia = i * 3; ib = i * 3 + 1; ic = i * 3 + 2; }
      const a = this.readWorldVertex(c, ia, new Vector3());
      const b = this.readWorldVertex(c, ib, new Vector3());
      const cc = this.readWorldVertex(c, ic, new Vector3());
      const hit = this.rayTriangle(origin, dir, a, b, cc, maxDist);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    if (!best) return null;
    return { colliderId: c.id, point: best.point, normal: best.normal, distance: best.distance };
  }

  private rayTriangle(
    origin: Vector3, dir: Vector3,
    a: Vector3, b: Vector3, c: Vector3, maxDist: number,
  ): { point: Vector3; normal: Vector3; distance: number } | null {
    const ab = new Vector3().subVectors(b, a);
    const ac = new Vector3().subVectors(c, a);
    const pvec = new Vector3().copy(dir).cross(ac);
    const det = ab.dot(pvec);
    if (Math.abs(det) < 1e-9) return null;
    const invDet = 1 / det;
    const tvec = new Vector3().subVectors(origin, a);
    const u = tvec.dot(pvec) * invDet;
    if (u < 0 || u > 1) return null;
    const qvec = new Vector3().copy(tvec).cross(ab);
    const v = dir.dot(qvec) * invDet;
    if (v < 0 || u + v > 1) return null;
    const t = ac.dot(qvec) * invDet;
    if (t < 0 || t > maxDist) return null;
    const point = new Vector3().copy(origin).addScaledVector(dir, t);
    const normal = new Vector3().copy(ab).cross(ac).normalize();
    if (normal.dot(dir) > 0) normal.negate(); // 法线朝向射线来源
    return { point, normal, distance: t };
  }

  /** AABB slab 射线求交 (凸包无三角形数据时的回退)。 */
  private raycastAABB(c: Collider, origin: Vector3, dir: Vector3, maxDist: number): RaycastHit | null {
    const aabb = this.computeAABB(c);
    const axes = ['x', 'y', 'z'] as const;
    let tMin = -Infinity;
    let tMax = Infinity;
    let hitAxis = 0;
    let hitSign = -1;
    for (let i = 0; i < 3; i++) {
      const ax = axes[i];
      const o = origin[ax];
      const d = dir[ax];
      const mn = aabb.min[ax];
      const mx = aabb.max[ax];
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) return null;
      } else {
        const t1 = (mn - o) / d;
        const t2 = (mx - o) / d;
        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);
        if (tNear > tMin) { tMin = tNear; hitAxis = i; hitSign = d > 0 ? -1 : 1; }
        if (tFar < tMax) tMax = tFar;
        if (tMin > tMax) return null;
      }
    }
    let t = tMin;
    if (t < 0) { t = tMax; if (t < 0) return null; }
    if (t > maxDist) return null;
    const point = new Vector3().copy(origin).addScaledVector(dir, t);
    const normal = new Vector3();
    normal[axes[hitAxis]] = hitSign;
    return { colliderId: c.id, point, normal, distance: t };
  }

  // ---- 接触访问 -------------------------------------------------------

  getContactManifolds(): ContactManifold[] {
    return this.contactManifolds;
  }

  getContactCount(): number {
    return this.contactManifolds.length;
  }

  clearContacts(): void {
    this.contactManifolds.length = 0;
  }

  getStats(): CollisionStats {
    let depth = 0;
    let nodes = 0;
    if (this.bvh) {
      const info = this.bvhStats(this.bvh, 0);
      depth = info.depth;
      nodes = info.nodes;
    }
    return {
      colliderCount: this.colliders.size,
      broadphase: this.broadphase,
      narrowphase: this.narrowphase,
      candidatePairs: this.lastCandidatePairs,
      contactCount: this.contactManifolds.length,
      bvhDepth: depth,
      bvhNodes: nodes,
    };
  }

  // ---- 几何工具 -------------------------------------------------------

  private localToWorld(c: Collider, local: Vector3, out: Vector3): Vector3 {
    out.x = local.x * c.scale.x;
    out.y = local.y * c.scale.y;
    out.z = local.z * c.scale.z;
    out.applyQuaternion(c.rotation);
    out.add(c.position);
    return out;
  }

  private boxWorldAxes(c: Collider): [Vector3, Vector3, Vector3] {
    const ax = new Vector3(1, 0, 0).applyQuaternion(c.rotation);
    const ay = new Vector3(0, 1, 0).applyQuaternion(c.rotation);
    const az = new Vector3(0, 0, 1).applyQuaternion(c.rotation);
    return [ax, ay, az];
  }

  private effectiveRadius(c: Collider): number {
    const r = c.data.radius as number;
    const s = c.scale;
    return r * Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
  }

  private effectiveHalfExtents(c: Collider): Vector3 {
    const he = c.data.halfExtents as Vector3;
    const s = c.scale;
    return new Vector3(
      Math.abs(he.x * s.x),
      Math.abs(he.y * s.y),
      Math.abs(he.z * s.z),
    );
  }

  /** 世界空间 AABB。 */
  private computeAABB(c: Collider): AABB {
    const min = new Vector3(+Infinity, +Infinity, +Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const tmp = new Vector3();
    const expand = (p: Vector3): void => {
      if (p.x < min.x) min.x = p.x;
      if (p.y < min.y) min.y = p.y;
      if (p.z < min.z) min.z = p.z;
      if (p.x > max.x) max.x = p.x;
      if (p.y > max.y) max.y = p.y;
      if (p.z > max.z) max.z = p.z;
    };
    switch (c.type) {
      case 'sphere': {
        const r = this.effectiveRadius(c);
        min.set(c.position.x - r, c.position.y - r, c.position.z - r);
        max.set(c.position.x + r, c.position.y + r, c.position.z + r);
        return { min, max };
      }
      case 'box': {
        const he = this.effectiveHalfExtents(c);
        const corners = [
          new Vector3(-he.x, -he.y, -he.z), new Vector3(-he.x, -he.y, he.z),
          new Vector3(-he.x, he.y, -he.z), new Vector3(-he.x, he.y, he.z),
          new Vector3(he.x, -he.y, -he.z), new Vector3(he.x, -he.y, he.z),
          new Vector3(he.x, he.y, -he.z), new Vector3(he.x, he.y, he.z),
        ];
        for (const corner of corners) {
          tmp.copy(corner).applyQuaternion(c.rotation).add(c.position);
          expand(tmp);
        }
        return { min, max };
      }
      case 'capsule': {
        const r = this.effectiveRadius(c);
        const h = (c.data.height as number) * Math.abs(c.scale.y);
        const top = this.localToWorld(c, new Vector3(0, h / 2, 0), new Vector3());
        const bot = this.localToWorld(c, new Vector3(0, -h / 2, 0), new Vector3());
        for (const p of [top, bot]) {
          min.x = Math.min(min.x, p.x - r); min.y = Math.min(min.y, p.y - r); min.z = Math.min(min.z, p.z - r);
          max.x = Math.max(max.x, p.x + r); max.y = Math.max(max.y, p.y + r); max.z = Math.max(max.z, p.z + r);
        }
        return { min, max };
      }
      case 'convex':
      case 'mesh': {
        const verts = c.data.vertices;
        if (c.type === 'convex') {
          const arr = verts as Vector3[];
          for (const v of arr) expand(this.localToWorld(c, v, new Vector3()));
        } else {
          const arr = verts as number[] | Float32Array;
          const count = Math.floor(arr.length / 3);
          for (let i = 0; i < count; i++) {
            this.localToWorld(c, new Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]), tmp);
            expand(tmp);
          }
        }
        return { min, max };
      }
    }
    return { min, max };
  }

  private readWorldVertex(c: Collider, vi: number, out: Vector3): Vector3 {
    const verts = c.data.vertices;
    if (c.type === 'convex') {
      const v = (verts as Vector3[])[vi];
      return this.localToWorld(c, v, out);
    }
    const arr = verts as number[] | Float32Array;
    const local = new Vector3(arr[vi * 3], arr[vi * 3 + 1], arr[vi * 3 + 2]);
    return this.localToWorld(c, local, out);
  }

  private computeBoundsForIds(ids: number[]): AABB {
    const min = new Vector3(+Infinity, +Infinity, +Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const id of ids) {
      const b = this.computeAABB(this.colliders.get(id)!);
      min.min(b.min);
      max.max(b.max);
    }
    return { min, max };
  }

  private colliderCenterAxis(id: number, axis: number): number {
    const c = this.colliders.get(id)!;
    const b = this.computeAABB(c);
    const center = axis === 0 ? (b.min.x + b.max.x) * 0.5
      : axis === 1 ? (b.min.y + b.max.y) * 0.5
        : (b.min.z + b.max.z) * 0.5;
    return center;
  }

  private aabbOverlap(a: AABB, b: AABB): boolean {
    return a.max.x >= b.min.x && a.min.x <= b.max.x
      && a.max.y >= b.min.y && a.min.y <= b.max.y
      && a.max.z >= b.min.z && a.min.z <= b.max.z;
  }

  /** 翻转流形:交换 A/B,反转法线 (用于 sphere→box 与 box→sphere 适配)。 */
  private flipManifold(m: ContactManifold): ContactManifold {
    const normal = m.normal.clone().negate();
    const contacts = m.contacts.map((c) => ({
      point: c.point.clone(),
      normal: c.normal.clone().negate(),
      depth: c.depth,
    }));
    return {
      colliderA: m.colliderB,
      colliderB: m.colliderA,
      contacts,
      normal,
      depth: m.depth,
    };
  }
}

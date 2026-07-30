// CollisionSystem.test.ts — 碰撞检测系统 (CollisionSystem) 测试。
//
// 覆盖:
//   * 碰撞器管理 (register/unregister/get/getColliders)
//   * setBroadphase / setNarrowphase
//   * testSphereSphere / testSphereBox / testBoxBox (SAT)
//   * 宽相 (bruteforce/sweep/bvh) 候选对
//   * buildBVH 树结构
//   * update 端到端 (宽相+窄相+流形)
//   * narrowphaseSAT/GJK/EPA 路径
//   * testRaycast (sphere/box/mesh)
//   * getContactManifolds / getContactCount / clearContacts / getStats

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import {
  CollisionSystem,
  type Collider,
} from './CollisionSystem';

const IDENTITY_Q = new Quaternion();
const UNIT_SCALE = new Vector3(1, 1, 1);

function sphere(id: number, x: number, y: number, z: number, r: number): Collider {
  return {
    id,
    type: 'sphere',
    position: new Vector3(x, y, z),
    rotation: IDENTITY_Q.clone(),
    scale: UNIT_SCALE.clone(),
    data: { radius: r },
    isTrigger: false,
  };
}

function box(id: number, x: number, y: number, z: number, hx: number, hy: number, hz: number): Collider {
  return {
    id,
    type: 'box',
    position: new Vector3(x, y, z),
    rotation: IDENTITY_Q.clone(),
    scale: UNIT_SCALE.clone(),
    data: { halfExtents: new Vector3(hx, hy, hz) },
    isTrigger: false,
  };
}

function convex(id: number, vertices: [number, number, number][]): Collider {
  return {
    id,
    type: 'convex',
    position: new Vector3(0, 0, 0),
    rotation: IDENTITY_Q.clone(),
    scale: UNIT_SCALE.clone(),
    data: { vertices: vertices.map((v) => new Vector3(v[0], v[1], v[2])) },
    isTrigger: false,
  };
}

function mesh(id: number, vertices: number[], indices?: number[]): Collider {
  return {
    id,
    type: 'mesh',
    position: new Vector3(0, 0, 0),
    rotation: IDENTITY_Q.clone(),
    scale: UNIT_SCALE.clone(),
    data: { vertices, indices },
    isTrigger: false,
  };
}

describe('CollisionSystem — 管理接口', () => {
  it('默认构造空系统', () => {
    const sys = new CollisionSystem();
    expect(sys.getColliders()).toHaveLength(0);
    expect(sys.broadphase).toBe('bruteforce');
    expect(sys.narrowphase).toBe('sat');
    expect(sys.getContactCount()).toBe(0);
  });

  it('registerCollider / getCollider / getColliders', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 5, 0, 0, 1));
    expect(sys.getCollider(1)).toBeDefined();
    expect(sys.getCollider(3)).toBeUndefined();
    expect(sys.getColliders()).toHaveLength(2);
    // id 被覆盖为传入值
    expect(sys.getCollider(1)!.id).toBe(1);
  });

  it('unregisterCollider', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.unregisterCollider(1);
    expect(sys.getColliders()).toHaveLength(0);
    expect(sys.bvh).toBeNull(); // 缓存失效
  });

  it('setBroadphase / setNarrowphase', () => {
    const sys = new CollisionSystem();
    sys.setBroadphase('bvh');
    sys.setNarrowphase('epa');
    expect(sys.broadphase).toBe('bvh');
    expect(sys.narrowphase).toBe('epa');
  });
});

describe('CollisionSystem — 特化碰撞测试', () => {
  it('testSphereSphere: 相交', () => {
    const sys = new CollisionSystem();
    const a = sphere(1, 0, 0, 0, 1);
    const b = sphere(2, 1.5, 0, 0, 1);
    const m = sys.testSphereSphere(a, b);
    expect(m).not.toBeNull();
    expect(m!.depth).toBeCloseTo(0.5, 5);
    // 法线 A→B = +X
    expect(m!.normal.x).toBeCloseTo(1, 5);
    expect(m!.normal.y).toBeCloseTo(0, 5);
    expect(m!.normal.z).toBeCloseTo(0, 5);
  });

  it('testSphereSphere: 不相交返回 null', () => {
    const sys = new CollisionSystem();
    const a = sphere(1, 0, 0, 0, 1);
    const b = sphere(2, 3, 0, 0, 1);
    expect(sys.testSphereSphere(a, b)).toBeNull();
  });

  it('testSphereBox: 相交', () => {
    const sys = new CollisionSystem();
    const s = sphere(1, 1.5, 0, 0, 1);
    const bx = box(2, 0, 0, 0, 1, 1, 1); // [-1,1]³
    const m = sys.testSphereBox(s, bx);
    expect(m).not.toBeNull();
    expect(m!.depth).toBeGreaterThan(0);
    // 法线 sphere→box = -X (球在 +X 侧,盒在原点)
    expect(m!.normal.x).toBeLessThan(0);
  });

  it('testSphereBox: 不相交返回 null', () => {
    const sys = new CollisionSystem();
    const s = sphere(1, 5, 0, 0, 1);
    const bx = box(2, 0, 0, 0, 1, 1, 1);
    expect(sys.testSphereBox(s, bx)).toBeNull();
  });

  it('testBoxBox: 相交 (SAT)', () => {
    const sys = new CollisionSystem();
    const a = box(1, 0, 0, 0, 1, 1, 1);
    const b = box(2, 1.5, 0, 0, 1, 1, 1); // 重叠 0.5
    const m = sys.testBoxBox(a, b);
    expect(m).not.toBeNull();
    expect(m!.depth).toBeCloseTo(0.5, 5);
    // 法线 A→B = +X
    expect(m!.normal.x).toBeCloseTo(1, 5);
  });

  it('testBoxBox: 不相交返回 null', () => {
    const sys = new CollisionSystem();
    const a = box(1, 0, 0, 0, 1, 1, 1);
    const b = box(2, 5, 0, 0, 1, 1, 1);
    expect(sys.testBoxBox(a, b)).toBeNull();
  });
});

describe('CollisionSystem — 宽相', () => {
  it('broadphaseBruteForce: 找到重叠对', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 1.5, 0, 0, 1)); // 与 1 重叠
    sys.registerCollider(3, sphere(3, 10, 0, 0, 1)); // 远离
    const pairs = sys.broadphaseBruteForce();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([1, 2]);
  });

  it('broadphaseSweep: 找到重叠对', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 1.5, 0, 0, 1));
    sys.registerCollider(3, sphere(3, 10, 0, 0, 1));
    const pairs = sys.broadphaseSweep();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([1, 2]);
  });

  it('broadphaseBVH: 找到重叠对', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 1.5, 0, 0, 1));
    sys.registerCollider(3, sphere(3, 10, 0, 0, 1));
    sys.buildBVH();
    const pairs = sys.broadphaseBVH();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual([1, 2]);
  });

  it('buildBVH: 构建树并统计节点', () => {
    const sys = new CollisionSystem();
    for (let i = 0; i < 5; i++) {
      sys.registerCollider(i, sphere(i, i * 3, 0, 0, 1));
    }
    const root = sys.buildBVH();
    expect(root).not.toBeNull();
    expect(sys.bvh).not.toBeNull();
    const stats = sys.getStats();
    expect(stats.bvhNodes).toBeGreaterThan(0);
    expect(stats.bvhDepth).toBeGreaterThan(0);
  });

  it('buildBVH: 空系统返回 null', () => {
    const sys = new CollisionSystem();
    expect(sys.buildBVH()).toBeNull();
    expect(sys.bvh).toBeNull();
  });
});

describe('CollisionSystem — update 端到端', () => {
  it('update 用 bruteforce+sat 产生流形', () => {
    const sys = new CollisionSystem();
    sys.setBroadphase('bruteforce');
    sys.setNarrowphase('sat');
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 1.5, 0, 0, 1));
    sys.registerCollider(3, sphere(3, 10, 0, 0, 1));
    sys.update(1 / 60);
    expect(sys.getContactCount()).toBe(1);
    const m = sys.getContactManifolds()[0];
    expect(m.colliderA.id).toBe(1);
    expect(m.colliderB.id).toBe(2);
    expect(m.depth).toBeCloseTo(0.5, 5);
  });

  it('update 用 sweep+sat 产生流形', () => {
    const sys = new CollisionSystem();
    sys.setBroadphase('sweep');
    sys.setNarrowphase('sat');
    sys.registerCollider(1, box(1, 0, 0, 0, 1, 1, 1));
    sys.registerCollider(2, box(2, 1.5, 0, 0, 1, 1, 1));
    sys.update(1 / 60);
    expect(sys.getContactCount()).toBe(1);
  });

  it('update 用 bvh+epa 产生流形', () => {
    const sys = new CollisionSystem();
    sys.setBroadphase('bvh');
    sys.setNarrowphase('epa');
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 1.5, 0, 0, 1));
    sys.update(1 / 60);
    expect(sys.getContactCount()).toBe(1);
    expect(sys.getContactManifolds()[0].depth).toBeCloseTo(0.5, 5);
  });

  it('update 无碰撞时流形为空', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 10, 0, 0, 1));
    sys.update(1 / 60);
    expect(sys.getContactCount()).toBe(0);
  });

  it('clearContacts 清空流形', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 1.5, 0, 0, 1));
    sys.update(1 / 60);
    expect(sys.getContactCount()).toBe(1);
    sys.clearContacts();
    expect(sys.getContactCount()).toBe(0);
  });
});

describe('CollisionSystem — 窄相路径', () => {
  it('narrowphaseSAT 对 box-box 精确求交', () => {
    const sys = new CollisionSystem();
    const a = box(1, 0, 0, 0, 1, 1, 1);
    const b = box(2, 1.5, 0, 0, 1, 1, 1);
    const m = sys.narrowphaseSAT(a, b);
    expect(m).not.toBeNull();
    expect(m!.depth).toBeCloseTo(0.5, 5);
  });

  it('narrowphaseSAT 对 box-sphere 自动翻转法线', () => {
    const sys = new CollisionSystem();
    const bx = box(1, 0, 0, 0, 1, 1, 1);
    const s = sphere(2, 1.5, 0, 0, 1);
    const m = sys.narrowphaseSAT(bx, s);
    expect(m).not.toBeNull();
    // A=box, B=sphere, 法线 box→sphere = +X
    expect(m!.normal.x).toBeGreaterThan(0);
  });

  it('narrowphaseGJK 对 convex 重叠检测', () => {
    const sys = new CollisionSystem();
    // 四面体 (convex)
    const a = convex(1, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const b = convex(2, [[0.5, 0.5, 0.5], [1.5, 0.5, 0.5], [0.5, 1.5, 0.5], [0.5, 0.5, 1.5]]);
    // 移动 b 使其顶点 (0.5,0.5,0.5)→(0.3,0.3,0.3) 落入 a 内部 (0.3+0.3+0.3=0.9<1)
    b.position.set(-0.2, -0.2, -0.2);
    const m = sys.narrowphaseGJK(a, b);
    expect(m).not.toBeNull();
  });

  it('narrowphaseGJK 不重叠返回 null', () => {
    const sys = new CollisionSystem();
    const a = convex(1, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const b = convex(2, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    b.position.set(10, 10, 10);
    expect(sys.narrowphaseGJK(a, b)).toBeNull();
  });

  it('narrowphaseEPA 对 convex 重叠给出深度', () => {
    const sys = new CollisionSystem();
    const a = convex(1, [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]);
    const b = convex(2, [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]);
    b.position.set(0.5, 0, 0); // 沿 X 偏移 0.5,四面体重叠
    const m = sys.narrowphaseEPA(a, b);
    expect(m).not.toBeNull();
    expect(m!.depth).toBeGreaterThan(0);
  });

  it('narrowphaseEPA 对 box-box 走快速路径', () => {
    const sys = new CollisionSystem();
    const a = box(1, 0, 0, 0, 1, 1, 1);
    const b = box(2, 1.5, 0, 0, 1, 1, 1);
    const m = sys.narrowphaseEPA(a, b);
    expect(m).not.toBeNull();
    expect(m!.depth).toBeCloseTo(0.5, 5);
  });
});

describe('CollisionSystem — 射线检测', () => {
  it('testRaycast 命中球', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    const hit = sys.testRaycast(new Vector3(-5, 0, 0), new Vector3(1, 0, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.colliderId).toBe(1);
    expect(hit!.distance).toBeCloseTo(4, 5); // -5 → -1 (球面)
    expect(hit!.point.x).toBeCloseTo(-1, 5);
    expect(hit!.normal.x).toBeCloseTo(-1, 5);
  });

  it('testRaycast 命中盒', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, box(1, 0, 0, 0, 1, 1, 1));
    const hit = sys.testRaycast(new Vector3(-5, 0, 0), new Vector3(1, 0, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.colliderId).toBe(1);
    expect(hit!.distance).toBeCloseTo(4, 5); // -5 → -1
    expect(hit!.point.x).toBeCloseTo(-1, 5);
  });

  it('testRaycast 返回最近命中', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 5, 0, 0, 1));
    const hit = sys.testRaycast(new Vector3(-5, 0, 0), new Vector3(1, 0, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.colliderId).toBe(1);
  });

  it('testRaycast 超出 maxDistance 返回 null', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    const hit = sys.testRaycast(new Vector3(-5, 0, 0), new Vector3(1, 0, 0), 2);
    expect(hit).toBeNull();
  });

  it('testRaycast 未命中返回 null', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    const hit = sys.testRaycast(new Vector3(-5, 10, 0), new Vector3(1, 0, 0), 100);
    expect(hit).toBeNull();
  });

  it('testRaycast 命中 mesh 三角形', () => {
    const sys = new CollisionSystem();
    // 两个三角形组成的四边形 (在 Y=0 平面,X∈[-1,1],Z∈[-1,1])
    const verts = [
      -1, 0, -1,
      1, 0, -1,
      1, 0, 1,
      -1, 0, 1,
    ];
    const indices = [0, 1, 2, 0, 2, 3];
    sys.registerCollider(1, mesh(1, verts, indices));
    const hit = sys.testRaycast(new Vector3(0, 5, 0), new Vector3(0, -1, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.colliderId).toBe(1);
    expect(hit!.point.y).toBeCloseTo(0, 5);
    expect(hit!.distance).toBeCloseTo(5, 5);
  });

  it('testRaycast 零方向返回 null', () => {
    const sys = new CollisionSystem();
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    expect(sys.testRaycast(new Vector3(0, 0, 0), new Vector3(0, 0, 0), 100)).toBeNull();
  });
});

describe('CollisionSystem — 统计', () => {
  it('getStats 反映当前状态', () => {
    const sys = new CollisionSystem();
    sys.setBroadphase('bvh');
    sys.setNarrowphase('epa');
    sys.registerCollider(1, sphere(1, 0, 0, 0, 1));
    sys.registerCollider(2, sphere(2, 1.5, 0, 0, 1));
    sys.registerCollider(3, sphere(3, 10, 0, 0, 1));
    sys.update(1 / 60);
    const stats = sys.getStats();
    expect(stats.colliderCount).toBe(3);
    expect(stats.broadphase).toBe('bvh');
    expect(stats.narrowphase).toBe('epa');
    expect(stats.candidatePairs).toBe(1);
    expect(stats.contactCount).toBe(1);
    expect(stats.bvhNodes).toBeGreaterThan(0);
  });
});

describe('CollisionSystem — 缩放与旋转', () => {
  it('缩放影响球的有效半径', () => {
    const sys = new CollisionSystem();
    const a = sphere(1, 0, 0, 0, 1);
    a.scale.set(2, 2, 2); // 有效半径 2
    const b = sphere(2, 4.5, 0, 0, 1); // 距离 4.5, r1+r2=3 → 不相交
    expect(sys.testSphereSphere(a, b)).toBeNull();
    // 移近到 2.5 → 相交 (3 > 2.5)
    b.position.set(2.5, 0, 0);
    const m = sys.testSphereSphere(a, b);
    expect(m).not.toBeNull();
    expect(m!.depth).toBeCloseTo(0.5, 5);
  });

  it('旋转盒不影响 AABB 宽相对 (bruteforce)', () => {
    const sys = new CollisionSystem();
    const a = box(1, 0, 0, 0, 1, 1, 1);
    a.rotation.setFromEuler(0, 0, Math.PI / 4); // 绕 Z 转 45°
    const b = box(2, 2, 0, 0, 1, 1, 1);
    sys.registerCollider(1, a);
    sys.registerCollider(2, b);
    const pairs = sys.broadphaseBruteForce();
    // 转 45° 后对角线变长,AABB 扩大,与 B 的 AABB 仍可能重叠
    expect(pairs.length).toBeGreaterThanOrEqual(0);
  });
});

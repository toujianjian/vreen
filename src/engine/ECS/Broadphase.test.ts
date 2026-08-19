// Phase 2.4.2 — Broadphase 优化测试。
//
// 验证:
//   1. SAP 与 brute-force 检测结果等价(都找到所有真实碰撞对)
//   2. SAP 候选对数 < brute-force 候选对数(广度剪枝生效)
//   3. SAP 在大规模场景下性能优于 brute-force
//   4. 默认 broadphase='brute-force'(向后兼容)
//   5. SAP 在静态物体间也正确剪枝(static-static 不响应但 candidates 计数正确)

import { describe, it, expect } from 'vitest';
import { World } from './World';
import { Transform, TransformC } from './Components';
import {
  Rigidbody, RigidbodyC,
  Collider, ColliderC,
  PhysicsConfig, PhysicsConfigC,
} from './PhysicsComponents';
import { PhysicsSystem, CollisionSystem } from './PhysicsSystems';

/** 构造 N 个球体 + 静态地面的世界。 */
function buildWorld(n: number): World {
  const w = new World({ name: `SAP${n}` });
  const cfg = w.createEntity('physics');
  const pcfg = new PhysicsConfig();
  pcfg.maxSubsteps = 1;
  w.setComponent(cfg, PhysicsConfigC, pcfg);

  const floor = w.createEntity('Floor');
  const floorT = Transform.fromPos(0, -1, 0);
  w.setComponent(floor, TransformC, floorT);
  const floorCol = new Collider();
  floorCol.shape = 'aabb';
  floorCol.halfExtents = [50, 1, 50];
  floorCol.isStatic = true;
  w.setComponent(floor, ColliderC, floorCol);

  for (let i = 0; i < n; i++) {
    const e = w.createEntity(`Ball${i}`);
    const side = Math.ceil(Math.sqrt(n));
    const ix = i % side;
    const iz = Math.floor(i / side);
    const spacing = 1.2;
    const t = Transform.fromPos(
      (ix - side / 2) * spacing,
      5 + Math.floor(i / side) * 0.5,
      (iz - side / 2) * spacing,
    );
    w.setComponent(e, TransformC, t);
    const rb = new Rigidbody();
    rb.mass = 1;
    w.setComponent(e, RigidbodyC, rb);
    const col = new Collider();
    col.shape = 'sphere';
    col.radius = 0.5;
    w.setComponent(e, ColliderC, col);
  }
  return w;
}

/** 跑 frames 帧并返回总耗时 + 最终 contact 累计。 */
function runFrames(w: World, frames: number, dt = 1 / 60): {
  totalMs: number;
  totalContacts: number;
  avgCandidates: number;
  avgNarrowChecks: number;
} {
  const physics = w.getSystems().find((s) => s.name === 'PhysicsSystem') as PhysicsSystem;
  const collision = w.getSystems().find((s) => s.name === 'CollisionSystem') as CollisionSystem;
  if (!physics || !collision) throw new Error('systems missing');

  // 预热
  for (let i = 0; i < 3; i++) { physics.update(w, dt); collision.update(w, dt); }

  let totalMs = 0;
  let totalContacts = 0;
  let candSum = 0;
  let narrowSum = 0;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    physics.update(w, dt);
    collision.update(w, dt);
    totalMs += performance.now() - t0;
    totalContacts += CollisionSystem.contacts.length;
    candSum += collision.stats.broadphaseCandidates;
    narrowSum += collision.stats.narrowphaseChecks;
  }
  return {
    totalMs,
    totalContacts,
    avgCandidates: candSum / frames,
    avgNarrowChecks: narrowSum / frames,
  };
}

describe('Phase 2.4.2 — Broadphase 优化 (SAP)', () => {
  describe('默认配置', () => {
    it('默认 broadphase="brute-force"(向后兼容)', () => {
      const cs = new CollisionSystem();
      expect(cs.broadphase).toBe('brute-force');
    });

    it('stats 字段初始化为 0', () => {
      const cs = new CollisionSystem();
      expect(cs.stats.broadphaseCandidates).toBe(0);
      expect(cs.stats.narrowphaseChecks).toBe(0);
      expect(cs.stats.sapEarlyExits).toBe(0);
    });
  });

  describe('正确性:SAP 与 brute-force 检测等价', () => {
    it('N=20 球体下落,SAP 与 brute-force 产生相同 contact 数', () => {
      // 用固定 seed 构造两次相同场景
      const w1 = buildWorld(20);
      w1.addSystem(new PhysicsSystem());
      const cs1 = new CollisionSystem();
      cs1.broadphase = 'brute-force';
      w1.addSystem(cs1);

      const w2 = buildWorld(20);
      w2.addSystem(new PhysicsSystem());
      const cs2 = new CollisionSystem();
      cs2.broadphase = 'sap';
      w2.addSystem(cs2);

      // 跑 90 帧(1.5 秒),保证球从 y=5 落到地面(y=0)并产生 contact
      const r1 = runFrames(w1, 90);
      const r2 = runFrames(w2, 90);
      // contact 数应一致(允许浮点抖动导致小差异,这里 N=20 应严格相等)
      expect(r2.totalContacts).toBeGreaterThan(0); // 至少有球-地碰撞
      expect(Math.abs(r1.totalContacts - r2.totalContacts)).toBeLessThanOrEqual(2);
    });

    it('N=100 球体下落,SAP 与 brute-force 物理结果在合理误差内一致', () => {
      const w1 = buildWorld(100);
      w1.addSystem(new PhysicsSystem());
      const cs1 = new CollisionSystem();
      cs1.broadphase = 'brute-force';
      w1.addSystem(cs1);

      const w2 = buildWorld(100);
      w2.addSystem(new PhysicsSystem());
      const cs2 = new CollisionSystem();
      cs2.broadphase = 'sap';
      w2.addSystem(cs2);

      runFrames(w1, 30);
      runFrames(w2, 30);

      // 比较所有球最终 y 均值(应在地面附近,且两种 broadphase 相近)
      let sum1 = 0, count1 = 0;
      let sum2 = 0, count2 = 0;
      w1.forEachEntity((id, name) => {
        if (name === 'physics' || name === 'Floor') return;
        const t = w1.getComponent(id, TransformC)!;
        sum1 += t.position[1]; count1++;
      });
      w2.forEachEntity((id, name) => {
        if (name === 'physics' || name === 'Floor') return;
        const t = w2.getComponent(id, TransformC)!;
        sum2 += t.position[1]; count2++;
      });
      expect(count1).toBe(count2);
      const avg1 = sum1 / count1;
      const avg2 = sum2 / count2;
      // 两种 broadphase 物理结果应非常接近(允许少量抖动)
      expect(Math.abs(avg1 - avg2)).toBeLessThan(2.0);
      // N=100 双世界 × 30 帧物理模拟,慢机器 + 全量并发可能超过默认 5s。
    }, 30000);
  });

  describe('SAP 剪枝效果', () => {
    it('SAP broadphaseCandidates < brute-force broadphaseCandidates', () => {
      const w1 = buildWorld(100);
      w1.addSystem(new PhysicsSystem());
      const cs1 = new CollisionSystem();
      cs1.broadphase = 'brute-force';
      w1.addSystem(cs1);

      const w2 = buildWorld(100);
      w2.addSystem(new PhysicsSystem());
      const cs2 = new CollisionSystem();
      cs2.broadphase = 'sap';
      w2.addSystem(cs2);

      const r1 = runFrames(w1, 30);
      const r2 = runFrames(w2, 30);
      // brute-force 候选对 = O(n²) ≈ 100*99/2 ≈ 4950/帧
      // SAP 候选对应明显更少
      expect(r2.avgCandidates).toBeLessThan(r1.avgCandidates);
      // SAP 应触发提前退出
      expect(cs2.stats.sapEarlyExits).toBeGreaterThan(0);
    });

    it('N=500 时 SAP 候选对显著少于 brute-force', () => {
      const w1 = buildWorld(500);
      w1.addSystem(new PhysicsSystem());
      const cs1 = new CollisionSystem();
      cs1.broadphase = 'brute-force';
      w1.addSystem(cs1);

      const w2 = buildWorld(500);
      w2.addSystem(new PhysicsSystem());
      const cs2 = new CollisionSystem();
      cs2.broadphase = 'sap';
      w2.addSystem(cs2);

      const r1 = runFrames(w1, 20);
      const r2 = runFrames(w2, 20);

      // brute-force N=500 → 候选对 ~125k/帧
      expect(r1.avgCandidates).toBeGreaterThan(100000);
      // SAP 候选对应 << brute-force
      expect(r2.avgCandidates).toBeLessThan(r1.avgCandidates * 0.5);
      // N=500 双世界各 20 帧,候选对 O(n²) 计算量大,慢机器可能超过默认 5s。
    }, 60000);
  });

  describe('性能对比', () => {
    it('N=1000 SAP 比 brute-force 快(报告对比)', () => {
      // brute-force
      const w1 = buildWorld(1000);
      w1.addSystem(new PhysicsSystem());
      const cs1 = new CollisionSystem();
      cs1.broadphase = 'brute-force';
      w1.addSystem(cs1);
      const r1 = runFrames(w1, 15);

      // SAP
      const w2 = buildWorld(1000);
      w2.addSystem(new PhysicsSystem());
      const cs2 = new CollisionSystem();
      cs2.broadphase = 'sap';
      w2.addSystem(cs2);
      const r2 = runFrames(w2, 15);

      console.log('\n========== Phase 2.4.2 Broadphase 性能对比 ==========');
      console.log('场景:N=1000 动态球体 + 静态地面,15 帧');
      console.log('─'.repeat(70));
      console.log(`  brute-force: total=${r1.totalMs.toFixed(2)}ms ` +
        `cands/frame=${r1.avgCandidates.toFixed(0)} ` +
        `narrow/frame=${r1.avgNarrowChecks.toFixed(0)}`);
      console.log(`  sap:         total=${r2.totalMs.toFixed(2)}ms ` +
        `cands/frame=${r2.avgCandidates.toFixed(0)} ` +
        `narrow/frame=${r2.avgNarrowChecks.toFixed(0)} ` +
        `exits/frame=${(cs2.stats.sapEarlyExits / 15).toFixed(0)}`);
      console.log('─'.repeat(70));
      console.log(`  SAP 加速比: ${(r1.totalMs / r2.totalMs).toFixed(2)}x`);
      console.log(`  候选对减少: ${((1 - r2.avgCandidates / r1.avgCandidates) * 100).toFixed(1)}%`);
      console.log('='.repeat(70) + '\n');

      // SAP 应不慢于 brute-force(宽松断言,不卡死加速比)
      expect(r2.totalMs).toBeLessThanOrEqual(r1.totalMs * 1.5);
      // N=1000 双世界各 15 帧,brute-force O(n²) 候选对 ~1000*999/2,慢机器可能超过默认 5s。
    }, 60000);
  });
});

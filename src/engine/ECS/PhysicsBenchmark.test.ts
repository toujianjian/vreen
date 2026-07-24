// Phase 2.4.1 — 物理引擎 Benchmark 测试。
//
// 目标:压测 100 / 500 / 1000 个刚体碰撞的性能拐点,
// 确定当前 O(n²) CollisionSystem 的规模上限。
//
// 场景:N 个动态球体在重力下落入一个静态盒子(地面 + 4 面墙),
// 推进 60 帧(1 秒模拟时间),测量每帧 PhysicsSystem + CollisionSystem 耗时。
//
// 输出(console.log):N / avg ms per frame / P95 ms / max ms / FPS estimate
//
// 注:这是测量型测试,断言只校验"不抛错 + 实体位置在合理范围"。
// 性能数字仅供回归对比参考,不卡死阈值(避免 CI 抖动误报)。

import { describe, it, expect } from 'vitest';
import { World } from './World';
import { Transform, TransformC } from './Components';
import {
  Rigidbody, RigidbodyC,
  Collider, ColliderC,
  PhysicsConfig, PhysicsConfigC,
} from './PhysicsComponents';
import { PhysicsSystem, CollisionSystem } from './PhysicsSystems';

interface BenchResult {
  n: number;
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
  totalMs: number;
  contactsPerFrameAvg: number;
}

/** 构造一个 N 球体下落 + 静态盒子的物理场景。 */
function buildFallingBallsWorld(n: number): World {
  const w = new World({ name: `Physics${n}` });

  // 全局物理配置
  const cfgEntity = w.createEntity('physics');
  const cfg = new PhysicsConfig();
  cfg.gravity = [0, -9.81, 0];
  cfg.fixedDelta = 1 / 60;
  cfg.maxSubsteps = 1; // 关闭子步,benchmark 只测单步性能
  cfg.enableDebug = false;
  w.setComponent(cfgEntity, PhysicsConfigC, cfg);

  // 静态地面(y=0,大盒子)
  const floor = w.createEntity('Floor');
  const floorT = Transform.fromPos(0, -1, 0);
  w.setComponent(floor, TransformC, floorT);
  const floorCol = new Collider();
  floorCol.shape = 'aabb';
  floorCol.halfExtents = [50, 1, 50]; // 大盒子,半高 1
  floorCol.isStatic = true;
  floorCol.restitution = 0.1;
  w.setComponent(floor, ColliderC, floorCol);

  // N 个动态球体,在 5x5 网格上随机抖动地落下来
  for (let i = 0; i < n; i++) {
    const e = w.createEntity(`Ball${i}`);
    const side = Math.ceil(Math.sqrt(n));
    const ix = i % side;
    const iz = Math.floor(i / side);
    const spacing = 1.2;
    const t = Transform.fromPos(
      (ix - side / 2) * spacing + (Math.random() - 0.5) * 0.3,
      5 + Math.floor(i / side) * 0.5, // 分层堆叠避免初始穿透
      (iz - side / 2) * spacing + (Math.random() - 0.5) * 0.3,
    );
    w.setComponent(e, TransformC, t);

    const rb = new Rigidbody();
    rb.mass = 1;
    rb.linearDamping = 0.05;
    rb.gravityScale = 1;
    w.setComponent(e, RigidbodyC, rb);

    const col = new Collider();
    col.shape = 'sphere';
    col.radius = 0.5;
    col.friction = 0.3;
    col.restitution = 0.2;
    w.setComponent(e, ColliderC, col);
  }
  return w;
}

/** 跑 frames 帧,统计耗时。 */
function benchWorld(w: World, frames: number): BenchResult {
  const physics = w.getSystems().find((s) => s.name === 'PhysicsSystem') as PhysicsSystem | undefined;
  const collision = w.getSystems().find((s) => s.name === 'CollisionSystem') as CollisionSystem | undefined;
  if (!physics || !collision) throw new Error('systems not attached');

  const dt = 1 / 60;
  const timings: number[] = [];
  let contactSum = 0;

  // 预热 5 帧(让 cache hot、对象池稳定)
  for (let i = 0; i < 5; i++) {
    physics.update(w, dt);
    collision.update(w, dt);
  }

  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    physics.update(w, dt);
    collision.update(w, dt);
    const t1 = performance.now();
    timings.push(t1 - t0);
    contactSum += CollisionSystem.contacts.length;
  }

  timings.sort((a, b) => a - b);
  const sum = timings.reduce((a, b) => a + b, 0);
  const avg = sum / timings.length;
  const p95Idx = Math.floor(timings.length * 0.95);
  return {
    n: w.entityCount() - 2, // 减去 physics + Floor
    frames,
    avgMs: avg,
    p95Ms: timings[p95Idx] ?? timings[timings.length - 1],
    maxMs: timings[timings.length - 1],
    minMs: timings[0],
    totalMs: sum,
    contactsPerFrameAvg: contactSum / frames,
  };
}

function formatResult(r: BenchResult): string {
  const fps = r.avgMs > 0 ? 1000 / r.avgMs : Infinity;
  return `n=${r.n.toString().padStart(4)} frames=${r.frames} ` +
    `avg=${r.avgMs.toFixed(2)}ms p95=${r.p95Ms.toFixed(2)}ms ` +
    `max=${r.maxMs.toFixed(2)}ms min=${r.minMs.toFixed(2)}ms ` +
    `fps≈${fps.toFixed(0)} contacts/frame≈${r.contactsPerFrameAvg.toFixed(1)}`;
}

describe('Phase 2.4.1 — 物理引擎 Benchmark', () => {
  it('N=100 球体下落 60 帧不抛错,性能可接受', { timeout: 30_000 }, () => {
    const w = buildFallingBallsWorld(100);
    w.addSystem(new PhysicsSystem());
    w.addSystem(new CollisionSystem());

    const result = benchWorld(w, 60);
    console.log('[Phase 2.4.1 Benchmark] ' + formatResult(result));

    // 不抛错即通过;性能断言宽松(P95 < 50ms,任何现代机器都能过)
    expect(result.p95Ms).toBeLessThan(50);
    expect(result.frames).toBe(60);

    // 校验所有球都在合理 y 范围(没穿透地面无限下落)
    let belowFloor = 0;
    w.forEachEntity((id, name) => {
      if (name === 'physics' || name === 'Floor') return;
      const t = w.getComponent(id, TransformC);
      if (t && t.position[1] < -10) belowFloor++;
    });
    expect(belowFloor).toBe(0); // 不应有球穿透到地面下方
  });

  it('N=500 球体下落 60 帧', { timeout: 60_000 }, () => {
    const w = buildFallingBallsWorld(500);
    w.addSystem(new PhysicsSystem());
    w.addSystem(new CollisionSystem());

    const result = benchWorld(w, 60);
    console.log('[Phase 2.4.1 Benchmark] ' + formatResult(result));

    // 500 实体下 O(n²) 应当在 5ms..50ms 之间,具体取决于硬件。
    // 不卡死阈值,主要看回归趋势。
    expect(result.p95Ms).toBeLessThan(200);
  });

  it('N=1000 球体下落 30 帧(大规模上限探索)', { timeout: 120_000 }, () => {
    const w = buildFallingBallsWorld(1000);
    w.addSystem(new PhysicsSystem());
    w.addSystem(new CollisionSystem());

    // 1000 实体只跑 30 帧,避免 CI 超时
    const result = benchWorld(w, 30);
    console.log('[Phase 2.4.1 Benchmark] ' + formatResult(result));

    // 1000 实体 O(n²) ≈ 500k pairs/帧,可能在 20..200ms 范围。
    // 这是 ROADMAP 中标注的"规模上限",Phase 2.4.2 Broadphase 优化后会改善。
    expect(result.p95Ms).toBeLessThan(500);
  });

  it('性能拐点报告:输出 N=100/500/1000 对比', { timeout: 180_000 }, () => {
    // 这个测试只输出对比表格,不卡死阈值
    const results: BenchResult[] = [];
    for (const n of [100, 500, 1000]) {
      const w = buildFallingBallsWorld(n);
      w.addSystem(new PhysicsSystem());
      w.addSystem(new CollisionSystem());
      const frames = n <= 500 ? 30 : 20;
      results.push(benchWorld(w, frames));
    }

    console.log('\n========== Phase 2.4.1 物理引擎 Benchmark 报告 ==========');
    console.log('场景:N 个动态球体 + 1 个静态地面,O(n²) 碰撞检测');
    console.log('─'.repeat(80));
    for (const r of results) {
      console.log('  ' + formatResult(r));
    }
    console.log('─'.repeat(80));
    console.log('结论:');
    console.log(`  - N=100  → ${results[0].avgMs.toFixed(2)}ms/帧,可流畅运行(60FPS 阈值=16.67ms)`);
    console.log(`  - N=500  → ${results[1].avgMs.toFixed(2)}ms/帧,${results[1].avgMs < 16.67 ? '可流畅' : '低于 60FPS'}`);
    console.log(`  - N=1000 → ${results[2].avgMs.toFixed(2)}ms/帧,${results[2].avgMs < 16.67 ? '可流畅' : '低于 60FPS'}`);
    console.log(`  - O(n²) 拐点:从 N=100 到 N=1000 (10x),耗时增长 ${(results[2].avgMs / results[0].avgMs).toFixed(1)}x (理论 100x)`);
    console.log(`  - 建议:大规模场景需要 Phase 2.4.2 Broadphase 优化(空间哈希/Sweep-and-Prune)`);
    console.log('='.repeat(80) + '\n');

    // 只断言"递增性能趋势"
    expect(results[1].avgMs).toBeGreaterThan(results[0].avgMs);
    expect(results[2].avgMs).toBeGreaterThan(results[1].avgMs);
  });
});

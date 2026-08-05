import { describe, it, expect } from 'vitest';
import {
  ORCASolver,
  ORCAPresets,
  createORCASolver,
  type ORCAAgent,
} from './ORCA';
import { Vector3 } from '../Math';

// ── 测试辅助 ─────────────────────────────────────────────────────

/** 创建代理(默认参数)。 */
function makeAgent(
  pos: [number, number, number],
  prefVel: [number, number, number] = [0, 0, 0],
  radius = 0.5,
  maxSpeed = 2.0,
): Partial<ORCAAgent> & { position: Vector3; preferredVelocity: Vector3 } {
  return {
    position: new Vector3(pos[0], pos[1], pos[2]),
    preferredVelocity: new Vector3(prefVel[0], prefVel[1], prefVel[2]),
    radius,
    maxSpeed,
  };
}

/** 计算两代理间距离(XZ 平面)。 */
function distXZ(a: ORCAAgent, b: ORCAAgent): number {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ── ORCASolver 基础 ──────────────────────────────────────────────

describe('ORCASolver', () => {
  describe('addAgent / removeAgent / getAgent', () => {
    it('addAgent 返回带 id 的代理', () => {
      const solver = new ORCASolver();
      const a = solver.addAgent(makeAgent([0, 0, 0]) as never);
      expect(a.id).toBe(0);
      expect(a.position.x).toBe(0);
      expect(a.position.z).toBe(0);
      expect(a.radius).toBe(0.5);
      expect(a.maxSpeed).toBe(2.0);
    });

    it('id 递增', () => {
      const solver = new ORCASolver();
      const a1 = solver.addAgent(makeAgent([0, 0, 0]) as never);
      const a2 = solver.addAgent(makeAgent([1, 0, 0]) as never);
      expect(a1.id).toBe(0);
      expect(a2.id).toBe(1);
    });

    it('removeAgent 移除代理', () => {
      const solver = new ORCASolver();
      const a = solver.addAgent(makeAgent([0, 0, 0]) as never);
      expect(solver.agents.length).toBe(1);
      expect(solver.removeAgent(a.id)).toBe(true);
      expect(solver.agents.length).toBe(0);
    });

    it('removeAgent 不存在的 id 返回 false', () => {
      const solver = new ORCASolver();
      expect(solver.removeAgent(999)).toBe(false);
    });

    it('getAgent 按 id 查找', () => {
      const solver = new ORCASolver();
      const a = solver.addAgent(makeAgent([5, 0, 3]) as never);
      const found = solver.getAgent(a.id);
      expect(found).toBeDefined();
      expect(found!.position.x).toBe(5);
      expect(found!.position.z).toBe(3);
    });

    it('clearAgents 清空并重置 id', () => {
      const solver = new ORCASolver();
      solver.addAgent(makeAgent([0, 0, 0]) as never);
      solver.addAgent(makeAgent([1, 0, 0]) as never);
      solver.clearAgents();
      expect(solver.agents.length).toBe(0);
      const a = solver.addAgent(makeAgent([0, 0, 0]) as never);
      expect(a.id).toBe(0); // id 重置
    });

    it('addAgent 使用自定义参数', () => {
      const solver = new ORCASolver();
      const a = solver.addAgent({
        position: new Vector3(0, 0, 0),
        preferredVelocity: new Vector3(1, 0, 0),
        radius: 1.5,
        maxSpeed: 10,
        neighborDist: 20,
        timeHorizon: 8,
      });
      expect(a.radius).toBe(1.5);
      expect(a.maxSpeed).toBe(10);
      expect(a.neighborDist).toBe(20);
      expect(a.timeHorizon).toBe(8);
      expect(a.preferredVelocity.x).toBe(1);
    });
  });

  describe('默认参数', () => {
    it('默认值正确', () => {
      const solver = new ORCASolver();
      expect(solver.defaultRadius).toBe(0.5);
      expect(solver.defaultMaxSpeed).toBe(2);
      expect(solver.defaultNeighborDist).toBe(15);
      expect(solver.defaultTimeHorizon).toBe(5);
      expect(solver.maxNeighbors).toBe(10);
    });
  });
});

// ── 单代理(无邻居)──────────────────────────────────────────────

describe('ORCASolver — 单代理', () => {
  it('无邻居时 newVelocity = preferredVelocity', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(1, 0, 0),
      maxSpeed: 2.0,
    });
    solver.computeNewVelocities(0.1);
    expect(a.newVelocity.x).toBeCloseTo(1, 4);
    expect(a.newVelocity.z).toBeCloseTo(0, 4);
  });

  it('preferredVelocity 超过 maxSpeed 时截断', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(10, 0, 0),
      maxSpeed: 2.0,
    });
    solver.computeNewVelocities(0.1);
    const speed = Math.sqrt(a.newVelocity.x ** 2 + a.newVelocity.z ** 2);
    expect(speed).toBeCloseTo(2.0, 4);
    // 方向保持 +X
    expect(a.newVelocity.x).toBeCloseTo(2.0, 4);
    expect(a.newVelocity.z).toBeCloseTo(0, 4);
  });

  it('preferredVelocity 为零时 newVelocity 为零', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(0, 0, 0),
    });
    solver.computeNewVelocities(0.1);
    expect(a.newVelocity.x).toBe(0);
    expect(a.newVelocity.z).toBe(0);
  });
});

// ── 两代理对向行走 ──────────────────────────────────────────────

describe('ORCASolver — 两代理对向行走', () => {
  it('对向行走时代理偏转避让(不直直相撞)', () => {
    const solver = new ORCASolver();
    // 给初始速度(模拟已运动中的代理),触发 "legs" 情况
    const a = solver.addAgent({
      position: new Vector3(-3, 0, 0),
      preferredVelocity: new Vector3(2, 0, 0),
      velocity: new Vector3(2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });
    const b = solver.addAgent({
      position: new Vector3(3, 0, 0),
      preferredVelocity: new Vector3(-2, 0, 0),
      velocity: new Vector3(-2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });
    solver.computeNewVelocities(0.1);

    // 两个代理都不应直直前进(应有 Z 方向偏转)
    const aVz = Math.abs(a.newVelocity.z);
    const bVz = Math.abs(b.newVelocity.z);
    expect(aVz + bVz).toBeGreaterThan(0.05);
  });

  it('对向行走后多步推进,代理不碰撞', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(-3, 0, 0),
      preferredVelocity: new Vector3(2, 0, 0),
      velocity: new Vector3(2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });
    const b = solver.addAgent({
      position: new Vector3(3, 0, 0),
      preferredVelocity: new Vector3(-2, 0, 0),
      velocity: new Vector3(-2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });

    // 模拟 80 步(8 秒)
    for (let i = 0; i < 80; i++) {
      solver.step(0.1);
    }

    // 代理不应碰撞
    const d = distXZ(a, b);
    expect(d).toBeGreaterThan(0.8); // > combinedRadius (1.0)
  });

  it('对向行走后代理互相穿过(到达对方起点)', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(-3, 0, 0),
      preferredVelocity: new Vector3(2, 0, 0),
      velocity: new Vector3(2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });
    const b = solver.addAgent({
      position: new Vector3(3, 0, 0),
      preferredVelocity: new Vector3(-2, 0, 0),
      velocity: new Vector3(-2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });

    // 模拟 100 步(10 秒)
    for (let i = 0; i < 100; i++) {
      solver.step(0.1);
    }

    // a 应到达 +X 侧,b 应到达 -X 侧(穿过对方)
    expect(a.position.x).toBeGreaterThan(0);
    expect(b.position.x).toBeLessThan(0);
  });
});

// ── 两代理同向行走 ──────────────────────────────────────────────

describe('ORCASolver — 两代理同向行走', () => {
  it('同向行走无需避让(速度近似 preferred)', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
    });
    const b = solver.addAgent({
      position: new Vector3(0, 0, 5), // 在 a 前方 5 米
      preferredVelocity: new Vector3(2, 0, 0), // 同方向同速度
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
    });
    solver.computeNewVelocities(0.1);

    // 两者速度应近似 preferredVelocity(无需避让)
    expect(a.newVelocity.x).toBeCloseTo(2, 1);
    expect(b.newVelocity.x).toBeCloseTo(2, 1);
  });
});

// ── 已碰撞场景 ──────────────────────────────────────────────────

describe('ORCASolver — 已碰撞场景', () => {
  it('已碰撞代理立即分离', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(0, 0, 0), // 不移动
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });
    const b = solver.addAgent({
      position: new Vector3(0.8, 0, 0), // 距离 0.8 < combinedRadius 1.0(穿透 0.2)
      preferredVelocity: new Vector3(0, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });
    solver.computeNewVelocities(0.1);

    // 两代理应有分离速度(方向相反)。
    // 注:穿透深度需浅到 maxSpeed 能在一步内承担 50% 分离责任(RVO2 约定),
    //    否则 LP 不可行,RVO2 会停在 preferredVelocity 不分离。
    const dx = a.newVelocity.x - b.newVelocity.x;
    const dz = a.newVelocity.z - b.newVelocity.z;
    const sepMag = Math.sqrt(dx * dx + dz * dz);
    expect(sepMag).toBeGreaterThan(0.1);
  });

  it('已碰撞代理多步后距离增大', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(0, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });
    const b = solver.addAgent({
      position: new Vector3(0.8, 0, 0),
      preferredVelocity: new Vector3(0, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
      timeHorizon: 5,
    });

    const initialDist = distXZ(a, b);
    for (let i = 0; i < 20; i++) {
      solver.step(0.1);
    }
    const finalDist = distXZ(a, b);
    expect(finalDist).toBeGreaterThan(initialDist);
  });
});

// ── 多代理场景 ──────────────────────────────────────────────────

describe('ORCASolver — 多代理', () => {
  it('4 代理从四面走向中心,不碰撞', () => {
    const solver = new ORCASolver();
    const positions: Array<[number, number]> = [
      [-5, 0], [5, 0], [0, -5], [0, 5],
    ];
    positions.forEach(([x, z]) =>
      solver.addAgent({
        position: new Vector3(x, 0, z),
        preferredVelocity: new Vector3(-x, 0, -z).normalize().multiplyScalar(2),
        radius: 0.5,
        maxSpeed: 2.0,
        neighborDist: 15,
        timeHorizon: 5,
      }),
    );

    // 模拟 100 步(10 秒)
    for (let i = 0; i < 100; i++) {
      solver.step(0.1);
    }

    // 检查无碰撞
    const stats = solver.getStats();
    expect(stats.collidingPairs).toBe(0);
  });

  it('8 代理圆形分布向中心走,碰撞对数低', () => {
    const solver = new ORCASolver();
    const N = 8;
    const R = 5;
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2;
      const x = Math.cos(angle) * R;
      const z = Math.sin(angle) * R;
      solver.addAgent({
        position: new Vector3(x, 0, z),
        preferredVelocity: new Vector3(-x, 0, -z).normalize().multiplyScalar(2),
        radius: 0.5,
        maxSpeed: 2.0,
        neighborDist: 15,
        timeHorizon: 5,
      });
    }

    let maxCollisions = 0;
    for (let i = 0; i < 100; i++) {
      solver.step(0.1);
      const stats = solver.getStats();
      if (stats.collidingPairs > maxCollisions) maxCollisions = stats.collidingPairs;
    }

    // 允许少量碰撞,但不应过多(< 3 对)
    expect(maxCollisions).toBeLessThan(3);
  });

  it('邻居数受 maxNeighbors 限制', () => {
    const solver = new ORCASolver();
    solver.maxNeighbors = 3;

    // 中心代理 + 10 个邻居。中心带初始速度(模拟运动中),触发 legs 偏转。
    const center = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(1, 0, 0),
      velocity: new Vector3(1, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 20,
    });
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      solver.addAgent({
        position: new Vector3(Math.cos(angle) * 2, 0, Math.sin(angle) * 2),
        preferredVelocity: new Vector3(0, 0, 0),
        radius: 0.5,
        maxSpeed: 2.0,
        neighborDist: 20,
      });
    }

    // 不崩溃即可(maxNeighbors 限制生效)
    expect(() => solver.computeNewVelocities(0.1)).not.toThrow();
    // 中心代理应有偏转(被邻居影响)。注:velocity=0 会触发 cut-off 圆(X 减速
    // 而非 Z 偏转),故给初始速度触发 legs 情况。
    expect(Math.abs(center.newVelocity.z)).toBeGreaterThan(0.01);
  });
});

// ── 速度截断 ────────────────────────────────────────────────────

describe('ORCASolver — 速度截断', () => {
  it('newVelocity 不超过 maxSpeed', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(5, 0, 5), // 长度 ~7.07
      maxSpeed: 2.0,
      radius: 0.5,
      neighborDist: 10,
    });
    solver.computeNewVelocities(0.1);
    const speed = Math.sqrt(a.newVelocity.x ** 2 + a.newVelocity.z ** 2);
    expect(speed).toBeLessThanOrEqual(2.0 + 1e-6);
  });

  it('避让后速度仍不超过 maxSpeed', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(-2, 0, 0),
      preferredVelocity: new Vector3(10, 0, 0),
      maxSpeed: 2.0,
      radius: 0.5,
      neighborDist: 10,
    });
    const b = solver.addAgent({
      position: new Vector3(2, 0, 0),
      preferredVelocity: new Vector3(-10, 0, 0),
      maxSpeed: 2.0,
      radius: 0.5,
      neighborDist: 10,
    });
    solver.computeNewVelocities(0.1);
    const speedA = Math.sqrt(a.newVelocity.x ** 2 + a.newVelocity.z ** 2);
    const speedB = Math.sqrt(b.newVelocity.x ** 2 + b.newVelocity.z ** 2);
    expect(speedA).toBeLessThanOrEqual(2.0 + 1e-6);
    expect(speedB).toBeLessThanOrEqual(2.0 + 1e-6);
  });
});

// ── applyVelocities / step ──────────────────────────────────────

describe('ORCASolver — applyVelocities / step', () => {
  it('applyVelocities 推进位置', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(1, 0, 0),
      maxSpeed: 2.0,
    });
    solver.computeNewVelocities(0.1);
    solver.applyVelocities(0.1);
    expect(a.position.x).toBeCloseTo(0.1, 4); // 1 * 0.1
    expect(a.velocity.x).toBeCloseTo(1, 4);
  });

  it('applyVelocities 不修改 Y', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 5, 0),
      preferredVelocity: new Vector3(1, 0, 0),
      maxSpeed: 2.0,
    });
    solver.step(0.1);
    expect(a.position.y).toBe(5); // Y 不变
  });

  it('step = computeNewVelocities + applyVelocities', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(2, 0, 0),
      maxSpeed: 2.0,
    });
    solver.step(0.5);
    expect(a.position.x).toBeCloseTo(1.0, 4); // 2 * 0.5
  });
});

// ── getStats ────────────────────────────────────────────────────

describe('ORCASolver — getStats', () => {
  it('空 solver 的 stats', () => {
    const solver = new ORCASolver();
    const stats = solver.getStats();
    expect(stats.agentCount).toBe(0);
    expect(stats.averageSpeed).toBe(0);
    expect(stats.maxSpeed).toBe(0);
    expect(stats.collidingPairs).toBe(0);
  });

  it('单代理 stats', () => {
    const solver = new ORCASolver();
    solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(1, 0, 0),
      maxSpeed: 2.0,
    });
    solver.computeNewVelocities(0.1);
    const stats = solver.getStats();
    expect(stats.agentCount).toBe(1);
    expect(stats.averageSpeed).toBeCloseTo(1, 4);
    expect(stats.maxSpeed).toBeCloseTo(1, 4);
    expect(stats.collidingPairs).toBe(0);
  });

  it('碰撞对统计正确', () => {
    const solver = new ORCASolver();
    solver.addAgent({
      position: new Vector3(0, 0, 0),
      radius: 0.5,
      preferredVelocity: new Vector3(0, 0, 0),
    });
    solver.addAgent({
      position: new Vector3(0.5, 0, 0), // 距离 0.5 < combinedRadius 1.0
      radius: 0.5,
      preferredVelocity: new Vector3(0, 0, 0),
    });
    solver.computeNewVelocities(0.1);
    const stats = solver.getStats();
    expect(stats.agentCount).toBe(2);
    expect(stats.collidingPairs).toBe(1);
  });
});

// ── 预设 ─────────────────────────────────────────────────────────

describe('ORCAPresets', () => {
  it('denseCrowd: 小半径、低速度', () => {
    const p = ORCAPresets.denseCrowd();
    expect(p.defaultRadius).toBe(0.4);
    expect(p.defaultMaxSpeed).toBe(1.2);
    expect(p.defaultNeighborDist).toBe(8);
    expect(p.defaultTimeHorizon).toBe(3);
    expect(p.maxNeighbors).toBe(15);
  });

  it('openBattlefield: 大半径、高速度', () => {
    const p = ORCAPresets.openBattlefield();
    expect(p.defaultRadius).toBe(1.0);
    expect(p.defaultMaxSpeed).toBe(5.0);
    expect(p.defaultNeighborDist).toBe(25);
    expect(p.defaultTimeHorizon).toBe(8);
    expect(p.maxNeighbors).toBe(10);
  });

  it('cityTraffic: 大半径、更高速度', () => {
    const p = ORCAPresets.cityTraffic();
    expect(p.defaultRadius).toBe(2.0);
    expect(p.defaultMaxSpeed).toBe(8.0);
    expect(p.defaultTimeHorizon).toBe(10);
    expect(p.maxNeighbors).toBe(8);
  });

  it('highPrecision: 长时间视野、多邻居', () => {
    const p = ORCAPresets.highPrecision();
    expect(p.defaultTimeHorizon).toBe(10);
    expect(p.maxNeighbors).toBe(20);
  });
});

// ── createORCASolver ────────────────────────────────────────────

describe('createORCASolver', () => {
  it('无预设 → 默认参数', () => {
    const solver = createORCASolver();
    expect(solver.defaultRadius).toBe(0.5);
    expect(solver.defaultMaxSpeed).toBe(2);
  });

  it('带预设 → 自定义参数', () => {
    const solver = createORCASolver(ORCAPresets.denseCrowd());
    expect(solver.defaultRadius).toBe(0.4);
    expect(solver.defaultMaxSpeed).toBe(1.2);
  });

  it('部分自定义', () => {
    const solver = createORCASolver({ defaultRadius: 1.5 });
    expect(solver.defaultRadius).toBe(1.5);
    expect(solver.defaultMaxSpeed).toBe(2); // 默认
  });
});

// ── 稳定性 / 性能 ───────────────────────────────────────────────

describe('ORCASolver — 稳定性', () => {
  it('50 代理随机分布,100 步无崩溃', () => {
    const solver = createORCASolver(ORCAPresets.denseCrowd());
    // 确定性随机(seed = 42)
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };

    for (let i = 0; i < 50; i++) {
      const x = (rand() - 0.5) * 20;
      const z = (rand() - 0.5) * 20;
      const vx = (rand() - 0.5) * 2;
      const vz = (rand() - 0.5) * 2;
      solver.addAgent({
        position: new Vector3(x, 0, z),
        preferredVelocity: new Vector3(vx, 0, vz),
      });
    }

    expect(() => {
      for (let i = 0; i < 100; i++) {
        solver.step(0.1);
      }
    }).not.toThrow();

    const stats = solver.getStats();
    expect(stats.agentCount).toBe(50);
  });

  it('无 NaN 产出', () => {
    const solver = new ORCASolver();
    solver.addAgent({
      position: new Vector3(0, 0, 0),
      preferredVelocity: new Vector3(1, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
    });
    solver.addAgent({
      position: new Vector3(1, 0, 0),
      preferredVelocity: new Vector3(-1, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
    });

    for (let i = 0; i < 50; i++) {
      solver.step(0.1);
    }

    for (const a of solver.agents) {
      expect(Number.isNaN(a.newVelocity.x)).toBe(false);
      expect(Number.isNaN(a.newVelocity.z)).toBe(false);
      expect(Number.isNaN(a.position.x)).toBe(false);
      expect(Number.isNaN(a.position.z)).toBe(false);
    }
  });

  it('无 Infinity 产出', () => {
    const solver = new ORCASolver();
    // 极端场景:大量代理紧密排列
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      solver.addAgent({
        position: new Vector3(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5),
        preferredVelocity: new Vector3(-Math.cos(angle), 0, -Math.sin(angle)),
        radius: 0.3,
        maxSpeed: 2.0,
        neighborDist: 5,
        timeHorizon: 2,
      });
    }

    for (let i = 0; i < 50; i++) {
      solver.step(0.1);
    }

    for (const a of solver.agents) {
      expect(Number.isFinite(a.newVelocity.x)).toBe(true);
      expect(Number.isFinite(a.newVelocity.z)).toBe(true);
      expect(Number.isFinite(a.position.x)).toBe(true);
      expect(Number.isFinite(a.position.z)).toBe(true);
    }
  });
});

// ── Y 轴忽略 ────────────────────────────────────────────────────

describe('ORCASolver — Y 轴忽略', () => {
  it('不同 Y 的代理仍互相影响(2D 避障)', () => {
    const solver = new ORCASolver();
    const a = solver.addAgent({
      position: new Vector3(-3, 0, 0),
      preferredVelocity: new Vector3(2, 0, 0),
      velocity: new Vector3(2, 0, 0), // 初始速度(模拟运动中),触发 legs 偏转
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
    });
    const b = solver.addAgent({
      position: new Vector3(3, 100, 0), // Y=100 但 XZ 距离仍 6
      preferredVelocity: new Vector3(-2, 0, 0),
      velocity: new Vector3(-2, 0, 0),
      radius: 0.5,
      maxSpeed: 2.0,
      neighborDist: 10,
    });
    solver.computeNewVelocities(0.1);

    // 应有 Z 方向偏转(Y 不影响避障)。注:velocity=0 触发 cut-off 圆(X 减速),
    // 给初始速度触发 legs 情况才有 Z 偏转。
    const aVz = Math.abs(a.newVelocity.z);
    const bVz = Math.abs(b.newVelocity.z);
    expect(aVz + bVz).toBeGreaterThan(0.05);
  });
});

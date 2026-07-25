// FluidSimulation 测试 — SPH 流体模拟。
//
// 验证:
//   • 构造默认值 / 自定义选项
//   • addParticle / removeParticle / clear
//   • computeDensity — 单粒子自贡献 / 双粒子互相贡献
//   • computePressure — 状态方程 + 自由表面 P=0
//   • computeForces — 重力存在 / 远距离粒子无力互作用
//   • integrate — 半隐式 Euler 推进位置
//   • collideBounds — 穿透投影 + 速度反弹
//   • update — 完整 DSPH 一帧推进
//   • getMeshData — 数据扁平化
//   • fillBox — 均匀填充

import { describe, it, expect } from 'vitest';
import { FluidSimulation } from './FluidSimulation';
import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';

describe('FluidSimulation — 构造', () => {
  it('默认参数:水密度 / 9.8 重力 / 0.5 平滑半径', () => {
    const f = new FluidSimulation();
    expect(f.smoothingRadius).toBeCloseTo(0.5, 5);
    expect(f.restDensity).toBe(1000);
    expect(f.gasConstant).toBe(2000);
    expect(f.viscosity).toBeCloseTo(0.1, 5);
    expect(f.gravity.y).toBeCloseTo(-9.8, 5);
    expect(f.restitution).toBeCloseTo(0.5, 5);
    expect(f.mass).toBeCloseTo(0.02, 5);
    expect(f.particles.length).toBe(0);
  });

  it('自定义参数透传', () => {
    const f = new FluidSimulation({
      smoothingRadius: 1.0,
      restDensity: 500,
      gasConstant: 100,
      viscosity: 0.5,
      gravity: new Vector3(0, -5, 0),
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      restitution: 0.8,
      mass: 0.1,
      maxParticles: 50,
    });
    expect(f.smoothingRadius).toBe(1.0);
    expect(f.restDensity).toBe(500);
    expect(f.gasConstant).toBe(100);
    expect(f.viscosity).toBe(0.5);
    expect(f.gravity.y).toBe(-5);
    expect(f.bounds.min.x).toBe(-1);
    expect(f.restitution).toBeCloseTo(0.8, 5);
    expect(f.mass).toBeCloseTo(0.1, 5);
    expect(f.maxParticles).toBe(50);
  });

  it('setSmoothingRadius 更新核函数缓存', () => {
    const f = new FluidSimulation();
    expect(f.smoothingRadius).toBe(0.5);
    f.setSmoothingRadius(2.0);
    expect(f.smoothingRadius).toBe(2.0);
  });

  it('setSmoothingRadius 非正值抛错', () => {
    const f = new FluidSimulation();
    expect(() => f.setSmoothingRadius(0)).toThrow(/must be > 0/);
    expect(() => f.setSmoothingRadius(-1)).toThrow(/must be > 0/);
  });
});

describe('FluidSimulation — 粒子管理', () => {
  it('addParticle 返回索引,位置/速度克隆', () => {
    const f = new FluidSimulation();
    const pos = new Vector3(1, 2, 3);
    const vel = new Vector3(0, -1, 0);
    const i = f.addParticle(pos, vel);
    expect(i).toBe(0);
    expect(f.particles.length).toBe(1);
    // 修改原向量不影响粒子
    pos.x = 99;
    expect(f.particles[0].position.x).toBe(1);
    expect(f.particles[0].velocity.y).toBe(-1);
    expect(f.particles[0].mass).toBeCloseTo(0.02, 5);
  });

  it('addParticle 默认速度为零', () => {
    const f = new FluidSimulation();
    f.addParticle(new Vector3());
    expect(f.particles[0].velocity.lengthSq()).toBe(0);
  });

  it('addParticle 达到 maxParticles 返回 -1', () => {
    const f = new FluidSimulation({ maxParticles: 2 });
    expect(f.addParticle(new Vector3())).toBe(0);
    expect(f.addParticle(new Vector3())).toBe(1);
    expect(f.addParticle(new Vector3())).toBe(-1);
    expect(f.particles.length).toBe(2);
  });

  it('removeParticle swap-with-tail', () => {
    const f = new FluidSimulation();
    f.addParticle(new Vector3(0, 0, 0));
    f.addParticle(new Vector3(1, 1, 1));
    f.addParticle(new Vector3(2, 2, 2));
    // 移除中间一个 → 最后一个补位
    f.removeParticle(1);
    expect(f.particles.length).toBe(2);
    // 现在索引 1 应该是原来的最后一个 (2,2,2)
    expect(f.particles[1].position.x).toBe(2);
    // 索引 0 保持不变
    expect(f.particles[0].position.x).toBe(0);
  });

  it('removeParticle 越界抛错', () => {
    const f = new FluidSimulation();
    expect(() => f.removeParticle(0)).toThrow(/out of range/);
    expect(() => f.removeParticle(-1)).toThrow(/out of range/);
  });

  it('clear 清空所有粒子', () => {
    const f = new FluidSimulation();
    f.addParticle(new Vector3());
    f.addParticle(new Vector3());
    f.clear();
    expect(f.particles.length).toBe(0);
  });
});

describe('FluidSimulation — 密度计算', () => {
  it('单粒子密度 = m * W_poly6(0, h) = m * K * h^6', () => {
    const f = new FluidSimulation({ smoothingRadius: 0.5, mass: 0.02 });
    f.addParticle(new Vector3(0, 0, 0));
    f.computeDensity();
    // W_poly6(0) = 315/(64π h^9) * h^6 = 315/(64π h^3)
    const expected = 0.02 * 315 / (64 * Math.PI * Math.pow(0.5, 3));
    expect(f.particles[0].density).toBeCloseTo(expected, 5);
  });

  it('远距离粒子(>h)不贡献密度', () => {
    const f = new FluidSimulation({ smoothingRadius: 0.5, mass: 0.02 });
    f.addParticle(new Vector3(0, 0, 0));
    f.addParticle(new Vector3(10, 0, 0)); // 远超 h
    f.computeDensity();
    // 第一个粒子密度应等于单粒子自贡献
    const expected = 0.02 * 315 / (64 * Math.PI * Math.pow(0.5, 3));
    expect(f.particles[0].density).toBeCloseTo(expected, 5);
  });

  it('近邻粒子互相贡献密度', () => {
    const f = new FluidSimulation({ smoothingRadius: 1.0, mass: 1.0 });
    f.addParticle(new Vector3(0, 0, 0));
    f.addParticle(new Vector3(0.5, 0, 0)); // 距离 0.5 < h=1
    f.computeDensity();
    // 两粒子密度应相等(对称)
    expect(f.particles[0].density).toBeCloseTo(f.particles[1].density, 5);
    // 且大于单粒子自贡献
    const single = 1.0 * 315 / (64 * Math.PI * Math.pow(1.0, 3));
    expect(f.particles[0].density).toBeGreaterThan(single);
  });
});

describe('FluidSimulation — 压力计算', () => {
  it('密度高于静止密度 → 正压力', () => {
    const f = new FluidSimulation({ restDensity: 100, gasConstant: 50 });
    f.addParticle(new Vector3());
    f.particles[0].density = 200;
    f.computePressure();
    expect(f.particles[0].pressure).toBeCloseTo(50 * (200 - 100), 5);
  });

  it('密度低于静止密度 → 压力为 0(自由表面)', () => {
    const f = new FluidSimulation({ restDensity: 100, gasConstant: 50 });
    f.addParticle(new Vector3());
    f.particles[0].density = 50;
    f.computePressure();
    expect(f.particles[0].pressure).toBe(0);
  });

  it('密度等于静止密度 → 压力为 0', () => {
    const f = new FluidSimulation({ restDensity: 100, gasConstant: 50 });
    f.addParticle(new Vector3());
    f.particles[0].density = 100;
    f.computePressure();
    expect(f.particles[0].pressure).toBe(0);
  });
});

describe('FluidSimulation — 力计算', () => {
  it('重力被累加到 force', () => {
    const f = new FluidSimulation({
      gravity: new Vector3(0, -10, 0),
      mass: 2,
    });
    f.addParticle(new Vector3());
    f.particles[0].density = 1000; // 避免后续除零
    f.particles[0].pressure = 0;
    f.computeForces();
    // 重力 = m * g = 2 * -10 = -20
    expect(f.particles[0].force.y).toBeCloseTo(-20, 5);
  });

  it('远距离粒子无力互作用,仅重力', () => {
    const f = new FluidSimulation({
      smoothingRadius: 0.1,
      gravity: new Vector3(0, -10, 0),
      mass: 1,
    });
    f.addParticle(new Vector3(0, 0, 0));
    f.addParticle(new Vector3(100, 0, 0)); // 超出 h
    f.particles[0].density = 1000;
    f.particles[1].density = 1000;
    f.computeForces();
    // 两粒子力都应等于重力 (1*-10 = -10)
    expect(f.particles[0].force.y).toBeCloseTo(-10, 5);
    expect(f.particles[1].force.y).toBeCloseTo(-10, 5);
    // X/Z 方向无外力
    expect(f.particles[0].force.x).toBeCloseTo(0, 5);
    expect(f.particles[0].force.z).toBeCloseTo(0, 5);
  });
});

describe('FluidSimulation — 积分', () => {
  it('integrate 半隐式 Euler: v += a*dt, x += v*dt', () => {
    const f = new FluidSimulation({ mass: 1, gravity: new Vector3() });
    f.addParticle(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    // 设定一个已知力
    f.particles[0].force.set(0, 10, 0);
    f.integrate(0.1);
    // a = F/m = 10, v = (1, 0+10*0.1, 0) = (1, 1, 0)
    expect(f.particles[0].velocity.y).toBeCloseTo(1, 5);
    // x = (0+1*0.1, 0+1*0.1, 0) = (0.1, 0.1, 0)
    expect(f.particles[0].position.x).toBeCloseTo(0.1, 5);
    expect(f.particles[0].position.y).toBeCloseTo(0.1, 5);
    // 力被清零
    expect(f.particles[0].force.lengthSq()).toBe(0);
  });
});

describe('FluidSimulation — 边界碰撞', () => {
  it('穿透下界 → 投影 + 速度反弹', () => {
    const f = new FluidSimulation({
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      restitution: 0.5,
    });
    f.addParticle(new Vector3(-2, 0, 0), new Vector3(-5, 0, 0));
    f.collideBounds();
    expect(f.particles[0].position.x).toBe(-1);
    // 速度反向 * 0.5 = 2.5
    expect(f.particles[0].velocity.x).toBeCloseTo(2.5, 5);
  });

  it('穿透上界 → 投影 + 速度反弹', () => {
    const f = new FluidSimulation({
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      restitution: 0.5,
    });
    f.addParticle(new Vector3(2, 0, 0), new Vector3(5, 0, 0));
    f.collideBounds();
    expect(f.particles[0].position.x).toBe(1);
    expect(f.particles[0].velocity.x).toBeCloseTo(-2.5, 5);
  });

  it('盒内粒子不移动', () => {
    const f = new FluidSimulation({
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
    });
    f.addParticle(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
    f.collideBounds();
    expect(f.particles[0].position.x).toBe(0);
    expect(f.particles[0].velocity.x).toBe(1);
  });

  it('恢复系数为 0 → 速度归零', () => {
    const f = new FluidSimulation({
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      restitution: 0,
    });
    f.addParticle(new Vector3(-2, 0, 0), new Vector3(-5, 0, 0));
    f.collideBounds();
    expect(f.particles[0].velocity.x).toBe(0);
  });
});

describe('FluidSimulation — update 完整步骤', () => {
  it('update 不抛错,位置/速度有更新', () => {
    const f = new FluidSimulation({
      gravity: new Vector3(0, -10, 0),
      mass: 1,
    });
    f.addParticle(new Vector3(0, 0, 0));
    f.update(0.01);
    // 至少重力应该使粒子有 -Y 速度
    expect(f.particles[0].velocity.y).toBeLessThan(0);
  });

  it('update 把粒子限制在边界内', () => {
    const f = new FluidSimulation({
      bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      gravity: new Vector3(0, -100, 0), // 强重力快速触底
      mass: 1,
    });
    f.addParticle(new Vector3(0, 0.9, 0));
    // 跑足够多帧让粒子触底
    for (let i = 0; i < 100; i++) f.update(0.016);
    expect(f.particles[0].position.y).toBeGreaterThanOrEqual(-1);
    expect(f.particles[0].position.y).toBeLessThanOrEqual(1);
  });
});

describe('FluidSimulation — getMeshData', () => {
  it('返回扁平化 positions/velocities/densities', () => {
    const f = new FluidSimulation();
    f.addParticle(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
    f.addParticle(new Vector3(7, 8, 9), new Vector3(10, 11, 12));
    f.particles[0].density = 100;
    f.particles[1].density = 200;
    const d = f.getMeshData();
    expect(d.count).toBe(2);
    expect(d.positions.length).toBe(6);
    expect(d.velocities.length).toBe(6);
    expect(d.densities.length).toBe(2);
    expect(d.positions[0]).toBe(1);
    expect(d.positions[5]).toBe(9);
    expect(d.velocities[2]).toBe(6);
    expect(d.densities[1]).toBe(200);
  });

  it('空粒子 → count=0,空数组', () => {
    const f = new FluidSimulation();
    const d = f.getMeshData();
    expect(d.count).toBe(0);
    expect(d.positions.length).toBe(0);
  });
});

describe('FluidSimulation — fillBox', () => {
  it('按 spacing 均匀填充', () => {
    const f = new FluidSimulation();
    // 2x2x2 网格 = 8 粒子
    const added = f.fillBox(
      new Vector3(0, 0, 0),
      new Vector3(1, 1, 1),
      1.0,
    );
    expect(added).toBe(8);
    expect(f.particles.length).toBe(8);
  });

  it('spacing 非正抛错', () => {
    const f = new FluidSimulation();
    expect(() => f.fillBox(new Vector3(), new Vector3(1, 1, 1), 0)).toThrow(/must be > 0/);
    expect(() => f.fillBox(new Vector3(), new Vector3(1, 1, 1), -1)).toThrow(/must be > 0/);
  });
});

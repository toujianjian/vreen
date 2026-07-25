import { describe, it, expect } from 'vitest';
import { WaterSimulation } from './WaterSimulation';

describe('WaterSimulation', () => {
  it('默认分辨率为 64', () => {
    const sim = new WaterSimulation();
    expect(sim.resolution).toBe(64);
    expect(sim.heightField.length).toBe(64 * 64);
    expect(sim.previousField.length).toBe(64 * 64);
  });

  it('create 重置分辨率与字段', () => {
    const sim = new WaterSimulation(8);
    sim.create(16);
    expect(sim.resolution).toBe(16);
    expect(sim.heightField.length).toBe(16 * 16);
  });

  it('最小分辨率钳制为 2', () => {
    const sim = new WaterSimulation(0);
    expect(sim.resolution).toBeGreaterThanOrEqual(2);
  });

  it('初始高度场全 0', () => {
    const sim = new WaterSimulation(8);
    for (let i = 0; i < sim.heightField.length; i++) {
      expect(sim.heightField[i]).toBe(0);
    }
  });

  it('addRipple 在指定位置增加高度', () => {
    const sim = new WaterSimulation(8);
    sim.addRipple(4, 4, 1.5);
    expect(sim.heightField[4 * 8 + 4]).toBe(1.5);
  });

  it('addRipple 越界不抛错', () => {
    const sim = new WaterSimulation(8);
    expect(() => sim.addRipple(-1, 0, 1)).not.toThrow();
    expect(() => sim.addRipple(100, 0, 1)).not.toThrow();
  });

  it('update 推进模拟,波纹扩散', () => {
    const sim = new WaterSimulation(16, 0.02);
    sim.addRipple(8, 8, 10);
    const centerBefore = sim.getHeight(8, 8);
    expect(centerBefore).toBeCloseTo(10, 5);
    // 推进若干步
    sim.update(2);
    // 中心高度应衰减(波动 + 阻尼)
    const centerAfter = sim.getHeight(8, 8);
    expect(centerAfter).toBeLessThan(centerBefore);
    // 邻居应被激发(波动扩散)
    const neighbor = sim.getHeight(9, 8);
    expect(neighbor).not.toBe(0);
  });

  it('update dt<=0 不变化', () => {
    const sim = new WaterSimulation(8);
    sim.addRipple(4, 4, 2);
    const before = sim.heightField.slice();
    sim.update(0);
    for (let i = 0; i < before.length; i++) {
      expect(sim.heightField[i]).toBe(before[i]);
    }
  });

  it('update 极大 dt 不卡死(限步)', () => {
    const sim = new WaterSimulation(8);
    expect(() => sim.update(1000)).not.toThrow();
  });

  it('getHeight 双线性插值', () => {
    const sim = new WaterSimulation(4);
    // 4x4 网格,在 (1,1) 与 (2,1) 设不同值
    sim.addRipple(1, 1, 0);
    sim.addRipple(2, 1, 10);
    // 中点应介于 0 和 10 之间
    const mid = sim.getHeight(1.5, 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(10);
    expect(mid).toBeCloseTo(5, 5);
  });

  it('getHeight 越界钳制到边界', () => {
    const sim = new WaterSimulation(4);
    sim.addRipple(0, 0, 5);
    // 负坐标钳制到 0
    expect(sim.getHeight(-1, -1)).toBe(5);
  });

  it('getNormal 返回归一化向量', () => {
    const sim = new WaterSimulation(8);
    sim.addRipple(4, 4, 1);
    const n = sim.getNormal(4, 4);
    const len = Math.hypot(n.x, n.y, n.z);
    expect(len).toBeCloseTo(1, 4);
    // 平坦处法线 z 应接近 1
    const n2 = sim.getNormal(0, 0);
    expect(n2.z).toBeCloseTo(1, 4);
  });

  it('reset 清零高度场', () => {
    const sim = new WaterSimulation(8);
    sim.addRipple(4, 4, 5);
    sim.addRipple(2, 2, 3);
    sim.reset();
    for (let i = 0; i < sim.heightField.length; i++) {
      expect(sim.heightField[i]).toBe(0);
    }
    for (let i = 0; i < sim.previousField.length; i++) {
      expect(sim.previousField[i]).toBe(0);
    }
  });

  it('阻尼衰减能量', () => {
    const sim = new WaterSimulation(16, 0.5);
    sim.addRipple(8, 8, 10);
    // 多步后峰值应显著衰减
    sim.update(20);
    let peak = 0;
    for (let i = 0; i < sim.heightField.length; i++) {
      const v = Math.abs(sim.heightField[i]);
      if (v > peak) peak = v;
    }
    expect(peak).toBeLessThan(5);
  });

  it('无阻尼时能量近似守恒(波传播)', () => {
    const sim = new WaterSimulation(16, 0);
    sim.addRipple(8, 8, 10);
    let before = 0;
    for (let i = 0; i < sim.heightField.length; i++) {
      before += Math.abs(sim.heightField[i]);
    }
    sim.update(4);
    let after = 0;
    for (let i = 0; i < sim.heightField.length; i++) {
      after += Math.abs(sim.heightField[i]);
    }
    // 无阻尼时总能量应大致保持(允许数值误差)
    expect(after).toBeGreaterThan(before * 0.5);
  });
});

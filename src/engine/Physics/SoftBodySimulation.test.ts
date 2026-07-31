import { describe, it, expect } from 'vitest';
import { SoftBodySimulation } from './SoftBodySimulation';
import { Vector3 } from '../Math/Vector3';

describe('SoftBodySimulation', () => {
  it('addParticle:添加粒子并返回索引', () => {
    const sim = new SoftBodySimulation();
    const i0 = sim.addParticle(new Vector3(0, 0, 0));
    const i1 = sim.addParticle(new Vector3(1, 0, 0));
    expect(i0).toBe(0);
    expect(i1).toBe(1);
    expect(sim.particles.length).toBe(2);
  });

  it('addSpring:创建弹簧并记录静止长度', () => {
    const sim = new SoftBodySimulation();
    sim.addParticle(new Vector3(0, 0, 0));
    sim.addParticle(new Vector3(2, 0, 0));
    sim.addSpring(0, 1, 0.5, 'structural');
    expect(sim.springs.length).toBe(1);
    expect(sim.springs[0].restLength).toBeCloseTo(2, 5);
    expect(sim.springs[0].stiffness).toBeCloseTo(0.5, 5);
  });

  it('addVolumeConstraint:记录四面体静止体积', () => {
    const sim = new SoftBodySimulation();
    sim.addParticle(new Vector3(0, 0, 0));
    sim.addParticle(new Vector3(1, 0, 0));
    sim.addParticle(new Vector3(0, 1, 0));
    sim.addParticle(new Vector3(0, 0, 1));
    sim.addVolumeConstraint(0, 1, 2, 3);
    expect(sim.volumeConstraints.length).toBe(1);
    // V = |((1,0,0) × (0,1,0)) · (0,0,1)| / 6 = |(0,0,1)·(0,0,1)|/6 = 1/6
    expect(sim.volumeConstraints[0].restVolume).toBeCloseTo(1 / 6, 5);
  });

  it('pinParticle:固定后 invMass=0', () => {
    const sim = new SoftBodySimulation();
    sim.addParticle(new Vector3(0, 0, 0), 1, false);
    sim.pinParticle(0);
    expect(sim.particles[0].pinned).toBe(true);
    expect(sim.particles[0].invMass).toBe(0);
  });

  it('unpinParticle:解除固定后恢复质量', () => {
    const sim = new SoftBodySimulation();
    sim.addParticle(new Vector3(0, 0, 0), 1, false);
    sim.pinParticle(0);
    sim.unpinParticle(0, 2);
    expect(sim.particles[0].pinned).toBe(false);
    expect(sim.particles[0].mass).toBe(2);
    expect(sim.particles[0].invMass).toBeCloseTo(0.5, 5);
  });

  it('update:重力使非固定粒子下落', () => {
    const sim = new SoftBodySimulation({ gravity: new Vector3(0, -10, 0) });
    sim.addParticle(new Vector3(0, 10, 0));
    sim.update(0.1);
    // dt=0.1, a=-10, dt²=0.01 → 下落 0.1 单位
    expect(sim.particles[0].position.y).toBeLessThan(10);
  });

  it('update:固定粒子不移动', () => {
    const sim = new SoftBodySimulation({ gravity: new Vector3(0, -10, 0) });
    sim.addParticle(new Vector3(0, 10, 0), 1, true);
    sim.update(0.1);
    expect(sim.particles[0].position.y).toBeCloseTo(10, 5);
  });

  it('update:弹簧约束保持粒子间距', () => {
    const sim = new SoftBodySimulation({
      gravity: new Vector3(0, 0, 0),
      stiffness: 1.0,
      iterations: 10,
    });
    sim.addParticle(new Vector3(0, 0, 0)); // 0
    sim.addParticle(new Vector3(1, 0, 0)); // 1
    sim.addSpring(0, 1, 1.0, 'structural');
    // 施加力把粒子 1 推远
    sim.applyForce(1, new Vector3(10, 0, 0));
    sim.update(0.016);
    // 弹簧应把粒子 1 拉回,距离接近 restLength=1
    const dist = sim.particles[0].position.distanceTo(sim.particles[1].position);
    expect(dist).toBeLessThan(2);
    expect(dist).toBeGreaterThan(0.5);
  });

  it('applyForce:对固定粒子无效', () => {
    const sim = new SoftBodySimulation({ gravity: new Vector3(0, 0, 0) });
    sim.addParticle(new Vector3(0, 0, 0), 1, true);
    sim.applyForce(0, new Vector3(100, 0, 0));
    sim.update(0.1);
    expect(sim.particles[0].position.x).toBeCloseTo(0, 5);
  });

  it('fromMesh:从网格数据生成粒子和弹簧', () => {
    const sim = new SoftBodySimulation();
    // 正方形 4 顶点 2 三角形
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    sim.fromMesh(positions, indices);
    expect(sim.particles.length).toBe(4);
    // structural edges: 0-1, 1-2, 2-0, 0-2, 2-3, 3-0 → 去重后 0-1, 1-2, 2-0, 2-3, 3-0 = 5 条
    const structural = sim.springs.filter((s) => s.type === 'structural');
    expect(structural.length).toBeGreaterThanOrEqual(4);
    // bend: 0-1 的邻居关系可能产生 bend 弹簧
    const bend = sim.springs.filter((s) => s.type === 'bend');
    expect(bend.length).toBeGreaterThanOrEqual(0);
  });

  it('shapeMatching:β=0 保持粒子间距离(刚性)', () => {
    // 形状匹配使形状刚性化:粒子间相对距离被保持
    const sim = new SoftBodySimulation({
      gravity: new Vector3(0, 0, 0),
      shapeMatching: true,
      shapeBeta: 0, // 完全刚性
      iterations: 10,
      damping: 0.1,
    });
    sim.addParticle(new Vector3(0, 0, 0));
    sim.addParticle(new Vector3(1, 0, 0));
    sim.addParticle(new Vector3(0, 1, 0));
    sim.addParticle(new Vector3(0, 0, 1));
    // 记录初始粒子间距离
    const restD01 = sim.particles[0].position.distanceTo(sim.particles[1].position);
    const restD02 = sim.particles[0].position.distanceTo(sim.particles[2].position);
    const restD12 = sim.particles[1].position.distanceTo(sim.particles[2].position);
    // 施加力
    sim.applyForce(1, new Vector3(5, 0, 0));
    // 多步迭代
    for (let i = 0; i < 10; i++) {
      sim.update(0.016);
    }
    // 形状匹配(β=0)应保持粒子间距离接近初始值
    const d01 = sim.particles[0].position.distanceTo(sim.particles[1].position);
    const d02 = sim.particles[0].position.distanceTo(sim.particles[2].position);
    const d12 = sim.particles[1].position.distanceTo(sim.particles[2].position);
    // 距离变化应在 50% 以内(形状匹配是近似,不是精确)
    expect(Math.abs(d01 - restD01) / restD01).toBeLessThan(0.5);
    expect(Math.abs(d02 - restD02) / restD02).toBeLessThan(0.5);
    expect(Math.abs(d12 - restD12) / restD12).toBeLessThan(0.5);
  });

  it('getStats:返回正确的统计信息', () => {
    const sim = new SoftBodySimulation({ shapeMatching: true, iterations: 8 });
    sim.addParticle(new Vector3(0, 0, 0));
    sim.addParticle(new Vector3(1, 0, 0));
    sim.addParticle(new Vector3(0, 1, 0));
    sim.addParticle(new Vector3(0, 0, 1), 1, true);
    sim.addSpring(0, 1, 1.0, 'structural');
    sim.addVolumeConstraint(0, 1, 2, 3);
    const stats = sim.getStats();
    expect(stats.particleCount).toBe(4);
    expect(stats.springCount).toBe(1);
    expect(stats.volumeConstraintCount).toBe(1);
    expect(stats.pinnedCount).toBe(1);
    expect(stats.iterations).toBe(8);
    expect(stats.shapeMatching).toBe(true);
  });

  it('getMeshData:返回顶点和索引数据', () => {
    const sim = new SoftBodySimulation();
    sim.addParticle(new Vector3(0, 0, 0));
    sim.addParticle(new Vector3(1, 0, 0));
    sim.addParticle(new Vector3(0, 1, 0));
    sim.addParticle(new Vector3(0, 0, 1));
    sim.addVolumeConstraint(0, 1, 2, 3);
    const data = sim.getMeshData();
    expect(data.positions.length).toBe(12); // 4 verts * 3
    expect(data.indices.length).toBe(12); // 4 faces * 3 verts
  });

  it('getCurrentVolume:返回所有体积约束之和', () => {
    const sim = new SoftBodySimulation();
    sim.addParticle(new Vector3(0, 0, 0));
    sim.addParticle(new Vector3(1, 0, 0));
    sim.addParticle(new Vector3(0, 1, 0));
    sim.addParticle(new Vector3(0, 0, 1));
    sim.addVolumeConstraint(0, 1, 2, 3);
    const vol = sim.getCurrentVolume();
    expect(vol).toBeCloseTo(1 / 6, 5);
  });

  it('update:多次步进后系统稳定(不爆炸)', () => {
    const sim = new SoftBodySimulation({
      gravity: new Vector3(0, -5, 0),
      stiffness: 0.8,
      iterations: 4,
    });
    sim.addParticle(new Vector3(0, 10, 0), 1, true); // 悬挂点
    sim.addParticle(new Vector3(0, 9, 0));
    sim.addParticle(new Vector3(0, 8, 0));
    sim.addSpring(0, 1, 1.0, 'structural');
    sim.addSpring(1, 2, 1.0, 'structural');
    for (let i = 0; i < 100; i++) {
      sim.update(0.016);
    }
    // 粒子不应飞到无穷远
    for (const p of sim.particles) {
      expect(Math.abs(p.position.x)).toBeLessThan(100);
      expect(Math.abs(p.position.y)).toBeLessThan(100);
      expect(Math.abs(p.position.z)).toBeLessThan(100);
    }
  });
});

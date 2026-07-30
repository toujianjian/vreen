// ClothSimulation 测试 — Verlet 积分布料模拟。
//
// 验证:
//   • 构造默认值 / 自定义选项
//   • createGrid — 顶点数 / 中心位置 / 约束类型计数(structural/shear/bend)
//   • addConstraint / removeConstraint
//   • pinParticle / unpinParticle / pinnedPoints 同步
//   • setGravity / setWind / setDamping / setStiffness / setIterations / setSelfCollision
//   • verletIntegrate — 重力下落 / pinned 不动 / 加速度清零
//   • solveConstraints — 保持静止长度
//   • applyWind — 风力推动
//   • applySelfCollision — 过近粒子推开
//   • collideWithSphere / collideWithBox
//   • update — 挂角下垂
//   • getParticles / getConstraints / getMeshData / getStats

import { describe, it, expect } from 'vitest';
import { ClothSimulation } from './ClothSimulation';
import { Vector3 } from '../Math/Vector3';

describe('ClothSimulation — 构造', () => {
  it('默认参数:9.8 重力 / 0 风力 / 0.01 阻尼 / 1.0 刚度 / 4 迭代', () => {
    const cloth = new ClothSimulation();
    expect(cloth.gravity.y).toBeCloseTo(-9.8, 5);
    expect(cloth.wind.lengthSq()).toBe(0);
    expect(cloth.damping).toBeCloseTo(0.01, 5);
    expect(cloth.stiffness).toBeCloseTo(1.0, 5);
    expect(cloth.iterations).toBe(4);
    expect(cloth.selfCollision).toBe(false);
    expect(cloth.selfCollisionDist).toBeCloseTo(0.1, 5);
    expect(cloth.mass).toBe(1);
    expect(cloth.pinnedPoints.size).toBe(0);
  });

  it('自定义参数透传', () => {
    const cloth = new ClothSimulation({
      gravity: new Vector3(0, -5, 0),
      wind: new Vector3(1, 0, 0),
      damping: 0.05,
      stiffness: 0.8,
      iterations: 10,
      selfCollision: true,
      selfCollisionDist: 0.2,
      mass: 2,
    });
    expect(cloth.gravity.y).toBe(-5);
    expect(cloth.wind.x).toBe(1);
    expect(cloth.damping).toBeCloseTo(0.05, 5);
    expect(cloth.stiffness).toBeCloseTo(0.8, 5);
    expect(cloth.iterations).toBe(10);
    expect(cloth.selfCollision).toBe(true);
    expect(cloth.selfCollisionDist).toBeCloseTo(0.2, 5);
    expect(cloth.mass).toBe(2);
  });

  it('构造选项中的 Vector3 被克隆(不共享引用)', () => {
    const g = new Vector3(0, -9.8, 0);
    const cloth = new ClothSimulation({ gravity: g });
    g.y = -100;
    expect(cloth.gravity.y).toBeCloseTo(-9.8, 5);
  });
});

describe('ClothSimulation — createGrid', () => {
  it('创建 cols × rows 顶点网格', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 5, 5);
    expect(cloth.particles.length).toBe(25);
    expect(cloth.gridCols).toBe(5);
    expect(cloth.gridRows).toBe(5);
    expect(cloth.width).toBe(2);
    expect(cloth.height).toBe(2);
  });

  it('顶点中心在原点,XY 平面', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    const positions = cloth.particles.map((p) => p.position);
    const xs = positions.map((p) => p.x).sort((a, b) => a - b);
    const ys = positions.map((p) => p.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-1);
    expect(xs[3]).toBeCloseTo(1);
    expect(ys[0]).toBeCloseTo(-1);
    expect(ys[3]).toBeCloseTo(1);
    expect(positions.every((p) => p.z === 0)).toBe(true);
  });

  it('约束按类型生成(structural / shear / bend)', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3); // 3x3 顶点
    const structural = cloth.constraints.filter((c) => c.type === 'structural').length;
    const shear = cloth.constraints.filter((c) => c.type === 'shear').length;
    const bend = cloth.constraints.filter((c) => c.type === 'bend').length;
    // 3x3: structural=12, shear=8, bend=6
    expect(structural).toBe(12);
    expect(shear).toBe(8);
    expect(bend).toBe(6);
    expect(cloth.constraints.length).toBe(26);
  });

  it('所有约束 restLength 取当前两点距离', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    for (const c of cloth.constraints) {
      const a = cloth.particles[c.p1].position;
      const b = cloth.particles[c.p2].position;
      expect(c.restLength).toBeCloseTo(a.distanceTo(b), 6);
    }
  });

  it('拒绝 width/height <= 0', () => {
    const cloth = new ClothSimulation();
    expect(() => cloth.createGrid(0, 2, 2, 2)).toThrowError(/width\/height/);
  });

  it('拒绝 cols/rows < 2', () => {
    const cloth = new ClothSimulation();
    expect(() => cloth.createGrid(2, 2, 1, 2)).toThrowError(/cols\/rows/);
  });

  it('重新 createGrid 清空旧的 pinnedPoints', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    cloth.pinParticle(0);
    expect(cloth.pinnedPoints.size).toBe(1);
    cloth.createGrid(2, 2, 3, 3);
    expect(cloth.pinnedPoints.size).toBe(0);
    expect(cloth.particles[0].pinned).toBe(false);
  });
});

describe('ClothSimulation — addConstraint / removeConstraint', () => {
  it('addConstraint 越界索引抛错', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    expect(() => cloth.addConstraint(0, 999, 'structural')).toThrowError(/out of range/);
  });

  it('addConstraint 拒绝 p1 === p2', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    expect(() => cloth.addConstraint(0, 0, 'structural')).toThrowError(/p1 === p2/);
  });

  it('addConstraint 自定义 stiffness', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    const n0 = cloth.constraints.length;
    cloth.addConstraint(0, 3, 'bend', 0.5);
    expect(cloth.constraints.length).toBe(n0 + 1);
    expect(cloth.constraints[n0].stiffness).toBeCloseTo(0.5, 5);
    expect(cloth.constraints[n0].type).toBe('bend');
  });

  it('removeConstraint 移除指定索引', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    const n0 = cloth.constraints.length;
    cloth.removeConstraint(0);
    expect(cloth.constraints.length).toBe(n0 - 1);
  });

  it('removeConstraint 越界抛错', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    expect(() => cloth.removeConstraint(999)).toThrowError(/out of range/);
  });
});

describe('ClothSimulation — pinParticle / unpinParticle', () => {
  it('pinParticle 设置 pinned 并加入 pinnedPoints', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    cloth.pinParticle(4);
    expect(cloth.particles[4].pinned).toBe(true);
    expect(cloth.pinnedPoints.has(4)).toBe(true);
    expect(cloth.pinnedPoints.size).toBe(1);
  });

  it('unpinParticle 解除固定并移出 pinnedPoints', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    cloth.pinParticle(4);
    cloth.unpinParticle(4);
    expect(cloth.particles[4].pinned).toBe(false);
    expect(cloth.pinnedPoints.has(4)).toBe(false);
  });

  it('pinParticle 越界抛错', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    expect(() => cloth.pinParticle(999)).toThrowError(/out of range/);
  });

  it('unpinParticle 越界抛错', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    expect(() => cloth.unpinParticle(999)).toThrowError(/out of range/);
  });
});

describe('ClothSimulation — setter 链式', () => {
  it('setGravity / setWind / setDamping / setStiffness / setIterations / setSelfCollision', () => {
    const cloth = new ClothSimulation();
    cloth
      .setGravity(new Vector3(0, -5, 0))
      .setWind(new Vector3(2, 0, 0))
      .setDamping(0.2)
      .setStiffness(0.7)
      .setIterations(8)
      .setSelfCollision(true, 0.3);
    expect(cloth.gravity.y).toBe(-5);
    expect(cloth.wind.x).toBe(2);
    expect(cloth.damping).toBeCloseTo(0.2, 5);
    expect(cloth.stiffness).toBeCloseTo(0.7, 5);
    expect(cloth.iterations).toBe(8);
    expect(cloth.selfCollision).toBe(true);
    expect(cloth.selfCollisionDist).toBeCloseTo(0.3, 5);
  });

  it('setSelfCollision(false) 只关闭不修改 dist', () => {
    const cloth = new ClothSimulation({ selfCollisionDist: 0.25 });
    cloth.setSelfCollision(false);
    expect(cloth.selfCollision).toBe(false);
    expect(cloth.selfCollisionDist).toBeCloseTo(0.25, 5);
  });

  it('setWind 复制值(不共享引用)', () => {
    const cloth = new ClothSimulation();
    const w = new Vector3(1, 2, 3);
    cloth.setWind(w);
    w.x = 999;
    expect(cloth.wind.x).toBe(1);
  });
});

describe('ClothSimulation — verletIntegrate', () => {
  it('重力让非固定粒子下落', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3(0, -9.8, 0), damping: 0, iterations: 1 });
    cloth.createGrid(2, 2, 2, 2);
    // 累加重力到 acceleration
    for (const p of cloth.particles) {
      if (!p.pinned) p.acceleration.add(cloth.gravity);
    }
    const y0 = cloth.particles[0].position.y;
    cloth.verletIntegrate(1 / 60);
    expect(cloth.particles[0].position.y).toBeLessThan(y0);
  });

  it('pinned 粒子位置不变', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3(0, -9.8, 0) });
    cloth.createGrid(2, 2, 2, 2);
    cloth.pinParticle(0);
    const p0 = cloth.particles[0].position.clone();
    for (const p of cloth.particles) {
      if (!p.pinned) p.acceleration.add(cloth.gravity);
    }
    cloth.verletIntegrate(1 / 60);
    expect(cloth.particles[0].position.x).toBeCloseTo(p0.x);
    expect(cloth.particles[0].position.y).toBeCloseTo(p0.y);
    expect(cloth.particles[0].position.z).toBeCloseTo(p0.z);
  });

  it('积分后加速度清零', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    cloth.particles[0].acceleration.set(1, 0, 0);
    cloth.verletIntegrate(1 / 60);
    expect(cloth.particles[0].acceleration.x).toBe(0);
  });

  it('pinned 粒子的加速度也被清零', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    cloth.pinParticle(0);
    cloth.particles[0].acceleration.set(5, 5, 5);
    cloth.verletIntegrate(1 / 60);
    expect(cloth.particles[0].acceleration.x).toBe(0);
    expect(cloth.particles[0].acceleration.y).toBe(0);
    expect(cloth.particles[0].acceleration.z).toBe(0);
  });
});

describe('ClothSimulation — solveConstraints', () => {
  it('所有粒子 pin 后,约束保持静止长度', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3(), damping: 0, iterations: 8 });
    cloth.createGrid(2, 2, 4, 4);
    for (let i = 0; i < cloth.particles.length; i++) cloth.pinParticle(i);
    cloth.solveConstraints();
    for (const c of cloth.constraints) {
      const a = cloth.particles[c.p1].position;
      const b = cloth.particles[c.p2].position;
      expect(a.distanceTo(b)).toBeCloseTo(c.restLength, 4);
    }
  });

  it('拉伸两个粒子,约束把它们拉回静止长度', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3(), damping: 0, iterations: 16 });
    cloth.createGrid(2, 2, 2, 2);
    // 取一条 structural 约束,把 b 端拉开
    const c = cloth.constraints[0];
    const restLen = c.restLength;
    cloth.particles[c.p2].position.x += 10; // 大幅拉伸
    cloth.solveConstraints();
    const a = cloth.particles[c.p1].position;
    const b = cloth.particles[c.p2].position;
    // 多次迭代后应接近 restLength(两端都未 pin,各移动一半)
    expect(a.distanceTo(b)).toBeCloseTo(restLen, 1);
  });
});

describe('ClothSimulation — applyWind', () => {
  it('风力累加到非固定粒子 acceleration', () => {
    const cloth = new ClothSimulation({ wind: new Vector3(5, 0, 0) });
    cloth.createGrid(2, 2, 2, 2);
    cloth.applyWind(1 / 60);
    expect(cloth.particles[0].acceleration.x).toBeCloseTo(5, 5);
  });

  it('风力跳过 pinned 粒子', () => {
    const cloth = new ClothSimulation({ wind: new Vector3(5, 0, 0) });
    cloth.createGrid(2, 2, 2, 2);
    cloth.pinParticle(0);
    cloth.applyWind(1 / 60);
    expect(cloth.particles[0].acceleration.x).toBe(0);
  });

  it('wind 为零时不修改 acceleration', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    cloth.applyWind(1 / 60);
    expect(cloth.particles[0].acceleration.lengthSq()).toBe(0);
  });
});

describe('ClothSimulation — applySelfCollision', () => {
  it('把过近粒子对推开到 selfCollisionDist', () => {
    const cloth = new ClothSimulation({ selfCollisionDist: 1.0 });
    cloth.createGrid(10, 10, 2, 2);
    // 把粒子 0 和 1 强行放到一起
    cloth.particles[0].position.set(0, 0, 0);
    cloth.particles[1].position.set(0.1, 0, 0);
    cloth.applySelfCollision();
    const d = cloth.particles[0].position.distanceTo(cloth.particles[1].position);
    expect(d).toBeGreaterThanOrEqual(1.0 - 1e-6);
  });

  it('已经足够远的粒子不动', () => {
    const cloth = new ClothSimulation({ selfCollisionDist: 0.1 });
    cloth.createGrid(2, 2, 2, 2);
    cloth.particles[0].position.set(0, 0, 0);
    cloth.particles[1].position.set(5, 0, 0);
    const before = cloth.particles[0].position.clone();
    cloth.applySelfCollision();
    expect(cloth.particles[0].position.equals(before)).toBe(true);
  });

  it('pinned 粒子不被推开(由对端承担全部修正)', () => {
    const cloth = new ClothSimulation({ selfCollisionDist: 1.0 });
    cloth.createGrid(10, 10, 2, 2);
    cloth.pinParticle(0);
    cloth.particles[0].position.set(0, 0, 0);
    cloth.particles[1].position.set(0.1, 0, 0);
    const pinnedPos = cloth.particles[0].position.clone();
    cloth.applySelfCollision();
    expect(cloth.particles[0].position.equals(pinnedPos)).toBe(true);
    // 粒子 1 被推到距粒子 0 至少 1.0
    const d = cloth.particles[0].position.distanceTo(cloth.particles[1].position);
    expect(d).toBeGreaterThanOrEqual(1.0 - 1e-6);
  });
});

describe('ClothSimulation — collideWithSphere', () => {
  it('把陷入球内的粒子推到球面外', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 5, 5);
    cloth.particles[0].position.set(0.1, 0, 0);
    cloth.collideWithSphere(new Vector3(0, 0, 0), 0.5);
    const d = cloth.particles[0].position.distanceTo(new Vector3(0, 0, 0));
    expect(d).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });

  it('跳过 pinned 粒子', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 2, 2);
    cloth.pinParticle(0);
    cloth.particles[0].position.set(0, 0, 0);
    const before = cloth.particles[0].position.clone();
    cloth.collideWithSphere(new Vector3(0, 0, 0), 1);
    expect(cloth.particles[0].position.equals(before)).toBe(true);
  });

  it('球外粒子不动', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 2, 2);
    cloth.particles[0].position.set(10, 0, 0);
    const before = cloth.particles[0].position.clone();
    cloth.collideWithSphere(new Vector3(0, 0, 0), 1);
    expect(cloth.particles[0].position.equals(before)).toBe(true);
  });
});

describe('ClothSimulation — collideWithBox', () => {
  it('把盒内粒子推到最近面外', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 3, 3);
    // 盒子 [-1,1]³,粒子放盒内中心
    cloth.particles[0].position.set(0, 0, 0);
    cloth.collideWithBox(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    // 被推到某个面上(某一坐标 = ±1)
    const p = cloth.particles[0].position;
    const onFace =
      Math.abs(p.x - 1) < 1e-6 || Math.abs(p.x + 1) < 1e-6 ||
      Math.abs(p.y - 1) < 1e-6 || Math.abs(p.y + 1) < 1e-6 ||
      Math.abs(p.z - 1) < 1e-6 || Math.abs(p.z + 1) < 1e-6;
    expect(onFace).toBe(true);
  });

  it('盒外粒子不动', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 3, 3);
    cloth.particles[0].position.set(5, 5, 5);
    const before = cloth.particles[0].position.clone();
    cloth.collideWithBox(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    expect(cloth.particles[0].position.equals(before)).toBe(true);
  });

  it('跳过 pinned 粒子', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 3, 3);
    cloth.pinParticle(0);
    cloth.particles[0].position.set(0, 0, 0);
    const before = cloth.particles[0].position.clone();
    cloth.collideWithBox(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    expect(cloth.particles[0].position.equals(before)).toBe(true);
  });

  it('靠近 X 面的粒子被推到 X 面', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 3, 3);
    // 放在靠近 min.x 面:到 min.x 距离最小
    cloth.particles[0].position.set(-0.9, 0, 0);
    cloth.collideWithBox(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    expect(cloth.particles[0].position.x).toBeCloseTo(-1, 6);
  });
});

describe('ClothSimulation — update', () => {
  it('挂住顶部两角,重力让中部下垂', () => {
    const cloth = new ClothSimulation({
      gravity: new Vector3(0, -9.8, 0),
      damping: 0.01,
      iterations: 8,
    });
    cloth.createGrid(2, 2, 5, 5);
    // 顶部两角:(0,0) 和 (4,0)
    cloth.pinParticle(0);
    cloth.pinParticle(4);
    const midIdx = 2 * 5 + 2; // (2,2)
    const midY0 = cloth.particles[midIdx].position.y;
    for (let i = 0; i < 60; i++) cloth.update(1 / 60);
    const midY1 = cloth.particles[midIdx].position.y;
    expect(midY1).toBeLessThan(midY0);
  });

  it('update 后加速度清零', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    cloth.update(1 / 60);
    expect(cloth.particles[0].acceleration.lengthSq()).toBe(0);
  });

  it('启用 selfCollision 时 update 调用自碰撞', () => {
    const cloth = new ClothSimulation({
      gravity: new Vector3(),
      damping: 0,
      iterations: 1,
      selfCollision: true,
      selfCollisionDist: 2.0,
    });
    cloth.createGrid(10, 10, 2, 2);
    // 先让粒子 0 和 1 接近
    cloth.particles[0].position.set(0, 0, 0);
    cloth.particles[1].position.set(0.1, 0, 0);
    cloth.update(1 / 60);
    const d = cloth.particles[0].position.distanceTo(cloth.particles[1].position);
    // 自碰撞会把它们推开(注意重力为 0,但 Verlet 仍可能微动)
    expect(d).toBeGreaterThan(0.1);
  });

  it('dt 超过上限被钳制(不抛错)', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    expect(() => cloth.update(10)).not.toThrow();
  });
});

describe('ClothSimulation — getParticles / getConstraints', () => {
  it('返回内部数组引用', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 3, 3);
    expect(cloth.getParticles()).toBe(cloth.particles);
    expect(cloth.getConstraints()).toBe(cloth.constraints);
  });
});

describe('ClothSimulation — getMeshData', () => {
  it('返回 positions / indices / normals / gridCols / gridRows', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 4, 4);
    const data = cloth.getMeshData();
    expect(data.positions.length).toBe(16 * 3);
    // 4x4 grid → 3x3 cells → 18 三角形 → 54 索引
    expect(data.indices.length).toBe(3 * 3 * 6);
    expect(data.normals.length).toBe(16 * 3);
    expect(data.gridCols).toBe(4);
    expect(data.gridRows).toBe(4);
  });

  it('小网格用 Uint16Array', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 4, 4);
    expect(cloth.getMeshData().indices instanceof Uint16Array).toBe(true);
  });

  it('大网格用 Uint32Array', () => {
    const cloth = new ClothSimulation();
    // 200x200 顶点 → 199*199*6 = 237606 > 65536
    cloth.createGrid(10, 10, 200, 200);
    expect(cloth.getMeshData().indices instanceof Uint32Array).toBe(true);
  });

  it('positions 反映 particles 当前位置', () => {
    const cloth = new ClothSimulation();
    cloth.createGrid(2, 2, 2, 2);
    cloth.particles[0].position.set(5, 6, 7);
    const data = cloth.getMeshData();
    expect(data.positions[0]).toBeCloseTo(5);
    expect(data.positions[1]).toBeCloseTo(6);
    expect(data.positions[2]).toBeCloseTo(7);
  });

  it('静态 XY 平面网格法线近似 +Z(非边界顶点)', () => {
    const cloth = new ClothSimulation({ gravity: new Vector3() });
    cloth.createGrid(2, 2, 4, 4);
    const data = cloth.getMeshData();
    const vIdx = 1 * 4 + 1; // (i=1, j=1)
    const o = vIdx * 3;
    expect(Math.abs(data.normals[o])).toBeLessThan(0.5);
    expect(Math.abs(data.normals[o + 1])).toBeLessThan(0.5);
    expect(data.normals[o + 2]).toBeGreaterThan(0.5);
  });
});

describe('ClothSimulation — getStats', () => {
  it('返回正确统计', () => {
    const cloth = new ClothSimulation({
      iterations: 6,
      selfCollision: true,
      selfCollisionDist: 0.3,
    });
    cloth.createGrid(2, 2, 3, 3);
    cloth.pinParticle(0);
    cloth.pinParticle(8);
    const stats = cloth.getStats();
    expect(stats.particleCount).toBe(9);
    expect(stats.constraintCount).toBe(26);
    expect(stats.pinnedCount).toBe(2);
    expect(stats.iterations).toBe(6);
    expect(stats.selfCollision).toBe(true);
    expect(stats.selfCollisionDist).toBeCloseTo(0.3, 5);
    expect(stats.gridCols).toBe(3);
    expect(stats.gridRows).toBe(3);
  });
});

// DestructionSystem 测试 — 网格破碎系统。
//
// 验证:
//   • 构造默认值 / 自定义选项
//   • shatter — 碎片数量 / 初始速度方向 / maxFragments 上限
//   • slice — 平面切割 / 内外侧分离 / 完全在一侧
//   • update — 物理积分 / 重力 / 寿命衰减
//   • applyForce — 力累加
//   • removeFragment / clear / getActiveFragments / getStats

import { describe, it, expect } from 'vitest';
import { DestructionSystem } from './DestructionSystem';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math/Vector3';
import { Plane } from '../Math/Plane';

/** 构造单位立方体(12 三角形,非索引化)。 */
function makeUnitBox(): BufferGeometry {
  const positions = new Float32Array([
    1, 0, 0,  1, 1, 0,  1, 1, 1,   1, 0, 0,  1, 1, 1,  1, 0, 1,
    0, 0, 1,  0, 1, 1,  0, 1, 0,   0, 0, 1,  0, 1, 0,  0, 0, 0,
    0, 1, 0,  0, 1, 1,  1, 1, 1,   0, 1, 0,  1, 1, 1,  1, 1, 0,
    0, 0, 1,  0, 0, 0,  1, 0, 0,   0, 0, 1,  1, 0, 0,  1, 0, 1,
    1, 0, 1,  1, 1, 1,  0, 1, 1,   1, 0, 1,  0, 1, 1,  0, 0, 1,
    0, 0, 0,  0, 1, 0,  1, 1, 0,   0, 0, 0,  1, 1, 0,  1, 0, 0,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.computeBoundingBox();
  return g;
}

describe('DestructionSystem — 构造', () => {
  it('默认参数', () => {
    const d = new DestructionSystem();
    expect(d.maxFragments).toBe(256);
    expect(d.gravity.y).toBeCloseTo(-9.8, 5);
    expect(d.defaultLifetime).toBe(5);
    expect(d.defaultMass).toBe(1);
    expect(d.fragments.length).toBe(0);
  });

  it('自定义参数透传', () => {
    const d = new DestructionSystem({
      maxFragments: 10,
      gravity: new Vector3(0, -5, 0),
      defaultLifetime: 3,
      defaultMass: 2,
    });
    expect(d.maxFragments).toBe(10);
    expect(d.gravity.y).toBe(-5);
    expect(d.defaultLifetime).toBe(3);
    expect(d.defaultMass).toBe(2);
  });
});

describe('DestructionSystem — shatter', () => {
  it('产生指定数量的碎片', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    const added = d.shatter(g, new Vector3(0.5, 0.5, 0.5), 5, 4);
    expect(added).toBeGreaterThan(0);
    expect(d.fragments.length).toBe(added);
    expect(added).toBeLessThanOrEqual(4);
  });

  it('碎片初始速度沿(站点 - 冲击点)方向', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    // 冲击点在原点,站点在 +X 方向
    // 由于 Voronoi 站点是随机的,这里只验证速度大小 = impactForce
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 7.5, 3);
    for (const f of d.fragments) {
      const speed = f.velocity.length();
      expect(speed).toBeCloseTo(7.5, 5);
    }
  });

  it('碎片有非零角速度', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 5, 3);
    // 角速度模长应该 > 0(impactForce * 0.5 量级)
    for (const f of d.fragments) {
      expect(f.angularVelocity.lengthSq()).toBeGreaterThan(0);
    }
  });

  it('maxFragments 上限生效', () => {
    const d = new DestructionSystem({ maxFragments: 2 });
    const g = makeUnitBox();
    const added = d.shatter(g, new Vector3(0.5, 0.5, 0.5), 1, 10);
    expect(added).toBeLessThanOrEqual(2);
    expect(d.fragments.length).toBeLessThanOrEqual(2);
  });

  it('fragmentCount <= 0 抛错', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    expect(() => d.shatter(g, new Vector3(), 1, 0)).toThrow(/must be > 0/);
    expect(() => d.shatter(g, new Vector3(), 1, -1)).toThrow(/must be > 0/);
  });

  it('impactForce < 0 抛错', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    expect(() => d.shatter(g, new Vector3(), -1, 1)).toThrow(/must be >= 0/);
  });

  it('碎片几何都是非索引化', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 1, 3);
    for (const f of d.fragments) {
      expect(f.mesh.index).toBeNull();
      expect(f.mesh.attributes.position).toBeDefined();
    }
  });

  it('碎片 active=true,lifetime=maxLifetime', () => {
    const d = new DestructionSystem({ defaultLifetime: 7 });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 1, 2);
    for (const f of d.fragments) {
      expect(f.active).toBe(true);
      expect(f.lifetime).toBe(7);
      expect(f.maxLifetime).toBe(7);
    }
  });
});

describe('DestructionSystem — slice', () => {
  it('用 X=0.5 平面切单位立方体 → 两个碎片', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    // 平面 normal=(1,0,0),经过点 (0.5,0,0):constant = -(1*0.5) = -0.5
    const plane = new Plane(new Vector3(1, 0, 0), -0.5);
    const [inside, outside] = d.slice(g, plane);
    expect(inside).not.toBeNull();
    expect(outside).not.toBeNull();
    // 内侧 = X <= 0.5,外侧 = X > 0.5
    // 立方体被中分,两块都有三角形
    expect(inside!.attributes.position.count).toBeGreaterThan(0);
    expect(outside!.attributes.position.count).toBeGreaterThan(0);
    // 都是 3 的倍数
    expect(inside!.attributes.position.count % 3).toBe(0);
    expect(outside!.attributes.position.count % 3).toBe(0);
  });

  it('平面在几何外 → 一侧为 null', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    // 平面 X = 10,整个立方体在内侧
    const plane = new Plane(new Vector3(1, 0, 0), -10);
    const [inside, outside] = d.slice(g, plane);
    expect(inside).not.toBeNull();
    expect(outside).toBeNull();
    // 内侧 = 原几何整体(36 顶点)
    expect(inside!.attributes.position.count).toBe(36);
  });

  it('平面正好切过三角形 → 产生新顶点', () => {
    const d = new DestructionSystem();
    // 单个三角形 (-1,0,0), (1,0,0), (0,2,0)
    const positions = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.computeBoundingBox();
    // X=0 平面切这个三角形
    const plane = new Plane(new Vector3(1, 0, 0), 0);
    const [inside, outside] = d.slice(g, plane);
    expect(inside).not.toBeNull();
    expect(outside).not.toBeNull();
    // 三角形被切成两块,总顶点数 > 3(因为产生了新顶点)
    const total = inside!.attributes.position.count + outside!.attributes.position.count;
    expect(total).toBeGreaterThan(3);
  });

  it('空几何 → 两端都为 null', () => {
    const d = new DestructionSystem();
    const g = new BufferGeometry();
    const plane = new Plane(new Vector3(1, 0, 0), 0);
    const [inside, outside] = d.slice(g, plane);
    expect(inside).toBeNull();
    expect(outside).toBeNull();
  });
});

describe('DestructionSystem — update', () => {
  it('重力使碎片下落', () => {
    const d = new DestructionSystem({
      gravity: new Vector3(0, -10, 0),
      defaultMass: 1,
    });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 2);
    // 记录初始 Y
    const y0 = d.fragments[0].position.y;
    d.update(0.1);
    // 重力使 Y 减小
    expect(d.fragments[0].position.y).toBeLessThan(y0);
    // 速度 Y < 0
    expect(d.fragments[0].velocity.y).toBeLessThan(0);
  });

  it('寿命衰减,过期 active=false', () => {
    const d = new DestructionSystem({ defaultLifetime: 0.5 });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 2);
    expect(d.fragments[0].active).toBe(true);
    // 推进 0.6 秒(分多帧,每帧 dt 上限 1/30)
    for (let i = 0; i < 30; i++) d.update(0.05);
    // 总推进时间 > 0.5s,应该过期
    expect(d.fragments[0].active).toBe(false);
    expect(d.fragments[0].lifetime).toBe(0);
  });

  it('applyForce 累加力,update 后清零', () => {
    const d = new DestructionSystem({
      gravity: new Vector3(), // 关闭重力便于观察
      defaultMass: 1,
    });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 1);
    d.applyForce(0, new Vector3(10, 0, 0));
    // dt=0.01 < 1/30 上限,确保不被截断
    d.update(0.01);
    // a = F/m = 10, v.x = 10*0.01 = 0.1
    expect(d.fragments[0].velocity.x).toBeCloseTo(0.1, 5);
    // 力被清零
    expect(d.fragments[0].force.lengthSq()).toBe(0);
  });

  it('角速度推进旋转四元数', () => {
    const d = new DestructionSystem({
      gravity: new Vector3(),
      defaultMass: 1,
    });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 1);
    // 手动设置角速度(绕 Y 轴 → 四元数只有 y/w 分量变化)
    d.fragments[0].angularVelocity.set(0, 1, 0); // 绕 Y 轴
    const q0 = d.fragments[0].rotation.clone();
    d.update(0.1);
    // 绕 Y 轴旋转 → y 分量应变化(x/z 保持 0)
    expect(d.fragments[0].rotation.y).not.toBe(q0.y);
    expect(d.fragments[0].rotation.w).not.toBe(q0.w);
  });
});

describe('DestructionSystem — 碎片管理', () => {
  it('removeFragment swap-with-tail', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 3);
    expect(d.fragments.length).toBe(3);
    const lastFragment = d.fragments[2];
    d.removeFragment(0);
    expect(d.fragments.length).toBe(2);
    // 索引 0 现在应该是原来的最后一个
    expect(d.fragments[0]).toBe(lastFragment);
  });

  it('removeFragment 越界抛错', () => {
    const d = new DestructionSystem();
    expect(() => d.removeFragment(0)).toThrow(/out of range/);
    expect(() => d.removeFragment(-1)).toThrow(/out of range/);
  });

  it('clear 清空所有碎片', () => {
    const d = new DestructionSystem();
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 3);
    d.clear();
    expect(d.fragments.length).toBe(0);
  });

  it('getActiveFragments 过滤过期', () => {
    const d = new DestructionSystem({ defaultLifetime: 0.3 });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 3);
    expect(d.getActiveFragments().length).toBe(3);
    // 推进让所有碎片过期
    for (let i = 0; i < 30; i++) d.update(0.05);
    expect(d.getActiveFragments().length).toBe(0);
  });

  it('getStats 返回正确统计', () => {
    const d = new DestructionSystem({ defaultLifetime: 0.3 });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 3);
    let stats = d.getStats();
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(3);
    expect(stats.expired).toBe(0);
    // 推进让所有碎片过期
    for (let i = 0; i < 30; i++) d.update(0.05);
    stats = d.getStats();
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(0);
    expect(stats.expired).toBe(3);
  });

  it('applyForce 越界抛错', () => {
    const d = new DestructionSystem();
    expect(() => d.applyForce(0, new Vector3())).toThrow(/out of range/);
  });

  it('applyForce 对非活跃碎片无效', () => {
    const d = new DestructionSystem({
      gravity: new Vector3(),
      defaultLifetime: 0.3,
    });
    const g = makeUnitBox();
    d.shatter(g, new Vector3(0.5, 0.5, 0.5), 0, 1);
    // 让碎片过期
    for (let i = 0; i < 30; i++) d.update(0.05);
    expect(d.fragments[0].active).toBe(false);
    // 力应保持 0
    d.applyForce(0, new Vector3(10, 0, 0));
    expect(d.fragments[0].force.lengthSq()).toBe(0);
  });
});

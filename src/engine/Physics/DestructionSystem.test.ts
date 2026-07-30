// DestructionSystem 测试 — 物体破坏系统。
//
// 验证:
//   • 构造默认值 / registerDestructible / unregisterDestructible
//   • applyDamage 减血量 + 血量归零自动破碎
//   • applyForce 冲击力达阈值自动破碎
//   • breakObject 生成碎片 + 标记 isBroken
//   • slice 平面切片产生两块碎片
//   • shatter 指定碎片数碎裂
//   • deform 就地形变顶点
//   • update 重力积分 / 寿命衰减 / 角速度积分 / 过期移除
//   • 碎片管理 / 统计 / maxFragments 上限

import { describe, it, expect } from 'vitest';
import {
  DestructionSystem,
  type Destructible,
  type SlicePlane,
} from './DestructionSystem';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math/Vector3';

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
  g.computeBoundingSphere();
  return g;
}

/** 构造一个可破坏物体。 */
function makeDestructible(id: number, opts: Partial<Destructible> = {}): Destructible {
  return {
    id,
    mesh: makeUnitBox(),
    position: new Vector3(0, 0, 0),
    health: 100,
    maxHealth: 100,
    breakForce: 10,
    material: 'stone',
    isBroken: false,
    fragments: [],
    ...opts,
  };
}

describe('DestructionSystem — 构造与注册', () => {
  it('默认参数', () => {
    const d = new DestructionSystem();
    expect(d.maxFragments).toBe(256);
    expect(d.breakThreshold).toBe(10);
    expect(d.gravity.y).toBeCloseTo(-9.8, 5);
    expect(d.destructibles.size).toBe(0);
    expect(d.fragments.length).toBe(0);
    expect(d.slicePlane).toBeNull();
  });

  it('registerDestructible 注册并 getDestructible 查询', () => {
    const d = new DestructionSystem();
    const obj = makeDestructible(1);
    d.registerDestructible(1, obj);
    expect(d.destructibles.size).toBe(1);
    expect(d.getDestructible(1)).toBe(obj);
    expect(d.getDestructible(99)).toBeUndefined();
  });

  it('registerDestructible 覆盖同 id', () => {
    const d = new DestructionSystem();
    const a = makeDestructible(1, { material: 'a' });
    const b = makeDestructible(1, { material: 'b' });
    d.registerDestructible(1, a);
    d.registerDestructible(1, b);
    expect(d.destructibles.size).toBe(1);
    expect(d.getDestructible(1)?.material).toBe('b');
  });

  it('unregisterDestructible 注销', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.unregisterDestructible(1);
    expect(d.destructibles.size).toBe(0);
    expect(d.getDestructible(1)).toBeUndefined();
  });
});

describe('DestructionSystem — applyDamage', () => {
  it('减少血量', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.applyDamage(1, 30, new Vector3(0.5, 0.5, 0.5));
    expect(d.getDestructible(1)!.health).toBe(70);
    expect(d.getDestructible(1)!.isBroken).toBe(false);
  });

  it('血量归零自动破碎', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1, { health: 30 }));
    d.applyDamage(1, 30, new Vector3(0.5, 0.5, 0.5));
    expect(d.getDestructible(1)!.health).toBe(0);
    expect(d.getDestructible(1)!.isBroken).toBe(true);
    expect(d.getFragmentCount()).toBeGreaterThan(0);
  });

  it('伤害 <= 0 无效', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1, { health: 50 }));
    d.applyDamage(1, 0, new Vector3());
    d.applyDamage(1, -10, new Vector3());
    expect(d.getDestructible(1)!.health).toBe(50);
  });

  it('已破碎物体不再受伤', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1, { health: 10 }));
    d.applyDamage(1, 10, new Vector3(0.5, 0.5, 0.5)); // 破碎
    const fragCount = d.getFragmentCount();
    d.applyDamage(1, 50, new Vector3(0.5, 0.5, 0.5)); // 再次伤害
    expect(d.getFragmentCount()).toBe(fragCount); // 无新增碎片
  });
});

describe('DestructionSystem — applyForce', () => {
  it('冲击力 >= 阈值时破碎', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1, { breakForce: 10 }));
    d.applyForce(1, new Vector3(15, 0, 0), new Vector3(0.5, 0.5, 0.5));
    expect(d.getDestructible(1)!.isBroken).toBe(true);
    expect(d.getFragmentCount()).toBeGreaterThan(0);
  });

  it('冲击力 < 阈值时不破碎', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1, { breakForce: 50 }));
    d.applyForce(1, new Vector3(5, 0, 0), new Vector3(0.5, 0.5, 0.5));
    expect(d.getDestructible(1)!.isBroken).toBe(false);
    expect(d.getFragmentCount()).toBe(0);
  });

  it('breakForce 高于系统阈值时取较大值', () => {
    const d = new DestructionSystem();
    d.setBreakThreshold(10);
    d.registerDestructible(1, makeDestructible(1, { breakForce: 100 }));
    // 15 >= 10(系统) 但 < 100(物体),不破碎
    d.applyForce(1, new Vector3(15, 0, 0), new Vector3(0.5, 0.5, 0.5));
    expect(d.getDestructible(1)!.isBroken).toBe(false);
    // 100 >= 100,破碎
    d.applyForce(1, new Vector3(100, 0, 0), new Vector3(0.5, 0.5, 0.5));
    expect(d.getDestructible(1)!.isBroken).toBe(true);
  });

  it('setBreakThreshold 提高阈值使物体更难破碎', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1, { breakForce: 5 }));
    d.setBreakThreshold(50);
    // 10 >= 5(物体) 但 < 50(系统),不破碎
    d.applyForce(1, new Vector3(10, 0, 0), new Vector3(0.5, 0.5, 0.5));
    expect(d.getDestructible(1)!.isBroken).toBe(false);
  });
});

describe('DestructionSystem — breakObject', () => {
  it('生成碎片并标记 isBroken', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.breakObject(1, new Vector3(0.5, 0.5, 0.5), new Vector3(5, 0, 0));
    expect(d.getDestructible(1)!.isBroken).toBe(true);
    expect(d.getFragmentCount()).toBeGreaterThan(0);
  });

  it('碎片记录在 destructible.fragments 与系统 fragments', () => {
    const d = new DestructionSystem();
    const obj = makeDestructible(1);
    d.registerDestructible(1, obj);
    d.breakObject(1, new Vector3(0.5, 0.5, 0.5), new Vector3(5, 0, 0));
    expect(obj.fragments.length).toBe(d.getFragmentCount());
    expect(obj.fragments.length).toBeGreaterThan(0);
  });

  it('已破碎物体再次 breakObject 无效', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.breakObject(1, new Vector3(0.5, 0.5, 0.5), new Vector3(5, 0, 0));
    const count1 = d.getFragmentCount();
    d.breakObject(1, new Vector3(0.5, 0.5, 0.5), new Vector3(5, 0, 0));
    expect(d.getFragmentCount()).toBe(count1);
  });

  it('未注册物体 breakObject 无效', () => {
    const d = new DestructionSystem();
    d.breakObject(99, new Vector3(), new Vector3(5, 0, 0));
    expect(d.getFragmentCount()).toBe(0);
  });

  it('碎片初始速度大小 = 冲击力', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.breakObject(1, new Vector3(0.5, 0.5, 0.5), new Vector3(7.5, 0, 0));
    for (const f of d.getFragments()) {
      // 速度大小应为冲击力(方向归一化后乘以力大小)
      expect(f.velocity.length()).toBeCloseTo(7.5, 5);
    }
  });
});

describe('DestructionSystem — slice', () => {
  it('用平面切片产生两块碎片', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    // X=0.5 平面:normal=(1,0,0), distance=-0.5
    const plane: SlicePlane = { normal: new Vector3(1, 0, 0), distance: -0.5 };
    d.slice(1, plane);
    expect(d.getDestructible(1)!.isBroken).toBe(true);
    expect(d.getFragmentCount()).toBe(2);
  });

  it('平面在几何外只产生一块碎片', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    // X=10 平面:整个立方体在内侧
    const plane: SlicePlane = { normal: new Vector3(1, 0, 0), distance: -10 };
    d.slice(1, plane);
    expect(d.getFragmentCount()).toBe(1);
  });

  it('已破碎物体 slice 无效', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.breakObject(1, new Vector3(0.5, 0.5, 0.5), new Vector3(5, 0, 0));
    const count = d.getFragmentCount();
    d.slice(1, { normal: new Vector3(1, 0, 0), distance: -0.5 });
    expect(d.getFragmentCount()).toBe(count);
  });
});

describe('DestructionSystem — shatter', () => {
  it('产生指定数量的碎片', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 4);
    expect(d.getDestructible(1)!.isBroken).toBe(true);
    expect(d.getFragmentCount()).toBeGreaterThan(0);
    expect(d.getFragmentCount()).toBeLessThanOrEqual(4);
  });

  it('fragmentCount <= 0 抛错', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    expect(() => d.shatter(1, new Vector3(), 0)).toThrow(/must be > 0/);
    expect(() => d.shatter(1, new Vector3(), -1)).toThrow(/must be > 0/);
  });

  it('已破碎物体 shatter 无效', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 3);
    const count = d.getFragmentCount();
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 3);
    expect(d.getFragmentCount()).toBe(count);
  });

  it('碎片几何都是非索引化', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 3);
    for (const f of d.getFragments()) {
      expect(f.mesh.index).toBeNull();
      expect(f.mesh.attributes.position).toBeDefined();
    }
  });
});

describe('DestructionSystem — deform', () => {
  it('形变修改 mesh 顶点', () => {
    const d = new DestructionSystem();
    const obj = makeDestructible(1);
    d.registerDestructible(1, obj);
    const pos = obj.mesh.attributes.position;
    const before = (pos.array as Float32Array).slice();
    d.deform(1, new Vector3(0.5, 0.5, 0.5), new Vector3(10, 0, 0));
    const after = pos.array as Float32Array;
    // 至少有一个顶点发生变化
    let changed = false;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs(before[i] - after[i]) > 1e-9) { changed = true; break; }
    }
    expect(changed).toBe(true);
    expect(obj.isBroken).toBe(false); // 形变不破碎
  });

  it('零力不形变', () => {
    const d = new DestructionSystem();
    const obj = makeDestructible(1);
    d.registerDestructible(1, obj);
    const before = (obj.mesh.attributes.position.array as Float32Array).slice();
    d.deform(1, new Vector3(0.5, 0.5, 0.5), new Vector3(0, 0, 0));
    const after = obj.mesh.attributes.position.array as Float32Array;
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it('已破碎物体不形变', () => {
    const d = new DestructionSystem();
    const obj = makeDestructible(1);
    d.registerDestructible(1, obj);
    d.breakObject(1, new Vector3(0.5, 0.5, 0.5), new Vector3(20, 0, 0));
    const before = (obj.mesh.attributes.position.array as Float32Array).slice();
    d.deform(1, new Vector3(0.5, 0.5, 0.5), new Vector3(10, 0, 0));
    const after = obj.mesh.attributes.position.array as Float32Array;
    expect(Array.from(after)).toEqual(Array.from(before));
  });
});

describe('DestructionSystem — update', () => {
  it('重力使碎片下落', () => {
    const d = new DestructionSystem();
    d.gravity.set(0, -10, 0);
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 2);
    const y0 = d.getFragments()[0].position.y;
    d.update(0.1);
    expect(d.getFragments()[0].position.y).toBeLessThan(y0);
    expect(d.getFragments()[0].velocity.y).toBeLessThan(0);
  });

  it('寿命衰减,过期碎片被移除', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 2);
    expect(d.getFragmentCount()).toBeGreaterThan(0);
    // 默认寿命 5s,推进 6s(分多帧避免单帧上限 1/30 截断过多)
    for (let i = 0; i < 200; i++) d.update(0.05);
    expect(d.getFragmentCount()).toBe(0);
  });

  it('角速度推进旋转四元数', () => {
    const d = new DestructionSystem();
    d.gravity.set(0, 0, 0); // 关闭重力
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 1);
    const f = d.getFragments()[0];
    f.angularVelocity.set(0, 1, 0); // 绕 Y 轴
    const q0 = f.rotation.clone();
    d.update(0.1);
    // 绕 Y 轴旋转 → y/w 分量变化
    expect(f.rotation.y).not.toBe(q0.y);
    expect(f.rotation.w).not.toBe(q0.w);
  });

  it('update 不残留过期碎片', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 3);
    for (let i = 0; i < 200; i++) d.update(0.05);
    // 过期后 getStats 的 activeFragments 应为 0
    const stats = d.getStats();
    expect(stats.activeFragments).toBe(0);
  });
});

describe('DestructionSystem — 碎片管理与统计', () => {
  it('getFragments 返回活跃碎片列表', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 3);
    const frags = d.getFragments();
    expect(frags.length).toBe(d.getFragmentCount());
    expect(frags.length).toBeGreaterThan(0);
  });

  it('clearFragments 清空系统与 destructible 碎片', () => {
    const d = new DestructionSystem();
    const obj = makeDestructible(1);
    d.registerDestructible(1, obj);
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 3);
    expect(d.getFragmentCount()).toBeGreaterThan(0);
    expect(obj.fragments.length).toBeGreaterThan(0);
    d.clearFragments();
    expect(d.getFragmentCount()).toBe(0);
    expect(obj.fragments.length).toBe(0);
  });

  it('setBreakThreshold 设置阈值', () => {
    const d = new DestructionSystem();
    d.setBreakThreshold(25);
    expect(d.breakThreshold).toBe(25);
    d.setBreakThreshold(-5);
    expect(d.breakThreshold).toBe(0);
  });

  it('setMaxFragments 设置上限', () => {
    const d = new DestructionSystem();
    d.setMaxFragments(50);
    expect(d.maxFragments).toBe(50);
  });

  it('maxFragments 上限生效', () => {
    const d = new DestructionSystem();
    d.setMaxFragments(2);
    d.registerDestructible(1, makeDestructible(1));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 10);
    expect(d.getFragmentCount()).toBeLessThanOrEqual(2);
  });

  it('getStats 返回正确统计', () => {
    const d = new DestructionSystem();
    d.registerDestructible(1, makeDestructible(1));
    d.registerDestructible(2, makeDestructible(2));
    d.shatter(1, new Vector3(0.5, 0.5, 0.5), 3);
    const stats = d.getStats();
    expect(stats.destructibles).toBe(2);
    expect(stats.broken).toBe(1); // 只有 1 号破碎
    expect(stats.fragments).toBe(d.getFragmentCount());
    expect(stats.activeFragments).toBe(d.getFragmentCount());
  });
});

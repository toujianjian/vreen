// PhysicsMaterial 单元测试 — 物理材质(摩擦/弹性/密度/断裂/塑性)。
//
// 覆盖:
//   • 构造默认值 / 选项覆盖 / clamp 边界
//   • setter 链式:setFriction / setRestitution / setDensity / setElasticity /
//     setStrength / setFracture / setDamping / setPlastic / setThermalExpansion /
//     setCustom / getCustom
//   • 力学计算:computeMass / computeStress / computeStrain / isYield / isFracture
//   • combine 四种模式(average / min / max / multiply)
//   • clone / copy 独立性
//   • toJSON / fromJSON 往返
//   • getStats
//   • 7 个预设:createMetal / createWood / createRubber / createGlass /
//     createConcrete / createIce / createFlesh
//   • dispose

import { describe, it, expect } from 'vitest';
import { PhysicsMaterial } from './PhysicsMaterial';

describe('PhysicsMaterial — 构造', () => {
  it('默认值:摩擦 0.5 / 弹性 0.3 / 密度 1000 / 非塑性', () => {
    const m = new PhysicsMaterial();
    expect(m.friction).toBe(0.5);
    expect(m.dynamicFriction).toBe(0.4);
    expect(m.restitution).toBeCloseTo(0.3, 6);
    expect(m.density).toBe(1000);
    expect(m.isPlastic).toBe(false);
    expect(m.poissonsRatio).toBeCloseTo(0.3, 6);
    expect(m.customProperties.size).toBe(0);
    expect(m.type).toBe('PhysicsMaterial');
    expect(m.isPhysicsMaterial).toBe(true);
  });

  it('选项覆盖生效', () => {
    const m = new PhysicsMaterial({
      friction: 0.7,
      dynamicFriction: 0.6,
      restitution: 0.8,
      density: 2000,
      youngsModulus: 100e9,
      poissonsRatio: 0.25,
      yieldStrength: 50e6,
      tensileStrength: 80e6,
      compressiveStrength: 60e6,
      fractureToughness: 5e6,
      damping: 0.1,
      isPlastic: true,
      plasticThreshold: 50e6,
      thermalExpansion: 12e-6,
    });
    expect(m.friction).toBeCloseTo(0.7, 6);
    expect(m.dynamicFriction).toBeCloseTo(0.6, 6);
    expect(m.restitution).toBeCloseTo(0.8, 6);
    expect(m.density).toBe(2000);
    expect(m.youngsModulus).toBe(100e9);
    expect(m.poissonsRatio).toBeCloseTo(0.25, 6);
    expect(m.yieldStrength).toBe(50e6);
    expect(m.tensileStrength).toBe(80e6);
    expect(m.compressiveStrength).toBe(60e6);
    expect(m.fractureToughness).toBe(5e6);
    expect(m.damping).toBeCloseTo(0.1, 6);
    expect(m.isPlastic).toBe(true);
    expect(m.plasticThreshold).toBe(50e6);
    expect(m.thermalExpansion).toBe(12e-6);
  });

  it('clamp 边界:restitution [0,1] / poissonsRatio [-1,0.5] / 非负字段', () => {
    const m = new PhysicsMaterial({
      restitution: 5,
      poissonsRatio: 0.9,
      friction: -1,
      density: -10,
      damping: -2,
    });
    expect(m.restitution).toBe(1);
    expect(m.poissonsRatio).toBe(0.5);
    expect(m.friction).toBe(0);
    expect(m.density).toBe(0);
    expect(m.damping).toBe(0);

    const m2 = new PhysicsMaterial({ restitution: -3, poissonsRatio: -2 });
    expect(m2.restitution).toBe(0);
    expect(m2.poissonsRatio).toBe(-1);
  });
});

describe('PhysicsMaterial — setter 链式', () => {
  it('setFriction 设置静摩擦 + 默认动摩擦', () => {
    const m = new PhysicsMaterial();
    const ret = m.setFriction(0.6);
    expect(ret).toBe(m);
    expect(m.friction).toBeCloseTo(0.6, 6);
    expect(m.dynamicFriction).toBeCloseTo(0.48, 6); // 0.6 * 0.8
  });

  it('setFriction 显式动摩擦', () => {
    const m = new PhysicsMaterial();
    m.setFriction(0.6, 0.5);
    expect(m.dynamicFriction).toBeCloseTo(0.5, 6);
  });

  it('setFriction clamp 非负', () => {
    const m = new PhysicsMaterial().setFriction(-0.5, -0.3);
    expect(m.friction).toBe(0);
    expect(m.dynamicFriction).toBe(0);
  });

  it('setRestitution clamp [0,1]', () => {
    const m = new PhysicsMaterial();
    m.setRestitution(2);
    expect(m.restitution).toBe(1);
    m.setRestitution(-1);
    expect(m.restitution).toBe(0);
  });

  it('setDensity 非负', () => {
    const m = new PhysicsMaterial().setDensity(5000);
    expect(m.density).toBe(5000);
    m.setDensity(-100);
    expect(m.density).toBe(0);
  });

  it('setElasticity 设置杨氏模量 + 泊松比(clamp)', () => {
    const m = new PhysicsMaterial().setElasticity(200e9, 0.3);
    expect(m.youngsModulus).toBe(200e9);
    expect(m.poissonsRatio).toBeCloseTo(0.3, 6);
    m.setElasticity(-5, 0.9);
    expect(m.youngsModulus).toBe(0);
    expect(m.poissonsRatio).toBe(0.5);
  });

  it('setStrength 三个强度参数', () => {
    const m = new PhysicsMaterial().setStrength(50e6, 80e6, 60e6);
    expect(m.yieldStrength).toBe(50e6);
    expect(m.tensileStrength).toBe(80e6);
    expect(m.compressiveStrength).toBe(60e6);
  });

  it('setFracture 设置断裂韧性', () => {
    const m = new PhysicsMaterial().setFracture(5e6);
    expect(m.fractureToughness).toBe(5e6);
    m.setFracture(-1);
    expect(m.fractureToughness).toBe(0);
  });

  it('setDamping 非负', () => {
    const m = new PhysicsMaterial().setDamping(0.2);
    expect(m.damping).toBeCloseTo(0.2, 6);
    m.setDamping(-1);
    expect(m.damping).toBe(0);
  });

  it('setPlastic 设置塑性 + 阈值', () => {
    const m = new PhysicsMaterial().setPlastic(true, 100e6);
    expect(m.isPlastic).toBe(true);
    expect(m.plasticThreshold).toBe(100e6);
    m.setPlastic(false, -5);
    expect(m.isPlastic).toBe(false);
    expect(m.plasticThreshold).toBe(0);
  });

  it('setThermalExpansion 非负', () => {
    const m = new PhysicsMaterial().setThermalExpansion(15e-6);
    expect(m.thermalExpansion).toBe(15e-6);
    m.setThermalExpansion(-1);
    expect(m.thermalExpansion).toBe(0);
  });

  it('setCustom / getCustom', () => {
    const m = new PhysicsMaterial();
    expect(m.getCustom('porosity')).toBeUndefined();
    m.setCustom('porosity', 0.3).setCustom('acousticVelocity', 1500);
    expect(m.getCustom('porosity')).toBeCloseTo(0.3, 6);
    expect(m.getCustom('acousticVelocity')).toBe(1500);
    expect(m.customProperties.size).toBe(2);
    // 覆盖已存在的值
    m.setCustom('porosity', 0.5);
    expect(m.getCustom('porosity')).toBe(0.5);
  });
});

describe('PhysicsMaterial — 力学计算', () => {
  it('computeMass = 密度 × 体积', () => {
    const m = new PhysicsMaterial({ density: 2000 });
    expect(m.computeMass(0.5)).toBe(1000);
    expect(m.computeMass(0)).toBe(0);
    expect(m.computeMass(-1)).toBe(0); // 负体积 clamp 到 0
  });

  it('computeStress = 力 / 截面积', () => {
    const m = new PhysicsMaterial();
    expect(m.computeStress(1000, 0.5)).toBe(2000);
    expect(m.computeStress(1000, 0)).toBe(0); // 面积 0 防除零
    expect(m.computeStress(-100, 0.5)).toBe(0); // 负力 clamp
  });

  it('computeStrain = 应力 / 杨氏模量(胡克定律)', () => {
    const m = new PhysicsMaterial({ youngsModulus: 200e9 });
    expect(m.computeStrain(200e6)).toBe(1e-3);
    expect(m.computeStrain(0)).toBe(0);
  });

  it('computeStrain 杨氏模量为 0 返回 0', () => {
    const m = new PhysicsMaterial({ youngsModulus: 0 });
    expect(m.computeStrain(1e6)).toBe(0);
  });

  it('isYield 超过屈服强度返回 true', () => {
    const m = new PhysicsMaterial({ yieldStrength: 100e6 });
    expect(m.isYield(50e6)).toBe(false);
    expect(m.isYield(150e6)).toBe(true);
    expect(m.isYield(100e6)).toBe(false); // 严格大于才屈服
  });

  it('isYield 屈服强度为 0 返回 false', () => {
    const m = new PhysicsMaterial({ yieldStrength: 0 });
    expect(m.isYield(1e9)).toBe(false);
  });

  it('isFracture 超过抗拉强度断裂', () => {
    const m = new PhysicsMaterial({
      tensileStrength: 100e6,
      isPlastic: false,
    });
    expect(m.isFracture(50e6)).toBe(false);
    expect(m.isFracture(150e6)).toBe(true);
  });

  it('isFracture 塑性材质超过塑性阈值断裂', () => {
    const m = new PhysicsMaterial({
      tensileStrength: 1000e6, // 抗拉极高,不会被抗拉触发
      isPlastic: true,
      plasticThreshold: 50e6,
    });
    expect(m.isFracture(40e6)).toBe(false);
    expect(m.isFracture(60e6)).toBe(true);
  });

  it('isFracture 非塑性 + 抗拉为 0 不断裂', () => {
    const m = new PhysicsMaterial({
      tensileStrength: 0,
      isPlastic: false,
      plasticThreshold: 0,
    });
    expect(m.isFracture(1e9)).toBe(false);
  });
});

describe('PhysicsMaterial — combine', () => {
  it('average 模式取平均(接触力学字段)', () => {
    const a = new PhysicsMaterial({ friction: 0.6, restitution: 0.4, damping: 0.1 });
    const b = new PhysicsMaterial({ friction: 0.4, restitution: 0.8, damping: 0.3 });
    const c = a.combine(b, 'average');
    expect(c.friction).toBeCloseTo(0.5, 6);
    expect(c.restitution).toBeCloseTo(0.6, 6);
    expect(c.damping).toBeCloseTo(0.2, 6);
  });

  it('min 模式取最小', () => {
    const a = new PhysicsMaterial({ friction: 0.6, restitution: 0.4 });
    const b = new PhysicsMaterial({ friction: 0.4, restitution: 0.8 });
    const c = a.combine(b, 'min');
    expect(c.friction).toBeCloseTo(0.4, 6);
    expect(c.restitution).toBeCloseTo(0.4, 6);
  });

  it('max 模式取最大', () => {
    const a = new PhysicsMaterial({ friction: 0.6, restitution: 0.4 });
    const b = new PhysicsMaterial({ friction: 0.4, restitution: 0.8 });
    const c = a.combine(b, 'max');
    expect(c.friction).toBeCloseTo(0.6, 6);
    expect(c.restitution).toBeCloseTo(0.8, 6);
  });

  it('multiply 模式取乘积', () => {
    const a = new PhysicsMaterial({ friction: 0.5, restitution: 0.5, damping: 0.2 });
    const b = new PhysicsMaterial({ friction: 0.4, restitution: 0.8, damping: 0.5 });
    const c = a.combine(b, 'multiply');
    expect(c.friction).toBeCloseTo(0.2, 6);
    expect(c.restitution).toBeCloseTo(0.4, 6);
    expect(c.damping).toBeCloseTo(0.1, 6);
  });

  it('combine 不修改 this / other', () => {
    const a = new PhysicsMaterial({ friction: 0.6 });
    const b = new PhysicsMaterial({ friction: 0.4 });
    a.combine(b, 'average');
    expect(a.friction).toBe(0.6);
    expect(b.friction).toBe(0.4);
  });

  it('combine 本体属性沿用 this(密度 / 强度 / 弹性)', () => {
    const a = new PhysicsMaterial({
      density: 5000,
      youngsModulus: 100e9,
      yieldStrength: 50e6,
      tensileStrength: 80e6,
    });
    const b = new PhysicsMaterial({
      density: 1000,
      youngsModulus: 10e9,
      yieldStrength: 10e6,
      tensileStrength: 20e6,
    });
    const c = a.combine(b, 'average');
    expect(c.density).toBe(5000);
    expect(c.youngsModulus).toBe(100e9);
    expect(c.yieldStrength).toBe(50e6);
    expect(c.tensileStrength).toBe(80e6);
  });

  it('combine 合并自定义属性(this 优先)', () => {
    const a = new PhysicsMaterial();
    a.setCustom('shared', 1).setCustom('onlyA', 10);
    const b = new PhysicsMaterial();
    b.setCustom('shared', 2).setCustom('onlyB', 20);
    const c = a.combine(b, 'average');
    expect(c.getCustom('shared')).toBe(1); // this 优先
    expect(c.getCustom('onlyA')).toBe(10);
    expect(c.getCustom('onlyB')).toBe(20);
  });

  it('combine 默认模式为 average', () => {
    const a = new PhysicsMaterial({ friction: 0.6 });
    const b = new PhysicsMaterial({ friction: 0.4 });
    const c = a.combine(b);
    expect(c.friction).toBeCloseTo(0.5, 6);
  });
});

describe('PhysicsMaterial — clone / copy', () => {
  it('clone 独立副本', () => {
    const a = new PhysicsMaterial({ friction: 0.6, density: 2000 });
    a.setCustom('porosity', 0.3);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b.friction).toBe(0.6);
    expect(b.density).toBe(2000);
    expect(b.getCustom('porosity')).toBeCloseTo(0.3, 6);
    // 修改 b 不影响 a
    b.friction = 0.1;
    b.setCustom('porosity', 0.9);
    expect(a.friction).toBe(0.6);
    expect(a.getCustom('porosity')).toBeCloseTo(0.3, 6);
  });

  it('copy 复制所有字段', () => {
    const a = new PhysicsMaterial({
      friction: 0.7,
      restitution: 0.5,
      density: 3000,
      isPlastic: true,
      plasticThreshold: 80e6,
    });
    a.setCustom('k', 42);
    const b = new PhysicsMaterial();
    const ret = b.copy(a);
    expect(ret).toBe(b);
    expect(b.friction).toBe(0.7);
    expect(b.restitution).toBeCloseTo(0.5, 6);
    expect(b.density).toBe(3000);
    expect(b.isPlastic).toBe(true);
    expect(b.plasticThreshold).toBe(80e6);
    expect(b.getCustom('k')).toBe(42);
  });
});

describe('PhysicsMaterial — 序列化', () => {
  it('toJSON / fromJSON 往返', () => {
    const a = new PhysicsMaterial({
      friction: 0.6,
      dynamicFriction: 0.5,
      restitution: 0.7,
      density: 2500,
      youngsModulus: 70e9,
      poissonsRatio: 0.22,
      yieldStrength: 50e6,
      tensileStrength: 50e6,
      compressiveStrength: 1000e6,
      fractureToughness: 0.7e6,
      damping: 0.01,
      isPlastic: false,
      plasticThreshold: 50e6,
      thermalExpansion: 9e-6,
    });
    a.setCustom('porosity', 0.15);
    a.setCustom('acousticVelocity', 5200);
    const json = a.toJSON();
    expect(json.type).toBe('PhysicsMaterial');
    expect(json.friction).toBe(0.6);
    expect(json.customProperties).toEqual({
      porosity: 0.15,
      acousticVelocity: 5200,
    });

    const b = new PhysicsMaterial();
    b.fromJSON(json as Record<string, unknown>);
    expect(b.friction).toBe(0.6);
    expect(b.dynamicFriction).toBe(0.5);
    expect(b.restitution).toBeCloseTo(0.7, 6);
    expect(b.density).toBe(2500);
    expect(b.youngsModulus).toBe(70e9);
    expect(b.poissonsRatio).toBeCloseTo(0.22, 6);
    expect(b.yieldStrength).toBe(50e6);
    expect(b.tensileStrength).toBe(50e6);
    expect(b.compressiveStrength).toBe(1000e6);
    expect(b.fractureToughness).toBe(0.7e6);
    expect(b.damping).toBeCloseTo(0.01, 6);
    expect(b.isPlastic).toBe(false);
    expect(b.plasticThreshold).toBe(50e6);
    expect(b.thermalExpansion).toBe(9e-6);
    expect(b.getCustom('porosity')).toBeCloseTo(0.15, 6);
    expect(b.getCustom('acousticVelocity')).toBe(5200);
  });

  it('fromJSON 容错:缺字段保持默认', () => {
    const m = new PhysicsMaterial().fromJSON({ friction: 0.9 });
    expect(m.friction).toBe(0.9);
    expect(m.restitution).toBeCloseTo(0.3, 6); // 默认
  });

  it('fromJSON clamp 越界值', () => {
    const m = new PhysicsMaterial().fromJSON({
      restitution: 5,
      poissonsRatio: 2,
      friction: -1,
    });
    expect(m.restitution).toBe(1);
    expect(m.poissonsRatio).toBe(0.5);
    expect(m.friction).toBe(0);
  });
});

describe('PhysicsMaterial — getStats', () => {
  it('返回统计摘要', () => {
    const m = new PhysicsMaterial({
      friction: 0.6,
      restitution: 0.3,
      density: 7850,
      youngsModulus: 200e9,
      isPlastic: true,
    });
    m.setCustom('a', 1).setCustom('b', 2);
    const stats = m.getStats();
    expect(stats.friction).toBe(0.6);
    expect(stats.restitution).toBeCloseTo(0.3, 6);
    expect(stats.density).toBe(7850);
    expect(stats.youngsModulus).toBe(200e9);
    expect(stats.isPlastic).toBe(1);
    expect(stats.customPropertyCount).toBe(2);
    expect(stats.hardness).toBeGreaterThan(0);
    expect(stats.hardness).toBeLessThanOrEqual(1);
  });

  it('硬度归一化:橡胶(低模量)低、金属(高模量)高', () => {
    const rubber = new PhysicsMaterial({ youngsModulus: 5e6 });
    const metal = new PhysicsMaterial({ youngsModulus: 200e9 });
    expect(metal.getStats().hardness).toBeGreaterThan(rubber.getStats().hardness);
  });
});

describe('PhysicsMaterial — 预设工厂', () => {
  it('createMetal 钢材参数', () => {
    const m = PhysicsMaterial.createMetal();
    expect(m.density).toBe(7850);
    expect(m.youngsModulus).toBe(200e9);
    expect(m.yieldStrength).toBe(250e6);
    expect(m.isPlastic).toBe(true);
    expect(m.restitution).toBeGreaterThan(0);
    expect(m.restitution).toBeLessThanOrEqual(1);
  });

  it('createWood 木材参数', () => {
    const m = PhysicsMaterial.createWood();
    expect(m.density).toBe(750);
    expect(m.youngsModulus).toBe(11e9);
    expect(m.isPlastic).toBe(false);
  });

  it('createRubber 高弹性 + 高阻尼', () => {
    const m = PhysicsMaterial.createRubber();
    expect(m.restitution).toBeGreaterThan(0.7);
    expect(m.damping).toBeGreaterThan(0.1);
    expect(m.youngsModulus).toBeLessThan(100e6);
  });

  it('createGlass 脆性(低断裂韧性)', () => {
    const m = PhysicsMaterial.createGlass();
    expect(m.fractureToughness).toBeLessThan(1e6);
    expect(m.isPlastic).toBe(false);
    expect(m.density).toBe(2500);
  });

  it('createConcrete 高抗压低抗拉', () => {
    const m = PhysicsMaterial.createConcrete();
    expect(m.compressiveStrength).toBeGreaterThan(m.tensileStrength);
    expect(m.density).toBe(2400);
  });

  it('createIce 低摩擦', () => {
    const m = PhysicsMaterial.createIce();
    expect(m.friction).toBeLessThan(0.1);
    expect(m.density).toBeLessThan(1000); // 冰比水轻
  });

  it('createFlesh 软组织 + 高阻尼 + 塑性', () => {
    const m = PhysicsMaterial.createFlesh();
    expect(m.youngsModulus).toBeLessThan(1e6); // 极软
    expect(m.damping).toBeGreaterThan(0.2);
    expect(m.isPlastic).toBe(true);
  });

  it('所有预设返回独立实例', () => {
    const a = PhysicsMaterial.createMetal();
    const b = PhysicsMaterial.createMetal();
    expect(a).not.toBe(b);
    a.friction = 0.01;
    expect(b.friction).not.toBe(0.01);
  });
});

describe('PhysicsMaterial — dispose', () => {
  it('dispose 清空自定义属性', () => {
    const m = new PhysicsMaterial();
    m.setCustom('a', 1).setCustom('b', 2);
    expect(m.customProperties.size).toBe(2);
    m.dispose();
    expect(m.customProperties.size).toBe(0);
  });

  it('dispose 可重复调用', () => {
    const m = new PhysicsMaterial();
    expect(() => { m.dispose(); m.dispose(); }).not.toThrow();
  });
});

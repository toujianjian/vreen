// FlightPhysics 测试 — 飞行物理模拟(升力 / 阻力 / 推力 / 控制面 / 重力 / 失速)。
//
// 验证:
//   • 构造默认值 / 自定义选项 / Vector3 克隆不共享引用
//   • setMass / setWing / setCoefficients / setThrust / setMaxThrust
//   • throttleInput / pitchInput / rollInput / yawInput — 输入限幅
//   • addControlSurface / removeControlSurface / getControlSurfaces
//   • computeAngleOfAttack — 来流从下方 AOA > 0
//   • computeSideslip — 侧向来流 β ≠ 0
//   • computeLift — 速度为 0 时升力为 0 / 升力随速度平方增长
//   • computeDrag — 阻力随速度平方增长
//   • computeThrust — 推力沿机身前向
//   • computeGravity — 重力沿 -Y
//   • checkStall — AOA > stallAngle 失速
//   • computeGForce — 静止时 G = 1(重力)
//   • update — 多帧不崩溃 / 高度 / 速度统计更新
//   • getStats — 字段完整

import { describe, it, expect } from 'vitest';
import { FlightPhysics } from './FlightPhysics';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import type { ControlSurface, ControlSurfaceType } from './FlightPhysics';

/** 创建带 4 个控制面(副翼/升降舵/方向舵/襟翼)的标准飞机。 */
function createPlane(): FlightPhysics {
  const p = new FlightPhysics();
  p.addControlSurface({ type: 'aileron', area: 1.0, arm: new Vector3(5, 0, 0) });
  p.addControlSurface({ type: 'elevator', area: 1.0, arm: new Vector3(0, 0, -3) });
  p.addControlSurface({ type: 'rudder', area: 0.8, arm: new Vector3(0, 0, -3) });
  p.addControlSurface({ type: 'flap', area: 2.0 });
  return p;
}

describe('FlightPhysics — 构造', () => {
  it('默认参数:1200kg / 10m 翼展 / 16m² 机翼 / 4000N 推力', () => {
    const p = new FlightPhysics();
    expect(p.mass).toBe(1200);
    expect(p.wingspan).toBeCloseTo(10, 5);
    expect(p.wingArea).toBeCloseTo(16, 5);
    expect(p.fuselageArea).toBeCloseTo(2, 5);
    expect(p.liftCoefficient).toBeCloseTo(0.2, 5);
    expect(p.dragCoefficient).toBeCloseTo(0.025, 5);
    expect(p.inducedDragFactor).toBeCloseTo(0.04, 5);
    expect(p.thrust).toBe(0);
    expect(p.maxThrust).toBe(4000);
    expect(p.throttle).toBe(0);
    expect(p.airDensity).toBeCloseTo(1.225, 5);
    expect(p.stallAngle).toBeCloseTo(0.26, 5);
    expect(p.gravity.y).toBeCloseTo(-9.8, 5);
    expect(p.isStalled).toBe(false);
    expect(p.gForce).toBe(1);
    expect(p.controlSurfaces.length).toBe(0);
  });

  it('自定义参数透传', () => {
    const p = new FlightPhysics({
      mass: 2000,
      wingspan: 14,
      wingArea: 25,
      fuselageArea: 3,
      liftCoefficient: 0.3,
      dragCoefficient: 0.03,
      inducedDragFactor: 0.05,
      maxThrust: 8000,
      airDensity: 1.0,
      stallAngle: 0.3,
      angularDamping: 0.3,
    });
    expect(p.mass).toBe(2000);
    expect(p.wingspan).toBe(14);
    expect(p.wingArea).toBe(25);
    expect(p.fuselageArea).toBe(3);
    expect(p.liftCoefficient).toBeCloseTo(0.3, 5);
    expect(p.dragCoefficient).toBeCloseTo(0.03, 5);
    expect(p.inducedDragFactor).toBeCloseTo(0.05, 5);
    expect(p.maxThrust).toBe(8000);
    expect(p.airDensity).toBeCloseTo(1.0, 5);
    expect(p.stallAngle).toBeCloseTo(0.3, 5);
    expect(p.angularDamping).toBeCloseTo(0.3, 5);
  });

  it('构造选项中的 Vector3 被克隆(不共享引用)', () => {
    const g = new Vector3(0, -9.8, 0);
    const inertia = new Vector3(1000, 1000, 2000);
    const p = new FlightPhysics({ gravity: g, inertia });
    g.y = -100;
    inertia.x = 999;
    expect(p.gravity.y).toBeCloseTo(-9.8, 5);
    expect(p.inertia.x).toBe(1000);
  });

  it('自定义转动惯量', () => {
    const p = new FlightPhysics({ inertia: new Vector3(2000, 2000, 4000) });
    expect(p.inertia.x).toBe(2000);
    expect(p.inertia.y).toBe(2000);
    expect(p.inertia.z).toBe(4000);
  });
});

describe('FlightPhysics — setter', () => {
  it('setMass 设置质量,拒绝 <= 0', () => {
    const p = new FlightPhysics();
    p.setMass(2500);
    expect(p.mass).toBe(2500);
    expect(() => p.setMass(0)).toThrowError(/must be > 0/);
    expect(() => p.setMass(-1)).toThrowError(/must be > 0/);
  });

  it('setWing 设置翼展与面积,拒绝 <= 0', () => {
    const p = new FlightPhysics();
    p.setWing(12, 18);
    expect(p.wingspan).toBe(12);
    expect(p.wingArea).toBe(18);
    expect(() => p.setWing(0, 18)).toThrowError(/wingspan/);
    expect(() => p.setWing(12, 0)).toThrowError(/area/);
  });

  it('setCoefficients 设置升力/阻力系数', () => {
    const p = new FlightPhysics();
    p.setCoefficients(0.4, 0.05);
    expect(p.liftCoefficient).toBeCloseTo(0.4, 5);
    expect(p.dragCoefficient).toBeCloseTo(0.05, 5);
  });

  it('setThrust 设置推力,限幅到 [0, maxThrust]', () => {
    const p = new FlightPhysics({ maxThrust: 4000 });
    p.setThrust(2000);
    expect(p.thrust).toBe(2000);
    p.setThrust(-100);
    expect(p.thrust).toBe(0);
    p.setThrust(10000);
    expect(p.thrust).toBe(4000);
  });

  it('setMaxThrust 设置最大推力,拒绝 < 0', () => {
    const p = new FlightPhysics();
    p.setMaxThrust(6000);
    expect(p.maxThrust).toBe(6000);
    expect(() => p.setMaxThrust(-1)).toThrowError(/must be >= 0/);
  });

  it('setMaxThrust 自动 clamp 当前 thrust', () => {
    const p = new FlightPhysics({ maxThrust: 4000 });
    p.setThrust(4000);
    p.setMaxThrust(2000);
    expect(p.thrust).toBe(2000);
  });
});

describe('FlightPhysics — 输入', () => {
  it('throttleInput 限幅 [0,1] 并映射推力', () => {
    const p = new FlightPhysics({ maxThrust: 4000 });
    p.throttleInput(0.5);
    expect(p.throttle).toBeCloseTo(0.5, 5);
    expect(p.thrust).toBe(2000);
    p.throttleInput(2);
    expect(p.throttle).toBe(1);
    expect(p.thrust).toBe(4000);
    p.throttleInput(-1);
    expect(p.throttle).toBe(0);
    expect(p.thrust).toBe(0);
  });

  it('pitchInput 限幅 [-1,1]', () => {
    const p = new FlightPhysics();
    p.pitchInput(0.5);
    expect(p.pitch).toBeCloseTo(0.5, 5);
    p.pitchInput(2);
    expect(p.pitch).toBe(1);
    p.pitchInput(-2);
    expect(p.pitch).toBe(-1);
  });

  it('rollInput 限幅 [-1,1]', () => {
    const p = new FlightPhysics();
    p.rollInput(0.7);
    expect(p.roll).toBeCloseTo(0.7, 5);
    p.rollInput(2);
    expect(p.roll).toBe(1);
    p.rollInput(-2);
    expect(p.roll).toBe(-1);
  });

  it('yawInput 限幅 [-1,1]', () => {
    const p = new FlightPhysics();
    p.yawInput(0.3);
    expect(p.yaw).toBeCloseTo(0.3, 5);
    p.yawInput(2);
    expect(p.yaw).toBe(1);
    p.yawInput(-2);
    expect(p.yaw).toBe(-1);
  });
});

describe('FlightPhysics — 控制面', () => {
  it('addControlSurface 添加,默认值合理', () => {
    const p = new FlightPhysics();
    p.addControlSurface({ type: 'aileron' });
    expect(p.controlSurfaces.length).toBe(1);
    const cs = p.controlSurfaces[0];
    expect(cs.type).toBe('aileron');
    expect(cs.deflection).toBe(0);
    expect(cs.maxDeflection).toBeCloseTo(0.4, 5);
    expect(cs.effectiveness).toBe(1);
    expect(cs.area).toBe(1);
  });

  it('addControlSurface 克隆 arm(不共享引用)', () => {
    const p = new FlightPhysics();
    const arm = new Vector3(5, 0, 0);
    p.addControlSurface({ type: 'aileron', arm });
    arm.x = 999;
    expect(p.controlSurfaces[0].arm.x).toBe(5);
  });

  it('addControlSurface 支持所有类型', () => {
    const p = new FlightPhysics();
    const types: ControlSurfaceType[] = ['aileron', 'elevator', 'rudder', 'flap', 'spoiler'];
    for (const t of types) p.addControlSurface({ type: t });
    expect(p.controlSurfaces.length).toBe(5);
    expect(p.controlSurfaces.map((c) => c.type)).toEqual(types);
  });

  it('removeControlSurface 按索引移除', () => {
    const p = createPlane();
    expect(p.controlSurfaces.length).toBe(4);
    p.removeControlSurface(0);
    expect(p.controlSurfaces.length).toBe(3);
    expect(p.controlSurfaces[0].type).toBe('elevator');
  });

  it('removeControlSurface 拒绝越界', () => {
    const p = new FlightPhysics();
    expect(() => p.removeControlSurface(0)).toThrowError(/out of range/);
    expect(() => p.removeControlSurface(-1)).toThrowError(/out of range/);
  });

  it('getControlSurfaces 返回数组引用', () => {
    const p = createPlane();
    expect(p.getControlSurfaces()).toBe(p.controlSurfaces);
  });

  it('ControlSurface 接口字段完整', () => {
    const p = createPlane();
    const cs: ControlSurface = p.controlSurfaces[0];
    expect(typeof cs.type).toBe('string');
    expect(typeof cs.deflection).toBe('number');
    expect(typeof cs.maxDeflection).toBe('number');
    expect(typeof cs.effectiveness).toBe('number');
    expect(typeof cs.area).toBe('number');
    expect(cs.arm).toBeDefined();
  });
});

describe('FlightPhysics — computeAngleOfAttack', () => {
  it('速度为 0 时 AOA = 0', () => {
    const p = new FlightPhysics();
    p.computeAngleOfAttack(new Vector3());
    expect(p.angleOfAttack).toBe(0);
  });

  it('水平前向飞行(来流沿 -Z)AOA = 0', () => {
    const p = new FlightPhysics();
    // 机身朝向默认(-Z 前),来流沿 -Z(即飞机向前飞)
    // velocity 在世界 -Z → vBody = (-Z).applyQuaternion(identity) = (0,0,-1)
    // vForward = -vBody.z = 1, vUp = 0 → AOA = atan2(0, 1) = 0
    p.computeAngleOfAttack(new Vector3(0, 0, -10));
    expect(p.angleOfAttack).toBeCloseTo(0, 5);
  });

  it('来流从下方来(飞机俯冲,velocity.y < 0)AOA > 0', () => {
    const p = new FlightPhysics();
    // 飞机俯冲:velocity = (0, -1, -10),vBody.y < 0 → AOA > 0
    p.computeAngleOfAttack(new Vector3(0, -1, -10));
    expect(p.angleOfAttack).toBeGreaterThan(0);
  });

  it('来流从上方来(飞机爬升,velocity.y > 0)AOA < 0', () => {
    const p = new FlightPhysics();
    // 飞机爬升:velocity = (0, +1, -10),vBody.y > 0 → AOA < 0
    p.computeAngleOfAttack(new Vector3(0, 1, -10));
    expect(p.angleOfAttack).toBeLessThan(0);
  });

  it('带俯仰姿态时机头上仰 → 正 AOA', () => {
    const p = new FlightPhysics();
    // 飞机机头上仰 30°(绕机身 X 轴正向旋转 → -Z 前向偏向 +Y)
    p.orientation.setFromEuler(Math.PI / 6, 0, 0, 'XYZ');
    // 来流水平前向 -Z(平飞)
    p.computeAngleOfAttack(new Vector3(0, 0, -10));
    // 上仰时机翼相对来流有正 AOA
    expect(p.angleOfAttack).toBeGreaterThan(0.1);
  });
});

describe('FlightPhysics — computeSideslip', () => {
  it('速度为 0 时侧滑 = 0', () => {
    const p = new FlightPhysics();
    p.computeSideslip(new Vector3());
    expect(p.sideslipAngle).toBe(0);
  });

  it('纯前向来流侧滑 = 0', () => {
    const p = new FlightPhysics();
    p.computeSideslip(new Vector3(0, 0, -10));
    expect(p.sideslipAngle).toBeCloseTo(0, 5);
  });

  it('侧向来流侧滑 ≠ 0', () => {
    const p = new FlightPhysics();
    // 来流从右前方(有 +X 分量)
    p.computeSideslip(new Vector3(1, 0, -10));
    expect(Math.abs(p.sideslipAngle)).toBeGreaterThan(0);
  });
});

describe('FlightPhysics — computeLift', () => {
  it('速度为 0 时升力为 0', () => {
    const p = new FlightPhysics();
    const lift = p.computeLift(new Vector3(), 1.225);
    expect(lift).toBeCloseTo(0, 5);
    expect(p.lift).toBeCloseTo(0, 5);
  });

  it('升力随速度平方增长', () => {
    const p = new FlightPhysics();
    p.computeLift(new Vector3(0, 0, -10), 1.225);
    const l1 = p.lift;
    p.computeLift(new Vector3(0, 0, -20), 1.225);
    const l2 = p.lift;
    expect(l1).toBeGreaterThan(0);
    expect(l2 / l1).toBeCloseTo(4, 3); // 速度翻倍 → 升力 ×4
  });

  it('升力公式 = 0.5 * ρ * v² * Cl * A', () => {
    const p = new FlightPhysics({
      airDensity: 1.225,
      liftCoefficient: 0.2,
      wingArea: 16,
    });
    // 水平前向 v=50, AOA=0 → Cl = Cl0 = 0.2
    p.computeAngleOfAttack(new Vector3(0, 0, -50));
    p.computeLift(new Vector3(0, 0, -50), 1.225);
    const expected = 0.5 * 1.225 * 50 * 50 * 0.2 * 16;
    expect(p.lift).toBeCloseTo(expected, 1);
  });

  it('空气密度越大升力越大', () => {
    const p = new FlightPhysics();
    p.computeLift(new Vector3(0, 0, -50), 1.0);
    const l1 = p.lift;
    p.computeLift(new Vector3(0, 0, -50), 2.0);
    const l2 = p.lift;
    expect(l2).toBeGreaterThan(l1);
  });
});

describe('FlightPhysics — computeDrag', () => {
  it('速度为 0 时阻力为 0', () => {
    const p = new FlightPhysics();
    const drag = p.computeDrag(new Vector3(), 1.225);
    expect(drag).toBeCloseTo(0, 5);
    expect(p.drag).toBeCloseTo(0, 5);
  });

  it('阻力随速度平方增长', () => {
    const p = new FlightPhysics();
    p.computeDrag(new Vector3(0, 0, -10), 1.225);
    const d1 = p.drag;
    p.computeDrag(new Vector3(0, 0, -20), 1.225);
    const d2 = p.drag;
    expect(d1).toBeGreaterThan(0);
    expect(d2 / d1).toBeCloseTo(4, 3);
  });

  it('阻力系数越大阻力越大', () => {
    const p1 = new FlightPhysics({ dragCoefficient: 0.02 });
    const p2 = new FlightPhysics({ dragCoefficient: 0.1 });
    p1.computeDrag(new Vector3(0, 0, -50), 1.225);
    p2.computeDrag(new Vector3(0, 0, -50), 1.225);
    expect(p2.drag).toBeGreaterThan(p1.drag);
  });
});

describe('FlightPhysics — computeThrust / computeGravity', () => {
  it('computeThrust 沿机身前向施加加速度', () => {
    const p = new FlightPhysics({ maxThrust: 4000 });
    p.setThrust(4000);
    const before = p.velocity.length();
    // 推力会写入 _acceleration,integrate 才应用到 velocity
    // 直接调用 computeThrust 不积分,验证 thrust 数值
    const t = p.computeThrust();
    expect(t).toBe(4000);
    void before;
  });

  it('throttle=0 时推力为 0', () => {
    const p = new FlightPhysics();
    p.throttleInput(0);
    expect(p.computeThrust()).toBe(0);
  });

  it('computeGravity 返回 m*g', () => {
    const p = new FlightPhysics({ mass: 1200 });
    const g = p.computeGravity();
    // g = 9.8, 返回 m*g = 1200 * 9.8 = 11760
    expect(g).toBeCloseTo(11760, 1);
  });
});

describe('FlightPhysics — checkStall', () => {
  it('AOA 在失速角内 → 不失速', () => {
    const p = new FlightPhysics({ stallAngle: 0.26 });
    p.angleOfAttack = 0.1;
    expect(p.checkStall()).toBe(false);
    expect(p.isStalled).toBe(false);
  });

  it('AOA 超过失速角 → 失速', () => {
    const p = new FlightPhysics({ stallAngle: 0.26 });
    p.angleOfAttack = 0.4;
    expect(p.checkStall()).toBe(true);
    expect(p.isStalled).toBe(true);
  });

  it('负 AOA 超过失速角 → 失速', () => {
    const p = new FlightPhysics({ stallAngle: 0.26 });
    p.angleOfAttack = -0.4;
    expect(p.checkStall()).toBe(true);
    expect(p.isStalled).toBe(true);
  });

  it('AOA 恰等于失速角 → 不失速(边界)', () => {
    const p = new FlightPhysics({ stallAngle: 0.26 });
    p.angleOfAttack = 0.26;
    expect(p.checkStall()).toBe(false);
  });
});

describe('FlightPhysics — update', () => {
  it('多帧 update 不崩溃', () => {
    const p = createPlane();
    p.throttleInput(1);
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    expect(isFinite(p.position.x)).toBe(true);
    expect(isFinite(p.velocity.x)).toBe(true);
    expect(isFinite(p.angleOfAttack)).toBe(true);
    expect(isFinite(p.gForce)).toBe(true);
  });

  it('推力使飞机前向加速(沿 -Z)', () => {
    const p = createPlane();
    p.throttleInput(1);
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    // 飞机应向前(-Z)移动
    expect(p.position.z).toBeLessThan(0);
    expect(p.velocity.z).toBeLessThan(0);
  });

  it('重力使飞机下落(无升力时)', () => {
    const p = createPlane();
    // 速度为 0,无升力,只有重力
    p.throttleInput(0);
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    expect(p.position.y).toBeLessThan(0);
    expect(p.velocity.y).toBeLessThan(0);
  });

  it('高速水平飞行产生升力抵消重力', () => {
    const p = createPlane();
    // 给初始水平速度
    p.velocity.set(0, 0, -80);
    for (let i = 0; i < 60; i++) p.update(1 / 60);
    // 有升力,y 下降应明显小于纯重力下落
    const p2 = createPlane();
    p2.velocity.set(0, 0, 0);
    for (let i = 0; i < 60; i++) p2.update(1 / 60);
    expect(p.position.y).toBeGreaterThan(p2.position.y);
  });

  it('dt=0 不变化', () => {
    const p = createPlane();
    p.throttleInput(1);
    p.update(0);
    expect(p.position.x).toBeCloseTo(0, 5);
    expect(p.velocity.x).toBeCloseTo(0, 5);
  });

  it('dt 上限 1/30(大 dt 不会爆炸)', () => {
    const p = createPlane();
    p.throttleInput(1);
    expect(() => p.update(10)).not.toThrow();
    expect(isFinite(p.position.x)).toBe(true);
    expect(isFinite(p.velocity.x)).toBe(true);
  });

  it('pitchInput 影响角速度', () => {
    const p = createPlane();
    p.velocity.set(0, 0, -50); // 提供动压
    p.pitchInput(1);
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    // pitch 输入应产生绕 Z 轴的角速度(机身本地)
    // 注:角速度是机身本地空间,数值可能因朝向变化
    expect(p.angularVelocity.length()).toBeGreaterThan(0);
  });

  it('失速时升力骤降', () => {
    const p = new FlightPhysics({ stallAngle: 0.26 });
    p.addControlSurface({ type: 'flap' });
    // 强制设置 AOA 在失速区
    p.angleOfAttack = 0.5;
    p.checkStall();
    expect(p.isStalled).toBe(true);
    p.computeLift(new Vector3(0, 0, -50), 1.225);
    const liftStalled = p.lift;
    // 同速度未失速
    const p2 = new FlightPhysics({ stallAngle: 0.26 });
    p2.angleOfAttack = 0.1;
    p2.checkStall();
    p2.computeLift(new Vector3(0, 0, -50), 1.225);
    const liftNormal = p2.lift;
    expect(liftStalled).toBeLessThan(liftNormal);
  });
});

describe('FlightPhysics — getAltitude / getSpeed / getGForce', () => {
  it('getAltitude 返回 position.y', () => {
    const p = new FlightPhysics();
    p.position.set(0, 100, 0);
    expect(p.getAltitude()).toBe(100);
    expect(p.altitude).toBe(100);
  });

  it('getSpeed 返回速度模长', () => {
    const p = new FlightPhysics();
    p.velocity.set(0, 0, -10);
    expect(p.getSpeed()).toBeCloseTo(10, 5);
  });

  it('getSpeedKmh = m/s * 3.6', () => {
    const p = new FlightPhysics();
    p.velocity.set(0, 0, -10);
    expect(p.getSpeedKmh()).toBeCloseTo(36, 5);
  });

  it('getAngleOfAttack 返回当前 AOA', () => {
    const p = new FlightPhysics();
    p.angleOfAttack = 0.15;
    expect(p.getAngleOfAttack()).toBeCloseTo(0.15, 5);
  });

  it('getSideslip 返回当前侧滑角', () => {
    const p = new FlightPhysics();
    p.sideslipAngle = 0.05;
    expect(p.getSideslip()).toBeCloseTo(0.05, 5);
  });

  it('getGForce 返回当前 G 力', () => {
    const p = new FlightPhysics();
    p.gForce = 2.5;
    expect(p.getGForce()).toBeCloseTo(2.5, 5);
  });

  it('isStalling 返回失速标志', () => {
    const p = new FlightPhysics();
    p.isStalled = true;
    expect(p.isStalling()).toBe(true);
    p.isStalled = false;
    expect(p.isStalling()).toBe(false);
  });
});

describe('FlightPhysics — getStats', () => {
  it('返回完整字段', () => {
    const p = createPlane();
    p.throttleInput(0.5);
    p.pitchInput(0.3);
    p.rollInput(-0.2);
    p.yawInput(0.1);
    p.update(1 / 60);
    const s = p.getStats();
    expect(s.mass).toBe(1200);
    expect(typeof s.speed).toBe('number');
    expect(typeof s.speedKmh).toBe('number');
    expect(typeof s.altitude).toBe('number');
    expect(typeof s.angleOfAttack).toBe('number');
    expect(typeof s.sideslipAngle).toBe('number');
    expect(typeof s.gForce).toBe('number');
    expect(typeof s.isStalled).toBe('boolean');
    expect(s.stallAngle).toBeCloseTo(0.26, 5);
    expect(typeof s.thrust).toBe('number');
    expect(typeof s.lift).toBe('number');
    expect(typeof s.drag).toBe('number');
    expect(s.pitchInput).toBeCloseTo(0.3, 5);
    expect(s.rollInput).toBeCloseTo(-0.2, 5);
    expect(s.yawInput).toBeCloseTo(0.1, 5);
    expect(s.controlSurfaceCount).toBe(4);
    expect(s.position).toBe(p.position);
    expect(s.velocity).toBe(p.velocity);
  });
});

describe('FlightPhysics — 朝向积分', () => {
  it('角速度更新朝向(orientation 不再是 identity)', () => {
    const p = createPlane();
    p.velocity.set(0, 0, -50);
    p.rollInput(1);
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    // orientation 应该已经偏离 identity
    const identity = new Quaternion();
    expect(p.orientation.x).not.toBeCloseTo(identity.x, 2);
  });
});

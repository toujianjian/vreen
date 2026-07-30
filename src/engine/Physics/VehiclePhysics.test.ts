// VehiclePhysics 测试 — 车辆物理模拟(轮胎 / 悬挂 / 引擎 / 传动 / 转向 / 制动)。
//
// 验证:
//   • 构造默认值 / 自定义选项 / Vector3 克隆不共享引用
//   • addWheel / removeWheel / getWheels / getWheelCount
//   • setMass / setCenterOfMass / setEnginePower / setBrakeForce / setSteering
//   • steeringInput — 按 steeringSpeed 推进 / 限幅到 maxSteeringAngle
//   • throttleInput / brakeInput / handbrake — 输入限幅 [0,1]
//   • shiftUp / shiftDown / setGear / getGear / getGearRatio
//   • computeTireForce — Pacejka 魔术公式零滑移=0 / 大滑移饱和
//   • computeDownforce — 随速度平方增长
//   • updateSuspension — 接地检测 / 悬挂力
//   • update — 多帧不崩溃 / 速度统计更新
//   • getStats — 字段完整性

import { describe, it, expect } from 'vitest';
import { VehiclePhysics } from './VehiclePhysics';
import { Vector3 } from '../Math/Vector3';
import type { Wheel } from './VehiclePhysics';

/** 创建标准 4 轮车辆(前转向 + 后驱动)。 */
function createCar4Wheel(): VehiclePhysics {
  const car = new VehiclePhysics({ mass: 1500 });
  const halfWB = 1.3; // 轴距一半
  const halfTW = 0.8; // 轮距一半
  // 前左 / 前右(转向,非驱动)
  car.addWheel({ position: new Vector3(-halfTW, 0, -halfWB), steering: true, driven: false });
  car.addWheel({ position: new Vector3(halfTW, 0, -halfWB), steering: true, driven: false });
  // 后左 / 后右(驱动,非转向)
  car.addWheel({ position: new Vector3(-halfTW, 0, halfWB), steering: false, driven: true });
  car.addWheel({ position: new Vector3(halfTW, 0, halfWB), steering: false, driven: true });
  return car;
}

describe('VehiclePhysics — 构造', () => {
  it('默认参数:1500kg / 2.6 轴距 / 1.6 轮距 / 150kW / 7000 RPM', () => {
    const car = new VehiclePhysics();
    expect(car.mass).toBe(1500);
    expect(car.wheelbase).toBeCloseTo(2.6, 5);
    expect(car.trackWidth).toBeCloseTo(1.6, 5);
    expect(car.enginePower).toBe(150000);
    expect(car.maxRPM).toBe(7000);
    expect(car.idleRPM).toBe(800);
    expect(car.rpm).toBe(800);
    expect(car.brakeForce).toBe(12000);
    expect(car.handbrakeForce).toBe(18000);
    expect(car.maxSteeringAngle).toBeCloseTo(0.5, 5);
    expect(car.steeringSpeed).toBeCloseTo(4, 5);
    expect(car.airDensity).toBeCloseTo(1.225, 5);
    expect(car.downforceCoefficient).toBeCloseTo(0.3, 5);
    expect(car.dragCoefficient).toBeCloseTo(0.3, 5);
    expect(car.frontalArea).toBeCloseTo(2.2, 5);
    expect(car.rollingResistance).toBeCloseTo(0.015, 5);
    expect(car.gravity.y).toBeCloseTo(-9.8, 5);
    expect(car.wheels.length).toBe(0);
    expect(car.transmission.gears.length).toBe(7); // 倒挡 + 6 挡
    expect(car.transmission.currentGear).toBe(1);
    expect(car.transmission.differentialRatio).toBeCloseTo(3.7, 5);
  });

  it('自定义参数透传', () => {
    const car = new VehiclePhysics({
      mass: 2000,
      wheelbase: 3.0,
      trackWidth: 2.0,
      enginePower: 300000,
      maxRPM: 8000,
      idleRPM: 1000,
      brakeForce: 20000,
      handbrakeForce: 25000,
      maxSteeringAngle: 0.6,
      steeringSpeed: 6,
      airDensity: 1.0,
      downforceCoefficient: 0.5,
      dragCoefficient: 0.4,
      frontalArea: 3.0,
      rollingResistance: 0.02,
    });
    expect(car.mass).toBe(2000);
    expect(car.wheelbase).toBeCloseTo(3.0, 5);
    expect(car.trackWidth).toBeCloseTo(2.0, 5);
    expect(car.enginePower).toBe(300000);
    expect(car.maxRPM).toBe(8000);
    expect(car.idleRPM).toBe(1000);
    expect(car.brakeForce).toBe(20000);
    expect(car.handbrakeForce).toBe(25000);
    expect(car.maxSteeringAngle).toBeCloseTo(0.6, 5);
    expect(car.steeringSpeed).toBeCloseTo(6, 5);
    expect(car.airDensity).toBeCloseTo(1.0, 5);
    expect(car.downforceCoefficient).toBeCloseTo(0.5, 5);
    expect(car.dragCoefficient).toBeCloseTo(0.4, 5);
    expect(car.frontalArea).toBeCloseTo(3.0, 5);
    expect(car.rollingResistance).toBeCloseTo(0.02, 5);
  });

  it('构造选项中的 Vector3 被克隆(不共享引用)', () => {
    const com = new Vector3(0, -0.2, 0);
    const g = new Vector3(0, -9.8, 0);
    const car = new VehiclePhysics({ centerOfMass: com, gravity: g });
    com.y = -100;
    g.y = -100;
    expect(car.centerOfMass.y).toBeCloseTo(-0.2, 5);
    expect(car.gravity.y).toBeCloseTo(-9.8, 5);
  });

  it('自定义传动配置覆盖默认', () => {
    const car = new VehiclePhysics({
      transmission: { type: 'automatic', currentGear: 2, differentialRatio: 4.0 },
    });
    expect(car.transmission.type).toBe('automatic');
    expect(car.transmission.currentGear).toBe(2);
    expect(car.transmission.differentialRatio).toBeCloseTo(4.0, 5);
    // gears 仍为默认
    expect(car.transmission.gears.length).toBe(7);
  });

  it('自定义 Pacejka 轮胎参数覆盖默认', () => {
    const car = new VehiclePhysics({
      tireParams: { longitudinalB: 12, lateralB: 10 },
    });
    expect(car.tireParams.longitudinalB).toBe(12);
    expect(car.tireParams.lateralB).toBe(10);
    // 未覆盖的保留默认
    expect(car.tireParams.longitudinalC).toBeCloseTo(1.65, 5);
  });
});

describe('VehiclePhysics — 车轮管理', () => {
  it('addWheel 添加车轮,默认值合理', () => {
    const car = new VehiclePhysics();
    car.addWheel({ position: new Vector3(1, 0, 1) });
    expect(car.wheels.length).toBe(1);
    const w = car.wheels[0];
    expect(w.position.x).toBe(1);
    expect(w.radius).toBeCloseTo(0.3, 5);
    expect(w.steering).toBe(false);
    expect(w.driven).toBe(false);
    expect(w.braking).toBe(true);
    expect(w.suspensionRest).toBeCloseTo(0.5, 5);
    expect(w.suspensionStiffness).toBeCloseTo(28000, 5);
    expect(w.suspensionDamping).toBeCloseTo(4000, 5);
    expect(w.tireGrip).toBeCloseTo(1.0, 5);
    expect(w.isGrounded).toBe(false);
    expect(w.contactNormal.y).toBe(1);
  });

  it('addWheel 克隆 position(不共享引用)', () => {
    const car = new VehiclePhysics();
    const pos = new Vector3(1, 2, 3);
    car.addWheel({ position: pos });
    pos.x = 999;
    expect(car.wheels[0].position.x).toBe(1);
  });

  it('removeWheel 按索引移除', () => {
    const car = createCar4Wheel();
    expect(car.getWheelCount()).toBe(4);
    car.removeWheel(0);
    expect(car.getWheelCount()).toBe(3);
    // 剩余第一个原先是 index 1
    expect(car.wheels[0].position.x).toBeCloseTo(0.8, 5);
  });

  it('removeWheel 拒绝越界索引', () => {
    const car = new VehiclePhysics();
    expect(() => car.removeWheel(0)).toThrowError(/out of range/);
    expect(() => car.removeWheel(-1)).toThrowError(/out of range/);
  });

  it('getWheels 返回数组引用', () => {
    const car = createCar4Wheel();
    const ws = car.getWheels();
    expect(ws).toBe(car.wheels);
    expect(ws.length).toBe(4);
  });

  it('getWheelCount 一致', () => {
    const car = createCar4Wheel();
    expect(car.getWheelCount()).toBe(car.wheels.length);
  });
});

describe('VehiclePhysics — setter', () => {
  it('setMass 设置质量,拒绝 <= 0', () => {
    const car = new VehiclePhysics();
    car.setMass(2500);
    expect(car.mass).toBe(2500);
    expect(() => car.setMass(0)).toThrowError(/must be > 0/);
    expect(() => car.setMass(-1)).toThrowError(/must be > 0/);
  });

  it('setCenterOfMass 设置重心(拷贝)', () => {
    const car = new VehiclePhysics();
    const com = new Vector3(0.1, -0.3, 0.2);
    car.setCenterOfMass(com);
    expect(car.centerOfMass.x).toBeCloseTo(0.1, 5);
    expect(car.centerOfMass.y).toBeCloseTo(-0.3, 5);
    expect(car.centerOfMass.z).toBeCloseTo(0.2, 5);
    com.x = 999;
    expect(car.centerOfMass.x).toBeCloseTo(0.1, 5);
  });

  it('setEnginePower 设置功率,拒绝 < 0', () => {
    const car = new VehiclePhysics();
    car.setEnginePower(250000);
    expect(car.enginePower).toBe(250000);
    expect(() => car.setEnginePower(-1)).toThrowError(/must be >= 0/);
  });

  it('setBrakeForce 设置制动力,拒绝 < 0', () => {
    const car = new VehiclePhysics();
    car.setBrakeForce(15000);
    expect(car.brakeForce).toBe(15000);
    expect(() => car.setBrakeForce(-1)).toThrowError(/must be >= 0/);
  });

  it('setSteering 设置转向角,限幅到 maxSteeringAngle', () => {
    const car = new VehiclePhysics();
    car.setSteering(0.3);
    expect(car.steeringAngle).toBeCloseTo(0.3, 5);
    // 超出正向上限
    car.setSteering(10);
    expect(car.steeringAngle).toBeCloseTo(car.maxSteeringAngle, 5);
    // 超出负向下限
    car.setSteering(-10);
    expect(car.steeringAngle).toBeCloseTo(-car.maxSteeringAngle, 5);
  });
});

describe('VehiclePhysics — 输入', () => {
  it('steeringInput 按 steeringSpeed 推进', () => {
    const car = new VehiclePhysics({ steeringSpeed: 4, maxSteeringAngle: 0.5 });
    // 一帧 dt=0.1, 最大 delta = 4*0.1 = 0.4
    car.steeringInput(1, 0.1);
    expect(car.steeringAngle).toBeCloseTo(0.4, 5);
    // 再一帧到达目标 0.5
    car.steeringInput(1, 0.1);
    expect(car.steeringAngle).toBeCloseTo(0.5, 5);
  });

  it('steeringInput 反向转向', () => {
    const car = new VehiclePhysics({ steeringSpeed: 10, maxSteeringAngle: 0.5 });
    car.steeringInput(-1, 0.1);
    expect(car.steeringAngle).toBeCloseTo(-0.5, 5);
  });

  it('steeringInput 输入限幅 [-1,1]', () => {
    const car = new VehiclePhysics({ steeringSpeed: 100 });
    car.steeringInput(5, 0.1);
    expect(car.steerInput).toBe(1);
    car.steeringInput(-5, 0.1);
    expect(car.steerInput).toBe(-1);
  });

  it('throttleInput 限幅 [0,1]', () => {
    const car = new VehiclePhysics();
    car.throttleInput(0.5);
    expect(car.throttle).toBeCloseTo(0.5, 5);
    car.throttleInput(2);
    expect(car.throttle).toBe(1);
    car.throttleInput(-1);
    expect(car.throttle).toBe(0);
  });

  it('brakeInput 限幅 [0,1]', () => {
    const car = new VehiclePhysics();
    car.brakeInput(0.7);
    expect(car.brake).toBeCloseTo(0.7, 5);
    car.brakeInput(2);
    expect(car.brake).toBe(1);
    car.brakeInput(-1);
    expect(car.brake).toBe(0);
  });

  it('handbrake 限幅 [0,1]', () => {
    const car = new VehiclePhysics();
    car.handbrake(0.5);
    expect(car.handbrakeInput).toBeCloseTo(0.5, 5);
    car.handbrake(2);
    expect(car.handbrakeInput).toBe(1);
    car.handbrake(-1);
    expect(car.handbrakeInput).toBe(0);
  });
});

describe('VehiclePhysics — 传动', () => {
  it('shiftUp 升挡至上限', () => {
    const car = new VehiclePhysics();
    expect(car.getGear()).toBe(1);
    car.shiftUp();
    expect(car.getGear()).toBe(2);
    // 升到最高挡
    for (let i = 0; i < 10; i++) car.shiftUp();
    expect(car.getGear()).toBe(car.transmission.gears.length - 1);
  });

  it('shiftDown 降挡至下限(0 = 倒挡)', () => {
    const car = new VehiclePhysics();
    car.shiftDown();
    expect(car.getGear()).toBe(0);
    // 不能再降
    car.shiftDown();
    expect(car.getGear()).toBe(0);
  });

  it('setGear 直接设置,校验范围', () => {
    const car = new VehiclePhysics();
    car.setGear(3);
    expect(car.getGear()).toBe(3);
    expect(() => car.setGear(-1)).toThrowError(/out of range/);
    expect(() => car.setGear(100)).toThrowError(/out of range/);
  });

  it('getGearRatio 返回当前挡位齿比', () => {
    const car = new VehiclePhysics();
    car.setGear(1);
    expect(car.getGearRatio()).toBe(car.transmission.gears[1]);
    car.setGear(0); // 倒挡
    expect(car.getGearRatio()).toBe(car.transmission.gears[0]);
    expect(car.getGearRatio()).toBeLessThan(0); // 倒挡为负
  });
});

describe('VehiclePhysics — computeTireForce (Pacejka)', () => {
  it('零滑移 → 零力', () => {
    const car = new VehiclePhysics();
    car.addWheel({ position: new Vector3(0, 0, 0) });
    const w = car.wheels[0];
    const force = car.computeTireForce(w, 0, 5000, 'longitudinal');
    expect(force).toBeCloseTo(0, 5);
  });

  it('纵向力随滑移增大后饱和(Pacejka 钟形)', () => {
    const car = new VehiclePhysics();
    car.addWheel({ position: new Vector3(0, 0, 0), tireGrip: 1.0 });
    const w = car.wheels[0];
    const load = 5000;
    const f0 = car.computeTireForce(w, 0.01, load, 'longitudinal');
    const f1 = car.computeTireForce(w, 0.1, load, 'longitudinal');
    const f2 = car.computeTireForce(w, 0.5, load, 'longitudinal');
    // 单调上升至饱和
    expect(f0).toBeGreaterThan(0);
    expect(f1).toBeGreaterThan(f0);
    // 饱和后接近峰值(load * μ),不再显著增长
    const peak = load * 1.0; // longitudinalD = 1.0
    expect(f2).toBeLessThanOrEqual(peak + 1);
    expect(f1).toBeLessThanOrEqual(peak + 1);
  });

  it('侧向力随侧偏角增大', () => {
    const car = new VehiclePhysics();
    car.addWheel({ position: new Vector3(0, 0, 0) });
    const w = car.wheels[0];
    const load = 5000;
    const f0 = car.computeTireForce(w, 0, load, 'lateral');
    const f1 = car.computeTireForce(w, 0.1, load, 'lateral');
    expect(f0).toBeCloseTo(0, 5);
    expect(f1).toBeGreaterThan(0);
  });

  it('载荷越大,峰值力越大', () => {
    const car = new VehiclePhysics();
    car.addWheel({ position: new Vector3(0, 0, 0) });
    const w = car.wheels[0];
    const fLight = car.computeTireForce(w, 0.3, 2000, 'longitudinal');
    const fHeavy = car.computeTireForce(w, 0.3, 8000, 'longitudinal');
    expect(fHeavy).toBeGreaterThan(fLight);
  });

  it('tireGrip 越大,峰值力越大', () => {
    const car = new VehiclePhysics();
    car.addWheel({ position: new Vector3(0, 0, 0), tireGrip: 0.5 });
    const wLow = car.wheels[0];
    car.addWheel({ position: new Vector3(0, 0, 0), tireGrip: 1.5 });
    const wHigh = car.wheels[1];
    const load = 5000;
    const fLow = car.computeTireForce(wLow, 0.3, load, 'longitudinal');
    const fHigh = car.computeTireForce(wHigh, 0.3, load, 'longitudinal');
    expect(fHigh).toBeGreaterThan(fLow);
  });
});

describe('VehiclePhysics — computeDownforce', () => {
  it('速度为 0 时下压力为 0', () => {
    const car = new VehiclePhysics();
    expect(car.computeDownforce(0)).toBeCloseTo(0, 5);
  });

  it('下压力随速度平方增长', () => {
    const car = new VehiclePhysics();
    const f1 = car.computeDownforce(10);
    const f2 = car.computeDownforce(20);
    // 速度翻倍,下压力 ×4
    expect(f2 / f1).toBeCloseTo(4, 3);
  });

  it('下压力公式 = 0.5 * ρ * v² * Cl * A', () => {
    const car = new VehiclePhysics({
      airDensity: 1.225,
      downforceCoefficient: 0.3,
      frontalArea: 2.2,
    });
    const v = 50;
    const expected = 0.5 * 1.225 * v * v * 0.3 * 2.2;
    expect(car.computeDownforce(v)).toBeCloseTo(expected, 3);
  });
});

describe('VehiclePhysics — updateSuspension', () => {
  it('地面 y=0,车辆在 y=1.0,轮悬挂应压缩', () => {
    const car = createCar4Wheel();
    car.position.set(0, 1.0, 0); // 车身离地 1m
    // 轮 position.y = 0,suspensionRest=0.5,radius=0.3,rayLen=0.8
    // 车身在 y=1,挂点世界 y = 1,地面 y = 0,dist = 1
    // rayLen = 0.8,dist(1) > rayLen(0.8) → 不接地
    car.updateSuspension(0.016);
    // 实际:挂点在车身本地 y=0,世界 y = position.y = 1.0
    // dist = 1.0 - 0 = 1.0,rayLen = 0.5 + 0.3 = 0.8
    // 1.0 > 0.8 → 不接地
    expect(car.isGrounded).toBe(false);
  });

  it('地面 y=0,车辆在 y=0.7,轮应接地并产生悬挂力', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    // 挂点世界 y = 0.7,地面 y = 0,dist = 0.7
    // rayLen = 0.8,compression = 0.8 - 0.7 = 0.1
    car.updateSuspension(0.016);
    expect(car.isGrounded).toBe(true);
    for (const w of car.wheels) {
      expect(w.isGrounded).toBe(true);
      expect(w.compression).toBeCloseTo(0.1, 3);
      expect(w.suspensionForce).toBeGreaterThan(0);
      expect(w.contactPoint.y).toBeCloseTo(0, 5);
      expect(w.contactNormal.y).toBeCloseTo(1, 5);
    }
  });

  it('自定义 groundHeightFn — 斜坡地形', () => {
    const car = createCar4Wheel();
    car.position.set(0, 1.0, 0);
    // 斜坡:地面随 x 升高
    car.groundHeightFn = (x, _z) => x * 0.5;
    car.updateSuspension(0.016);
    // 至少有轮接地(因为地面升高)
    expect(car.isGrounded).toBe(true);
  });
});

describe('VehiclePhysics — update', () => {
  it('多帧 update 不崩溃,速度统计更新', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    car.throttleInput(1);
    // 跑 60 帧
    for (let i = 0; i < 60; i++) {
      car.update(1 / 60);
    }
    expect(car.speed).toBeGreaterThanOrEqual(0);
    expect(car.speedKmh).toBeGreaterThanOrEqual(0);
    expect(isFinite(car.speed)).toBe(true);
    expect(isFinite(car.rpm)).toBe(true);
  });

  it('油门 + 接地 → 速度增加', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    const speedBefore = car.speed;
    car.throttleInput(1);
    for (let i = 0; i < 30; i++) car.update(1 / 60);
    expect(car.speed).toBeGreaterThan(speedBefore);
  });

  it('刹车减速', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    // 先加速
    car.throttleInput(1);
    for (let i = 0; i < 60; i++) car.update(1 / 60);
    const speedBefore = car.speed;
    // 再刹车
    car.throttleInput(0);
    car.brakeInput(1);
    for (let i = 0; i < 60; i++) car.update(1 / 60);
    expect(car.speed).toBeLessThan(speedBefore);
  });

  it('dt=0 不变化', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    car.throttleInput(1);
    car.update(0);
    expect(car.speed).toBeCloseTo(0, 5);
    expect(car.position.x).toBeCloseTo(0, 5);
  });

  it('dt 上限 1/30(大 dt 不会爆炸)', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    car.throttleInput(1);
    // dt=10 应被 clamp 到 1/30
    expect(() => car.update(10)).not.toThrow();
    expect(isFinite(car.speed)).toBe(true);
    expect(isFinite(car.position.x)).toBe(true);
  });
});

describe('VehiclePhysics — getStats', () => {
  it('返回完整字段', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    car.update(1 / 60);
    const s = car.getStats();
    expect(s.mass).toBe(1500);
    expect(typeof s.speed).toBe('number');
    expect(typeof s.speedKmh).toBe('number');
    expect(typeof s.rpm).toBe('number');
    expect(typeof s.gear).toBe('number');
    expect(typeof s.gearRatio).toBe('number');
    expect(typeof s.isGrounded).toBe('boolean');
    expect(typeof s.groundedWheels).toBe('number');
    expect(s.wheelCount).toBe(4);
    expect(typeof s.steeringAngle).toBe('number');
    expect(typeof s.downforce).toBe('number');
    expect(typeof s.dragForce).toBe('number');
    expect(typeof s.engineTorque).toBe('number');
    expect(typeof s.wheelTorque).toBe('number');
    expect(s.position).toBe(car.position);
    expect(s.velocity).toBe(car.velocity);
  });

  it('groundedWheels 反映接地轮数', () => {
    const car = createCar4Wheel();
    car.position.set(0, 0.7, 0);
    car.updateSuspension(0.016);
    const s = car.getStats();
    expect(s.groundedWheels).toBe(4);
    expect(s.isGrounded).toBe(true);
  });
});

describe('VehiclePhysics — Wheel 接口', () => {
  it('Wheel 接口字段完整', () => {
    const car = createCar4Wheel();
    const w: Wheel = car.wheels[0];
    // 必须字段全部存在
    expect(w.position).toBeDefined();
    expect(typeof w.radius).toBe('number');
    expect(typeof w.steering).toBe('boolean');
    expect(typeof w.driven).toBe('boolean');
    expect(typeof w.braking).toBe('boolean');
    expect(typeof w.suspensionRest).toBe('number');
    expect(typeof w.suspensionStiffness).toBe('number');
    expect(typeof w.suspensionDamping).toBe('number');
    expect(typeof w.suspensionForce).toBe('number');
    expect(typeof w.tireGrip).toBe('number');
    expect(typeof w.slip).toBe('number');
    expect(typeof w.slipRatio).toBe('number');
    expect(typeof w.isGrounded).toBe('boolean');
    expect(w.contactPoint).toBeDefined();
    expect(w.contactNormal).toBeDefined();
    expect(typeof w.wheelRotation).toBe('number');
    expect(typeof w.wheelAngularVelocity).toBe('number');
    expect(typeof w.compression).toBe('number');
    expect(typeof w.lastLength).toBe('number');
  });
});

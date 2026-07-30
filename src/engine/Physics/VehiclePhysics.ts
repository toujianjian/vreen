// VehiclePhysics — 车辆物理模拟(轮胎 / 悬挂 / 引擎 / 传动 / 转向 / 制动)。
//
// 设计:
//   - 车辆本体:position / velocity / orientation(Quaternion)/ angularVelocity。
//     半隐式 Euler 积分(velocity += a*dt;position += v*dt),固定步长上限 1/30。
//   - 悬挂(spring-damper):每轮一条弹簧 + 阻尼,suspensionRest 静止长度,
//     compression = restLength - currentLength;suspensionForce = k*compression - d*velocity。
//     沿 contactNormal 推车身,反力作用于车轮(保持接地)。
//   - 轮胎(Pacejka 简化模型):F = D*sin(C*atan(B*slip - E*(B*slip - atan(B*slip))))
//     B/C/D/E 为形状参数,D = μ * load(峰值 = 摩擦系数 × 法向载荷)。
//     slipAngle = atan2(lateralVel, longitudinalVel) 计算侧偏角,
//     slipRatio = (wheelSpinVel * r - vLong) / max(|vLong|, ε) 计算纵向滑移率。
//   - 引擎:rpm = maxRPM * |throttle| 简化(无完整燃烧模型),怠速 idleRPM,
//     输出扭矩 = enginePower * throttle / maxRPM * rpm 曲线。
//   - 传动:gearRatio[currentGear] × differentialRatio 决定轮端扭矩 / 引擎转速映射;
//     clutch ∈ [0,1] 0=完全分离 1=完全结合;离合器打滑时按 clutch 缩放传递扭矩。
//   - 转向:steeringInput(-1..1)按 steeringSpeed 推进 targetAngle,
//     目标角 = input * maxSteeringAngle,前轮按 steeringAngle 偏转转向。
//   - 制动:brakeInput / handbrake 作用于 wheel.brakingForce,简化为减速度 × 载荷。
//   - 空气动力学:downforce = 0.5 * ρ * v² * Cl * frontalArea(下压力随速度平方增长),
//     dragForce = 0.5 * ρ * v² * Cd * frontalArea(空气阻力)。
//
// 与引擎的集成:
//   - update(dt) 内部完成:悬挂 → 轮胎 → 引擎 → 传动 → 空气动力学 → 积分。
//   - 与 ECS PhysicsSystems 解耦:车辆是多体复合,形态差异大,独立实现。
//   - 后续若要接入 ECS,可包装为 VehicleComponent + VehicleSystem。
//   - 调用方负责把 position/orientation 同步到渲染 Mesh。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 车轮(含悬挂与轮胎状态)。 */
export interface Wheel {
  /** 车轮在车身本地空间的位置(连杆顶端挂点)。 */
  position: Vector3;
  /** 车轮半径(m)。 */
  radius: number;
  /** 是否参与转向(前轮一般为 true)。 */
  steering: boolean;
  /** 是否驱动轮(传递引擎扭矩)。 */
  driven: boolean;
  /** 是否制动轮。 */
  braking: boolean;
  /** 悬挂静止长度(m)。 */
  suspensionRest: number;
  /** 悬挂刚度(N/m)。 */
  suspensionStiffness: number;
  /** 悬挂阻尼(N·s/m)。 */
  suspensionDamping: number;
  /** 当前悬挂推力(N,沿 contactNormal)。 */
  suspensionForce: number;
  /** 轮胎侧向抓地系数(无量纲,通常 0.8..1.5)。 */
  tireGrip: number;
  /** 当前侧偏角(弧度)。 */
  slip: number;
  /** 当前纵向滑移率(-∞..∞,常用 [-1,1])。 */
  slipRatio: number;
  /** 是否接地。 */
  isGrounded: boolean;
  /** 接触点(世界空间)。 */
  contactPoint: Vector3;
  /** 接触法线(世界空间,指向上)。 */
  contactNormal: Vector3;
  /** 车轮自转角度(弧度,绕 Y 轴旋转的累积量,用于渲染)。 */
  wheelRotation: number;
  /** 车轮自转角速度(rad/s)。 */
  wheelAngularVelocity: number;
  /** 当前悬挂压缩量(m,>=0 表示压缩)。 */
  compression: number;
  /** 上帧悬挂长度(用于阻尼计算)。 */
  lastLength: number;
}

/** 传动系统配置。 */
export interface Transmission {
  /** 变速箱类型:手动 / 自动。 */
  type: 'manual' | 'automatic';
  /** 各挡齿比(数组索引 0 = 倒挡或 1 挡,按约定)。 */
  gears: number[];
  /** 当前挡位索引(gears 数组下标)。 */
  currentGear: number;
  /** 主减速比(终传)。 */
  differentialRatio: number;
  /** 离合器结合度 [0,1],0 = 完全分离,1 = 完全结合。 */
  clutch: number;
  /** 自动换挡 RPM 阈值(高 RPM 升挡)。 */
  upshiftRPM: number;
  /** 自动换挡 RPM 阈值(低 RPM 降挡)。 */
  downshiftRPM: number;
}

/** VehiclePhysics 构造选项。 */
export interface VehicleOptions {
  /** 质量(kg),默认 1500。 */
  mass?: number;
  /** 重心位置(车身本地空间,默认 (0,0,0))。 */
  centerOfMass?: Vector3;
  /** 轴距(m,默认 2.6)。 */
  wheelbase?: number;
  /** 轮距(m,默认 1.6)。 */
  trackWidth?: number;
  /** 引擎最大功率(W,默认 150000 = 200hp)。 */
  enginePower?: number;
  /** 引擎最大转速(RPM,默认 7000)。 */
  maxRPM?: number;
  /** 怠速转速(RPM,默认 800)。 */
  idleRPM?: number;
  /** 制动力(N,默认 12000)。 */
  brakeForce?: number;
  /** 手刹力(N,默认 18000,作用于后轮)。 */
  handbrakeForce?: number;
  /** 最大转向角(弧度,默认 0.5 ≈ 28.6°)。 */
  maxSteeringAngle?: number;
  /** 转向到达目标角的速度(rad/s,默认 4)。 */
  steeringSpeed?: number;
  /** 空气密度 ρ(kg/m³,默认 1.225)。 */
  airDensity?: number;
  /** 下压力系数 Cl(默认 0.3)。 */
  downforceCoefficient?: number;
  /** 空气阻力系数 Cd(默认 0.3)。 */
  dragCoefficient?: number;
  /** 迎风面积(m²,默认 2.2)。 */
  frontalArea?: number;
  /** 滚动阻力系数(默认 0.015)。 */
  rollingResistance?: number;
  /** 重力加速度(默认 (0,-9.8,0))。 */
  gravity?: Vector3;
  /** 传动系统配置(可覆盖默认 6 挡手动)。 */
  transmission?: Partial<Transmission>;
  /** Pacejka 轮胎模型参数(可选,使用默认值)。 */
  tireParams?: Partial<TireParams>;
}

/** Pacejka 简化轮胎模型参数(魔术公式 B/C/D/E)。 */
export interface TireParams {
  /** 纵向刚度因子 B。 */
  longitudinalB: number;
  /** 纵向形状因子 C。 */
  longitudinalC: number;
  /** 纵向峰值因子 D 的基础摩擦系数。 */
  longitudinalD: number;
  /** 纵向曲率因子 E。 */
  longitudinalE: number;
  /** 侧向刚度因子 B。 */
  lateralB: number;
  /** 侧向形状因子 C。 */
  lateralC: number;
  /** 侧向峰值因子 D 的基础摩擦系数。 */
  lateralD: number;
  /** 侧向曲率因子 E。 */
  lateralE: number;
}

/** 默认 Pacejka 参数(干沥青路面典型值)。 */
const DEFAULT_TIRE_PARAMS: TireParams = {
  longitudinalB: 10,
  longitudinalC: 1.65,
  longitudinalD: 1.0,
  longitudinalE: 0.97,
  lateralB: 8,
  lateralC: 1.3,
  lateralD: 1.0,
  lateralE: 0.97,
};

/** 默认传动配置:6 挡手动 + 倒挡。 */
function createDefaultTransmission(): Transmission {
  return {
    type: 'manual',
    gears: [-3.5, 3.6, 2.1, 1.4, 1.0, 0.8, 0.65],
    currentGear: 1,
    differentialRatio: 3.7,
    clutch: 1,
    upshiftRPM: 6000,
    downshiftRPM: 2000,
  };
}

/** VehiclePhysics.getStats() 返回的统计信息。 */
export interface VehicleStats {
  mass: number;
  speed: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  gearRatio: number;
  isGrounded: boolean;
  groundedWheels: number;
  wheelCount: number;
  steeringAngle: number;
  downforce: number;
  dragForce: number;
  engineTorque: number;
  wheelTorque: number;
  position: Vector3;
  velocity: Vector3;
}

const EPS = 1e-6;

export class VehiclePhysics {
  /** 质量(kg)。 */
  mass: number;
  /** 重心位置(车身本地空间)。 */
  centerOfMass: Vector3;
  /** 轴距(m)。 */
  wheelbase: number;
  /** 轮距(m)。 */
  trackWidth: number;
  /** 车轮数组。 */
  wheels: Wheel[] = [];
  /** 引擎最大功率(W)。 */
  enginePower: number;
  /** 引擎最大转速(RPM)。 */
  maxRPM: number;
  /** 怠速转速(RPM)。 */
  idleRPM: number;
  /** 当前引擎转速(RPM)。 */
  rpm: number;
  /** 制动力(N)。 */
  brakeForce: number;
  /** 手刹力(N)。 */
  handbrakeForce: number;
  /** 当前转向角(弧度,前轮)。 */
  steeringAngle: number;
  /** 最大转向角(弧度)。 */
  maxSteeringAngle: number;
  /** 转向角速度(rad/s)。 */
  steeringSpeed: number;
  /** 传动系统。 */
  transmission: Transmission;
  /** 空气密度。 */
  airDensity: number;
  /** 下压力系数。 */
  downforceCoefficient: number;
  /** 阻力系数。 */
  dragCoefficient: number;
  /** 迎风面积(m²)。 */
  frontalArea: number;
  /** 滚动阻力系数。 */
  rollingResistance: number;
  /** 重力加速度。 */
  gravity: Vector3;
  /** 当前下压力(N)。 */
  downforce: number;
  /** 当前空气阻力(N)。 */
  dragForce: number;
  /** 当前引擎扭矩(N·m)。 */
  engineTorque: number;
  /** 当前轮端总扭矩(N·m)。 */
  wheelTorque: number;

  /** Pacejka 轮胎模型参数。 */
  tireParams: TireParams;

  /** 车身位置(世界空间)。 */
  position: Vector3;
  /** 车身线速度(世界空间)。 */
  velocity: Vector3;
  /** 车身朝向(世界空间)。 */
  orientation: Quaternion;
  /** 车身角速度(世界空间,rad/s)。 */
  angularVelocity: Vector3;

  /** 油门输入 [0,1]。 */
  throttle: number;
  /** 刹车输入 [0,1]。 */
  brake: number;
  /** 手刹输入 [0,1]。 */
  handbrakeInput: number;
  /** 转向输入 [-1,1]。 */
  steerInput: number;

  /** 是否接地(任意一轮接地即为 true)。 */
  isGrounded: boolean;
  /** 当前速度(m/s)。 */
  speed: number;
  /** 当前速度(km/h)。 */
  speedKmh: number;

  /** 地面高度函数:输入 x/z,返回地面 y(默认 0 平面)。
   *  调用方可设置为地形采样函数。 */
  groundHeightFn: (x: number, z: number) => number;

  constructor(opts: VehicleOptions = {}) {
    this.mass = opts.mass ?? 1500;
    this.centerOfMass = opts.centerOfMass ? opts.centerOfMass.clone() : new Vector3();
    this.wheelbase = opts.wheelbase ?? 2.6;
    this.trackWidth = opts.trackWidth ?? 1.6;
    this.enginePower = opts.enginePower ?? 150000;
    this.maxRPM = opts.maxRPM ?? 7000;
    this.idleRPM = opts.idleRPM ?? 800;
    this.rpm = this.idleRPM;
    this.brakeForce = opts.brakeForce ?? 12000;
    this.handbrakeForce = opts.handbrakeForce ?? 18000;
    this.steeringAngle = 0;
    this.maxSteeringAngle = opts.maxSteeringAngle ?? 0.5;
    this.steeringSpeed = opts.steeringSpeed ?? 4;
    this.airDensity = opts.airDensity ?? 1.225;
    this.downforceCoefficient = opts.downforceCoefficient ?? 0.3;
    this.dragCoefficient = opts.dragCoefficient ?? 0.3;
    this.frontalArea = opts.frontalArea ?? 2.2;
    this.rollingResistance = opts.rollingResistance ?? 0.015;
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -9.8, 0);
    this.downforce = 0;
    this.dragForce = 0;
    this.engineTorque = 0;
    this.wheelTorque = 0;
    this.tireParams = { ...DEFAULT_TIRE_PARAMS, ...opts.tireParams };

    this.transmission = createDefaultTransmission();
    if (opts.transmission) {
      Object.assign(this.transmission, opts.transmission);
    }

    this.position = new Vector3();
    this.velocity = new Vector3();
    this.orientation = new Quaternion();
    this.angularVelocity = new Vector3();
    this.throttle = 0;
    this.brake = 0;
    this.handbrakeInput = 0;
    this.steerInput = 0;
    this.isGrounded = false;
    this.speed = 0;
    this.speedKmh = 0;
    this.groundHeightFn = () => 0;
  }

  /** 设置质量。 */
  setMass(mass: number): this {
    if (mass <= 0) throw new Error(`VehiclePhysics.setMass: mass must be > 0 (got ${mass})`);
    this.mass = mass;
    return this;
  }

  /** 设置重心位置(克隆)。 */
  setCenterOfMass(com: Vector3): this {
    this.centerOfMass.copy(com);
    return this;
  }

  /** 添加车轮(克隆输入避免外部引用耦合)。 */
  addWheel(wheel: Partial<Wheel> & { position: Vector3 }): this {
    this.wheels.push({
      position: wheel.position.clone(),
      radius: wheel.radius ?? 0.3,
      steering: wheel.steering ?? false,
      driven: wheel.driven ?? false,
      braking: wheel.braking ?? true,
      suspensionRest: wheel.suspensionRest ?? 0.5,
      suspensionStiffness: wheel.suspensionStiffness ?? 28000,
      suspensionDamping: wheel.suspensionDamping ?? 4000,
      suspensionForce: 0,
      tireGrip: wheel.tireGrip ?? 1.0,
      slip: 0,
      slipRatio: 0,
      isGrounded: false,
      contactPoint: new Vector3(),
      contactNormal: new Vector3(0, 1, 0),
      wheelRotation: 0,
      wheelAngularVelocity: 0,
      compression: 0,
      lastLength: (wheel.suspensionRest ?? 0.5) + (wheel.radius ?? 0.3),
    });
    return this;
  }

  /** 移除车轮(按索引)。 */
  removeWheel(index: number): this {
    if (index < 0 || index >= this.wheels.length) {
      throw new Error(`VehiclePhysics.removeWheel: index out of range (${index})`);
    }
    this.wheels.splice(index, 1);
    return this;
  }

  /** 获取车轮数组。 */
  getWheels(): Wheel[] {
    return this.wheels;
  }

  /** 获取车轮数。 */
  getWheelCount(): number {
    return this.wheels.length;
  }

  /** 设置引擎最大功率。 */
  setEnginePower(power: number): this {
    if (power < 0) throw new Error(`VehiclePhysics.setEnginePower: power must be >= 0 (got ${power})`);
    this.enginePower = power;
    return this;
  }

  /** 设置制动力。 */
  setBrakeForce(force: number): this {
    if (force < 0) throw new Error(`VehiclePhysics.setBrakeForce: force must be >= 0 (got ${force})`);
    this.brakeForce = force;
    return this;
  }

  /** 设置当前转向角(直接设置,绕过 steeringInput)。 */
  setSteering(angle: number): this {
    this.steeringAngle = Math.max(-this.maxSteeringAngle, Math.min(this.maxSteeringAngle, angle));
    return this;
  }

  /** 转向输入(-1 左 / +1 右),按 steeringSpeed 推进 steeringAngle。 */
  steeringInput(input: number, dt: number): this {
    this.steerInput = Math.max(-1, Math.min(1, input));
    const target = this.steerInput * this.maxSteeringAngle;
    const maxDelta = this.steeringSpeed * dt;
    const delta = target - this.steeringAngle;
    if (delta > maxDelta) this.steeringAngle += maxDelta;
    else if (delta < -maxDelta) this.steeringAngle -= maxDelta;
    else this.steeringAngle = target;
    return this;
  }

  /** 油门输入(0..1)。 */
  throttleInput(input: number): this {
    this.throttle = Math.max(0, Math.min(1, input));
    return this;
  }

  /** 刹车输入(0..1)。 */
  brakeInput(input: number): this {
    this.brake = Math.max(0, Math.min(1, input));
    return this;
  }

  /** 手刹(0..1)。 */
  handbrake(input: number): this {
    this.handbrakeInput = Math.max(0, Math.min(1, input));
    return this;
  }

  /** 升挡(若非最高挡)。 */
  shiftUp(): this {
    if (this.transmission.currentGear < this.transmission.gears.length - 1) {
      this.transmission.currentGear++;
    }
    return this;
  }

  /** 降挡(若非最低挡;0 索引为倒挡,无法再降)。 */
  shiftDown(): this {
    if (this.transmission.currentGear > 0) {
      this.transmission.currentGear--;
    }
    return this;
  }

  /** 直接设置挡位(校验范围)。 */
  setGear(gear: number): this {
    if (gear < 0 || gear >= this.transmission.gears.length) {
      throw new Error(`VehiclePhysics.setGear: gear out of range (${gear})`);
    }
    this.transmission.currentGear = gear;
    return this;
  }

  /** 获取当前挡位索引。 */
  getGear(): number {
    return this.transmission.currentGear;
  }

  /** 获取当前挡位齿比。 */
  getGearRatio(): number {
    return this.transmission.gears[this.transmission.currentGear] ?? 0;
  }

  /** 获取当前引擎 RPM。 */
  getRPM(): number {
    return this.rpm;
  }

  /** 获取速度(m/s)。 */
  getSpeed(): number {
    return this.speed;
  }

  /** 获取速度(km/h)。 */
  getSpeedKmh(): number {
    return this.speedKmh;
  }

  /** 推进一帧。流程:
   *   1) updateSuspension(dt) — 悬挂弹簧 + 阻尼 + 接地检测
   *   2) updateTires(dt) — Pacejka 轮胎力 + 滑移
   *   3) updateEngine(dt) — RPM + 扭矩
   *   4) updateTransmission(dt) — 传动 + 自动换挡
   *   5) updateAerodynamics(dt) — 下压力 + 阻力
   *   6) integrate(dt) — 速度 / 位置 / 朝向积分
   *  dt 上限 1/30(防止大步长穿模)。 */
  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 1 / 30);
    this.updateSuspension(step);
    this.updateTires(step);
    this.updateEngine(step);
    this.updateTransmission(step);
    this.updateAerodynamics(step);
    this.integrate(step);
  }

  /** 更新悬挂:对每轮做 raycast 式接地检测(简化:从挂点向下投到 groundHeight),
   *  算出悬挂长度、压缩量、推力,标记 isGrounded / contactPoint / contactNormal。
   *  悬挂力 = k*compression - d*compressionVelocity(沿 contactNormal 推车身)。 */
  updateSuspension(dt: number): void {
    void dt;
    const com = this.centerOfMass;
    const up = new Vector3(0, 1, 0).applyQuaternion(this.orientation);
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.orientation);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.orientation);

    let grounded = false;
    for (const wheel of this.wheels) {
      // 车轮挂点世界位置 = 车身位置 + (挂点本地 - 重心) 旋转到世界
      const localOffset = wheel.position.clone().sub(com);
      const worldOffset = localOffset.applyQuaternion(this.orientation);
      const attachWorld = this.position.clone().add(worldOffset);

      // 向下投射线(沿 -up),长度 = suspensionRest + radius
      const rayLen = wheel.suspensionRest + wheel.radius;
      const groundY = this.groundHeightFn(attachWorld.x, attachWorld.z);
      // 挂点到地面距离(沿 -up 方向)
      const dist = attachWorld.y - groundY;

      if (dist <= rayLen + EPS && dist >= -wheel.radius) {
        // 接地:压缩量 = rayLen - dist(>=0)
        const compression = Math.max(0, rayLen - dist);
        const compressionVel =
          (wheel.lastLength - dist) / Math.max(dt, EPS);
        wheel.lastLength = dist;
        wheel.compression = compression;
        const force =
          wheel.suspensionStiffness * compression +
          wheel.suspensionDamping * compressionVel;
        wheel.suspensionForce = Math.max(0, force);
        wheel.isGrounded = true;
        // 接触点 = 地面正下方
        wheel.contactPoint.set(attachWorld.x, groundY, attachWorld.z);
        wheel.contactNormal.copy(up);
        grounded = true;
      } else {
        wheel.suspensionForce = 0;
        wheel.compression = 0;
        wheel.isGrounded = false;
        wheel.lastLength = rayLen;
      }
      void forward; void right;
    }
    this.isGrounded = grounded;
  }

  /** 更新轮胎:计算侧偏角 / 滑移率,Pacejka 求纵向 + 侧向力,
   *  累积为车身加速度(沿 forward 与 right 方向)。
   *  简化:假设车身本地 +Z 为前向,+X 为右向,-Y 为上(世界 up)。 */
  updateTires(dt: number): void {
    void dt;
    if (!this.isGrounded) {
      // 空中:车轮自转减速
      for (const wheel of this.wheels) {
        wheel.wheelAngularVelocity *= 0.95;
        wheel.wheelRotation += wheel.wheelAngularVelocity * dt;
      }
      return;
    }

    const forward = new Vector3(0, 0, -1).applyQuaternion(this.orientation);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.orientation);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.orientation);

    // 车身本地方向下的速度分量
    const vLong = this.velocity.dot(forward);
    const vLat = this.velocity.dot(right);

    let totalLongForce = 0;
    let totalLatForce = 0;
    let totalBrakeForce = 0;

    const drivenWheels = this.wheels.filter((w) => w.driven && w.isGrounded).length;
    const driveTorque = drivenWheels > 0 ? this.wheelTorque / drivenWheels : 0;

    for (const wheel of this.wheels) {
      if (!wheel.isGrounded) {
        wheel.wheelAngularVelocity *= 0.95;
        wheel.wheelRotation += wheel.wheelAngularVelocity * dt;
        continue;
      }

      // 侧偏角 = atan2(vLat, |vLong|)
      const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), EPS));
      wheel.slip = slipAngle;

      // 纵向滑移率:简化为驱动/制动滑移
      // 驱动滑移 = (ω*r - vLong) / max(|vLong|, 5)
      const wheelLinearVel = wheel.wheelAngularVelocity * wheel.radius;
      const slipDenom = Math.max(Math.abs(vLong), 5);
      const slipRatio = (wheelLinearVel - vLong) / slipDenom;
      wheel.slipRatio = slipRatio;

      // 法向载荷 = 悬挂力
      const load = wheel.suspensionForce;

      // Pacejka 力
      const longForce = this.computeTireForce(wheel, slipRatio, load, 'longitudinal');
      const latForce = this.computeTireForce(wheel, slipAngle, load, 'lateral');

      // 制动 / 手刹
      let brakeT = 0;
      if (wheel.braking) {
        brakeT = this.brake * this.brakeForce;
        if (this.handbrakeInput > 0 && !wheel.driven) {
          // 手刹作用于后轮(简化:非驱动轮 = 后轮)
          brakeT += this.handbrakeInput * this.handbrakeForce;
        }
        // 制动方向与运动相反
        if (Math.abs(vLong) > EPS) {
          totalBrakeForce -= Math.sign(vLong) * brakeT;
        }
      }

      totalLongForce += longForce;
      totalLatForce += latForce;

      // 驱动轮扭矩 → 角加速度(简化:ω += (driveTorque - brakeT) / (0.5*m*r²) * dt)
      if (wheel.driven) {
        const wheelInertia = 0.5 * (this.mass / 4) * wheel.radius * wheel.radius;
        const netTorque = driveTorque - Math.sign(wheel.wheelAngularVelocity) * brakeT * wheel.radius;
        const angAccel = wheelInertia > EPS ? netTorque / wheelInertia : 0;
        wheel.wheelAngularVelocity += angAccel * dt;
      } else {
        // 非驱动轮:被动滚动,跟随车身速度
        const target = vLong / wheel.radius;
        wheel.wheelAngularVelocity += (target - wheel.wheelAngularVelocity) * 0.5;
      }
      wheel.wheelRotation += wheel.wheelAngularVelocity * dt;
    }

    // 累积车身加速度(世界空间)
    const longAccel = forward.clone().multiplyScalar(totalLongForce / this.mass);
    const latAccel = right.clone().multiplyScalar(-totalLatForce / this.mass);
    const brakeAccel = forward.clone().multiplyScalar(totalBrakeForce / this.mass);

    this.velocity.add(longAccel.multiplyScalar(dt));
    this.velocity.add(latAccel.multiplyScalar(dt));
    this.velocity.add(brakeAccel.multiplyScalar(dt));

    // 转向 → 角速度(Y 轴):简化自行车模型
    if (Math.abs(vLong) > 0.5) {
      const turnRadius = this.wheelbase / Math.tan(Math.abs(this.steeringAngle) + EPS);
      const yawRate = (vLong / turnRadius) * Math.sign(this.steeringAngle);
      this.angularVelocity.y = yawRate;
    } else {
      this.angularVelocity.y *= 0.5;
    }
    void up;
  }

  /** Pacejka 简化魔术公式:F = D*sin(C*atan(B*slip - E*(B*slip - atan(B*slip))))。
   *  D = μ * load(峰值 = 摩擦系数 × 法向载荷)。
   *  mode: 'longitudinal' | 'lateral' 选择对应的 B/C/D/E。 */
  computeTireForce(
    wheel: Wheel,
    slip: number,
    load: number,
    mode: 'longitudinal' | 'lateral' = 'longitudinal',
  ): number {
    const p = this.tireParams;
    let B: number, C: number, D: number, E: number;
    if (mode === 'longitudinal') {
      B = p.longitudinalB;
      C = p.longitudinalC;
      D = p.longitudinalD * wheel.tireGrip * load;
      E = p.longitudinalE;
    } else {
      B = p.lateralB;
      C = p.lateralC;
      D = p.lateralD * wheel.tireGrip * load;
      E = p.lateralE;
    }
    // F = D * sin(C * atan(B*slip - E*(B*slip - atan(B*slip))))
    const Bs = B * slip;
    const inner = Bs - E * (Bs - Math.atan(Bs));
    return D * Math.sin(C * Math.atan(inner));
  }

  /** 更新引擎:基于 throttle 与 RPM 计算输出扭矩。
   *  简化扭矩曲线:torque = (enginePower / maxRPM) * rpm * throttle * (1 - rpm/maxRPM*0.5)。
   *  怠速:throttle=0 时 rpm 趋向 idleRPM。 */
  updateEngine(dt: number): void {
    // 目标 RPM:由车速 + 挡位反推(离合器结合时)
    const gearRatio = this.getGearRatio();
    const wheelAngularVel = this.wheels.length > 0
      ? this.wheels.reduce((s, w) => s + Math.abs(w.wheelAngularVelocity), 0) / this.wheels.length
      : 0;
    const targetRPMFromWheels = Math.abs(
      wheelAngularVel * gearRatio * this.transmission.differentialRatio * 60 / (2 * Math.PI),
    );

    if (this.transmission.clutch > 0.5 && this.isGrounded) {
      // 离合器结合:RPM 跟随轮速
      const target = Math.max(this.idleRPM, targetRPMFromWheels);
      this.rpm += (target - this.rpm) * Math.min(1, dt * 10);
    } else {
      // 离合器分离:RPM 跟油门
      const target = this.idleRPM + (this.maxRPM - this.idleRPM) * this.throttle;
      this.rpm += (target - this.rpm) * Math.min(1, dt * 5);
    }
    this.rpm = Math.max(this.idleRPM, Math.min(this.maxRPM, this.rpm));

    // 扭矩曲线:简化为 rpm 在 midRange 时扭矩最大
    const rpmRatio = this.rpm / this.maxRPM;
    const torqueCurve = 1 - Math.pow(2 * rpmRatio - 1, 2); // 钟形曲线,峰值在 rpm = maxRPM/2
    this.engineTorque = (this.enginePower / (this.maxRPM * 2 * Math.PI / 60)) * this.throttle * Math.max(0, torqueCurve);
    // 轮端扭矩 = 引擎扭矩 * 齿比 * 终传 * 离合器
    this.wheelTorque = this.engineTorque * Math.abs(gearRatio) * this.transmission.differentialRatio * this.transmission.clutch;
  }

  /** 更新传动:自动换挡(若 type === 'automatic')。
   *  升挡:RPM > upshiftRPM 且非最高挡。
   *  降挡:RPM < downshiftRPM 且非最低挡。 */
  updateTransmission(dt: number): void {
    void dt;
    if (this.transmission.type !== 'automatic') return;
    if (this.rpm > this.transmission.upshiftRPM && this.transmission.currentGear < this.transmission.gears.length - 1) {
      this.shiftUp();
    } else if (this.rpm < this.transmission.downshiftRPM && this.transmission.currentGear > 1) {
      this.shiftDown();
    }
  }

  /** 更新空气动力学:
   *  • 下压力 = 0.5 * ρ * v² * Cl * frontalArea(向下,压车身)。
   *  • 阻力 = 0.5 * ρ * v² * Cd * frontalArea(反向于运动方向)。
   *  • 滚动阻力 = Crr * N(与速度方向相反,N = 法向载荷)。 */
  updateAerodynamics(dt: number): void {
    const v = this.speed;
    const v2 = v * v;
    this.downforce = 0.5 * this.airDensity * v2 * this.downforceCoefficient * this.frontalArea;
    this.dragForce = 0.5 * this.airDensity * v2 * this.dragCoefficient * this.frontalArea;

    if (v > EPS) {
      // 阻力沿 -velocity 方向
      const dragAccel = (this.dragForce / this.mass) * dt;
      const vDir = this.velocity.clone().normalize().multiplyScalar(-dragAccel);
      this.velocity.add(vDir);
    }

    // 滚动阻力:与运动方向相反(仅接地时)
    if (this.isGrounded && v > EPS) {
      const rrForce = this.rollingResistance * this.mass * 9.8;
      const rrAccel = (rrForce / this.mass) * dt;
      const vDir = this.velocity.clone().normalize().multiplyScalar(-rrAccel);
      this.velocity.add(vDir);
    }
  }

  /** 计算下压力(给定速度 m/s)。 */
  computeDownforce(speed: number): number {
    return 0.5 * this.airDensity * speed * speed * this.downforceCoefficient * this.frontalArea;
  }

  /** 积分:位置 += 速度*dt;朝向按角速度更新(Y 轴)。
   *  接地时应用重力(若所有轮离地才完全自由落体)。 */
  integrate(dt: number): void {
    // 重力(若未接地)
    if (!this.isGrounded) {
      this.velocity.addScaledVector(this.gravity, dt);
    } else {
      // 接地时:垂直速度归零(简化,防止穿透地面)
      // 保留水平分量
      // 注:此处不直接清零,让悬挂力处理
    }

    // 位置积分
    this.position.addScaledVector(this.velocity, dt);

    // 朝向积分:仅 Y 轴偏航(简化)
    if (Math.abs(this.angularVelocity.y) > EPS) {
      const yawDelta = this.angularVelocity.y * dt;
      const yawQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawDelta);
      this.orientation.premultiply(yawQuat).normalize();
    }

    // 更新速度统计
    this.speed = this.velocity.length();
    this.speedKmh = this.speed * 3.6;
  }

  /** 获取统计信息。 */
  getStats(): VehicleStats {
    let groundedWheels = 0;
    for (const w of this.wheels) if (w.isGrounded) groundedWheels++;
    return {
      mass: this.mass,
      speed: this.speed,
      speedKmh: this.speedKmh,
      rpm: this.rpm,
      gear: this.transmission.currentGear,
      gearRatio: this.getGearRatio(),
      isGrounded: this.isGrounded,
      groundedWheels,
      wheelCount: this.wheels.length,
      steeringAngle: this.steeringAngle,
      downforce: this.downforce,
      dragForce: this.dragForce,
      engineTorque: this.engineTorque,
      wheelTorque: this.wheelTorque,
      position: this.position,
      velocity: this.velocity,
    };
  }
}

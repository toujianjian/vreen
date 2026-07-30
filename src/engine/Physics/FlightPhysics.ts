// FlightPhysics — 飞行物理模拟(升力 / 阻力 / 推力 / 控制面 / 重力)。
//
// 设计:
//   - 机身坐标系:沿用 three.js 约定,+X 右(沿翼展)、+Y 上、-Z 前向(机头方向)。
//     四元数 orientation 把机身坐标系映射到世界空间。
//   - 升力(Bernoulli):L = 0.5 * ρ * v² * Cl * A,方向垂直于来流方向(向上分量)。
//     Cl = Cl0 + 2π * sin(AOA)(薄翼理论线性近似,失速后骤降)。
//   - 阻力:D = 0.5 * ρ * v² * Cd * A,Cd = Cd0 + k * Cl²(诱导阻力)。
//   - 推力:沿机身前向(-Z),throttle ∈ [0,1] 映射 thrust ∈ [0, maxThrust]。
//   - 重力:沿世界 -Y 方向,F = m * g。
//   - 控制面:副翼(roll)/ 升降舵(pitch)/ 方向舵(yaw)/ 襟翼(增升)/ 扰流板(减升增阻)。
//     每个面产生力矩(绕对应轴),M = 0.5 * ρ * v² * Cm * A * chord。
//   - 迎角(AOA):机身前向与来流速度的夹角(俯仰平面)。
//   - 侧滑角:机身前向与来流速度的夹角(偏航平面)。
//   - 失速:AOA > stallAngle 时 Cl 骤降(简化为线性衰减)。
//   - G 力:|a| / 9.81,包括重力贡献(总加速度)。
//
// 与引擎的集成:
//   - update(dt) 内部完成:升力 → 阻力 → 推力 → 重力 → 控制面 → 积分。
//   - 与 ECS PhysicsSystems 解耦:飞行器是 6DOF 多面体,形态差异大,独立实现。
//   - 后续若要接入 ECS,可包装为 AircraftComponent + AircraftSystem。
//   - 调用方负责把 position/orientation 同步到渲染 Mesh。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 控制面类型。 */
export type ControlSurfaceType = 'aileron' | 'elevator' | 'rudder' | 'flap' | 'spoiler';

/** 控制面(副翼 / 升降舵 / 方向舵 / 襟翼 / 扰流板)。 */
export interface ControlSurface {
  /** 控制面类型。 */
  type: ControlSurfaceType;
  /** 当前偏转角(弧度)。 */
  deflection: number;
  /** 最大偏转角(弧度,绝对值)。 */
  maxDeflection: number;
  /** 效率系数 [0,1](0 = 完全失效,1 = 满效能)。 */
  effectiveness: number;
  /** 控制面面积(m²)。 */
  area: number;
  /** 距重心的力臂(机身本地空间,用于力矩计算)。 */
  arm: Vector3;
}

/** FlightPhysics 构造选项。 */
export interface FlightOptions {
  /** 质量(kg),默认 1200(轻型单引擎飞机)。 */
  mass?: number;
  /** 翼展(m,默认 10)。 */
  wingspan?: number;
  /** 机翼面积(m²,默认 16)。 */
  wingArea?: number;
  /** 机身迎风面积(m²,默认 2)。 */
  fuselageArea?: number;
  /** 基础升力系数 Cl0(默认 0.2)。 */
  liftCoefficient?: number;
  /** 基础阻力系数 Cd0(默认 0.025)。 */
  dragCoefficient?: number;
  /** 诱导阻力系数 k(默认 0.04)。 */
  inducedDragFactor?: number;
  /** 最大推力(N,默认 4000)。 */
  maxThrust?: number;
  /** 空气密度 ρ(kg/m³,默认 1.225 海平面)。 */
  airDensity?: number;
  /** 失速角(弧度,默认 0.26 ≈ 15°)。 */
  stallAngle?: number;
  /** 重力加速度(默认 (0,-9.8,0))。 */
  gravity?: Vector3;
  /** 转动惯量(机身三轴,默认按质量估算)。 */
  inertia?: Vector3;
  /** 角速度阻尼(空气阻尼,默认 0.5)。 */
  angularDamping?: number;
}

/** FlightPhysics.getStats() 返回的统计信息。 */
export interface FlightStats {
  mass: number;
  speed: number;
  speedKmh: number;
  altitude: number;
  angleOfAttack: number;
  sideslipAngle: number;
  gForce: number;
  isStalled: boolean;
  stallAngle: number;
  thrust: number;
  lift: number;
  drag: number;
  pitchInput: number;
  rollInput: number;
  yawInput: number;
  controlSurfaceCount: number;
  position: Vector3;
  velocity: Vector3;
}

const EPS = 1e-6;

export class FlightPhysics {
  /** 质量(kg)。 */
  mass: number;
  /** 翼展(m)。 */
  wingspan: number;
  /** 机翼面积(m²)。 */
  wingArea: number;
  /** 机身迎风面积(m²)。 */
  fuselageArea: number;
  /** 基础升力系数 Cl0。 */
  liftCoefficient: number;
  /** 基础阻力系数 Cd0。 */
  dragCoefficient: number;
  /** 诱导阻力系数 k。 */
  inducedDragFactor: number;
  /** 当前推力(N)。 */
  thrust: number;
  /** 最大推力(N)。 */
  maxThrust: number;
  /** 油门输入 [0,1]。 */
  throttle: number;
  /** 俯仰输入值 [-1,1](当前值,由 pitchInput() 设置)。 */
  pitch: number;
  /** 滚转输入值 [-1,1](当前值,由 rollInput() 设置)。 */
  roll: number;
  /** 偏航输入值 [-1,1](当前值,由 yawInput() 设置)。 */
  yaw: number;
  /** 空气密度(kg/m³)。 */
  airDensity: number;
  /** 当前线速度(世界空间)。 */
  velocity: Vector3;
  /** 当前角速度(机身本地空间,rad/s)。 */
  angularVelocity: Vector3;
  /** 当前高度(m,= position.y)。 */
  altitude: number;
  /** 当前迎角(弧度)。 */
  angleOfAttack: number;
  /** 当前侧滑角(弧度)。 */
  sideslipAngle: number;
  /** 当前 G 力(无量纲,= |a| / g)。 */
  gForce: number;
  /** 失速角(弧度)。 */
  stallAngle: number;
  /** 是否失速。 */
  isStalled: boolean;
  /** 控制面数组。 */
  controlSurfaces: ControlSurface[] = [];

  /** 转动惯量(机身三轴:X=roll,Y=yaw,Z=pitch)。 */
  inertia: Vector3;
  /** 角速度空气阻尼系数。 */
  angularDamping: number;
  /** 重力加速度。 */
  gravity: Vector3;

  /** 机身位置(世界空间)。 */
  position: Vector3;
  /** 机身朝向(世界空间)。 */
  orientation: Quaternion;
  /** 当前升力(N)。 */
  lift: number;
  /** 当前阻力(N)。 */
  drag: number;
  /** 当前累积加速度(世界空间,本帧由各 compute* 写入,integrate 消费)。 */
  private _acceleration: Vector3;
  /** 上一帧速度(用于 G 力计算)。 */
  private _prevVelocity: Vector3;

  constructor(opts: FlightOptions = {}) {
    this.mass = opts.mass ?? 1200;
    this.wingspan = opts.wingspan ?? 10;
    this.wingArea = opts.wingArea ?? 16;
    this.fuselageArea = opts.fuselageArea ?? 2;
    this.liftCoefficient = opts.liftCoefficient ?? 0.2;
    this.dragCoefficient = opts.dragCoefficient ?? 0.025;
    this.inducedDragFactor = opts.inducedDragFactor ?? 0.04;
    this.thrust = 0;
    this.maxThrust = opts.maxThrust ?? 4000;
    this.throttle = 0;
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.airDensity = opts.airDensity ?? 1.225;
    this.velocity = new Vector3();
    this.angularVelocity = new Vector3();
    this.altitude = 0;
    this.angleOfAttack = 0;
    this.sideslipAngle = 0;
    this.gForce = 1;
    this.stallAngle = opts.stallAngle ?? 0.26;
    this.isStalled = false;
    this.inertia = opts.inertia ? opts.inertia.clone() : new Vector3(1500, 1500, 3000);
    this.angularDamping = opts.angularDamping ?? 0.5;
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -9.8, 0);

    this.position = new Vector3();
    this.orientation = new Quaternion();
    this.lift = 0;
    this.drag = 0;
    this._acceleration = new Vector3();
    this._prevVelocity = new Vector3();
  }

  /** 设置质量。 */
  setMass(mass: number): this {
    if (mass <= 0) throw new Error(`FlightPhysics.setMass: mass must be > 0 (got ${mass})`);
    this.mass = mass;
    return this;
  }

  /** 设置机翼参数。 */
  setWing(wingspan: number, area: number): this {
    if (wingspan <= 0) throw new Error(`FlightPhysics.setWing: wingspan must be > 0 (got ${wingspan})`);
    if (area <= 0) throw new Error(`FlightPhysics.setWing: area must be > 0 (got ${area})`);
    this.wingspan = wingspan;
    this.wingArea = area;
    return this;
  }

  /** 设置升力 / 阻力系数。 */
  setCoefficients(lift: number, drag: number): this {
    this.liftCoefficient = lift;
    this.dragCoefficient = drag;
    return this;
  }

  /** 设置当前推力。 */
  setThrust(thrust: number): this {
    this.thrust = Math.max(0, Math.min(this.maxThrust, thrust));
    return this;
  }

  /** 设置最大推力。 */
  setMaxThrust(max: number): this {
    if (max < 0) throw new Error(`FlightPhysics.setMaxThrust: max must be >= 0 (got ${max})`);
    this.maxThrust = max;
    if (this.thrust > max) this.thrust = max;
    return this;
  }

  /** 油门输入(0..1),自动映射到 [0, maxThrust]。 */
  throttleInput(input: number): this {
    this.throttle = Math.max(0, Math.min(1, input));
    this.thrust = this.throttle * this.maxThrust;
    return this;
  }

  /** 俯仰输入(-1..1)。 */
  pitchInput(input: number): this {
    this.pitch = Math.max(-1, Math.min(1, input));
    return this;
  }

  /** 滚转输入(-1..1)。 */
  rollInput(input: number): this {
    this.roll = Math.max(-1, Math.min(1, input));
    return this;
  }

  /** 偏航输入(-1..1)。 */
  yawInput(input: number): this {
    this.yaw = Math.max(-1, Math.min(1, input));
    return this;
  }

  /** 添加控制面。 */
  addControlSurface(surface: Partial<ControlSurface> & { type: ControlSurfaceType }): this {
    this.controlSurfaces.push({
      type: surface.type,
      deflection: surface.deflection ?? 0,
      maxDeflection: surface.maxDeflection ?? 0.4,
      effectiveness: surface.effectiveness ?? 1,
      area: surface.area ?? 1,
      arm: surface.arm ? surface.arm.clone() : new Vector3(),
    });
    return this;
  }

  /** 移除控制面(按索引)。 */
  removeControlSurface(index: number): this {
    if (index < 0 || index >= this.controlSurfaces.length) {
      throw new Error(`FlightPhysics.removeControlSurface: index out of range (${index})`);
    }
    this.controlSurfaces.splice(index, 1);
    return this;
  }

  /** 获取控制面数组。 */
  getControlSurfaces(): ControlSurface[] {
    return this.controlSurfaces;
  }

  /** 推进一帧。流程:
   *   1) 计算迎角 / 侧滑角 / 速度
   *   2) computeLift — 升力(垂直来流方向)
   *   3) computeDrag — 阻力(反来流方向)
   *   4) computeThrust — 推力(沿机身前向 -Z)
   *   5) computeGravity — 重力(世界 -Y)
   *   6) computeControlForces — 控制面力矩
   *   7) integrate — 速度 / 位置 / 角速度 / 朝向积分
   *   8) checkStall — 失速检测
   *   9) computeGForce — G 力计算
   *   dt 上限 1/30(防止大步长数值爆炸)。 */
  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 1 / 30);

    // 清零加速度
    this._acceleration.set(0, 0, 0);
    this._prevVelocity.copy(this.velocity);

    // 计算迎角 / 侧滑角
    this.computeAngleOfAttack(this.velocity);
    this.computeSideslip(this.velocity);
    this.checkStall();

    // 力
    this.computeLift(this.velocity, this.airDensity);
    this.computeDrag(this.velocity, this.airDensity);
    this.computeThrust();
    this.computeGravity();
    this.computeControlForces(step);

    // 积分
    this.integrate(step);

    // G 力
    this.computeGForce(this._acceleration);
  }

  /** 计算升力:L = 0.5 * ρ * v² * Cl * A。
   *  Cl = Cl0 + 2π * sin(AOA)(薄翼理论线性近似)。
   *  失速时:Cl 按比例衰减(AOA 每超 stallAngle 一倍,Cl 衰减 50%)。
   *  方向:垂直于来流方向(取机身 up 在来流平面的分量)。
   *  返回升力大小,同时把升力累加到 _acceleration。 */
  computeLift(velocity: Vector3, airDensity: number): number {
    const v = velocity.length();
    if (v < EPS) {
      this.lift = 0;
      return 0;
    }
    // 升力系数:线性近似 + 失速衰减
    let cl = this.liftCoefficient + 2 * Math.PI * Math.sin(this.angleOfAttack);
    if (this.isStalled) {
      // 失速:超过 stallAngle 后,Cl 按 (AOA - stallAngle) 比例衰减
      const excess = Math.abs(this.angleOfAttack) - this.stallAngle;
      const decay = Math.max(0, 1 - excess / this.stallAngle);
      cl *= decay;
    }
    // 襟翼 / 扰流板影响
    for (const cs of this.controlSurfaces) {
      if (cs.type === 'flap') {
        cl += cs.effectiveness * cs.deflection * 1.5;
      } else if (cs.type === 'spoiler') {
        cl -= cs.effectiveness * cs.deflection * 1.2;
      }
    }

    const q = 0.5 * airDensity * v * v; // 动压
    this.lift = q * cl * this.wingArea;

    // 方向:垂直于来流方向(取机身 up 在垂直于来流的平面投影)
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.orientation);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.orientation);
    const velDir = velocity.clone().normalize();
    // 升力方向 = up - (up·velDir)*velDir(垂直分量),归一化
    const liftDir = up.clone().addScaledVector(velDir, -up.dot(velDir));
    if (liftDir.lengthSq() > EPS) {
      liftDir.normalize();
    } else {
      liftDir.copy(up);
    }
    // 累加加速度
    this._acceleration.addScaledVector(liftDir, this.lift / this.mass);
    void forward;
    return this.lift;
  }

  /** 计算阻力:D = 0.5 * ρ * v² * Cd * A。
   *  Cd = Cd0 + k * Cl²(诱导阻力)+ 机身寄生阻力。
   *  方向:反来流方向。
   *  返回阻力大小,同时累加到 _acceleration。 */
  computeDrag(velocity: Vector3, airDensity: number): number {
    const v = velocity.length();
    if (v < EPS) {
      this.drag = 0;
      return 0;
    }
    const cl = this.liftCoefficient + 2 * Math.PI * Math.sin(this.angleOfAttack);
    let cd = this.dragCoefficient + this.inducedDragFactor * cl * cl;
    // 扰流板增加阻力
    for (const cs of this.controlSurfaces) {
      if (cs.type === 'spoiler') {
        cd += cs.effectiveness * cs.deflection * 0.5;
      } else if (cs.type === 'flap') {
        cd += cs.effectiveness * cs.deflection * 0.3;
      }
    }
    const q = 0.5 * airDensity * v * v;
    const wingDrag = q * cd * this.wingArea;
    const fuselageDrag = q * this.dragCoefficient * this.fuselageArea;
    this.drag = wingDrag + fuselageDrag;

    // 方向:反来流
    const dragDir = velocity.clone().normalize().multiplyScalar(-1);
    this._acceleration.addScaledVector(dragDir, this.drag / this.mass);
    return this.drag;
  }

  /** 计算推力:沿机身前向(-Z)施加 thrust。
   *  累加到 _acceleration。返回推力大小。 */
  computeThrust(): number {
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.orientation);
    this._acceleration.addScaledVector(forward, this.thrust / this.mass);
    return this.thrust;
  }

  /** 计算重力:沿世界 -Y 方向施加 m*g。
   *  累加到 _acceleration。返回重力大小。 */
  computeGravity(): number {
    const g = this.gravity.length();
    this._acceleration.add(this.gravity);
    return g * this.mass;
  }

  /** 计算控制面产生的力矩(机身本地空间角加速度)。
   *  • 副翼(aileron):绕机身 X 轴(roll),力矩 = q * Cl_aileron * area * wingspan。
   *  • 升降舵(elevator):绕机身 Z 轴(pitch,实际是绕机身 Z 轴的负方向)。
   *  • 方向舵(rudder):绕机身 Y 轴(yaw)。
   *  力矩写入 angularVelocity(直接积分,简化)。 */
  computeControlForces(dt: number): void {
    const v = this.velocity.length();
    const q = 0.5 * this.airDensity * v * v;
    if (q < EPS) return;

    let rollMoment = 0;
    let pitchMoment = 0;
    let yawMoment = 0;

    for (const cs of this.controlSurfaces) {
      const moment = q * cs.effectiveness * cs.deflection * cs.area;
      const armLen = cs.arm.length();
      switch (cs.type) {
        case 'aileron':
          // 副翼:绕机身 X 轴(roll);rollInput 直接驱动偏转
          rollMoment += this.roll * cs.effectiveness * cs.maxDeflection * q * cs.area * (armLen || this.wingspan / 2);
          break;
        case 'elevator':
          // 升降舵:绕机身 Z 轴(pitch);pitchInput 驱动
          pitchMoment += this.pitch * cs.effectiveness * cs.maxDeflection * q * cs.area * (armLen || 2);
          break;
        case 'rudder':
          // 方向舵:绕机身 Y 轴(yaw);yawInput 驱动
          yawMoment += this.yaw * cs.effectiveness * cs.maxDeflection * q * cs.area * (armLen || 2);
          break;
        case 'flap':
        case 'spoiler':
          // 襟翼 / 扰流板主要改变升阻力,不直接产生力矩
          break;
      }
      void moment;
    }

    // 角加速度 = 力矩 / 转动惯量
    const rollAccel = this.inertia.x > EPS ? rollMoment / this.inertia.x : 0;
    const pitchAccel = this.inertia.z > EPS ? pitchMoment / this.inertia.z : 0;
    const yawAccel = this.inertia.y > EPS ? yawMoment / this.inertia.y : 0;

    // 累加角速度(机身本地空间)
    this.angularVelocity.x += rollAccel * dt;
    this.angularVelocity.z += pitchAccel * dt;
    this.angularVelocity.y += yawAccel * dt;

    // 空气阻尼(角速度衰减)
    const damp = Math.max(0, 1 - this.angularDamping * dt);
    this.angularVelocity.x *= damp;
    this.angularVelocity.y *= damp;
    this.angularVelocity.z *= damp;
  }

  /** 计算迎角(AOA):机身前向(-Z)与来流速度的夹角(俯仰平面)。
   *  α = atan2(-vBody.y, -vBody.z),其中 vBody = velocity 旋转到机身本地空间。
   *  物理约定:来流从下方来(飞机俯冲或机头上仰平飞)→ α > 0;
   *  来流从上方来(飞机爬升)→ α < 0。
   *  写入 this.angleOfAttack 并返回。 */
  computeAngleOfAttack(velocity: Vector3): number {
    // 把世界速度变换到机身本地空间
    const inv = this.orientation.clone().invert();
    const vBody = velocity.clone().applyQuaternion(inv);
    // 机身前向是 -Z,所以前向速度分量 = -vBody.z(>0 表示前飞)
    const vForward = -vBody.z;
    const vUp = vBody.y;
    // α = atan2(-vUp, vForward) → 速度向下(vUp<0,俯冲)→ α>0(来流从下方来)
    if (Math.abs(vForward) < EPS && Math.abs(vUp) < EPS) {
      this.angleOfAttack = 0;
    } else {
      this.angleOfAttack = Math.atan2(-vUp, vForward);
    }
    return this.angleOfAttack;
  }

  /** 计算侧滑角:机身前向与来流速度的夹角(偏航平面)。
   *  β = atan2(vBodyX, vForward)。 */
  computeSideslip(velocity: Vector3): number {
    const inv = this.orientation.clone().invert();
    const vBody = velocity.clone().applyQuaternion(inv);
    const vForward = -vBody.z;
    const vRight = vBody.x;
    if (Math.abs(vForward) < EPS && Math.abs(vRight) < EPS) {
      this.sideslipAngle = 0;
    } else {
      this.sideslipAngle = Math.atan2(vRight, vForward);
    }
    return this.sideslipAngle;
  }

  /** 计算 G 力:|a| / g(总加速度包括重力)。 */
  computeGForce(acceleration: Vector3): number {
    const g = this.gravity.length();
    if (g < EPS) {
      this.gForce = 0;
      return 0;
    }
    // 总加速度 = (velocity - prevVelocity) / dt;此处用累积加速度 + 重力
    const totalAccel = acceleration.length();
    this.gForce = totalAccel / g;
    return this.gForce;
  }

  /** 检查失速:|AOA| > stallAngle 即失速。 */
  checkStall(): boolean {
    this.isStalled = Math.abs(this.angleOfAttack) > this.stallAngle;
    return this.isStalled;
  }

  /** 获取高度(m,= position.y)。 */
  getAltitude(): number {
    this.altitude = this.position.y;
    return this.altitude;
  }

  /** 获取速度(m/s)。 */
  getSpeed(): number {
    return this.velocity.length();
  }

  /** 获取速度(km/h)。 */
  getSpeedKmh(): number {
    return this.velocity.length() * 3.6;
  }

  /** 获取迎角(弧度)。 */
  getAngleOfAttack(): number {
    return this.angleOfAttack;
  }

  /** 获取侧滑角(弧度)。 */
  getSideslip(): number {
    return this.sideslipAngle;
  }

  /** 获取 G 力。 */
  getGForce(): number {
    return this.gForce;
  }

  /** 是否失速。 */
  isStalling(): boolean {
    return this.isStalled;
  }

  /** 积分:速度 += a*dt;位置 += v*dt;朝向按角速度(机身本地)更新。
   *  角速度积分:ω 是机身本地空间,需先转到世界空间再应用。 */
  integrate(dt: number): void {
    // 线速度 / 位置
    this.velocity.addScaledVector(this._acceleration, dt);
    this.position.addScaledVector(this.velocity, dt);
    this.altitude = this.position.y;

    // 角速度 → 朝向:把机身本地的 ω 转到世界,再用轴角法应用
    const worldAngVel = this.angularVelocity.clone().applyQuaternion(this.orientation);
    const angVelMag = worldAngVel.length();
    if (angVelMag > EPS) {
      const axis = worldAngVel.clone().divideScalar(angVelMag);
      const angle = angVelMag * dt;
      const dq = new Quaternion().setFromAxisAngle(axis, angle);
      this.orientation.premultiply(dq).normalize();
    }
  }

  /** 获取统计信息。 */
  getStats(): FlightStats {
    return {
      mass: this.mass,
      speed: this.getSpeed(),
      speedKmh: this.getSpeedKmh(),
      altitude: this.getAltitude(),
      angleOfAttack: this.angleOfAttack,
      sideslipAngle: this.sideslipAngle,
      gForce: this.gForce,
      isStalled: this.isStalled,
      stallAngle: this.stallAngle,
      thrust: this.thrust,
      lift: this.lift,
      drag: this.drag,
      pitchInput: this.pitch,
      rollInput: this.roll,
      yawInput: this.yaw,
      controlSurfaceCount: this.controlSurfaces.length,
      position: this.position,
      velocity: this.velocity,
    };
  }
}

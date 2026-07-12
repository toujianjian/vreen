// Physics components — Rigidbody / Collider / Particle 相关组件。
//
// 设计:
// - 组件是纯数据 POJO,System 是行为分离
// - Collider 通过 shape 字段区分:AABB / Sphere / Capsule
// - Particle 组件保持轻量;实际 GPU instancing 在 ParticleSystem 里

import { ComponentType } from './ComponentType';

/** Collider shape 枚举。 */
export type ColliderShape = 'aabb' | 'sphere' | 'capsule';

/** Collider 数据(半尺寸/半径)。与 Transform 一起决定 world AABB。 */
export class Collider {
  shape: ColliderShape = 'aabb';
  /** AABB 半尺寸 [hx, hy, hz]。shape=aabb 时使用。 */
  halfExtents: [number, number, number] = [0.5, 0.5, 0.5];
  /** Sphere/Capsule 半径。shape=sphere|capsule 时使用。 */
  radius: number = 0.5;
  /** Capsule 高度(仅 shape=capsule)。 */
  height: number = 1.0;
  /** 摩擦 0..1。 */
  friction: number = 0.3;
  /** 弹性 0..1。 */
  restitution: number = 0.2;
  /** 物理层位掩码(0..15)。碰撞检测时 (a & b) !== 0 才考虑碰撞。 */
  layerMask: number = 0xFFFF;
  /** 是否静态(不参与动力学)。 */
  isStatic: boolean = false;
}
export const ColliderC = new ComponentType<Collider>('Collider');

/** 刚体动力学状态。position/rotation 由 Transform 持有,这里只存
 *  速度/角速度/反作用力/积分配置。 */
export class Rigidbody {
  /** 线速度 (m/s)。 */
  velocity: [number, number, number] = [0, 0, 0];
  /** 角速度向量 (rad/s),围绕 world 坐标轴。 */
  angularVelocity: [number, number, number] = [0, 0, 0];
  /** 质量 (kg),0 = static。 */
  mass: number = 1.0;
  /** 线性阻尼 0..1 每秒。 */
  linearDamping: number = 0.05;
  /** 角阻尼 0..1 每秒。 */
  angularDamping: number = 0.05;
  /** 重力缩放 (1.0 = 正常重力,0 = 无重力)。 */
  gravityScale: number = 1.0;
  /** 是否休眠(物理不再积分)。 */
  sleeping: boolean = false;
  /** 累积外力(每帧清零)。 */
  force: [number, number, number] = [0, 0, 0];
  /** 累积外力矩(每帧清零)。 */
  torque: [number, number, number] = [0, 0, 0];
  /** 物理层掩码。 */
  layerMask: number = 0xFFFF;
  /** 物理 ID(用于碰撞对去重)。 */
  bodyId: number = 0;

  /** 施加力(下一帧物理 step 应用后清零)。 */
  addForce(x: number, y: number, z: number): void {
    this.force[0] += x;
    this.force[1] += y;
    this.force[2] += z;
  }
  addTorque(x: number, y: number, z: number): void {
    this.torque[0] += x;
    this.torque[1] += y;
    this.torque[2] += z;
  }
  /** 设置朝向速度(忽略 Y 高度分量),便于玩家跳跃/移动。 */
  setHorizontalSpeed(speed: number, yawRadians: number): void {
    this.velocity[0] = Math.cos(yawRadians) * speed;
    this.velocity[2] = -Math.sin(yawRadians) * speed;
  }
}
export const RigidbodyC = new ComponentType<Rigidbody>('Rigidbody');

/** 物理世界配置(全局参数,挂在名为 'physics' 的 entity 上)。 */
export class PhysicsConfig {
  gravity: [number, number, number] = [0, -9.81, 0];
  /** 固定时间步 (s)。 */
  fixedDelta: number = 1 / 60;
  /** 每帧最大子步数,防止 spiral of death。 */
  maxSubsteps: number = 4;
  /** 速度阈值,低于此速度的物体会被标记为 sleeping。 */
  sleepSpeedThreshold: number = 0.05;
  /** Baumgarte 位置矫正因子 0..1。 */
  baumgarte: number = 0.2;
  /** 启用 debug 渲染。 */
  enableDebug: boolean = false;
}
export const PhysicsConfigC = new ComponentType<PhysicsConfig>('PhysicsConfig');

/** 粒子组件:CPU 端。位置/速度/年龄;System 更新它们。 */
export class Particle {
  position: [number, number, number] = [0, 0, 0];
  velocity: [number, number, number] = [0, 0, 0];
  /** 年龄(秒),归零时由 emitter 决定 dispose / respawn。 */
  age: number = 0;
  /** 最大寿命(秒)。 */
  lifetime: number = 1.0;
  /** 颜色(r,g,b)。 */
  color: [number, number, number] = [1, 1, 1];
  /** 大小(world units)。 */
  size: number = 0.05;
  /** 重力缩放(0 = 无重力影响)。 */
  gravityScale: number = 0.2;
}
export const ParticleC = new ComponentType<Particle>('Particle');

/** 粒子发射器:挂在一个 entity 上,周期性 spawn 粒子到 children/registry。 */
export class ParticleEmitter {
  /** 每秒发射数。 */
  rate: number = 50;
  /** 初速度范围 [min, max] m/s。 */
  speedMin: number = 1.0;
  speedMax: number = 2.0;
  /** 寿命范围 [min, max] s。 */
  lifeMin: number = 0.4;
  lifeMax: number = 1.2;
  /** 颜色范围(随机插值两端)。 */
  colorA: [number, number, number] = [0.5, 0.8, 1.0];
  colorB: [number, number, number] = [0.1, 0.4, 1.0];
  /** 每次 spawn 时的累计时间累计。 */
  accumulator: number = 0;
  /** 半径(0 = 点状;>0 = 圆形区域)。 */
  spawnRadius: number = 0;
  /** 已发射的粒子 entity id 数组(emitter 持有引用,避免每帧 query)。 */
  particleIds: number[] = [];
  /** 上限,超过则不 spawn。 */
  maxParticles: number = 200;
}
export const ParticleEmitterC = new ComponentType<ParticleEmitter>('ParticleEmitter');

/** 物理调试器:挂在全局 entity,记录最近 N 帧的 contact points。 */
export class PhysicsDebug {
  /** 每个 contact point: [x, y, z, normalX, normalY, normalZ, depth]。 */
  contactPoints: Float32Array = new Float32Array(7 * 64);
  /** 当前有效 contact 数。 */
  contactCount: number = 0;
  /** 启用的 debug 通道。 */
  showColliders: boolean = true;
  showContacts: boolean = true;
  showVelocities: boolean = false;
  /** 速度可视化长度比例。 */
  velocityScale: number = 0.5;
}
export const PhysicsDebugC = new ComponentType<PhysicsDebug>('PhysicsDebug');

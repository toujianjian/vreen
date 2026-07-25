// Agent — AI 代理(导航实体),持位置/速度/路径 + 跟随路径逻辑。
//
// 设计:
//   * 与 ECS 解耦:Agent 是纯数据 + 行为的类,可被外部系统(Group/World)调度
//   * 路径以 Vector3[] 形式存储,currentWaypoint 指向下一个目标点
//   * update(dt) 内部:
//       1. 若有路径则调用 followPath() 产生转向力
//       2. 累加 acceleration
//       3. 半隐式 Euler 积分: velocity += acc * dt; position += vel * dt
//       4. 截断速度到 maxSpeed,清零 acceleration
//   * maxForce 限制单帧加速度上限,避免抖动
//
// 与 SteeringBehavior 的关系:
//   * Agent 持有一个 behavior 实例(可被多 Agent 共享)
//   * followPath() 内部调用 behavior.arrive() 到下一路径点

import { Vector3 } from '../Math';
import { SteeringBehavior } from './SteeringBehavior';

/** 到达判定阈值:距离小于此值视为已到达 waypoint。 */
const WAYPOINT_REACHED_DISTANCE = 0.5;

/**
 * AI 代理 — 在场景中导航移动的实体。
 */
export class Agent {
  /** 位置。 */
  position: Vector3;
  /** 速度。 */
  velocity: Vector3;
  /** 当前帧累计加速度(update 后清零)。 */
  acceleration: Vector3;
  /** 最大速度(单位/秒)。 */
  maxSpeed: number;
  /** 单帧最大转向力上限。 */
  maxForce: number;
  /** 质量(kg,影响 seek/flee 输出)。 */
  mass: number;
  /** 半径(用于分离/碰撞)。 */
  radius: number;
  /** 当前路径点列表。 */
  path: Vector3[] = [];
  /** 当前目标路径点索引(在 path 中)。 */
  currentWaypoint: number = 0;
  /** 关联的转向行为。 */
  behavior: SteeringBehavior;
  /** 是否循环路径(到达末尾后回到开头)。 */
  loop: boolean = false;
  /** 是否已激活(若 false,update 不积分)。 */
  enabled: boolean = true;

  constructor(options: Partial<AgentOptions> = {}) {
    this.position = options.position ?? new Vector3();
    this.velocity = options.velocity ?? new Vector3();
    this.acceleration = new Vector3();
    this.maxSpeed = options.maxSpeed ?? 5;
    this.maxForce = options.maxForce ?? 10;
    this.mass = options.mass ?? 1;
    this.radius = options.radius ?? 0.5;
    this.behavior = options.behavior ?? new SteeringBehavior();
    if (options.path) this.path = options.path.slice();
    this.loop = options.loop ?? false;
  }

  /** 设置当前路径(替换),并重置 waypoint 指针到 0。 */
  setPath(path: Vector3[]): this {
    this.path = path.slice();
    this.currentWaypoint = 0;
    return this;
  }

  /** 设置目标点(若已有路径则替换为单点路径)。 */
  setTarget(target: Vector3): this {
    this.path = [target.clone()];
    this.currentWaypoint = 0;
    return this;
  }

  /** 施加力到 acceleration。 */
  applyForce(force: Vector3): this {
    this.acceleration.add(force);
    return this;
  }

  /** 跟随路径:朝当前 waypoint 应用 arrive 力。
   *  到达后推进 currentWaypoint(若 loop 则回到 0)。 */
  followPath(): Vector3 {
    if (this.path.length === 0) return new Vector3();
    if (this.currentWaypoint >= this.path.length) {
      if (this.loop) this.currentWaypoint = 0;
      else return new Vector3();
    }
    const target = this.path[this.currentWaypoint];
    const force = this.behavior.arrive(this, target, WAYPOINT_REACHED_DISTANCE * 2);
    if (this.position.distanceTo(target) < WAYPOINT_REACHED_DISTANCE) {
      this.currentWaypoint++;
      // loop 模式下到达末尾立即循环,不等到下一帧
      if (this.loop && this.currentWaypoint >= this.path.length) {
        this.currentWaypoint = 0;
      }
    }
    return force;
  }

  /** 获取当前速度(用于外部读取)。 */
  getVelocity(): Vector3 {
    return this.velocity.clone();
  }

  /** 每帧更新:应用 followPath 力 → 积分 → 截断。
   *  dt: 时间步长(秒)。 */
  update(dt: number): this {
    if (!this.enabled) return this;
    if (this.path.length > 0 && this.currentWaypoint < this.path.length) {
      const force = this.followPath();
      this.applyForce(force);
    }

    // 力上限:截断 acceleration 到 maxForce
    if (this.acceleration.lengthSq() > this.maxForce * this.maxForce) {
      this.acceleration.multiplyScalar(this.maxForce / this.acceleration.length());
    }
    // 半隐式 Euler
    this.velocity.addScaledVector(this.acceleration, dt);
    // 速度上限
    if (this.velocity.lengthSq() > this.maxSpeed * this.maxSpeed) {
      this.velocity.multiplyScalar(this.maxSpeed / this.velocity.length());
    }
    this.position.addScaledVector(this.velocity, dt);
    this.acceleration.set(0, 0, 0);
    return this;
  }

  /** 重置代理到指定位置并清零速度。 */
  reset(position: Vector3): this {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.path = [];
    this.currentWaypoint = 0;
    return this;
  }
}

/** Agent 构造参数。 */
export interface AgentOptions {
  position: Vector3;
  velocity: Vector3;
  maxSpeed: number;
  maxForce: number;
  mass: number;
  radius: number;
  path: Vector3[];
  loop: boolean;
  behavior: SteeringBehavior;
}

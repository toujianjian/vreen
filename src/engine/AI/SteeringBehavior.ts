// SteeringBehavior — 转向行为(Reynolds 模型)。
//
// 设计:
//   * 所有方法返回 Vector3 转向力(加速度),由 Agent 累加并积分
//   * 不直接修改 agent,纯函数式风格 — 输出写入 target._force,但这里我们返回新向量
//   * 力的方向约定:单位向量 × maxSpeed × 衰减系数
//
// 行为分类(Reynolds 1999):
//   * 基础: seek / flee / arrive / pursue / evade / wander
//   * 群体(flocking): separation / alignment / cohesion
//   * 规避: obstacleAvoidance
//
// 与 Agent 的耦合:Agent 持有 SteeringBehavior 实例,每帧调用 1-N 个行为
// 并把返回的力累加进 acceleration。

import { Vector3 } from '../Math';
import type { Agent } from './Agent';

/** 障碍物描述:位置 + 半径,用于规避测试。 */
export interface Obstacle {
  position: Vector3;
  radius: number;
}

// 复用临时向量
const _desired = new Vector3();
const _diff = new Vector3();
const _ahead = new Vector3();
const _center = new Vector3();

/**
 * 转向行为集合 — 单个实例可被多 Agent 共享,所有方法无副作用。
 *
 * 用法:
 *   const steer = new SteeringBehavior();
 *   const f = steer.seek(agent, target);
 *   agent.applyForce(f);
 */
export class SteeringBehavior {
  /** 漫游圆半径与距离(Reynolds wander 参数)。 */
  wanderRadius = 1.0;
  /** 漫游圆距离 agent 头部的前置距离。 */
  wanderDistance = 2.0;
  /** 漫游抖动角度的幅度(弧度)。 */
  wanderJitter = 0.5;
  /** 当前漫游方向角度(弧度)。 */
  private wanderAngle = 0;

  /** 寻找:朝目标移动(最大速度直接朝目标)。 */
  seek(agent: Agent, target: Vector3): Vector3 {
    _desired.subVectors(target, agent.position);
    const d = _desired.length();
    if (d < 1e-6) return new Vector3();
    _desired.multiplyScalar(1 / d); // 归一化
    _desired.multiplyScalar(agent.maxSpeed);
    _diff.subVectors(_desired, agent.velocity);
    _diff.multiplyScalar(1 / Math.max(agent.mass, 1e-6));
    return _diff.clone();
  }

  /** 逃离:与 seek 反向。 */
  flee(agent: Agent, threat: Vector3): Vector3 {
    _desired.subVectors(agent.position, threat);
    const d = _desired.length();
    if (d < 1e-6) return new Vector3();
    // 距离远时减小力(避免远距干扰)
    if (d > 100) return new Vector3();
    _desired.multiplyScalar(1 / d);
    _desired.multiplyScalar(agent.maxSpeed);
    _diff.subVectors(_desired, agent.velocity);
    _diff.multiplyScalar(1 / Math.max(agent.mass, 1e-6));
    return _diff.clone();
  }

  /** 到达:接近目标时减速(slowingDistance 内速度按比例衰减)。 */
  arrive(agent: Agent, target: Vector3, slowingDistance: number): Vector3 {
    _desired.subVectors(target, agent.position);
    const d = _desired.length();
    if (d < 1e-6) return new Vector3();
    _desired.multiplyScalar(1 / d); // 归一化
    let speed = agent.maxSpeed;
    if (d < slowingDistance) {
      speed = agent.maxSpeed * (d / slowingDistance);
    }
    _desired.multiplyScalar(speed);
    _diff.subVectors(_desired, agent.velocity);
    _diff.multiplyScalar(1 / Math.max(agent.mass, 1e-6));
    return _diff.clone();
  }

  /** 追逐:预测目标下一刻位置(基于目标速度与预估时间)。 */
  pursue(agent: Agent, quarry: Agent): Vector3 {
    const dist = agent.position.distanceTo(quarry.position);
    // 预测时间 = 距离 / (我的最大速度 + 一点容差)
    const prediction = dist / (agent.maxSpeed + 1e-6);
    _ahead.copy(quarry.position).addScaledVector(quarry.velocity, prediction);
    return this.seek(agent, _ahead);
  }

  /** 逃避:与 pursue 反向,远离预测位置。 */
  evade(agent: Agent, pursuer: Agent): Vector3 {
    const dist = agent.position.distanceTo(pursuer.position);
    // 距离够远时无需逃避
    if (dist > 50) return new Vector3();
    const prediction = dist / (agent.maxSpeed + 1e-6);
    _ahead.copy(pursuer.position).addScaledVector(pursuer.velocity, prediction);
    return this.flee(agent, _ahead);
  }

  /** 漫游:在 agent 头部前方画圆,角度抖动产生新方向。 */
  wander(agent: Agent): Vector3 {
    // 抖动角度
    this.wanderAngle += (Math.random() - 0.5) * 2 * this.wanderJitter;
    // 圆上的目标点
    const target = new Vector3(
      Math.cos(this.wanderAngle) * this.wanderRadius,
      0,
      Math.sin(this.wanderAngle) * this.wanderRadius,
    );
    // 把圆心放在 agent 速度方向前方 wanderDistance 处
    const heading = agent.velocity.length() > 1e-6
      ? _diff.copy(agent.velocity).multiplyScalar(1 / agent.velocity.length())
      : _diff.set(0, 0, 1);
    _ahead.copy(agent.position).addScaledVector(heading, this.wanderDistance);
    _ahead.add(target);
    return this.seek(agent, _ahead);
  }

  /** 分离:与邻居保持距离,远离最近的邻居。 */
  separation(agent: Agent, neighbors: Agent[]): Vector3 {
    const force = new Vector3();
    let count = 0;
    for (const n of neighbors) {
      if (n === agent) continue;
      _diff.subVectors(agent.position, n.position);
      const d = _diff.length();
      if (d > 0 && d < agent.radius + n.radius + 1) {
        // 力与距离反比
        _diff.multiplyScalar(1 / (d * d));
        force.add(_diff);
        count++;
      }
    }
    if (count === 0) return force;
    force.multiplyScalar(1 / count);
    if (force.lengthSq() > 0) {
      force.multiplyScalar(1 / force.length()).multiplyScalar(agent.maxSpeed);
      force.sub(agent.velocity);
    }
    return force;
  }

  /** 对齐:匹配邻居的平均速度方向。 */
  alignment(agent: Agent, neighbors: Agent[]): Vector3 {
    const avgVel = new Vector3();
    let count = 0;
    for (const n of neighbors) {
      if (n === agent) continue;
      const d = agent.position.distanceTo(n.position);
      if (d > 0 && d < 10) {
        avgVel.add(n.velocity);
        count++;
      }
    }
    if (count === 0) return avgVel;
    avgVel.multiplyScalar(1 / count);
    if (avgVel.lengthSq() > 0) {
      avgVel.multiplyScalar(1 / avgVel.length()).multiplyScalar(agent.maxSpeed);
      avgVel.sub(agent.velocity);
    }
    return avgVel;
  }

  /** 凝聚:朝邻居中心移动。 */
  cohesion(agent: Agent, neighbors: Agent[]): Vector3 {
    _center.set(0, 0, 0);
    let count = 0;
    for (const n of neighbors) {
      if (n === agent) continue;
      const d = agent.position.distanceTo(n.position);
      if (d > 0 && d < 10) {
        _center.add(n.position);
        count++;
      }
    }
    if (count === 0) return new Vector3();
    _center.multiplyScalar(1 / count);
    return this.seek(agent, _center);
  }

  /** 障碍物规避:检测前方 ahead 点是否落在障碍球内,产生横向避让力。 */
  obstacleAvoidance(agent: Agent, obstacles: Obstacle[]): Vector3 {
    const ahead = _ahead;
    ahead.copy(agent.position);
    if (agent.velocity.lengthSq() > 1e-6) {
      const dir = _diff.copy(agent.velocity).multiplyScalar(1 / agent.velocity.length());
      ahead.addScaledVector(dir, this.wanderDistance * 2);
    }

    let mostThreat: Obstacle | null = null;
    let mostThreatDist = Infinity;
    for (const ob of obstacles) {
      const d = ahead.distanceTo(ob.position);
      // ahead 在障碍球内或附近
      if (d < ob.radius + agent.radius) {
        const distToOb = agent.position.distanceTo(ob.position);
        if (distToOb < mostThreatDist) {
          mostThreatDist = distToOb;
          mostThreat = ob;
        }
      }
    }
    if (!mostThreat) return new Vector3();

    // 避让方向 = ahead - obstacle.position(垂直于前进方向)
    const avoidance = new Vector3()
      .subVectors(ahead, mostThreat.position);
    if (avoidance.lengthSq() < 1e-6) {
      // ahead 几乎重合于障碍中心,选一个正交方向
      avoidance.set(-agent.velocity.z, 0, agent.velocity.x).multiplyScalar(agent.maxSpeed);
    } else {
      avoidance.multiplyScalar(1 / avoidance.length()).multiplyScalar(agent.maxSpeed);
    }
    return avoidance;
  }
}

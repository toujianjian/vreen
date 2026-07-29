// CrowdSystem — 人群系统(大规模 AI 代理管理)。
//
// 设计:
//   * 与 AI/Agent 互补:Agent 是「单代理导航实体」,CrowdSystem 是「群体调度器」
//   * CrowdAgent 是轻量数据结构(position/velocity/target/radius/maxSpeed/state),
//     不持 SteeringBehavior 实例,而是由 CrowdSystem 共享一个 behavior 完成所有转向
//   * 空间网格(SpatialGrid)加速邻域查询,把 O(n²) 的 separation 降到 O(k·n)
//   * 可选 NavMesh 寻路:若设置则代理按 nav 路径走;否则直线 seek 目标
//   * 避障(avoidance)采用 Reynolds separation 力:远离 avoidanceRadius 内的邻居
//   * 路径缓存:每个代理记 lastPathFindTime,避免每帧重算 A*(默认 0.5s 重算一次)
//
// 与 ECS 的关系:
//   * CrowdSystem 是独立模块,不依赖 ECS World;调用方可以把 CrowdAgent 同步到
//     ECS 实体的 Transform 组件,或直接读 positions 渲染 instanced mesh
//   * 与 AI/Agent 的关系:CrowdSystem 内部委托 SteeringBehavior.arrive/separation
//
// 算法(每帧 update):
//   1. 重建 spatial grid(清空 + 全量插入)
//   2. 对每个代理:
//      a. 若有 navMesh 且距上次寻路 > pathFindInterval,重算 path
//      b. 沿 path 的下一 waypoint 求 arrive 力
//      c. 若 avoidance 开启,查询 spatial grid 邻居,求 separation 力
//      d. 累加力 → 半隐式 Euler 积分 → 截断速度 → 推进位置
//      e. 到达目标 → state = 'arrived'
//   3. 更新代理在 spatial grid 中的位置(移除旧 + 插入新)

import { Vector3 } from '../Math';
import { SpatialGrid } from './SpatialGrid';
import type { NavMesh } from './NavMesh';

/** 代理状态。 */
export type CrowdAgentState = 'idle' | 'moving' | 'arrived';

/** 单个人群代理(轻量数据结构)。 */
export interface CrowdAgent {
  /** 代理 ID(由 CrowdSystem 分配,唯一)。 */
  id: number;
  /** 当前位置(世界坐标)。 */
  position: Vector3;
  /** 当前速度。 */
  velocity: Vector3;
  /** 目标点(世界坐标)。 */
  target: Vector3;
  /** 半径(用于 separation 与碰撞)。 */
  radius: number;
  /** 最大速度(单位/秒)。 */
  maxSpeed: number;
  /** 单帧最大转向力上限。 */
  maxForce: number;
  /** 质量(kg,影响 arrive/seek 力的缩放)。 */
  mass: number;
  /** 当前状态。 */
  state: CrowdAgentState;
  /** 当前路径(由 navMesh 寻路产生;空数组表示直线 seek)。 */
  path: Vector3[];
  /** 当前目标 waypoint 索引(在 path 中)。 */
  waypointIndex: number;
  /** 上次路径计算时间(秒,用于节流重算)。 */
  lastPathFindTime: number;
  /** 是否激活(若 false,update 跳过此代理)。 */
  enabled: boolean;
}

/** 人群统计信息。 */
export interface CrowdStats {
  /** 总代理数。 */
  agentCount: number;
  /** 激活代理数。 */
  activeCount: number;
  /** 已到达目标的代理数。 */
  arrivedCount: number;
  /** 移动中的代理数。 */
  movingCount: number;
  /** 空闲代理数。 */
  idleCount: number;
  /** 平均速度。 */
  avgSpeed: number;
}

/** 到达判定阈值(距离小于此值视为已到达 waypoint)。 */
const WAYPOINT_REACHED_DISTANCE = 0.5;
/** 目标到达判定阈值。 */
const TARGET_REACHED_DISTANCE = 0.5;
/** 默认路径重算间隔(秒)。 */
const DEFAULT_PATHFIND_INTERVAL = 0.5;

// 复用临时向量
const _seekForce = new Vector3();
const _sepForce = new Vector3();
const _toTarget = new Vector3();
const _desired = new Vector3();
const _diff = new Vector3();

/**
 * 人群系统 — 大规模 AI 代理调度与避障。
 *
 * 用法:
 *   const crowd = new CrowdSystem({ maxAgents: 1000, navMesh });
 *   crowd.addAgent(new Vector3(0,0,0), new Vector3(10,0,10));
 *   // 每帧:
 *   crowd.update(dt);
 *   const positions = crowd.getAgents().map(a => a.position);
 */
export class CrowdSystem {
  /** 代理列表(索引即代理在数组中的位置;id 字段是外部引用句柄)。 */
  agents: CrowdAgent[] = [];
  /** 最大代理数。 */
  maxAgents: number;
  /** 空间网格(邻域查询加速)。 */
  spatialGrid: SpatialGrid;
  /** 可选导航网格(若设置则代理按 nav 路径走)。 */
  navMesh: NavMesh | null = null;
  /** 是否启用避障(separation)。 */
  avoidance: boolean = true;
  /** 避障查询半径。 */
  avoidanceRadius: number = 2;
  /** 路径重算间隔(秒)。 */
  pathFindInterval: number = DEFAULT_PATHFIND_INTERVAL;
  /** 代理位置数组(供 spatial grid queryRadius 使用,每帧同步)。 */
  private positions: { x: number; z: number }[] = [];
  /** 下一可用代理 ID。 */
  private nextId: number = 1;

  constructor(options: CrowdSystemOptions = {}) {
    this.maxAgents = options.maxAgents ?? 1000;
    this.spatialGrid = new SpatialGrid(options.cellSize ?? 2);
    this.navMesh = options.navMesh ?? null;
    this.avoidance = options.avoidance ?? true;
    this.avoidanceRadius = options.avoidanceRadius ?? 2;
    this.pathFindInterval = options.pathFindInterval ?? DEFAULT_PATHFIND_INTERVAL;
  }

  /**
   * 添加代理。
   *  position: 起始位置;target: 目标点。
   *  返回代理 id(若超出 maxAgents 返回 -1)。
   */
  addAgent(position: Vector3, target: Vector3): number {
    if (this.agents.length >= this.maxAgents) return -1;
    const id = this.nextId++;
    const agent: CrowdAgent = {
      id,
      position: position.clone(),
      velocity: new Vector3(),
      target: target.clone(),
      radius: 0.5,
      maxSpeed: 3,
      maxForce: 10,
      mass: 1,
      state: 'moving',
      path: [],
      waypointIndex: 0,
      lastPathFindTime: -Infinity,
      enabled: true,
    };
    this.agents.push(agent);
    // 立即计算路径(若有 navMesh)
    if (this.navMesh) {
      this.recomputePath(agent, 0);
    }
    return id;
  }

  /** 按 id 移除代理(返回是否成功)。 */
  removeAgent(id: number): boolean {
    const idx = this.agents.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.agents.splice(idx, 1);
    return true;
  }

  /** 设置指定代理的目标点(重置其路径)。 */
  setTarget(id: number, target: Vector3): boolean {
    const agent = this.findAgent(id);
    if (!agent) return false;
    agent.target.copy(target);
    agent.path = [];
    agent.waypointIndex = 0;
    agent.lastPathFindTime = -Infinity; // 强制下次 update 重算路径
    if (agent.state === 'arrived') agent.state = 'moving';
    return true;
  }

  /** 获取所有代理(只读视图;调用方不应直接修改结构)。 */
  getAgents(): CrowdAgent[] {
    return this.agents;
  }

  /** 获取当前代理数量。 */
  getAgentCount(): number {
    return this.agents.length;
  }

  /** 清空所有代理。 */
  clear(): this {
    this.agents = [];
    this.spatialGrid.clear();
    this.positions = [];
    return this;
  }

  /** 获取人群统计信息。 */
  getStats(): CrowdStats {
    let activeCount = 0;
    let arrivedCount = 0;
    let movingCount = 0;
    let idleCount = 0;
    let totalSpeed = 0;
    for (const a of this.agents) {
      if (!a.enabled) continue;
      activeCount++;
      totalSpeed += a.velocity.length();
      if (a.state === 'arrived') arrivedCount++;
      else if (a.state === 'moving') movingCount++;
      else idleCount++;
    }
    return {
      agentCount: this.agents.length,
      activeCount,
      arrivedCount,
      movingCount,
      idleCount,
      avgSpeed: activeCount > 0 ? totalSpeed / activeCount : 0,
    };
  }

  /**
   * 每帧更新 — 重建网格 → 寻路 → 转向 → 避障 → 积分。
   *  dt: 帧时间(秒)。currentTime: 可选的累计时间(用于路径重算节流,
   *  默认每帧自增 dt 累计)。
   */
  update(dt: number, currentTime?: number): this {
    const t = currentTime ?? this.accumulatedTime + dt;
    this.accumulatedTime = t;

    // 1. 重建 spatial grid(清空 + 全量插入)
    this.spatialGrid.clear();
    // 同步 positions 数组(供 queryRadius 使用)
    if (this.positions.length !== this.agents.length) {
      this.positions = new Array(this.agents.length);
      for (let i = 0; i < this.agents.length; i++) {
        this.positions[i] = { x: 0, z: 0 };
      }
    }
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      this.positions[i].x = a.position.x;
      this.positions[i].z = a.position.z;
      this.spatialGrid.insert(i, this.positions[i]);
    }

    // 2. 逐代理更新
    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];
      if (!agent.enabled) continue;
      if (agent.state === 'arrived') {
        // 已到达:阻尼到停下
        agent.velocity.multiplyScalar(Math.max(0, 1 - 5 * dt));
        continue;
      }

      // 2a. 路径节流重算
      if (this.navMesh && t - agent.lastPathFindTime > this.pathFindInterval) {
        this.recomputePath(agent, t);
      }

      // 2b. 计算朝目标的 seek/arrive 力
      _seekForce.set(0, 0, 0);
      _toTarget.subVectors(agent.target, agent.position);
      const distToTarget = _toTarget.length();

      if (distToTarget < TARGET_REACHED_DISTANCE) {
        agent.state = 'arrived';
        agent.velocity.multiplyScalar(Math.max(0, 1 - 5 * dt));
        continue;
      }

      if (agent.path.length > 0 && agent.waypointIndex < agent.path.length) {
        // 沿路径走:arrive 到当前 waypoint(内联实现,避免与 Agent 类耦合)
        const wp = agent.path[agent.waypointIndex];
        _desired.subVectors(wp, agent.position);
        const wd = _desired.length();
        const slowingRadius = WAYPOINT_REACHED_DISTANCE * 2;
        if (wd > 1e-6) {
          _desired.multiplyScalar(1 / wd); // 归一化
          let speed = agent.maxSpeed;
          if (wd < slowingRadius) {
            speed = agent.maxSpeed * (wd / slowingRadius);
          }
          _desired.multiplyScalar(speed);
          _diff.subVectors(_desired, agent.velocity);
          _diff.multiplyScalar(1 / Math.max(agent.mass, 1e-6));
          _seekForce.copy(_diff);
        }
        // 推进 waypoint
        if (agent.position.distanceTo(wp) < WAYPOINT_REACHED_DISTANCE) {
          agent.waypointIndex++;
        }
      } else {
        // 无 nav / 无路径:直线 seek 目标
        _desired.copy(_toTarget);
        const d = _desired.length();
        if (d > 1e-6) {
          _desired.multiplyScalar(1 / d).multiplyScalar(agent.maxSpeed);
          _seekForce.subVectors(_desired, agent.velocity);
        }
      }

      // 2c. 避障(separation)
      _sepForce.set(0, 0, 0);
      if (this.avoidance) {
        const neighbors = this.spatialGrid.queryRadius(
          this.positions[i],
          this.avoidanceRadius,
          this.positions,
        );
        let count = 0;
        for (const nIdx of neighbors) {
          if (nIdx === i) continue;
          const n = this.agents[nIdx];
          if (!n) continue;
          _diff.subVectors(agent.position, n.position);
          const d = _diff.length();
          const minDist = agent.radius + n.radius + 0.5;
          if (d > 0 && d < minDist) {
            _diff.multiplyScalar(1 / (d * d));
            _sepForce.add(_diff);
            count++;
          }
        }
        if (count > 0) {
          _sepForce.multiplyScalar(1 / count);
          if (_sepForce.lengthSq() > 0) {
            _sepForce.multiplyScalar(1 / _sepForce.length()).multiplyScalar(agent.maxSpeed);
            _sepForce.sub(agent.velocity);
          }
        }
      }

      // 2d. 累加力(分离力权重 1.5)
      const totalForce = _seekForce.clone().addScaledVector(_sepForce, 1.5);

      // 力上限
      if (totalForce.lengthSq() > agent.maxForce * agent.maxForce) {
        totalForce.multiplyScalar(agent.maxForce / totalForce.length());
      }

      // 2e. 半隐式 Euler 积分
      agent.velocity.addScaledVector(totalForce, dt);
      // 速度上限
      if (agent.velocity.lengthSq() > agent.maxSpeed * agent.maxSpeed) {
        agent.velocity.multiplyScalar(agent.maxSpeed / agent.velocity.length());
      }
      agent.position.addScaledVector(agent.velocity, dt);

      // 状态更新
      if (agent.state === 'idle') agent.state = 'moving';
    }
    return this;
  }

  /** 累计时间(用于路径重算节流,当 update 不传 currentTime 时使用)。 */
  private accumulatedTime: number = 0;

  /** 按 id 查找代理。 */
  private findAgent(id: number): CrowdAgent | undefined {
    return this.agents.find((a) => a.id === id);
  }

  /** 重算代理路径(委托 navMesh.findPath)。 */
  private recomputePath(agent: CrowdAgent, currentTime: number): void {
    if (!this.navMesh) {
      agent.path = [];
      agent.waypointIndex = 0;
      return;
    }
    const path = this.navMesh.findPath(agent.position, agent.target);
    agent.path = path;
    agent.waypointIndex = 0;
    agent.lastPathFindTime = currentTime;
  }
}

/** CrowdSystem 构造参数。 */
export interface CrowdSystemOptions {
  /** 最大代理数(默认 1000)。 */
  maxAgents?: number;
  /** 空间格子尺寸(默认 2)。 */
  cellSize?: number;
  /** 可选导航网格。 */
  navMesh?: NavMesh | null;
  /** 是否启用避障(默认 true)。 */
  avoidance?: boolean;
  /** 避障查询半径(默认 2)。 */
  avoidanceRadius?: number;
  /** 路径重算间隔(秒,默认 0.5)。 */
  pathFindInterval?: number;
}

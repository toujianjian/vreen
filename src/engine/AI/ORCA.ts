// ORCA — Optimal Reciprocal Collision Avoidance.
//
// 设计来源:
//   * Van den Berg et al. 2011 "Reciprocal n-body Collision Avoidance"(SIGGRAPH)
//   * RVO2 Library — https://gamma.cs.unc.edu/RVO2/(参考实现)
//   * UE5 MassAI Crowd — Recast/Detour DetourCrowd ORCA 集成
//   * o3de RecastNavigation DetourCrowd — ORCA 避障
//   * StarCraft 2 / Age of Empires 4 / Supreme Commander — 大规模单位避障
//
// 问题:
//   Reynolds separation 力(SteeringBehavior.separation)在密集场景下表现差:
//   - 力的叠加导致抖动、震荡
//   - 代理互相推挤,无法通过窄通道
//   - 速度选择不考虑未来碰撞,只看当前距离
//   ORCA 解决:每个代理对(A, B)计算一个「速度障碍半平面」—— A 的速度选择空间被
//   划分为「安全」(不会与 B 碰撞)和「危险」(未来会碰撞)两半。A 在所有邻居的
//   半平面交集内选择最接近期望速度的速度。
//
// 算法(每帧对每个代理 A):
//   1. 收集邻居 B(用 SpatialGrid 加速邻域查询)
//   2. 对每个邻居 B,计算 ORCA 线(方向 direction + 点 point):
//      a. 相对位置 `relativePosition = B.pos - A.pos`
//      b. 相对速度 `relativeVelocity = A.vel - B.vel`
//      c. 组合半径 `combinedRadius = A.r + B.r`
//      d. 若 `|relativePosition| > combinedRadius`(未碰撞):
//         - 计算「截止速度障碍」(truncated VO):圆锥,顶点在 A,方向 relativePosition
//         - 若 relativeVelocity 在圆锥外:ORCA 线方向 = w 的垂直方向
//         - 若 relativeVelocity 在圆锥内:ORCA 线方向 = 切线「腿」方向
//      e. 若 `|relativePosition| ≤ combinedRadius`(已碰撞):
//         - ORCA 线方向 = relativePosition 的垂直方向(立即分离)
//      f. 位移责任各 50%:point 包含 0.5 * relativeVelocity 分量
//   3. 线性规划求解:在所有半平面交集中找最接近 preferredVelocity 的速度
//      - LP1:在 ORCA 线与 maxSpeed 圆的交点区间 [tLeft, tRight] 内找最优 t
//      - LP2:逐线检查,若违反用 LP1 修正
//      - LP3:3D LP fallback(保证总有解)
//
// 约束表示(RVO2 约定):
//   每条 ORCA 线由 (point, direction) 定义。
//   速度 v 在「安全」侧当 `det2D(direction, v - point) >= 0`。
//   `det2D(a, b) = a.x * b.z - a.z * b.x`(2D 叉积,标量)。
//   LP 参数化:解形如 `v = point + t * direction`,在 [tLeft, tRight] 区间内取最优 t。
//
// 优势(vs Reynolds separation):
//   - 速度空间求解,非力的叠加 → 无抖动
//   - 考虑未来碰撞(timeHorizon 秒后)→ 提前避让,非反应式
//   - 50/50 责任分担 → 两个代理各让一半,自然对称
//   - 窄通道通过性强 → 代理排队通过,不推挤
//   - 密集场景稳定 → 已碰撞时代理立即分离
//
// 与 CrowdSystem 的关系:
//   CrowdSystem 当前用 Reynolds separation,可切换到 ORCA:
//   ```
//   crowd.avoidanceMode = 'orca';  // 替代 'reynolds'
//   ```
//   ORCA 是独立模块,CrowdSystem 可选调用。
//
// 注意:本实现为 2D(XZ 平面)版本,与 CrowdSystem 一致(Y 忽略)。
// 算法严格遵循 RVO2 库,数学等价。

import { Vector3 } from '../Math';

// ── 类型 ───────────────────────────────────────────────────────

/** ORCA 代理:轻量数据结构,与 CrowdAgent 字段对齐。 */
export interface ORCAAgent {
  /** 代理 ID。 */
  id: number;
  /** 当前位置(世界坐标,Y 忽略)。 */
  position: Vector3;
  /** 当前速度(世界坐标,Y 忽略)。 */
  velocity: Vector3;
  /** 期望速度(由上层 steering 计算得出,如 seek/arrive)。 */
  preferredVelocity: Vector3;
  /** 半径(碰撞检测用)。 */
  radius: number;
  /** 最大速度(单位/秒)。 */
  maxSpeed: number;
  /** 邻居查询半径(超过此距离的代理不算邻居)。 */
  neighborDist: number;
  /** 时间步(秒,碰撞预测窗口)。 */
  timeHorizon: number;
  /** ORCA 新速度(由 computeNewVelocities 写入)。 */
  newVelocity: Vector3;
}

/**
 * ORCA 线:由 point + direction 定义的半平面约束。
 *
 * 速度 v 在「安全」侧当 `det2D(direction, v - point) >= 0`。
 */
export interface ORCALine {
  /** 线的方向(单位向量,沿 ORCA 边界)。 */
  direction: Vector3;
  /** 线上的一个点。 */
  point: Vector3;
}

// ── 工具:2D 操作(忽略 Y)─────────────────────────────────────

/** 2D 叉积(标量):a.x * b.z - a.z * b.x。 */
function det2D(a: Vector3, b: Vector3): number {
  return a.x * b.z - a.z * b.x;
}

/** 2D 点积(忽略 Y)。 */
function dot2D(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.z * b.z;
}

/** 2D 长度平方(忽略 Y)。 */
function absSq2D(v: Vector3): number {
  return v.x * v.x + v.z * v.z;
}

// ── ORCA 线计算 ────────────────────────────────────────────────

/**
 * 计算 agent 与 neighbor 的 ORCA 线。
 *
 * 严格遵循 RVO2 `computeAgentORCALine` 实现(见 jimfleming/rvo2 agent.py 与
 * snape/RVO2 Agent.cpp)。统一采用「先求相对速度改变量 u,再令
 * `line.point = agent.velocity + 0.5 * u`」的结构(RVO2 各承担 50% 责任)。
 *
 * 半平面约定:速度 v 在「安全」侧当 `det2D(direction, v - point) >= 0`。
 * 等价于 RVO2 的 `det(direction, point - v) <= 0`(LP 求解器中统一使用此约定)。
 */
function computeAgentORCALine(
  line: ORCALine,
  agent: ORCAAgent,
  other: ORCAAgent,
  timeStep: number,
  inverseTimeHorizon: number,
): void {
  const relativePosition = new Vector3().subVectors(other.position, agent.position);
  const relativeVelocity = new Vector3().subVectors(agent.velocity, other.velocity);

  const distSq = absSq2D(relativePosition);
  const combinedRadius = agent.radius + other.radius;
  const combinedRadiusSq = combinedRadius * combinedRadius;

  // u = 相对速度的改变量(RVO2 约定)。最终 line.point = agent.velocity + 0.5 * u。
  const u = new Vector3();

  if (distSq > combinedRadiusSq) {
    // 未碰撞:计算 truncated VO。
    // w = relativeVelocity - invTimeHorizon * relativePosition(从截止圆心到相对速度的向量)
    const w = new Vector3(
      relativeVelocity.x - inverseTimeHorizon * relativePosition.x,
      0,
      relativeVelocity.z - inverseTimeHorizon * relativePosition.z,
    );
    const wLengthSq = absSq2D(w);
    const dotProduct1 = dot2D(w, relativePosition);

    if (dotProduct1 < 0 && dotProduct1 * dotProduct1 > combinedRadiusSq * wLengthSq) {
      // 投影在截断圆锥外:投影到截止圆上。
      const wLength = Math.sqrt(wLengthSq);
      const unitW = wLength > 1e-12
        ? new Vector3(w.x / wLength, 0, w.z / wLength)
        : new Vector3(1, 0, 0);

      // RVO2: direction = (unitW.y, -unitW.x) → 在 XZ 中: (unitW.z, -unitW.x)
      line.direction = new Vector3(unitW.z, 0, -unitW.x);
      // u = (combinedRadius * invTimeHorizon - wLength) * unitW
      u.set(
        (combinedRadius * inverseTimeHorizon - wLength) * unitW.x,
        0,
        (combinedRadius * inverseTimeHorizon - wLength) * unitW.z,
      );
    } else {
      // 投影在截断圆锥内:投影到切线「腿」上。
      // 注意:direction 必须是单位向量,因此除以 distSq(不是 dist)。
      // 推导:|(rp.x*leg - rp.z*cr, rp.x*cr + rp.z*leg)|² = distSq²,故除以 distSq 得单位向量。
      const leg = Math.sqrt(distSq - combinedRadiusSq);

      if (det2D(relativePosition, w) > 0) {
        // 左腿
        line.direction = new Vector3(
          (relativePosition.x * leg - relativePosition.z * combinedRadius) / distSq,
          0,
          (relativePosition.x * combinedRadius + relativePosition.z * leg) / distSq,
        );
      } else {
        // 右腿
        line.direction = new Vector3(
          -(relativePosition.x * leg + relativePosition.z * combinedRadius) / distSq,
          0,
          -(-relativePosition.x * combinedRadius + relativePosition.z * leg) / distSq,
        );
      }

      // u = (relativeVelocity · direction) * direction - relativeVelocity
      const dotProduct2 = dot2D(relativeVelocity, line.direction);
      u.set(
        dotProduct2 * line.direction.x - relativeVelocity.x,
        0,
        dotProduct2 * line.direction.z - relativeVelocity.z,
      );
    }
  } else {
    // 已碰撞:投影到 timeStep 截止圆上(强制立即分离)。
    const invTimeStep = 1 / timeStep;
    // w = relativeVelocity - invTimeStep * relativePosition
    const w = new Vector3(
      relativeVelocity.x - invTimeStep * relativePosition.x,
      0,
      relativeVelocity.z - invTimeStep * relativePosition.z,
    );
    const wLength = Math.sqrt(absSq2D(w));
    const unitW = wLength > 1e-12
      ? new Vector3(w.x / wLength, 0, w.z / wLength)
      : new Vector3(1, 0, 0);

    // direction = (unitW.z, -unitW.x)
    line.direction = new Vector3(unitW.z, 0, -unitW.x);
    // u = (combinedRadius * invTimeStep - wLength) * unitW
    //    (把相对速度推到半径 combinedRadius/timeStep 的截止圆边界上,方向 unitW)
    u.set(
      (combinedRadius * invTimeStep - wLength) * unitW.x,
      0,
      (combinedRadius * invTimeStep - wLength) * unitW.z,
    );
  }

  // line.point = agent.velocity + 0.5 * u(各代理承担 50% 责任,镜像对称)
  line.point = new Vector3(
    agent.velocity.x + 0.5 * u.x,
    0,
    agent.velocity.z + 0.5 * u.z,
  );
}

// ── 线性规划求解(RVO2 三阶段)──────────────────────────────────

const RVO_EPSILON = 1e-5;

/**
 * LP1:在第 lineNo 条 ORCA 线与 maxSpeed 圆的交区间内,找最接近 optVelocity 的点。
 *
 * 参数化:解形如 `result = point + t * direction`,t ∈ [tLeft, tRight]。
 *
 * 返回 true 若找到可行解,false 若不可行(需要 LP3 fallback)。
 */
function linearProgram1(
  lines: ORCALine[],
  lineNo: number,
  maxSpeed: number,
  optVelocity: Vector3,
  directionOpt: boolean,
  result: Vector3,
): boolean {
  const line = lines[lineNo];

  // ORCA 线与 maxSpeed 圆的交点参数:
  // |point + t * direction|² = maxSpeed²
  // → t² + 2*(point·direction)*t + (|point|² - maxSpeed²) = 0
  // → t = -dotProduct ± sqrt(discriminant)
  const dotProduct = dot2D(line.point, line.direction);
  const discriminant = dotProduct * dotProduct + maxSpeed * maxSpeed - absSq2D(line.point);

  if (discriminant < 0) {
    // maxSpeed 圆完全不与线相交:线太远
    return false;
  }

  const sqrtDiscriminant = Math.sqrt(discriminant);
  let tLeft = -dotProduct - sqrtDiscriminant;
  let tRight = -dotProduct + sqrtDiscriminant;

  // 逐条检查之前的 ORCA 线,缩小 [tLeft, tRight] 区间
  for (let i = 0; i < lineNo; i++) {
    const denominator = det2D(line.direction, lines[i].direction);
    const numerator = det2D(lines[i].direction, new Vector3().subVectors(line.point, lines[i].point));

    if (Math.abs(denominator) <= RVO_EPSILON) {
      // 线几乎平行
      if (numerator < 0) {
        return false;
      }
      continue;
    }

    const t = numerator / denominator;

    if (denominator >= 0) {
      // 线 i 从右侧约束
      if (t < tRight) tRight = t;
    } else {
      // 线 i 从左侧约束
      if (t > tLeft) tLeft = t;
    }

    if (tLeft > tRight) {
      return false; // 区间为空
    }
  }

  // 在 [tLeft, tRight] 内选最优 t
  if (directionOpt) {
    // 沿 optVelocity 方向找最大 t
    if (dot2D(optVelocity, line.direction) > 0) {
      // 方向一致:取 tRight(最大)
      result.set(
        line.point.x + tRight * line.direction.x,
        0,
        line.point.z + tRight * line.direction.z,
      );
    } else {
      // 方向相反:取 tLeft(最小,即最大反方向)
      result.set(
        line.point.x + tLeft * line.direction.x,
        0,
        line.point.z + tLeft * line.direction.z,
      );
    }
  } else {
    // 找最接近 optVelocity 的 t
    // 最优 t = direction · (optVelocity - point)
    const t = dot2D(line.direction, new Vector3().subVectors(optVelocity, line.point));

    if (t < tLeft) {
      result.set(
        line.point.x + tLeft * line.direction.x,
        0,
        line.point.z + tLeft * line.direction.z,
      );
    } else if (t > tRight) {
      result.set(
        line.point.x + tRight * line.direction.x,
        0,
        line.point.z + tRight * line.direction.z,
      );
    } else {
      result.set(
        line.point.x + t * line.direction.x,
        0,
        line.point.z + t * line.direction.z,
      );
    }
  }

  return true;
}

/**
 * LP2:从 optVelocity 开始,逐线检查是否满足约束,若违反用 LP1 修正。
 *
 * 返回成功修正的约束数(若 < numLines,需要 LP3 fallback)。
 */
function linearProgram2(
  lines: ORCALine[],
  numLines: number,
  optVelocity: Vector3,
  directionOpt: boolean,
  maxSpeed: number,
  result: Vector3,
): number {
  if (directionOpt) {
    // optVelocity 是方向,沿此方向找最大可行速度
    result.set(optVelocity.x * maxSpeed, 0, optVelocity.z * maxSpeed);
  } else if (absSq2D(optVelocity) > maxSpeed * maxSpeed) {
    // optVelocity 超过 maxSpeed,截断
    const len = Math.sqrt(absSq2D(optVelocity));
    result.set((optVelocity.x / len) * maxSpeed, 0, (optVelocity.z / len) * maxSpeed);
  } else {
    result.copy(optVelocity);
  }

  for (let i = 0; i < numLines; i++) {
    // 检查 result 是否满足第 i 条约束
    if (det2D(lines[i].direction, new Vector3().subVectors(result, lines[i].point)) < 0) {
      // 违反:用 LP1 在第 i 条线上找可行解
      const tempResult = result.clone();
      if (!linearProgram1(lines, i, maxSpeed, optVelocity, directionOpt, result)) {
        result.copy(tempResult);
        return i; // LP1 失败,返回当前约束索引
      }
    }
  }
  return numLines; // 全部满足
}

/**
 * LP3:3D LP fallback —— 从失败约束开始,逐约束投影修正。
 *
 * 当 LP2 在某约束失败时,从该约束开始重新求解,保证总有解。
 */
function linearProgram3(
  lines: ORCALine[],
  numLines: number,
  beginLine: number,
  maxSpeed: number,
  result: Vector3,
): void {
  let distance = 0;

  for (let i = beginLine; i < numLines; i++) {
    // 检查 result 是否满足第 i 条约束
    if (det2D(lines[i].direction, new Vector3().subVectors(result, lines[i].point)) < distance) {
      // 违反:在第 i 条线上找最接近 result 的可行点
      const tempResult = result.clone();

      // 尝试沿 direction 的正方向
      if (!linearProgram1(
        lines,
        i,
        maxSpeed,
        new Vector3(-lines[i].direction.z, 0, lines[i].direction.x),
        true,
        result,
      )) {
        // 失败:恢复并尝试沿 direction 的负方向
        result.copy(tempResult);
        linearProgram1(
          lines,
          i,
          maxSpeed,
          new Vector3(lines[i].direction.z, 0, -lines[i].direction.x),
          true,
          result,
        );
      }

      // 更新最小距离(逐步收紧约束)
      distance = det2D(lines[i].direction, new Vector3().subVectors(result, lines[i].point));
    }
  }
}

// ── ORCASolver ─────────────────────────────────────────────────

/**
 * ORCASolver — 管理 ORCA 代理集合,每帧求解所有代理的新速度。
 *
 * 用法:
 *   const solver = new ORCASolver();
 *   const a1 = solver.addAgent({ position: new Vector3(0,0,0), ... });
 *   const a2 = solver.addAgent({ position: new Vector3(5,0,0), ... });
 *
 *   // 每帧:
 *   solver.computeNewVelocities(0.1);  // dt=0.1s
 *   solver.applyVelocities(0.1);       // 推进位置
 *
 *   // 读取结果:
 *   const v = solver.agents[0].newVelocity;
 */
export class ORCASolver {
  /** 代理列表。 */
  agents: ORCAAgent[] = [];
  /** 时间步(秒)。 */
  timeStep: number = 0.1;
  /** 默认时间视野(秒,碰撞预测窗口)。 */
  defaultTimeHorizon: number = 5;
  /** 默认邻居查询半径。 */
  defaultNeighborDist: number = 15;
  /** 默认最大速度。 */
  defaultMaxSpeed: number = 2;
  /** 默认半径。 */
  defaultRadius: number = 0.5;
  /** 每代理最多考虑的邻居数(性能上限)。 */
  maxNeighbors: number = 10;

  private _nextId: number = 0;

  /** 添加代理。 */
  addAgent(opts: {
    position: Vector3;
    preferredVelocity?: Vector3;
    velocity?: Vector3;
    radius?: number;
    maxSpeed?: number;
    neighborDist?: number;
    timeHorizon?: number;
  }): ORCAAgent {
    const agent: ORCAAgent = {
      id: this._nextId++,
      position: opts.position.clone(),
      velocity: opts.velocity?.clone() ?? new Vector3(),
      preferredVelocity: opts.preferredVelocity?.clone() ?? new Vector3(),
      radius: opts.radius ?? this.defaultRadius,
      maxSpeed: opts.maxSpeed ?? this.defaultMaxSpeed,
      neighborDist: opts.neighborDist ?? this.defaultNeighborDist,
      timeHorizon: opts.timeHorizon ?? this.defaultTimeHorizon,
      newVelocity: new Vector3(),
    };
    this.agents.push(agent);
    return agent;
  }

  /** 移除代理。 */
  removeAgent(id: number): boolean {
    const idx = this.agents.findIndex(a => a.id === id);
    if (idx < 0) return false;
    this.agents.splice(idx, 1);
    return true;
  }

  /** 按 ID 获取代理。 */
  getAgent(id: number): ORCAAgent | undefined {
    return this.agents.find(a => a.id === id);
  }

  /** 清空所有代理。 */
  clearAgents(): this {
    this.agents.length = 0;
    this._nextId = 0;
    return this;
  }

  /**
   * 为所有代理计算新速度(写入 agent.newVelocity)。
   *
   * 调用后须调用 applyVelocities(dt) 推进位置。
   */
  computeNewVelocities(dt: number): this {
    this.timeStep = dt;

    for (const agent of this.agents) {
      this._computeAgentNewVelocity(agent, dt);
    }
    return this;
  }

  /** 应用 newVelocity 到所有代理(推进位置 + 更新 velocity)。 */
  applyVelocities(dt: number): this {
    for (const agent of this.agents) {
      agent.velocity.copy(agent.newVelocity);
      agent.position.x += agent.velocity.x * dt;
      agent.position.z += agent.velocity.z * dt;
    }
    return this;
  }

  /** 单步:计算 + 应用。 */
  step(dt: number): this {
    this.computeNewVelocities(dt);
    this.applyVelocities(dt);
    return this;
  }

  /** 计算单个代理的新速度。 */
  private _computeAgentNewVelocity(agent: ORCAAgent, dt: number): void {
    // 1. 收集邻居(按距离排序,取前 maxNeighbors 个)
    const neighbors: Array<{ other: ORCAAgent; distSq: number }> = [];
    const neighborDistSq = agent.neighborDist * agent.neighborDist;

    for (const other of this.agents) {
      if (other.id === agent.id) continue;
      const dx = other.position.x - agent.position.x;
      const dz = other.position.z - agent.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < neighborDistSq) {
        neighbors.push({ other, distSq });
      }
    }

    neighbors.sort((a, b) => a.distSq - b.distSq);
    if (neighbors.length > this.maxNeighbors) {
      neighbors.length = this.maxNeighbors;
    }

    // 2. 为每个邻居计算 ORCA 线
    const lines: ORCALine[] = [];
    const inverseTimeHorizon = 1 / agent.timeHorizon;

    for (const { other } of neighbors) {
      const line: ORCALine = {
        direction: new Vector3(),
        point: new Vector3(),
      };
      computeAgentORCALine(line, agent, other, dt, inverseTimeHorizon);
      lines.push(line);
    }

    // 3. 线性规划求解:在所有半平面交集中找最接近 preferredVelocity 的速度
    const numLines = lines.length;
    const result = new Vector3();

    if (numLines === 0) {
      // 无邻居:直接用 preferredVelocity(截断到 maxSpeed)
      const lenSq = absSq2D(agent.preferredVelocity);
      if (lenSq > agent.maxSpeed * agent.maxSpeed) {
        const len = Math.sqrt(lenSq);
        result.set(
          (agent.preferredVelocity.x / len) * agent.maxSpeed,
          0,
          (agent.preferredVelocity.z / len) * agent.maxSpeed,
        );
      } else {
        result.copy(agent.preferredVelocity);
      }
    } else {
      // LP2:尝试用 preferredVelocity 求解
      const lineFail = linearProgram2(
        lines,
        numLines,
        agent.preferredVelocity,
        false,
        agent.maxSpeed,
        result,
      );

      if (lineFail < numLines) {
        // LP2 失败,用 LP3 fallback
        linearProgram3(lines, numLines, lineFail, agent.maxSpeed, result);
      }
    }

    agent.newVelocity.copy(result);
  }

  /** 统计信息。 */
  getStats(): ORCAStats {
    let totalSpeed = 0;
    let maxSpeed = 0;
    let collidingPairs = 0;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const speed = Math.sqrt(a.newVelocity.x * a.newVelocity.x + a.newVelocity.z * a.newVelocity.z);
      totalSpeed += speed;
      if (speed > maxSpeed) maxSpeed = speed;

      for (let j = i + 1; j < this.agents.length; j++) {
        const b = this.agents[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < a.radius + b.radius) {
          collidingPairs++;
        }
      }
    }

    return {
      agentCount: this.agents.length,
      averageSpeed: this.agents.length > 0 ? totalSpeed / this.agents.length : 0,
      maxSpeed,
      collidingPairs,
    };
  }
}

/** ORCA 统计信息。 */
export interface ORCAStats {
  /** 代理总数。 */
  agentCount: number;
  /** 平均速度。 */
  averageSpeed: number;
  /** 最大速度。 */
  maxSpeed: number;
  /** 当前碰撞对数(理想为 0)。 */
  collidingPairs: number;
}

// ── 预设 ─────────────────────────────────────────────────────────

/** ORCA 预设。 */
export const ORCAPresets = {
  /**
   * 紧密人群 —— 小半径、短时间视野、低速度。
   * 适合:地铁站、商场、密集战斗。
   */
  denseCrowd(): Partial<ORCASolverOptions> {
    return {
      defaultRadius: 0.4,
      defaultMaxSpeed: 1.2,
      defaultNeighborDist: 8,
      defaultTimeHorizon: 3,
      maxNeighbors: 15,
    };
  },

  /**
   * 开阔战场 —— 大半径、长时间视野、高速度。
   * 适合:RTS 单位、载具、骑兵。
   */
  openBattlefield(): Partial<ORCASolverOptions> {
    return {
      defaultRadius: 1.0,
      defaultMaxSpeed: 5.0,
      defaultNeighborDist: 25,
      defaultTimeHorizon: 8,
      maxNeighbors: 10,
    };
  },

  /**
   * 城市交通 —— 中等参数,强调稳定性。
   * 适合:车辆交通、行人过街。
   */
  cityTraffic(): Partial<ORCASolverOptions> {
    return {
      defaultRadius: 2.0,
      defaultMaxSpeed: 8.0,
      defaultNeighborDist: 30,
      defaultTimeHorizon: 10,
      maxNeighbors: 8,
    };
  },

  /**
   * 高精度 —— 长时间视野、多邻居,适合需要高质量避障的场景。
   * 适合:过场动画、关键 NPC 交互。
   */
  highPrecision(): Partial<ORCASolverOptions> {
    return {
      defaultRadius: 0.5,
      defaultMaxSpeed: 2.0,
      defaultNeighborDist: 20,
      defaultTimeHorizon: 10,
      maxNeighbors: 20,
    };
  },
} as const;

/** ORCASolver 构造选项。 */
export interface ORCASolverOptions {
  defaultRadius: number;
  defaultMaxSpeed: number;
  defaultNeighborDist: number;
  defaultTimeHorizon: number;
  maxNeighbors: number;
}

/** 创建带预设的 ORCASolver。 */
export function createORCASolver(preset?: Partial<ORCASolverOptions>): ORCASolver {
  const solver = new ORCASolver();
  if (preset) {
    if (preset.defaultRadius !== undefined) solver.defaultRadius = preset.defaultRadius;
    if (preset.defaultMaxSpeed !== undefined) solver.defaultMaxSpeed = preset.defaultMaxSpeed;
    if (preset.defaultNeighborDist !== undefined) solver.defaultNeighborDist = preset.defaultNeighborDist;
    if (preset.defaultTimeHorizon !== undefined) solver.defaultTimeHorizon = preset.defaultTimeHorizon;
    if (preset.maxNeighbors !== undefined) solver.maxNeighbors = preset.maxNeighbors;
  }
  return solver;
}

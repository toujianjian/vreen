// GOAPPlanner — Goal-Oriented Action Planning(目标导向行动规划)。
//
// 设计:
//   * WorldState:键值对(布尔/数字),表示 AI 对世界的认知
//   * GOAPAction:preconditions(前置条件)+ effects(效果)+ cost(代价)
//   * GOAPGoal:targetState(目标世界状态)+ priority(优先级)
//   * GOAPPlanner:A* 搜索动作空间,找到从当前状态到目标状态的最低代价动作序列
//
// A* 搜索:
//   * 节点 = (worldState, plan, gCost)
//   * 邻居 = 所有 preconditions 满足的 action,应用 effects 生成新状态
//   * 启发式 h = 未满足目标条件数(可加权)
//   * f = g + h,优先队列展开
//   * 状态序列化(键排序)用于去重/已访问检查
//
// 与 BehaviorTree 的区别:
//   * BT 是反应式(每帧从根遍历),决策快但缺乏长期规划
//   * GOAP 是规划式(一次性生成动作序列),决策慢但能解决多步骤目标
//   * 互补:BT 适合日常行为(巡逻/逃跑),GOAP 适合复杂目标(打开门→拿钥匙→开箱)
//
// 参考:
//   - Jeff Orkin, "Three States and a Plan: The AI of FEAR", 2005
//   - o3de ScriptCanvas AI / Goal-oriented action planning

/** 世界状态值类型。 */
export type WorldStateValue = boolean | number;

/** 世界状态:键值对。 */
export type WorldState = Map<string, WorldStateValue>;

/** GOAP 动作。 */
export interface GOAPAction {
  /** 动作名(唯一)。 */
  name: string;
  /** 前置条件:动作执行前必须满足的世界状态子集。 */
  preconditions: Record<string, WorldStateValue>;
  /** 效果:动作执行后应用的世界状态变更。 */
  effects: Record<string, WorldStateValue>;
  /** 代价(默认 1)。 */
  cost: number;
  /** 可选:运行时检查(动态判定动作是否可执行,如目标存在/距离够近)。 */
  validate?: (state: WorldState) => boolean;
}

/** GOAP 目标。 */
export interface GOAPGoal {
  /** 目标名。 */
  name: string;
  /** 目标世界状态子集:规划器试图让这些键达到指定值。 */
  targetState: Record<string, WorldStateValue>;
  /** 优先级(越大越优先,默认 0)。 */
  priority: number;
  /** 可选:目标激活条件(不满足则跳过该目标)。 */
  activate?: (state: WorldState) => boolean;
}

/** 规划结果。 */
export interface GOAPPlan {
  /** 规划的目标名。 */
  goalName: string;
  /** 动作序列(按执行顺序)。 */
  actions: GOAPAction[];
  /** 总代价。 */
  totalCost: number;
  /** 规划耗时(ms)。 */
  planningTime: number;
  /** 搜索展开节点数。 */
  nodesExpanded: number;
}

/** 规划失败原因。 */
export type GOAPFailureReason = 'no-action' | 'no-goal' | 'unreachable' | 'invalid-state';

/** 规划结果(成功包含 plan,失败包含 reason)。 */
export type GOAPPlanResult =
  | { success: true; plan: GOAPPlan }
  | { success: false; reason: GOAPFailureReason };

/** A* 搜索节点。 */
interface SearchNode {
  state: WorldState;
  plan: GOAPAction[];
  gCost: number;
  hCost: number;
  fCost: number;
  stateKey: string;
}

/** 优先队列(最小堆,按 fCost 升序)。 */
class PriorityQueue {
  private heap: SearchNode[] = [];

  get length(): number { return this.heap.length; }

  push(node: SearchNode): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SearchNode | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].fCost < this.heap[parent].fCost) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.heap[l].fCost < this.heap[smallest].fCost) smallest = l;
      if (r < n && this.heap[r].fCost < this.heap[smallest].fCost) smallest = r;
      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else break;
    }
  }
}

/** 序列化世界状态(键排序,用于去重)。 */
function serializeState(state: WorldState): string {
  const keys = Array.from(state.keys()).sort();
  return keys.map((k) => `${k}=${state.get(k)}`).join(';');
}

/** 检查 state 是否满足 preconditions(子集匹配)。 */
function meetsPreconditions(state: WorldState, preconditions: Record<string, WorldStateValue>): boolean {
  for (const key in preconditions) {
    const cur = state.get(key);
    const req = preconditions[key];
    if (cur !== req) return false;
  }
  return true;
}

/** 检查 state 是否满足目标(子集匹配)。 */
function meetsGoal(state: WorldState, target: Record<string, WorldStateValue>): boolean {
  for (const key in target) {
    const cur = state.get(key);
    const req = target[key];
    if (cur !== req) return false;
  }
  return true;
}

/** 应用 effects 到 state,返回新 state(不可变)。 */
function applyEffects(state: WorldState, effects: Record<string, WorldStateValue>): WorldState {
  const next = new Map(state);
  for (const key in effects) {
    next.set(key, effects[key]);
  }
  return next;
}

/** 启发式:未满足目标条件数(可加权)。 */
function heuristic(state: WorldState, target: Record<string, WorldStateValue>): number {
  let h = 0;
  for (const key in target) {
    if (state.get(key) !== target[key]) h++;
  }
  return h;
}

export class GOAPPlanner {
  /** 最大搜索节点数(防止无限搜索,默认 1000)。 */
  maxNodes: number;
  /** 最大搜索深度(动作序列长度上限,默认 20)。 */
  maxDepth: number;
  /** 启发式权重(0=纯 Dijkstra,1=贪心,默认 1)。 */
  heuristicWeight: number;

  constructor(opts: { maxNodes?: number; maxDepth?: number; heuristicWeight?: number } = {}) {
    this.maxNodes = opts.maxNodes ?? 1000;
    this.maxDepth = opts.maxDepth ?? 20;
    this.heuristicWeight = opts.heuristicWeight ?? 1;
  }

  /** 规划:从 currentState 出发,找到达成 goal 的最低代价动作序列。 */
  plan(
    currentState: WorldState,
    actions: GOAPAction[],
    goal: GOAPGoal,
  ): GOAPPlanResult {
    if (Object.keys(goal.targetState).length === 0) return { success: false, reason: 'no-goal' };

    // 目标已满足(在 no-action 检查前判定,空动作集也允许返回空计划)
    if (meetsGoal(currentState, goal.targetState)) {
      return {
        success: true,
        plan: {
          goalName: goal.name,
          actions: [],
          totalCost: 0,
          planningTime: 0,
          nodesExpanded: 0,
        },
      };
    }

    if (actions.length === 0) return { success: false, reason: 'no-action' };

    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const startStateKey = serializeState(currentState);
    // closed set:已展开(从队列弹出)的状态
    const closed = new Set<string>();
    // bestG:每个状态目前见过的最低 g-cost(用于丢弃劣等重复路径)
    const bestG = new Map<string, number>();
    bestG.set(startStateKey, 0);
    const open = new PriorityQueue();
    open.push({
      state: currentState,
      plan: [],
      gCost: 0,
      hCost: heuristic(currentState, goal.targetState) * this.heuristicWeight,
      fCost: heuristic(currentState, goal.targetState) * this.heuristicWeight,
      stateKey: startStateKey,
    });

    let nodesExpanded = 0;

    while (open.length > 0 && nodesExpanded < this.maxNodes) {
      const cur = open.pop()!;

      // 懒删除:若该状态已被更优路径展开,跳过
      if (closed.has(cur.stateKey)) continue;
      closed.add(cur.stateKey);
      nodesExpanded++;

      // 检查是否达成目标
      if (meetsGoal(cur.state, goal.targetState)) {
        const endTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        return {
          success: true,
          plan: {
            goalName: goal.name,
            actions: cur.plan,
            totalCost: cur.gCost,
            planningTime: endTime - startTime,
            nodesExpanded,
          },
        };
      }

      // 深度限制
      if (cur.plan.length >= this.maxDepth) continue;

      // 展开邻居:所有 preconditions 满足的 action
      for (const action of actions) {
        if (!meetsPreconditions(cur.state, action.preconditions)) continue;
        if (action.validate && !action.validate(cur.state)) continue;

        const nextState = applyEffects(cur.state, action.effects);
        const nextKey = serializeState(nextState);

        // 已展开过的状态不再入队
        if (closed.has(nextKey)) continue;

        const nextG = cur.gCost + action.cost;
        // 若该状态已见过更优或等代价路径,跳过
        const prevBest = bestG.get(nextKey);
        if (prevBest !== undefined && prevBest <= nextG) continue;
        bestG.set(nextKey, nextG);

        const nextH = heuristic(nextState, goal.targetState) * this.heuristicWeight;
        open.push({
          state: nextState,
          plan: [...cur.plan, action],
          gCost: nextG,
          hCost: nextH,
          fCost: nextG + nextH,
          stateKey: nextKey,
        });
      }
    }

    return { success: false, reason: 'unreachable' };
  }

  /** 多目标规划:按优先级依次尝试,返回第一个成功的结果。 */
  planMultiple(
    currentState: WorldState,
    actions: GOAPAction[],
    goals: GOAPGoal[],
  ): GOAPPlanResult {
    // 按优先级降序排序
    const sorted = [...goals].sort((a, b) => b.priority - a.priority);
    for (const goal of sorted) {
      if (goal.activate && !goal.activate(currentState)) continue;
      const result = this.plan(currentState, actions, goal);
      if (result.success) return result;
    }
    return { success: false, reason: 'unreachable' };
  }
}

/** GOAP 代理:持有当前状态、可用动作、目标列表,运行规划器并执行计划。 */
export class GOAPAgent {
  /** 唯一标识。 */
  id: string;
  /** 当前世界状态(AI 对世界的认知)。 */
  state: WorldState = new Map();
  /** 可用动作集。 */
  actions: GOAPAction[] = [];
  /** 目标列表。 */
  goals: GOAPGoal[] = [];
  /** 规划器。 */
  planner: GOAPPlanner;
  /** 当前计划(null 表示无计划)。 */
  currentPlan: GOAPPlan | null = null;
  /** 当前执行到的动作索引。 */
  currentActionIndex: number = 0;
  /** 当前动作的执行状态。 */
  actionStatus: 'idle' | 'running' | 'success' | 'failure' = 'idle';
  /** 重规划间隔(毫秒,默认 1000)。 */
  replanInterval: number = 1000;
  /** 上次规划时间戳。 */
  private lastPlanTime: number = 0;
  /** 是否需要重规划(状态变更后置 true)。 */
  needsReplan: boolean = true;

  constructor(id: string, planner?: GOAPPlanner) {
    this.id = id;
    this.planner = planner ?? new GOAPPlanner();
  }

  /** 设置世界状态值。 */
  setState(key: string, value: WorldStateValue): this {
    this.state.set(key, value);
    this.needsReplan = true;
    return this;
  }

  /** 批量设置世界状态。 */
  setStates(states: Record<string, WorldStateValue>): this {
    for (const k in states) this.state.set(k, states[k]);
    this.needsReplan = true;
    return this;
  }

  /** 添加动作。 */
  addAction(action: GOAPAction): this {
    this.actions.push(action);
    this.needsReplan = true;
    return this;
  }

  /** 添加目标。 */
  addGoal(goal: GOAPGoal): this {
    this.goals.push(goal);
    this.needsReplan = true;
    return this;
  }

  /** 强制重规划。 */
  forceReplan(): void {
    this.needsReplan = true;
  }

  /** 生成新计划。返回是否成功。 */
  replan(): boolean {
    if (this.goals.length === 0 || this.actions.length === 0) {
      this.currentPlan = null;
      return false;
    }
    const result = this.planner.planMultiple(this.state, this.actions, this.goals);
    if (result.success) {
      this.currentPlan = result.plan;
      this.currentActionIndex = 0;
      this.actionStatus = result.plan.actions.length > 0 ? 'running' : 'success';
      this.needsReplan = false;
      this.lastPlanTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return true;
    }
    this.currentPlan = null;
    this.actionStatus = 'failure';
    this.needsReplan = false;
    return false;
  }

  /** 推进一帧。返回当前执行的动作(无则 null)。 */
  update(now?: number): GOAPAction | null {
    const t = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // 周期性重规划
    if (this.needsReplan || (this.currentPlan === null && t - this.lastPlanTime > this.replanInterval)) {
      this.replan();
    }

    if (!this.currentPlan || this.currentActionIndex >= this.currentPlan.actions.length) {
      return null;
    }

    return this.currentPlan.actions[this.currentActionIndex];
  }

  /** 标记当前动作完成(成功)。 */
  completeAction(): void {
    if (!this.currentPlan || this.currentActionIndex >= this.currentPlan.actions.length) return;
    const action = this.currentPlan.actions[this.currentActionIndex];
    // 应用 effects 到世界状态
    for (const k in action.effects) {
      this.state.set(k, action.effects[k]);
    }
    this.currentActionIndex++;
    if (this.currentActionIndex >= this.currentPlan.actions.length) {
      this.actionStatus = 'success';
      this.currentPlan = null;
      this.needsReplan = true;
    } else {
      this.actionStatus = 'running';
    }
  }

  /** 标记当前动作失败。 */
  failAction(): void {
    this.actionStatus = 'failure';
    this.currentPlan = null;
    this.needsReplan = true;
  }

  /** 获取当前计划剩余动作数。 */
  get remainingActions(): number {
    if (!this.currentPlan) return 0;
    return Math.max(0, this.currentPlan.actions.length - this.currentActionIndex);
  }

  /** 获取当前计划完成进度 [0,1]。 */
  get progress(): number {
    if (!this.currentPlan || this.currentPlan.actions.length === 0) return 1;
    return this.currentActionIndex / this.currentPlan.actions.length;
  }
}

/** 工具:从 Record 创建 WorldState。 */
export function makeWorldState(states: Record<string, WorldStateValue>): WorldState {
  const map = new Map<string, WorldStateValue>();
  for (const k in states) map.set(k, states[k]);
  return map;
}

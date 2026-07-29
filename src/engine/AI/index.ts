// AI barrel — AI 导航与决策系统统一导出。
//
// 包含:
//   * NavMesh           — 导航网格(三角形面片 + 邻接关系)
//   * PathFinder        — A* 寻路 + 漏斗算法路径平滑
//   * SteeringBehavior  — Reynolds 转向行为(seek/flee/arrive/pursue/evade/wander/flocking)
//   * Agent             — AI 代理实体(位置/速度/路径跟随)
//   * Blackboard        — 行为树共享内存(键值存储 + 类型安全获取)
//   * BTNode            — 行为树节点基类
//   * BTComposite       — 复合节点(Sequence/Selector/Parallel)
//   * BTDecorator       — 装饰器节点(Inverter/Repeater/Succeeder/Failer/UntilFail)
//   * BTAction          — 动作叶节点
//   * BTCondition       — 条件叶节点
//   * BehaviorTree      — 行为树主控(tick/interrupt/reset)
//   * CrowdSystem       — 人群系统 (大规模代理调度 + 避障 + NavMesh 寻路)
//   * SpatialGrid       — 2D XZ 空间网格 (邻域查询加速,供 CrowdSystem 使用)

export { NavMesh, type NavTriangle, type NavEdge, type NavMeshJSON } from './NavMesh';
export { PathFinder } from './PathFinder';
export { SteeringBehavior, type Obstacle } from './SteeringBehavior';
export { Agent, type AgentOptions } from './Agent';
export { Blackboard } from './Blackboard';
export { BTNode, type BTStatus } from './BTNode';
export {
  BTComposite,
  Sequence,
  Selector,
  Parallel,
  type ParallelPolicy,
} from './BTComposite';
export {
  BTDecorator,
  Inverter,
  Repeater,
  Succeeder,
  Failer,
  UntilFail,
} from './BTDecorator';
export { BTAction, type BTActionFn } from './BTAction';
export { BTCondition, type BTConditionFn } from './BTCondition';
export { BehaviorTree } from './BehaviorTree';
// CrowdSystem — 人群系统 (CrowdAgent + SpatialGrid + 避障 + NavMesh 寻路)。
// 与 Agent 互补:Agent 是单代理导航实体,CrowdSystem 是群体调度器。
export {
  CrowdSystem,
  type CrowdAgent,
  type CrowdAgentState,
  type CrowdStats,
  type CrowdSystemOptions,
} from './CrowdSystem';
export { SpatialGrid } from './SpatialGrid';

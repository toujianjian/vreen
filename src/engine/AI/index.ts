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
//   * PerceptionSystem  — AI 感知系统 (视觉/听觉/触觉/嗅觉 + 记忆)
//   * MLInterface       — 机器学习接口 (神经网络/决策树/SVM/KNN + 训练/推理)
//   * GOAPPlanner       — 目标导向行动规划 (A* 搜索动作空间,生成最低代价动作序列)
//   * UtilityAI         — 效用理论驱动决策 (考虑因素 + 响应曲线 + 合成策略 + 冷却/惯性)
//   * ORCA              — Optimal Reciprocal Collision Avoidance (RVO2 速度空间避障)

export { NavMesh, type NavTriangle, type NavEdge, type NavMeshJSON } from './NavMesh';
// NavMeshBuilder — Recast 风格导航网格构建器 (体素化 → 可走标记 → 侵蚀 → 区域 → 轮廓 → 多边形网格)。
// 与 NavMesh 互补:NavMesh 持有网格数据;NavMeshBuilder 负责从任意几何体生成 NavMesh。
export {
  NavMeshBuilder,
  type VoxelSpan,
  type Heightfield,
  type Contour,
  type PolyMesh,
  type NavMeshBuildStats,
} from './NavMeshBuilder';
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
// PerceptionSystem — AI 感知系统 (视觉/听觉/触觉/嗅觉 + 记忆)。
// 与 BehaviorTree 互补:PerceptionSystem 提供目标感知,行为树读取后决策。
export {
  PerceptionSystem,
  type SensorType,
  type Sensor,
  type PerceptionEvent,
  type PerceptionTarget,
  type PerceptionStats,
  type OcclusionTest,
} from './PerceptionSystem';
// MLInterface — 机器学习接口 (神经网络/决策树/SVM/KNN + 训练/推理)。
// 与 PerceptionSystem 互补:感知系统提供输入特征,ML 模型输出决策。
export {
  MLInterface,
  type MLModel,
  type MLModelConfig,
  type MLModelJSON,
  type MLModelType,
  type ActivationType,
  type TrainingSample,
  type TrainingProgress,
  type MLStats,
} from './MLInterface';
// GOAPPlanner — 目标导向行动规划 (A* 搜索动作空间,生成最低代价动作序列)。
// 与 BehaviorTree 互补:BT 是反应式决策,GOAP 是规划式决策,适合复杂多步骤目标。
export {
  GOAPPlanner,
  GOAPAgent,
  makeWorldState,
  type WorldStateValue,
  type WorldState,
  type GOAPAction,
  type GOAPGoal,
  type GOAPPlan,
  type GOAPPlanResult,
  type GOAPFailureReason,
} from './GOAPPlanner';
// UtilityAI — 效用理论驱动决策 (考虑因素 + 响应曲线 + 合成策略 + 冷却/惯性)。
// 与 BehaviorTree/GOAP 互补:BT 是硬编码决策树,GOAP 是规划式,UtilityAI 是连续评分式。
export {
  UtilityAI,
  Considerations,
  type UtilityContext,
  type ResponseCurveType,
  type ResponseCurveParams,
  type Consideration,
  type UtilityAction,
  type CompositeStrategy,
  type UtilityDecision,
} from './UtilityAI';
// ORCA — Optimal Reciprocal Collision Avoidance (Van den Berg 2011 SIGGRAPH / RVO2)。
// 与 CrowdSystem 互补:CrowdSystem 默认用 Reynolds separation 力,ORCA 提供速度空间
// 求解的避障,在密集人群/窄通道场景下表现更稳定(无抖动、排队通过)。
export {
  ORCASolver,
  ORCAPresets,
  createORCASolver,
  type ORCAAgent,
  type ORCALine,
  type ORCAStats,
  type ORCASolverOptions,
} from './ORCA';

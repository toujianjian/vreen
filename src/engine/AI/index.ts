// AI barrel — AI 导航系统统一导出。
//
// 包含:
//   * NavMesh           — 导航网格(三角形面片 + 邻接关系)
//   * PathFinder        — A* 寻路 + 漏斗算法路径平滑
//   * SteeringBehavior  — Reynolds 转向行为(seek/flee/arrive/pursue/evade/wander/flocking)
//   * Agent             — AI 代理实体(位置/速度/路径跟随)

export { NavMesh, type NavTriangle, type NavEdge, type NavMeshJSON } from './NavMesh';
export { PathFinder } from './PathFinder';
export { SteeringBehavior, type Obstacle } from './SteeringBehavior';
export { Agent, type AgentOptions } from './Agent';

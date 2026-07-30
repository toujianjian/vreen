// Physics barrel — 物理约束系统的统一导入出口。
//
// 约束系统独立于 ECS PhysicsSystems,通过 RigidbodyLike 接口与任意刚体实现解耦。
// 同时 re-export 现有 PhysicsDemo 工具(向后兼容)。

// 约束基类与接口
export {
  Constraint,
  type RigidbodyLike,
  type Mat3,
  skewMat,
  mat3MulVec,
  mat3MulMat3,
  mat3Inverse,
  mat3Identity,
  computePointEffectiveMass,
  applyImpulse,
} from './Constraint';

// 各类约束
export { BallJointConstraint } from './BallJointConstraint';
export { HingeJointConstraint } from './HingeJointConstraint';
export { SliderJointConstraint } from './SliderJointConstraint';
export { FixedJointConstraint } from './FixedJointConstraint';
export { DistanceJointConstraint } from './DistanceJointConstraint';

// 求解器
export { ConstraintSolver } from './ConstraintSolver';

// 高层约束管理器 (扁平 PhysicsConstraint 描述符 + 运行时增删 / 断裂检测)
export {
  ConstraintSystem,
  type ConstraintType,
  type PhysicsConstraint,
  type ConstraintLimit,
  type ConstraintConfig,
  type ConstraintSystemStats,
} from './ConstraintSystem';

// 布料模拟(Verlet 积分 + 距离约束,与 ECS PhysicsSystems 解耦)
export {
  ClothSimulation,
  type ClothParticle,
  type ClothConstraint,
  type ClothSphere,
  type ClothOptions,
} from './ClothSimulation';

// SPH 流体模拟(Poly6/Spiky/Viscosity 核 + SpatialGrid 邻居搜索 + 边界反弹)
export {
  FluidSimulation,
  type FluidParticle,
  type FluidParticleColor,
  type FluidOptions,
  type FluidStats,
} from './FluidSimulation';

// Voronoi 破碎(基于 Voronoi 图的几何碎裂)
export {
  VoronoiFracture,
  type VoronoiSite,
} from './VoronoiFracture';

// 破坏系统(可破坏物体注册 / 切片 / 碎裂 / 形变 + 碎片物理)
export {
  DestructionSystem,
  type Fragment,
  type Destructible,
  type SlicePlane,
  type DestructionStats,
  type SliceResult,
} from './DestructionSystem';

// 现有 PhysicsDemo(保持向后兼容)
export {
  installPhysicsSystems,
  createPhysicsConfigEntity,
  createPhysicsDemo,
  syncMeshesFromTransforms,
} from './PhysicsDemo';

// 碰撞检测系统 (BVH 宽相 + SAT/GJK/EPA 窄相 + 射线检测 + 接触流形)
// 与 ECS PhysicsSystems 解耦:纯检测,不含积分/冲量响应。
// 注意:CollisionSystem / Collider / BVHNode 与 ECS PhysicsSystems.CollisionSystem /
// ECS PhysicsComponents.Collider / Acceleration.BVHNode 同名,这里以 Advanced*/Collision* 别名
// re-export,避免 engine 顶层 barrel 的 export * 歧义 (与 Particles 的 AdvancedParticleEmitter 同模式)。
// 直接从 './CollisionSystem' 仍可按原名 CollisionSystem / Collider / BVHNode 导入。
export {
  CollisionSystem as AdvancedCollisionSystem,
  type Collider as CollisionCollider,
  type ColliderType,
  type BroadphaseType,
  type NarrowphaseType,
  type AABB,
  type ContactPoint,
  type ContactManifold,
  type BVHNode as CollisionBVHNode,
  type RaycastHit,
  type CollisionStats,
} from './CollisionSystem';

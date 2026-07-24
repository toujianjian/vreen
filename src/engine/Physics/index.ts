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

// 现有 PhysicsDemo(保持向后兼容)
export {
  installPhysicsSystems,
  createPhysicsConfigEntity,
  createPhysicsDemo,
  syncMeshesFromTransforms,
} from './PhysicsDemo';

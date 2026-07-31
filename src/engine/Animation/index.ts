// Animation barrel.

export { KeyframeTrack, NumberKeyframeTrack, VectorKeyframeTrack, QuaternionKeyframeTrack, type InterpMode, type TrackTarget } from './KeyframeTrack';
export { AnimationClip, type AnimationEvent } from './AnimationClip';
export { AnimationAction, type LoopMode, type AnimationEventCallback } from './AnimationAction';
export { AnimationMixer } from './AnimationMixer';
export {
  AnimationStateMachine,
  type AnimState,
  type AnimTransition,
  type TransitionCondition,
  type BlendTree,
  type BlendNode,
  type AnimStateMachineGraph,
} from './AnimationStateMachine';
export { IKSystem, type IKChainConfig, type IKConstraint } from './IKSystem';
// Procedural animation — 程序化动画系统 (步态生成/头部追踪/二次运动/呼吸/待机摇摆)。
// 与 AnimationMixer 互补:Mixer 播放关键帧 clip,ProceduralAnimation 叠加无数据程序化运动。
export {
  ProceduralAnimation,
  type ProceduralNodeType,
  type ProceduralNode,
  type ProceduralAnimationStats,
} from './ProceduralAnimation';
export { BlendSpace1D, type BlendSpaceSample } from './BlendSpace1D';
// Animation retargeting — adapt a clip from one skeleton to another with
// different proportions. Relative-to-bind-pose strategy: delta = anim - bind,
// then apply delta to target bind. Adapted from o3de EMotionFX retargeting.
export {
  AnimationRetargeting,
  extractBindPose,
  type BindTransform,
  type BoneMapping,
  type RetargetConfig,
} from './AnimationRetargeting';
// Two-bone IK solver (law of cosines + pole vector) and LookAt IK.
// The standard UE/Godot/o3de pattern for arm/leg IK and head tracking.
export {
  TwoBoneIKSolver,
  LookAtIK,
  type TwoBoneIKInput,
  type TwoBoneIKOutput,
  type LookAtIKInput,
  type LookAtIKOutput,
} from './TwoBoneIKSolver';
// 2D blend space (Delaunay triangulation + barycentric weights) for
// forward/strafe locomotion blending. Adapted from o3de EMotionFX
// BlendSpace2DNode.
export { BlendSpace2D, type BlendSpace2DSample, type BlendSpace2DResult } from './BlendSpace2D';
// Secondary bone spring physics (hair / cloth / ears / tail follow-through).
// Adapted from o3de EMotionFX SpringSolver.
export { SpringSolver, type SpringBone, type SpringSolverOptions } from './SpringSolver';
// Root motion / motion extraction (adapted from o3de EMotionFX RepositioningLayerPass).
// Extracts the root bone's per-frame delta from a clip and redirects it to the
// actor's world transform so in-place walk/run clips drive the character forward.
export { RootMotionExtractor, DEFAULT_ROOT_MOTION_CONFIG } from './RootMotion';
export type { RootMotionConfig } from './RootMotion';
export { buildHumanoid, type HumanoidBundle } from './Humanoid';
// Animation Layer subsystem (masks, additive blend, layering, sync).
export { BoneMask } from './BoneMask';
export { AvatarMask } from './AvatarMask';
export { AdditiveBlend } from './AdditiveBlend';
export { AnimationSync, type SyncConfig } from './AnimationSync';
export { AnimationLayer, type LayerBlendMode } from './AnimationLayer';
export { AnimationLayerMixer } from './AnimationLayerMixer';
// IK subsystem (FABRIK + CCD solvers, joint constraints, humanoid rig presets).
export {
  IKBone,
  type JointConstraint,
  IKChain,
  type IKChainOptions,
  IKSolver,
  type IKSolverOptions,
  CCDSolver,
  IKHumanoid,
  type Side,
  type HumanoidRestPose,
  defaultHumanoidRestPose,
} from './IK';
// BoneAttachment — 把任意 Object3D 附加到骨骼上(武器 / 道具 / 装备槽 / VFX 锚点)。
// 类似 Godot BoneAttachment / UE AttachToComponent / o3de ActorComponent。
// 支持 4 种跟随模式(world / position / rotation / snap)+ 平滑插值 + 批量管理器。
export {
  BoneAttachment,
  BoneAttachmentManager,
  type BoneAttachmentOptions,
  type FollowMode,
} from './BoneAttachment';

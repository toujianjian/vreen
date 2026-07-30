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

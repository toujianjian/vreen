// Animation barrel.

export { KeyframeTrack, NumberKeyframeTrack, VectorKeyframeTrack, QuaternionKeyframeTrack, type InterpMode, type TrackTarget } from './KeyframeTrack';
export { AnimationClip, type AnimationEvent } from './AnimationClip';
export { AnimationAction, type LoopMode, type AnimationEventCallback } from './AnimationAction';
export { AnimationMixer } from './AnimationMixer';
export { AnimationStateMachine, type AnimMachineState, type AnimTransition } from './AnimationStateMachine';
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

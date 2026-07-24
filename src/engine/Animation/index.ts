// Animation barrel.

export { KeyframeTrack, NumberKeyframeTrack, VectorKeyframeTrack, QuaternionKeyframeTrack, type InterpMode, type TrackTarget } from './KeyframeTrack';
export { AnimationClip, type AnimationEvent } from './AnimationClip';
export { AnimationAction, type LoopMode, type AnimationEventCallback } from './AnimationAction';
export { AnimationMixer } from './AnimationMixer';
export { AnimationStateMachine, type AnimMachineState, type AnimTransition } from './AnimationStateMachine';
export { BlendSpace1D, type BlendSpaceSample } from './BlendSpace1D';
export { buildHumanoid, type HumanoidBundle } from './Humanoid';
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

// Controls — 自研输入控制器。零 three 依赖，PointerEvent 一手接入。

export { OrbitControls } from './OrbitControls';
export type { OrbitControlsOptions, PointerEntry } from './OrbitControls';

export { FlyControls } from './FlyControls';
export type { FlyControlsOptions } from './FlyControls';

export { PointerLockControls } from './PointerLockControls';
export type { PointerLockControlsOptions } from './PointerLockControls';

export { MapControls } from './MapControls';
export type { MapControlsOptions } from './MapControls';

// CharacterController — kinematic 角色控制器（重力 / 跳跃 / 台阶 / 坡度限制）。
export { CharacterController } from './CharacterController';
export type {
  CharacterState,
  CharacterControllerOptions,
  GroundSampleFn,
} from './CharacterController';

// SweptCharacterController — swept-collision kinematic CC (capsule sweep + slide).
// Adapts o3de PhysX CharacterController swept-collision concept.
export { SweptCharacterController, sweepCapsule } from './SweptCharacterController';
export type {
  SweepHit,
  SweepResult,
  ColliderProvider,
  SweptCharacterControllerOptions,
} from './SweptCharacterController';

// VRController — WebXR VR/XR 支持 (手柄追踪 + 双眼渲染位姿提取)。
export { VRController } from './VRController';
export type {
  XRReferenceSpaceType,
  VREyeParams,
  VRHandController,
  VRControllerStats,
  VRSessionOptions,
  VRHeadsetPose,
} from './VRController';

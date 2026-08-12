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

// TransformControls — 编辑器物体变换 gizmo (translate / rotate / scale)。
// 轴端球 picker 做命中检测,拖拽映射到 target 变换;纯数据计算函数
// (buildDragPlane / computeTranslate / computeScale / computeRotate)
// 无 WebGL 依赖、可单测。适配 three.js TransformControls。
export { TransformControls, buildDragPlane, computeTranslate, computeScale, computeRotate } from './TransformControls';
export type {
  TransformMode,
  TransformSpace,
  TransformAxis,
  TransformControlsOptions,
  TransformColors,
  TranslateContext,
  ScaleContext,
  RotateContext,
  RotateResult,
} from './TransformControls';

// VR/XR 支持已迁移到独立的 WebXR 模块 (src/engine/WebXR),
// 提供完整的会话管理器 + 控制器 (手部25关节+捏合) + AR 子系统
// (光照估计/平面检测/深度感知) + DOM 按钮 + Provider 抽象 (可测试)。
// 原 VRController 已被 WebXRManager/WebXRController 取代。

// Cameras barrel.

export { Camera } from './Camera';
export { PerspectiveCamera } from './PerspectiveCamera';
export { OrthographicCamera } from './OrthographicCamera';
export {
  CinematicCamera,
  type CameraShot,
  type ShotTransitionType,
  type CameraTimelineJSON,
  type ShotInfo,
} from './CinematicCamera';
export { CameraRig, type CameraRigType } from './CameraRig';
// 相机路径动画 (CameraPath) — Catmull-Rom 样条关键帧路径,支持 uniform / centripetal
// 参数化、once/loop/pingpong 循环、自动朝向、手持噪声扰动、JSON 序列化。
// 适配 o3de Track View / Unity Timeline Cinemachine Path / three.js CatmullRomCurve3。
export {
  CameraPath,
  type CameraPathKeyframe,
  type CameraPose,
  type PathLoopMode,
  type SplineParametrization,
  type CameraPathJSON,
  smoothstepEasing,
  easeInOutCubic,
  // 注:EasingFn 类型不从此 barrel 导出 —— SceneManager/SceneTransition.ts
  // 已有同名类型导出,在 engine/index.ts 中会产生冲突。
  // 调用方如需该类型,直接从 './CameraPath' 导入,或使用内联类型 (t: number) => number。
} from './CameraPath';
// PerlinShake — 高品质相机震动(trauma² 模型 + 多倍频 Perlin 噪声)。
// 适配 NVIDIA GDC 2016 "Mission Improbable" 模型 / o3de AzFramework Camera Shake。
// 6 路独立噪声通道(平移 xyz + 旋转 xyz),每轴独立频率,种子可复现。
export {
  PerlinShake,
  PerlinShakePresets,
  type ShakeOffset,
  type PerlinShakeJSON,
} from './PerlinShake';
// 双目立体相机 (Stereoscopic Camera) — VR/3D 电影/红蓝立体/偏振立体渲染基础。
// 适配 three.js StereoCamera.js + off-axis 非对称投影 (Kooima 2008)。
// 提供左右眼 PerspectiveCamera + 瞳距偏移 + 非对称视锥 + 视口计算。
export {
  StereoCamera,
  computeStereoViewports,
  type StereoCameraOptions,
  type StereoMode,
  type StereoRenderConfig,
} from './StereoCamera';
// 立方体相机 (CubeCamera) — 6 面 90° PerspectiveCamera 生成立方体环境贴图。
// 适配 three.js CubeCamera.js。用途:实时 IBL、反射/折射、动态天空盒、
// ReflectionProbe 底层原语、点光源阴影映射。本类只持有相机数据 + renderTarget
// 描述,不直接调 GL;渲染由 WebGL2Renderer.updateCubeCamera() 完成。
export {
  CubeCamera,
  CUBE_FACES,
  type CubeFace,
  type CubeRenderTarget,
} from './CubeCamera';
// 碰撞感知弹簧摇臂 (SpringArm) — 第三人称相机防穿墙,支持射线/球面探针、
// 指数平滑(帧率无关,无超调)、lookAt 平滑、目标位置平滑、预设。
// 适配 UE SpringArmComponent / Unity Cinemachine Collider / o3de AtomCamera。
export {
  SpringArm,
  SpringArmPresets,
  type ProbeFn,
  type ProbeType,
  type SpringArmJSON,
} from './SpringArm';
// 行走头部摆动 (CameraBob) — 第一/第三人称行走时的周期性相机摆动。
// 速度驱动正弦曲线(bobY + swayX + roll + 着地冲击 sin^6),潜行模式,
// 帧率无关相位推进,与 PerlinShake 可叠加(周期性 + 随机冲击)。
// 适配 UE PlayerCameraManager::ApplyCameraBob / o3de AzFramework Camera Bob。
export {
  CameraBob,
  CameraBobPresets,
  type CameraBobOffset,
  type CameraBobJSON,
} from './CameraBob';


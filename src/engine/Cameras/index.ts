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


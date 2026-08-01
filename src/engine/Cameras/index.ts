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


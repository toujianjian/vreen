// WebXR barrel —— VR/AR/MR 会话管理模块。
//
// 适配自 three.js WebXR (src/renderers/webxr/ + examples/jsm/webxr/) 与
// o3de Atom XR pass + OpenXR 集成。提供:
//   * WebXRManager —— 会话生命周期 / 参考空间 / 帧循环 / 控制器注册表。
//   * WebXRController —— 目标射线/握持/手部空间 + 按钮边沿 + 捏合检测。
//   * WebXRSessionButton (createVRButton/createARButton/createXRButton) —— DOM 入口。
//   * XRLightEstimation —— AR 光照估计 (主光 + 球谐)。
//   * XRPlaneTracker —— AR 平面检测 (世界理解)。
//   * WebXRDepthSensing —— AR 深度感知 (遮挡)。
//   * BrowserWebXRProvider —— 浏览器原生 API 适配器 (生产)。
//
// 纯逻辑可测试:核心类只消费 WebXRProvider/XRSessionHandle/XRFrameHandle 纯数据接口,
// 测试注入 Mock,不依赖 WebGL/设备。

export { WebXRManager, type WebXRManagerOptions, type WebXRManagerListener, type WebXRFrameData } from './WebXRManager';
export {
  WebXRController,
  XRSpace,
  XRJointSpace,
  XRHandState,
  type XRControllerListener,
} from './WebXRController';
export {
  createVRButton,
  createARButton,
  createXRButton,
  registerSessionGrantedListener,
  resetXRButtonState,
  type XRButtonStyleOptions,
} from './WebXRSessionButton';
export { XRLightEstimation, type XRLightEstimateState, type XREstimatedDirectionalLight } from './XRLightEstimation';
export { XRPlaneTracker, type PlaneBounds, type PlaneDeltaEvent, type PlaneTrackerListener } from './XRPlaneTracker';
export { WebXRDepthSensing, type DepthSensingState } from './WebXRDepthSensing';
export { BrowserWebXRProvider, createBrowserWebXRProvider } from './BrowserWebXRProvider';
export type {
  XRSessionMode,
  XRReferenceSpaceType,
  XREnvironmentBlendMode,
  XRVisibilityState,
  XRInputEventType,
  XRHandedness,
  XRTargetRayMode,
  XRTransform,
  XRViewData,
  XRViewerPose,
  XRButtonState,
  XRGamepadAxes,
  XRInputSourceSnapshot,
  XRHandJointName,
  XRJointPoseData,
  XRLightEstimate,
  XRPlaneData,
  XRDepthData,
  XRSessionOptions,
  XRSessionInfo,
  WebXRProvider,
  XRSessionHandle,
  XRReferenceSpaceHandle,
  XRFrameHandle,
  XRLightProbeHandle,
  XRRenderStateInit,
  XRSessionEvent,
  WebXREvent,
  WebXREventType,
} from './WebXRTypes';

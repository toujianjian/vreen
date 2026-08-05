// WebXRTypes —— WebXR 模块的类型定义与 Provider 抽象。
//
// 设计参考:
//   * three.js `WebXRManager` / `WebXRController` (src/renderers/webxr/)
//   * W3C WebXR Device API (https://www.w3.org/TR/webxr/)
//   * o3de Atom XR pass + OpenXR 集成思路 (会话生命周期 / 参考空间 / 控制器)
//
// 核心设计原则 —— 与 UI 模块一致:**纯逻辑可测试**。
// 真实 WebXR API (`navigator.xr` / `XRSession` / `XRFrame`) 封装在 `WebXRProvider`
// 接口背后。测试用 `MockWebXRProvider` 注入,生产用 `BrowserWebXRProvider` 包装
// 浏览器原生 API。这样会话状态机、控制器姿态、手势检测、平面跟踪等核心逻辑
// 均可在无 XR 设备的环境下单元测试,不依赖 WebGL。

import type { Vector3, Quaternion, Matrix4 } from '../Math';

// ─── 会话模式 ───────────────────────────────────────────────────────────

/** XR 会话模式 (W3C XRSessionMode)。 */
export type XRSessionMode = 'immersive-vr' | 'immersive-ar' | 'inline';

/** 参考空间类型 (W3C XRReferenceSpaceType)。 */
export type XRReferenceSpaceType =
  | 'viewer'
  | 'local'
  | 'local-floor'
  | 'bounded-floor'
  | 'unbounded';

/** 环境混合模式 (AR 透视/VR 不透明)。 */
export type XREnvironmentBlendMode = 'opaque' | 'additive' | 'alpha-blend';

/** 可见性状态。 */
export type XRVisibilityState = 'visible' | 'visible-blurred' | 'hidden';

/** 手势/输入事件类型。 */
export type XRInputEventType =
  | 'select' | 'selectstart' | 'selectend'
  | 'squeeze' | 'squeezestart' | 'squeezeend'
  | 'connected' | 'disconnected'
  | 'pinchstart' | 'pinchend'
  | 'move';

/** 控制器手性。 */
export type XRHandedness = 'none' | 'left' | 'right';

/** 目标射线模式。 */
export type XRTargetRayMode = 'gaze' | 'tracked-pointer' | 'screen';

// ─── 姿态/变换 ──────────────────────────────────────────────────────────

/** XR 变换 (位置 + 方向 + 线/角速度,可空)。 */
export interface XRTransform {
  position: Vector3;
  orientation: Quaternion;
  linearVelocity?: Vector3 | null;
  angularVelocity?: Vector3 | null;
}

/** 单个视图 (左/右眼) 的姿态与投影。 */
export interface XRViewData {
  eye: 'left' | 'right' | 'none';
  /** 视图变换矩阵 (世界空间 → 视图空间)。 */
  viewMatrix: Matrix4;
  /** 投影矩阵。 */
  projectionMatrix: Matrix4;
  /** 视口 (像素)。 */
  viewport: { x: number; y: number; width: number; height: number };
}

/** 观察者姿态 (头部)。 */
export interface XRViewerPose {
  /** 观察者变换 (世界空间)。 */
  transform: XRTransform;
  /** 各眼视图。 */
  views: XRViewData[];
  /** 是否 emulatePosition (无 6DoF 追踪时为 true)。 */
  emulatePosition: boolean;
}

// ─── 控制器 ─────────────────────────────────────────────────────────────

/** 按钮状态 (W3C XRGamepadButton)。 */
export interface XRButtonState {
  pressed: boolean;
  touched: boolean;
  /** 模拟值 0~1 (扳机/握持)。 */
  value: number;
}

/** 触摸板/拇指摇杆轴。 */
export type XRGamepadAxes = number[];

/** 控制器输入源快照。 */
export interface XRInputSourceSnapshot {
  handedness: XRHandedness;
  targetRayMode: XRTargetRayMode;
  /** 目标射线空间姿态 (世界空间,null=本帧无追踪)。 */
  targetRayPose: XRTransform | null;
  /** 握持空间姿态 (手柄握持位置,null=无)。 */
  gripPose: XRTransform | null;
  /** 游戏手柄按钮 (扳机/握持/触摸板/拇指)。 */
  buttons: XRButtonState[];
  /** 轴。 */
  axes: XRGamepadAxes;
  /** 是否手部追踪。 */
  hand: boolean;
  /** 手部关节姿态 (jointName → transform),仅 hand=true。 */
  handJoints: Map<XRHandJointName, XRJointPoseData>;
  /** 手柄配置文件 (profile URLs),用于模型加载。 */
  profiles: string[];
}

/** 手部关节名 (WebXR Hand Input)。 */
export type XRHandJointName =
  | 'wrist'
  | 'thumb-metacarpal' | 'thumb-phalanx-proximal' | 'thumb-phalanx-distal' | 'thumb-tip'
  | 'index-finger-metacarpal' | 'index-finger-phalanx-proximal'
  | 'index-finger-phalanx-intermediate' | 'index-finger-phalanx-distal' | 'index-finger-tip'
  | 'middle-finger-metacarpal' | 'middle-finger-phalanx-proximal'
  | 'middle-finger-phalanx-intermediate' | 'middle-finger-phalanx-distal' | 'middle-finger-tip'
  | 'ring-finger-metacarpal' | 'ring-finger-phalanx-proximal'
  | 'ring-finger-phalanx-intermediate' | 'ring-finger-phalanx-distal' | 'ring-finger-tip'
  | 'pinky-finger-metacarpal' | 'pinky-finger-phalanx-proximal'
  | 'pinky-finger-phalanx-intermediate' | 'pinky-finger-phalanx-distal' | 'pinky-finger-tip';

/** 手部关节姿态。 */
export interface XRJointPoseData {
  transform: XRTransform;
  /** 关节半径 (米)。 */
  radius: number;
}

// ─── AR 子系统 ──────────────────────────────────────────────────────────

/** 光照估计 (W3C XRLightEstimate)。 */
export interface XRLightEstimate {
  /** 主光强度 (各通道,可 >1)。 */
  primaryLightIntensity: { x: number; y: number; z: number };
  /** 主光方向 (世界空间单位向量)。 */
  primaryLightDirection: Vector3;
  /** 球谐系数 (9 个 RGB = 27 数值)。 */
  sphericalHarmonicsCoefficients: number[];
}

/** 检测到的平面 (W3C XRPlane)。 */
export interface XRPlaneData {
  /** 平面唯一标识。 */
  id: string;
  /** 平面朝向 (水平/垂直)。 */
  orientation: 'horizontal' | 'vertical';
  /** 多边形顶点 (世界空间 XZ/XY,首尾不闭合)。 */
  polygon: Vector3[];
}

/** 深度感知数据 (W3C XRDepthInformation)。 */
export interface XRDepthData {
  /** 深度纹理 (opaque,渲染层解释)。 */
  texture: unknown;
  /** 深度近裁面。 */
  depthNear: number;
  /** 深度远裁面。 */
  depthFar: number;
  /** 原点 (归一化纹理坐标)。 */
  origin: { x: number; y: number };
  /** 深度图尺寸。 */
  width: number;
  height: number;
  /** 每像素的物理尺寸 (米)。 */
  rawValueToMeters: number;
}

// ─── 会话初始化 ─────────────────────────────────────────────────────────

/** 会话请求选项 (W3C XRSessionInit)。 */
export interface XRSessionOptions {
  /** 必需特性 (缺失则请求失败)。 */
  requiredFeatures?: XRReferenceSpaceType[];
  /** 可选特性 (缺失降级)。 */
  optionalFeatures?: string[];
  /** AR 透明度等。 */
  domOverlay?: unknown;
}

/** 会话信息 (请求成功后)。 */
export interface XRSessionInfo {
  mode: XRSessionMode;
  environmentBlendMode: XREnvironmentBlendMode;
  visibilityState: XRVisibilityState;
  /** 启用的特性。 */
  enabledFeatures: string[];
  /** 首选反射格式 (光照估计)。 */
  preferredReflectionFormat?: string;
}

// ─── Provider 抽象 ──────────────────────────────────────────────────────

/**
 * WebXRProvider —— 封装浏览器 `navigator.xr` + `XRSession` + `XRFrame`。
 *
 * 生产环境用 `BrowserWebXRProvider` 包装真实 API;测试注入 `MockWebXRProvider`。
 * 该接口把所有副作用 (DOM/WebGL/设备轮询) 隔离在 Provider 层,
 * WebXRManager / Controller 只消费纯数据快照,保持可测试性。
 */
export interface WebXRProvider {
  /** 浏览器是否支持 WebXR (`'xr' in navigator`)。 */
  readonly available: boolean;

  /** 检测会话模式是否受支持 (异步)。 */
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;

  /** 请求会话 (异步),返回会话句柄。 */
  requestSession(mode: XRSessionMode, options: XRSessionOptions): Promise<XRSessionHandle>;

  /** 提供会话 (设备主动授予,如 VR 头显自动接管)。 */
  offerSession?(mode: XRSessionMode, options: XRSessionOptions): Promise<XRSessionHandle>;
}

/**
 * XRSessionHandle —— 会话句柄 (封装 XRSession 的副作用接口)。
 *
 * 把事件监听 / 参考空间请求 / 渲染状态更新 / 动画帧调度 / 输入源管理 / 结束
 * 等浏览器侧操作抽象成方法,使 WebXRManager 不直接接触 DOM 类型。
 */
export interface XRSessionHandle {
  readonly mode: XRSessionMode;
  readonly environmentBlendMode: XREnvironmentBlendMode;
  readonly visibilityState: XRVisibilityState;
  readonly enabledFeatures: string[];
  readonly preferredReflectionFormat?: string;
  /** 当前输入源快照列表 (每帧由 provider 更新)。 */
  readonly inputSources: readonly XRInputSourceSnapshot[];

  /** 请求参考空间。 */
  requestReferenceSpace(type: XRReferenceSpaceType): Promise<XRReferenceSpaceHandle>;

  /** 更新渲染状态 (深度近/远、baseLayer 等)。 */
  updateRenderState(state: XRRenderStateInit): void;

  /** 请求动画帧 (返回 request id,可通过 cancelAnimationFrame 取消)。 */
  requestAnimationFrame(callback: (time: number, frame: XRFrameHandle) => void): number;
  cancelAnimationFrame(id: number): void;

  /** 请求手柄振动 (haptic pulse)。 */
  hapticPulse?(inputIndex: number, intensity: number, durationMs: number): void;

  /** 请求光探针 (光照估计)。 */
  requestLightProbe?(): Promise<XRLightProbeHandle>;

  /** 结束会话。 */
  end(): Promise<void>;

  /** 事件订阅 (select/squeeze/end/inputsourceschange/visibilitychange 等)。 */
  addEventListener(type: string, listener: (event: XRSessionEvent) => void): void;
  removeEventListener(type: string, listener: (event: XRSessionEvent) => void): void;
}

/** 参考空间句柄。 */
export interface XRReferenceSpaceHandle {
  readonly type: XRReferenceSpaceType;
  /** 边界 (bounded-floor 时为多边形顶点,否则 null)。 */
  readonly bounds?: { x: number; z: number }[] | null;
  /** 原始浏览器 XRReferenceSpace (仅 BrowserWebXRProvider 使用,纯逻辑层忽略)。 */
  readonly raw?: unknown;
  /** 获取偏移参考空间 (用于传送/重定位)。 */
  getOffsetReferenceSpace?(transform: XRTransform): XRReferenceSpaceHandle;
}

/** XRFrame 句柄 (每帧数据快照)。 */
export interface XRFrameHandle {
  readonly session: XRSessionHandle;
  /** 获取观察者姿态。 */
  getViewerPose(referenceSpace: XRReferenceSpaceHandle): XRViewerPose | null;
  /** 获取输入源姿态 (目标射线)。 */
  getTargetRayPose?(inputIndex: number, referenceSpace: XRReferenceSpaceHandle): XRTransform | null;
  /** 获取握持姿态。 */
  getGripPose?(inputIndex: number, referenceSpace: XRReferenceSpaceHandle): XRTransform | null;
  /** 获取手部关节姿态。 */
  getJointPose?(jointName: XRHandJointName, inputIndex: number, referenceSpace: XRReferenceSpaceHandle): XRJointPoseData | null;
  /** 获取光照估计。 */
  getLightEstimate?(probe: XRLightProbeHandle): XRLightEstimate | null;
  /** 本帧检测到的平面 (added/changed/removed 的 id 集合)。 */
  detectedPlanes?: {
    added: XRPlaneData[];
    changed: XRPlaneData[];
    removed: string[];
    /** 全部已知平面。 */
    all: ReadonlyMap<string, XRPlaneData>;
  };
  /** 本帧深度数据 (AR depth-sensing)。 */
  depthInformation?: XRDepthData | null;
}

/** 光探针句柄。 */
export interface XRLightProbeHandle {
  addEventListener(type: 'reflectionchange', listener: () => void): void;
  removeEventListener(type: 'reflectionchange', listener: () => void): void;
}

/** 渲染状态初始化 (depthNear/depthFar/baseLayer/layers)。 */
export interface XRRenderStateInit {
  depthNear?: number;
  depthFar?: number;
  baseLayer?: unknown;
  layers?: unknown[];
  inlineVerticalFieldOfView?: number;
}

/** 会话事件 (select/squeeze/end/inputsourceschange/visibilitychange)。 */
export interface XRSessionEvent {
  type: string;
  /** 输入源索引 (select/squeeze 事件)。 */
  inputIndex?: number;
  /** 输入源快照 (连接/断开)。 */
  inputSource?: XRInputSourceSnapshot;
  visibilityState?: XRVisibilityState;
}

// ─── 管理器事件 ─────────────────────────────────────────────────────────

/** WebXRManager 派发的事件类型。 */
export type WebXREventType =
  | 'sessionstart' | 'sessionend'
  | 'visibilitychange'
  | 'inputsourceschange'
  | 'planesdetected'
  | 'lightestimate'
  | 'depthsensing'
  | 'requestfailed';

/** WebXRManager 事件。 */
export interface WebXREvent {
  type: WebXREventType;
  session?: XRSessionInfo;
  visibilityState?: XRVisibilityState;
  /** 错误 (requestfailed)。 */
  error?: Error;
  /** 检测到的平面增量。 */
  planes?: { added: XRPlaneData[]; changed: XRPlaneData[]; removed: string[] };
  /** 光照估计。 */
  lightEstimate?: XRLightEstimate | null;
  /** 深度数据。 */
  depth?: XRDepthData | null;
}

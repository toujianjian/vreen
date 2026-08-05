// WebXRManager —— XR 会话管理器 (生命周期 / 参考空间 / 帧循环 / 控制器注册表)。
//
// 适配自 three.js `WebXRManager` (src/renderers/webxr/WebXRManager.js)。
// three.js 把 WebXRManager 嵌入 WebGLRenderer (直接操作 FBO/层/纹理),与渲染强耦合;
// VREEN 改为「数据驱动 + 渲染解耦」:每帧通过 `onFrame` 回调把 viewer pose / 视图矩阵 /
// 控制器姿态以纯数据形式交给渲染层,渲染层据此设置 ArrayCamera/视口/层掩码。
// 这样核心会话状态机可在无 WebGL 环境下测试 (注入 MockWebXRProvider)。
//
// 职责 (参考 three.js + o3de Atom XR pass):
//   1. 会话请求/启动/结束 (requestSession → setSession → end)。
//   2. 参考空间管理 (默认 local-floor,支持自定义偏移用于传送)。
//   3. 帧循环协调 (requestAnimationFrame,每帧提取 viewer pose + 更新控制器)。
//   4. 控制器注册表 (getController / getControllerGrip / getHand,按需创建)。
//   5. 输入源变更 (inputsourceschange → connect/disconnect 控制器)。
//   6. foveation (注视点渲染,渲染层读取 setFoveation 值)。
//   7. AR 子系统钩子 (平面检测 / 光照估计 / 深度感知,派发事件)。
//   8. 可见性变更 (visibilitychange,头显摘下时暂停渲染)。

import { WebXRController } from './WebXRController';
import type {
  WebXRProvider,
  XRSessionHandle,
  XRReferenceSpaceHandle,
  XRFrameHandle,
  XRViewerPose,
  XRSessionMode,
  XRSessionOptions,
  XRReferenceSpaceType,
  XREnvironmentBlendMode,
  XRVisibilityState,
  XRSessionInfo,
  XRInputSourceSnapshot,
  WebXREvent,
  WebXREventType,
  XRSessionEvent,
  XRLightProbeHandle,
  XRLightEstimate,
  XRPlaneData,
  XRDepthData,
} from './WebXRTypes';

/** WebXRManager 事件监听器。 */
export type WebXRManagerListener = (event: WebXREvent) => void;

/** WebXRManager 配置。 */
export interface WebXRManagerOptions {
  /** 默认参考空间类型 (default: 'local-floor')。 */
  referenceSpaceType?: XRReferenceSpaceType;
  /** 帧缓冲缩放因子 (default: 1.0)。 */
  framebufferScaleFactor?: number;
  /** 注视点渲染 (0=全分辨率,1=最大边缘降采样,default: 1.0)。 */
  foveation?: number;
}

/** 每帧回调数据 (传给渲染层)。 */
export interface WebXRFrameData {
  /** 观察者姿态 (null=本帧无追踪)。 */
  viewerPose: XRViewerPose | null;
  /** 当前时间戳 (ms)。 */
  time: number;
  /** 原始 XRFrame 句柄 (渲染层可查询深度/光照等)。 */
  frame: XRFrameHandle;
}

const DEFAULT_OPTIONS: Required<WebXRManagerOptions> = {
  referenceSpaceType: 'local-floor',
  framebufferScaleFactor: 1.0,
  foveation: 1.0,
};

/**
 * WebXRManager —— XR 会话管理器。
 *
 * ```ts
 * const manager = new WebXRManager(provider);
 * manager.setAnimationLoop((time, frame, viewerPose) => {
 *   // 渲染层:用 viewerPose.views 设置 ArrayCamera
 * });
 * // 进入 VR
 * await manager.startSession('immersive-vr', { optionalFeatures: ['local-floor','layers'] });
 * // 控制器
 * const ctrl = manager.getController(0);
 * ctrl.addEventListener('selectstart', () => { ... });
 * ```
 */
export class WebXRManager {
  /** XR 能力 Provider (生产=浏览器,测试=Mock)。 */
  readonly provider: WebXRProvider;

  /** 是否启用 XR (渲染层据此跳过常规渲染)。 */
  enabled: boolean = false;

  /** 是否正在呈现 (会话激活中)。 */
  isPresenting: boolean = false;

  /** 是否自动更新 XR 摄像机 (false 时需手动调 updateCamera)。 */
  cameraAutoUpdate: boolean = true;

  private opts: Required<WebXRManagerOptions>;

  /** 当前会话句柄 (null=未启动)。 */
  private session: XRSessionHandle | null = null;
  /** 参考空间。 */
  private referenceSpace: XRReferenceSpaceHandle | null = null;
  /** 自定义偏移参考空间 (传送/重定位用)。 */
  private customReferenceSpace: XRReferenceSpaceHandle | null = null;
  /** 当前帧句柄。 */
  private currentFrame: XRFrameHandle | null = null;

  /** 控制器注册表 (按 index)。 */
  private controllers: WebXRController[] = [];
  /** 输入源 → 控制器 index 映射 (按输入源引用)。 */
  private inputSourceIndex: (XRInputSourceSnapshot | null)[] = [];

  /** 帧动画 id。 */
  private rafId: number | null = null;
  /** 用户帧回调。 */
  private frameCallback: ((time: number, frame: XRFrameHandle, viewerPose: XRViewerPose | null) => void) | null = null;

  /** 事件监听器。 */
  private listeners: Map<WebXREventType, Set<WebXRManagerListener>> = new Map();

  /** AR 光探针 (光照估计)。 */
  private lightProbe: XRLightProbeHandle | null = null;
  /** 已知平面 (平面检测)。 */
  private knownPlanes: Map<string, XRPlaneData> = new Map();

  constructor(provider: WebXRProvider, options?: WebXRManagerOptions) {
    this.provider = provider;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  // ─── 配置 ──────────────────────────────────────────────────────────

  /** 设置帧缓冲缩放因子 (会话中不可改)。 */
  setFramebufferScaleFactor(value: number): void {
    this.opts.framebufferScaleFactor = value;
  }

  /** 设置参考空间类型 (会话启动前)。 */
  setReferenceSpaceType(type: XRReferenceSpaceType): void {
    this.opts.referenceSpaceType = type;
  }

  /** 获取参考空间类型。 */
  getReferenceSpaceType(): XRReferenceSpaceType {
    return this.opts.referenceSpaceType;
  }

  /** 设置注视点渲染值 (0=全分辨率,1=最大降采样)。 */
  setFoveation(value: number): void {
    this.opts.foveation = value;
  }

  /** 获取注视点值。 */
  getFoveation(): number {
    return this.opts.foveation;
  }

  // ─── 会话 ──────────────────────────────────────────────────────────

  /** 是否支持某会话模式。 */
  isSessionSupported(mode: XRSessionMode): Promise<boolean> {
    if (!this.provider.available) return Promise.resolve(false);
    return this.provider.isSessionSupported(mode);
  }

  /** 获取当前会话句柄 (null=未启动)。 */
  getSession(): XRSessionHandle | null {
    return this.session;
  }

  /** 获取环境混合模式。 */
  getEnvironmentBlendMode(): XREnvironmentBlendMode | undefined {
    return this.session?.environmentBlendMode;
  }

  /** 获取可见性状态。 */
  getVisibilityState(): XRVisibilityState | undefined {
    return this.session?.visibilityState;
  }

  /** 获取参考空间 (优先自定义偏移空间)。 */
  getReferenceSpace(): XRReferenceSpaceHandle | null {
    return this.customReferenceSpace ?? this.referenceSpace;
  }

  /** 设置自定义参考空间 (传送/重定位)。 */
  setReferenceSpace(space: XRReferenceSpaceHandle): void {
    this.customReferenceSpace = space;
  }

  /**
   * 启动 XR 会话。
   * 请求会话 → 设置事件监听 → 请求参考空间 → 启动帧循环。
   */
  async startSession(mode: XRSessionMode, options?: XRSessionOptions): Promise<void> {
    if (!this.provider.available) {
      this.dispatch({ type: 'requestfailed', error: new Error('WebXR not available') });
      throw new Error('WebXR not available');
    }
    if (this.isPresenting) {
      throw new Error('XR session already active');
    }

    let handle: XRSessionHandle;
    try {
      handle = await this.provider.requestSession(mode, {
        optionalFeatures: ['local-floor', 'bounded-floor', 'layers'],
        ...options,
      });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.dispatch({ type: 'requestfailed', error: e });
      throw e;
    }

    await this.setSession(handle);
  }

  /**
   * 注入会话句柄 (启动实际 XR 渲染)。
   * 适配 three.js `setSession`:注册事件 → 请求参考空间 → 启动帧循环。
   */
  async setSession(handle: XRSessionHandle | null): Promise<void> {
    if (handle === null) {
      // 结束会话由 end() 处理。
      return;
    }

    this.session = handle;
    this.enabled = true;

    // 事件监听。
    handle.addEventListener('end', this.onSessionEnd);
    handle.addEventListener('visibilitychange', this.onVisibilityChange);
    handle.addEventListener('inputsourceschange', this.onInputSourcesChange);

    // 请求参考空间。
    try {
      this.referenceSpace = await handle.requestReferenceSpace(this.opts.referenceSpaceType);
    } catch {
      // 降级到 local (immersive 会话始终支持 local)。
      this.referenceSpace = await handle.requestReferenceSpace('local');
    }
    this.customReferenceSpace = null;

    this.isPresenting = true;
    this.dispatch({ type: 'sessionstart', session: this.toSessionInfo(handle) });

    // 启动帧循环。
    this.startFrameLoop();
  }

  /** 结束会话。 */
  async end(): Promise<void> {
    if (this.session) {
      await this.session.end();
    }
  }

  /** 会话结束回调 (provider 触发 end 事件)。 */
  private onSessionEnd = (): void => {
    const handle = this.session;
    if (!handle) return;

    handle.removeEventListener('end', this.onSessionEnd);
    handle.removeEventListener('visibilitychange', this.onVisibilityChange);
    handle.removeEventListener('inputsourceschange', this.onInputSourcesChange);

    // 断开所有控制器。
    for (let i = 0; i < this.controllers.length; i++) {
      if (this.inputSourceIndex[i]) {
        this.controllers[i].disconnect();
        this.inputSourceIndex[i] = null;
      }
    }

    // 重置 AR 子系统。
    this.lightProbe = null;
    this.knownPlanes.clear();

    this.stopFrameLoop();
    this.session = null;
    this.referenceSpace = null;
    this.customReferenceSpace = null;
    this.isPresenting = false;
    this.enabled = false;

    this.dispatch({ type: 'sessionend' });
  };

  /** 可见性变更回调。 */
  private onVisibilityChange = (event: XRSessionEvent): void => {
    this.dispatch({ type: 'visibilitychange', visibilityState: event.visibilityState });
  };

  // ─── 控制器 ─────────────────────────────────────────────────────────

  /** 获取/创建控制器 (按 index)。 */
  private ensureController(index: number): WebXRController {
    let c = this.controllers[index];
    if (!c) {
      c = new WebXRController();
      this.controllers[index] = c;
    }
    return c;
  }

  /** 获取控制器的目标射线空间。 */
  getController(index: number): WebXRController {
    return this.ensureController(index);
  }

  /** 获取控制器的握持空间控制器。 */
  getControllerGrip(index: number): WebXRController {
    return this.ensureController(index);
  }

  /** 获取控制器的手部空间控制器。 */
  getHand(index: number): WebXRController {
    return this.ensureController(index);
  }

  /** 所有控制器。 */
  getControllers(): readonly WebXRController[] {
    return this.controllers;
  }

  /** 输入源变更回调。 */
  private onInputSourcesChange = (_event: XRSessionEvent): void => {
    const handle = this.session;
    if (!handle) return;

    // 这里通过 session.inputSources 重新同步 (provider 在事件后更新该列表)。
    this.syncInputSources(handle.inputSources);
    this.dispatch({ type: 'inputsourceschange' });
  };

  /**
   * 同步输入源列表 (连接新增 / 断开移除)。
   * 适配 three.js `onInputSourcesChange`:把输入源分配到空闲控制器槽位。
   */
  syncInputSources(sources: readonly XRInputSourceSnapshot[]): void {
    // 标记当前已断开的槽位。
    const currentSlots = [...this.inputSourceIndex];

    // 断开已移除的输入源。
    for (let i = 0; i < currentSlots.length; i++) {
      const src = currentSlots[i];
      if (src && !sources.includes(src)) {
        this.controllers[i]?.disconnect();
        this.inputSourceIndex[i] = null;
      }
    }

    // 连接新增的输入源到空闲槽位。
    for (const src of sources) {
      if (this.inputSourceIndex.includes(src)) continue;

      let assigned = -1;
      for (let i = 0; i < this.controllers.length; i++) {
        if (i >= this.inputSourceIndex.length) {
          this.inputSourceIndex.push(src);
          assigned = i;
          break;
        } else if (this.inputSourceIndex[i] === null) {
          this.inputSourceIndex[i] = src;
          assigned = i;
          break;
        }
      }
      if (assigned === -1) break;

      this.ensureController(assigned).connect(src);
    }
  }

  /** 获取输入源对应的控制器索引。 */
  getControllerIndexForInputSource(src: XRInputSourceSnapshot): number {
    return this.inputSourceIndex.indexOf(src);
  }

  // ─── 帧循环 ─────────────────────────────────────────────────────────

  /** 设置动画帧回调 (渲染层每帧调用)。 */
  setAnimationLoop(cb: ((time: number, frame: XRFrameHandle, viewerPose: XRViewerPose | null) => void) | null): void {
    this.frameCallback = cb;
  }

  /** 启动帧循环。 */
  private startFrameLoop(): void {
    const session = this.session;
    if (!session) return;

    const loop = (time: number, frame: XRFrameHandle): void => {
      this.onAnimationFrame(time, frame);
    };
    this.rafId = session.requestAnimationFrame(loop);
  }

  /** 每帧处理 (提取 viewer pose + 更新控制器 + AR 子系统)。 */
  private onAnimationFrame(time: number, frame: XRFrameHandle): void {
    const session = this.session;
    if (!session || !this.isPresenting) return;

    this.currentFrame = frame;
    const refSpace = this.customReferenceSpace ?? this.referenceSpace;

    // 提取 viewer pose。
    let viewerPose: XRViewerPose | null = null;
    if (refSpace) {
      viewerPose = frame.getViewerPose(refSpace);
    }

    // 更新控制器 (从 session.inputSources 快照)。
    // 注意:provider 应在每帧 requestAnimationFrame 前更新 inputSources。
    const sources = session.inputSources;
    for (let i = 0; i < this.inputSourceIndex.length; i++) {
      const src = this.inputSourceIndex[i];
      const ctrl = this.controllers[i];
      if (src && ctrl) {
        // 找到对应快照 (引用匹配)。
        const snap = sources.find((s) => s === src) ?? null;
        ctrl.update(snap);
      }
    }

    // AR: 平面检测。
    if (frame.detectedPlanes) {
      this.handlePlanes(frame.detectedPlanes);
    }

    // AR: 深度感知。
    if (frame.depthInformation !== undefined) {
      this.dispatch({ type: 'depthsensing', depth: frame.depthInformation ?? null });
    }

    // 用户帧回调。
    this.frameCallback?.(time, frame, viewerPose);

    // 继续下一帧。
    this.rafId = session.requestAnimationFrame((t, f) => this.onAnimationFrame(t, f));
  }

  /** 停止帧循环。 */
  private stopFrameLoop(): void {
    if (this.rafId !== null && this.session) {
      this.session.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.currentFrame = null;
  }

  // ─── AR 子系统 ──────────────────────────────────────────────────────

  /** 启用光照估计 (AR)。 */
  async enableLightEstimation(): Promise<XRLightProbeHandle | null> {
    const session = this.session;
    if (!session?.requestLightProbe) return null;
    this.lightProbe = await session.requestLightProbe();
    return this.lightProbe;
  }

  /** 获取当前光照估计 (每帧调用)。 */
  getLightEstimate(): XRLightEstimate | null {
    if (!this.lightProbe || !this.currentFrame?.getLightEstimate) return null;
    return this.currentFrame.getLightEstimate(this.lightProbe);
  }

  /** 处理平面检测增量。 */
  private handlePlanes(detected: NonNullable<XRFrameHandle['detectedPlanes']>): void {
    // 更新已知平面。
    for (const p of detected.added) this.knownPlanes.set(p.id, p);
    for (const p of detected.changed) this.knownPlanes.set(p.id, p);
    for (const id of detected.removed) this.knownPlanes.delete(id);

    this.dispatch({
      type: 'planesdetected',
      planes: {
        added: detected.added,
        changed: detected.changed,
        removed: detected.removed,
      },
    });
  }

  /** 获取所有已知平面。 */
  getPlanes(): ReadonlyMap<string, XRPlaneData> {
    return this.knownPlanes;
  }

  /** 获取深度数据 (AR)。 */
  getDepthData(): XRDepthData | null | undefined {
    return this.currentFrame?.depthInformation;
  }

  /** 是否有深度感知。 */
  hasDepthSensing(): boolean {
    return this.currentFrame?.depthInformation != null;
  }

  // ─── 事件 ──────────────────────────────────────────────────────────

  /** 添加事件监听。 */
  addEventListener(type: WebXREventType, listener: WebXRManagerListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  /** 移除事件监听。 */
  removeEventListener(type: WebXREventType, listener: WebXRManagerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** 派发事件。 */
  private dispatch(event: WebXREvent): void {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
  }

  // ─── 工具 ──────────────────────────────────────────────────────────

  /** 转换会话句柄为会话信息。 */
  private toSessionInfo(handle: XRSessionHandle): XRSessionInfo {
    return {
      mode: handle.mode,
      environmentBlendMode: handle.environmentBlendMode,
      visibilityState: handle.visibilityState,
      enabledFeatures: handle.enabledFeatures,
      preferredReflectionFormat: handle.preferredReflectionFormat,
    };
  }

  /** 释放资源。 */
  dispose(): void {
    if (this.isPresenting) {
      this.end();
    }
    this.listeners.clear();
  }
}

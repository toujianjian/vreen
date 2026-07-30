// VRController — WebXR VR/XR 支持系统(手柄追踪 + 双眼渲染位姿提取)。
//
// 设计目标:
//   - 封装 WebXR Device API 的会话生命周期(requestSession / endSession),
//     把浏览器原生 XRSession / XRFrame / XRView 翻译为引擎强类型数据
//     (Matrix4 / Vector3 / Quaternion),让渲染层不必直接碰 DOM 类型;
//   - update(frame) 在每帧渲染前调用,从 XRFrame 抽取:
//       1) 头显(viewer)位姿 → headsetPose;
//       2) 双眼视图参数 → leftEye / rightEye(projectionMatrix + viewMatrix
//          + viewport);
//       3) 输入手柄位姿 → controllers[](gripMatrix / targetRayMatrix
//          + buttons + axes);
//   - 非浏览器环境(测试 / SSR / 无 navigator.xr)优雅降级:
//     isSupported=false,update() 静默返回,不抛错;
//   - 不直接持有 WebGL 上下文 / GL 资源;XRLayer 由调用方(Renderer)管理。
//
// 与 OrbitControls 的关系:
//   - OrbitControls 是非沉浸式(桌面鼠标 / 触屏)相机控制器;
//   - VRController 是沉浸式(WebXR)输入 + 双目视图源,二者互斥使用,
//     调用方决定在 VR 会话期间禁用 OrbitControls;
//   - VRController 不修改任何 Camera 实例,只产出 eye 参数,由 Renderer
//     在双眼 pass 中分别套用。
//
// WebXR API 参考:https://immersive-web.github.io/webxr/
//   - navigator.xr.isSessionSupported(mode)
//   - navigator.xr.requestSession(mode, opts)
//   - session.requestReferenceSpace(type)
//   - session.inputSources (XRInputSource[])
//   - session.addEventListener('end', cb)
//   - frame.getViewerPose(space) -> XRViewerPose
//   - frame.getPose(space, baseSpace) -> XRPose
//   - XRViewerPose.views: XRView[] { eye, transform.matrix, projectionMatrix }
//   - XRWebGLLayer.getViewport(view) -> { x, y, width, height }

import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { createLogger } from '@/lib/logger';

const log = createLogger('VRController');

/** WebXR 参考空间类型。 */
export type XRReferenceSpaceType =
  | 'local'
  | 'local-floor'
  | 'viewer'
  | 'bounded-floor';

/** 单眼视图参数(projection + view + viewport)。 */
export interface VREyeParams {
  /** 投影矩阵(列主序 4x4,与 Matrix4.elements 同布局)。 */
  projectionMatrix: Matrix4;
  /** 视图矩阵(相机世界变换的逆)。 */
  viewMatrix: Matrix4;
  /** 该眼在画布上的视口(像素)。 */
  viewport: { x: number; y: number; w: number; h: number };
}

/** VR 手柄状态。 */
export interface VRHandController {
  /** 手别。 */
  hand: 'left' | 'right' | 'none';
  /** 手柄位姿(世界空间)。 */
  pose: { position: Vector3; rotation: Quaternion };
  /** 按钮按下状态(每个按钮 boolean)。 */
  buttons: boolean[];
  /** 模拟轴值(触控板 / 摇杆)。 */
  axes: number[];
  /** 握持矩阵(列主序 4x4,用于模型变换)。 */
  gripMatrix: Matrix4;
  /** 射线矩阵(列主序 4x4,指示指向方向)。 */
  targetRayMatrix: Matrix4;
}

/** VR 控制器统计。 */
export interface VRControllerStats {
  isSupported: boolean;
  isPresenting: boolean;
  referenceSpace: XRReferenceSpaceType;
  controllerCount: number;
  frameRate: number;
  hasHeadsetPose: boolean;
  sessionActive: boolean;
}

/** WebXR session 选项(透传给 navigator.xr.requestSession)。 */
export interface VRSessionOptions {
  /** 要求的参考空间类型。默认 'local-floor'。 */
  referenceSpace?: XRReferenceSpaceType;
  /** 必需特性(如 'local-floor' / 'bounded-floor')。 */
  requiredFeatures?: string[];
  /** 可选特性(如 'hand-tracking')。 */
  optionalFeatures?: string[];
}

/** 头显位姿。 */
export interface VRHeadsetPose {
  position: Vector3;
  rotation: Quaternion;
}

/** Float32Array(16) → Matrix4 的辅助。WebXR 矩阵是列主序,与引擎 Matrix4 一致。 */
function mat4FromArray(arr: ArrayLike<number>, out: Matrix4): Matrix4 {
  const e = out.elements;
  for (let i = 0; i < 16 && i < arr.length; i++) e[i] = arr[i];
  return out;
}

/** 从 4x4 列主序矩阵分解出平移与旋转(上 3x3 为旋转部分)。 */
function decomposeMat4(
  m: Matrix4,
  outPos: Vector3,
  outQuat: Quaternion,
): void {
  const e = m.elements;
  // 平移:第 4 列 (e[12], e[13], e[14])
  outPos.set(e[12], e[13], e[14]);
  // 旋转:取左上 3x3,转四元数
  // 标准 column-major → row-major 3x3:
  //   m00=e[0] m01=e[4] m02=e[8]
  //   m10=e[1] m11=e[5] m12=e[9]
  //   m20=e[2] m21=e[6] m22=e[10]
  const m00 = e[0], m01 = e[4], m02 = e[8];
  const m10 = e[1], m11 = e[5], m12 = e[9];
  const m20 = e[2], m21 = e[6], m22 = e[10];
  // trace = m00 + m11 + m22
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2; // s = 4 * qw
    outQuat.w = 0.25 * s;
    outQuat.x = (m21 - m12) / s;
    outQuat.y = (m02 - m20) / s;
    outQuat.z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2; // s = 4 * qx
    outQuat.w = (m21 - m12) / s;
    outQuat.x = 0.25 * s;
    outQuat.y = (m01 + m10) / s;
    outQuat.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2; // s = 4 * qy
    outQuat.w = (m02 - m20) / s;
    outQuat.x = (m01 + m10) / s;
    outQuat.y = 0.25 * s;
    outQuat.z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2; // s = 4 * qz
    outQuat.w = (m10 - m01) / s;
    outQuat.x = (m02 + m20) / s;
    outQuat.y = (m12 + m21) / s;
    outQuat.z = 0.25 * s;
  }
  outQuat.normalize();
}

/**
 * WebXR VR/XR 控制器。
 *
 * 用法:
 *   const vr = new VRController();
 *   if (!vr.isAvailable()) return;
 *   await vr.requestSession({ referenceSpace: 'local-floor' });
 *   // 每帧:
 *   vr.update(xrFrame);
 *   const left = vr.getEyeParams('left');
 *   renderer.renderEye(scene, left.projectionMatrix, left.viewMatrix, left.viewport);
 *   // 退出:
 *   vr.endSession();
 */
export class VRController {
  /** 是否支持 VR(检查 navigator.xr.isSessionSupported)。 */
  isSupported: boolean = false;
  /** 当前 XRSession(运行时为浏览器原生对象)。null = 未开会话。 */
  session: XRSession | null = null;
  /** 参考空间类型字符串。 */
  referenceSpace: XRReferenceSpaceType = 'local-floor';
  /** 实际 XRReferenceSpace 对象(由 session.requestReferenceSpace 返回)。 */
  protected _referenceSpaceObj: XRReferenceSpace | null = null;
  /** XRWebGLLayer(由调用方设置,用于 getViewport)。 */
  protected _baseLayer: XRWebGLLayer | null = null;

  /** 左眼视图参数。 */
  leftEye: VREyeParams = {
    projectionMatrix: new Matrix4(),
    viewMatrix: new Matrix4(),
    viewport: { x: 0, y: 0, w: 0, h: 0 },
  };
  /** 右眼视图参数。 */
  rightEye: VREyeParams = {
    projectionMatrix: new Matrix4(),
    viewMatrix: new Matrix4(),
    viewport: { x: 0, y: 0, w: 0, h: 0 },
  };

  /** 手柄列表。 */
  controllers: VRHandController[] = [];
  /** 头显位姿(世界空间)。 */
  headsetPose: VRHeadsetPose = {
    position: new Vector3(),
    rotation: new Quaternion(),
  };

  /** 推荐帧率(session.preferredReflectionFormat / 估算)。 */
  frameRate: number = 0;
  /** 是否正在 VR 呈现(session 处于 active)。 */
  isPresenting: boolean = false;

  /** 会话结束回调列表。 */
  protected _onSessionEndCallbacks: Array<() => void> = [];
  /** session 'end' 事件监听器(用于 dispose 时移除)。 */
  protected _sessionEndHandler: ((e: XRSessionEvent) => void) | null = null;

  /** 临时矩阵(避免每帧分配)。 */
  protected _tmpMat = new Matrix4();

  constructor() {
    this.isSupported = this._detectSupport();
    log.debug(`constructed, isSupported=${this.isSupported}`);
  }

  // ── WebXR 可用性 ──────────────────────────────────────────────────

  /** 检查 WebXR 是否可用(navigator.xr 存在)。同步返回。 */
  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && navigator.xr != null;
  }

  /**
   * 异步检测是否支持 immersive-vr。
   * 同步结果立即写入 isSupported;异步结果在 Promise resolve 后更新。
   */
  protected _detectSupport(): boolean {
    if (!this.isAvailable()) return false;
    // 异步刷新(不阻塞构造)
    try {
      const xr = navigator.xr;
      if (!xr) return false;
      const p = xr.isSessionSupported('immersive-vr');
      if (p && typeof (p as Promise<boolean>).then === 'function') {
        (p as Promise<boolean>)
          .then((ok) => {
            this.isSupported = !!ok;
          })
          .catch(() => {
            this.isSupported = false;
          });
      }
    } catch {
      return false;
    }
    // 乐观假设支持,异步纠正
    return true;
  }

  // ── 会话生命周期 ──────────────────────────────────────────────────

  /**
   * 请求 VR 会话。
   * @returns Promise<boolean> 是否成功
   */
  async requestSession(options: VRSessionOptions = {}): Promise<boolean> {
    if (!this.isAvailable()) {
      log.warn('requestSession: WebXR not available');
      return false;
    }
    const xr = navigator.xr;
    if (!xr) {
      log.warn('requestSession: navigator.xr gone');
      return false;
    }
    const refSpace: XRReferenceSpaceType = options.referenceSpace ?? 'local-floor';
    this.referenceSpace = refSpace;

    const sessionOpts: XRSessionInit = {
      requiredFeatures: options.requiredFeatures ?? [refSpace],
      optionalFeatures: options.optionalFeatures ?? [],
    };

    try {
      const session = await xr.requestSession('immersive-vr', sessionOpts);
      this.session = session;
      this.isPresenting = true;

      // 请求参考空间
      this._referenceSpaceObj = await session.requestReferenceSpace(refSpace);

      // 监听会话结束(用户摘下头显 / 系统退出)
      this._sessionEndHandler = () => {
        this._handleSessionEnded();
      };
      session.addEventListener('end', this._sessionEndHandler);

      // 读取推荐帧率(WebXR 没有标准 frameRate 字段,这里取 display refresh 估算)
      this.frameRate = this._estimateFrameRate();

      // 初始化手柄占位(实际手柄在 update() 中从 inputSources 同步)
      // XRInputSourceArray 不是真 Array,先转成 Array 才能用 map/find。
      this._syncControllers(Array.from(session.inputSources));

      log.info(`VR session started, refSpace=${refSpace}`);
      return true;
    } catch (err) {
      log.error('requestSession failed:', err);
      this.isPresenting = false;
      return false;
    }
  }

  /** 结束 VR 会话。 */
  endSession(): void {
    if (this.session) {
      try {
        // end() 返回 Promise,但不等待 — 调用方通常不需要 await
        const r = this.session.end();
        if (r && typeof (r as Promise<void>).then === 'function') {
          (r as Promise<void>).catch(() => {
            /* ignore */
          });
        }
      } catch {
        /* ignore */
      }
    }
    this._handleSessionEnded();
  }

  /** 会话实际结束时的清理(session.end 触发或主动调用)。 */
  protected _handleSessionEnded(): void {
    this.session = null;
    this._referenceSpaceObj = null;
    this._baseLayer = null;
    this.isPresenting = false;
    this.frameRate = 0;
    this.controllers = [];
    // 重置头显 / 眼睛参数
    this.leftEye.projectionMatrix.identity();
    this.leftEye.viewMatrix.identity();
    this.rightEye.projectionMatrix.identity();
    this.rightEye.viewMatrix.identity();
    this.headsetPose.position.set(0, 0, 0);
    this.headsetPose.rotation.identity();
    // 触发回调
    const cbs = this._onSessionEndCallbacks.slice();
    this._onSessionEndCallbacks = [];
    for (const cb of cbs) cb();
    log.info('VR session ended');
  }

  /** 设置参考空间(运行时切换)。 */
  async setReferenceSpace(space: XRReferenceSpaceType): Promise<boolean> {
    this.referenceSpace = space;
    if (this.session) {
      try {
        this._referenceSpaceObj = await this.session.requestReferenceSpace(space);
        return true;
      } catch (err) {
        log.error('setReferenceSpace failed:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * 设置 XRWebGLLayer(由 Renderer 创建,用于 getViewport)。
   * session.updateRenderState({ baseLayer }) 也由此触发。
   */
  setBaseLayer(layer: XRWebGLLayer | null): void {
    this._baseLayer = layer;
    if (this.session && layer) {
      try {
        this.session.updateRenderState({ baseLayer: layer });
      } catch {
        /* ignore */
      }
    }
  }

  // ── 手柄查询 ──────────────────────────────────────────────────────

  /** 获取指定手别的手柄(无则返回 null)。 */
  getController(hand: 'left' | 'right'): VRHandController | null {
    return (
      this.controllers.find((c) => c.hand === hand) ?? null
    );
  }

  /** 获取所有手柄(浅拷贝)。 */
  getControllers(): VRHandController[] {
    return this.controllers.slice();
  }

  // ── 头显 / 眼睛查询 ────────────────────────────────────────────────

  /** 获取头显位姿(引用,不拷贝)。 */
  getHeadsetPose(): VRHeadsetPose {
    return this.headsetPose;
  }

  /**
   * 获取眼睛参数。
   * @param eye 'left' | 'right'
   */
  getEyeParams(eye: 'left' | 'right'): VREyeParams {
    return eye === 'left' ? this.leftEye : this.rightEye;
  }

  /** 获取投影矩阵。 */
  getProjectionMatrix(eye: 'left' | 'right'): Matrix4 {
    return (eye === 'left' ? this.leftEye : this.rightEye).projectionMatrix;
  }

  /** 获取视图矩阵。 */
  getViewMatrix(eye: 'left' | 'right'): Matrix4 {
    return (eye === 'left' ? this.leftEye : this.rightEye).viewMatrix;
  }

  /** 获取视口。 */
  getViewport(eye: 'left' | 'right'): { x: number; y: number; w: number; h: number } {
    return (eye === 'left' ? this.leftEye : this.rightEye).viewport;
  }

  /** 是否正在 VR 呈现。 */
  isPresentingVR(): boolean {
    return this.isPresenting;
  }

  /** 获取推荐帧率。 */
  getFrameRate(): number {
    return this.frameRate;
  }

  // ── 每帧更新 ──────────────────────────────────────────────────────

  /**
   * 每帧由渲染循环调用,从 XRFrame 提取位姿 / 视图 / 手柄。
   * @param frame XRFrame(navigator.xr.requestAnimationFrame 回调参数)
   * @returns 是否成功更新(无 session / 无 pose 时返回 false)
   */
  update(frame: XRFrame): boolean {
    if (!this.session || !this._referenceSpaceObj) return false;

    // 1. Viewer pose(头显 + 双眼)
    let pose: XRViewerPose | undefined;
    try {
      pose = frame.getViewerPose(this._referenceSpaceObj);
    } catch (err) {
      log.warn('getViewerPose failed:', err);
      return false;
    }
    if (!pose) return false;

    // 头显位姿:pose.transform.matrix 是头显在参考空间中的世界变换
    mat4FromArray(pose.transform.matrix, this._tmpMat);
    decomposeMat4(this._tmpMat, this.headsetPose.position, this.headsetPose.rotation);

    // 双眼视图
    const views = pose.views ?? [];
    for (const view of views) {
      const target = view.eye === 'left' ? this.leftEye : this.rightEye;
      if (view.projectionMatrix) {
        mat4FromArray(view.projectionMatrix, target.projectionMatrix);
      }
      if (view.transform?.matrix) {
        // view.transform.matrix 是视图矩阵(相机世界变换的逆)
        mat4FromArray(view.transform.matrix, target.viewMatrix);
      }
      if (this._baseLayer) {
        try {
          const vp = this._baseLayer.getViewport(view);
          if (vp) {
            target.viewport.x = vp.x;
            target.viewport.y = vp.y;
            target.viewport.w = vp.width;
            target.viewport.h = vp.height;
          }
        } catch {
          /* viewport may not be ready */
        }
      }
    }

    // 2. 手柄
    // XRInputSourceArray 不是真 Array,先转成 Array 才能用 find/map。
    const inputs = Array.from(this.session.inputSources);
    this._syncControllers(inputs);
    for (const ctrl of this.controllers) {
      const input = inputs.find((i) => i.handedness === ctrl.hand);
      if (!input) continue;
      // gamepad
      if (input.gamepad) {
        ctrl.buttons = (input.gamepad.buttons ?? []).map((b) => !!(b && b.pressed));
        ctrl.axes = Array.from(input.gamepad.axes ?? []);
      }
      // gripMatrix
      if (input.gripSpace) {
        try {
          const gp = frame.getPose(input.gripSpace, this._referenceSpaceObj);
          if (gp?.transform?.matrix) {
            mat4FromArray(gp.transform.matrix, ctrl.gripMatrix);
            decomposeMat4(ctrl.gripMatrix, ctrl.pose.position, ctrl.pose.rotation);
          }
        } catch {
          /* pose may not be ready */
        }
      }
      // targetRayMatrix
      if (input.targetRaySpace) {
        try {
          const tp = frame.getPose(input.targetRaySpace, this._referenceSpaceObj);
          if (tp?.transform?.matrix) {
            mat4FromArray(tp.transform.matrix, ctrl.targetRayMatrix);
          }
        } catch {
          /* pose may not be ready */
        }
      }
    }

    return true;
  }

  /**
   * 同步 controllers 数组到当前 inputSources(按 handedness)。
   * 新增的手柄追加;移除的手柄丢弃。
   */
  protected _syncControllers(inputs: XRInputSource[]): void {
    const hands = inputs
      .map((i) => i.handedness as string)
      .filter((h) => h === 'left' || h === 'right' || h === 'none');
    const next: VRHandController[] = [];
    for (const h of hands) {
      const existing = this.controllers.find((c) => c.hand === h && !next.includes(c));
      if (existing) {
        next.push(existing);
      } else {
        next.push({
          hand: h as 'left' | 'right' | 'none',
          pose: { position: new Vector3(), rotation: new Quaternion() },
          buttons: [],
          axes: [],
          gripMatrix: new Matrix4(),
          targetRayMatrix: new Matrix4(),
        });
      }
    }
    this.controllers = next;
  }

  // ── 回调 / 统计 / 清理 ────────────────────────────────────────────

  /** 注册会话结束回调。返回取消注册函数。 */
  onSessionEnd(callback: () => void): () => void {
    this._onSessionEndCallbacks.push(callback);
    return () => {
      const idx = this._onSessionEndCallbacks.indexOf(callback);
      if (idx >= 0) this._onSessionEndCallbacks.splice(idx, 1);
    };
  }

  /** 获取统计快照。 */
  getStats(): VRControllerStats {
    return {
      isSupported: this.isSupported,
      isPresenting: this.isPresenting,
      referenceSpace: this.referenceSpace,
      controllerCount: this.controllers.length,
      frameRate: this.frameRate,
      hasHeadsetPose: this.isPresenting,
      sessionActive: this.session != null,
    };
  }

  /** 估算帧率(WebXR 没有标准 frameRate 字段,这里给个保守默认)。 */
  protected _estimateFrameRate(): number {
    // 多数 VR 头显 72/90Hz;无 API 可读时返回 90 作为默认
    return 90;
  }

  /** 释放:结束会话 + 清回调。 */
  dispose(): void {
    this.endSession();
    this._onSessionEndCallbacks = [];
    log.debug('disposed');
  }
}

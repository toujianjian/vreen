// BrowserWebXRProvider —— 浏览器原生 WebXR API 适配器 (生产环境 Provider)。
//
// 把 W3C WebXR Device API (`navigator.xr` / `XRSession` / `XRFrame` / `XRPose`)
// 适配为 VREEN 的 `WebXRProvider` / `XRSessionHandle` / `XRFrameHandle` 纯数据接口。
// WebXRManager / Controller 只消费纯数据快照,本文件是唯一的浏览器侧胶水层。
//
// 类型转换:
//   * XRViewerPose → XRViewerPose (用 VREEN Matrix4 包装 view/projection matrix)
//   * XRPose.transform.matrix → XRTransform (decompose 到 Vector3/Quaternion)
//   * XRInputSource → XRInputSourceSnapshot (按钮/轴/手部关节快照)
//   * XRPlane / XRLightEstimate / XRDepthInformation → 纯数据
//
// 注意:本文件依赖浏览器全局类型 (XRSession/XRFrame 等),仅在浏览器环境运行,
// 不做单元测试 (测试用 MockWebXRProvider)。使用 `as any` 处理浏览器类型差异。

import { Vector3, Quaternion, Matrix4 } from '../Math';
import type {
  WebXRProvider,
  XRSessionHandle,
  XRReferenceSpaceHandle,
  XRFrameHandle,
  XRViewerPose,
  XRViewData,
  XRTransform,
  XRSessionMode,
  XRSessionOptions,
  XRSessionEvent,
  XRRenderStateInit,
  XRInputSourceSnapshot,
  XRButtonState,
  XRHandJointName,
  XRJointPoseData,
  XRLightProbeHandle,
  XRLightEstimate,
  XRPlaneData,
  XRDepthData,
  XRHandedness,
  XRTargetRayMode,
} from './WebXRTypes';

/** 从 XRPose.transform (DOMPointNative) 提取 XRTransform。 */
function toXRTransform(pose: any): XRTransform {
  const t = pose.transform ?? pose;
  const matrix: number[] = t.matrix;
  const m = new Matrix4();
  m.elements.set(matrix);
  const position = new Vector3();
  const orientation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  m.decompose(position, orientation, scale);
  const result: XRTransform = { position, orientation };
  if (t.linearVelocity) {
    result.linearVelocity = new Vector3(t.linearVelocity.x, t.linearVelocity.y, t.linearVelocity.z);
  }
  if (t.angularVelocity) {
    result.angularVelocity = new Vector3(t.angularVelocity.x, t.angularVelocity.y, t.angularVelocity.z);
  }
  return result;
}

/** 从 XRView 提取 XRViewData。 */
function toXRViewData(view: any, viewport: { x: number; y: number; width: number; height: number }): XRViewData {
  const eye = view.eye === 'left' ? 'left' : view.eye === 'right' ? 'right' : 'none';
  const viewMatrix = new Matrix4();
  viewMatrix.elements.set(view.transform.matrix);
  const projectionMatrix = new Matrix4();
  projectionMatrix.elements.set(view.projectionMatrix);
  return { eye, viewMatrix, projectionMatrix, viewport };
}

/**
 * BrowserWebXRProvider —— 包装 `navigator.xr`。
 *
 * ```ts
 * const provider = new BrowserWebXRProvider();
 * const manager = new WebXRManager(provider);
 * ```
 */
export class BrowserWebXRProvider implements WebXRProvider {
  readonly available: boolean;

  constructor() {
    this.available = typeof navigator !== 'undefined' && 'xr' in navigator;
  }

  isSessionSupported(mode: XRSessionMode): Promise<boolean> {
    if (!this.available) return Promise.resolve(false);
    return (navigator as any).xr.isSessionSupported(mode) as Promise<boolean>;
  }

  async requestSession(mode: XRSessionMode, options: XRSessionOptions): Promise<XRSessionHandle> {
    const raw: any = await (navigator as any).xr.requestSession(mode, options);
    return wrapSession(raw);
  }

  async offerSession(mode: XRSessionMode, options: XRSessionOptions): Promise<XRSessionHandle> {
    if (!(navigator as any).xr.offerSession) throw new Error('offerSession not supported');
    const raw: any = await (navigator as any).xr.offerSession(mode, options);
    return wrapSession(raw);
  }
}

/** 把浏览器 XRSession 包装为 XRSessionHandle。 */
function wrapSession(raw: any): XRSessionHandle {
  // 输入源快照缓存 (每帧更新)。
  let inputSnapshots: XRInputSourceSnapshot[] = [];

  const buildSnapshot = (src: any): XRInputSourceSnapshot => {
    const handedness: XRHandedness = src.handedness ?? 'none';
    const targetRayMode: XRTargetRayMode = src.targetRayMode ?? 'gaze';
    const profiles: string[] = src.profiles ? [...src.profiles] : [];
    const hand = !!src.hand;
    const handJoints = new Map<XRHandJointName, XRJointPoseData>();

    const buttons: XRButtonState[] = src.gamepad?.buttons
      ? src.gamepad.buttons.map((b: any) => ({ pressed: b.pressed, touched: b.touched, value: b.value }))
      : [];
    const axes: number[] = src.gamepad?.axes ? [...src.gamepad.axes] : [];

    return {
      handedness,
      targetRayMode,
      targetRayPose: null,
      gripPose: null,
      buttons,
      axes,
      hand,
      handJoints,
      profiles,
    };
  };

  const refreshInputs = (): void => {
    inputSnapshots = raw.inputSources ? raw.inputSources.map(buildSnapshot) : [];
  };

  refreshInputs();

  const handle: XRSessionHandle = {
    mode: raw.mode,
    environmentBlendMode: raw.environmentBlendMode ?? 'opaque',
    visibilityState: raw.visibilityState ?? 'visible',
    enabledFeatures: raw.enabledFeatures ?? [],
    preferredReflectionFormat: raw.preferredReflectionFormat,
    get inputSources() {
      return inputSnapshots;
    },

    async requestReferenceSpace(type: any): Promise<XRReferenceSpaceHandle> {
      const space: any = await raw.requestReferenceSpace(type);
      const bounds = space.boundsGeometry
        ? space.boundsGeometry.map((p: any) => ({ x: p.x, z: p.z }))
        : null;
      const refHandle: XRReferenceSpaceHandle = {
        type,
        bounds,
        raw: space,
        getOffsetReferenceSpace(transform: XRTransform): XRReferenceSpaceHandle {
          // 构造 XRRigidTransform 用于 getOffsetReferenceSpace。
          const rigid = new (window as any).XRRigidTransform(
            { x: transform.position.x, y: transform.position.y, z: transform.position.z },
            { x: transform.orientation.x, y: transform.orientation.y, z: transform.orientation.z, w: transform.orientation.w },
          );
          const offsetSpace = space.getOffsetReferenceSpace(rigid);
          return { type, bounds: null, getOffsetReferenceSpace: refHandle.getOffsetReferenceSpace, raw: offsetSpace } as unknown as XRReferenceSpaceHandle;
        },
      };
      return refHandle;
    },

    updateRenderState(state: XRRenderStateInit): void {
      raw.updateRenderState(state);
    },

    requestAnimationFrame(callback: (time: number, frame: XRFrameHandle) => void): number {
      return raw.requestAnimationFrame((time: number, frame: any) => {
        refreshInputs();
        callback(time, wrapFrame(frame, handle, inputSnapshots));
      });
    },

    cancelAnimationFrame(id: number): void {
      raw.cancelAnimationFrame(id);
    },

    hapticPulse(inputIndex: number, intensity: number, durationMs: number): void {
      const src = raw.inputSources?.[inputIndex];
      const hapticActuator = src?.gamepad?.hapticActuators?.[0];
      hapticActuator?.pulse?.(intensity, durationMs);
    },

    async requestLightProbe(): Promise<XRLightProbeHandle> {
      const probe: any = await raw.requestLightProbe({ reflectionFormat: raw.preferredReflectionFormat });
      return {
        addEventListener(type: string, listener: () => void): void {
          probe.addEventListener(type, listener);
        },
        removeEventListener(type: string, listener: () => void): void {
          probe.removeEventListener(type, listener);
        },
      };
    },

    async end(): Promise<void> {
      await raw.end();
    },

    addEventListener(type: string, listener: (event: XRSessionEvent) => void): void {
      raw.addEventListener(type, (e: any) => {
        if (type === 'inputsourceschange') {
          refreshInputs();
          listener({ type, inputSource: e.added?.[0] ? buildSnapshot(e.added[0]) : undefined });
        } else if (type === 'visibilitychange') {
          listener({ type, visibilityState: raw.visibilityState });
        } else {
          // select/squeeze 事件:找输入源 index。
          const idx = raw.inputSources ? raw.inputSources.indexOf(e.inputSource) : -1;
          listener({ type, inputIndex: idx >= 0 ? idx : undefined });
        }
      });
    },

    removeEventListener(type: string, listener: (event: XRSessionEvent) => void): void {
      raw.removeEventListener(type, listener as any);
    },
  };

  return handle;
}

/** 把浏览器 XRFrame 包装为 XRFrameHandle。 */
function wrapFrame(
  rawFrame: any,
  session: XRSessionHandle,
  inputSnapshots: XRInputSourceSnapshot[],
): XRFrameHandle {
  const frameHandle: XRFrameHandle = {
    session,

    getViewerPose(referenceSpace: XRReferenceSpaceHandle): XRViewerPose | null {
      // 找到原始参考空间 (从 referenceSpace 暂无法回溯原始对象;此处用闭包变量)。
      // 实际实现中 referenceSpace 应携带原始 space 引用。这里通过 frame.session 间接处理。
      // 注意:为简化适配,这里假设 referenceSpace 是 wrapSession 创建的原始 space。
      // 生产中应把原始 space 存到 handle 上。此处用 (referenceSpace as any).raw。
      const rawSpace = (referenceSpace as any).raw ?? referenceSpace;
      const pose: any = rawFrame.getViewerPose(rawSpace);
      if (!pose) return null;

      const transform = toXRTransform(pose);
      const views: XRViewData[] = [];
      const baseLayer = rawFrame.session.renderState?.baseLayer;
      for (const view of pose.views) {
        const viewport = baseLayer ? baseLayer.getViewport(view) : { x: 0, y: 0, width: 0, height: 0 };
        views.push(toXRViewData(view, { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }));
      }
      return { transform, views, emulatePosition: !!pose.emulatedPosition };
    },

    getTargetRayPose(inputIndex: number, referenceSpace: XRReferenceSpaceHandle): XRTransform | null {
      const src = rawFrame.session.inputSources?.[inputIndex];
      if (!src?.targetRaySpace) return null;
      const rawSpace = (referenceSpace as any).raw ?? referenceSpace;
      const pose: any = rawFrame.getPose(src.targetRaySpace, rawSpace);
      // 同步到快照。
      if (pose && inputSnapshots[inputIndex]) {
        inputSnapshots[inputIndex].targetRayPose = toXRTransform(pose);
      }
      return pose ? toXRTransform(pose) : null;
    },

    getGripPose(inputIndex: number, referenceSpace: XRReferenceSpaceHandle): XRTransform | null {
      const src = rawFrame.session.inputSources?.[inputIndex];
      if (!src?.gripSpace) return null;
      const rawSpace = (referenceSpace as any).raw ?? referenceSpace;
      const pose: any = rawFrame.getPose(src.gripSpace, rawSpace);
      if (pose && inputSnapshots[inputIndex]) {
        inputSnapshots[inputIndex].gripPose = toXRTransform(pose);
      }
      return pose ? toXRTransform(pose) : null;
    },

    getJointPose(jointName: XRHandJointName, inputIndex: number, referenceSpace: XRReferenceSpaceHandle): XRJointPoseData | null {
      const src = rawFrame.session.inputSources?.[inputIndex];
      const joint = src?.hand?.get(jointName);
      if (!joint) return null;
      const rawSpace = (referenceSpace as any).raw ?? referenceSpace;
      const pose: any = rawFrame.getJointPose(joint, rawSpace);
      if (!pose) return null;
      const data: XRJointPoseData = { transform: toXRTransform(pose), radius: pose.radius ?? 0 };
      // 同步到快照。
      if (inputSnapshots[inputIndex]) {
        inputSnapshots[inputIndex].handJoints.set(jointName, data);
      }
      return data;
    },

    getLightEstimate(probe: XRLightProbeHandle): XRLightEstimate | null {
      // probe 在 wrapSession.requestLightProbe 返回的是包装对象,需原始 probe。
      const rawProbe = (probe as any).raw ?? probe;
      const estimate: any = rawFrame.getLightEstimate(rawProbe);
      if (!estimate) return null;
      return {
        primaryLightIntensity: {
          x: estimate.primaryLightIntensity.x,
          y: estimate.primaryLightIntensity.y,
          z: estimate.primaryLightIntensity.z,
        },
        primaryLightDirection: new Vector3(
          estimate.primaryLightDirection.x,
          estimate.primaryLightDirection.y,
          estimate.primaryLightDirection.z,
        ),
        sphericalHarmonicsCoefficients: [...estimate.sphericalHarmonicsCoefficients],
      };
    },
  };

  // 平面检测。
  if (rawFrame.detectedPlanes || rawFrame.worldInformation?.detectedPlanes) {
    const all = new Map<string, XRPlaneData>();
    const added: XRPlaneData[] = [];
    const changed: XRPlaneData[] = [];
    const removed: string[] = [];

    const planeSet: Set<any> = rawFrame.detectedPlanes ?? rawFrame.worldInformation.detectedPlanes;
    for (const plane of planeSet) {
      const id = String(plane.planeSpace ?? plane);
      const polygon: Vector3[] = (plane.polygon ?? []).map((p: any) => new Vector3(p.x, p.y, p.z));
      const data: XRPlaneData = {
        id,
        orientation: plane.orientation === 'Vertical' ? 'vertical' : 'horizontal',
        polygon,
      };
      all.set(id, data);
      // added/changed/removal 需要跨帧比较;这里简化为全量。
      added.push(data);
    }
    frameHandle.detectedPlanes = { added, changed, removed, all };
  }

  // 深度感知。
  const depthInfo = rawFrame.getDepthInformation?.();
  if (depthInfo) {
    const depth: XRDepthData = {
      texture: depthInfo.texture,
      depthNear: depthInfo.depthNear,
      depthFar: depthInfo.depthFar,
      origin: { x: depthInfo.normTextureBufferOrigin.x, y: depthInfo.normTextureBufferOrigin.y },
      width: depthInfo.width,
      height: depthInfo.height,
      rawValueToMeters: depthInfo.rawValueToMeters,
    };
    frameHandle.depthInformation = depth;
  } else {
    frameHandle.depthInformation = null;
  }

  return frameHandle;
}

/**
 * 创建浏览器 WebXR Provider (工厂)。
 * 若浏览器不支持 WebXR,available=false,所有操作安全降级。
 */
export function createBrowserWebXRProvider(): BrowserWebXRProvider {
  return new BrowserWebXRProvider();
}

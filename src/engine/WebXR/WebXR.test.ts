// WebXR 模块单元测试 —— 用 MockWebXRProvider 注入,无 XR 设备/WebGL 依赖。
//
// 覆盖:
//   * WebXRController —— 连接/断开、姿态更新、按钮边沿 (select/squeeze)、捏合检测。
//   * WebXRManager —— 会话生命周期、参考空间、控制器注册表、输入源同步、事件、foveation。
//   * XRLightEstimation —— 光照估计归一化、estimationstart/end。
//   * XRPlaneTracker —— 增量应用、朝向过滤、边界框、最近水平面查询。
//   * WebXRDepthSensing —— 深度更新、采样、遮挡测试。

import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3, Quaternion } from '../Math';
import { WebXRController } from './WebXRController';
import { WebXRManager } from './WebXRManager';
import { XRLightEstimation } from './XRLightEstimation';
import { XRPlaneTracker } from './XRPlaneTracker';
import { WebXRDepthSensing } from './WebXRDepthSensing';
import type {
  WebXRProvider,
  XRSessionHandle,
  XRSessionMode,
  XRSessionOptions,
  XRReferenceSpaceHandle,
  XRFrameHandle,
  XRViewerPose,
  XRInputSourceSnapshot,
  XRSessionEvent,
  XRRenderStateInit,
  XRLightProbeHandle,
  XRTransform,
  XRPlaneData,
  XRDepthData,
  XRHandJointName,
  XRJointPoseData,
  XRButtonState,
  XREnvironmentBlendMode,
  XRVisibilityState,
} from './WebXRTypes';

// ─── Mock 工具 ──────────────────────────────────────────────────────────

function makeTransform(x = 0, y = 0, z = 0): XRTransform {
  return {
    position: new Vector3(x, y, z),
    orientation: new Quaternion(),
  };
}

function makeButton(pressed = false, value = 0): XRButtonState {
  return { pressed, touched: pressed, value };
}

function makeHandInput(joints: Partial<Record<XRHandJointName, { pos: [number, number, number]; radius?: number }>>): Map<XRHandJointName, XRJointPoseData> {
  const map = new Map<XRHandJointName, XRJointPoseData>();
  for (const [name, data] of Object.entries(joints) as [XRHandJointName, { pos: [number, number, number]; radius?: number }][]) {
    map.set(name, {
      transform: makeTransform(data.pos[0], data.pos[1], data.pos[2]),
      radius: data.radius ?? 0.01,
    });
  }
  return map;
}

function makeInputSource(opts: {
  handedness?: 'left' | 'right' | 'none';
  hand?: boolean;
  targetRayPose?: XRTransform | null;
  gripPose?: XRTransform | null;
  buttons?: XRButtonState[];
  axes?: number[];
  handJoints?: Map<XRHandJointName, XRJointPoseData>;
}): XRInputSourceSnapshot {
  return {
    handedness: opts.handedness ?? 'none',
    targetRayMode: 'tracked-pointer',
    targetRayPose: opts.targetRayPose ?? null,
    gripPose: opts.gripPose ?? null,
    buttons: opts.buttons ?? [],
    axes: opts.axes ?? [],
    hand: opts.hand ?? false,
    handJoints: opts.handJoints ?? new Map(),
    profiles: ['mock-controller'],
  };
}

// ─── MockWebXRProvider ──────────────────────────────────────────────────

/** 模拟 XR 会话句柄 (可控状态)。 */
class MockSession implements XRSessionHandle {
  mode: XRSessionMode;
  environmentBlendMode: XREnvironmentBlendMode;
  visibilityState: XRVisibilityState = 'visible';
  enabledFeatures: string[] = ['local', 'local-floor'];
  preferredReflectionFormat?: string;

  inputSources: XRInputSourceSnapshot[] = [];

  private listeners: Map<string, Set<(e: XRSessionEvent) => void>> = new Map();
  private rafCallbacks: Map<number, (time: number, frame: XRFrameHandle) => void> = new Map();
  private rafCounter = 0;

  // 可控帧数据。
  viewerPose: XRViewerPose | null = null;
  detectedPlanesData: XRFrameHandle['detectedPlanes'];
  depthData: XRDepthData | null = null;
  lightEstimateData: any = null;
  lightProbeHandle: XRLightProbeHandle | null = null;

  constructor(mode: XRSessionMode, blend: XREnvironmentBlendMode = 'opaque') {
    this.mode = mode;
    this.environmentBlendMode = blend;
  }

  async requestReferenceSpace(type: any): Promise<XRReferenceSpaceHandle> {
    return { type, bounds: null };
  }

  updateRenderState(_state: XRRenderStateInit): void {}

  requestAnimationFrame(cb: (time: number, frame: XRFrameHandle) => void): number {
    const id = ++this.rafCounter;
    this.rafCallbacks.set(id, cb);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.rafCallbacks.delete(id);
  }

  /** 触发一帧 (测试调用)。 */
  tick(time: number = 0): void {
    const frame = this.makeFrame();
    // 快照当前回调并清空:回调内部会注册下一帧的 rAF,留到下次 tick。
    const cbs = [...this.rafCallbacks.values()];
    this.rafCallbacks.clear();
    for (const cb of cbs) {
      cb(time, frame);
    }
  }

  private makeFrame(): XRFrameHandle {
    const session = this;
    const frame: XRFrameHandle = {
      session,
      getViewerPose: (_ref: XRReferenceSpaceHandle) => session.viewerPose,
      getTargetRayPose: (idx: number) => session.inputSources[idx]?.targetRayPose ?? null,
      getGripPose: (idx: number) => session.inputSources[idx]?.gripPose ?? null,
      getJointPose: (jointName: XRHandJointName, idx: number) => {
        return session.inputSources[idx]?.handJoints.get(jointName) ?? null;
      },
      getLightEstimate: (_probe: XRLightProbeHandle) => session.lightEstimateData,
      detectedPlanes: session.detectedPlanesData,
      depthInformation: session.depthData,
    };
    return frame;
  }

  hapticPulse(_index: number, _intensity: number, _durationMs: number): void {}

  async requestLightProbe(): Promise<XRLightProbeHandle> {
    this.lightProbeHandle = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    return this.lightProbeHandle;
  }

  async end(): Promise<void> {
    this.emit('end', {});
  }

  addEventListener(type: string, listener: (e: XRSessionEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (e: XRSessionEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data: Partial<XRSessionEvent>): void {
    this.listeners.get(type)?.forEach((fn) => fn({ type, ...data } as XRSessionEvent));
  }

  setInputSources(sources: XRInputSourceSnapshot[]): void {
    const added = sources.filter((s) => !this.inputSources.includes(s));
    const removed = this.inputSources.filter((s) => !sources.includes(s));
    this.inputSources = sources;
    if (added.length || removed.length) {
      this.emit('inputsourceschange', {});
    }
  }
}

/** 模拟 WebXR Provider。 */
class MockWebXRProvider implements WebXRProvider {
  available = true;
  supportedModes: Set<XRSessionMode> = new Set(['immersive-vr', 'immersive-ar', 'inline']);
  sessionsCreated: MockSession[] = [];
  private sessionQueue: MockSession[] = [];

  isSessionSupported(mode: XRSessionMode): Promise<boolean> {
    return Promise.resolve(this.supportedModes.has(mode));
  }

  async requestSession(mode: XRSessionMode, _options: XRSessionOptions): Promise<XRSessionHandle> {
    if (!this.supportedModes.has(mode)) throw new Error(`Mode ${mode} not supported`);
    // 返回队列中的预设会话,否则新建。
    const session = this.sessionQueue.shift() ?? new MockSession(mode);
    this.sessionsCreated.push(session);
    return session;
  }

  /** 预设下一个 requestSession 返回的会话 (测试控制)。 */
  queueSession(session: MockSession): void {
    this.sessionQueue.push(session);
  }
}

// ─── WebXRController 测试 ───────────────────────────────────────────────

describe('WebXRController', () => {
  it('connect/disconnect 派发事件', () => {
    const ctrl = new WebXRController();
    const events: string[] = [];
    ctrl.addEventListener('connected', () => events.push('connected'));
    ctrl.addEventListener('disconnected', () => events.push('disconnected'));

    const src = makeInputSource({ handedness: 'right' });
    ctrl.connect(src);
    expect(events).toEqual(['connected']);
    expect(ctrl.handedness).toBe('right');
    expect(ctrl.inputSource).toBe(src);

    ctrl.disconnect();
    expect(events).toEqual(['connected', 'disconnected']);
    expect(ctrl.inputSource).toBeNull();
  });

  it('update 设置目标射线/握持空间可见性', () => {
    const ctrl = new WebXRController();
    const src = makeInputSource({
      targetRayPose: makeTransform(1, 0, 0),
      gripPose: makeTransform(0, 1, 0),
    });
    ctrl.connect(src);
    ctrl.update(src);

    expect(ctrl.targetRay.visible).toBe(true);
    expect(ctrl.targetRay.position.x).toBeCloseTo(1);
    expect(ctrl.grip.visible).toBe(true);
    expect(ctrl.grip.position.y).toBeCloseTo(1);
  });

  it('update 无数据时隐藏空间', () => {
    const ctrl = new WebXRController();
    ctrl.update(null);
    expect(ctrl.targetRay.visible).toBe(false);
    expect(ctrl.grip.visible).toBe(false);
  });

  it('select 按钮边沿检测', () => {
    const ctrl = new WebXRController();
    const events: string[] = [];
    ctrl.addEventListener('selectstart', () => events.push('selectstart'));
    ctrl.addEventListener('selectend', () => events.push('selectend'));
    ctrl.addEventListener('select', () => events.push('select'));

    // 按下。
    let src = makeInputSource({ buttons: [makeButton(true, 1)] });
    ctrl.connect(src);
    ctrl.update(src);
    expect(events).toEqual(['selectstart']);

    // 松开。
    src = makeInputSource({ buttons: [makeButton(false, 0)] });
    ctrl.update(src);
    expect(events).toEqual(['selectstart', 'selectend', 'select']);
  });

  it('squeeze 按钮边沿检测', () => {
    const ctrl = new WebXRController();
    const events: string[] = [];
    ctrl.addEventListener('squeezestart', () => events.push('squeezestart'));
    ctrl.addEventListener('squeezeend', () => events.push('squeezeend'));
    ctrl.addEventListener('squeeze', () => events.push('squeeze'));

    const src1 = makeInputSource({ buttons: [makeButton(), makeButton(true, 1)] });
    ctrl.connect(src1);
    ctrl.update(src1);
    expect(events).toEqual(['squeezestart']);

    const src2 = makeInputSource({ buttons: [makeButton(), makeButton(false, 0)] });
    ctrl.update(src2);
    expect(events).toEqual(['squeezestart', 'squeezeend', 'squeeze']);
  });

  it('手部捏合检测 (pinchstart/pinchend)', () => {
    const ctrl = new WebXRController();
    const events: string[] = [];
    ctrl.addEventListener('pinchstart', () => events.push('pinchstart'));
    ctrl.addEventListener('pinchend', () => events.push('pinchend'));

    // 食指指尖与拇指指尖接近 (< 0.02 - 0.005 = 0.015)。
    const jointsClose = makeHandInput({
      'index-finger-tip': { pos: [0, 0, 0] },
      'thumb-tip': { pos: [0.01, 0, 0] }, // 距离 0.01 < 0.015
    });
    const srcClose = makeInputSource({ hand: true, handJoints: jointsClose });
    ctrl.connect(srcClose);
    ctrl.update(srcClose);
    expect(events).toEqual(['pinchstart']);
    expect(ctrl.hand.pinching).toBe(true);

    // 分开 (> 0.02 + 0.005 = 0.025)。
    const jointsFar = makeHandInput({
      'index-finger-tip': { pos: [0, 0, 0] },
      'thumb-tip': { pos: [0.05, 0, 0] }, // 距离 0.05 > 0.025
    });
    const srcFar = makeInputSource({ hand: true, handJoints: jointsFar });
    ctrl.update(srcFar);
    expect(events).toEqual(['pinchstart', 'pinchend']);
    expect(ctrl.hand.pinching).toBe(false);
  });

  it('捏合滞后防抖 (中间区间不触发)', () => {
    const ctrl = new WebXRController();
    const events: string[] = [];
    ctrl.addEventListener('pinchstart', () => events.push('pinchstart'));
    ctrl.addEventListener('pinchend', () => events.push('pinchend'));

    // 捏合。
    const close = makeInputSource({
      hand: true,
      handJoints: makeHandInput({ 'index-finger-tip': { pos: [0, 0, 0] }, 'thumb-tip': { pos: [0.01, 0, 0] } }),
    });
    ctrl.connect(close);
    ctrl.update(close);
    expect(events).toHaveLength(1);

    // 中间距离 (0.018,在 0.015~0.025 之间,不应触发 pinchend)。
    const mid = makeInputSource({
      hand: true,
      handJoints: makeHandInput({ 'index-finger-tip': { pos: [0, 0, 0] }, 'thumb-tip': { pos: [0.018, 0, 0] } }),
    });
    ctrl.update(mid);
    expect(events).toHaveLength(1); // 仍只有 pinchstart
  });

  it('fromMatrixArray 解析位置', () => {
    const ctrl = new WebXRController();
    // 平移矩阵 (x=5)。
    const m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1];
    ctrl.targetRay.fromMatrixArray(m);
    expect(ctrl.targetRay.position.x).toBeCloseTo(5);
    expect(ctrl.targetRay.visible).toBe(false); // fromMatrixArray 不改 visible
  });

  it('move 事件在有效姿态时派发', () => {
    const ctrl = new WebXRController();
    let moveCount = 0;
    ctrl.addEventListener('move', () => moveCount++);
    const src = makeInputSource({ targetRayPose: makeTransform(1, 2, 3) });
    ctrl.connect(src);
    ctrl.update(src);
    expect(moveCount).toBe(1);
  });
});

// ─── WebXRManager 测试 ─────────────────────────────────────────────────

describe('WebXRManager', () => {
  let provider: MockWebXRProvider;
  let manager: WebXRManager;

  beforeEach(() => {
    provider = new MockWebXRProvider();
    manager = new WebXRManager(provider);
  });

  it('isSessionSupported 反映 provider', async () => {
    expect(await manager.isSessionSupported('immersive-vr')).toBe(true);
    provider.supportedModes.delete('immersive-vr');
    expect(await manager.isSessionSupported('immersive-vr')).toBe(false);
  });

  it('available=false 时 isSessionSupported 返回 false', async () => {
    provider.available = false;
    expect(await manager.isSessionSupported('immersive-vr')).toBe(false);
  });

  it('startSession 启动会话 + 派发 sessionstart', async () => {
    const events: string[] = [];
    manager.addEventListener('sessionstart', () => events.push('sessionstart'));
    await manager.startSession('immersive-vr');
    expect(manager.isPresenting).toBe(true);
    expect(manager.enabled).toBe(true);
    expect(manager.getSession()).not.toBeNull();
    expect(events).toEqual(['sessionstart']);
  });

  it('startSession 不支持时抛错 + 派发 requestfailed', async () => {
    provider.supportedModes.delete('immersive-ar');
    const events: string[] = [];
    manager.addEventListener('requestfailed', () => events.push('requestfailed'));
    await expect(manager.startSession('immersive-ar')).rejects.toThrow();
    expect(events).toEqual(['requestfailed']);
    expect(manager.isPresenting).toBe(false);
  });

  it('重复 startSession 抛错', async () => {
    await manager.startSession('immersive-vr');
    await expect(manager.startSession('immersive-vr')).rejects.toThrow('already active');
  });

  it('end 派发 sessionend + 重置状态', async () => {
    await manager.startSession('immersive-vr');
    const events: string[] = [];
    manager.addEventListener('sessionend', () => events.push('sessionend'));
    await manager.end();
    expect(events).toEqual(['sessionend']);
    expect(manager.isPresenting).toBe(false);
    expect(manager.getSession()).toBeNull();
  });

  it('getController 返回同一实例 (按 index)', () => {
    expect(manager.getController(0)).toBe(manager.getController(0));
    expect(manager.getController(1)).not.toBe(manager.getController(0));
  });

  it('参考空间类型默认 local-floor', () => {
    expect(manager.getReferenceSpaceType()).toBe('local-floor');
    manager.setReferenceSpaceType('local');
    expect(manager.getReferenceSpaceType()).toBe('local');
  });

  it('foveation get/set', () => {
    manager.setFoveation(0.5);
    expect(manager.getFoveation()).toBeCloseTo(0.5);
  });

  it('setAnimationLoop 帧回调收到 viewerPose', async () => {
    const session = new MockSession('immersive-vr');
    provider.queueSession(session);
    await manager.startSession('immersive-vr');

    const mockPose: XRViewerPose = {
      transform: makeTransform(0, 1.5, 0),
      views: [],
      emulatePosition: false,
    };
    session.viewerPose = mockPose;

    let receivedPose: XRViewerPose | null = null;
    manager.setAnimationLoop((_t, _f, pose) => { receivedPose = pose; });
    session.tick(16);

    expect(receivedPose).toBe(mockPose);
  });

  it('输入源变更触发控制器 connect/disconnect', async () => {
    const session = new MockSession('immersive-vr');
    provider.queueSession(session);
    await manager.startSession('immersive-vr');

    const ctrl = manager.getController(0);
    let connected = false;
    ctrl.addEventListener('connected', () => { connected = true; });

    const src = makeInputSource({ handedness: 'left' });
    session.setInputSources([src]);
    session.tick(0);

    expect(connected).toBe(true);
    expect(ctrl.handedness).toBe('left');
  });

  it('输入源移除触发 disconnect', async () => {
    const session = new MockSession('immersive-vr');
    provider.queueSession(session);
    await manager.startSession('immersive-vr');

    const ctrl = manager.getController(0);
    let disconnected = false;
    ctrl.addEventListener('disconnected', () => { disconnected = true; });

    const src = makeInputSource({ handedness: 'right' });
    session.setInputSources([src]);
    session.tick(0);

    session.setInputSources([]);
    session.tick(0);

    expect(disconnected).toBe(true);
  });

  it('visibilitychange 事件转发', async () => {
    const session = new MockSession('immersive-vr');
    provider.queueSession(session);
    await manager.startSession('immersive-vr');

    const events: string[] = [];
    manager.addEventListener('visibilitychange', (e) => {
      events.push(e.visibilityState ?? '?');
    });
    session.emit('visibilitychange', { visibilityState: 'hidden' });
    expect(events).toEqual(['hidden']);
  });

  it('getEnvironmentBlendMode', async () => {
    const session = new MockSession('immersive-ar', 'alpha-blend');
    provider.queueSession(session);
    await manager.startSession('immersive-ar');
    expect(manager.getEnvironmentBlendMode()).toBe('alpha-blend');
  });

  it('enableLightEstimation 返回探针', async () => {
    const session = new MockSession('immersive-ar', 'alpha-blend');
    provider.queueSession(session);
    await manager.startSession('immersive-ar');
    const probe = await manager.enableLightEstimation();
    expect(probe).not.toBeNull();
  });

  it('平面检测更新已知平面', async () => {
    const session = new MockSession('immersive-ar', 'alpha-blend');
    provider.queueSession(session);
    await manager.startSession('immersive-ar');

    let detectedCount = 0;
    manager.addEventListener('planesdetected', () => detectedCount++);

    const plane: XRPlaneData = {
      id: 'plane-1',
      orientation: 'horizontal',
      polygon: [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 1)],
    };
    session.detectedPlanesData = {
      added: [plane],
      changed: [],
      removed: [],
      all: new Map([['plane-1', plane]]),
    };
    session.tick(0);

    expect(detectedCount).toBe(1);
    expect(manager.getPlanes().get('plane-1')).toBeDefined();
  });

  it('dispose 结束会话', async () => {
    await manager.startSession('immersive-vr');
    manager.dispose();
    expect(manager.isPresenting).toBe(false);
  });
});

// ─── XRLightEstimation 测试 ─────────────────────────────────────────────

describe('XRLightEstimation', () => {
  it('update 归一化主光颜色 + 强度', () => {
    const light = new XRLightEstimation();
    light.update({
      primaryLightIntensity: { x: 2, y: 4, z: 1 },
      primaryLightDirection: new Vector3(0, -1, 0),
      sphericalHarmonicsCoefficients: new Array(27).fill(0.1),
    });
    // 最大通道 = 4 (y),归一化: r=0.5, g=1, b=0.25,强度=4。
    expect(light.state.directionalLight.color.g).toBeCloseTo(1);
    expect(light.state.directionalLight.color.r).toBeCloseTo(0.5);
    expect(light.state.directionalLight.color.b).toBeCloseTo(0.25);
    expect(light.state.directionalLight.intensity).toBeCloseTo(4);
    expect(light.state.directionalLight.position.y).toBeCloseTo(-1);
  });

  it('estimationstart 在首次有效数据时触发', () => {
    const light = new XRLightEstimation();
    let started = false;
    light.onEstimationStart = () => { started = true; };
    expect(light.state.estimationActive).toBe(false);

    light.update({
      primaryLightIntensity: { x: 1, y: 1, z: 1 },
      primaryLightDirection: new Vector3(0, 1, 0),
      sphericalHarmonicsCoefficients: [],
    });
    expect(started).toBe(true);
    expect(light.state.estimationActive).toBe(true);

    // 第二次不重复触发。
    let startCount = 0;
    light.onEstimationStart = () => { startCount++; };
    light.update({
      primaryLightIntensity: { x: 2, y: 2, z: 2 },
      primaryLightDirection: new Vector3(1, 0, 0),
      sphericalHarmonicsCoefficients: [],
    });
    expect(startCount).toBe(0);
  });

  it('reset 触发 estimationend', () => {
    const light = new XRLightEstimation();
    light.update({
      primaryLightIntensity: { x: 1, y: 1, z: 1 },
      primaryLightDirection: new Vector3(0, 1, 0),
      sphericalHarmonicsCoefficients: [],
    });
    let ended = false;
    light.onEstimationEnd = () => { ended = true; };
    light.reset();
    expect(ended).toBe(true);
    expect(light.state.estimationActive).toBe(false);
    expect(light.state.directionalLight.intensity).toBe(0);
  });

  it('update null 不改变状态', () => {
    const light = new XRLightEstimation();
    light.update({
      primaryLightIntensity: { x: 1, y: 1, z: 1 },
      primaryLightDirection: new Vector3(0, 1, 0),
      sphericalHarmonicsCoefficients: [0.5],
    });
    light.update(null);
    expect(light.state.directionalLight.intensity).toBeCloseTo(1);
    expect(light.state.sphericalHarmonics).toHaveLength(1);
  });
});

// ─── XRPlaneTracker 测试 ────────────────────────────────────────────────

describe('XRPlaneTracker', () => {
  it('applyDelta 添加/移除平面', () => {
    const tracker = new XRPlaneTracker();
    const plane1: XRPlaneData = { id: 'p1', orientation: 'horizontal', polygon: [new Vector3(0, 0, 0)] };
    const plane2: XRPlaneData = { id: 'p2', orientation: 'vertical', polygon: [new Vector3(0, 0, 0)] };

    tracker.applyDelta({ added: [plane1, plane2], changed: [], removed: [] });
    expect(tracker.count).toBe(2);
    expect(tracker.get('p1')).toBe(plane1);

    tracker.applyDelta({ added: [], changed: [], removed: ['p1'] });
    expect(tracker.count).toBe(1);
    expect(tracker.get('p1')).toBeUndefined();
  });

  it('getByOrientation 过滤', () => {
    const tracker = new XRPlaneTracker();
    tracker.applyDelta({
      added: [
        { id: 'h1', orientation: 'horizontal', polygon: [] },
        { id: 'v1', orientation: 'vertical', polygon: [] },
        { id: 'h2', orientation: 'horizontal', polygon: [] },
      ],
      changed: [], removed: [],
    });
    expect(tracker.getByOrientation('horizontal')).toHaveLength(2);
    expect(tracker.getByOrientation('vertical')).toHaveLength(1);
  });

  it('getBounds 计算 AABB', () => {
    const tracker = new XRPlaneTracker();
    tracker.applyDelta({
      added: [{
        id: 'p1',
        orientation: 'horizontal',
        polygon: [
          new Vector3(-1, 0, -2),
          new Vector3(3, 0, 4),
        ],
      }],
      changed: [], removed: [],
    });
    const bounds = tracker.getBounds('p1');
    expect(bounds).not.toBeNull();
    expect(bounds!.min.x).toBeCloseTo(-1);
    expect(bounds!.max.x).toBeCloseTo(3);
    expect(bounds!.size.x).toBeCloseTo(4);
    expect(bounds!.center.x).toBeCloseTo(1);
  });

  it('findNearestHorizontalSurface 在范围内找到平面', () => {
    const tracker = new XRPlaneTracker();
    tracker.applyDelta({
      added: [{
        id: 'floor',
        orientation: 'horizontal',
        polygon: [
          new Vector3(0, 0, 0),
          new Vector3(5, 0, 0),
          new Vector3(5, 0, 5),
          new Vector3(0, 0, 5),
        ],
      }],
      changed: [], removed: [],
    });
    // 查询点在平面上方 (2, 1.5, 2)。
    const result = tracker.findNearestHorizontalSurface(new Vector3(2, 1.5, 2), 5);
    expect(result).not.toBeNull();
    expect(result!.planeId).toBe('floor');
    expect(result!.surfacePoint.y).toBeCloseTo(0);
  });

  it('findNearestHorizontalSurface 超出范围返回 null', () => {
    const tracker = new XRPlaneTracker();
    tracker.applyDelta({
      added: [{
        id: 'floor',
        orientation: 'horizontal',
        polygon: [new Vector3(0, 0, 0), new Vector3(1, 0, 1)],
      }],
      changed: [], removed: [],
    });
    // 查询点远离平面 (10, 0, 10)。
    expect(tracker.findNearestHorizontalSurface(new Vector3(10, 0, 10), 1)).toBeNull();
  });

  it('changed 平面失效边界缓存', () => {
    const tracker = new XRPlaneTracker();
    tracker.applyDelta({
      added: [{ id: 'p1', orientation: 'horizontal', polygon: [new Vector3(0, 0, 0), new Vector3(1, 0, 0)] }],
      changed: [], removed: [],
    });
    const bounds1 = tracker.getBounds('p1');
    expect(bounds1!.max.x).toBeCloseTo(1);

    tracker.applyDelta({
      added: [],
      changed: [{ id: 'p1', orientation: 'horizontal', polygon: [new Vector3(0, 0, 0), new Vector3(5, 0, 0)] }],
      removed: [],
    });
    const bounds2 = tracker.getBounds('p1');
    expect(bounds2!.max.x).toBeCloseTo(5);
  });

  it('事件监听触发', () => {
    const tracker = new XRPlaneTracker();
    let callCount = 0;
    tracker.addEventListener(() => callCount++);
    tracker.applyDelta({ added: [{ id: 'p1', orientation: 'horizontal', polygon: [] }], changed: [], removed: [] });
    expect(callCount).toBe(1);
    // 空增量不触发。
    tracker.applyDelta({ added: [], changed: [], removed: [] });
    expect(callCount).toBe(1);
  });
});

// ─── WebXRDepthSensing 测试 ─────────────────────────────────────────────

describe('WebXRDepthSensing', () => {
  it('update 设置深度数据', () => {
    const depth = new WebXRDepthSensing();
    depth.update({
      texture: 'tex-1',
      depthNear: 0.1,
      depthFar: 10,
      origin: { x: 0, y: 0 },
      width: 256,
      height: 192,
      rawValueToMeters: 0.01,
    });
    expect(depth.state.active).toBe(true);
    expect(depth.state.depthFar).toBeCloseTo(10);
    expect(depth.state.rawValueToMeters).toBeCloseTo(0.01);
    expect(depth.hasTexture()).toBe(true);
  });

  it('update null 标记非 active', () => {
    const depth = new WebXRDepthSensing();
    depth.update({
      texture: 'tex', depthNear: 0.1, depthFar: 5,
      origin: { x: 0, y: 0 }, width: 100, height: 100, rawValueToMeters: 0.01,
    });
    depth.update(null);
    expect(depth.state.active).toBe(false);
  });

  it('sampleDepth 转换原始值为米', () => {
    const depth = new WebXRDepthSensing();
    depth.update({
      texture: 'tex', depthNear: 0.1, depthFar: 5,
      origin: { x: 0, y: 0 }, width: 100, height: 100, rawValueToMeters: 0.02,
    });
    // 采样返回原始值 100 → 100 * 0.02 = 2 米。
    const meters = depth.sampleDepth(0.5, 0.5, () => 100);
    expect(meters).toBeCloseTo(2);
  });

  it('sampleDepth 非 active 返回 null', () => {
    const depth = new WebXRDepthSensing();
    expect(depth.sampleDepth(0, 0, () => 1)).toBeNull();
  });

  it('isOccluded 真实物体更近时遮挡', () => {
    const depth = new WebXRDepthSensing();
    depth.update({
      texture: 'tex', depthNear: 0.1, depthFar: 5,
      origin: { x: 0, y: 0 }, width: 100, height: 100, rawValueToMeters: 1,
    });
    // 虚拟点深度 3,真实深度 2 (更近) → 遮挡。
    expect(depth.isOccluded(3, 0.5, 0.5, () => 2)).toBe(true);
    // 真实深度 4 (更远) → 不遮挡。
    expect(depth.isOccluded(3, 0.5, 0.5, () => 4)).toBe(false);
  });

  it('reset 清空状态', () => {
    const depth = new WebXRDepthSensing();
    depth.update({
      texture: 'tex', depthNear: 0.1, depthFar: 5,
      origin: { x: 0, y: 0 }, width: 100, height: 100, rawValueToMeters: 0.01,
    });
    depth.reset();
    expect(depth.state.texture).toBeNull();
    expect(depth.state.active).toBe(false);
    expect(depth.state.depthFar).toBe(0);
  });
});

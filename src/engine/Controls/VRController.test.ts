// VRController 单元测试。
//
// 覆盖:
//   1. 构造 / 非浏览器环境降级 (isSupported=false, isAvailable=false)
//   2. isAvailable / isSupported 在无 navigator.xr 时返回 false
//   3. requestSession 成功路径 (mock navigator.xr)
//   4. requestSession 失败路径 (无 navigator.xr)
//   5. update(frame) 提取头显位姿 / 双眼视图 / 手柄
//   6. getEyeParams / getProjectionMatrix / getViewMatrix / getViewport
//   7. getController / getControllers
//   8. setReferenceSpace / setBaseLayer
//   9. onSessionEnd 回调触发与取消
//  10. endSession 清理状态
//  11. getStats
//  12. dispose
//
// 测试在 Node 环境,需 mock navigator.xr / XRSession / XRFrame / XRWebGLLayer。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VRController } from './VRController';
import { Matrix4 } from '../Math/Matrix4';

/** 创建单位矩阵 Float32Array(16) — WebXR transform.matrix 列主序。 */
function identityMat(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/** 创建一个平移矩阵(列主序)。 */
function translateMat(x: number, y: number, z: number): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

interface MockInputSource {
  handedness: 'left' | 'right' | 'none';
  targetRaySpace: unknown;
  gripSpace: unknown;
  gamepad: {
    buttons: { pressed: boolean }[];
    axes: number[];
  };
}

interface MockXRPose {
  transform: { matrix: Float32Array };
}

interface MockXRView {
  eye: string;
  projectionMatrix: Float32Array;
  transform: { matrix: Float32Array };
}

interface MockViewerPose {
  transform: { matrix: Float32Array };
  views: MockXRView[];
}

interface MockFrame {
  getViewerPose(space: unknown): MockViewerPose | undefined;
  getPose(space: unknown, base: unknown): MockXRPose | undefined;
}

interface MockSession {
  inputSources: MockInputSource[];
  requestReferenceSpace(type: string): Promise<unknown>;
  addEventListener(type: string, fn: (e?: unknown) => void): void;
  removeEventListener(type: string, fn: (e?: unknown) => void): void;
  updateRenderState(opts: { baseLayer: unknown }): void;
  end(): Promise<void>;
  /** 触发 'end' 事件(测试用)。 */
  __fireEnd(): void;
  __endHandlers: Array<(e?: unknown) => void>;
}

/** 创建 mock navigator.xr。 */
function createMockXR(): {
  xr: { isSessionSupported: (m: string) => Promise<boolean>; requestSession: (m: string, i: unknown) => Promise<MockSession> };
  session: MockSession;
} {
  const session: MockSession = {
    inputSources: [],
    __endHandlers: [],
    requestReferenceSpace: vi.fn(async (_type: string) => ({ type: 'refSpace' })),
    addEventListener: vi.fn((type: string, fn: (e?: unknown) => void) => {
      if (type === 'end') session.__endHandlers.push(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: (e?: unknown) => void) => {
      if (type === 'end') {
        const i = session.__endHandlers.indexOf(fn);
        if (i >= 0) session.__endHandlers.splice(i, 1);
      }
    }),
    updateRenderState: vi.fn(),
    end: vi.fn(async () => {
      session.__fireEnd();
    }),
    __fireEnd() {
      for (const h of session.__endHandlers.slice()) h();
    },
  };
  const xr = {
    isSessionSupported: vi.fn(async (_mode: string) => true),
    requestSession: vi.fn(async (_mode: string, _init: unknown) => session),
  };
  return { xr, session };
}

/** 在 globalThis.navigator 上安装 / 卸载 mock xr。 */
function installMockXR(xr: unknown): () => void {
  const nav = globalThis.navigator as Navigator & { xr?: unknown };
  const had = Object.getOwnPropertyDescriptor(nav, 'xr');
  Object.defineProperty(nav, 'xr', {
    configurable: true,
    value: xr,
    writable: true,
  });
  return () => {
    if (had) {
      Object.defineProperty(nav, 'xr', had);
    } else {
      delete (nav as { xr?: unknown }).xr;
    }
  };
}

describe('VRController — 非浏览器环境降级', () => {
  let restore: () => void;
  beforeEach(() => {
    // 确保 navigator.xr 不存在
    const nav = globalThis.navigator as Navigator & { xr?: unknown };
    delete nav.xr;
    restore = () => {};
  });
  afterEach(() => restore());

  it('构造不抛错,isAvailable=false', () => {
    const vr = new VRController();
    expect(vr.isAvailable()).toBe(false);
  });

  it('requestSession 在无 WebXR 时返回 false', async () => {
    const vr = new VRController();
    const ok = await vr.requestSession();
    expect(ok).toBe(false);
    expect(vr.isPresenting).toBe(false);
    expect(vr.session).toBeNull();
  });

  it('update 在无 session 时返回 false,不抛错', () => {
    const vr = new VRController();
    const ok = vr.update({} as unknown as XRFrame);
    expect(ok).toBe(false);
  });

  it('endSession 在无 session 时安全', () => {
    const vr = new VRController();
    expect(() => vr.endSession()).not.toThrow();
  });

  it('getStats 反映未支持状态', () => {
    const vr = new VRController();
    const s = vr.getStats();
    expect(s.isPresenting).toBe(false);
    expect(s.controllerCount).toBe(0);
    expect(s.sessionActive).toBe(false);
  });

  it('dispose 安全', () => {
    const vr = new VRController();
    expect(() => vr.dispose()).not.toThrow();
  });
});

describe('VRController — WebXR 可用路径', () => {
  let vr: VRController;
  let mock: ReturnType<typeof createMockXR>;
  let restore: () => void;

  beforeEach(() => {
    mock = createMockXR();
    restore = installMockXR(mock.xr);
    vr = new VRController();
  });

  afterEach(() => {
    vr.dispose();
    restore();
  });

  it('isAvailable=true after navigator.xr 安装', () => {
    expect(vr.isAvailable()).toBe(true);
  });

  it('requestSession 成功:设置 session / referenceSpace / isPresenting', async () => {
    const ok = await vr.requestSession({ referenceSpace: 'local-floor' });
    expect(ok).toBe(true);
    expect(vr.session).toBe(mock.session);
    expect(vr.isPresenting).toBe(true);
    expect(vr.referenceSpace).toBe('local-floor');
    expect(mock.session.requestReferenceSpace).toHaveBeenCalledWith('local-floor');
    expect(vr.frameRate).toBeGreaterThan(0);
  });

  it('setBaseLayer 调用 session.updateRenderState', async () => {
    await vr.requestSession();
    const layer = { getViewport: () => ({ x: 0, y: 0, width: 100, height: 100 }) };
    vr.setBaseLayer(layer as unknown as XRWebGLLayer);
    expect(mock.session.updateRenderState).toHaveBeenCalled();
  });

  it('update 提取头显位姿与双眼视图', async () => {
    await vr.requestSession();
    // 头显位于 (1, 2, 3)
    const headMat = translateMat(1, 2, 3);
    const leftProj = new Float32Array(16).fill(0);
    const leftView = new Float32Array(16).fill(0);
    const rightProj = new Float32Array(16).fill(0);
    const rightView = new Float32Array(16).fill(0);
    const frame: MockFrame = {
      getViewerPose: vi.fn(() => ({
        transform: { matrix: headMat },
        views: [
          { eye: 'left', projectionMatrix: leftProj, transform: { matrix: leftView } },
          { eye: 'right', projectionMatrix: rightProj, transform: { matrix: rightView } },
        ],
      })),
      getPose: vi.fn(() => undefined),
    };
    const ok = vr.update(frame as unknown as XRFrame);
    expect(ok).toBe(true);
    expect(vr.headsetPose.position.x).toBe(1);
    expect(vr.headsetPose.position.y).toBe(2);
    expect(vr.headsetPose.position.z).toBe(3);
    // 旋转为单位四元数(纯平移矩阵)
    expect(vr.headsetPose.rotation.w).toBeCloseTo(1, 5);
    // 双眼矩阵被复制
    expect(vr.leftEye.projectionMatrix.elements).toEqual(leftProj);
    expect(vr.rightEye.projectionMatrix.elements).toEqual(rightProj);
    expect(vr.leftEye.viewMatrix.elements).toEqual(leftView);
    expect(vr.rightEye.viewMatrix.elements).toEqual(rightView);
  });

  it('update 在 getViewerPose 返回 undefined 时返回 false', async () => {
    await vr.requestSession();
    const frame: MockFrame = {
      getViewerPose: vi.fn(() => undefined),
      getPose: vi.fn(() => undefined),
    };
    expect(vr.update(frame as unknown as XRFrame)).toBe(false);
  });

  it('update 提取手柄 gripMatrix / targetRayMatrix / buttons / axes', async () => {
    const gripLeft = translateMat(0, 1, 0);
    const rayLeft = translateMat(0, 1, 1);
    mock.session.inputSources.push({
      handedness: 'left',
      targetRaySpace: { id: 'rayL' },
      gripSpace: { id: 'gripL' },
      gamepad: {
        buttons: [{ pressed: true }, { pressed: false }],
        axes: [0.5, -0.5],
      },
    });
    await vr.requestSession();
    const frame: MockFrame = {
      getViewerPose: vi.fn(() => ({
        transform: { matrix: identityMat() },
        views: [],
      })),
      getPose: vi.fn((space: unknown) => {
        const s = space as { id?: string };
        if (s?.id === 'gripL') return { transform: { matrix: gripLeft } };
        if (s?.id === 'rayL') return { transform: { matrix: rayLeft } };
        return undefined;
      }),
    };
    vr.update(frame as unknown as XRFrame);
    const ctrl = vr.getController('left');
    expect(ctrl).not.toBeNull();
    expect(ctrl!.hand).toBe('left');
    expect(ctrl!.gripMatrix.elements[12]).toBe(0);
    expect(ctrl!.gripMatrix.elements[13]).toBe(1);
    expect(ctrl!.targetRayMatrix.elements[14]).toBe(1);
    expect(ctrl!.buttons).toEqual([true, false]);
    expect(ctrl!.axes).toEqual([0.5, -0.5]);
    expect(ctrl!.pose.position.y).toBeCloseTo(1, 5);
  });

  it('getControllers 返回浅拷贝', async () => {
    mock.session.inputSources.push({
      handedness: 'right',
      targetRaySpace: {},
      gripSpace: {},
      gamepad: { buttons: [], axes: [] },
    });
    await vr.requestSession();
    const frame: MockFrame = {
      getViewerPose: vi.fn(() => ({ transform: { matrix: identityMat() }, views: [] })),
      getPose: vi.fn(() => undefined),
    };
    vr.update(frame as unknown as XRFrame);
    const arr = vr.getControllers();
    expect(arr.length).toBe(1);
    expect(arr).not.toBe(vr.controllers);
  });

  it('getController 在无对应手别时返回 null', async () => {
    await vr.requestSession();
    expect(vr.getController('left')).toBeNull();
    expect(vr.getController('right')).toBeNull();
  });

  it('getEyeParams / getProjectionMatrix / getViewMatrix / getViewport 反映左右', async () => {
    await vr.requestSession();
    expect(vr.getEyeParams('left')).toBe(vr.leftEye);
    expect(vr.getEyeParams('right')).toBe(vr.rightEye);
    expect(vr.getProjectionMatrix('left')).toBe(vr.leftEye.projectionMatrix);
    expect(vr.getViewMatrix('right')).toBe(vr.rightEye.viewMatrix);
    expect(vr.getViewport('left')).toBe(vr.leftEye.viewport);
  });

  it('isPresentingVR / getFrameRate', async () => {
    expect(vr.isPresentingVR()).toBe(false);
    await vr.requestSession();
    expect(vr.isPresentingVR()).toBe(true);
    expect(vr.getFrameRate()).toBeGreaterThan(0);
  });

  it('setBaseLayer 后 update 写入 viewport', async () => {
    await vr.requestSession();
    const layer = {
      getViewport: vi.fn((view: MockXRView) => ({
        x: view.eye === 'left' ? 0 : 100,
        y: 0,
        width: 100,
        height: 100,
      })),
    };
    vr.setBaseLayer(layer as unknown as XRWebGLLayer);
    const frame: MockFrame = {
      getViewerPose: vi.fn(() => ({
        transform: { matrix: identityMat() },
        views: [
          { eye: 'left', projectionMatrix: new Float32Array(16), transform: { matrix: new Float32Array(16) } },
          { eye: 'right', projectionMatrix: new Float32Array(16), transform: { matrix: new Float32Array(16) } },
        ],
      })),
      getPose: vi.fn(() => undefined),
    };
    vr.update(frame as unknown as XRFrame);
    expect(vr.getViewport('left').x).toBe(0);
    expect(vr.getViewport('right').x).toBe(100);
    expect(vr.getViewport('left').w).toBe(100);
  });

  it('onSessionEnd 回调在 session end 时触发,返回取消函数', async () => {
    const cb = vi.fn();
    await vr.requestSession();
    const off = vr.onSessionEnd(cb);
    mock.session.__fireEnd();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(vr.isPresenting).toBe(false);
    expect(vr.session).toBeNull();
    // 再次触发不再调用
    mock.session.__fireEnd();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('endSession 清理状态并触发 onSessionEnd', async () => {
    const cb = vi.fn();
    await vr.requestSession();
    vr.onSessionEnd(cb);
    vr.endSession();
    expect(mock.session.end).toHaveBeenCalled();
    expect(vr.isPresenting).toBe(false);
    expect(vr.session).toBeNull();
    expect(cb).toHaveBeenCalledTimes(1);
    // 手柄 / 眼睛参数被重置
    expect(vr.controllers.length).toBe(0);
    // 投影矩阵重置为单位矩阵
    const id = new Matrix4().identity();
    expect(vr.leftEye.projectionMatrix.elements).toEqual(id.elements);
  });

  it('setReferenceSpace 切换参考空间', async () => {
    await vr.requestSession();
    const ok = await vr.setReferenceSpace('local');
    expect(ok).toBe(true);
    expect(vr.referenceSpace).toBe('local');
    expect(mock.session.requestReferenceSpace).toHaveBeenCalledWith('local');
  });

  it('setReferenceSpace 在无 session 时返回 false', async () => {
    const ok = await vr.setReferenceSpace('viewer');
    expect(ok).toBe(false);
  });

  it('getStats 反映活跃会话', async () => {
    mock.session.inputSources.push({
      handedness: 'left',
      targetRaySpace: {},
      gripSpace: {},
      gamepad: { buttons: [], axes: [] },
    });
    await vr.requestSession();
    const frame: MockFrame = {
      getViewerPose: vi.fn(() => ({ transform: { matrix: identityMat() }, views: [] })),
      getPose: vi.fn(() => undefined),
    };
    vr.update(frame as unknown as XRFrame);
    const s = vr.getStats();
    expect(s.sessionActive).toBe(true);
    expect(s.isPresenting).toBe(true);
    expect(s.controllerCount).toBe(1);
    expect(s.hasHeadsetPose).toBe(true);
    expect(s.referenceSpace).toBe('local-floor');
  });
});

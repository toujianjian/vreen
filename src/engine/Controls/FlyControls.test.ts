// FlyControls 单元测试（数据层，不依赖真实 WebGL/DOM）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FlyControls } from './FlyControls';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';

/** 创建最小 mock HTMLElement，满足 FlyControls 事件挂载需求。 */
function createMockElement(): HTMLElement {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const el = {
    offsetWidth: 800,
    offsetHeight: 600,
    offsetLeft: 0,
    offsetTop: 0,
    clientWidth: 800,
    clientHeight: 600,
    style: { touchAction: '' } as Record<string, string>,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: { type: string }) {
      listeners.get(e.type)?.forEach((fn) => fn(e));
      return true;
    },
  };
  return el as unknown as HTMLElement;
}

/** 创建最小 mock window，满足 FlyControls 键盘事件挂载。 */
function createMockWindow(): unknown {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  return {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: { type: string }) {
      listeners.get(e.type)?.forEach((fn) => fn(e));
      return true;
    },
  };
}

/** 构造一个 KeyboardEvent-like 对象。 */
function keyEvent(code: string, type: 'keydown' | 'keyup' = 'keydown'): KeyboardEvent {
  return { type, code, altKey: false, preventDefault: () => {} } as unknown as KeyboardEvent;
}

describe('FlyControls', () => {
  let originalWindow: unknown;

  beforeEach(() => {
    // vitest node 环境无 window，注入 mock 以便 FlyControls 挂载键盘监听
    originalWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = createMockWindow();
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = originalWindow;
    }
  });

  it('构造时设置默认参数', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    expect(ctrl.movementSpeed).toBe(1.0);
    expect(ctrl.rollSpeed).toBe(0.005);
    expect(ctrl.dragToLook).toBe(false);
    expect(ctrl.autoForward).toBe(false);
    expect(ctrl.movementSpeedMultiplier).toBe(1);
    ctrl.dispose();
  });

  it('构造时接受自定义参数', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el, {
      movementSpeed: 5,
      rollSpeed: 0.02,
      dragToLook: true,
      autoForward: true,
    });
    expect(ctrl.movementSpeed).toBe(5);
    expect(ctrl.rollSpeed).toBe(0.02);
    expect(ctrl.dragToLook).toBe(true);
    expect(ctrl.autoForward).toBe(true);
    ctrl.dispose();
  });

  it('update(0) 在无输入时不改变相机', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const px = cam.position.x;
    const py = cam.position.y;
    const pz = cam.position.z;
    const changed = ctrl.update(0);
    expect(changed).toBe(false);
    expect(cam.position.x).toBe(px);
    expect(cam.position.y).toBe(py);
    expect(cam.position.z).toBe(pz);
    ctrl.dispose();
  });

  it('W 键按下后 update 沿本地 -Z 前进', () => {
    const cam = new PerspectiveCamera();
    // 默认 quaternion = identity，本地 -Z = 世界 -Z
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const mockWin = (globalThis as Record<string, unknown>).window as {
      dispatchEvent: (e: unknown) => boolean;
    };
    mockWin.dispatchEvent(keyEvent('KeyW', 'keydown'));
    const changed = ctrl.update(0.1);
    expect(changed).toBe(true);
    // 前进 = -Z 方向，delta = -movementSpeed * delta * moveVector.z(-1) = -0.1
    expect(cam.position.z).toBeCloseTo(-0.1, 5);
    expect(cam.position.x).toBeCloseTo(0, 5);
    expect(cam.position.y).toBeCloseTo(0, 5);
    ctrl.dispose();
  });

  it('Shift 按下时移动速度 ×0.1', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const mockWin = (globalThis as Record<string, unknown>).window as {
      dispatchEvent: (e: unknown) => boolean;
    };
    mockWin.dispatchEvent(keyEvent('ShiftLeft', 'keydown'));
    mockWin.dispatchEvent(keyEvent('KeyW', 'keydown'));
    ctrl.update(1.0);
    // delta=1, speed=1, multiplier=0.1, moveVector.z=-1 → z = -0.1
    expect(cam.position.z).toBeCloseTo(-0.1, 5);
    ctrl.dispose();
  });

  it('D 键按下后 update 沿本地 +X 右移', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const mockWin = (globalThis as Record<string, unknown>).window as {
      dispatchEvent: (e: unknown) => boolean;
    };
    mockWin.dispatchEvent(keyEvent('KeyD', 'keydown'));
    ctrl.update(0.5);
    // moveVector.x = +1 (right), delta = 0.5, speed = 1 → x = +0.5
    expect(cam.position.x).toBeCloseTo(0.5, 5);
    expect(cam.position.z).toBeCloseTo(0, 5);
    ctrl.dispose();
  });

  it('ArrowLeft 键按下后 update 产生 yaw 旋转', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const mockWin = (globalThis as Record<string, unknown>).window as {
      dispatchEvent: (e: unknown) => boolean;
    };
    mockWin.dispatchEvent(keyEvent('ArrowLeft', 'keydown'));
    const changed = ctrl.update(1.0);
    expect(changed).toBe(true);
    // identity × 小四元数 → rotation 不再是 identity
    const q = cam.rotation;
    expect(q.w).toBeLessThan(1);
    ctrl.dispose();
  });

  it('键释放后 update 不再移动', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const mockWin = (globalThis as Record<string, unknown>).window as {
      dispatchEvent: (e: unknown) => boolean;
    };
    mockWin.dispatchEvent(keyEvent('KeyW', 'keydown'));
    ctrl.update(0.1);
    mockWin.dispatchEvent(keyEvent('KeyW', 'keyup'));
    const changed = ctrl.update(0.1);
    // 键释放后 moveVector=0，但上一帧已移动，_lastPosition 已更新，所以不再变化
    expect(changed).toBe(false);
    ctrl.dispose();
  });

  it('setEnabled(false) 禁用键盘输入', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const mockWin = (globalThis as Record<string, unknown>).window as {
      dispatchEvent: (e: unknown) => boolean;
    };
    ctrl.setEnabled(false);
    mockWin.dispatchEvent(keyEvent('KeyW', 'keydown'));
    const changed = ctrl.update(0.1);
    expect(changed).toBe(false);
    expect(cam.position.z).toBe(0);
    ctrl.dispose();
  });

  it('onChange 在移动时触发', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    const mockWin = (globalThis as Record<string, unknown>).window as {
      dispatchEvent: (e: unknown) => boolean;
    };
    let fired = 0;
    ctrl.onChange = () => { fired++; };
    mockWin.dispatchEvent(keyEvent('KeyW', 'keydown'));
    ctrl.update(0.1);
    expect(fired).toBe(1);
    ctrl.dispose();
  });

  it('dispose 可安全调用两次', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    ctrl.dispose();
    expect(() => ctrl.dispose()).not.toThrow();
  });

  it('dispose 后 domElement.style.touchAction 恢复为空', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new FlyControls(cam, el);
    expect((el as unknown as { style: { touchAction: string } }).style.touchAction).toBe('none');
    ctrl.dispose();
    expect((el as unknown as { style: { touchAction: string } }).style.touchAction).toBe('');
  });
});

// PointerLockControls 单元测试（数据层，不依赖真实 WebGL/DOM）。

import { describe, it, expect } from 'vitest';
import { PointerLockControls } from './PointerLockControls';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Vector3 } from '../Math/Vector3';

/** 创建最小 mock HTMLElement + ownerDocument，满足 PointerLockControls 需求。 */
function createMockElement(): { el: HTMLElement; doc: Document } {
  const docListeners = new Map<string, Set<(e: unknown) => void>>();
  const doc = {
    pointerLockElement: null as Element | null,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      docListeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: { type: string }) {
      docListeners.get(e.type)?.forEach((fn) => fn(e));
      return true;
    },
    exitPointerLock() { /* mock */ },
  };
  const el = {
    ownerDocument: doc,
    style: { touchAction: '' } as Record<string, string>,
    requestPointerLock() { /* mock */ },
    addEventListener() { /* 不在此测试中直接使用 */ },
    removeEventListener() { /* mock */ },
  };
  return { el: el as unknown as HTMLElement, doc: doc as unknown as Document };
}

describe('PointerLockControls', () => {
  it('构造时设置默认参数', () => {
    const cam = new PerspectiveCamera();
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    expect(ctrl.isLocked).toBe(false);
    expect(ctrl.minPolarAngle).toBe(0);
    expect(ctrl.maxPolarAngle).toBe(Math.PI);
    expect(ctrl.pointerSpeed).toBe(1.0);
    ctrl.dispose();
  });

  it('构造时接受自定义参数', () => {
    const cam = new PerspectiveCamera();
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el, {
      minPolarAngle: 0.1,
      maxPolarAngle: Math.PI - 0.1,
      pointerSpeed: 2.0,
    });
    expect(ctrl.minPolarAngle).toBe(0.1);
    expect(ctrl.maxPolarAngle).toBeCloseTo(Math.PI - 0.1, 5);
    expect(ctrl.pointerSpeed).toBe(2.0);
    ctrl.dispose();
  });

  it('lock() 调用 domElement.requestPointerLock', () => {
    const cam = new PerspectiveCamera();
    const { el } = createMockElement();
    let called = 0;
    (el as unknown as { requestPointerLock: () => void }).requestPointerLock = () => { called++; };
    const ctrl = new PointerLockControls(cam, el);
    ctrl.lock();
    expect(called).toBe(1);
    ctrl.dispose();
  });

  it('unlock() 调用 document.exitPointerLock', () => {
    const cam = new PerspectiveCamera();
    const { el, doc } = createMockElement();
    let called = 0;
    (doc as unknown as { exitPointerLock: () => void }).exitPointerLock = () => { called++; };
    const ctrl = new PointerLockControls(cam, el);
    ctrl.unlock();
    expect(called).toBe(1);
    ctrl.dispose();
  });

  it('getDirection 返回归一化的 -Z 方向', () => {
    const cam = new PerspectiveCamera();
    // 默认 quaternion = identity → 方向 = (0,0,-1)
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    const v = new Vector3();
    const result = ctrl.getDirection(v);
    expect(result).toBe(v);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(-1, 5);
    ctrl.dispose();
  });

  it('moveForward 沿 xz 平面前进', () => {
    const cam = new PerspectiveCamera();
    // identity rotation → forward = (0,0,-1)
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    ctrl.moveForward(5);
    expect(cam.position.x).toBeCloseTo(0, 5);
    expect(cam.position.y).toBeCloseTo(0, 5);
    expect(cam.position.z).toBeCloseTo(-5, 5);
    ctrl.dispose();
  });

  it('moveForward 俯仰时保持 y 不变', () => {
    const cam = new PerspectiveCamera();
    // 设置相机俯仰 45°（绕 X 轴）
    cam.rotation.setFromEuler(-Math.PI / 4, 0, 0, 'XYZ');
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    const yBefore = cam.position.y;
    ctrl.moveForward(10);
    expect(cam.position.y).toBeCloseTo(yBefore, 5);
    // xz 平面上的移动距离应接近 10（因为俯仰45°，水平分量 = 10*cos45°）
    const horizDist = Math.hypot(cam.position.x, cam.position.z);
    expect(horizDist).toBeCloseTo(10, 1);
    ctrl.dispose();
  });

  it('moveRight 沿 xz 平面右移', () => {
    const cam = new PerspectiveCamera();
    // identity rotation → right = (1,0,0)
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    ctrl.moveRight(3);
    expect(cam.position.x).toBeCloseTo(3, 5);
    expect(cam.position.y).toBeCloseTo(0, 5);
    expect(cam.position.z).toBeCloseTo(0, 5);
    ctrl.dispose();
  });

  it('setEnabled(false) 禁用 moveForward/moveRight', () => {
    const cam = new PerspectiveCamera();
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    ctrl.setEnabled(false);
    ctrl.moveForward(5);
    ctrl.moveRight(3);
    expect(cam.position.x).toBe(0);
    expect(cam.position.z).toBe(0);
    ctrl.dispose();
  });

  it('isLocked 初始为 false', () => {
    const cam = new PerspectiveCamera();
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    expect(ctrl.isLocked).toBe(false);
    ctrl.dispose();
  });

  it('dispose 可安全调用两次', () => {
    const cam = new PerspectiveCamera();
    const { el } = createMockElement();
    const ctrl = new PointerLockControls(cam, el);
    ctrl.dispose();
    expect(() => ctrl.dispose()).not.toThrow();
  });
});

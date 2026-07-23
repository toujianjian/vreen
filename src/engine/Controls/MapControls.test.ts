// MapControls 单元测试（数据层，不依赖真实 WebGL/DOM）。

import { describe, it, expect } from 'vitest';
import { MapControls } from './MapControls';
import { OrbitControls } from './OrbitControls';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Vector3 } from '../Math/Vector3';

/** 创建最小 mock HTMLElement，满足 OrbitControls/MapControls 事件挂载需求。 */
function createMockElement(): HTMLElement {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const el = {
    clientWidth: 800,
    clientHeight: 600,
    offsetWidth: 800,
    offsetHeight: 600,
    offsetLeft: 0,
    offsetTop: 0,
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
    setPointerCapture() { /* mock */ },
    releasePointerCapture() { /* mock */ },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };
    },
  };
  return el as unknown as HTMLElement;
}

describe('MapControls', () => {
  it('构造时 screenSpacePanning 默认 false', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    expect(ctrl.screenSpacePanning).toBe(false);
    ctrl.dispose();
  });

  it('构造时接受 screenSpacePanning=true', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new MapControls(cam, el, { screenSpacePanning: true });
    expect(ctrl.screenSpacePanning).toBe(true);
    ctrl.dispose();
  });

  it('继承 OrbitControls（instanceof）', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    expect(ctrl).toBeInstanceOf(OrbitControls);
    expect(ctrl).toBeInstanceOf(MapControls);
    ctrl.dispose();
  });

  it('继承 OrbitControls 的公开属性', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new MapControls(cam, el, {
      enableDamping: false,
      rotateSpeed: 2.0,
      zoomSpeed: 1.5,
      minDistance: 1,
      maxDistance: 100,
    });
    expect(ctrl.enableDamping).toBe(false);
    expect(ctrl.rotateSpeed).toBe(2.0);
    expect(ctrl.zoomSpeed).toBe(1.5);
    expect(ctrl.minDistance).toBe(1);
    expect(ctrl.maxDistance).toBe(100);
    ctrl.dispose();
  });

  it('panByWorldDelta 在 ground 模式下 y 分量为 0', () => {
    const cam = new PerspectiveCamera();
    // 把相机放高一点，target 在原点
    cam.position.set(0, 10, 10);
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    const targetYBefore = ctrl.target.y;
    ctrl.panByWorldDelta(5, 5, 0);
    // 地面平面平移 → target.y 不变
    expect(ctrl.target.y).toBeCloseTo(targetYBefore, 5);
    ctrl.dispose();
  });

  it('panByWorldDelta 在 screen 模式下 y 分量可变化', () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 10, 10);
    const el = createMockElement();
    const ctrl = new MapControls(cam, el, { screenSpacePanning: true });
    const targetYBefore = ctrl.target.y;
    ctrl.panByWorldDelta(0, 5, 0);
    // 屏幕空间平移 → target.y 变化（camUp 方向有 y 分量）
    expect(Math.abs(ctrl.target.y - targetYBefore)).toBeGreaterThan(0.01);
    ctrl.dispose();
  });

  it('panByWorldDelta ground 模式位移方向正确', () => {
    const cam = new PerspectiveCamera();
    // 相机在 +Z 方向看原点：forward = (0,0,1)，right = forward × up = (-1,0,0)
    cam.position.set(0, 0, 10);
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    // x=1 → right * 1 = (-1,0,0)
    ctrl.panByWorldDelta(1, 0, 0);
    expect(ctrl.target.x).toBeCloseTo(-1, 5);
    expect(ctrl.target.z).toBeCloseTo(0, 5);
    ctrl.dispose();
  });

  it('panByWorldDelta ground 模式下 forward 分量沿 xz 平面', () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 10);
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    // y=1 → forward * 1 = (0,0,1)
    ctrl.panByWorldDelta(0, 1, 0);
    expect(ctrl.target.x).toBeCloseTo(0, 5);
    expect(ctrl.target.y).toBeCloseTo(0, 5);
    expect(ctrl.target.z).toBeCloseTo(1, 5);
    ctrl.dispose();
  });

  it('update() 不抛异常', () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 5, 10);
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    expect(() => ctrl.update()).not.toThrow();
    ctrl.dispose();
  });

  it('target 初始为 (0,0,0)', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    expect(ctrl.target.equals(new Vector3(0, 0, 0))).toBe(true);
    ctrl.dispose();
  });

  it('dispose 可安全调用', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    expect(() => ctrl.dispose()).not.toThrow();
    expect(() => ctrl.dispose()).not.toThrow();
  });

  it('setTarget 移动 target', () => {
    const cam = new PerspectiveCamera();
    const el = createMockElement();
    const ctrl = new MapControls(cam, el);
    ctrl.setTarget(new Vector3(1, 2, 3));
    expect(ctrl.target.x).toBeCloseTo(1, 5);
    expect(ctrl.target.y).toBeCloseTo(2, 5);
    expect(ctrl.target.z).toBeCloseTo(3, 5);
    ctrl.dispose();
  });
});

// TransformGizmo 单元测试。
// 覆盖:模式/目标/吸附/大小、拖拽流程(startDrag/updateDrag/endDrag/cancelDrag)、
// hitTest 射线命中、getGizmoTransform、applyTranslation/Rotation/Scale、snapValue、render。

import { describe, it, expect } from 'vitest';
import { TransformGizmo } from './TransformGizmo';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

describe('TransformGizmo', () => {
  // ── 构造与基础 ──────────────────────────────────────────────────

  it('constructs with sensible defaults', () => {
    const g = new TransformGizmo();
    expect(g.mode).toBe('translate');
    expect(g.target).toBeNull();
    expect(g.activeAxis).toBeNull();
    expect(g.snapEnabled).toBe(false);
    expect(g.translateSnap).toBe(0.25);
    expect(g.rotateSnap).toBe(15);
    expect(g.scaleSnap).toBe(0.25);
    expect(g.size).toBe(1);
    expect(g.isDragging).toBe(false);
    expect(g.dragStart).toBeNull();
    expect(g.hoverColor.r).toBeCloseTo(1, 6);
    expect(g.xColor.r).toBeCloseTo(1, 6);
    expect(g.yColor.g).toBeCloseTo(1, 6);
    expect(g.zColor.b).toBeCloseTo(1, 6);
  });

  // ── 模式 ────────────────────────────────────────────────────────

  it('setMode switches mode and resets drag state', () => {
    const g = new TransformGizmo();
    g.setMode('rotate');
    expect(g.getMode()).toBe('rotate');
    // 模拟进行中的拖拽状态
    g.activeAxis = 'x';
    g.isDragging = true;
    g.setMode('scale');
    expect(g.getMode()).toBe('scale');
    expect(g.activeAxis).toBeNull();
    expect(g.isDragging).toBe(false);
  });

  it('setMode is a no-op for same mode', () => {
    const g = new TransformGizmo();
    g.activeAxis = 'x';
    g.setMode('translate'); // same as default
    // 同模式不应清空活动轴
    expect(g.activeAxis).toBe('x');
  });

  // ── 目标 ────────────────────────────────────────────────────────

  it('setTarget / getTarget', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    expect(g.getTarget()).toBe(obj);
    g.setTarget(null);
    expect(g.getTarget()).toBeNull();
  });

  it('setTarget resets drag state', () => {
    const g = new TransformGizmo();
    g.activeAxis = 'x';
    g.isDragging = true;
    g.setTarget(new Object3D());
    expect(g.activeAxis).toBeNull();
    expect(g.isDragging).toBe(false);
  });

  // ── 大小 / 吸附 ─────────────────────────────────────────────────

  it('setSize updates size, clamps non-positive', () => {
    const g = new TransformGizmo();
    g.setSize(2.5);
    expect(g.size).toBe(2.5);
    g.setSize(0);
    expect(g.size).toBe(1);
    g.setSize(-3);
    expect(g.size).toBe(1);
  });

  it('setSnap toggles and updates positive steps only', () => {
    const g = new TransformGizmo();
    g.setSnap(true, 1, 45, 0.5);
    expect(g.snapEnabled).toBe(true);
    expect(g.translateSnap).toBe(1);
    expect(g.rotateSnap).toBe(45);
    expect(g.scaleSnap).toBe(0.5);
    // 非正步长被忽略
    g.setSnap(false, 0, -10, -1);
    expect(g.snapEnabled).toBe(false);
    expect(g.translateSnap).toBe(1);
    expect(g.rotateSnap).toBe(45);
    expect(g.scaleSnap).toBe(0.5);
  });

  it('setSnap with undefined steps keeps existing', () => {
    const g = new TransformGizmo();
    const origTranslate = g.translateSnap;
    g.setSnap(true);
    expect(g.snapEnabled).toBe(true);
    expect(g.translateSnap).toBe(origTranslate);
  });

  // ── snapValue ───────────────────────────────────────────────────

  it('snapValue rounds to step multiples', () => {
    const g = new TransformGizmo();
    expect(g.snapValue(1.4, 1)).toBe(1);
    expect(g.snapValue(1.6, 1)).toBe(2);
    expect(g.snapValue(-1.4, 1)).toBe(-1);
    expect(g.snapValue(2.5, 0.5)).toBe(2.5);
  });

  it('snapValue returns value when step <= 0', () => {
    const g = new TransformGizmo();
    expect(g.snapValue(1.7, 0)).toBe(1.7);
    expect(g.snapValue(1.7, -1)).toBe(1.7);
  });

  // ── getActiveAxis / isDraggingActive ────────────────────────────

  it('getActiveAxis / isDraggingActive reflect state', () => {
    const g = new TransformGizmo();
    expect(g.getActiveAxis()).toBeNull();
    expect(g.isDraggingActive()).toBe(false);
    g.activeAxis = 'y';
    g.isDragging = true;
    expect(g.getActiveAxis()).toBe('y');
    expect(g.isDraggingActive()).toBe(true);
  });

  // ── hitTest ─────────────────────────────────────────────────────

  it('hitTest returns null when no target', () => {
    const g = new TransformGizmo();
    expect(g.hitTest(new Vector3(0, 5, 0), new Vector3(0, -1, 0))).toBeNull();
  });

  it('hitTest hits X axis end', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    // 射线从 X 轴端上方垂直下落,只命中 X 端球
    const hit = g.hitTest(new Vector3(1, 5, 0), new Vector3(0, -1, 0));
    expect(hit).toBe('x');
  });

  it('hitTest hits Y axis end', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    // 从 Y 端球正上方稍偏 X,避免命中中心
    const hit = g.hitTest(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    expect(hit).toBe('y');
  });

  it('hitTest hits Z axis end', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    const hit = g.hitTest(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    expect(hit).toBe('z');
  });

  it('hitTest hits center (xyz) when ray passes only through origin', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    // 从 (5,5,5) 沿 (-1,-1,-1) 方向射线,穿过原点,远离所有轴端
    const dir = new Vector3(-1, -1, -1).normalize();
    const hit = g.hitTest(new Vector3(5, 5, 5), dir);
    expect(hit).toBe('xyz');
  });

  it('hitTest returns null when ray misses all handles', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    // 远离 Gizmo 的平行射线
    const hit = g.hitTest(new Vector3(50, 50, 50), new Vector3(0, 1, 0));
    expect(hit).toBeNull();
  });

  it('hitTest picks closest handle when multiple intersect', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    // 射线从 X 端上方下落,优先命中 X(距离近)而非中心
    const hit = g.hitTest(new Vector3(1, 5, 0), new Vector3(0, -1, 0));
    expect(hit).toBe('x');
  });

  it('hitTest does not start a drag', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    g.hitTest(new Vector3(1, 5, 0), new Vector3(0, -1, 0));
    expect(g.isDraggingActive()).toBe(false);
    expect(g.getActiveAxis()).toBeNull();
  });

  // ── startDrag / updateDrag / endDrag ────────────────────────────

  it('startDrag fails without target', () => {
    const g = new TransformGizmo();
    expect(g.startDrag('x', new Vector3(0, 5, 0), new Vector3(0, -1, 0))).toBe(false);
  });

  it('startDrag records dragStart snapshot and active axis', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    obj.position.set(1, 2, 3);
    g.setTarget(obj);
    const ok = g.startDrag('x', new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    expect(ok).toBe(true);
    expect(g.isDraggingActive()).toBe(true);
    expect(g.getActiveAxis()).toBe('x');
    expect(g.dragStart).not.toBeNull();
    expect(g.dragStart!.position.x).toBe(1);
    expect(g.dragStart!.position.y).toBe(2);
    expect(g.dragStart!.position.z).toBe(3);
  });

  it('updateDrag (translate) moves target along X axis', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    // 起始射线:从 (0,5,0) 朝下,投影到 X 轴得 t=0
    g.startDrag('x', new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    // 移动射线到 (2,5,0):投影到 X 轴得 t=2
    const changed = g.updateDrag(new Vector3(2, 5, 0), new Vector3(0, -1, 0));
    expect(changed).toBe(true);
    expect(obj.position.x).toBeCloseTo(2, 6);
    expect(obj.position.y).toBeCloseTo(0, 6);
    expect(obj.position.z).toBeCloseTo(0, 6);
  });

  it('updateDrag returns false when not dragging', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    expect(g.updateDrag(new Vector3(0, 5, 0), new Vector3(0, -1, 0))).toBe(false);
  });

  it('updateDrag (translate) applies snap when enabled', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.setSnap(true, 1, 90, 1); // 平移步长 1
    g.startDrag('x', new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    // 投影 t=2.4 → 吸附到 2
    g.updateDrag(new Vector3(2.4, 5, 0), new Vector3(0, -1, 0));
    expect(obj.position.x).toBeCloseTo(2, 6);
  });

  it('updateDrag (rotate) rotates target around axis', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.setMode('rotate');
    g.startDrag('y', new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    // 沿 Y 轴投影:射线从 X 方向偏移投影到 Y 轴
    g.updateDrag(new Vector3(1, 5, 0), new Vector3(0, -1, 0));
    // 旋转后四元数应非单位
    const r = obj.rotation;
    const isIdentity = r.x === 0 && r.y === 0 && r.z === 0 && r.w === 1;
    expect(isIdentity).toBe(false);
  });

  it('updateDrag (scale) scales target on single axis', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.setMode('scale');
    g.startDrag('x', new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    // delta>0 → 放大 X
    g.updateDrag(new Vector3(1, 5, 0), new Vector3(0, -1, 0));
    expect(obj.scale.x).toBeGreaterThan(1);
    // Y/Z 保持 1
    expect(obj.scale.y).toBeCloseTo(1, 6);
    expect(obj.scale.z).toBeCloseTo(1, 6);
  });

  it('updateDrag (scale xyz) uniformly scales', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.setMode('scale');
    // xyz 模式:沿射线方向投影 delta
    g.startDrag('xyz', new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    // 把射线起点拉远 → delta>0 → 放大
    g.updateDrag(new Vector3(0, 0, 6), new Vector3(0, 0, -1));
    expect(obj.scale.x).toBeGreaterThan(1);
    expect(obj.scale.y).toBeGreaterThan(1);
    expect(obj.scale.z).toBeGreaterThan(1);
  });

  it('endDrag clears drag state but keeps changes', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.startDrag('x', new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    g.updateDrag(new Vector3(2, 5, 0), new Vector3(0, -1, 0));
    g.endDrag();
    expect(g.isDraggingActive()).toBe(false);
    expect(g.getActiveAxis()).toBeNull();
    expect(g.dragStart).toBeNull();
    // 改动保留
    expect(obj.position.x).toBeCloseTo(2, 6);
  });

  // ── cancelDrag ──────────────────────────────────────────────────

  it('cancelDrag reverts target to dragStart snapshot', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    obj.position.set(5, 5, 5);
    g.setTarget(obj);
    g.startDrag('x', new Vector3(0, 5, 0), new Vector3(0, -1, 0));
    g.updateDrag(new Vector3(2, 5, 0), new Vector3(0, -1, 0));
    // 此时 position.x 已变
    g.cancelDrag();
    expect(obj.position.x).toBeCloseTo(5, 6);
    expect(obj.position.y).toBeCloseTo(5, 6);
    expect(obj.position.z).toBeCloseTo(5, 6);
    expect(g.isDraggingActive()).toBe(false);
    expect(g.dragStart).toBeNull();
  });

  it('cancelDrag without active drag is a no-op', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    obj.position.set(1, 1, 1);
    g.setTarget(obj);
    g.cancelDrag();
    expect(obj.position.x).toBe(1);
  });

  // ── getGizmoTransform ───────────────────────────────────────────

  it('getGizmoTransform returns identity when no target', () => {
    const g = new TransformGizmo();
    const m = g.getGizmoTransform();
    const e = m.elements;
    expect(e[12]).toBe(0);
    expect(e[13]).toBe(0);
    expect(e[14]).toBe(0);
    expect(e[0]).toBe(1);
    expect(e[5]).toBe(1);
    expect(e[10]).toBe(1);
  });

  it('getGizmoTransform encodes target position', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    obj.position.set(2, 3, 4);
    g.setTarget(obj);
    const m = g.getGizmoTransform();
    const e = m.elements;
    expect(e[12]).toBe(2);
    expect(e[13]).toBe(3);
    expect(e[14]).toBe(4);
  });

  // ── applyTranslation ────────────────────────────────────────────

  it('applyTranslation adds delta to position', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.applyTranslation(new Vector3(1, 2, 3));
    expect(obj.position.x).toBe(1);
    expect(obj.position.y).toBe(2);
    expect(obj.position.z).toBe(3);
  });

  it('applyTranslation snaps when enabled', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.setSnap(true, 1, 90, 1);
    g.applyTranslation(new Vector3(1.4, 2.6, -0.3));
    // 1.4→1, 2.6→3, -0.3→0
    expect(obj.position.x).toBeCloseTo(1, 6);
    expect(obj.position.y).toBeCloseTo(3, 6);
    expect(obj.position.z).toBeCloseTo(0, 6);
  });

  it('applyTranslation is a no-op without target', () => {
    const g = new TransformGizmo();
    g.applyTranslation(new Vector3(1, 1, 1));
    // 不应抛错
    expect(g.getTarget()).toBeNull();
  });

  // ── applyRotation ───────────────────────────────────────────────

  it('applyRotation multiplies quaternion delta into rotation', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    g.applyRotation(delta);
    // 旋转后四元数应等于 delta(identity * delta = delta)
    expect(obj.rotation.y).toBeCloseTo(delta.y, 6);
    expect(obj.rotation.w).toBeCloseTo(delta.w, 6);
  });

  it('applyRotation snaps angle when enabled', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.setSnap(false, 1, 90, 1);
    g.snapEnabled = true;
    // 100° 输入,吸附到 90°
    const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (100 * Math.PI) / 180);
    g.applyRotation(delta);
    const axis = new Vector3();
    const angle = obj.rotation.toAxisAngle(axis);
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  // ── applyScale ──────────────────────────────────────────────────

  it('applyScale multiplies scale components', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.applyScale(new Vector3(2, 0.5, 1));
    expect(obj.scale.x).toBeCloseTo(2, 6);
    expect(obj.scale.y).toBeCloseTo(0.5, 6);
    expect(obj.scale.z).toBeCloseTo(1, 6);
  });

  it('applyScale clamps to minimum 0.01', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.applyScale(new Vector3(0, 0, 0));
    expect(obj.scale.x).toBeGreaterThanOrEqual(0.01);
    expect(obj.scale.y).toBeGreaterThanOrEqual(0.01);
    expect(obj.scale.z).toBeGreaterThanOrEqual(0.01);
  });

  it('applyScale snaps when enabled', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    g.setSnap(true, 1, 90, 1);
    // (1,1,1) * 1.5 = 1.5 → 吸附到 2 (Math.round(1.5)=2)
    g.applyScale(new Vector3(1.5, 1.5, 1.5));
    expect(obj.scale.x).toBeCloseTo(2, 6);
    expect(obj.scale.y).toBeCloseTo(2, 6);
    expect(obj.scale.z).toBeCloseTo(2, 6);
  });

  // ── render ──────────────────────────────────────────────────────

  it('render returns null when no target', () => {
    const g = new TransformGizmo();
    expect(g.render()).toBeNull();
  });

  it('render returns data reflecting current state', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    obj.position.set(1, 2, 3);
    g.setTarget(obj);
    g.setMode('rotate');
    g.activeAxis = 'z';
    const data = g.render();
    expect(data).not.toBeNull();
    expect(data!.origin.x).toBe(1);
    expect(data!.origin.y).toBe(2);
    expect(data!.origin.z).toBe(3);
    expect(data!.mode).toBe('rotate');
    expect(data!.activeAxis).toBe('z');
    expect(data!.size).toBe(1);
    expect(data!.axes.x.x).toBe(1);
    expect(data!.axes.y.y).toBe(1);
    expect(data!.axes.z.z).toBe(1);
    expect(data!.colors.x.r).toBeCloseTo(1, 6);
    expect(data!.colors.hover.g).toBeCloseTo(1, 6);
  });

  it('render colors are clones (mutating data does not affect gizmo)', () => {
    const g = new TransformGizmo();
    g.setTarget(new Object3D());
    const data = g.render();
    data!.colors.x.r = 0.99;
    expect(g.xColor.r).not.toBe(0.99);
  });

  // ── 集成:hitTest → startDrag → updateDrag → endDrag ────────────

  it('full flow: hitTest then drag moves target', () => {
    const g = new TransformGizmo();
    const obj = new Object3D();
    g.setTarget(obj);
    const rayOrigin = new Vector3(1, 5, 0);
    const rayDir = new Vector3(0, -1, 0);
    const axis = g.hitTest(rayOrigin, rayDir);
    expect(axis).toBe('x');
    g.startDrag(axis as 'x', rayOrigin, rayDir);
    // 拖拽是相对增量:起始射线投影 t=1(手柄在 x=1),移到 x=3 → delta=2 → 位置 0+2=2
    const moved = g.updateDrag(new Vector3(3, 5, 0), rayDir);
    expect(moved).toBe(true);
    expect(obj.position.x).toBeCloseTo(2, 6);
    g.endDrag();
    expect(g.isDraggingActive()).toBe(false);
  });
});

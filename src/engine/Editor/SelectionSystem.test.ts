// SelectionSystem 单元测试。
// 覆盖:select/deselect/deselectAll/isSelected/getSelected/setHover/pick/事件监听。

import { describe, it, expect } from 'vitest';
import { SelectionSystem } from './SelectionSystem';
import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { BasicMaterial } from '../Core/Material';
import { Scene } from '../Core/Scene';
import { Raycaster } from '../Core/Raycaster';
import { Vector3 } from '../Math/Vector3';

/** 构造一个朝 +Z 法线的三角形 mesh,位于 z=0 平面。 */
function makeTriangleMesh(): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    -1, -1, 0, 1, -1, 0, 0, 1, 0,
  ]), 3));
  const m = new Mesh(g, new BasicMaterial());
  m.updateMatrixWorld(true);
  return m;
}

describe('SelectionSystem', () => {
  it('constructs with empty selection and null hover', () => {
    const s = new SelectionSystem();
    expect(s.selected.size).toBe(0);
    expect(s.hover).toBeNull();
    expect(s.multiSelect).toBe(false);
    expect(s.count).toBe(0);
  });

  it('select replaces by default', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    const b = new Object3D();
    s.select(a);
    expect(s.isSelected(a)).toBe(true);
    expect(s.count).toBe(1);
    s.select(b);
    expect(s.isSelected(a)).toBe(false);
    expect(s.isSelected(b)).toBe(true);
    expect(s.count).toBe(1);
  });

  it('select additive appends without clearing', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    const b = new Object3D();
    s.select(a);
    s.select(b, true);
    expect(s.isSelected(a)).toBe(true);
    expect(s.isSelected(b)).toBe(true);
    expect(s.count).toBe(2);
  });

  it('deselect removes only the specified object', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    const b = new Object3D();
    s.select(a);
    s.select(b, true);
    s.deselect(a);
    expect(s.isSelected(a)).toBe(false);
    expect(s.isSelected(b)).toBe(true);
    expect(s.count).toBe(1);
  });

  it('deselect on unselected object is a no-op', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    const b = new Object3D();
    s.select(a);
    s.deselect(b); // b 未选中
    expect(s.count).toBe(1);
    expect(s.isSelected(a)).toBe(true);
  });

  it('deselectAll clears selection', () => {
    const s = new SelectionSystem();
    s.select(new Object3D());
    s.select(new Object3D(), true);
    s.deselectAll();
    expect(s.count).toBe(0);
  });

  it('deselectAll on empty selection is a no-op (no event)', () => {
    const s = new SelectionSystem();
    let calls = 0;
    s.on(() => calls++);
    s.deselectAll();
    expect(calls).toBe(0);
  });

  it('getSelected returns a fresh array each call', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    s.select(a);
    const arr1 = s.getSelected();
    const arr2 = s.getSelected();
    expect(arr1).not.toBe(arr2);
    expect(arr1).toHaveLength(1);
    expect(arr1[0]).toBe(a);
    // 修改返回数组不影响内部状态
    arr1.length = 0;
    expect(s.count).toBe(1);
  });

  it('setHover updates hover and fires event only on change', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    let calls = 0;
    s.on(() => calls++);
    s.setHover(a);
    expect(s.getHover()).toBe(a);
    expect(calls).toBe(1);
    // 设置相同对象不触发
    s.setHover(a);
    expect(calls).toBe(1);
    s.setHover(null);
    expect(s.getHover()).toBeNull();
    expect(calls).toBe(2);
  });

  it('on returns an unsubscribe function', () => {
    const s = new SelectionSystem();
    let calls = 0;
    const off = s.on(() => calls++);
    s.select(new Object3D());
    expect(calls).toBe(1);
    off();
    s.select(new Object3D());
    expect(calls).toBe(1);
  });

  it('pick with no hit clears selection in single-select mode', () => {
    const s = new SelectionSystem();
    const scene = new Scene();
    const mesh = makeTriangleMesh();
    scene.add(mesh);
    s.select(mesh);

    // 射线远离 mesh,无命中
    const r = new Raycaster(new Vector3(100, 100, 100), new Vector3(0, 0, -1));
    const hit = s.pick(r, scene);
    expect(hit).toBeNull();
    expect(s.count).toBe(0);
  });

  it('pick with no hit in multiSelect mode keeps selection', () => {
    const s = new SelectionSystem();
    s.multiSelect = true;
    const scene = new Scene();
    const mesh = makeTriangleMesh();
    scene.add(mesh);
    s.select(mesh);

    const r = new Raycaster(new Vector3(100, 100, 100), new Vector3(0, 0, -1));
    s.pick(r, scene);
    expect(s.count).toBe(1);
    expect(s.isSelected(mesh)).toBe(true);
  });

  it('pick selects the closest hit object (single-select)', () => {
    const s = new SelectionSystem();
    const scene = new Scene();
    const mesh = makeTriangleMesh();
    scene.add(mesh);

    // 射线从 +Z 方向打向原点,会命中三角形
    const r = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = s.pick(r, scene);
    expect(hit).not.toBeNull();
    expect(hit!.object).toBe(mesh);
    expect(s.isSelected(mesh)).toBe(true);
    expect(s.count).toBe(1);
  });

  it('pick toggles selection in multiSelect mode', () => {
    const s = new SelectionSystem();
    s.multiSelect = true;
    const scene = new Scene();
    const mesh = makeTriangleMesh();
    scene.add(mesh);

    const r = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    s.pick(r, scene);
    expect(s.isSelected(mesh)).toBe(true);
    // 再次拾取同一对象 → toggle 取消
    s.pick(r, scene);
    expect(s.isSelected(mesh)).toBe(false);
  });

  it('pick appends in multiSelect mode', () => {
    const s = new SelectionSystem();
    s.multiSelect = true;
    const scene = new Scene();
    const mesh1 = makeTriangleMesh();
    mesh1.position.set(0, 0, 0);
    mesh1.updateMatrixWorld(true);
    const mesh2 = makeTriangleMesh();
    mesh2.position.set(0, 0, -2);
    mesh2.updateMatrixWorld(true);
    scene.add(mesh1);
    scene.add(mesh2);

    // 第一条射线命中 mesh1(在前)
    const r1 = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    s.pick(r1, scene);
    expect(s.count).toBe(1);
    expect(s.isSelected(mesh1)).toBe(true);

    // 第二条射线命中 mesh2(更远)
    // 用一条只命中 mesh2 的射线:从 mesh2 前方打
    const r2 = new Raycaster(new Vector3(0, 0, -1.5), new Vector3(0, 0, -1));
    s.pick(r2, scene);
    // mesh1 应仍选中(多选追加),mesh2 也选中
    expect(s.isSelected(mesh1)).toBe(true);
    expect(s.isSelected(mesh2)).toBe(true);
  });

  it('events fire with correct kind', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    const kinds: string[] = [];
    s.on((e) => kinds.push(e.kind));

    s.select(a);
    s.deselect(a);
    s.select(a);
    s.deselectAll();
    s.setHover(a);

    expect(kinds).toEqual(['select', 'deselect', 'select', 'deselectAll', 'hover']);
  });

  it('event primary is the operated object', () => {
    const s = new SelectionSystem();
    const a = new Object3D();
    let lastPrimary: Object3D | null = null;
    s.on((e) => { lastPrimary = e.primary; });
    s.select(a);
    expect(lastPrimary).toBe(a);
    s.deselectAll();
    expect(lastPrimary).toBeNull();
  });

  it('listener throwing does not break other listeners', () => {
    const s = new SelectionSystem();
    let secondCalled = false;
    s.on(() => { throw new Error('boom'); });
    s.on(() => { secondCalled = true; });
    s.select(new Object3D());
    expect(secondCalled).toBe(true);
  });

  it('clear() empties selection and fires clear event', () => {
    const s = new SelectionSystem();
    s.select(new Object3D());
    const kinds: string[] = [];
    s.on((e) => kinds.push(e.kind));
    s.clear();
    expect(s.count).toBe(0);
    // clear() 在 deselectAll 之后又触发一次 clear 事件
    expect(kinds).toContain('clear');
  });
});

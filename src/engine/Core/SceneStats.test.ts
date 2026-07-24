// SceneStats 单元测试。
// 验证 collect() 正确统计对象总数、可见数、脏数、Mesh/Light/Camera 计数。

import { describe, it, expect } from 'vitest';
import { Scene } from './Scene';
import { Group } from './Group';
import { DirtyFlag } from './Object3D';
import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { BasicMaterial } from './Material';
import { AmbientLight } from '../Lights/AmbientLight';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { SceneStats } from './SceneStats';

function makeMesh(): Mesh {
  return new Mesh(new BufferGeometry(), new BasicMaterial());
}

describe('SceneStats', () => {
  it('空场景:仅 Scene 根,初始全部为脏', () => {
    const scene = new Scene();
    const stats = new SceneStats().collect(scene);
    // Scene 根自身算 1 个对象,初始 _dirtyFlags=ALL_DIRTY
    expect(stats.totalObjects).toBe(1);
    expect(stats.visibleObjects).toBe(1);
    expect(stats.dirtyObjects).toBe(1);
    expect(stats.meshCount).toBe(0);
    expect(stats.lightCount).toBe(0);
    expect(stats.cameraCount).toBe(0);
  });

  it('统计各类节点:Mesh/Light/Camera/Group', () => {
    const scene = new Scene();
    scene.add(new Group());
    scene.add(makeMesh());
    scene.add(makeMesh());
    scene.add(new AmbientLight());
    scene.add(new PerspectiveCamera());

    const stats = new SceneStats().collect(scene);
    // root(Group)+Group+2*Mesh+Light+Camera = 6
    expect(stats.totalObjects).toBe(6);
    expect(stats.meshCount).toBe(2);
    expect(stats.lightCount).toBe(1);
    expect(stats.cameraCount).toBe(1);
  });

  it('visible=false 的对象不计入 visibleObjects', () => {
    const scene = new Scene();
    const hidden = new Group();
    hidden.visible = false;
    scene.add(hidden);
    scene.add(new Group());

    const stats = new SceneStats().collect(scene);
    // root + hidden + visible = 3 总数;visibleObjects = root + visible = 2
    expect(stats.totalObjects).toBe(3);
    expect(stats.visibleObjects).toBe(2);
  });

  it('updateMatrixWorld(true) 后 dirtyObjects 归零', () => {
    const scene = new Scene();
    scene.add(new Group());
    scene.add(makeMesh());

    // 初始全部为脏
    let stats = new SceneStats().collect(scene);
    expect(stats.dirtyObjects).toBe(3);

    // 强制更新后清除所有脏标记
    scene.updateMatrixWorld(true);
    stats = new SceneStats().collect(scene);
    expect(stats.dirtyObjects).toBe(0);
  });

  it('position.set 只标记自身和后代为脏', () => {
    const scene = new Scene();
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    scene.add(parent);

    // 清除所有脏标记
    scene.updateMatrixWorld(true);
    let stats = new SceneStats().collect(scene);
    expect(stats.dirtyObjects).toBe(0);

    // 移动 parent → parent 和 child 变脏,scene 根不变
    parent.position.set(1, 2, 3);
    stats = new SceneStats().collect(scene);
    // parent + child = 2 个脏
    expect(stats.dirtyObjects).toBe(2);
  });

  it('reset 清零所有计数', () => {
    const scene = new Scene();
    scene.add(makeMesh());
    const stats = new SceneStats();
    stats.collect(scene);
    expect(stats.totalObjects).toBeGreaterThan(0);

    stats.reset();
    expect(stats.totalObjects).toBe(0);
    expect(stats.visibleObjects).toBe(0);
    expect(stats.dirtyObjects).toBe(0);
    expect(stats.meshCount).toBe(0);
  });

  it('snapshot 返回不可变快照', () => {
    const scene = new Scene();
    scene.add(makeMesh());
    const stats = new SceneStats();
    const data = stats.collect(scene);
    const snap = stats.snapshot();

    expect(snap).toEqual(data);
    expect(snap.totalObjects).toBe(2);
    // 修改 snap 不影响 stats 内部状态
    snap.totalObjects = 999;
    expect(stats.totalObjects).toBe(2);
  });

  it('嵌套层级正确统计总数', () => {
    const scene = new Scene();
    // scene → a → b → c (3 层嵌套)
    const a = new Group();
    const b = new Group();
    const c = new Group();
    b.add(c);
    a.add(b);
    scene.add(a);

    const stats = new SceneStats().collect(scene);
    // scene + a + b + c = 4
    expect(stats.totalObjects).toBe(4);
  });

  it('DirtyFlag.BOUNDS 标记不计入 dirtyObjects(只统计 MATRIX_WORLD)', () => {
    const scene = new Scene();
    const obj = new Group();
    scene.add(obj);

    scene.updateMatrixWorld(true);
    // 只标记 BOUNDS,不标记 MATRIX_WORLD
    obj.markDirty(DirtyFlag.BOUNDS);

    const stats = new SceneStats().collect(scene);
    // dirtyObjects 统计 MATRIX_WORLD,BOUNS 不算
    expect(stats.dirtyObjects).toBe(0);
    expect(obj.isDirty(DirtyFlag.BOUNDS)).toBe(true);
  });
});

// LOD 单元测试。
//
// 用一个 mock camera(只需 matrixWorld 平移列)测试距离切换 + 滞后逻辑。

import { describe, it, expect } from 'vitest';
import { LOD } from './LOD';
import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Camera } from '../Cameras/Camera';

function makeMesh(): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  return new Mesh(g, new StandardMaterial());
}

/** 构造一个世界位置为 (x,y,z) 的 camera(更新 matrixWorld)。 */
function makeCameraAt(x: number, y: number, z: number): Camera {
  class StubCam extends Camera {
    updateProjectionMatrix(): void { /* noop */ }
  }
  const c = new StubCam();
  c.position.set(x, y, z);
  c.updateMatrixWorld(true);
  return c;
}

describe('LOD', () => {
  it('addLevel inserts in distance-ascending order and adds as child', () => {
    const lod = new LOD();
    const hi = makeMesh(), mid = makeMesh(), lo = makeMesh();
    lod.addLevel(lo, 60);
    lod.addLevel(hi, 0);
    lod.addLevel(mid, 20);
    expect(lod.levels.map((l) => l.distance)).toEqual([0, 20, 60]);
    expect(lod.levels[0].object).toBe(hi);
    expect(lod.children).toHaveLength(3);
  });

  it('initial visibility shows only level 0', () => {
    const lod = new LOD();
    const a = makeMesh(), b = makeMesh();
    lod.addLevel(a, 0).addLevel(b, 10);
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);
  });

  it('update picks the closest level whose distance <= camera distance', () => {
    const lod = new LOD();
    const a = makeMesh(), b = makeMesh(), c = makeMesh();
    lod.addLevel(a, 0).addLevel(b, 10).addLevel(c, 60);
    lod.updateMatrixWorld(true);

    // camera at distance 5 → level 0
    lod.update(makeCameraAt(5, 0, 0));
    expect(lod.currentLevel).toBe(0);
    expect(a.visible).toBe(true);

    // camera at distance 30 → level 1
    lod.update(makeCameraAt(30, 0, 0));
    expect(lod.currentLevel).toBe(1);
    expect(b.visible).toBe(true);
    expect(a.visible).toBe(false);

    // camera at distance 100 → level 2
    lod.update(makeCameraAt(100, 0, 0));
    expect(lod.currentLevel).toBe(2);
    expect(c.visible).toBe(true);
  });

  it('update returns -1 for empty LOD', () => {
    const lod = new LOD();
    expect(lod.update(makeCameraAt(0, 0, 0))).toBe(-1);
  });

  it('hysteresis prevents flickering at threshold boundary', () => {
    const lod = new LOD();
    lod.hysteresis = 2;
    const a = makeMesh(), b = makeMesh();
    lod.addLevel(a, 0).addLevel(b, 10);
    lod.updateMatrixWorld(true);

    // 从近到远:距离 10.5(刚过 10)→ 有滞后 2,需 > 12 才切
    lod.update(makeCameraAt(10.5, 0, 0));
    expect(lod.currentLevel).toBe(0); // 仍 level 0(滞后)

    // 距离 13 → 超过 10+2 → 切到 level 1
    lod.update(makeCameraAt(13, 0, 0));
    expect(lod.currentLevel).toBe(1);

    // 从远到近:距离 9.5(刚低于 10)→ 需 < 10-2=8 才切回
    lod.update(makeCameraAt(9.5, 0, 0));
    expect(lod.currentLevel).toBe(1); // 仍 level 1(滞后)

    // 距离 7 → 切回 level 0
    lod.update(makeCameraAt(7, 0, 0));
    expect(lod.currentLevel).toBe(0);
  });

  it('getObject returns current visible level', () => {
    const lod = new LOD();
    const a = makeMesh(), b = makeMesh();
    lod.addLevel(a, 0).addLevel(b, 10);
    lod.updateMatrixWorld(true);
    lod.update(makeCameraAt(50, 0, 0));
    expect(lod.getObject()).toBe(b);
  });

  it('getObject returns null for empty LOD', () => {
    const lod = new LOD();
    expect(lod.getObject()).toBeNull();
  });

  it('clearLevels removes all levels and children', () => {
    const lod = new LOD();
    const a = makeMesh(), b = makeMesh();
    lod.addLevel(a, 0).addLevel(b, 10);
    lod.clearLevels();
    expect(lod.levels).toHaveLength(0);
    expect(lod.children).toHaveLength(0);
    expect(lod.currentLevel).toBe(-1);
  });

  it('distance clamped to >= 0', () => {
    const lod = new LOD();
    const a = makeMesh();
    lod.addLevel(a, -5);
    expect(lod.levels[0].distance).toBe(0);
  });

  it('isLOD flag and type', () => {
    const lod = new LOD();
    expect(lod.isLOD).toBe(true);
    expect(lod.type).toBe('LOD');
  });

  // ── 新增 API:removeLevel / getCurrentLevel / getLevels / clone / autoUpdate ──

  it('autoUpdate defaults to true', () => {
    const lod = new LOD();
    expect(lod.autoUpdate).toBe(true);
    lod.autoUpdate = false;
    expect(lod.autoUpdate).toBe(false);
  });

  it('removeLevel removes by index and detaches child', () => {
    const lod = new LOD();
    const a = makeMesh(), b = makeMesh(), c = makeMesh();
    lod.addLevel(a, 0).addLevel(b, 10).addLevel(c, 60);
    // levels: [a@0, b@10, c@60]
    expect(lod.removeLevel(1)).toBe(true);
    expect(lod.levels.map((l) => l.distance)).toEqual([0, 60]);
    expect(lod.levels[0].object).toBe(a);
    expect(lod.levels[1].object).toBe(c);
    // b 已从 children 移除
    expect(lod.children).toHaveLength(2);
    expect(lod.children.includes(b)).toBe(false);
  });

  it('removeLevel returns false for out-of-range index', () => {
    const lod = new LOD();
    lod.addLevel(makeMesh(), 0);
    expect(lod.removeLevel(1)).toBe(false);
    expect(lod.removeLevel(-1)).toBe(false);
    // 空 LOD
    const empty = new LOD();
    expect(empty.removeLevel(0)).toBe(false);
  });

  it('removeLevel recomputes visibility when current level is removed', () => {
    const lod = new LOD();
    const a = makeMesh(), b = makeMesh(), c = makeMesh();
    lod.addLevel(a, 0).addLevel(b, 10).addLevel(c, 60);
    lod.updateMatrixWorld(true);
    // 距离 100 → 切到 level 2 (c)
    lod.update(makeCameraAt(100, 0, 0));
    expect(lod.currentLevel).toBe(2);
    expect(c.visible).toBe(true);
    // 移除当前 level 2(c)→ currentLevel 收缩到 1(b),可见性切换
    lod.removeLevel(2);
    expect(lod.currentLevel).toBe(1);
    expect(b.visible).toBe(true);
    // c 已被 LOD 移除 → visible 置 false(不再由 LOD 管理,避免误渲染)
    expect(c.visible).toBe(false);
    expect(a.visible).toBe(false);
  });

  it('removeLevel on the only level sets currentLevel to -1', () => {
    const lod = new LOD();
    const a = makeMesh();
    lod.addLevel(a, 0);
    lod.removeLevel(0);
    expect(lod.levels).toHaveLength(0);
    expect(lod.currentLevel).toBe(-1);
    expect(lod.children).toHaveLength(0);
  });

  it('getCurrentLevel returns currentLevel field', () => {
    const lod = new LOD();
    lod.addLevel(makeMesh(), 0).addLevel(makeMesh(), 10);
    lod.updateMatrixWorld(true);
    lod.update(makeCameraAt(50, 0, 0));
    expect(lod.getCurrentLevel()).toBe(lod.currentLevel);
    expect(lod.getCurrentLevel()).toBe(1);
  });

  it('getCurrentLevel returns -1 for empty LOD', () => {
    const lod = new LOD();
    expect(lod.getCurrentLevel()).toBe(0); // 初始字段值
    lod.update(makeCameraAt(0, 0, 0)); // 空 → -1
    expect(lod.getCurrentLevel()).toBe(-1);
  });

  it('getLevels returns the levels array reference', () => {
    const lod = new LOD();
    lod.addLevel(makeMesh(), 0).addLevel(makeMesh(), 10);
    const levels = lod.getLevels();
    expect(levels).toBe(lod.levels); // 同一引用
    expect(levels.map((l) => l.distance)).toEqual([0, 10]);
  });

  it('getLevels returns empty array for empty LOD', () => {
    const lod = new LOD();
    const levels = lod.getLevels();
    expect(levels).toBe(lod.levels);
    expect(levels).toHaveLength(0);
  });

  it('clone produces an independent LOD with cloned levels', () => {
    const lod = new LOD();
    lod.hysteresis = 1.5;
    lod.autoUpdate = false;
    lod.position.set(1, 2, 3);
    lod.name = 'srcLOD';
    const a = makeMesh(), b = makeMesh();
    a.name = 'hi';
    b.name = 'lo';
    lod.addLevel(a, 0).addLevel(b, 10);

    const clone = lod.clone();
    expect(clone).not.toBe(lod);
    expect(clone.isLOD).toBe(true);
    expect(clone.hysteresis).toBe(1.5);
    expect(clone.autoUpdate).toBe(false);
    expect(clone.name).toBe('srcLOD');
    expect(clone.position.toArray()).toEqual([1, 2, 3]);
    // levels 数量一致
    expect(clone.levels).toHaveLength(2);
    expect(clone.levels.map((l) => l.distance)).toEqual([0, 10]);
    // 子节点是不同的 Mesh 实例(浅拷贝)
    expect(clone.levels[0].object).not.toBe(a);
    expect(clone.levels[1].object).not.toBe(b);
    // 但共享 geometry/material 引用
    expect(clone.levels[0].object.geometry).toBe(a.geometry);
    expect(clone.levels[0].object.material).toBe(a.material);
    // 名字也拷贝过去
    expect(clone.levels[0].object.name).toBe('hi');
    expect(clone.levels[1].object.name).toBe('lo');
    // clone 自身也是 Object3D 子节点结构(独立 children)
    expect(clone.children).not.toBe(lod.children);
    expect(clone.children).toHaveLength(2);
  });

  it('clone of empty LOD returns empty LOD', () => {
    const lod = new LOD();
    lod.hysteresis = 3;
    const clone = lod.clone();
    expect(clone.levels).toHaveLength(0);
    expect(clone.hysteresis).toBe(3);
  });

  it('clone preserves per-level hysteresis override', () => {
    const lod = new LOD();
    lod.hysteresis = 0; // 默认
    lod.addLevel(makeMesh(), 0, 5); // 显式 hysteresis=5
    lod.addLevel(makeMesh(), 10);   // 用默认 0
    const clone = lod.clone();
    expect(clone.levels[0].hysteresis).toBe(5);
    expect(clone.levels[1].hysteresis).toBe(0);
  });
});

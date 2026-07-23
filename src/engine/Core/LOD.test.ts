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
});

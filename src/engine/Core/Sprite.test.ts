// Sprite 单元测试。
//
// 测试环境为 node(无 WebGL),所有测试只验证数据层:
//   * 构造与默认属性
//   * geometry 顶点/索引结构
//   * updateMatrixWorld 在无 camera 时退化为 Object3D 行为
//   * updateMatrixWorld 在有 camera 时把相机世界旋转写入 matrixWorld
//   * raycast 在无 camera 时告警且不命中
//   * raycast 在有 camera 时正面命中

import { describe, it, expect } from 'vitest';
import { Sprite } from './Sprite';
import { SpriteMaterial } from '../Materials/SpriteMaterial';
import { Object3D, DirtyFlag } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import { Vector2 } from '../Math/Vector2';
import { Vector3 } from '../Math/Vector3';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Raycaster } from './Raycaster';

describe('Sprite', () => {
  it('constructs with sensible defaults', () => {
    const mat = new SpriteMaterial();
    const s = new Sprite(mat);
    expect(s.isSprite).toBe(true);
    expect(s.type).toBe('Sprite');
    expect(s.material).toBe(mat);
    expect(s.center).toEqual(new Vector2(0.5, 0.5));
    expect(s.geometry).toBeInstanceOf(BufferGeometry);
  });

  it('extends Object3D', () => {
    expect(new Sprite(new SpriteMaterial())).toBeInstanceOf(Object3D);
  });

  it('geometry has 4 vertices and 6 indices (2 triangles)', () => {
    const s = new Sprite(new SpriteMaterial());
    const g = s.geometry;
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const idx = g.index;
    expect(pos).toBeDefined();
    expect(uv).toBeDefined();
    expect(idx).toBeDefined();
    expect(pos!.count).toBe(4);
    expect(uv!.count).toBe(4);
    expect(idx!.count).toBe(6);
  });

  it('geometry unit quad spans -0.5..0.5 on x and y', () => {
    const s = new Sprite(new SpriteMaterial());
    const pos = s.geometry.getAttribute('position')!.array as Float32Array;
    const xs = [pos[0], pos[3], pos[6], pos[9]];
    const ys = [pos[1], pos[4], pos[7], pos[10]];
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(0.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 6);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 6);
  });

  it('updateMatrixWorld without camera behaves like Object3D', () => {
    const s = new Sprite(new SpriteMaterial());
    s.position.set(1, 2, 3);
    s.scale.set(2, 2, 2);
    s.updateMatrixWorld(true);

    const e = s.matrixWorld.elements;
    // 位置列保持
    expect(e[12]).toBeCloseTo(1, 6);
    expect(e[13]).toBeCloseTo(2, 6);
    expect(e[14]).toBeCloseTo(3, 6);
    // scale 列长度为 2
    expect(Math.hypot(e[0], e[1], e[2])).toBeCloseTo(2, 6);
    expect(Math.hypot(e[4], e[5], e[6])).toBeCloseTo(2, 6);
    expect(Math.hypot(e[8], e[9], e[10])).toBeCloseTo(2, 6);
  });

  it('updateMatrixWorld with camera writes camera rotation into matrixWorld', () => {
    const s = new Sprite(new SpriteMaterial());
    s.position.set(0, 0, 0);
    s.scale.set(1, 1, 1);

    // 构造一个绕 Y 轴 90 度旋转的相机(看向 +X)
    // 注意:Quaternion.setFromEuler 是直接写字段,不会触发 _BoundQuaternion
    // 的 markDirty;这里手动补一次 markDirty 让 updateMatrixWorld 重算 matrix。
    const cam = new PerspectiveCamera();
    cam.rotation.setFromEuler(0, Math.PI / 2, 0, 'XYZ');
    cam.markDirty(DirtyFlag.MATRIX | DirtyFlag.MATRIX_WORLD);
    cam.updateMatrixWorld(true);

    s.updateMatrixWorld(true, cam);

    const camE = cam.matrixWorld.elements;
    const myE = s.matrixWorld.elements;
    // 旋转 3x3 部分应与相机一致(单位 scale)
    for (let i = 0; i < 3; i++) {
      expect(myE[i * 4 + 0]).toBeCloseTo(camE[i * 4 + 0], 6);
      expect(myE[i * 4 + 1]).toBeCloseTo(camE[i * 4 + 1], 6);
      expect(myE[i * 4 + 2]).toBeCloseTo(camE[i * 4 + 2], 6);
    }
  });

  it('updateMatrixWorld preserves sprite position and scale when billboarding', () => {
    const s = new Sprite(new SpriteMaterial());
    s.position.set(5, 0, 0);
    s.scale.set(2, 3, 1);

    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld(true);

    s.updateMatrixWorld(true, cam);

    const e = s.matrixWorld.elements;
    // 位置保持 (5, 0, 0)
    expect(e[12]).toBeCloseTo(5, 6);
    expect(e[13]).toBeCloseTo(0, 6);
    expect(e[14]).toBeCloseTo(0, 6);
    // scale 保持 (2, 3, 1)
    expect(Math.hypot(e[0], e[1], e[2])).toBeCloseTo(2, 6);
    expect(Math.hypot(e[4], e[5], e[6])).toBeCloseTo(3, 6);
    expect(Math.hypot(e[8], e[9], e[10])).toBeCloseTo(1, 6);
  });

  it('raycast without camera warns and does not push intersection', () => {
    const s = new Sprite(new SpriteMaterial());
    s.position.set(0, 0, 0);
    s.updateMatrixWorld(true);

    const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    // 不调 setFromCamera → camera = null
    const intersects: unknown[] = [];
    const warn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    s.raycast(raycaster, intersects as never);
    console.warn = warn;

    expect(warned).toBe(true);
    expect(intersects.length).toBe(0);
  });

  it('raycast hits a unit sprite facing the camera', () => {
    const s = new Sprite(new SpriteMaterial());
    s.position.set(0, 0, 0);
    s.scale.set(1, 1, 1);
    s.updateMatrixWorld(true);

    // 相机位于 (0,0,5),朝向 -Z(默认朝向),matrixWorld 含平移
    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld(true);

    const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    raycaster.camera = cam;

    const intersects: { distance: number; point: Vector3; object: unknown }[] = [];
    s.raycast(raycaster, intersects as never);

    expect(intersects.length).toBe(1);
    expect(intersects[0].distance).toBeCloseTo(5, 5);
    expect(intersects[0].point.x).toBeCloseTo(0, 5);
    expect(intersects[0].point.y).toBeCloseTo(0, 5);
    expect(intersects[0].point.z).toBeCloseTo(0, 5);
    expect(intersects[0].object).toBe(s);
  });

  it('raycast misses when ray points away from sprite', () => {
    const s = new Sprite(new SpriteMaterial());
    s.position.set(0, 0, 0);
    s.updateMatrixWorld(true);

    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld(true);

    // 射线朝 +Z,远离 sprite
    const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, 1));
    raycaster.camera = cam;

    const intersects: unknown[] = [];
    s.raycast(raycaster, intersects as never);
    expect(intersects.length).toBe(0);
  });

  it('raycast respects near/far bounds', () => {
    const s = new Sprite(new SpriteMaterial());
    s.position.set(0, 0, 0);
    s.updateMatrixWorld(true);

    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld(true);

    // near=10 远超命中距离 5 → 不命中
    const rc1 = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1), 10, 100);
    rc1.camera = cam;
    const hits1: unknown[] = [];
    s.raycast(rc1, hits1 as never);
    expect(hits1.length).toBe(0);

    // far=1 小于命中距离 5 → 不命中
    const rc2 = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1), 0, 1);
    rc2.camera = cam;
    const hits2: unknown[] = [];
    s.raycast(rc2, hits2 as never);
    expect(hits2.length).toBe(0);
  });

  it('material.rotation affects raycast by rotating the quad', () => {
    // 旋转 90 度后,原 x 轴对齐的 quad 变为 y 轴对齐;
    // 沿 (0,0,-1) 的射线仍命中中心,验证旋转路径不报错。
    const mat = new SpriteMaterial({ rotation: Math.PI / 2 });
    const s = new Sprite(mat);
    s.position.set(0, 0, 0);
    s.updateMatrixWorld(true);

    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld(true);

    const rc = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    rc.camera = cam;
    const hits: { distance: number }[] = [];
    s.raycast(rc, hits as never);
    expect(hits.length).toBe(1);
    expect(hits[0].distance).toBeCloseTo(5, 5);
  });

  it('center offset shifts the sprite relative to its position', () => {
    // center=(0,0) → quad 顶点经 (v - center + 0.5) 变换后位于 [0, 1] × [0, 1]
    // 而非默认 center=(0.5,0.5) 时的 [-0.5, 0.5] × [-0.5, 0.5]
    // 因此 ray 在 x=0.5 命中(quad 内部),在 x=-0.5 不命中(quad 外部)
    const s = new Sprite(new SpriteMaterial());
    s.center.set(0, 0);
    s.position.set(0, 0, 0);
    s.updateMatrixWorld(true);

    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld(true);

    // 命中:(0.5, 0, 5) → (0.5, 0, 0),在 quad x∈[0,1] 内部
    const rcHit = new Raycaster(new Vector3(0.5, 0.5, 5), new Vector3(0, 0, -1));
    rcHit.camera = cam;
    const hits: unknown[] = [];
    s.raycast(rcHit, hits as never);
    expect(hits.length).toBe(1);

    // 不命中:(-0.5, 0, 5) → (-0.5, 0, 0),在 quad 左侧外
    const rcMiss = new Raycaster(new Vector3(-0.5, 0.5, 5), new Vector3(0, 0, -1));
    rcMiss.camera = cam;
    const misses: unknown[] = [];
    s.raycast(rcMiss, misses as never);
    expect(misses.length).toBe(0);
  });
});

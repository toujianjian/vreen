// Raycaster 单元测试(数据层,不依赖 WebGL)。
// 覆盖:set/setFromCamera/intersectObject/intersectObjects/recursive/
//       near-far 过滤/背面命中/索引几何/UV/InstancedMesh。

import { describe, it, expect } from 'vitest';
import { Raycaster } from './Raycaster';
import { Mesh } from './Mesh';
import { InstancedMesh } from './InstancedMesh';
import { Group } from './Group';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { BasicMaterial } from './Material';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { OrthographicCamera } from '../Cameras/OrthographicCamera';

/** 顶点 (0,0,0),(1,0,0),(0,1,0),法线 +Z;带 uv (0,0),(1,0),(0,1)。 */
function makeTriangle(indexed = false): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0, 1, 0, 0, 1,
  ]), 2));
  if (indexed) {
    g.setIndex([0, 1, 2]);
  }
  return g;
}

function makeMesh(indexed = false): Mesh {
  const m = new Mesh(makeTriangle(indexed), new BasicMaterial());
  m.updateMatrixWorld(true);
  return m;
}

describe('Raycaster', () => {
  it('constructs with defaults', () => {
    const r = new Raycaster();
    expect(r.ray).toBeDefined();
    expect(r.near).toBe(0);
    expect(r.far).toBe(Infinity);
    expect(r.camera).toBeNull();
    expect(r.params.Mesh).toBeDefined();
    expect(r.params.Line.threshold).toBe(1);
    expect(r.params.Line2).toBeDefined();
    expect(r.params.Line2!.threshold).toBe(1);
    expect(r.params.Points.threshold).toBe(1);
  });

  it('set updates origin and direction', () => {
    const r = new Raycaster();
    const o = new Vector3(1, 2, 3);
    const d = new Vector3(0, 0, -1);
    r.set(o, d);
    expect(r.ray.origin.equals(o)).toBe(true);
    expect(r.ray.direction.equals(d)).toBe(true);
  });

  it('setFromCamera (perspective) origins at camera and shoots forward', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);

    const r = new Raycaster();
    r.setFromCamera({ x: 0, y: 0 }, cam);
    expect(r.camera).toBe(cam);
    // origin = 相机世界位置
    expect(r.ray.origin.x).toBeCloseTo(0, 5);
    expect(r.ray.origin.y).toBeCloseTo(0, 5);
    expect(r.ray.origin.z).toBeCloseTo(5, 5);
    // direction 大致沿 -Z(看向原点)
    expect(r.ray.direction.length()).toBeCloseTo(1, 5);
    expect(r.ray.direction.z).toBeLessThan(0);
  });

  it('setFromCamera (perspective) picks a centered triangle', () => {
    // 三角形含原点: (−1,−1,0),(1,−1,0),(0,1,0)
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]), 3));
    const m = new Mesh(g, new BasicMaterial());
    m.updateMatrixWorld(true);

    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);

    const r = new Raycaster();
    r.setFromCamera({ x: 0, y: 0 }, cam);
    const hits = r.intersectObject(m);
    expect(hits).toHaveLength(1);
    expect(hits[0].point.z).toBeCloseTo(0, 5);
    expect(hits[0].distance).toBeCloseTo(5, 5);
  });

  it('setFromCamera (orthographic) sets direction from matrixWorld', () => {
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);

    const r = new Raycaster();
    r.setFromCamera({ x: 0, y: 0 }, cam);
    expect(r.camera).toBe(cam);
    expect(r.ray.direction.length()).toBeCloseTo(1, 5);
    expect(r.ray.direction.z).toBeLessThan(0);
  });

  it('intersectObject hits a front-facing triangle', () => {
    const m = makeMesh(false);
    const r = new Raycaster(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, -1));
    const hits = r.intersectObject(m);
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.object).toBe(m);
    expect(h.distance).toBeCloseTo(1, 5);
    expect(h.point.x).toBeCloseTo(0.25, 5);
    expect(h.point.y).toBeCloseTo(0.25, 5);
    expect(h.point.z).toBeCloseTo(0, 5);
    expect(h.faceIndex).toBe(0);
    expect(h.face).toBeDefined();
    expect(h.face!.a).toBe(0);
    expect(h.face!.b).toBe(1);
    expect(h.face!.c).toBe(2);
    expect(h.face!.normal.z).toBeCloseTo(1, 5);
  });

  it('intersectObject works with indexed geometry', () => {
    const m = makeMesh(true);
    const r = new Raycaster(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, -1));
    const hits = r.intersectObject(m);
    expect(hits).toHaveLength(1);
    expect(hits[0].face!.a).toBe(0);
    expect(hits[0].face!.b).toBe(1);
    expect(hits[0].face!.c).toBe(2);
    expect(hits[0].faceIndex).toBe(0);
  });

  it('computes interpolated UV at the hit point', () => {
    const m = makeMesh(false);
    const r = new Raycaster(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, -1));
    const hits = r.intersectObject(m);
    expect(hits).toHaveLength(1);
    expect(hits[0].uv).toBeDefined();
    expect(hits[0].uv!.x).toBeCloseTo(0.25, 5);
    expect(hits[0].uv!.y).toBeCloseTo(0.25, 5);
  });

  it('returns no intersection when the ray misses', () => {
    const m = makeMesh(false);
    // 射线在三角形外侧
    const r = new Raycaster(new Vector3(5, 5, 1), new Vector3(0, 0, -1));
    expect(r.intersectObject(m)).toHaveLength(0);
  });

  it('hits the back face (no backface culling)', () => {
    const m = makeMesh(false);
    // 射线从 -Z 方向打向三角形背面
    const r = new Raycaster(new Vector3(0.25, 0.25, -1), new Vector3(0, 0, 1));
    const hits = r.intersectObject(m);
    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(1, 5);
    expect(hits[0].point.z).toBeCloseTo(0, 5);
  });

  it('filters by near/far', () => {
    const m = makeMesh(false);
    // 命中点在 z=0,射线 origin z=10 → distance=10
    const tooFar = new Raycaster(new Vector3(0.25, 0.25, 10), new Vector3(0, 0, -1), 0, 5);
    expect(tooFar.intersectObject(m)).toHaveLength(0);

    const inRange = new Raycaster(new Vector3(0.25, 0.25, 10), new Vector3(0, 0, -1), 0, 20);
    expect(inRange.intersectObject(m)).toHaveLength(1);
    expect(inRange.intersectObject(m)[0].distance).toBeCloseTo(10, 5);
  });

  it('traverses children when recursive=true', () => {
    const parent = new Group();
    const child = makeMesh(false);
    parent.add(child);
    parent.updateMatrixWorld(true);

    const r = new Raycaster(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, -1));
    const hits = r.intersectObject(parent, true);
    expect(hits).toHaveLength(1);
    expect(hits[0].object).toBe(child);
  });

  it('does not traverse children when recursive=false', () => {
    const parent = new Group();
    const child = makeMesh(false);
    parent.add(child);
    parent.updateMatrixWorld(true);

    const r = new Raycaster(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, -1));
    expect(r.intersectObject(parent, false)).toHaveLength(0);
  });

  it('intersectObjects sorts hits by distance ascending', () => {
    const near = makeMesh(false); // 命中点 z=0
    const far = new Mesh(makeTriangle(false), new BasicMaterial());
    far.position.set(0, 0, -5);
    far.updateMatrixWorld(true);

    const r = new Raycaster(new Vector3(0.25, 0.25, 10), new Vector3(0, 0, -1));
    const hits = r.intersectObjects([far, near]);
    expect(hits).toHaveLength(2);
    expect(hits[0].object).toBe(near);
    expect(hits[0].distance).toBeCloseTo(10, 5);
    expect(hits[1].object).toBe(far);
    expect(hits[1].distance).toBeCloseTo(15, 5);
  });

  it('respects mesh world transform', () => {
    const m = makeMesh(false);
    m.position.set(0, 0, -3); // 三角形整体后移 3
    m.updateMatrixWorld(true);
    const r = new Raycaster(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, -1));
    const hits = r.intersectObject(m);
    expect(hits).toHaveLength(1);
    expect(hits[0].point.z).toBeCloseTo(-3, 5);
    expect(hits[0].distance).toBeCloseTo(4, 5);
  });

  it('hits the correct InstancedMesh instance with instanceId', () => {
    const im = new InstancedMesh(makeTriangle(false), new BasicMaterial(), 2);
    // instance 0 在原点(identity);instance 1 平移到 (10,0,0)
    const t = new Matrix4();
    t.elements[12] = 10;
    im.setMatrixAt(1, t);
    im.updateMatrixWorld(true);

    // 打 instance 0
    const r0 = new Raycaster(new Vector3(0.25, 0.25, 1), new Vector3(0, 0, -1));
    const h0 = r0.intersectObject(im);
    expect(h0).toHaveLength(1);
    expect(h0[0].instanceId).toBe(0);
    expect(h0[0].point.x).toBeCloseTo(0.25, 5);

    // 打 instance 1
    const r1 = new Raycaster(new Vector3(10.25, 0.25, 1), new Vector3(0, 0, -1));
    const h1 = r1.intersectObject(im);
    expect(h1).toHaveLength(1);
    expect(h1[0].instanceId).toBe(1);
    expect(h1[0].point.x).toBeCloseTo(10.25, 5);
  });
});

// SceneUtils 单元测试。
//
// 覆盖:
//   1. detach — 世界变换保持不变(parent 有旋转/缩放/平移)
//   2. attach — 世界变换保持不变(移到新 parent)
//   3. createMultiMaterialObject — N 个 mesh 子节点
//   4. createMeshesFromInstancedGeometry — 拆分实例
//   5. sortChildrenByRenderOrder — 升序/降序
//   6. getWorldPosition/Quaternion/Scale/Direction
//   7. getMeshes — 深度优先收集
//   8. countObjects — 节点计数

import { describe, it, expect } from 'vitest';
import {
  detach,
  attach,
  createMultiMaterialObject,
  createMeshesFromInstancedGeometry,
  sortChildrenByRenderOrder,
  getWorldPosition,
  getWorldQuaternion,
  getWorldScale,
  getWorldDirection,
  getMeshes,
  countObjects,
} from './SceneUtils';
import { Object3D } from './Object3D';
import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { BasicMaterial } from './Material';
import { InstancedMesh } from './InstancedMesh';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';

// ── 测试辅助 ────────────────────────────────────────────────────────

/** 创建一个有几何/材质的简单 mesh。 */
function makeMesh(): Mesh {
  const geo = new BufferGeometry();
  return new Mesh(geo, new BasicMaterial());
}

// ── detach ─────────────────────────────────────────────────────────

describe('SceneUtils detach', () => {
  it('preserves world position when parent is offset', () => {
    const scene = new Object3D();
    const parent = new Object3D();
    const child = new Object3D();

    parent.position.set(10, 0, 0);
    child.position.set(5, 0, 0); // world = (15, 0, 0)

    scene.add(parent);
    parent.add(child);

    scene.updateMatrixWorld(true);
    const worldBefore = getWorldPosition(child);

    detach(child, parent, scene);

    const worldAfter = getWorldPosition(child);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);
    expect(worldAfter.z).toBeCloseTo(worldBefore.z, 5);
  });

  it('preserves world position when parent has rotation', () => {
    const scene = new Object3D();
    const parent = new Object3D();
    const child = new Object3D();

    // parent 绕 Z 旋转 90°,child 在 (1,0,0) → world ≈ (0,1,0)
    parent.rotation.setFromEuler(0, 0, Math.PI / 2);
    child.position.set(1, 0, 0);

    scene.add(parent);
    parent.add(child);
    scene.updateMatrixWorld(true);

    const worldBefore = getWorldPosition(child);

    detach(child, parent, scene);

    const worldAfter = getWorldPosition(child);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4);
  });

  it('preserves world position when parent has scale', () => {
    const scene = new Object3D();
    const parent = new Object3D();
    const child = new Object3D();

    parent.scale.set(2, 2, 2);
    child.position.set(3, 0, 0); // world = (6, 0, 0)

    scene.add(parent);
    parent.add(child);
    scene.updateMatrixWorld(true);

    const worldBefore = getWorldPosition(child);

    detach(child, parent, scene);

    const worldAfter = getWorldPosition(child);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
  });

  it('child is added to scene after detach', () => {
    const scene = new Object3D();
    const parent = new Object3D();
    const child = new Object3D();

    scene.add(parent);
    parent.add(child);

    detach(child, parent, scene);

    expect(child.parent).toBe(scene);
    expect(scene.children).toContain(child);
    expect(parent.children).not.toContain(child);
  });
});

// ── attach ─────────────────────────────────────────────────────────

describe('SceneUtils attach', () => {
  it('preserves world position when moving to new parent', () => {
    const scene = new Object3D();
    const oldParent = new Object3D();
    const newParent = new Object3D();
    const child = new Object3D();

    oldParent.position.set(10, 0, 0);
    newParent.position.set(100, 0, 0);
    child.position.set(5, 0, 0); // world = (15, 0, 0)

    scene.add(oldParent);
    scene.add(newParent);
    oldParent.add(child);
    scene.updateMatrixWorld(true);

    const worldBefore = getWorldPosition(child);
    expect(worldBefore.x).toBeCloseTo(15, 5);

    attach(child, newParent, scene);

    const worldAfter = getWorldPosition(child);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
  });

  it('child is added to new parent after attach', () => {
    const scene = new Object3D();
    const oldParent = new Object3D();
    const newParent = new Object3D();
    const child = new Object3D();

    scene.add(oldParent);
    scene.add(newParent);
    oldParent.add(child);

    attach(child, newParent, scene);

    expect(child.parent).toBe(newParent);
    expect(newParent.children).toContain(child);
    expect(oldParent.children).not.toContain(child);
  });

  it('preserves world position with rotation + scale', () => {
    const scene = new Object3D();
    const oldParent = new Object3D();
    const newParent = new Object3D();
    const child = new Object3D();

    oldParent.position.set(0, 0, 0);
    newParent.position.set(5, 5, 5);
    newParent.scale.set(2, 2, 2);
    child.position.set(3, 0, 0); // world = (3, 0, 0)

    scene.add(oldParent);
    scene.add(newParent);
    oldParent.add(child);
    scene.updateMatrixWorld(true);

    const worldBefore = getWorldPosition(child);

    attach(child, newParent, scene);

    const worldAfter = getWorldPosition(child);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4);
  });
});

// ── createMultiMaterialObject ─────────────────────────────────────

describe('SceneUtils createMultiMaterialObject', () => {
  it('creates one mesh per material', () => {
    const geo = new BufferGeometry();
    const mats = [new BasicMaterial(), new BasicMaterial(), new BasicMaterial()];
    const group = createMultiMaterialObject(geo, mats);

    expect(group.children.length).toBe(3);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Mesh);
    }
  });

  it('all meshes share the same geometry', () => {
    const geo = new BufferGeometry();
    const mats = [new BasicMaterial(), new BasicMaterial()];
    const group = createMultiMaterialObject(geo, mats);

    for (const child of group.children) {
      expect((child as Mesh).geometry).toBe(geo);
    }
  });

  it('empty materials array creates empty group', () => {
    const geo = new BufferGeometry();
    const group = createMultiMaterialObject(geo, []);
    expect(group.children.length).toBe(0);
  });
});

// ── createMeshesFromInstancedGeometry ─────────────────────────────

describe('SceneUtils createMeshesFromInstancedGeometry', () => {
  it('creates one mesh per instance', () => {
    const geo = new BufferGeometry();
    const mat = new BasicMaterial();
    const inst = new InstancedMesh(geo, mat, 3);

    const group = createMeshesFromInstancedGeometry(inst);
    expect(group.children.length).toBe(3);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Mesh);
    }
  });

  it('respects maxCount', () => {
    const geo = new BufferGeometry();
    const mat = new BasicMaterial();
    const inst = new InstancedMesh(geo, mat, 10);

    const group = createMeshesFromInstancedGeometry(inst, 3);
    expect(group.children.length).toBe(3);
  });

  it('preserves instance transforms', () => {
    const geo = new BufferGeometry();
    const mat = new BasicMaterial();
    const inst = new InstancedMesh(geo, mat, 1);

    // 设置实例 0 的位置
    const m = new Matrix4();
    m.elements[12] = 5; // translation x = 5
    m.elements[13] = 10;
    m.elements[14] = 15;
    inst.setMatrixAt(0, m);

    const group = createMeshesFromInstancedGeometry(inst);
    const mesh = group.children[0] as Mesh;

    expect(mesh.position.x).toBeCloseTo(5, 5);
    expect(mesh.position.y).toBeCloseTo(10, 5);
    expect(mesh.position.z).toBeCloseTo(15, 5);
  });
});

// ── sortChildrenByRenderOrder ─────────────────────────────────────

describe('SceneUtils sortChildrenByRenderOrder', () => {
  it('sorts ascending (small renderOrder first)', () => {
    const parent = new Object3D();
    const a = new Object3D(); a.renderOrder = 3;
    const b = new Object3D(); b.renderOrder = 1;
    const c = new Object3D(); c.renderOrder = 2;
    parent.add(a); parent.add(b); parent.add(c);

    sortChildrenByRenderOrder(parent, false);
    expect(parent.children[0]).toBe(b); // renderOrder 1
    expect(parent.children[1]).toBe(c); // renderOrder 2
    expect(parent.children[2]).toBe(a); // renderOrder 3
  });

  it('sorts descending (large renderOrder first)', () => {
    const parent = new Object3D();
    const a = new Object3D(); a.renderOrder = 1;
    const b = new Object3D(); b.renderOrder = 3;
    const c = new Object3D(); c.renderOrder = 2;
    parent.add(a); parent.add(b); parent.add(c);

    sortChildrenByRenderOrder(parent, true);
    expect(parent.children[0]).toBe(b); // renderOrder 3
    expect(parent.children[1]).toBe(c); // renderOrder 2
    expect(parent.children[2]).toBe(a); // renderOrder 1
  });

  it('stable for equal renderOrder', () => {
    const parent = new Object3D();
    const a = new Object3D();
    const b = new Object3D();
    parent.add(a); parent.add(b);

    sortChildrenByRenderOrder(parent);
    // 两者 renderOrder 都为 0,顺序应保持
    expect(parent.children[0]).toBe(a);
    expect(parent.children[1]).toBe(b);
  });
});

// ── getWorldPosition/Quaternion/Scale/Direction ──────────────────

describe('SceneUtils world transform getters', () => {
  it('getWorldPosition returns translation', () => {
    const obj = new Object3D();
    obj.position.set(1, 2, 3);
    const pos = getWorldPosition(obj);
    expect(pos.x).toBeCloseTo(1);
    expect(pos.y).toBeCloseTo(2);
    expect(pos.z).toBeCloseTo(3);
  });

  it('getWorldPosition respects parent transform', () => {
    const parent = new Object3D();
    const child = new Object3D();
    parent.position.set(10, 0, 0);
    child.position.set(5, 0, 0);
    parent.add(child);
    parent.updateMatrixWorld(true);

    const pos = getWorldPosition(child);
    expect(pos.x).toBeCloseTo(15);
  });

  it('getWorldQuaternion returns rotation', () => {
    const obj = new Object3D();
    obj.rotation.setFromEuler(0, 0, Math.PI / 2);
    const q = getWorldQuaternion(obj);
    // 绕 Z 旋转 90° → quaternion (0, 0, sin(45°), cos(45°))
    expect(q.z).toBeCloseTo(Math.sin(Math.PI / 4), 5);
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });

  it('getWorldScale returns scale', () => {
    const obj = new Object3D();
    obj.scale.set(2, 3, 4);
    const scl = getWorldScale(obj);
    expect(scl.x).toBeCloseTo(2);
    expect(scl.y).toBeCloseTo(3);
    expect(scl.z).toBeCloseTo(4);
  });

  it('getWorldDirection returns -Z forward', () => {
    const obj = new Object3D();
    // 默认朝向 -Z
    const dir = getWorldDirection(obj);
    expect(dir.x).toBeCloseTo(0);
    expect(dir.y).toBeCloseTo(0);
    expect(dir.z).toBeCloseTo(-1);
  });

  it('getWorldDirection rotates with object', () => {
    const obj = new Object3D();
    obj.rotation.setFromEuler(0, Math.PI / 2, 0); // 绕 Y 旋转 90° → forward 变 -X
    const dir = getWorldDirection(obj);
    expect(dir.x).toBeCloseTo(-1, 5);
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it('getWorldPosition writes to target', () => {
    const obj = new Object3D();
    obj.position.set(7, 8, 9);
    const target = new Vector3();
    const result = getWorldPosition(obj, target);
    expect(result).toBe(target);
    expect(target.x).toBeCloseTo(7);
  });
});

// ── getMeshes ─────────────────────────────────────────────────────

describe('SceneUtils getMeshes', () => {
  it('collects all meshes in depth-first order', () => {
    const root = new Object3D();
    const m1 = makeMesh();
    const child = new Object3D();
    const m2 = makeMesh();
    root.add(m1);
    root.add(child);
    child.add(m2);

    const meshes = getMeshes(root);
    expect(meshes.length).toBe(2);
    expect(meshes).toContain(m1);
    expect(meshes).toContain(m2);
  });

  it('skips invisible meshes by default', () => {
    const root = new Object3D();
    const m1 = makeMesh();
    const m2 = makeMesh();
    m2.visible = false;
    root.add(m1);
    root.add(m2);

    const meshes = getMeshes(root);
    expect(meshes.length).toBe(1);
    expect(meshes).toContain(m1);
  });

  it('includes invisible meshes when includeInvisible=true', () => {
    const root = new Object3D();
    const m1 = makeMesh();
    const m2 = makeMesh();
    m2.visible = false;
    root.add(m1);
    root.add(m2);

    const meshes = getMeshes(root, true);
    expect(meshes.length).toBe(2);
  });

  it('returns empty for non-mesh root', () => {
    const root = new Object3D();
    expect(getMeshes(root)).toEqual([]);
  });
});

// ── countObjects ──────────────────────────────────────────────────

describe('SceneUtils countObjects', () => {
  it('counts root + all descendants', () => {
    const root = new Object3D();
    const a = new Object3D();
    const b = new Object3D();
    const c = new Object3D();
    root.add(a);
    a.add(b);
    root.add(c);

    expect(countObjects(root)).toBe(4); // root + a + b + c
  });

  it('includes invisible by default', () => {
    const root = new Object3D();
    const a = new Object3D();
    a.visible = false;
    root.add(a);

    expect(countObjects(root)).toBe(2);
  });

  it('excludes invisible when includeInvisible=false', () => {
    const root = new Object3D();
    const a = new Object3D();
    const b = new Object3D();
    a.visible = false;
    root.add(a);
    a.add(b); // b 是 a 的子节点,a 不可见 → b 也被跳过

    expect(countObjects(root, false)).toBe(1); // 只 root
  });

  it('single root returns 1', () => {
    expect(countObjects(new Object3D())).toBe(1);
  });
});

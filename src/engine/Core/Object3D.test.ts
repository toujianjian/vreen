// Object3D 单元测试(数据层,不依赖 WebGL)。
// 覆盖 copy / clone(three.js Object3D.copy/clone 语义)与类型标记。

import { describe, it, expect } from 'vitest';
import { Object3D } from './Object3D';
import { Group } from './Group';
import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Matrix4, Quaternion, Vector3 } from '../Math';

describe('Object3D', () => {
  it('carries type markers', () => {
    const o = new Object3D();
    expect(o.isObject3D).toBe(true);
    expect(o.type).toBe('Object3D');
    const g = new Group();
    expect(g.isGroup).toBe(true);
    expect(g.isObject3D).toBe(true);
  });

  describe('copy', () => {
    it('copies name / transform / visibility flags', () => {
      const src = new Object3D();
      src.name = 'src';
      src.position.set(1, 2, 3);
      src.rotation.setFromEuler(0.1, 0.2, 0.3);
      src.scale.set(2, 2, 2);
      src.visible = false;
      src.renderOrder = 5;
      src.frustumCulled = false;

      const dst = new Object3D().copy(src);
      expect(dst.name).toBe('src');
      expect(dst.position.equals(src.position)).toBe(true);
      expect(dst.rotation.equals(src.rotation)).toBe(true);
      expect(dst.scale.equals(src.scale)).toBe(true);
      expect(dst.visible).toBe(false);
      expect(dst.renderOrder).toBe(5);
      expect(dst.frustumCulled).toBe(false);
    });

    it('deep-copies userData (not shared reference)', () => {
      const src = new Object3D();
      src.userData = { meta: { foo: 1 }, tags: ['a'] };

      const dst = new Object3D().copy(src);
      // userData 是 Record<string, unknown>,访问嵌套字段需 cast(测试内)。
      (dst.userData.meta as { foo: number }).foo = 99;

      expect((src.userData.meta as { foo: number }).foo).toBe(1);
      expect((dst.userData.meta as { foo: number }).foo).toBe(99);
    });

    it('deep-copies the child subtree when recursive', () => {
      const parent = new Group();
      const child = new Group();
      child.name = 'child';
      child.position.set(5, 0, 0);
      parent.add(child);
      const grandchild = new Object3D();
      grandchild.name = 'grandchild';
      child.add(grandchild);

      const clone = parent.clone();
      expect(clone.children.length).toBe(1);
      const c = clone.children[0];
      expect(c).toBeInstanceOf(Group);
      expect(c.name).toBe('child');
      expect(c.position.equals(child.position)).toBe(true);
      expect(c.children.length).toBe(1);
      expect(c.children[0].name).toBe('grandchild');
      // 深拷贝:副本子节点不是原对象引用
      expect(c).not.toBe(child);
      expect(c.children[0]).not.toBe(grandchild);
    });

    it('does not clone children when recursive=false', () => {
      const parent = new Group();
      parent.add(new Object3D());
      parent.add(new Object3D());
      const copy = parent.clone(false);
      expect(copy.children.length).toBe(0);
    });

    it('copy into an existing object does not leave stale children', () => {
      const dst = new Group();
      dst.add(new Object3D());
      const src = new Group(); // 无子节点
      dst.copy(src);
      expect(dst.children.length).toBe(0);
    });
  });

  describe('clone', () => {
    it('returns a distinct instance', () => {
      const o = new Object3D();
      const c = o.clone();
      expect(c).not.toBe(o);
    });

    it('preserves subclass type', () => {
      const g = new Group();
      expect(g.clone()).toBeInstanceOf(Group);
    });

    it('mutation of clone does not affect original (bound vectors are independent)', () => {
      const src = new Group();
      src.position.set(1, 1, 1);
      const dst = src.clone();
      dst.position.set(9, 9, 9);
      expect(src.position.x).toBe(1);
      expect(dst.position.x).toBe(9);
    });

    it('clones Mesh and copies geometry/material references', () => {
      const geo = new BufferGeometry();
      const mat = new StandardMaterial();
      const mesh = new Mesh(geo, mat);
      mesh.castShadow = false;
      const m2 = mesh.clone();
      expect(m2).toBeInstanceOf(Mesh);
      expect(m2.geometry).toBe(geo);
      expect(m2.material).toBe(mat);
      expect(m2.castShadow).toBe(false);
    });
  });

  describe('updateWorldMatrix', () => {
    it('recomputes matrixWorld from parent chain (updateParents)', () => {
      const parent = new Object3D();
      parent.position.set(10, 20, 30);
      const child = new Object3D();
      parent.add(child);
      child.position.set(1, 0, 0);
      child.updateWorldMatrix(true, false);
      expect(child.matrixWorld.elements[12]).toBeCloseTo(11, 5);
      expect(child.matrixWorld.elements[13]).toBeCloseTo(20, 5);
      expect(child.matrixWorld.elements[14]).toBeCloseTo(30, 5);
    });

    it('cascades to children when updateChildren=true', () => {
      const root = new Object3D();
      root.position.set(5, 0, 0);
      const mid = new Object3D();
      mid.position.set(1, 0, 0);
      const leaf = new Object3D();
      leaf.position.set(2, 0, 0);
      root.add(mid);
      mid.add(leaf);
      // 只更新 root,子树 world 仍旧
      root.updateWorldMatrix(true, false);
      // 现在全量级联
      root.updateWorldMatrix(true, true);
      expect(leaf.matrixWorld.elements[12]).toBeCloseTo(8, 5);
    });
  });

  describe('world-space getters', () => {
    it('getWorldPosition composes parent transforms', () => {
      const parent = new Object3D();
      parent.position.set(10, 0, 0);
      const child = new Object3D();
      child.position.set(3, 4, 0);
      parent.add(child);
      const out = child.getWorldPosition();
      expect(out.x).toBeCloseTo(13, 5);
      expect(out.y).toBeCloseTo(4, 5);
      expect(out.z).toBeCloseTo(0, 5);
    });

    it('getWorldQuaternion returns world-space rotation', () => {
      const parent = new Object3D();
      parent.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      const child = new Object3D();
      parent.add(child);
      const q = child.getWorldQuaternion();
      // 90° 绕 Y → 局部 +X 应指世界 -Z / 局部 +Z 应指世界 +X
      const localX = new Vector3(1, 0, 0).applyQuaternion(q);
      expect(localX.x).toBeCloseTo(0, 5);
      expect(localX.z).toBeCloseTo(-1, 5);
    });

    it('getWorldScale composes nested non-uniform scale', () => {
      const parent = new Object3D();
      parent.scale.set(2, 2, 2);
      const child = new Object3D();
      child.scale.set(3, 4, 5);
      parent.add(child);
      const s = child.getWorldScale();
      expect(s.x).toBeCloseTo(6, 5);
      expect(s.y).toBeCloseTo(8, 5);
      expect(s.z).toBeCloseTo(10, 5);
    });

    it('getWorldDirection returns -Z look axis', () => {
      const o = new Object3D();
      o.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
      const dir = o.getWorldDirection();
      // 绕 Y 转 180° → 局部 -Z 指向世界 +Z
      expect(dir.x).toBeCloseTo(0, 5);
      expect(dir.z).toBeCloseTo(1, 5);
    });
  });

  describe('localToWorld / worldToLocal', () => {
    it('round-trips a point', () => {
      const parent = new Object3D();
      parent.position.set(1, 2, 3);
      const child = new Object3D();
      child.position.set(4, 5, 6);
      parent.add(child);
      const p = new Vector3(1, 0, 0);
      const world = child.localToWorld(p.clone());
      expect(world.x).toBeCloseTo(6, 5);
      expect(child.worldToLocal(world.clone()).distanceTo(p)).toBeLessThan(1e-5);
    });
  });

  describe('attach', () => {
    it('preserves world transform across reparent', () => {
      const a = new Object3D();
      a.position.set(100, 0, 0);
      const b = new Object3D();
      b.position.set(0, 50, 0);
      const child = new Object3D();
      child.position.set(1, 2, 3);
      a.add(child);
      const worldBefore = child.getWorldPosition().clone();
      b.attach(child);
      expect(child.parent).toBe(b);
      const worldAfter = child.getWorldPosition();
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);
      expect(worldAfter.z).toBeCloseTo(worldBefore.z, 5);
    });
  });

  describe('transform helpers', () => {
    it('applyMatrix4 decomposes into position/rotation/scale', () => {
      const o = new Object3D();
      const m = new Matrix4();
      m.compose(new Vector3(7, 8, 9), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(2, 3, 4));
      o.applyMatrix4(m);
      expect(o.position.x).toBeCloseTo(7, 5);
      expect(o.position.y).toBeCloseTo(8, 5);
      expect(o.position.z).toBeCloseTo(9, 5);
      expect(o.scale.x).toBeCloseTo(2, 5);
      expect(o.scale.y).toBeCloseTo(3, 5);
      expect(o.scale.z).toBeCloseTo(4, 5);
      const fwd = new Vector3(0, 0, -1).applyQuaternion(o.rotation);
      expect(fwd.x).toBeCloseTo(-1, 5);
      expect(fwd.z).toBeCloseTo(0, 5);
    });

    it('rotateOnAxis rotates in local space', () => {
      const o = new Object3D();
      o.rotateY(Math.PI / 2);
      const fwd = new Vector3(0, 0, -1).applyQuaternion(o.rotation);
      expect(fwd.x).toBeCloseTo(-1, 5);
      expect(fwd.z).toBeCloseTo(0, 5);
    });

    it('rotateOnWorldAxis rotates in world space (premultiply)', () => {
      const o = new Object3D();
      o.rotateY(Math.PI / 2); // local 已转 90°
      o.rotateOnWorldAxis(new Vector3(0, 1, 0), Math.PI / 2); // 世界再转 90° → 总 180°
      const fwd = new Vector3(0, 0, -1).applyQuaternion(o.rotation);
      expect(fwd.z).toBeCloseTo(1, 5);
    });

    it('translateX moves along local axis', () => {
      const o = new Object3D();
      o.rotateY(Math.PI / 2);
      o.translateX(10); // 局部 +X → 世界 -Z
      expect(o.position.x).toBeCloseTo(0, 5);
      expect(o.position.z).toBeCloseTo(-10, 5);
    });

    it('rotateX/rotateZ act on the right axes', () => {
      const o = new Object3D();
      o.rotateX(Math.PI / 2);
      const up = new Vector3(0, 1, 0).applyQuaternion(o.rotation);
      expect(up.y).toBeCloseTo(0, 5);
      expect(up.z).toBeCloseTo(1, 5);
      const o2 = new Object3D();
      o2.rotateZ(Math.PI / 2);
      const right = new Vector3(1, 0, 0).applyQuaternion(o2.rotation);
      expect(right.y).toBeCloseTo(1, 5);
    });
  });

  describe('hierarchy helpers', () => {
    it('removeFromParent detaches self', () => {
      const parent = new Object3D();
      const child = new Object3D();
      parent.add(child);
      expect(child.removeFromParent()).toBe(child);
      expect(child.parent).toBeNull();
      expect(parent.children).toHaveLength(0);
    });

    it('clear removes all children', () => {
      const parent = new Object3D();
      parent.add(new Object3D());
      parent.add(new Object3D());
      parent.add(new Object3D());
      parent.clear();
      expect(parent.children).toHaveLength(0);
    });

    it('traverseVisible skips invisible subtrees', () => {
      const root = new Object3D();
      const visA = new Object3D();
      const hidden = new Object3D();
      hidden.visible = false;
      const hiddenChild = new Object3D();
      hidden.add(hiddenChild);
      const visB = new Object3D();
      root.add(visA);
      root.add(hidden);
      root.add(visB);
      const seen: number[] = [];
      root.traverseVisible((o) => seen.push(o.id));
      expect(seen).toContain(root.id);
      expect(seen).toContain(visA.id);
      expect(seen).toContain(visB.id);
      expect(seen).not.toContain(hidden.id);
      expect(seen).not.toContain(hiddenChild.id);
    });

    it('traverseAncestors walks nearest ancestor first', () => {
      const root = new Object3D();
      const mid = new Object3D();
      const leaf = new Object3D();
      root.add(mid);
      mid.add(leaf);
      const chain: number[] = [];
      leaf.traverseAncestors((o) => chain.push(o.id));
      expect(chain).toEqual([mid.id, root.id]);
    });

    it('getObjectById and getObjectByProperty find descendants', () => {
      const root = new Object3D();
      const a = new Object3D();
      a.name = 'named';
      a.userData.kind = 'special';
      const deep = new Object3D();
      deep.name = 'deep';
      a.add(deep);
      root.add(a);
      expect(root.getObjectById(root.id)).toBe(root);
      expect(root.getObjectById(a.id)).toBe(a);
      expect(root.getObjectById(deep.id)).toBe(deep);
      expect(root.getObjectByProperty('name', 'deep')).toBe(deep);
      expect(root.getObjectByProperty('userData', undefined)).toBeNull();
      expect(root.getObjectByProperty('name', 'missing')).toBeNull();
    });
  });
});

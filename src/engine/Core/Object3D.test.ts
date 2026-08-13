// Object3D 单元测试(数据层,不依赖 WebGL)。
// 覆盖 copy / clone(three.js Object3D.copy/clone 语义)与类型标记。

import { describe, it, expect } from 'vitest';
import { Object3D } from './Object3D';
import { Group } from './Group';
import { Mesh } from './Mesh';
import { BufferGeometry } from './BufferGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';

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
});

// SkinnedMesh 单元测试(数据层,不依赖 WebGL)。
// 覆盖 bind(带/不带 bindMatrix)/ pose 委托 / copy / clone
// (three.js SkinnedMesh 语义)。

import { describe, it, expect } from 'vitest';
import { SkinnedMesh } from './SkinnedMesh';
import { Skeleton } from './Skeleton';
import { Bone } from './Bone';
import { Group } from './Group';
import { BufferGeometry } from './BufferGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Matrix4 } from '../Math';

function makeSkinned(): SkinnedMesh {
  return new SkinnedMesh(new BufferGeometry(), new StandardMaterial());
}

describe('SkinnedMesh', () => {
  it('carries type markers and defaults', () => {
    const m = makeSkinned();
    expect(m.isSkinnedMesh).toBe(true);
    expect(m.isMesh).toBe(true);
    expect(m.isObject3D).toBe(true);
    expect(m.type).toBe('SkinnedMesh');
    expect(m.skeleton).toBeNull();
    expect(m.bindMode).toBe('attached');
  });

  it('bind without bindMatrix calculates inverses and uses matrixWorld', () => {
    const mesh = makeSkinned();
    mesh.position.set(5, 0, 0);
    mesh.updateMatrixWorld(true);

    const root = new Group();
    const bone = new Bone();
    bone.position.set(0, 2, 0);
    root.add(bone);
    root.updateMatrixWorld(true);

    const skeleton = new Skeleton([bone]);
    mesh.bind(skeleton);

    expect(mesh.skeleton).toBe(skeleton);
    expect(skeleton.boneInverses.length).toBe(1);
    // bindMatrix = mesh.matrixWorld = T(5,0,0)
    expect(mesh.bindMatrix.elements[12]).toBeCloseTo(5, 5);
    expect(mesh.bindMatrix.elements[13]).toBeCloseTo(0, 5);
    // bindMatrixInverse * bindMatrix ≈ identity
    const ident = new Matrix4().multiplyMatrices(mesh.bindMatrixInverse, mesh.bindMatrix);
    expect(ident.elements[0]).toBeCloseTo(1, 5);
    expect(ident.elements[5]).toBeCloseTo(1, 5);
    expect(ident.elements[10]).toBeCloseTo(1, 5);
    expect(ident.elements[15]).toBeCloseTo(1, 5);
    expect(Math.abs(ident.elements[12])).toBeLessThan(1e-5);
  });

  it('bind with explicit bindMatrix does not recompute inverses', () => {
    const mesh = makeSkinned();
    const skeleton = new Skeleton(); // 空骨骼,不触发计算
    const bind = new Matrix4().makeTranslation(1, 2, 3);
    mesh.bind(skeleton, bind);
    expect(skeleton.boneInverses.length).toBe(0);
    expect(mesh.bindMatrix.elements[12]).toBeCloseTo(1, 5);
    expect(mesh.bindMatrix.elements[13]).toBeCloseTo(2, 5);
    expect(mesh.bindMatrix.elements[14]).toBeCloseTo(3, 5);
  });

  it('pose delegates to skeleton.pose', () => {
    const mesh = makeSkinned();
    const root = new Group();
    const bone = new Bone();
    bone.position.set(0, 1, 0);
    root.add(bone);
    root.updateMatrixWorld(true);
    const skeleton = new Skeleton([bone]);
    mesh.bind(skeleton);

    bone.position.set(4, 9, 1);
    root.updateMatrixWorld(true);
    mesh.pose();
    expect(bone.position.x).toBeCloseTo(0, 5);
    expect(bone.position.y).toBeCloseTo(1, 5);
    expect(bone.position.z).toBeCloseTo(0, 5);
  });

  it('copy copies bind fields by value and shares skeleton', () => {
    const src = makeSkinned();
    const skeleton = new Skeleton();
    src.skeleton = skeleton;
    src.bindMode = 'detached';
    src.bindMatrix.makeTranslation(1, 2, 3);
    src.bindMatrixInverse.copy(src.bindMatrix).invert();

    const dst = makeSkinned();
    dst.copy(src);
    expect(dst.bindMode).toBe('detached');
    expect(dst.skeleton).toBe(skeleton);
    expect(dst.bindMatrix.elements[12]).toBeCloseTo(1, 5);
    // bindMatrix 按值拷贝:修改副本不影响源
    dst.bindMatrix.makeTranslation(9, 9, 9);
    expect(src.bindMatrix.elements[12]).toBeCloseTo(1, 5);
    expect(src.bindMatrix.elements[13]).toBeCloseTo(2, 5);
  });

  it('clone preserves skeleton via Mesh.clone', () => {
    const src = makeSkinned();
    const skeleton = new Skeleton();
    src.skeleton = skeleton;
    // Mesh.clone 静态返回 Mesh,运行时实际是 SkinnedMesh(构造函数 cast 克隆)。
    const dst = src.clone() as SkinnedMesh;
    expect(dst).toBeInstanceOf(SkinnedMesh);
    expect(dst).not.toBe(src);
    expect(dst.skeleton).toBe(skeleton);
    expect(dst.geometry).toBe(src.geometry);
    expect(dst.material).toBe(src.material);
  });
});

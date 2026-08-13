// Skeleton 单元测试(数据层,不依赖 WebGL)。
// 覆盖绑定逆矩阵自动计算 / pose 恢复绑定姿态 / boneMatrices 打包 / clone
// (three.js Skeleton 语义)。

import { describe, it, expect } from 'vitest';
import { Skeleton } from './Skeleton';
import { Bone } from './Bone';
import { Group } from './Group';
import { Matrix4 } from '../Math';

/** 构造两层骨骼:boneA(根) → boneB,boneB 相对 boneA 偏移 (0,0,1)。 */
function makeRig(): { root: Group; bones: Bone[] } {
  const root = new Group();
  const boneA = new Bone();
  boneA.name = 'boneA';
  boneA.position.set(0, 1, 0);
  const boneB = new Bone();
  boneB.name = 'boneB';
  boneB.position.set(0, 0, 1);
  root.add(boneA);
  boneA.add(boneB);
  root.updateMatrixWorld(true);
  return { root, bones: [boneA, boneB] };
}

/** 检查 a * b ≈ identity。 */
function expectInversePair(a: Matrix4, b: Matrix4): void {
  const m = new Matrix4().multiplyMatrices(a, b);
  const e = m.elements;
  expect(e[0]).toBeCloseTo(1, 5);
  expect(e[5]).toBeCloseTo(1, 5);
  expect(e[10]).toBeCloseTo(1, 5);
  expect(e[15]).toBeCloseTo(1, 5);
  for (let i = 0; i < 16; i++) {
    if (i === 0 || i === 5 || i === 10 || i === 15) continue;
    expect(Math.abs(e[i])).toBeLessThan(1e-4);
  }
}

describe('Skeleton', () => {
  it('empty skeleton keeps a valid identity boneMatrices buffer', () => {
    const sk = new Skeleton();
    expect(sk.bones.length).toBe(0);
    expect(sk.boneMatrices.length).toBe(16); // 至少 1 块
    sk.computeBoneMatrices();
    expect(sk.boneMatrices[0]).toBe(1);
    expect(sk.boneMatrices[5]).toBe(1);
    expect(sk.boneMatrices[10]).toBe(1);
    expect(sk.boneMatrices[15]).toBe(1);
  });

  it('auto-calculates inverse bind matrices when none provided', () => {
    const { bones } = makeRig();
    const sk = new Skeleton(bones);
    expect(sk.boneInverses.length).toBe(2);
    expectInversePair(bones[0].matrixWorld, sk.boneInverses[0]);
    expectInversePair(bones[1].matrixWorld, sk.boneInverses[1]);
  });

  it('keeps provided inverse bind matrices untouched (no invert)', () => {
    const { bones } = makeRig();
    const inv = [new Matrix4().identity(), new Matrix4().identity()];
    const sk = new Skeleton(bones, inv);
    expect(sk.boneInverses).toBe(inv); // 引用保留(three.js 语义)
    expect(sk.boneInverses[0].elements[0]).toBe(1);
  });

  it('calculateInverses recomputes from current matrixWorld', () => {
    const { bones } = makeRig();
    const sk = new Skeleton(bones, [new Matrix4().identity(), new Matrix4().identity()]);
    sk.calculateInverses();
    expectInversePair(bones[0].matrixWorld, sk.boneInverses[0]);
    expectInversePair(bones[1].matrixWorld, sk.boneInverses[1]);
  });

  it('pose restores bind pose after animation offset', () => {
    const { root, bones } = makeRig();
    const sk = new Skeleton(bones);
    // 人为制造偏离
    bones[1].position.set(3, -2, 4);
    root.updateMatrixWorld(true);
    sk.pose();
    expect(bones[0].position.x).toBeCloseTo(0, 5);
    expect(bones[0].position.y).toBeCloseTo(1, 5);
    expect(bones[0].position.z).toBeCloseTo(0, 5);
    expect(bones[1].position.x).toBeCloseTo(0, 5);
    expect(bones[1].position.y).toBeCloseTo(0, 5);
    expect(bones[1].position.z).toBeCloseTo(1, 5);
  });

  it('pose then update packs identity per bone', () => {
    const { root, bones } = makeRig();
    const sk = new Skeleton(bones);
    bones[1].position.set(9, 0, 0);
    root.updateMatrixWorld(true);
    sk.pose();
    sk.update(); // update() = computeBoneMatrices() 别名
    expect(sk.boneMatrices.length).toBe(2 * 16);
    for (let i = 0; i < 2; i++) {
      const off = i * 16;
      const e = sk.boneMatrices;
      expect(e[off + 0]).toBeCloseTo(1, 4);
      expect(e[off + 5]).toBeCloseTo(1, 4);
      expect(e[off + 10]).toBeCloseTo(1, 4);
      expect(e[off + 15]).toBeCloseTo(1, 4);
      expect(e[off + 12]).toBeCloseTo(0, 4);
      expect(e[off + 13]).toBeCloseTo(0, 4);
      expect(e[off + 14]).toBeCloseTo(0, 4);
    }
  });

  it('computeBoneMatrices reflects current world pose', () => {
    const { root, bones } = makeRig();
    const sk = new Skeleton(bones);
    // 移动 boneA 到 (2,0,0),boneB 相对 (0,0,1)
    bones[0].position.set(2, 0, 0);
    root.updateMatrixWorld(true);
    sk.computeBoneMatrices();
    // boneA 世界 = T(2,0,0),绑定逆 = T(0,-1,0)
    // boneMatrices[0] = T(2,0,0) * T(0,-1,0) = T(2,-1,0)
    expect(sk.boneMatrices[12]).toBeCloseTo(2, 4);
    expect(sk.boneMatrices[13]).toBeCloseTo(-1, 4);
    expect(sk.boneMatrices[14]).toBeCloseTo(0, 4);
  });

  it('clone shares bones and inverse references', () => {
    const { bones } = makeRig();
    const sk = new Skeleton(bones);
    const c = sk.clone();
    expect(c).not.toBe(sk);
    expect(c.bones).toBe(sk.bones);
    expect(c.boneInverses).toBe(sk.boneInverses);
  });
});

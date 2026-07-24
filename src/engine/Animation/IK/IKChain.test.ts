// IKChain (FABRIK) 单元测试:
//   • 2 骨链:可达目标(末端到达 target)、不可达目标(向 target 方向拉伸)
//   • 3 骨链:可达目标 + 段长保持
//   • pole target:中段朝 pole 方向弯曲
//   • 求解返回值为末端误差

import { describe, it, expect } from 'vitest';
import { IKChain } from './IKChain';
import { IKBone } from './IKBone';
import { Vector3 } from '../../Math/Vector3';

/** 构造一个简单的 N 段直立链(沿 +Y 方向),每段长度 1。 */
function makeStraightChain(boneCount: number): { chain: IKChain; bones: IKBone[] } {
  const bones: IKBone[] = [];
  for (let i = 0; i < boneCount; i++) {
    const isFirst = i === 0;
    const isLast = i === boneCount - 1;
    const pos = isFirst ? new Vector3(0, 0, 0) : new Vector3(0, 1, 0);
    const len = isLast ? 0 : 1;
    bones.push(new IKBone(`b${i}`, pos, undefined, len));
  }
  const chain = new IKChain({ iterations: 30, tolerance: 1e-6 });
  for (const b of bones) chain.addBone(b);
  return { chain, bones };
}

describe('IKChain (FABRIK)', () => {
  describe('2 骨链', () => {
    it('可达目标:末端到达 target', () => {
      const { chain, bones } = makeStraightChain(2);
      chain.target.set(1, 0, 0); // 距 root 距离 1,正好可达
      const err = chain.solve();
      expect(err).toBeLessThan(1e-3);
      const wp = bones[1].getWorldPosition();
      expect(wp.x).toBeCloseTo(1, 4);
      expect(wp.y).toBeCloseTo(0, 4);
      expect(wp.z).toBeCloseTo(0, 4);
    });

    it('不可达目标:沿 target 方向拉伸到最大长度', () => {
      const { chain, bones } = makeStraightChain(2);
      chain.target.set(5, 0, 0); // 距离 5,链长 1
      const err = chain.solve();
      // 末端应位于 (1, 0, 0)(链长 1,沿 +X 方向)
      const wp = bones[1].getWorldPosition();
      expect(wp.x).toBeCloseTo(1, 4);
      expect(wp.y).toBeCloseTo(0, 4);
      expect(wp.z).toBeCloseTo(0, 4);
      // 误差 = 5 - 1 = 4
      expect(err).toBeCloseTo(4, 4);
    });

    it('目标等于初始末端位置:无操作,err ≈ 0', () => {
      const { chain, bones } = makeStraightChain(2);
      chain.target.set(0, 1, 0); // 初始末端位置
      const err = chain.solve();
      expect(err).toBeLessThan(1e-3);
      const wp = bones[1].getWorldPosition();
      expect(wp.x).toBeCloseTo(0, 5);
      expect(wp.y).toBeCloseTo(1, 5);
    });
  });

  describe('3 骨链', () => {
    it('可达目标:末端到达 target', () => {
      const { chain, bones } = makeStraightChain(3);
      // 总长 2,target 距离 √2 ≈ 1.414(可达)
      chain.target.set(1, 1, 0);
      const err = chain.solve();
      expect(err).toBeLessThan(1e-3);
      const wp = bones[2].getWorldPosition();
      expect(wp.x).toBeCloseTo(1, 4);
      expect(wp.y).toBeCloseTo(1, 4);
    });

    it('段长在求解后保持不变', () => {
      const { chain, bones } = makeStraightChain(3);
      chain.target.set(1, 1, 0);
      chain.solve();
      const p0 = bones[0].getWorldPosition();
      const p1 = bones[1].getWorldPosition();
      const p2 = bones[2].getWorldPosition();
      expect(p0.distanceTo(p1)).toBeCloseTo(1, 4);
      expect(p1.distanceTo(p2)).toBeCloseTo(1, 4);
    });

    it('root 在求解后保持原位', () => {
      const { chain, bones } = makeStraightChain(3);
      chain.target.set(1, 1, 0);
      chain.solve();
      const p0 = bones[0].getWorldPosition();
      expect(p0.x).toBeCloseTo(0, 5);
      expect(p0.y).toBeCloseTo(0, 5);
      expect(p0.z).toBeCloseTo(0, 5);
    });
  });

  describe('pole target', () => {
    it('中段朝 pole 方向弯曲', () => {
      const { chain, bones } = makeStraightChain(3);
      // target 设为 (1,1,0):链需要从 (0,0,0)→(0,1,0)→(0,2,0) 弯到末端 (1,1,0)
      // pole 设为 (+X 方向):中段应弯向 +X
      chain.target.set(1, 1, 0);
      chain.poleTarget = new Vector3(2, 1, 0);
      chain.solve();
      const mp = bones[1].getWorldPosition();
      // 中段 x 坐标应为正(朝 pole 方向)
      expect(mp.x).toBeGreaterThan(0.05);
    });

    it('无 pole target 时,链的弯曲方向由 FABRIK 默认行为决定', () => {
      const { chain, bones } = makeStraightChain(3);
      chain.target.set(1, 1, 0);
      // 无 poleTarget —— 不抛错,末端仍能到达 target
      expect(() => chain.solve()).not.toThrow();
      const wp = bones[2].getWorldPosition();
      expect(wp.x).toBeCloseTo(1, 3);
      expect(wp.y).toBeCloseTo(1, 3);
    });
  });

  describe('API 行为', () => {
    it('addBone 自动设置 parent', () => {
      const chain = new IKChain();
      const a = new IKBone('a');
      const b = new IKBone('b');
      chain.addBone(a);
      chain.addBone(b);
      expect(b.parent).toBe(a);
      expect(a.parent).toBeNull();
    });

    it('size 返回骨数', () => {
      const { chain } = makeStraightChain(3);
      expect(chain.size).toBe(3);
    });

    it('空链 solve 不抛错,返回 0', () => {
      const chain = new IKChain();
      expect(() => chain.solve()).not.toThrow();
      expect(chain.solve()).toBe(0);
    });

    it('单骨链 solve 不抛错', () => {
      const chain = new IKChain();
      chain.addBone(new IKBone('only', new Vector3(0, 0, 0)));
      expect(chain.solve()).toBe(0);
    });

    it('solve(iterations) 覆盖默认迭代数', () => {
      const { chain, bones } = makeStraightChain(2);
      chain.target.set(1, 0, 0);
      // 用 1 次迭代也能达到(2 骨链 1 次就收敛)
      const err = chain.solve(1);
      expect(err).toBeLessThan(1e-3);
      const wp = bones[1].getWorldPosition();
      expect(wp.x).toBeCloseTo(1, 4);
    });
  });
});

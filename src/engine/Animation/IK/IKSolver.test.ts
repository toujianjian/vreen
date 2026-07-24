// IKSolver 单元测试:多链管理(addChain/removeChain、size、solve 求解
// 多条链并返回最大误差、solveUntilConverged)。

import { describe, it, expect } from 'vitest';
import { IKSolver } from './IKSolver';
import { IKChain } from './IKChain';
import { IKBone } from './IKBone';
import { Vector3 } from '../../Math/Vector3';

describe('IKSolver', () => {
  describe('chain 管理', () => {
    it('addChain / size', () => {
      const solver = new IKSolver();
      expect(solver.size).toBe(0);
      solver.addChain(new IKChain());
      expect(solver.size).toBe(1);
      solver.addChain(new IKChain());
      expect(solver.size).toBe(2);
    });

    it('addChain 幂等:同一 chain 只添加一次', () => {
      const solver = new IKSolver();
      const c = new IKChain();
      solver.addChain(c);
      solver.addChain(c);
      expect(solver.size).toBe(1);
    });

    it('removeChain:返回是否找到', () => {
      const solver = new IKSolver();
      const c1 = new IKChain();
      const c2 = new IKChain();
      solver.addChain(c1);
      solver.addChain(c2);
      expect(solver.removeChain(c1)).toBe(true);
      expect(solver.size).toBe(1);
      expect(solver.removeChain(c1)).toBe(false); // 已移除
      expect(solver.size).toBe(1);
    });
  });

  describe('solve', () => {
    it('返回所有链中的最大末端误差', () => {
      // 链 1:可达(误差 ≈ 0)
      const r1 = new IKBone('r1', new Vector3(0, 0, 0), undefined, 1);
      const e1 = new IKBone('e1', new Vector3(0, 1, 0), undefined, 0);
      const c1 = new IKChain({ iterations: 20, tolerance: 1e-6 });
      c1.addBone(r1);
      c1.addBone(e1);
      c1.target.set(1, 0, 0);

      // 链 2:不可达(链长 1,target 距离 5)
      const r2 = new IKBone('r2', new Vector3(0, 0, 0), undefined, 1);
      const e2 = new IKBone('e2', new Vector3(0, 1, 0), undefined, 0);
      const c2 = new IKChain({ iterations: 5 });
      c2.addBone(r2);
      c2.addBone(e2);
      c2.target.set(5, 0, 0);

      const solver = new IKSolver({ iterations: 20, tolerance: 1e-6 });
      solver.addChain(c1);
      solver.addChain(c2);
      const worst = solver.solve();
      // 链 1 误差 ≈ 0,链 2 误差 ≈ 4
      expect(worst).toBeCloseTo(4, 4);
    });

    it('空 solver.solve() 返回 0', () => {
      const solver = new IKSolver();
      expect(solver.solve()).toBe(0);
    });

    it('solve(iterations) 覆盖默认迭代数', () => {
      const r = new IKBone('r', new Vector3(0, 0, 0), undefined, 1);
      const e = new IKBone('e', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain();
      chain.addBone(r);
      chain.addBone(e);
      chain.target.set(1, 0, 0);

      const solver = new IKSolver({ iterations: 1 });
      const err = solver.solve(20); // 覆盖为 20
      expect(err).toBeLessThan(1e-3);
    });
  });

  describe('solveUntilConverged', () => {
    it('重复 solve 直到所有链收敛或耗尽轮数', () => {
      const r = new IKBone('r', new Vector3(0, 0, 0), undefined, 1);
      const e = new IKBone('e', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain({ iterations: 5, tolerance: 1e-6 });
      chain.addBone(r);
      chain.addBone(e);
      chain.target.set(1, 0, 0);

      const solver = new IKSolver();
      solver.addChain(chain);
      const worst = solver.solveUntilConverged(8, 1e-3);
      expect(worst).toBeLessThan(1e-3);
    });
  });
});

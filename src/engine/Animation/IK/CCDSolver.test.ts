// CCDSolver 单元测试:
//   • 2 骨链:可达目标
//   • 3 骨链:可达目标(末端伸到 target)
//   • 关节约束:hinge 约束将旋转钳制到 [minAngle, maxAngle]

import { describe, it, expect } from 'vitest';
import { IKChain } from './IKChain';
import { IKBone } from './IKBone';
import { CCDSolver } from './CCDSolver';
import { Vector3 } from '../../Math/Vector3';

describe('CCDSolver', () => {
  describe('2 骨链', () => {
    it('可达目标:末端到达 target', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain({ iterations: 20, tolerance: 1e-6 });
      chain.addBone(root);
      chain.addBone(end);
      chain.target.set(1, 0, 0); // 链长 1,目标距 root 也是 1

      const solver = new CCDSolver({ iterations: 20, tolerance: 1e-6 });
      const err = solver.solve(chain);
      expect(err).toBeLessThan(1e-3);
      const wp = end.getWorldPosition();
      expect(wp.x).toBeCloseTo(1, 4);
      expect(wp.y).toBeCloseTo(0, 4);
    });

    it('root 旋转后末端方向正确(90° 绕 Z)', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain();
      chain.addBone(root);
      chain.addBone(end);
      chain.target.set(1, 0, 0);

      const solver = new CCDSolver({ iterations: 20, tolerance: 1e-6 });
      solver.solve(chain);
      // root 的世界旋转应将 (0,1,0) 旋到 (1,0,0),即 -90° 绕 Z
      const wr = root.getWorldRotation();
      const angle = 2 * Math.atan2(wr.z, wr.w);
      expect(angle).toBeCloseTo(-Math.PI / 2, 3);
    });
  });

  describe('3 骨链', () => {
    it('可达目标:末端到达 target', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      const mid = new IKBone('mid', new Vector3(0, 1, 0), undefined, 1);
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain({ iterations: 30, tolerance: 1e-6 });
      chain.addBone(root);
      chain.addBone(mid);
      chain.addBone(end);
      // 总长 2,target 距 root 1.5(明确可达,链需弯曲)
      chain.target.set(1.5, 0, 0);

      const solver = new CCDSolver({ iterations: 30, tolerance: 1e-6 });
      const err = solver.solve(chain);
      expect(err).toBeLessThan(1e-3);
      const wp = end.getWorldPosition();
      expect(wp.x).toBeCloseTo(1.5, 3);
      expect(wp.y).toBeCloseTo(0, 3);
    });

    it('边界情形(目标恰为最大延伸):CCD 收敛较慢但仍朝 target 方向伸长', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      const mid = new IKBone('mid', new Vector3(0, 1, 0), undefined, 1);
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain({ iterations: 60, tolerance: 1e-6 });
      chain.addBone(root);
      chain.addBone(mid);
      chain.addBone(end);
      // 总长 2,target 距 root 也是 2(恰为最大延伸,Jacobian 奇异,CCD 收敛慢)
      chain.target.set(2, 0, 0);

      const solver = new CCDSolver({ iterations: 60, tolerance: 1e-6 });
      const err = solver.solve(chain);
      // 边界情形容差放宽到 5e-2
      expect(err).toBeLessThan(5e-2);
      const wp = end.getWorldPosition();
      expect(wp.x).toBeCloseTo(2, 1);
      expect(wp.y).toBeCloseTo(0, 1);
    });

    it('不可达目标:朝 target 方向伸长但不超总长', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      const mid = new IKBone('mid', new Vector3(0, 1, 0), undefined, 1);
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain({ iterations: 30 });
      chain.addBone(root);
      chain.addBone(mid);
      chain.addBone(end);
      chain.target.set(10, 0, 0); // 不可达(链长 2 < 10)

      const solver = new CCDSolver({ iterations: 30 });
      solver.solve(chain);
      // 末端应在 (2, 0, 0) 附近(拉直朝 +X,最大延伸 2)
      const wp = end.getWorldPosition();
      expect(wp.x).toBeCloseTo(2, 1);
      expect(wp.y).toBeCloseTo(0, 1);
    });
  });

  describe('关节约束', () => {
    it('hinge 约束:旋转被钳制到 maxAngle', () => {
      // 2 骨链,root 有 hinge 约束(axis=Z, 0..π/4)
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      root.constraints = {
        minAngle: 0,
        maxAngle: Math.PI / 4, // 45°
        axis: new Vector3(0, 0, 1),
      };
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain();
      chain.addBone(root);
      chain.addBone(end);
      // target 在 (1,0,0):需要 -90° 绕 Z,但约束只允许 [0, 45°]
      chain.target.set(1, 0, 0);

      const solver = new CCDSolver({ iterations: 30, tolerance: 1e-6 });
      solver.solve(chain);
      // root 的世界旋转应在 [0, π/4] 范围内
      const wr = root.getWorldRotation();
      const angle = 2 * Math.atan2(wr.z, wr.w);
      expect(angle).toBeLessThanOrEqual(Math.PI / 4 + 1e-4);
      expect(angle).toBeGreaterThanOrEqual(-1e-4);
      // 期望落在 0(因为 -90° 不在 [0, π/4] 内,被钳到下限 0)
      expect(angle).toBeCloseTo(0, 3);
    });

    it('hinge 约束允许负角度:旋转被钳到 minAngle', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      root.constraints = {
        minAngle: -Math.PI / 4, // -45°
        maxAngle: Math.PI / 4,
        axis: new Vector3(0, 0, 1),
      };
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain();
      chain.addBone(root);
      chain.addBone(end);
      chain.target.set(1, 0, 0); // 需要 -90° 绕 Z

      const solver = new CCDSolver({ iterations: 30, tolerance: 1e-6 });
      solver.solve(chain);
      const wr = root.getWorldRotation();
      const angle = 2 * Math.atan2(wr.z, wr.w);
      // -90° 超出 [-45°, 45°],应被钳到 -45°
      expect(angle).toBeCloseTo(-Math.PI / 4, 3);
    });

    it('约束后末端无法到达 target(被钳制)', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0), undefined, 1);
      root.constraints = {
        minAngle: -Math.PI / 4,
        maxAngle: Math.PI / 4,
        axis: new Vector3(0, 0, 1),
      };
      const end = new IKBone('end', new Vector3(0, 1, 0), undefined, 0);
      const chain = new IKChain();
      chain.addBone(root);
      chain.addBone(end);
      chain.target.set(1, 0, 0);

      const solver = new CCDSolver({ iterations: 30, tolerance: 1e-6 });
      const err = solver.solve(chain);
      // 末端最多到 (sin(45°), cos(45°), 0) ≈ (0.707, 0.707, 0),误差 > 0.5
      expect(err).toBeGreaterThan(0.5);
    });
  });

  describe('API', () => {
    it('solveAll:批量求解多条链,返回最大误差', () => {
      // 链 1:可达
      const r1 = new IKBone('r1', new Vector3(0, 0, 0), undefined, 1);
      const e1 = new IKBone('e1', new Vector3(0, 1, 0), undefined, 0);
      const c1 = new IKChain();
      c1.addBone(r1);
      c1.addBone(e1);
      c1.target.set(1, 0, 0);

      // 链 2:不可达(链长 1,target 距离 5)
      const r2 = new IKBone('r2', new Vector3(0, 0, 0), undefined, 1);
      const e2 = new IKBone('e2', new Vector3(0, 1, 0), undefined, 0);
      const c2 = new IKChain();
      c2.addBone(r2);
      c2.addBone(e2);
      c2.target.set(5, 0, 0);

      const solver = new CCDSolver({ iterations: 20 });
      const worst = solver.solveAll([c1, c2]);
      // 链 2 末端误差 ≈ 4
      expect(worst).toBeGreaterThan(3.5);
    });

    it('空链 solve 不抛错', () => {
      const chain = new IKChain();
      const solver = new CCDSolver();
      expect(() => solver.solve(chain)).not.toThrow();
      expect(solver.solve(chain)).toBe(0);
    });
  });
});

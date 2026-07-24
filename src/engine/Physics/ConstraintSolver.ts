// ConstraintSolver — Sequential Impulse 风格约束求解器。
//
// 用法:
//   const solver = new ConstraintSolver();
//   solver.addConstraint(new BallJointConstraint(a, b, ...));
//   solver.solveAll(dt);  // 每物理步调用一次
//
// 求解策略:对约束集合迭代 `iterations` 次,每次顺序求解每个约束
// (Gauss-Seidel)。对于相互不严重耦合的约束集合,收敛性良好。

import { Constraint } from './Constraint';

export class ConstraintSolver {
  /** 注册的约束列表。 */
  constraints: Constraint[] = [];
  /** 求解迭代次数(默认 10)。 */
  iterations: number = 10;

  constructor(iterations: number = 10) {
    this.iterations = iterations;
  }

  /** 添加约束。 */
  addConstraint(c: Constraint): void {
    this.constraints.push(c);
  }

  /** 移除约束(引用相等)。 */
  removeConstraint(c: Constraint): void {
    const i = this.constraints.indexOf(c);
    if (i >= 0) this.constraints.splice(i, 1);
  }

  /** 清空所有约束。 */
  clear(): void {
    this.constraints.length = 0;
  }

  /** 迭代求解所有约束。 */
  solveAll(dt: number): void {
    if (dt <= 0) return;
    const list = this.constraints;
    for (let it = 0; it < this.iterations; it++) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.enabled) c.solve(dt);
      }
    }
  }
}

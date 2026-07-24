// IKSolver — manages a collection of IK chains and solves them all together.
//
// Each chain is solved independently (one chain's solve does not affect
// another's bones). This is sufficient for typical humanoid rigs where
// arm and leg chains share no joints. For chains that share bones, the
// caller should solve them in dependency order (e.g., spine before arms).
//
// `solve()` returns the maximum end-effector error across all chains,
// which is useful for deciding whether to iterate again or accept the
// current pose.

import { IKChain } from './IKChain';

export interface IKSolverOptions {
  /** Default iteration count passed to each chain's solve (default 10). */
  iterations?: number;
  /** Default convergence tolerance (default 1e-4). */
  tolerance?: number;
}

export class IKSolver {
  chains: IKChain[] = [];
  iterations: number;
  tolerance: number;

  constructor(opts: IKSolverOptions = {}) {
    this.iterations = opts.iterations ?? 10;
    this.tolerance = opts.tolerance ?? 1e-4;
  }

  /** Register a chain. The chain's own `iterations`/`tolerance` are
   *  preserved; the solver's defaults only apply if `solve()` is called
   *  without arguments. */
  addChain(chain: IKChain): this {
    if (!this.chains.includes(chain)) this.chains.push(chain);
    return this;
  }

  /** Remove a previously-registered chain. Returns true if found. */
  removeChain(chain: IKChain): boolean {
    const idx = this.chains.indexOf(chain);
    if (idx < 0) return false;
    this.chains.splice(idx, 1);
    return true;
  }

  /** Number of registered chains. */
  get size(): number {
    return this.chains.length;
  }

  /** Solve all chains once.
   *  @param iterations overrides the chain default for this call.
   *  @returns the worst (largest) end-effector error across all chains,
   *           or 0 if there are no chains. */
  solve(iterations?: number): number {
    let worst = 0;
    for (const chain of this.chains) {
      const err = chain.solve(iterations ?? this.iterations);
      if (err > worst) worst = err;
    }
    return worst;
  }

  /** Convenience: solve repeatedly until all chains converge to within
   *  `tolerance` or `maxRounds` is exhausted. Returns the worst error
   *  of the final round. */
  solveUntilConverged(maxRounds = 8, tolerance = this.tolerance): number {
    let worst = 0;
    for (let r = 0; r < maxRounds; r++) {
      worst = this.solve();
      if (worst <= tolerance) break;
    }
    return worst;
  }
}

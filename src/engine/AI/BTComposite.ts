// BTComposite — 行为树复合节点(Sequence/Selector/Parallel)。
//
// 设计:
//   * 复合节点持有子节点数组,按策略聚合子节点状态
//   * Sequence: 顺序 AND — 全部 success 才 success,任一 failure 即 failure
//   * Selector: 顺序 OR  — 任一 success 即 success,全部 failure 才 failure
//   * Parallel: 一次性 tick 所有子节点,按 success/failure 阈值判定
//   * 复合节点记 runningIndex,下一帧从该索引续 tick(避免从头重跑)
//
// 与 BTDecorator/BTAction/BTCondition 的关系:
//   * 复合节点是"分支",装饰器是"修饰",动作/条件是"叶"
//   * 任意 BTNode 都可作为复合节点的子节点(包括其他复合节点)

import { BTNode, type BTStatus } from './BTNode';
import type { Blackboard } from './Blackboard';

/**
 * 复合节点基类 — 持有子节点列表。
 */
export abstract class BTComposite extends BTNode {
  /** 子节点列表(顺序即执行顺序)。 */
  protected children: BTNode[] = [];
  /** 当前 running 子节点索引(下次 tick 从此索引开始)。 */
  protected runningIndex: number = 0;

  constructor(name: string = '', children: BTNode[] = []) {
    super(name);
    for (const c of children) this.addChild(c);
  }

  /** 添加子节点(回填 parent)。 */
  addChild(node: BTNode): this {
    node.parent = this;
    this.children.push(node);
    return this;
  }

  /** 移除指定子节点(引用相等)。 */
  removeChild(node: BTNode): this {
    const i = this.children.indexOf(node);
    if (i >= 0) {
      this.children.splice(i, 1);
      node.parent = null;
      // 修正 runningIndex
      if (this.runningIndex > i) this.runningIndex--;
      else if (this.runningIndex >= this.children.length) {
        this.runningIndex = Math.max(0, this.children.length - 1);
      }
    }
    return this;
  }

  /** 获取子节点列表(只读视图)。 */
  getChildren(): BTNode[] {
    return this.children.slice();
  }

  /** 子节点数量。 */
  get childCount(): number {
    return this.children.length;
  }

  /** 重置自身与所有子节点。 */
  reset(): void {
    super.reset();
    this.runningIndex = 0;
    for (const c of this.children) c.reset();
  }

  /** 中止自身与所有子节点。 */
  abort(): void {
    super.abort();
    this.runningIndex = 0;
    for (const c of this.children) c.abort();
  }
}

/**
 * Sequence — 顺序节点:依次 tick 子节点,全部 success 才 success。
 *
 * 行为:
 *   * 任一子节点 failure → 整体 failure,重置 runningIndex
 *   * 任一子节点 running → 整体 running,记录 runningIndex(下帧续跑)
 *   * 全部 success → 整体 success
 */
export class Sequence extends BTComposite {
  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted()) {
      this._status = 'failure';
      return this._status;
    }
    let i = this.runningIndex;
    while (i < this.children.length) {
      const child = this.children[i];
      const s = child.tick(blackboard);
      if (s === 'running') {
        this._status = 'running';
        this.runningIndex = i;
        return this._status;
      }
      if (s === 'failure') {
        this._status = 'failure';
        this.runningIndex = 0;
        return this._status;
      }
      // success → 继续下一个
      i++;
    }
    // 全部 success
    this._status = 'success';
    this.runningIndex = 0;
    return this._status;
  }
}

/**
 * Selector — 选择节点:依次 tick 子节点,任一 success 即 success。
 *
 * 行为:
 *   * 任一子节点 success → 整体 success,重置 runningIndex
 *   * 任一子节点 running → 整体 running,记录 runningIndex
 *   * 全部 failure → 整体 failure
 */
export class Selector extends BTComposite {
  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted()) {
      this._status = 'failure';
      return this._status;
    }
    let i = this.runningIndex;
    while (i < this.children.length) {
      const child = this.children[i];
      const s = child.tick(blackboard);
      if (s === 'running') {
        this._status = 'running';
        this.runningIndex = i;
        return this._status;
      }
      if (s === 'success') {
        this._status = 'success';
        this.runningIndex = 0;
        return this._status;
      }
      // failure → 尝试下一个
      i++;
    }
    // 全部 failure
    this._status = 'failure';
    this.runningIndex = 0;
    return this._status;
  }
}

/** Parallel 节点策略。 */
export interface ParallelPolicy {
  /** 多少子节点 success 即整体 success。 */
  successThreshold: number;
  /** 多少子节点 failure 即整体 failure。 */
  failureThreshold: number;
}

/**
 * Parallel — 并行节点:每帧 tick 所有子节点,按阈值判定整体状态。
 *
 * 行为:
 *   * 每帧从 0 到末尾依次 tick 所有子节点(running 子节点也每帧重 tick)
 *   * 累计 successCount/failureCount
 *   * successCount >= successThreshold → 整体 success
 *   * failureCount >= failureThreshold → 整体 failure
 *   * 否则 running
 *
 * 默认策略:successThreshold = childCount(全部成功),failureThreshold = 1(任一失败)。
 */
export class Parallel extends BTComposite {
  /** 判定策略。 */
  policy: ParallelPolicy;

  constructor(name: string = '', children: BTNode[] = [], policy?: ParallelPolicy) {
    super(name, children);
    this.policy = policy ?? { successThreshold: children.length, failureThreshold: 1 };
  }

  /** 添加子节点时同步默认策略(若用户未显式设置)。 */
  addChild(node: BTNode): this {
    super.addChild(node);
    // 默认策略下 successThreshold 跟随 childCount
    if (this.policy.successThreshold === this.children.length - 1) {
      this.policy.successThreshold = this.children.length;
    }
    return this;
  }

  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted()) {
      this._status = 'failure';
      return this._status;
    }
    let successCount = 0;
    let failureCount = 0;
    for (const child of this.children) {
      const s = child.tick(blackboard);
      if (s === 'success') successCount++;
      else if (s === 'failure') failureCount++;
    }
    if (successCount >= this.policy.successThreshold) {
      this._status = 'success';
      return this._status;
    }
    if (failureCount >= this.policy.failureThreshold) {
      this._status = 'failure';
      return this._status;
    }
    this._status = 'running';
    return this._status;
  }
}

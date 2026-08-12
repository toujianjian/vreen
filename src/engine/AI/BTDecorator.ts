// BTDecorator — 行为树装饰器节点(修饰单个子节点的行为)。
//
// 设计:
//   * 装饰器有且仅有一个子节点,在 tick 子节点后变换其状态
//   * 子节点通过 setChild 设置,parent 自动回填
//   * 子节点为 null 时 tick 返回 failure(避免运行时空指针)
//   * reset/abort 会级联到子节点
//
// 内置装饰器:
//   * Inverter   — success↔failure(running 保持)
//   * Repeater   — 重复 tick 子节点 N 次(或无限),任一 failure 即停止
//   * Succeeder  — 子节点任意结果都返回 success
//   * Failer     — 子节点任意结果都返回 failure
//   * UntilFail  — 重复 tick 子节点,直到子节点 failure 时整体 success

import { BTNode, type BTStatus } from './BTNode';
import type { Blackboard } from './Blackboard';

/**
 * 装饰器基类 — 持有单个子节点。
 */
export abstract class BTDecorator extends BTNode {
  /** 子节点。 */
  protected child: BTNode | null = null;

  constructor(name: string = '', child: BTNode | null = null) {
    super(name);
    if (child) this.setChild(child);
  }

  /** 设置子节点(回填 parent)。 */
  setChild(node: BTNode): this {
    if (this.child) this.child.parent = null;
    this.child = node;
    node.parent = this;
    return this;
  }

  /** 获取子节点。 */
  getChild(): BTNode | null {
    return this.child;
  }

  /** 重置自身与子节点。 */
  reset(): void {
    super.reset();
    if (this.child) this.child.reset();
  }

  /** 中止自身与子节点。 */
  abort(): void {
    super.abort();
    if (this.child) this.child.abort();
  }
}

/**
 * Inverter — 反转子节点结果。
 * success → failure,failure → success,running → running。
 */
export class Inverter extends BTDecorator {
  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted() || !this.child) {
      this._status = 'failure';
      return this._status;
    }
    const s = this.child.tick(blackboard);
    if (s === 'success') this._status = 'failure';
    else if (s === 'failure') this._status = 'success';
    else this._status = 'running';
    return this._status;
  }
}

/**
 * Repeater — 重复 tick 子节点。
 * count > 0:固定次数;count < 0:无限循环(直到子节点 failure 或被 abort)。
 * 任一子节点 failure 立即停止并返回 failure;running 直接透传(running 次数不算)。
 */
export class Repeater extends BTDecorator {
  /** 重复次数(< 0 表示无限)。 */
  count: number;
  /** 已完成次数(running 不计入)。 */
  private done: number = 0;

  constructor(name: string = '', child: BTNode | null = null, count: number = 1) {
    super(name, child);
    this.count = count;
  }

  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted() || !this.child) {
      this._status = 'failure';
      return this._status;
    }
    const infinite = this.count < 0;
    while (infinite || this.done < this.count) {
      const s = this.child.tick(blackboard);
      if (s === 'running') {
        this._status = 'running';
        return this._status;
      }
      if (s === 'failure') {
        this._status = 'failure';
        this.done = 0;
        this.child.reset();
        return this._status;
      }
      // success — 计数并继续
      this.done++;
      this.child.reset();
    }
    // 达到目标次数
    this._status = 'success';
    this.done = 0;
    return this._status;
  }

  reset(): void {
    super.reset();
    this.done = 0;
  }
}

/**
 * Succeeder — 无论子节点返回什么,本节点都返回 success。
 * running 透传(动作未完成时不强行 success)。
 */
export class Succeeder extends BTDecorator {
  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted() || !this.child) {
      this._status = 'failure';
      return this._status;
    }
    const s = this.child.tick(blackboard);
    this._status = s === 'running' ? 'running' : 'success';
    return this._status;
  }
}

/**
 * Failer — 无论子节点返回什么,本节点都返回 failure。
 * running 透传。
 */
export class Failer extends BTDecorator {
  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted() || !this.child) {
      this._status = 'failure';
      return this._status;
    }
    const s = this.child.tick(blackboard);
    this._status = s === 'running' ? 'running' : 'failure';
    return this._status;
  }
}

/**
 * UntilFail — 重复 tick 子节点,直到子节点返回 failure 时整体返回 success。
 * 子节点 success/running → 继续 running(下一帧再 tick);
 * 子节点 failure → 整体 success。
 * maxIterations 限制单次 tick 内最多循环次数(默认 1 = 每次 tick 最多检查一次,
 * 即"success → 等下一帧再检查";显式传 < 0 才无限循环,需保证子节点最终会 failure)。
 */
export class UntilFail extends BTDecorator {
  /** 最大迭代次数(防止无限循环,< 0 表示无限)。 */
  maxIterations: number;
  /** 已迭代次数。 */
  private iter: number = 0;

  constructor(name: string = '', child: BTNode | null = null, maxIterations: number = 1) {
    super(name, child);
    this.maxIterations = maxIterations;
  }

  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted() || !this.child) {
      this._status = 'failure';
      return this._status;
    }
    const infinite = this.maxIterations < 0;
    while (infinite || this.iter < this.maxIterations) {
      const s = this.child.tick(blackboard);
      this.iter++;
      if (s === 'failure') {
        this._status = 'success';
        this.iter = 0;
        this.child.reset();
        return this._status;
      }
      if (s === 'running') {
        this._status = 'running';
        return this._status;
      }
      // success → 继续下一轮
      this.child.reset();
    }
    // 达到上限仍未 failure → 返回 running(等待下一帧)
    this._status = 'running';
    this.iter = 0;
    return this._status;
  }

  reset(): void {
    super.reset();
    this.iter = 0;
  }
}

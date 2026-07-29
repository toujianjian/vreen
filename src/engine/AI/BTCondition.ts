// BTCondition — 行为树条件节点(叶节点)。
//
// 设计:
//   * 条件节点是无副作用叶节点,只读取黑板判断条件是否成立
//   * checkFn 返回 boolean:true → success,false → failure
//   * 条件节点永不返回 running(瞬时判定)
//   * 未设置 checkFn 时 tick 返回 failure
//
// 与 BTAction 的关系:
//   * 条件节点是"只读"叶节点,动作节点是"有副作用"叶节点
//   * 常与 Selector/Sequence 组合实现 "if-then" 控制流

import { BTNode, type BTStatus } from './BTNode';
import type { Blackboard } from './Blackboard';

/** 条件检查函数签名。 */
export type BTConditionFn = (blackboard: Blackboard) => boolean;

/**
 * 条件节点 — 检查条件是否成立的叶节点。
 */
export class BTCondition extends BTNode {
  /** 条件检查函数。 */
  protected checkFn: BTConditionFn | null;

  constructor(name: string = '', checkFn: BTConditionFn | null = null) {
    super(name);
    this.checkFn = checkFn;
  }

  /** 设置检查函数。 */
  setCheck(fn: BTConditionFn): this {
    this.checkFn = fn;
    return this;
  }

  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted() || !this.checkFn) {
      this._status = 'failure';
      return this._status;
    }
    this._status = this.checkFn(blackboard) ? 'success' : 'failure';
    return this._status;
  }
}

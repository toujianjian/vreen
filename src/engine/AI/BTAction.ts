// BTAction — 行为树动作节点(叶节点)。
//
// 设计:
//   * 动作节点是行为树的叶,执行具体逻辑(移动/攻击/拾取/播放动画等)
//   * 通过 executeFn 注入逻辑,与引擎其他系统(ECS/Agent/Animation)解耦
//   * executeFn 接收 blackboard,返回 BTStatus
//   * 未设置 executeFn 时 tick 返回 failure(避免运行时空指针)
//
// 用法:
//   const attack = new BTAction('attack', (bb) => {
//     const target = bb.get('target');
//     if (!target) return 'failure';
//     // ... 执行攻击
//     return 'success';
//   });

import { BTNode, type BTStatus } from './BTNode';
import type { Blackboard } from './Blackboard';

/** 动作执行函数签名。 */
export type BTActionFn = (blackboard: Blackboard) => BTStatus;

/**
 * 动作节点 — 执行具体逻辑的叶节点。
 */
export class BTAction extends BTNode {
  /** 动作执行函数。 */
  protected executeFn: BTActionFn | null;

  constructor(name: string = '', executeFn: BTActionFn | null = null) {
    super(name);
    this.executeFn = executeFn;
  }

  /** 设置执行函数。 */
  setExecute(fn: BTActionFn): this {
    this.executeFn = fn;
    return this;
  }

  tick(blackboard: Blackboard): BTStatus {
    if (this.isAborted() || !this.executeFn) {
      this._status = 'failure';
      return this._status;
    }
    this._status = this.executeFn(blackboard);
    return this._status;
  }
}

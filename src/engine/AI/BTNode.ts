// BTNode — 行为树节点基类。
//
// 设计:
//   * 所有行为树节点(复合/装饰/动作/条件)继承自此基类
//   * status 表示最近一次 tick 后的执行状态
//   * parent 由父节点在 addChild/setChild 时回填,用于 abort 路径回溯
//   * tick 由子类实现,reset 与 abort 提供默认实现(递归清理子树)
//
// 状态约定(BTStatus):
//   * 'success' — 本节点本次执行完成且成功
//   * 'failure' — 本节点本次执行失败(条件不满足/动作出错)
//   * 'running' — 本节点正在执行,下一帧需继续 tick

import type { Blackboard } from './Blackboard';

/** 行为树节点执行状态。 */
export type BTStatus = 'success' | 'failure' | 'running';

/**
 * 行为树节点基类。
 *
 * 子类应实现 `tick(blackboard)`,在其中读写黑板并返回新的 status。
 * 不要在构造函数中设置 status,初始默认 'failure' 以避免未 tick 即 'success' 误判。
 */
export abstract class BTNode {
  /** 节点名称(调试/可视化用)。 */
  name: string;
  /** 最近一次 tick 的状态。 */
  protected _status: BTStatus = 'failure';
  /** 父节点(根节点为 null)。 */
  parent: BTNode | null = null;
  /** 是否已中止(中止后 tick 不再执行,需 reset 才能恢复)。 */
  protected _aborted: boolean = false;

  constructor(name: string = '') {
    this.name = name;
  }

  /** 执行节点(子类实现)。 */
  abstract tick(blackboard: Blackboard): BTStatus;

  /** 获取当前状态。 */
  getStatus(): BTStatus {
    return this._status;
  }

  /** 重置节点状态(子类可 override 扩展,如重置内部游标)。 */
  reset(): void {
    this._status = 'failure';
    this._aborted = false;
  }

  /** 中止节点(立即停止 running,标记为 failure)。 */
  abort(): void {
    this._aborted = true;
    this._status = 'failure';
  }

  /** 是否已中止。 */
  isAborted(): boolean {
    return this._aborted;
  }
}

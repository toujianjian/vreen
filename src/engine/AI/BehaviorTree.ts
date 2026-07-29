// BehaviorTree — 行为树主控。
//
// 设计:
//   * 持有 root(BTNode)与 blackboard(Blackboard),每帧 tick 一次
//   * tick() 返回 root 的状态(success/failure/running)
//   * interrupt() 中断当前 running 子树(递归 abort 所有节点)
//   * 中断后再次 tick 前需 reset() 复位节点(否则 tick 直接返回 failure)
//   * 行为树本身不感知时间,dt 由调用方在 action 内通过 blackboard 传入
//
// 与 AI 模块其他组件的关系:
//   * BehaviorTree 可作为 Agent 的决策器:每帧 tick → action 写入 Agent.path/velocity
//   * Blackboard 作为感知层:外部系统(感知/导航)写入目标位置/敌人列表/HP,
//     行为树节点读取后决策
//   * 与 Scripting/ 互补:Scripting 是命令式脚本,行为树是声明式决策结构

import { BTNode, type BTStatus } from './BTNode';
import { Blackboard } from './Blackboard';

/**
 * 行为树 — AI 决策结构主控。
 *
 * 用法:
 *   const bt = new BehaviorTree();
 *   bt.setRoot(new Selector('root', [
 *     new BTCondition('hasTarget', (bb) => bb.has('target')),
 *     new BTAction('wander', (bb) => { /* ... *\/ return 'success'; }),
 *   ]));
 *   bt.getBlackboard().set('target', new Vector3());
 *   const status = bt.tick();
 */
export class BehaviorTree {
  /** 根节点。 */
  protected root: BTNode | null = null;
  /** 共享黑板。 */
  protected blackboard: Blackboard;
  /** 是否已中断(中断后 tick 直接返回 failure,直到 reset)。 */
  protected interrupted: boolean = false;
  /** 最近一次 tick 的状态。 */
  protected lastStatus: BTStatus = 'failure';

  constructor(root: BTNode | null = null, blackboard: Blackboard | null = null) {
    this.root = root;
    this.blackboard = blackboard ?? new Blackboard();
  }

  /** 设置根节点。 */
  setRoot(node: BTNode): this {
    this.root = node;
    node.parent = null;
    return this;
  }

  /** 获取根节点。 */
  getRoot(): BTNode | null {
    return this.root;
  }

  /** 获取黑板(可读写)。 */
  getBlackboard(): Blackboard {
    return this.blackboard;
  }

  /** 替换黑板(用于共享黑板场景)。 */
  setBlackboard(bb: Blackboard): this {
    this.blackboard = bb;
    return this;
  }

  /** 执行一次行为树。 */
  tick(): BTStatus {
    if (this.interrupted || !this.root) {
      this.lastStatus = 'failure';
      return this.lastStatus;
    }
    this.lastStatus = this.root.tick(this.blackboard);
    return this.lastStatus;
  }

  /** 获取最近一次 tick 的状态。 */
  getLastStatus(): BTStatus {
    return this.lastStatus;
  }

  /** 中断执行(递归 abort 整棵树)。
   *  中断后 tick 返回 failure,需 reset 才能恢复。 */
  interrupt(): this {
    this.interrupted = true;
    if (this.root) this.root.abort();
    this.lastStatus = 'failure';
    return this;
  }

  /** 重置行为树(清除中断状态 + 递归 reset 节点)。 */
  reset(): this {
    this.interrupted = false;
    if (this.root) this.root.reset();
    this.lastStatus = 'failure';
    return this;
  }

  /** 是否已中断。 */
  isInterrupted(): boolean {
    return this.interrupted;
  }
}

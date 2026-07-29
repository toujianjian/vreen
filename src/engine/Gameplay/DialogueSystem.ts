// DialogueSystem — 对话系统主控。
//
// 设计:
//   * 持多棵 DialogueTree(通过 trees: Map<id, DialogueTree> 注册)
//   * 持参与者表 participants: Map<id, DialogueParticipant>
//   * 当前活跃对话由 currentTree + currentNode 表示
//   * 通过 EventBus 派发事件:dialogue:start / dialogue:advance / dialogue:choose / dialogue:end
//   * 历史 dialogueHistory: DialogueNode[] 记录访问过的节点(用于回看 / 存档)
//
// 状态机:
//   IDLE → start(treeId, participantId) → ACTIVE
//   ACTIVE.advance() → 推进到 nextId / 选项默认跳转 / 结束
//   ACTIVE.chooseOption(idx) → 执行选项 action + 跳转 nextId
//   ACTIVE.end() / 末节点 → IDLE
//
// 不变量:
//   - 同时只有一个活跃对话(isActive() === currentTree != null)
//   - start() 时若已有活跃对话,先 end() 旧的
//   - advance() 返回 null 表示对话结束(已自动 end)
//   - chooseOption(idx) 越界返回 false(不抛错)

import { EventBus } from '../Events/EventBus';
import { DialogueTree, type DialogueNode, type DialogueOption } from './DialogueTree';
import type { DialogueParticipant } from './DialogueParticipant';

/** 对话系统事件名常量。 */
export const DIALOGUE_EVENTS = {
  START: 'dialogue:start',
  ADVANCE: 'dialogue:advance',
  CHOOSE: 'dialogue:choose',
  END: 'dialogue:end',
} as const;

/** 对话开始事件载荷。 */
export interface DialogueStartPayload {
  treeId: string;
  participantId: string;
  node: DialogueNode;
}

/** 对话推进事件载荷。 */
export interface DialogueAdvancePayload {
  from: DialogueNode | null;
  to: DialogueNode | null;
}

/** 对话选择事件载荷。 */
export interface DialogueChoosePayload {
  optionIndex: number;
  option: DialogueOption;
  to: DialogueNode | null;
}

/** 对话结束事件载荷。 */
export interface DialogueEndPayload {
  treeId: string;
  participantId: string;
  history: DialogueNode[];
}

/**
 * 对话系统 — 管理多棵对话树与活跃对话状态。
 *
 * 使用方式:
 *   const sys = new DialogueSystem();
 *   sys.registerTree(tree);
 *   sys.registerParticipant(npc);
 *   sys.start('npc1_tree', 'npc1');
 *   while (sys.isActive()) {
 *     const node = sys.getCurrentNode()!;
 *     // 渲染 node.text 与 sys.getOptions()
 *     sys.chooseOption(0);  // 或 sys.advance()
 *   }
 */
export class DialogueSystem {
  /** 事件总线(可选,不传则不派发事件)。 */
  readonly bus: EventBus | null;
  /** 已注册的对话树:id → DialogueTree。 */
  private readonly trees: Map<string, DialogueTree> = new Map();
  /** 已注册的参与者:id → DialogueParticipant。 */
  readonly participants: Map<string, DialogueParticipant> = new Map();
  /** 当前活跃对话树(无活跃对话时为 null)。 */
  currentTree: DialogueTree | null = null;
  /** 当前对话节点(无活跃对话时为 null)。 */
  currentNode: DialogueNode | null = null;
  /** 当前对话参与者 ID(无活跃对话时为空字符串)。 */
  currentParticipantId: string = '';
  /** 对话历史(本次活跃对话期间访问过的节点,按顺序)。 */
  dialogueHistory: DialogueNode[] = [];

  constructor(bus: EventBus | null = null) {
    this.bus = bus;
  }

  /** 注册对话树。 */
  registerTree(tree: DialogueTree): this {
    // 树 id 用 rootId 标识;若需自定义 id 应在构造时设置
    const id = tree.rootId;
    if (!id) throw new Error('DialogueTree.rootId must be set before registerTree');
    this.trees.set(id, tree);
    return this;
  }

  /** 注册参与者。 */
  registerParticipant(participant: DialogueParticipant): this {
    this.participants.set(participant.id, participant);
    return this;
  }

  /** 获取已注册的对话树。 */
  getTree(id: string): DialogueTree | undefined {
    return this.trees.get(id);
  }

  /** 获取已注册的参与者。 */
  getParticipant(id: string): DialogueParticipant | undefined {
    return this.participants.get(id);
  }

  /** 是否有活跃对话。 */
  isActive(): boolean {
    return this.currentTree !== null && this.currentNode !== null;
  }

  /** 开始对话。返回是否成功开始。
   *  treeId 通常为对话树的 rootId;participantId 用于事件载荷与 UI 显示头像。
   *  若已有活跃对话,先 end() 旧的。 */
  start(treeId: string, participantId: string): boolean {
    const tree = this.trees.get(treeId);
    if (!tree) return false;
    if (this.isActive()) this.end();
    const entry = tree.getEntry() ?? tree.getRoot();
    if (!entry) return false;
    this.currentTree = tree;
    this.currentNode = entry;
    this.currentParticipantId = participantId;
    this.dialogueHistory = [entry];
    // 触发节点 action
    entry.action?.();
    this.bus?.emit(DIALOGUE_EVENTS.START, {
      treeId,
      participantId,
      node: entry,
    } as DialogueStartPayload);
    return true;
  }

  /** 推进对话到下一节点(使用 currentNode.nextId)。
   *  返回新的当前节点;若对话结束返回 null。
   *  若当前节点有 options,advance() 默认走第一个可见选项(便于线性对话)。 */
  advance(): DialogueNode | null {
    if (!this.isActive() || !this.currentTree || !this.currentNode) return null;
    const current = this.currentNode;
    // 若有 options,走第一个可见选项
    const options = this.currentTree.getOptions(current.id);
    let nextId = '';
    if (options.length > 0) {
      nextId = options[0].nextId;
      options[0].action?.();
    } else {
      nextId = current.nextId ?? '';
    }
    const next = nextId ? this.currentTree.getNode(nextId) : undefined;
    const to: DialogueNode | null = next ?? null;
    this.bus?.emit(DIALOGUE_EVENTS.ADVANCE, {
      from: current,
      to,
    } as DialogueAdvancePayload);
    if (!next) {
      this.end();
      return null;
    }
    this.currentNode = next;
    this.dialogueHistory.push(next);
    next.action?.();
    return next;
  }

  /** 选择选项。返回是否成功(越界或无活跃对话返回 false)。
   *  选择后会执行 option.action 并跳转到 option.nextId。 */
  chooseOption(optionIndex: number): boolean {
    if (!this.isActive() || !this.currentTree || !this.currentNode) return false;
    const options = this.currentTree.getOptions(this.currentNode.id);
    if (optionIndex < 0 || optionIndex >= options.length) return false;
    const opt = options[optionIndex];
    opt.action?.();
    const next = opt.nextId ? this.currentTree.getNode(opt.nextId) : undefined;
    const to: DialogueNode | null = next ?? null;
    this.bus?.emit(DIALOGUE_EVENTS.CHOOSE, {
      optionIndex,
      option: opt,
      to,
    } as DialogueChoosePayload);
    if (!next) {
      this.end();
      return true;
    }
    this.currentNode = next;
    this.dialogueHistory.push(next);
    next.action?.();
    return true;
  }

  /** 结束当前对话。无活跃对话时是 no-op。 */
  end(): void {
    if (!this.currentTree) return;
    const treeId = this.currentTree.rootId;
    const participantId = this.currentParticipantId;
    const history = this.dialogueHistory.slice();
    this.currentTree = null;
    this.currentNode = null;
    this.currentParticipantId = '';
    this.dialogueHistory = [];
    this.bus?.emit(DIALOGUE_EVENTS.END, {
      treeId,
      participantId,
      history,
    } as DialogueEndPayload);
  }

  /** 获取当前节点(无活跃对话返回 null)。 */
  getCurrentNode(): DialogueNode | null {
    return this.currentNode;
  }

  /** 获取当前节点的可见选项(无活跃对话返回空数组)。 */
  getOptions(): DialogueOption[] {
    if (!this.isActive() || !this.currentTree || !this.currentNode) return [];
    return this.currentTree.getOptions(this.currentNode.id);
  }

  /** 获取对话历史(节点快照数组,顺序为访问顺序)。 */
  getHistory(): DialogueNode[] {
    return this.dialogueHistory.slice();
  }

  /** 清空所有注册的对话树与参与者(不会结束活跃对话,需先 end())。 */
  clear(): void {
    this.trees.clear();
    this.participants.clear();
  }
}

// DialogueTree — 对话树(节点 + 选项的有向图)。
//
// 设计:
//   * 节点存于 Map<string, DialogueNode>,通过 id 索引,支持非线性结构(分支/循环)
//   * 选项(DialogueOption)可指向任意 nextId,实现分支
//   * 节点可选 nextId:若无 options 则用 nextId 推进(线性对话)
//   * 节点可选 condition:运行时谓词,决定节点是否可见/可选(condition 不进 JSON)
//   * 节点可选 action:运行时回调,节点被访问时触发(action 不进 JSON)
//
// 序列化:
//   * saveToJSON() 只导出 nodes + rootId + entryId + 节点静态字段(id/speaker/text/options/nextId)
//   * condition / action 等函数字段不导出,需调用方在 loadFromJSON 后重新注入
//
// 不变量:
//   - 每个节点的 id 在树内唯一
//   - options[i].nextId 若非空,必须指向树中存在的节点(否则 advance 时返回 null)
//   - rootId 必须指向存在的节点;entryId 是默认开始节点(可与 rootId 不同,用于「从某分支开始」)

/** 对话选项。 */
export interface DialogueOption {
  /** 选项显示文本。 */
  text: string;
  /** 选择后跳转的节点 ID。空字符串表示结束对话。 */
  nextId: string;
  /** 运行时条件谓词(可选,不进 JSON)。返回 false 则该选项不可见。 */
  condition?: () => boolean;
  /** 选择时触发的动作(可选,不进 JSON)。 */
  action?: () => void;
}

/** 对话节点。 */
export interface DialogueNode {
  /** 节点唯一 ID。 */
  id: string;
  /** 发言者参与者 ID(对应 DialogueParticipant.id)。 */
  speaker: string;
  /** 节点文本(可本地化)。 */
  text: string;
  /** 选项列表(若为空,则用 nextId 推进)。 */
  options: DialogueOption[];
  /** 运行时条件谓词(可选,不进 JSON)。返回 false 则节点被跳过。 */
  condition?: () => boolean;
  /** 节点被访问时触发的动作(可选,不进 JSON)。 */
  action?: () => void;
  /** 默认下一节点 ID(若 options 为空时使用)。空字符串表示对话结束。 */
  nextId?: string;
}

/** 对话树 JSON 序列化结构(只含静态字段)。 */
export interface DialogueTreeJSON {
  rootId: string;
  entryId: string;
  nodes: Array<{
    id: string;
    speaker: string;
    text: string;
    options: Array<{ text: string; nextId: string }>;
    nextId?: string;
  }>;
}

/**
 * 对话树 — 由节点和选项组成的有向图。
 *
 * 一个 DialogueTree 描述一次完整对话(如与某个 NPC 的全部对白)。
 * 树内节点通过 id 索引,选项的 nextId 决定分支跳转。
 */
export class DialogueTree {
  /** 节点表:id → DialogueNode。 */
  private readonly nodes: Map<string, DialogueNode> = new Map();
  /** 根节点 ID(树的入口,通常是第一个节点)。 */
  rootId: string;
  /** 默认开始节点 ID(可与 rootId 不同,用于从某分支恢复对话)。 */
  entryId: string;

  constructor(options: Partial<DialogueTreeOptions> = {}) {
    this.rootId = options.rootId ?? '';
    this.entryId = options.entryId ?? this.rootId;
  }

  /** 添加节点。若 rootId 为空,自动设为该节点 id。 */
  addNode(node: DialogueNode): this {
    this.nodes.set(node.id, node);
    if (!this.rootId) {
      this.rootId = node.id;
      if (!this.entryId) this.entryId = node.id;
    }
    return this;
  }

  /** 获取节点。不存在则返回 undefined。 */
  getNode(id: string): DialogueNode | undefined {
    return this.nodes.get(id);
  }

  /** 获取根节点。 */
  getRoot(): DialogueNode | undefined {
    return this.rootId ? this.nodes.get(this.rootId) : undefined;
  }

  /** 获取入口节点(默认开始节点)。 */
  getEntry(): DialogueNode | undefined {
    const id = this.entryId || this.rootId;
    return id ? this.nodes.get(id) : undefined;
  }

  /** 获取某节点的可见选项(过滤 condition 返回 false 的)。 */
  getOptions(nodeId: string): DialogueOption[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    return node.options.filter((opt) => !opt.condition || opt.condition());
  }

  /** 获取所有节点数量。 */
  get size(): number {
    return this.nodes.size;
  }

  /** 是否包含某节点。 */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /** 移除节点。返回是否成功移除。 */
  removeNode(id: string): boolean {
    return this.nodes.delete(id);
  }

  /** 清空所有节点。 */
  clear(): void {
    this.nodes.clear();
    this.rootId = '';
    this.entryId = '';
  }

  /** 序列化为 JSON(只含静态字段,condition/action 丢失)。 */
  saveToJSON(): DialogueTreeJSON {
    return {
      rootId: this.rootId,
      entryId: this.entryId,
      nodes: Array.from(this.nodes.values()).map((n) => ({
        id: n.id,
        speaker: n.speaker,
        text: n.text,
        options: n.options.map((o) => ({ text: o.text, nextId: o.nextId })),
        nextId: n.nextId,
      })),
    };
  }

  /** 从 JSON 加载(替换现有节点)。condition/action 需调用方后续注入。 */
  loadFromJSON(json: DialogueTreeJSON): this {
    this.clear();
    this.rootId = json.rootId;
    this.entryId = json.entryId || json.rootId;
    for (const n of json.nodes) {
      this.addNode({
        id: n.id,
        speaker: n.speaker,
        text: n.text,
        options: n.options.map((o) => ({
          text: o.text,
          nextId: o.nextId,
        })),
        nextId: n.nextId,
      });
    }
    return this;
  }
}

/** DialogueTree 构造参数。 */
export interface DialogueTreeOptions {
  rootId: string;
  entryId: string;
}

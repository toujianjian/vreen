// UndoRedoSystem — 撤销/重做系统。
// 维护 undo/redo 两个栈,execute() 执行并压入 undo 栈,undo() 弹出并执行反操作
// 同时压入 redo 栈,redo() 反之。支持 beginGroup/endGroup 把多个操作合并为单个原子。
//
// 设计:
//   * HistoryAction 自带 undo/redo 闭包,系统不关心具体语义,
//     只负责栈管理。execute() 时调用 action.redo() 执行副作用。
//   * beginGroup(name) 后所有 execute() 进入临时 buffer,endGroup()
//     合并为一个 GroupAction 压入 undo 栈。组内 undo/redo 一起执行。
//   * maxHistory 限制栈大小,超出则丢弃最旧条目(FIFO)。
//   * 任何新 execute() 会清空 redo 栈(经典不可分支历史模型)。

/** 历史操作。undo/redo 必须可逆且幂等(多次调用结果一致)。 */
export interface HistoryAction {
  /** 操作名(用于 UI 显示历史列表)。 */
  name: string;
  /** 撤销:把状态恢复到此操作执行之前。 */
  undo(): void;
  /** 重做:把状态推进到此操作执行之后(首次 execute 时也会调用)。 */
  redo(): void;
}

/** 栈中条目:既可能是单个 action,也可能是合并后的 group。 */
interface HistoryEntry {
  name: string;
  undo(): void;
  redo(): void;
}

/** 历史记录条目(供 getHistory() 返回,UI 展示用)。 */
export interface HistoryEntryView {
  name: string;
  /** 是否在 undo 栈(可撤销)中;false 表示在 redo 栈(可重做)。 */
  canUndo: boolean;
}

/**
 * 把多个 action 合并为一个 entry。undo 倒序执行,redo 正序执行。
 * 倒序 undo 保证恢复语义正确(后做的先撤回)。
 */
function makeGroupEntry(name: string, actions: HistoryAction[]): HistoryEntry {
  return {
    name,
    undo(): void {
      for (let i = actions.length - 1; i >= 0; i--) {
        actions[i].undo();
      }
    },
    redo(): void {
      for (let i = 0; i < actions.length; i++) {
        actions[i].redo();
      }
    },
  };
}

export class UndoRedoSystem {
  /** 可撤销栈(栈顶为最近操作)。 */
  readonly undoStack: HistoryEntry[] = [];
  /** 可重做栈(栈顶为最近被 undo 的操作)。 */
  readonly redoStack: HistoryEntry[] = [];
  /** 最大历史条数。超出丢弃最旧。 */
  maxHistory: number;

  /** 当前是否处于 group 模式(beginGroup 后 endGroup 前)。 */
  private grouping: boolean = false;
  /** group 期间累积的 action。 */
  private groupBuffer: HistoryAction[] = [];
  /** 当前 group 名。 */
  private groupName: string = '';

  constructor(maxHistory: number = 100) {
    this.maxHistory = maxHistory > 0 ? maxHistory : 100;
  }

  /**
   * 执行一个 action 并压入 undo 栈。
   * - 调用 action.redo() 应用副作用
   * - 清空 redo 栈(经典线性历史)
   * - group 模式下不直接入栈,而是累积到 buffer
   * - 超过 maxHistory 时丢弃 undoStack 最旧条目
   */
  execute(action: HistoryAction): void {
    // 先执行副作用;若失败则不入栈
    action.redo();

    if (this.grouping) {
      this.groupBuffer.push(action);
      return;
    }

    this.pushUndo({
      name: action.name,
      undo: () => action.undo(),
      redo: () => action.redo(),
    });
  }

  /** 撤销栈顶操作。无操作返回 false。 */
  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    const entry = this.undoStack.pop()!;
    entry.undo();
    this.redoStack.push(entry);
    return true;
  }

  /** 重做栈顶操作。无操作返回 false。 */
  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const entry = this.redoStack.pop()!;
    entry.redo();
    this.undoStack.push(entry);
    return true;
  }

  /** 是否可撤销。 */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 是否可重做。 */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 清空 undo/redo 栈。group 模式下也清空 buffer。 */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.groupBuffer.length = 0;
    this.grouping = false;
    this.groupName = '';
  }

  /**
   * 获取历史记录视图(undo 栈在前,redo 栈倒序在后)。
   * 用于 UI 渲染历史列表。返回快照,外部修改不影响内部。
   */
  getHistory(): HistoryEntryView[] {
    const result: HistoryEntryView[] = [];
    for (const e of this.undoStack) {
      result.push({ name: e.name, canUndo: true });
    }
    // redo 栈倒序:栈顶(最近 undo 的)排在前
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      result.push({ name: this.redoStack[i].name, canUndo: false });
    }
    return result;
  }

  /**
   * 开始一个操作组。后续 execute() 累积到 buffer,直到 endGroup() 合并。
   * 嵌套 group 不支持(再次 beginGroup 会覆盖当前 group 名但不报错)。
   */
  beginGroup(name: string): void {
    if (this.grouping) {
      // 已在 group 中:把现有 buffer 合并后再开新 group,避免丢失
      this.endGroup();
    }
    this.grouping = true;
    this.groupName = name;
    this.groupBuffer = [];
  }

  /**
   * 结束当前 group,把累积的 action 合并为单个 entry 压入 undo 栈。
   * 空 group(无 action)不入栈。
   */
  endGroup(): void {
    if (!this.grouping) return;
    const actions = this.groupBuffer;
    const name = this.groupName;
    this.grouping = false;
    this.groupBuffer = [];
    this.groupName = '';
    if (actions.length === 0) return;
    if (actions.length === 1) {
      // 单 action group 不需要包装
      this.pushUndo({
        name,
        undo: () => actions[0].undo(),
        redo: () => actions[0].redo(),
      });
    } else {
      this.pushUndo(makeGroupEntry(name, actions));
    }
  }

  /** 内部:压入 undo 栈并裁剪到 maxHistory,同时清空 redo 栈。 */
  private pushUndo(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    // 超限:丢弃最旧
    while (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    // 新操作入栈后,redo 分支失效
    this.redoStack.length = 0;
  }
}

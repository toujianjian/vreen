// UndoRedoSystem — 编辑器撤销/重做系统 (命令模式 + 命令栈)。
//
// 设计:
//   * UndoCommand 自带 execute/undo 闭包,系统不关心具体语义,只负责栈管理。
//     execute(command) 时调用 command.execute() 应用副作用,压入 undoStack,
//     同时清空 redoStack (经典不可分支历史模型)。
//   * undo() 弹出 undoStack 栈顶,调用 command.undo(),压入 redoStack。
//   * redo() 弹出 redoStack 栈顶,调用 command.execute(),压入 undoStack。
//   * beginBatch(description)/endBatch() 把多个 command 合并为单个 BatchCommand,
//     undo 倒序执行、execute 正序执行。空 batch 不入栈。
//   * maxStackSize 限制栈大小,超出丢弃最旧条目 (FIFO)。
//   * isExecuting 标记在命令回调执行期间为 true,防止重入导致重复入栈。

/** 撤销命令。execute/undo 必须可逆且幂等 (多次调用结果一致)。 */
export interface UndoCommand {
  /** 命令唯一 id。 */
  id: string | number;
  /** 描述 (用于 UI 显示历史列表)。 */
  description: string;
  /** 执行/重做:把状态推进到此命令执行之后。 */
  execute(): void;
  /** 撤销:把状态恢复到此命令执行之前。 */
  undo(): void;
  /** 可选附加数据 (调用方自由使用,系统不解释)。 */
  data?: any;
}

/** 系统统计快照。 */
export interface UndoRedoStats {
  /** 撤销栈大小。 */
  undoCount: number;
  /** 重做栈大小。 */
  redoCount: number;
  /** 最大栈大小。 */
  maxStackSize: number;
  /** 是否正在执行 execute/undo/redo (防重入)。 */
  isExecuting: boolean;
  /** 是否处于批量操作中。 */
  isBatching: boolean;
}

/**
 * 批量命令:把多个 UndoCommand 合并为一个原子命令。
 * execute 正序执行子命令,undo 倒序执行 (后做的先撤回,保证恢复语义正确)。
 */
class BatchCommand implements UndoCommand {
  id: string | number;
  description: string;
  data?: any;
  private readonly commands: UndoCommand[];

  constructor(description: string, commands: UndoCommand[]) {
    this.description = description;
    this.commands = commands;
    // 用子命令数量 + 首个子命令 id 作为 batch id
    this.id = `batch:${commands.length}:${commands[0]?.id ?? 'empty'}`;
  }

  execute(): void {
    for (let i = 0; i < this.commands.length; i++) {
      this.commands[i].execute();
    }
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}

/**
 * 编辑器撤销/重做系统。
 *
 * 用法:
 *   const sys = new UndoRedoSystem();
 *   sys.execute({ id: 1, description: 'Move', execute: () => {...}, undo: () => {...} });
 *   sys.undo();
 *   sys.redo();
 *   sys.beginBatch('Transform');
 *   sys.execute(cmdA);
 *   sys.execute(cmdB);
 *   sys.endBatch(); // 合并为单个原子命令
 */
export class UndoRedoSystem {
  /** 可撤销栈 (栈顶为最近命令)。 */
  readonly undoStack: UndoCommand[] = [];
  /** 可重做栈 (栈顶为最近被 undo 的命令)。 */
  readonly redoStack: UndoCommand[] = [];
  /** 最大栈大小。超出丢弃最旧。 */
  maxStackSize: number;
  /** 是否正在执行 execute/undo/redo 回调 (重入保护)。 */
  isExecuting: boolean = false;

  private batching: boolean = false;
  private batchDescription: string = '';
  private batchBuffer: UndoCommand[] = [];

  constructor(maxStackSize: number = 100) {
    this.maxStackSize = maxStackSize > 0 ? maxStackSize : 100;
  }

  /**
   * 执行命令:调用 command.execute(),压入 undoStack,清空 redoStack。
   * batch 模式下累积到 buffer,不直接入栈。
   * 重入 (回调内再次 execute) 时只执行副作用不入栈。
   */
  execute(command: UndoCommand): void {
    if (this.isExecuting) {
      // 重入:仅执行副作用,不入栈 (避免 undo/redo 回调内触发的 execute 污染历史)
      command.execute();
      return;
    }
    this.isExecuting = true;
    try {
      command.execute();
    } finally {
      this.isExecuting = false;
    }
    if (this.batching) {
      this.batchBuffer.push(command);
      return;
    }
    this.pushUndo(command);
  }

  /** 撤销栈顶命令。无操作或重入时返回 false。 */
  undo(): boolean {
    if (this.undoStack.length === 0 || this.isExecuting) return false;
    const command = this.undoStack.pop()!;
    this.isExecuting = true;
    try {
      command.undo();
    } finally {
      this.isExecuting = false;
    }
    this.redoStack.push(command);
    return true;
  }

  /** 重做栈顶命令。无操作或重入时返回 false。 */
  redo(): boolean {
    if (this.redoStack.length === 0 || this.isExecuting) return false;
    const command = this.redoStack.pop()!;
    this.isExecuting = true;
    try {
      command.execute();
    } finally {
      this.isExecuting = false;
    }
    this.undoStack.push(command);
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

  /** 获取撤销栈大小。 */
  getUndoCount(): number {
    return this.undoStack.length;
  }

  /** 获取重做栈大小。 */
  getRedoCount(): number {
    return this.redoStack.length;
  }

  /** 获取撤销栈描述列表 (栈底→栈顶)。 */
  getUndoDescriptions(): string[] {
    return this.undoStack.map((c) => c.description);
  }

  /** 获取重做栈描述列表 (栈底→栈顶)。 */
  getRedoDescriptions(): string[] {
    return this.redoStack.map((c) => c.description);
  }

  /** 清空 undo/redo 栈及 batch buffer。 */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.batchBuffer.length = 0;
    this.batching = false;
    this.batchDescription = '';
  }

  /** 只清空 redo 栈。 */
  clearRedo(): void {
    this.redoStack.length = 0;
  }

  /** 设置最大栈大小,并立即裁剪 undoStack 超出部分。<=0 回退到 100。 */
  setMaxStackSize(max: number): void {
    this.maxStackSize = max > 0 ? max : 100;
    while (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
  }

  /**
   * 开始批量操作:后续 execute() 累积到 buffer,直到 endBatch() 合并。
   * 嵌套 beginBatch 会先自动关闭当前 batch (避免丢失)。
   */
  beginBatch(description: string): void {
    if (this.batching) this.endBatch();
    this.batching = true;
    this.batchDescription = description;
    this.batchBuffer = [];
  }

  /**
   * 结束批量操作,把累积命令合并为一个 BatchCommand 压入 undoStack。
   * 空 batch 不入栈,返回 null。未处于 batch 模式时返回 null。
   */
  endBatch(): UndoCommand | null {
    if (!this.batching) return null;
    const commands = this.batchBuffer;
    const description = this.batchDescription;
    this.batching = false;
    this.batchBuffer = [];
    this.batchDescription = '';
    if (commands.length === 0) return null;
    const entry = new BatchCommand(description, commands);
    this.pushUndo(entry);
    return entry;
  }

  /** 是否处于批量操作中。 */
  isBatching(): boolean {
    return this.batching;
  }

  /** 获取系统统计快照。 */
  getStats(): UndoRedoStats {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      maxStackSize: this.maxStackSize,
      isExecuting: this.isExecuting,
      isBatching: this.batching,
    };
  }

  /** 内部:压入 undoStack 并裁剪到 maxStackSize,同时清空 redoStack。 */
  private pushUndo(command: UndoCommand): void {
    this.undoStack.push(command);
    while (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
    // 新操作入栈后,redo 分支失效
    this.redoStack.length = 0;
  }
}

// UndoRedoSystem 单元测试。
// 覆盖:execute/undo/redo/canUndo/canRedo/getUndoCount/getRedoCount/
//       getUndoDescriptions/getRedoDescriptions/clear/clearRedo/
//       setMaxStackSize/maxStackSize 裁剪/beginBatch/endBatch 合并/
//       batch 嵌套/redo 栈清空/isBatching/getStats/isExecuting。

import { describe, it, expect } from 'vitest';
import { UndoRedoSystem, type UndoCommand } from './UndoRedoSystem';

/** 构造一个可观察的命令:execute/undo 时记录日志到 log 数组。 */
function makeCommand(id: number, description: string, log: string[]): UndoCommand {
  return {
    id,
    description,
    execute(): void {
      log.push(`${description}:execute`);
    },
    undo(): void {
      log.push(`${description}:undo`);
    },
  };
}

describe('UndoRedoSystem', () => {
  it('constructs with empty stacks', () => {
    const u = new UndoRedoSystem();
    expect(u.undoStack).toHaveLength(0);
    expect(u.redoStack).toHaveLength(0);
    expect(u.canUndo()).toBe(false);
    expect(u.canRedo()).toBe(false);
    expect(u.getUndoCount()).toBe(0);
    expect(u.getRedoCount()).toBe(0);
    expect(u.maxStackSize).toBe(100);
    expect(u.isExecuting).toBe(false);
  });

  it('execute calls command.execute and pushes to undo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeCommand(1, 'A', log));
    expect(log).toEqual(['A:execute']);
    expect(u.canUndo()).toBe(true);
    expect(u.canRedo()).toBe(false);
    expect(u.getUndoCount()).toBe(1);
    expect(u.undoStack[0].description).toBe('A');
  });

  it('undo pops undo stack and pushes to redo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeCommand(1, 'A', log));
    const ok = u.undo();
    expect(ok).toBe(true);
    expect(log).toEqual(['A:execute', 'A:undo']);
    expect(u.canUndo()).toBe(false);
    expect(u.canRedo()).toBe(true);
    expect(u.getRedoCount()).toBe(1);
  });

  it('undo on empty stack returns false', () => {
    const u = new UndoRedoSystem();
    expect(u.undo()).toBe(false);
  });

  it('redo pops redo stack and pushes back to undo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeCommand(1, 'A', log));
    u.undo();
    log.length = 0;
    const ok = u.redo();
    expect(ok).toBe(true);
    expect(log).toEqual(['A:execute']);
    expect(u.canUndo()).toBe(true);
    expect(u.canRedo()).toBe(false);
    expect(u.getUndoCount()).toBe(1);
  });

  it('redo on empty stack returns false', () => {
    const u = new UndoRedoSystem();
    expect(u.redo()).toBe(false);
  });

  it('execute after undo clears redo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeCommand(1, 'A', log));
    u.execute(makeCommand(2, 'B', log));
    u.undo(); // undo B
    expect(u.canRedo()).toBe(true);
    u.execute(makeCommand(3, 'C', log));
    expect(u.canRedo()).toBe(false);
    expect(u.redoStack).toHaveLength(0);
  });

  it('getUndoDescriptions / getRedoDescriptions', () => {
    const u = new UndoRedoSystem();
    u.execute(makeCommand(1, 'A', []));
    u.execute(makeCommand(2, 'B', []));
    u.execute(makeCommand(3, 'C', []));
    expect(u.getUndoDescriptions()).toEqual(['A', 'B', 'C']);
    u.undo(); // C → redo
    u.undo(); // B → redo
    expect(u.getUndoDescriptions()).toEqual(['A']);
    // redo 栈栈底→栈顶: C(先 undo 的在栈底), B(后 undo 的在栈顶)
    expect(u.getRedoDescriptions()).toEqual(['C', 'B']);
  });

  it('clear empties both stacks and batch buffer', () => {
    const u = new UndoRedoSystem();
    u.execute(makeCommand(1, 'A', []));
    u.execute(makeCommand(2, 'B', []));
    u.undo();
    u.beginBatch('g');
    u.execute(makeCommand(3, 'C', []));
    u.clear();
    expect(u.undoStack).toHaveLength(0);
    expect(u.redoStack).toHaveLength(0);
    expect(u.isBatching()).toBe(false);
    expect(u.canUndo()).toBe(false);
    expect(u.canRedo()).toBe(false);
  });

  it('clearRedo only empties redo stack', () => {
    const u = new UndoRedoSystem();
    u.execute(makeCommand(1, 'A', []));
    u.execute(makeCommand(2, 'B', []));
    u.undo(); // B → redo
    expect(u.getRedoCount()).toBe(1);
    u.clearRedo();
    expect(u.getRedoCount()).toBe(0);
    expect(u.getUndoCount()).toBe(1);
  });

  it('maxStackSize trims oldest entries', () => {
    const u = new UndoRedoSystem(3);
    u.execute(makeCommand(1, 'A', []));
    u.execute(makeCommand(2, 'B', []));
    u.execute(makeCommand(3, 'C', []));
    u.execute(makeCommand(4, 'D', []));
    expect(u.undoStack).toHaveLength(3);
    // A 被丢弃,B/C/D 保留
    expect(u.undoStack[0].description).toBe('B');
    expect(u.undoStack[2].description).toBe('D');
  });

  it('maxStackSize <= 0 falls back to default 100', () => {
    const u = new UndoRedoSystem(0);
    expect(u.maxStackSize).toBe(100);
    const u2 = new UndoRedoSystem(-5);
    expect(u2.maxStackSize).toBe(100);
  });

  it('setMaxStackSize updates and trims existing stack', () => {
    const u = new UndoRedoSystem();
    u.execute(makeCommand(1, 'A', []));
    u.execute(makeCommand(2, 'B', []));
    u.execute(makeCommand(3, 'C', []));
    u.setMaxStackSize(2);
    expect(u.maxStackSize).toBe(2);
    expect(u.undoStack).toHaveLength(2);
    expect(u.undoStack[0].description).toBe('B');
    expect(u.undoStack[1].description).toBe('C');
  });

  it('setMaxStackSize <= 0 falls back to 100', () => {
    const u = new UndoRedoSystem();
    u.setMaxStackSize(0);
    expect(u.maxStackSize).toBe(100);
  });

  it('beginBatch/endBatch merges multiple commands into one entry', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginBatch('group1');
    expect(u.isBatching()).toBe(true);
    u.execute(makeCommand(1, 'A', log));
    u.execute(makeCommand(2, 'B', log));
    const entry = u.endBatch();
    expect(u.isBatching()).toBe(false);
    expect(entry).not.toBeNull();
    // 合并为 1 个 entry
    expect(u.undoStack).toHaveLength(1);
    expect(u.undoStack[0].description).toBe('group1');
    expect(log).toEqual(['A:execute', 'B:execute']);
  });

  it('batch undo runs commands in reverse order', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginBatch('group1');
    u.execute(makeCommand(1, 'A', log));
    u.execute(makeCommand(2, 'B', log));
    u.execute(makeCommand(3, 'C', log));
    u.endBatch();
    log.length = 0;
    u.undo();
    // undo 倒序:C → B → A
    expect(log).toEqual(['C:undo', 'B:undo', 'A:undo']);
  });

  it('batch redo (execute) runs commands in forward order', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginBatch('group1');
    u.execute(makeCommand(1, 'A', log));
    u.execute(makeCommand(2, 'B', log));
    u.endBatch();
    u.undo();
    log.length = 0;
    u.redo();
    // execute 正序:A → B
    expect(log).toEqual(['A:execute', 'B:execute']);
  });

  it('empty batch does not push entry', () => {
    const u = new UndoRedoSystem();
    u.beginBatch('empty');
    const entry = u.endBatch();
    expect(entry).toBeNull();
    expect(u.undoStack).toHaveLength(0);
  });

  it('endBatch without beginBatch is a no-op returning null', () => {
    const u = new UndoRedoSystem();
    expect(u.endBatch()).toBeNull();
    expect(u.undoStack).toHaveLength(0);
  });

  it('nested beginBatch auto-closes previous group', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginBatch('g1');
    u.execute(makeCommand(1, 'A', log));
    // 未 endBatch 直接开新 group:g1 应被自动合并入栈
    u.beginBatch('g2');
    u.execute(makeCommand(2, 'B', log));
    u.endBatch();
    expect(u.undoStack).toHaveLength(2);
    expect(u.undoStack[0].description).toBe('g1');
    expect(u.undoStack[1].description).toBe('g2');
  });

  it('batch commands do not leak to redo stack independently', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginBatch('g');
    u.execute(makeCommand(1, 'A', log));
    u.execute(makeCommand(2, 'B', log));
    u.endBatch();
    u.undo();
    // 整组 undo 后,redo 栈应是单个 batch entry
    expect(u.redoStack).toHaveLength(1);
    expect(u.canRedo()).toBe(true);
    u.redo();
    expect(log).toEqual(['A:execute', 'B:execute', 'B:undo', 'A:undo', 'A:execute', 'B:execute']);
  });

  it('execute within command callback does not re-push (re-entrancy guard)', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    // command B's execute triggers another execute of C; C should run but NOT be pushed
    const cmdC = makeCommand(3, 'C', log);
    const cmdB: UndoCommand = {
      id: 2,
      description: 'B',
      execute(): void {
        log.push('B:execute');
        u.execute(cmdC); // re-entrant
      },
      undo(): void {
        log.push('B:undo');
      },
    };
    u.execute(makeCommand(1, 'A', log));
    u.execute(cmdB);
    // C's execute ran (re-entrant), but C is NOT on the undo stack
    expect(log).toEqual(['A:execute', 'B:execute', 'C:execute']);
    expect(u.getUndoCount()).toBe(2); // only A and B
    expect(u.undoStack.map((c) => c.description)).toEqual(['A', 'B']);
  });

  it('isExecuting is true during callback and false after', () => {
    const u = new UndoRedoSystem();
    let observed: boolean = false;
    const cmd: UndoCommand = {
      id: 1,
      description: 'A',
      execute(): void {
        observed = u.isExecuting;
      },
      undo(): void {},
    };
    u.execute(cmd);
    expect(observed).toBe(true);
    expect(u.isExecuting).toBe(false);
  });

  it('undo/redo are no-ops while executing (re-entrancy guard)', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeCommand(1, 'A', log));
    // During undo callback, trigger undo again — should be guarded
    let reentryResult = true;
    const cmd: UndoCommand = {
      id: 2,
      description: 'B',
      execute(): void {
        log.push('B:execute');
      },
      undo(): void {
        log.push('B:undo');
        reentryResult = u.undo(); // should return false (re-entrant)
      },
    };
    u.execute(cmd);
    log.length = 0;
    u.undo(); // undo B (which tries to undo A again — guarded)
    expect(reentryResult).toBe(false);
    expect(log).toEqual(['B:undo']);
    expect(u.getUndoCount()).toBe(1); // A still on undo stack
  });

  it('getStats returns current snapshot', () => {
    const u = new UndoRedoSystem(50);
    u.execute(makeCommand(1, 'A', []));
    u.execute(makeCommand(2, 'B', []));
    u.undo();
    const stats = u.getStats();
    expect(stats.undoCount).toBe(1);
    expect(stats.redoCount).toBe(1);
    expect(stats.maxStackSize).toBe(50);
    expect(stats.isExecuting).toBe(false);
    expect(stats.isBatching).toBe(false);
  });

  it('data field is preserved on commands', () => {
    const u = new UndoRedoSystem();
    const cmd: UndoCommand = {
      id: 1,
      description: 'A',
      execute(): void {},
      undo(): void {},
      data: { foo: 42 },
    };
    u.execute(cmd);
    expect(u.undoStack[0].data).toEqual({ foo: 42 });
  });
});

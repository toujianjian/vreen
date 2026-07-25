// UndoRedoSystem 单元测试。
// 覆盖:execute/undo/redo/canUndo/canRedo/clear/getHistory/
//       maxHistory 裁剪/group 合并/group 嵌套/redo 栈清空。

import { describe, it, expect } from 'vitest';
import { UndoRedoSystem, type HistoryAction } from './UndoRedoSystem';

/** 构造一个可观察的 action:undo/redo 时记录日志到 log 数组。 */
function makeAction(name: string, log: string[]): HistoryAction {
  return {
    name,
    undo(): void {
      log.push(`${name}:undo`);
    },
    redo(): void {
      log.push(`${name}:redo`);
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
  });

  it('execute calls redo and pushes to undo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeAction('A', log));
    expect(log).toEqual(['A:redo']);
    expect(u.canUndo()).toBe(true);
    expect(u.canRedo()).toBe(false);
    expect(u.undoStack).toHaveLength(1);
  });

  it('undo pops undo stack and pushes to redo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeAction('A', log));
    const ok = u.undo();
    expect(ok).toBe(true);
    expect(log).toEqual(['A:redo', 'A:undo']);
    expect(u.canUndo()).toBe(false);
    expect(u.canRedo()).toBe(true);
  });

  it('undo on empty stack returns false', () => {
    const u = new UndoRedoSystem();
    expect(u.undo()).toBe(false);
  });

  it('redo pops redo stack and pushes back to undo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeAction('A', log));
    u.undo();
    log.length = 0;
    const ok = u.redo();
    expect(ok).toBe(true);
    expect(log).toEqual(['A:redo']);
    expect(u.canUndo()).toBe(true);
    expect(u.canRedo()).toBe(false);
  });

  it('redo on empty stack returns false', () => {
    const u = new UndoRedoSystem();
    expect(u.redo()).toBe(false);
  });

  it('execute after undo clears redo stack', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.execute(makeAction('A', log));
    u.execute(makeAction('B', log));
    u.undo(); // undo B
    expect(u.canRedo()).toBe(true);
    u.execute(makeAction('C', log));
    expect(u.canRedo()).toBe(false);
    expect(u.redoStack).toHaveLength(0);
  });

  it('clear empties both stacks', () => {
    const u = new UndoRedoSystem();
    u.execute(makeAction('A', []));
    u.execute(makeAction('B', []));
    u.undo();
    u.clear();
    expect(u.undoStack).toHaveLength(0);
    expect(u.redoStack).toHaveLength(0);
    expect(u.canUndo()).toBe(false);
    expect(u.canRedo()).toBe(false);
  });

  it('getHistory returns undo entries then redo entries reversed', () => {
    const u = new UndoRedoSystem();
    u.execute(makeAction('A', []));
    u.execute(makeAction('B', []));
    u.execute(makeAction('C', []));
    u.undo(); // C → redo
    u.undo(); // B → redo
    // undo 栈剩 [A],redo 栈 [C, B](B 是栈顶)
    const history = u.getHistory();
    expect(history.map((h) => h.name)).toEqual(['A', 'B', 'C']);
    expect(history[0].canUndo).toBe(true);
    expect(history[1].canUndo).toBe(false);
    expect(history[2].canUndo).toBe(false);
  });

  it('maxHistory trims oldest entries', () => {
    const u = new UndoRedoSystem(3);
    u.execute(makeAction('A', []));
    u.execute(makeAction('B', []));
    u.execute(makeAction('C', []));
    u.execute(makeAction('D', []));
    expect(u.undoStack).toHaveLength(3);
    // A 被丢弃,B/C/D 保留
    expect(u.undoStack[0].name).toBe('B');
    expect(u.undoStack[2].name).toBe('D');
  });

  it('maxHistory <= 0 falls back to default 100', () => {
    const u = new UndoRedoSystem(0);
    expect(u.maxHistory).toBe(100);
    const u2 = new UndoRedoSystem(-5);
    expect(u2.maxHistory).toBe(100);
  });

  it('beginGroup/endGroup merges multiple actions into one entry', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginGroup('group1');
    u.execute(makeAction('A', log));
    u.execute(makeAction('B', log));
    u.endGroup();
    // 合并为 1 个 entry
    expect(u.undoStack).toHaveLength(1);
    expect(u.undoStack[0].name).toBe('group1');
    expect(log).toEqual(['A:redo', 'B:redo']);
  });

  it('group undo runs actions in reverse order', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginGroup('group1');
    u.execute(makeAction('A', log));
    u.execute(makeAction('B', log));
    u.execute(makeAction('C', log));
    u.endGroup();
    log.length = 0;
    u.undo();
    // undo 倒序:C → B → A
    expect(log).toEqual(['C:undo', 'B:undo', 'A:undo']);
  });

  it('group redo runs actions in forward order', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginGroup('group1');
    u.execute(makeAction('A', log));
    u.execute(makeAction('B', log));
    u.endGroup();
    u.undo();
    log.length = 0;
    u.redo();
    // redo 正序:A → B
    expect(log).toEqual(['A:redo', 'B:redo']);
  });

  it('empty group does not push entry', () => {
    const u = new UndoRedoSystem();
    u.beginGroup('empty');
    u.endGroup();
    expect(u.undoStack).toHaveLength(0);
  });

  it('single-action group still records with group name', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginGroup('solo');
    u.execute(makeAction('A', log));
    u.endGroup();
    expect(u.undoStack).toHaveLength(1);
    expect(u.undoStack[0].name).toBe('solo');
    expect(log).toEqual(['A:redo']);
  });

  it('nested beginGroup auto-closes previous group', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginGroup('g1');
    u.execute(makeAction('A', log));
    // 未 endGroup 直接开新 group:g1 应被自动合并入栈
    u.beginGroup('g2');
    u.execute(makeAction('B', log));
    u.endGroup();
    expect(u.undoStack).toHaveLength(2);
    expect(u.undoStack[0].name).toBe('g1');
    expect(u.undoStack[1].name).toBe('g2');
  });

  it('endGroup without beginGroup is a no-op', () => {
    const u = new UndoRedoSystem();
    u.endGroup();
    expect(u.undoStack).toHaveLength(0);
  });

  it('group actions do not leak to redo stack independently', () => {
    const u = new UndoRedoSystem();
    const log: string[] = [];
    u.beginGroup('g');
    u.execute(makeAction('A', log));
    u.execute(makeAction('B', log));
    u.endGroup();
    u.undo();
    // 整组 undo 后,redo 栈应是单个 group entry,不是两个独立 entry
    expect(u.redoStack).toHaveLength(1);
    expect(u.canRedo()).toBe(true);
    u.redo();
    expect(log).toEqual(['A:redo', 'B:redo', 'B:undo', 'A:undo', 'A:redo', 'B:redo']);
  });
});

// MemoryTracker 单元测试:track / untrack、摘要、泄漏检测、reset。

import { describe, it, expect } from 'vitest';
import { MemoryTracker } from './MemoryTracker';

describe('MemoryTracker', () => {
  describe('track', () => {
    it('返回单调递增 id', () => {
      const mt = new MemoryTracker();
      const id1 = mt.track('BufferGeometry', 1024);
      const id2 = mt.track('Texture', 2048);
      expect(id2).toBeGreaterThan(id1);
    });

    it('累计 totalAllocated', () => {
      const mt = new MemoryTracker();
      mt.track('A', 100);
      mt.track('B', 200);
      mt.track('C', 300);
      expect(mt.totalAllocated).toBe(600);
      expect(mt.totalFreed).toBe(0);
    });

    it('记录 type / size / time', () => {
      const mt = new MemoryTracker();
      const id = mt.track('Texture', 4096, 'stack-trace');
      const rec = mt.allocations.find((r) => r.id === id);
      expect(rec).toBeDefined();
      expect(rec!.type).toBe('Texture');
      expect(rec!.size).toBe(4096);
      expect(rec!.time).toBeGreaterThan(0);
      expect(rec!.stack).toBe('stack-trace');
    });
  });

  describe('untrack', () => {
    it('释放后更新 totalFreed 与活跃列表', () => {
      const mt = new MemoryTracker();
      const id = mt.track('Texture', 1024);
      const ok = mt.untrack(id);
      expect(ok).toBe(true);
      expect(mt.totalFreed).toBe(1024);
      expect(mt.allocations.length).toBe(0);
    });

    it('未找到 id 返回 false', () => {
      const mt = new MemoryTracker();
      expect(mt.untrack(99999)).toBe(false);
    });

    it('多次 track + 部分释放后索引一致', () => {
      const mt = new MemoryTracker();
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(mt.track('Buf', (i + 1) * 100));
      }
      // 释放中间一个
      mt.untrack(ids[2]);
      // 再释放第一个
      mt.untrack(ids[0]);
      // 剩余 3 个,总分配 1500,总释放 300+100=400,活跃 1100
      expect(mt.allocations.length).toBe(3);
      expect(mt.totalAllocated).toBe(1500);
      expect(mt.totalFreed).toBe(400);
      // 活跃 id 应该是 ids[1], ids[3], ids[4]
      const activeIds = mt.allocations.map((r) => r.id).sort();
      expect(activeIds).toEqual([ids[1], ids[3], ids[4]]);
    });
  });

  describe('getSummary', () => {
    it('空状态全 0', () => {
      const mt = new MemoryTracker();
      const s = mt.getSummary();
      expect(s.activeCount).toBe(0);
      expect(s.totalAllocated).toBe(0);
      expect(s.totalFreed).toBe(0);
      expect(s.activeBytes).toBe(0);
      expect(s.activeMB).toBe(0);
      expect(Object.keys(s.byType).length).toBe(0);
    });

    it('按类型分组', () => {
      const mt = new MemoryTracker();
      mt.track('Texture', 1024);
      mt.track('Texture', 2048);
      mt.track('Buffer', 512);
      const s = mt.getSummary();
      expect(s.activeCount).toBe(3);
      expect(s.activeBytes).toBe(3584);
      expect(s.byType['Texture'].count).toBe(2);
      expect(s.byType['Texture'].bytes).toBe(3072);
      expect(s.byType['Buffer'].count).toBe(1);
      expect(s.byType['Buffer'].bytes).toBe(512);
    });

    it('activeMB = activeBytes / 1024 / 1024', () => {
      const mt = new MemoryTracker();
      mt.track('A', 1024 * 1024);
      const s = mt.getSummary();
      expect(s.activeMB).toBeCloseTo(1, 6);
    });

    it('释放后摘要正确', () => {
      const mt = new MemoryTracker();
      const id = mt.track('Texture', 1024);
      mt.untrack(id);
      const s = mt.getSummary();
      expect(s.activeCount).toBe(0);
      expect(s.activeBytes).toBe(0);
      expect(s.totalAllocated).toBe(1024);
      expect(s.totalFreed).toBe(1024);
      expect(s.byType['Texture']).toBeUndefined();
    });
  });

  describe('getLeaks', () => {
    it('未释放的全部视为泄漏', () => {
      const mt = new MemoryTracker();
      mt.track('A', 100);
      mt.track('B', 200);
      const idC = mt.track('C', 300);
      mt.untrack(idC);
      const leaks = mt.getLeaks();
      expect(leaks.length).toBe(2);
      expect(leaks.map((r) => r.type).sort()).toEqual(['A', 'B']);
    });

    it('minAgeMs 过滤近期分配', async () => {
      const mt = new MemoryTracker();
      mt.track('old', 100);
      // 等 ~20ms 制造一个"老"的分配
      await new Promise((r) => setTimeout(r, 20));
      mt.track('new', 200);
      const leaks = mt.getLeaks(10);
      expect(leaks.length).toBe(1);
      expect(leaks[0].type).toBe('old');
    });

    it('minAgeMs=0 返回全部活跃', () => {
      const mt = new MemoryTracker();
      mt.track('A', 100);
      mt.track('B', 200);
      expect(mt.getLeaks(0).length).toBe(2);
    });
  });

  describe('reset', () => {
    it('清空所有状态', () => {
      const mt = new MemoryTracker();
      mt.track('A', 100);
      mt.track('B', 200);
      mt.untrack(1);
      mt.reset();
      expect(mt.allocations.length).toBe(0);
      expect(mt.totalAllocated).toBe(0);
      expect(mt.totalFreed).toBe(0);
      const s = mt.getSummary();
      expect(s.activeCount).toBe(0);
    });

    it('reset 后 id 重新从 1 开始', () => {
      const mt = new MemoryTracker();
      mt.track('A', 100);
      mt.reset();
      const id = mt.track('B', 200);
      expect(id).toBe(1);
    });
  });
});

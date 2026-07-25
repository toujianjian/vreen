// SystemProfiler 单元测试:begin/end、累计 / 平均 / 最大耗时、
// getSlowestSystems、reset。

import { describe, it, expect } from 'vitest';
import { SystemProfiler } from './SystemProfiler';

describe('SystemProfiler', () => {
  describe('begin / end', () => {
    it('end 后生成 timing 记录', () => {
      const sp = new SystemProfiler();
      sp.begin('MovementSystem');
      sp.end('MovementSystem');
      const t = sp.getTiming('MovementSystem');
      expect(t).toBeDefined();
      expect(t!.name).toBe('MovementSystem');
      expect(t!.callCount).toBe(1);
      expect(t!.totalTime).toBeGreaterThanOrEqual(0);
      expect(t!.lastTime).toBeGreaterThanOrEqual(0);
      expect(t!.maxTime).toBeGreaterThanOrEqual(0);
      expect(t!.avgTime).toBeCloseTo(t!.totalTime / t!.callCount, 6);
    });

    it('多次调用累加 totalTime / callCount', () => {
      const sp = new SystemProfiler();
      sp.begin('A'); sp.end('A');
      sp.begin('A'); sp.end('A');
      sp.begin('A'); sp.end('A');
      const t = sp.getTiming('A')!;
      expect(t.callCount).toBe(3);
      expect(t.avgTime).toBeCloseTo(t.totalTime / 3, 6);
    });

    it('未匹配的 end 被忽略(不抛错)', () => {
      const sp = new SystemProfiler();
      expect(() => sp.end('Unknown')).not.toThrow();
      expect(sp.getTiming('Unknown')).toBeUndefined();
    });

    it('嵌套 begin/end 容错乱序', () => {
      const sp = new SystemProfiler();
      sp.begin('A');
      sp.begin('B');
      sp.end('A'); // 在 B 仍开时关 A
      sp.end('B');
      expect(sp.getTiming('A')!.callCount).toBe(1);
      expect(sp.getTiming('B')!.callCount).toBe(1);
    });
  });

  describe('maxTime 跟踪', () => {
    it('记录单次最大耗时', () => {
      const sp = new SystemProfiler();
      sp.begin('A'); sp.end('A');
      const firstMax = sp.getTiming('A')!.maxTime;
      // 制造一个明显更长的区间
      sp.begin('A');
      const start = performance.now();
      while (performance.now() - start < 2) { /* spin ~2ms */ }
      sp.end('A');
      const t = sp.getTiming('A')!;
      expect(t.maxTime).toBeGreaterThanOrEqual(firstMax);
      expect(t.callCount).toBe(2);
    });
  });

  describe('getAllTimings', () => {
    it('按 totalTime 降序', () => {
      const sp = new SystemProfiler();
      // A:短
      sp.begin('A'); sp.end('A');
      // B:长
      sp.begin('B');
      const start = performance.now();
      while (performance.now() - start < 1) { /* spin ~1ms */ }
      sp.end('B');
      const all = sp.getAllTimings();
      expect(all.length).toBe(2);
      // B 应该排在前面(总耗时更大)
      expect(all[0].name).toBe('B');
      expect(all[1].name).toBe('A');
    });
  });

  describe('getSlowestSystems', () => {
    it('按 avgTime 降序返回 top N', () => {
      const sp = new SystemProfiler();
      sp.begin('fast'); sp.end('fast');
      sp.begin('slow');
      const start = performance.now();
      while (performance.now() - start < 1) { /* spin ~1ms */ }
      sp.end('slow');
      const slow = sp.getSlowestSystems(1);
      expect(slow.length).toBe(1);
      expect(slow[0].name).toBe('slow');
    });

    it('count <= 0 返回空数组', () => {
      const sp = new SystemProfiler();
      sp.begin('A'); sp.end('A');
      expect(sp.getSlowestSystems(0)).toEqual([]);
      expect(sp.getSlowestSystems(-1)).toEqual([]);
    });

    it('count > 系统数时返回全部', () => {
      const sp = new SystemProfiler();
      sp.begin('A'); sp.end('A');
      sp.begin('B'); sp.end('B');
      const slow = sp.getSlowestSystems(100);
      expect(slow.length).toBe(2);
    });
  });

  describe('reset', () => {
    it('清空 timings', () => {
      const sp = new SystemProfiler();
      sp.begin('A'); sp.end('A');
      expect(sp.timings.size).toBe(1);
      sp.reset();
      expect(sp.timings.size).toBe(0);
      expect(sp.getTiming('A')).toBeUndefined();
    });
  });
});

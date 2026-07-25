// FrameProfiler 单元测试:环形缓冲区、FPS 指标、getHistory、reset。

import { describe, it, expect } from 'vitest';
import { FrameProfiler } from './FrameProfiler';

describe('FrameProfiler', () => {
  describe('基础结构', () => {
    it('默认 maxSamples=120', () => {
      const fp = new FrameProfiler();
      expect(fp.maxSamples).toBe(120);
      expect(fp.sampleCount).toBe(0);
      expect(fp.samples.length).toBe(0);
    });

    it('自定义 maxSamples', () => {
      const fp = new FrameProfiler({ maxSamples: 16 });
      expect(fp.maxSamples).toBe(16);
    });
  });

  describe('beginFrame / endFrame', () => {
    it('endFrame 推进 frame 序号与 sampleCount', () => {
      const fp = new FrameProfiler({ maxSamples: 8 });
      fp.beginFrame();
      const s0 = fp.endFrame();
      expect(s0.frame).toBe(0);
      expect(fp.sampleCount).toBe(1);

      fp.beginFrame();
      const s1 = fp.endFrame();
      expect(s1.frame).toBe(1);
      expect(fp.sampleCount).toBe(2);
    });

    it('endFrame 记录 stats 字段(缺省 0)', () => {
      const fp = new FrameProfiler({ maxSamples: 8 });
      fp.beginFrame();
      const s = fp.endFrame();
      expect(s.drawCalls).toBe(0);
      expect(s.triangles).toBe(0);
      expect(s.vertices).toBe(0);
      expect(s.memoryMB).toBe(0);

      fp.beginFrame();
      const s2 = fp.endFrame({
        drawCalls: 42,
        triangles: 1000,
        vertices: 500,
        memoryMB: 16.5,
      });
      expect(s2.drawCalls).toBe(42);
      expect(s2.triangles).toBe(1000);
      expect(s2.vertices).toBe(500);
      expect(s2.memoryMB).toBe(16.5);
    });

    it('首帧 dt 默认 16.67ms,后续帧使用 wall clock 差', () => {
      const fp = new FrameProfiler({ maxSamples: 8 });
      fp.beginFrame();
      const s0 = fp.endFrame();
      expect(s0.dt).toBeCloseTo(16.67, 2);

      fp.beginFrame();
      const s1 = fp.endFrame();
      expect(s1.dt).toBeGreaterThanOrEqual(0);
    });
  });

  describe('环形缓冲区', () => {
    it('超过 maxSamples 后保持容量恒定', () => {
      const fp = new FrameProfiler({ maxSamples: 4 });
      for (let i = 0; i < 10; i++) {
        fp.beginFrame();
        fp.endFrame({ drawCalls: i });
      }
      expect(fp.sampleCount).toBe(4);
      expect(fp.samples.length).toBe(4);
    });

    it('getHistory 返回最近 N 帧(老→新)', () => {
      const fp = new FrameProfiler({ maxSamples: 8 });
      for (let i = 0; i < 5; i++) {
        fp.beginFrame();
        fp.endFrame({ drawCalls: i });
      }
      const hist = fp.getHistory(3);
      expect(hist.length).toBe(3);
      expect(hist[0].drawCalls).toBe(2);
      expect(hist[1].drawCalls).toBe(3);
      expect(hist[2].drawCalls).toBe(4);
    });

    it('getHistory(count=0) 返回空数组', () => {
      const fp = new FrameProfiler({ maxSamples: 8 });
      fp.beginFrame();
      fp.endFrame();
      expect(fp.getHistory(0)).toEqual([]);
    });

    it('getHistory(count > sampleCount) 返回全部', () => {
      const fp = new FrameProfiler({ maxSamples: 8 });
      fp.beginFrame();
      fp.endFrame();
      fp.beginFrame();
      fp.endFrame();
      const hist = fp.getHistory(100);
      expect(hist.length).toBe(2);
    });

    it('环形跨越边界后顺序正确', () => {
      const fp = new FrameProfiler({ maxSamples: 3 });
      for (let i = 0; i < 5; i++) {
        fp.beginFrame();
        fp.endFrame({ drawCalls: i });
      }
      const hist = fp.getHistory(3);
      // 应该是 frame 2, 3, 4
      expect(hist.length).toBe(3);
      expect(hist[0].drawCalls).toBe(2);
      expect(hist[1].drawCalls).toBe(3);
      expect(hist[2].drawCalls).toBe(4);
    });
  });

  describe('getMetrics', () => {
    it('空状态返回全 0', () => {
      const fp = new FrameProfiler();
      const m = fp.getMetrics();
      expect(m.currentFPS).toBe(0);
      expect(m.avgFPS).toBe(0);
      expect(m.minFPS).toBe(0);
      expect(m.maxFPS).toBe(0);
      expect(m.sampleCount).toBe(0);
    });

    it('单帧后 currentFPS = 1000/dt', () => {
      const fp = new FrameProfiler();
      fp.beginFrame();
      fp.endFrame();
      const m = fp.getMetrics();
      expect(m.currentFPS).toBeGreaterThan(0);
      expect(m.sampleCount).toBe(1);
    });

    it('多帧后 avgFPS 在 min/max 之间', () => {
      const fp = new FrameProfiler();
      for (let i = 0; i < 10; i++) {
        fp.beginFrame();
        fp.endFrame();
      }
      const m = fp.getMetrics();
      expect(m.avgFPS).toBeGreaterThanOrEqual(m.minFPS);
      expect(m.avgFPS).toBeLessThanOrEqual(m.maxFPS);
      expect(m.sampleCount).toBe(10);
    });
  });

  describe('reset', () => {
    it('清空所有数据', () => {
      const fp = new FrameProfiler({ maxSamples: 8 });
      for (let i = 0; i < 5; i++) {
        fp.beginFrame();
        fp.endFrame();
      }
      expect(fp.sampleCount).toBe(5);
      fp.reset();
      expect(fp.sampleCount).toBe(0);
      expect(fp.samples.length).toBe(0);
      expect(fp.currentFPS).toBe(0);
      expect(fp.avgFPS).toBe(0);
    });
  });
});

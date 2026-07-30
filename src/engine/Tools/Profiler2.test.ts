// Profiler2 单元测试:帧/区域/事件/录制/历史/统计/Chrome Trace 导出。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Profiler2,
  type ProfileCategory,
  type ChromeTraceEvent,
} from './Profiler2';

describe('Profiler2', () => {
  let currentTime: number;
  let increment: number;

  beforeEach(() => {
    // 模拟 performance.now:返回 currentTime,每次调用后 += increment
    // 默认 increment=1(每调用递增 1ms),测试可调整 increment 控制时间步进
    currentTime = 1000;
    increment = 1;
    vi.stubGlobal('performance', {
      now: () => {
        const t = currentTime;
        currentTime += increment;
        return t;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('构造与初始状态', () => {
    it('默认配置', () => {
      const p = new Profiler2();
      expect(p.enabled).toBe(true);
      expect(p.maxHistorySize).toBe(120);
      expect(p.frameCount).toBe(0);
      expect(p.fps).toBe(0);
      expect(p.frameTime).toBe(0);
      expect(p.fpsHistory).toEqual([]);
      expect(p.frameTimeHistory).toEqual([]);
      expect(p.zones.size).toBe(0);
      expect(p.events).toEqual([]);
      expect(p.isRecording).toBe(false);
      expect(p.memoryUsage).toEqual({ used: 0, total: 0 });
    });

    it('自定义配置', () => {
      const p = new Profiler2({ maxHistorySize: 30, enabled: false });
      expect(p.maxHistorySize).toBe(30);
      expect(p.enabled).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('禁用后所有收集为空操作', () => {
      const p = new Profiler2({ enabled: false });
      p.beginFrame();
      p.beginZone('render');
      p.endZone('render');
      p.setDrawCalls(100);
      p.endFrame();
      expect(p.frameCount).toBe(0);
      expect(p.drawCalls).toBe(0);
      expect(p.zones.size).toBe(0);
    });

    it('重新启用后恢复收集', () => {
      const p = new Profiler2({ enabled: false });
      p.setEnabled(true);
      p.beginFrame();
      p.endFrame();
      expect(p.frameCount).toBe(1);
    });
  });

  describe('beginFrame / endFrame', () => {
    it('endFrame 推进 frameCount 与历史', () => {
      const p = new Profiler2();
      p.beginFrame();
      p.endFrame();
      expect(p.frameCount).toBe(1);
      expect(p.frameTimeHistory.length).toBe(1);
      expect(p.fpsHistory.length).toBe(1);
    });

    it('frameTime = endMs - startMs', () => {
      const p = new Profiler2();
      // beginFrame 调用 performance.now() 一次(t=1000)
      // endFrame 调用 performance.now() 一次(t=1001)
      p.beginFrame();
      p.endFrame();
      expect(p.frameTime).toBe(1);
    });

    it('多帧累加 avgFrameTime', () => {
      const p = new Profiler2();
      p.beginFrame(); p.endFrame(); // frameTime=1
      p.beginFrame(); p.endFrame(); // frameTime=1
      p.beginFrame(); p.endFrame(); // frameTime=1
      expect(p.frameCount).toBe(3);
      expect(p.avgFrameTime).toBeCloseTo(1, 6);
    });

    it('minFrameTime / maxFrameTime 跟踪', () => {
      const p = new Profiler2();
      // 帧1: beginFrame(1000), endFrame(1001) → frameTime=1
      p.beginFrame(); p.endFrame();
      // 帧2: 步进改为 3ms,beginFrame(1002), endFrame(1005) → frameTime=3
      increment = 3;
      p.beginFrame(); p.endFrame();
      expect(p.minFrameTime).toBe(1);
      expect(p.maxFrameTime).toBe(3);
    });

    it('历史曲线裁剪到 maxHistorySize', () => {
      const p = new Profiler2({ maxHistorySize: 3 });
      for (let i = 0; i < 5; i++) {
        p.beginFrame(); p.endFrame();
      }
      expect(p.frameTimeHistory.length).toBe(3);
      expect(p.fpsHistory.length).toBe(3);
    });

    it('fps 由 wallDelta 推算', () => {
      const p = new Profiler2();
      // 首帧:wallDelta = frameTime = 1ms → fps = 1000
      p.beginFrame(); p.endFrame();
      expect(p.fps).toBe(1000);
    });
  });

  describe('beginZone / endZone', () => {
    it('endZone 后生成 zone 统计', () => {
      const p = new Profiler2();
      // beginZone(t=1000), endZone(t=1001) → duration=1
      p.beginZone('render');
      p.endZone('render');
      const z = p.getZone('render');
      expect(z).toBeDefined();
      expect(z!.name).toBe('render');
      expect(z!.enterCount).toBe(1);
      expect(z!.totalTime).toBe(1);
      expect(z!.avgTime).toBe(1);
      expect(z!.minTime).toBe(1);
      expect(z!.maxTime).toBe(1);
    });

    it('多次同名 zone 累加', () => {
      const p = new Profiler2();
      p.beginZone('a'); p.endZone('a'); // duration=1
      p.beginZone('a'); p.endZone('a'); // duration=1
      const z = p.getZone('a')!;
      expect(z.enterCount).toBe(2);
      expect(z.totalTime).toBe(2);
      expect(z.avgTime).toBe(1);
    });

    it('未匹配的 endZone 被忽略', () => {
      const p = new Profiler2();
      expect(() => p.endZone('unknown')).not.toThrow();
      expect(p.getZone('unknown')).toBeUndefined();
    });

    it('嵌套 zone 容错乱序', () => {
      const p = new Profiler2();
      p.beginZone('outer');
      p.beginZone('inner');
      p.endZone('outer'); // 在 inner 仍开时关 outer
      p.endZone('inner');
      expect(p.getZone('outer')!.enterCount).toBe(1);
      expect(p.getZone('inner')!.enterCount).toBe(1);
    });

    it('zone 耗时累加到 cpuTime', () => {
      const p = new Profiler2();
      p.beginFrame();
      p.beginZone('render');
      p.endZone('render');
      p.endFrame();
      expect(p.cpuTime).toBeGreaterThanOrEqual(0);
    });

    it('endFrame 自动关闭未结束 zone', () => {
      const p = new Profiler2();
      p.beginFrame();
      p.beginZone('leaked');
      p.endFrame(); // 应自动关闭 leaked
      expect(p.getZone('leaked')).toBeDefined();
      expect(p.getZone('leaked')!.enterCount).toBe(1);
    });

    it('getZones 返回拷贝 Map', () => {
      const p = new Profiler2();
      p.beginZone('a'); p.endZone('a');
      const m = p.getZones();
      expect(m.size).toBe(1);
      expect(m).not.toBe(p.zones); // 不同引用
      m.set('b', { name: 'b', enterCount: 0, totalTime: 0, minTime: 0, maxTime: 0, avgTime: 0 });
      expect(p.zones.size).toBe(1); // 原 Map 不受影响
    });
  });

  describe('recordEvent', () => {
    it('未录制时不记录事件', () => {
      const p = new Profiler2();
      p.recordEvent('click', 'cpu', 5);
      expect(p.events.length).toBe(0);
    });

    it('录制中记录事件', () => {
      const p = new Profiler2();
      p.startRecording();
      p.recordEvent('render.shadow', 'gpu', 2.5);
      expect(p.events.length).toBe(1);
      const e = p.events[0];
      expect(e.name).toBe('render.shadow');
      expect(e.category).toBe('gpu');
      expect(e.duration).toBe(2.5);
      expect(e.color).toBeDefined();
    });

    it('stopRecording 后停止记录', () => {
      const p = new Profiler2();
      p.startRecording();
      p.recordEvent('a', 'cpu', 1);
      p.stopRecording();
      p.recordEvent('b', 'cpu', 1);
      expect(p.events.length).toBe(1);
    });

    it('所有合法 category 可记录', () => {
      const p = new Profiler2();
      p.startRecording();
      const cats: ProfileCategory[] = ['cpu', 'gpu', 'memory', 'render', 'physics', 'audio', 'network'];
      for (const c of cats) {
        p.recordEvent(`evt-${c}`, c, 1);
      }
      expect(p.events.length).toBe(cats.length);
      expect(p.getEvents().length).toBe(cats.length);
    });

    it('getEvents 返回拷贝', () => {
      const p = new Profiler2();
      p.startRecording();
      p.recordEvent('a', 'cpu', 1);
      const evs = p.getEvents();
      evs.push({ name: 'fake', category: 'cpu', startTime: 0, duration: 0 });
      expect(p.events.length).toBe(1);
    });
  });

  describe('setXxx 系列', () => {
    it('setDrawCalls / setTriangles / setVertices', () => {
      const p = new Profiler2();
      p.setDrawCalls(42);
      p.setTriangles(1024);
      p.setVertices(2048);
      expect(p.drawCalls).toBe(42);
      expect(p.triangles).toBe(1024);
      expect(p.vertices).toBe(2048);
    });

    it('setMemoryUsage', () => {
      const p = new Profiler2();
      p.setMemoryUsage(128, 512);
      expect(p.memoryUsage).toEqual({ used: 128, total: 512 });
    });

    it('setGPUTime', () => {
      const p = new Profiler2();
      p.setGPUTime(3.14);
      expect(p.gpuTime).toBe(3.14);
    });

    it('禁用时 setXxx 为空操作', () => {
      const p = new Profiler2({ enabled: false });
      p.setDrawCalls(42);
      p.setTriangles(1024);
      p.setVertices(2048);
      p.setMemoryUsage(1, 2);
      p.setGPUTime(9.9);
      expect(p.drawCalls).toBe(0);
      expect(p.triangles).toBe(0);
      expect(p.vertices).toBe(0);
      expect(p.memoryUsage).toEqual({ used: 0, total: 0 });
      expect(p.gpuTime).toBe(0);
    });
  });

  describe('getFPS / getFrameTime / getAvgFrameTime', () => {
    it('返回当前值', () => {
      const p = new Profiler2();
      p.beginFrame(); p.endFrame();
      expect(p.getFPS()).toBe(p.fps);
      expect(p.getFrameTime()).toBe(p.frameTime);
      expect(p.getAvgFrameTime()).toBe(p.avgFrameTime);
    });
  });

  describe('getFrameTimeHistory / getFPSHistory', () => {
    it('返回拷贝数组', () => {
      const p = new Profiler2();
      p.beginFrame(); p.endFrame();
      p.beginFrame(); p.endFrame();
      const fth = p.getFrameTimeHistory();
      const fph = p.getFPSHistory();
      expect(fth.length).toBe(2);
      expect(fph.length).toBe(2);
      fth.push(999);
      expect(p.frameTimeHistory.length).toBe(2); // 原数组不受影响
    });
  });

  describe('getStats', () => {
    it('返回完整统计快照', () => {
      const p = new Profiler2();
      p.startRecording();
      p.beginFrame();
      p.beginZone('render');
      p.endZone('render');
      p.setDrawCalls(10);
      p.setTriangles(100);
      p.setVertices(200);
      p.setMemoryUsage(50, 100);
      p.setGPUTime(2);
      p.recordEvent('evt', 'cpu', 1);
      p.endFrame();

      const s = p.getStats();
      expect(s.enabled).toBe(true);
      expect(s.isRecording).toBe(true);
      expect(s.frameCount).toBe(1);
      expect(s.drawCalls).toBe(10);
      expect(s.triangles).toBe(100);
      expect(s.vertices).toBe(200);
      expect(s.memoryUsage).toEqual({ used: 50, total: 100 });
      expect(s.gpuTime).toBe(2);
      expect(s.zoneCount).toBe(1);
      // 1 个 zone 事件(endZone 时录制)+ 1 个 recordEvent = 2
      expect(s.eventCount).toBe(2);
    });

    it('memoryUsage 是拷贝', () => {
      const p = new Profiler2();
      p.setMemoryUsage(1, 2);
      const s = p.getStats();
      s.memoryUsage.used = 999;
      expect(p.memoryUsage.used).toBe(1);
    });

    it('minFrameTime 为 Infinity 时返回 0', () => {
      const p = new Profiler2();
      const s = p.getStats();
      expect(s.minFrameTime).toBe(0);
    });
  });

  describe('clear', () => {
    it('清空 events / zones / openZones,保留帧历史', () => {
      const p = new Profiler2();
      p.startRecording();
      p.beginFrame();
      p.beginZone('a'); p.endZone('a');
      p.recordEvent('e', 'cpu', 1);
      p.endFrame();
      // 1 个 zone 事件 + 1 个 recordEvent = 2
      expect(p.events.length).toBe(2);
      expect(p.zones.size).toBe(1);
      expect(p.frameCount).toBe(1);

      p.clear();
      expect(p.events.length).toBe(0);
      expect(p.zones.size).toBe(0);
      // 帧历史保留
      expect(p.frameCount).toBe(1);
      expect(p.frameTimeHistory.length).toBe(1);
    });
  });

  describe('reset', () => {
    it('重置全部状态(保留 maxHistorySize / enabled)', () => {
      const p = new Profiler2({ maxHistorySize: 30 });
      p.startRecording();
      p.beginFrame();
      p.beginZone('a'); p.endZone('a');
      p.recordEvent('e', 'cpu', 1);
      p.setDrawCalls(5);
      p.endFrame();

      p.reset();
      expect(p.frameCount).toBe(0);
      expect(p.fps).toBe(0);
      expect(p.frameTime).toBe(0);
      expect(p.avgFrameTime).toBe(0);
      expect(p.minFrameTime).toBe(Infinity);
      expect(p.maxFrameTime).toBe(0);
      expect(p.frameTimeHistory).toEqual([]);
      expect(p.fpsHistory).toEqual([]);
      expect(p.cpuTime).toBe(0);
      expect(p.gpuTime).toBe(0);
      expect(p.drawCalls).toBe(0);
      expect(p.triangles).toBe(0);
      expect(p.vertices).toBe(0);
      expect(p.memoryUsage).toEqual({ used: 0, total: 0 });
      expect(p.events).toEqual([]);
      expect(p.zones.size).toBe(0);
      expect(p.isRecording).toBe(false);
      // 配置保留
      expect(p.maxHistorySize).toBe(30);
      expect(p.enabled).toBe(true);
    });
  });

  describe('exportTrace', () => {
    it('空 trace 包含元数据事件', () => {
      const p = new Profiler2();
      const trace = p.exportTrace();
      expect(Array.isArray(trace.traceEvents)).toBe(true);
      // process_name + thread_name 两个元数据事件
      expect(trace.traceEvents.length).toBe(2);
      const md = trace.traceEvents.filter((e) => e.ph === 'M');
      expect(md.length).toBe(2);
    });

    it('录制事件导出为 X(完整)事件,ts 单位 μs', () => {
      const p = new Profiler2();
      p.startRecording();
      // beginFrame(t=1000), zone begin(t=1001), zone end(t=1002) → duration=1
      p.beginZone('render');
      p.endZone('render');
      const trace = p.exportTrace();
      const xEvents = trace.traceEvents.filter((e) => e.ph === 'X');
      expect(xEvents.length).toBe(1);
      const e = xEvents[0] as ChromeTraceEvent;
      expect(e.name).toBe('render');
      expect(e.cat).toBe('cpu');
      expect(e.dur).toBe(1000); // 1ms → 1000μs
      expect(e.ts).toBeGreaterThanOrEqual(0);
      expect(e.pid).toBe(1);
      expect(e.tid).toBe(1);
    });

    it('ts 相对基准(首事件 startTime)', () => {
      const p = new Profiler2();
      p.startRecording();
      p.beginZone('a'); p.endZone('a'); // startTime=1000
      const trace = p.exportTrace();
      const xEvents = trace.traceEvents.filter((e) => e.ph === 'X') as ChromeTraceEvent[];
      // 基准 = 1000,首事件 ts = (1000-1000)*1000 = 0
      expect(xEvents[0].ts).toBe(0);
    });

    it('不同 category 映射到不同 cat 字符串', () => {
      const p = new Profiler2();
      p.startRecording();
      p.recordEvent('e1', 'gpu', 1);
      p.recordEvent('e2', 'memory', 1);
      p.recordEvent('e3', 'render', 1);
      const trace = p.exportTrace();
      const cats = new Set(trace.traceEvents.filter((e) => e.ph === 'X').map((e) => e.cat));
      expect(cats.has('gpu')).toBe(true);
      expect(cats.has('memory')).toBe(true);
      expect(cats.has('render')).toBe(true);
    });

    it('toJSON 等价于 exportTrace', () => {
      const p = new Profiler2();
      p.startRecording();
      p.beginZone('a'); p.endZone('a');
      expect(p.toJSON()).toEqual(p.exportTrace());
    });
  });
});

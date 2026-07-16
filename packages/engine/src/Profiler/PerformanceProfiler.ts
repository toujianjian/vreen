// PerformanceProfiler — 性能分析工具。
//
// 提供:
//   - FPS 统计:帧率、帧时间、波动
//   - Draw Call 分析:每帧绘制调用数、三角形数、按 mesh 拆解
//   - 内存追踪:纹理/几何体内存占用
//   - ECS System 时序:各系统执行时间
//
// 使用:
//   const profiler = new PerformanceProfiler(renderer);
//   // 每帧:
//   profiler.beginFrame();
//   // ... render ...
//   profiler.endFrame();
//   // 读统计:
//   const stats = profiler.getStats();

import { createLogger } from '../logger';
import type { WebGL2Renderer, RendererStats, DrawCallEntry } from '../Renderer/WebGL2Renderer';
import type { World } from '../ECS/World';
import type { SystemTiming } from '../ECS/World';

const log = createLogger('Profiler');

export interface FPSStats {
  fps: number;
  frameTime: number;
  frameTimeMin: number;
  frameTimeMax: number;
  frameTimeAvg: number;
  frameTimeStd: number;
}

export interface MemoryStats {
  textures: number;
  texturesBytes: number;
  geometries: number;
  geometriesBytes: number;
  buffers: number;
  buffersBytes: number;
  programs: number;
}

export interface SystemStats {
  timings: SystemTiming[];
  totalTime: number;
  activeSystems: number;
}

export interface PerformanceReport {
  meta: {
    version: string;
    generatedAt: string;
    duration: number;
    frameCount: number;
  };
  summary: {
    fps: {
      avg: number;
      min: number;
      max: number;
    };
    frameTime: {
      avg: number;
      min: number;
      max: number;
      std: number;
    };
    renderer: {
      avgDrawCalls: number;
      avgTriangles: number;
      avgShadowPasses: number;
    };
    gpuTime: {
      avgMainPass: number;
      avgShadowPass: number;
      avgSsaoPass: number;
      avgPostPass: number;
      avgTotal: number;
    };
    systems: {
      totalTime: number;
      activeSystems: number;
      topSystems: { name: string; duration: number }[];
    };
  };
  details: {
    frames: {
      index: number;
      frameTime: number;
      drawCalls: number;
      triangles: number;
      gpuTime: RendererStats['gpuTime'];
    }[];
    drawCallBreakdown: Record<string, { drawCalls: number; triangles: number }>;
  };
}

export class PerformanceProfiler {
  private _renderer: WebGL2Renderer;
  private _world: World | null = null;

  private _frameTimes: number[] = [];
  private _maxFrameHistory = 120;
  private _frameStart = 0;

  private _memoryStats: MemoryStats = {
    textures: 0,
    texturesBytes: 0,
    geometries: 0,
    geometriesBytes: 0,
    buffers: 0,
    buffersBytes: 0,
    programs: 0,
  };
  private _lastRecordDuration: number = 0;

  private _recording: boolean = false;
  private _recordedFrames: PerformanceReport['details']['frames'] = [];
  private _recordStart: number = 0;
  private _drawCallAccum: Record<string, { drawCalls: number; triangles: number }> = {};

  constructor(renderer: WebGL2Renderer) {
    this._renderer = renderer;
  }

  setWorld(world: World): void {
    this._world = world;
  }

  startRecording(): void {
    this._recording = true;
    this._recordedFrames = [];
    this._recordStart = Date.now();
    this._drawCallAccum = {};
    log.info('Performance recording started');
  }

  stopRecording(): void {
    this._recording = false;
    const duration = Date.now() - this._recordStart;
    log.info(`Performance recording stopped: ${this._recordedFrames.length} frames in ${duration}ms`);
  }

  isRecording(): boolean {
    return this._recording;
  }

  beginFrame(): void {
    this._frameStart = performance.now();
  }

  endFrame(): void {
    const dt = performance.now() - this._frameStart;
    this._frameTimes.push(dt);
    if (this._frameTimes.length > this._maxFrameHistory) {
      this._frameTimes.shift();
    }
    this._updateMemoryStats();

    if (this._recording) {
      const stats = this._renderer.stats;
      this._recordedFrames.push({
        index: this._recordedFrames.length,
        frameTime: dt,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        gpuTime: stats.gpuTime,
      });

      for (const [name, entry] of Object.entries(stats.drawCallBreakdown)) {
        if (!this._drawCallAccum[name]) {
          this._drawCallAccum[name] = { drawCalls: 0, triangles: 0 };
        }
        this._drawCallAccum[name].drawCalls += entry.passes.main + entry.passes.shadow + entry.passes.ssao + entry.passes.helper;
        this._drawCallAccum[name].triangles += entry.triangles;
      }
    }
  }

  private _updateMemoryStats(): void {
    this._memoryStats.programs = this._renderer.stats.programs;
  }

  getFPSStats(): FPSStats {
    const times = this._frameTimes;
    if (times.length === 0) {
      return {
        fps: 0,
        frameTime: 0,
        frameTimeMin: 0,
        frameTimeMax: 0,
        frameTimeAvg: 0,
        frameTimeStd: 0,
      };
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const std = Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length);
    const min = Math.min(...times);
    const max = Math.max(...times);

    return {
      fps: times.length > 10 ? 1000 / avg : 0,
      frameTime: times[times.length - 1],
      frameTimeMin: min,
      frameTimeMax: max,
      frameTimeAvg: avg,
      frameTimeStd: std,
    };
  }

  getRendererStats(): RendererStats {
    return this._renderer.stats;
  }

  getMemoryStats(): MemoryStats {
    return { ...this._memoryStats };
  }

  getSystemStats(): SystemStats {
    if (!this._world) {
      return { timings: [], totalTime: 0, activeSystems: 0 };
    }

    const timings = this._world.getSystemTimings();
    const totalTime = timings.reduce((sum, t) => sum + t.duration, 0);
    const activeSystems = timings.filter((t) => t.enabled).length;

    return { timings: [...timings], totalTime, activeSystems };
  }

  getStats(): FPSStats & { renderer: RendererStats; memory: MemoryStats; systems: SystemStats; timestamp: number } {
    return {
      ...this.getFPSStats(),
      renderer: this.getRendererStats(),
      memory: this.getMemoryStats(),
      systems: this.getSystemStats(),
      timestamp: Date.now(),
    };
  }

  reset(): void {
    this._frameTimes = [];
  }

  getDrawCallBreakdown(): DrawCallEntry[] {
    const breakdown = this._renderer.stats.drawCallBreakdown;
    return Object.entries(breakdown)
      .map(([name, entry]) => ({ ...entry, name }))
      .sort((a, b) => (b as unknown as { triangles: number }).triangles - (a as unknown as { triangles: number }).triangles) as DrawCallEntry[];
  }

  generateReport(): PerformanceReport {
    const frames = this._recordedFrames.length > 0 ? this._recordedFrames : this._frameTimes.map((dt, i) => ({
      index: i,
      frameTime: dt,
      drawCalls: 0,
      triangles: 0,
      gpuTime: { mainPass: 0, shadowPass: 0, ssaoPass: 0, postPass: 0, total: 0 },
    }));

    const frameTimes = frames.map((f) => f.frameTime);
    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const minFrameTime = Math.min(...frameTimes);
    const maxFrameTime = Math.max(...frameTimes);
    const stdFrameTime = Math.sqrt(frameTimes.reduce((sum, t) => sum + Math.pow(t - avgFrameTime, 2), 0) / frameTimes.length);

    const fpsValues = frameTimes.map((t) => t > 0 ? 1000 / t : 0);
    const avgFPS = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length;
    const minFPS = Math.min(...fpsValues);
    const maxFPS = Math.max(...fpsValues);

    const drawCalls = frames.map((f) => f.drawCalls);
    const triangles = frames.map((f) => f.triangles);
    const shadowPasses = frames.map(() => this._renderer.stats.shadowPasses);

    const avgDrawCalls = drawCalls.reduce((a, b) => a + b, 0) / drawCalls.length;
    const avgTriangles = triangles.reduce((a, b) => a + b, 0) / triangles.length;
    const avgShadowPasses = shadowPasses.reduce((a, b) => a + b, 0) / shadowPasses.length;

    const gpuTimes = frames.map((f) => f.gpuTime);
    const avgMainPass = gpuTimes.reduce((sum, g) => sum + g.mainPass, 0) / gpuTimes.length;
    const avgShadowPass = gpuTimes.reduce((sum, g) => sum + g.shadowPass, 0) / gpuTimes.length;
    const avgSsaoPass = gpuTimes.reduce((sum, g) => sum + g.ssaoPass, 0) / gpuTimes.length;
    const avgPostPass = gpuTimes.reduce((sum, g) => sum + g.postPass, 0) / gpuTimes.length;
    const avgTotal = gpuTimes.reduce((sum, g) => sum + g.total, 0) / gpuTimes.length;

    let systemTop: { name: string; duration: number }[] = [];
    let systemTotal = 0;
    let activeSystems = 0;
    if (this._world) {
      const timings = this._world.getSystemTimings();
      systemTotal = timings.reduce((sum, t) => sum + t.duration, 0);
      activeSystems = timings.filter((t) => t.enabled).length;
      systemTop = timings
        .filter((t) => t.enabled)
        .map((t) => ({ name: t.name, duration: t.duration }))
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5);
    }

    return {
      meta: {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        duration: Date.now() - this._recordStart,
        frameCount: frames.length,
      },
      summary: {
        fps: { avg: avgFPS, min: minFPS, max: maxFPS },
        frameTime: { avg: avgFrameTime, min: minFrameTime, max: maxFrameTime, std: stdFrameTime },
        renderer: { avgDrawCalls, avgTriangles, avgShadowPasses },
        gpuTime: { avgMainPass, avgShadowPass, avgSsaoPass, avgPostPass, avgTotal },
        systems: { totalTime: systemTotal, activeSystems, topSystems: systemTop },
      },
      details: {
        frames,
        drawCallBreakdown: this._drawCallAccum,
      },
    };
  }

  exportJSON(pretty: boolean = true): string {
    const report = this.generateReport();
    return JSON.stringify(report, null, pretty ? 2 : 0);
  }

  exportCSV(): string {
    const report = this.generateReport();
    const lines: string[] = [];

    lines.push('# Performance Report');
    lines.push(`Generated: ${report.meta.generatedAt}`);
    lines.push(`Duration: ${report.meta.duration}ms`);
    lines.push(`Frames: ${report.meta.frameCount}`);
    lines.push('');

    lines.push('# Summary - FPS');
    lines.push('Metric,Value');
    lines.push(`Avg,FPS,${report.summary.fps.avg.toFixed(1)}`);
    lines.push(`Min,FPS,${report.summary.fps.min.toFixed(1)}`);
    lines.push(`Max,FPS,${report.summary.fps.max.toFixed(1)}`);
    lines.push('');

    lines.push('# Summary - Frame Time (ms)');
    lines.push('Metric,Value');
    lines.push(`Avg,${report.summary.frameTime.avg.toFixed(2)}`);
    lines.push(`Min,${report.summary.frameTime.min.toFixed(2)}`);
    lines.push(`Max,${report.summary.frameTime.max.toFixed(2)}`);
    lines.push(`Std,${report.summary.frameTime.std.toFixed(2)}`);
    lines.push('');

    lines.push('# Summary - Renderer');
    lines.push('Metric,Value');
    lines.push(`Avg Draw Calls,${report.summary.renderer.avgDrawCalls.toFixed(1)}`);
    lines.push(`Avg Triangles,${Math.round(report.summary.renderer.avgTriangles)}`);
    lines.push(`Avg Shadow Passes,${report.summary.renderer.avgShadowPasses.toFixed(1)}`);
    lines.push('');

    lines.push('# Summary - GPU Time (ms)');
    lines.push('Metric,Value');
    lines.push(`Main Pass,${report.summary.gpuTime.avgMainPass.toFixed(2)}`);
    lines.push(`Shadow Pass,${report.summary.gpuTime.avgShadowPass.toFixed(2)}`);
    lines.push(`SSAO Pass,${report.summary.gpuTime.avgSsaoPass.toFixed(2)}`);
    lines.push(`Post Pass,${report.summary.gpuTime.avgPostPass.toFixed(2)}`);
    lines.push(`Total,${report.summary.gpuTime.avgTotal.toFixed(2)}`);
    lines.push('');

    lines.push('# Frame Details');
    lines.push('Frame,FrameTime(ms),DrawCalls,Triangles,GPUMain(ms),GPUShadow(ms),GPUSSAO(ms),GPUPost(ms),GPUTotal(ms)');
    for (const frame of report.details.frames) {
      lines.push(`${frame.index},${frame.frameTime.toFixed(2)},${frame.drawCalls},${Math.round(frame.triangles)},${frame.gpuTime.mainPass.toFixed(2)},${frame.gpuTime.shadowPass.toFixed(2)},${frame.gpuTime.ssaoPass.toFixed(2)},${frame.gpuTime.postPass.toFixed(2)},${frame.gpuTime.total.toFixed(2)}`);
    }

    return lines.join('\n');
  }
}
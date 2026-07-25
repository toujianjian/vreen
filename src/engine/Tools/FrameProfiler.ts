// FrameProfiler — 帧级性能分析器。
//
// 设计目标:
//   - 环形缓冲区存储最近 N 帧(FrameSample),默认 120 帧,常数内存。
//   - 滚动统计:currentFPS / avgFPS / minFPS / maxFPS。
//   - 记录 draw calls / triangles / vertices / memoryMB 等渲染统计。
//   - 与现有 `Profiler` 互补:`Profiler` 关注 mark 区间,本类关注帧级聚合。
//
// 用法:
//   const fp = new FrameProfiler({ maxSamples: 120 });
//   fp.beginFrame();
//   ... 渲染 ...
//   fp.endFrame({ drawCalls: 120, triangles: 50000, vertices: 25000, memoryMB: 64 });
//   const m = fp.getMetrics();
//   const hist = fp.getHistory(30);

/** 单帧采样数据。 */
export interface FrameSample {
  /** 帧序号(单调递增) */
  frame: number;
  /** 帧开始时间戳(performance.now, ms) */
  time: number;
  /** 帧间隔(ms) — 与上一帧的 wall clock 差 */
  dt: number;
  /** 该帧 draw call 数(由 caller 提供) */
  drawCalls: number;
  /** 该帧三角形数 */
  triangles: number;
  /** 该帧顶点数 */
  vertices: number;
  /** 该帧 JS heap 估算占用(MB,由 caller 通过 `performance.memory` 或手动估算提供) */
  memoryMB: number;
}

/** `getMetrics()` 返回的实时指标快照。 */
export interface FrameMetrics {
  /** 当前 FPS(由最近一帧 dt 推算) */
  currentFPS: number;
  /** 滑动平均 FPS(覆盖 ring buffer 全部样本) */
  avgFPS: number;
  /** 滑动窗口最小 FPS */
  minFPS: number;
  /** 滑动窗口最大 FPS */
  maxFPS: number;
  /** 最近一帧耗时(ms) */
  frameTimeMs: number;
  /** 最近一帧 draw call 数 */
  drawCalls: number;
  /** 最近一帧三角形数 */
  triangles: number;
  /** 最近一帧顶点数 */
  vertices: number;
  /** 最近一帧内存占用(MB) */
  memoryMB: number;
  /** 当前有效样本数 */
  sampleCount: number;
}

/** 帧结束时可附加的渲染统计。 */
export interface FrameStats {
  drawCalls?: number;
  triangles?: number;
  vertices?: number;
  memoryMB?: number;
}

export class FrameProfiler {
  readonly maxSamples: number;
  /** 环形缓冲区(老→新顺序对外暴露通过 `getHistory`) */
  readonly samples: FrameSample[] = [];

  /** 当前 FPS(最近一帧 dt 推算) */
  currentFPS: number = 0;
  /** 滑动平均 FPS */
  avgFPS: number = 0;
  /** 滑动窗口最小 FPS */
  minFPS: number = 0;
  /** 滑动窗口最大 FPS */
  maxFPS: number = 0;

  private ringHead: number = 0;
  private ringCount: number = 0;
  private frame: number = 0;
  private frameStartMs: number = 0;
  private lastFrameEndMs: number = 0;

  constructor(opts: { maxSamples?: number } = {}) {
    this.maxSamples = opts.maxSamples ?? 120;
  }

  /** 标记帧开始。必须与 `endFrame` 配对调用。 */
  beginFrame(): void {
    this.frameStartMs = performance.now();
  }

  /**
   * 标记帧结束,记录本帧采样并推进环形缓冲区。
   * `stats` 中的字段缺省时按 0 处理。
   */
  endFrame(stats: FrameStats = {}): FrameSample {
    const now = performance.now();
    const dt = this.lastFrameEndMs > 0 ? now - this.lastFrameEndMs : 16.67;
    this.lastFrameEndMs = now;

    const sample: FrameSample = {
      frame: this.frame++,
      time: this.frameStartMs,
      dt,
      drawCalls: stats.drawCalls ?? 0,
      triangles: stats.triangles ?? 0,
      vertices: stats.vertices ?? 0,
      memoryMB: stats.memoryMB ?? 0,
    };

    this.samples[this.ringHead] = sample;
    this.ringHead = (this.ringHead + 1) % this.maxSamples;
    if (this.ringCount < this.maxSamples) this.ringCount++;

    this.recomputeMetrics();
    return sample;
  }

  /**
   * 返回当前实时指标(FPS / 帧时间 / draw calls / 三角面 等)。
   * 内部已在 `endFrame` 后自动刷新,无需手动调用。
   */
  getMetrics(): FrameMetrics {
    const last = this.lastSample();
    return {
      currentFPS: this.currentFPS,
      avgFPS: this.avgFPS,
      minFPS: this.minFPS,
      maxFPS: this.maxFPS,
      frameTimeMs: last ? last.dt : 0,
      drawCalls: last ? last.drawCalls : 0,
      triangles: last ? last.triangles : 0,
      vertices: last ? last.vertices : 0,
      memoryMB: last ? last.memoryMB : 0,
      sampleCount: this.ringCount,
    };
  }

  /**
   * 返回最近 `count` 帧历史(老→新顺序)。
   * `count` 大于有效样本数时返回全部;`count <= 0` 时返回空数组。
   */
  getHistory(count: number = this.maxSamples): FrameSample[] {
    if (count <= 0 || this.ringCount === 0) return [];
    const n = Math.min(count, this.ringCount);
    const start = this.ringCount < this.maxSamples ? this.ringCount - n : (this.ringHead - n + this.maxSamples) % this.maxSamples;
    const out: FrameSample[] = [];
    for (let i = 0; i < n; i++) {
      out.push(this.samples[(start + i) % this.maxSamples]);
    }
    return out;
  }

  /** 清空环形缓冲区并重置指标。 */
  reset(): void {
    this.samples.length = 0;
    this.ringHead = 0;
    this.ringCount = 0;
    this.frame = 0;
    this.frameStartMs = 0;
    this.lastFrameEndMs = 0;
    this.currentFPS = 0;
    this.avgFPS = 0;
    this.minFPS = 0;
    this.maxFPS = 0;
  }

  /** 当前缓冲区有效样本数。 */
  get sampleCount(): number {
    return this.ringCount;
  }

  // ---- 内部 ----

  private lastSample(): FrameSample | undefined {
    if (this.ringCount === 0) return undefined;
    const idx = (this.ringHead - 1 + this.maxSamples) % this.maxSamples;
    return this.samples[idx];
  }

  private recomputeMetrics(): void {
    if (this.ringCount === 0) {
      this.currentFPS = 0;
      this.avgFPS = 0;
      this.minFPS = 0;
      this.maxFPS = 0;
      return;
    }
    const last = this.lastSample()!;
    this.currentFPS = last.dt > 0 ? 1000 / last.dt : 0;

    let sum = 0;
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < this.ringCount; i++) {
      const s = this.samples[i];
      const fps = s.dt > 0 ? 1000 / s.dt : 0;
      sum += fps;
      if (fps < min) min = fps;
      if (fps > max) max = fps;
    }
    this.avgFPS = sum / this.ringCount;
    this.minFPS = min === Infinity ? 0 : min;
    this.maxFPS = max;
  }
}

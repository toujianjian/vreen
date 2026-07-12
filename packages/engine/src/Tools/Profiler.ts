// Profiler — 性能分析工具。
//
// 设计目标:
//   - 零侵入:不修改任何 system / renderer 的 API,只通过 mark() 钩子收集
//   - 双采样:CPU time(performance.now)+ GPU time(EXT_disjoint_timer_query_webgl2)
//   - Ring buffer 60 帧,常数内存
//   - 配套 HUD(ProfilerOverlay)在 viewer 里看实时数据
//
// 用法:
//   const profiler = new Profiler({ ringSize: 60 });
//   profiler.mark('frameStart');
//   ...
//   profiler.mark('ecs.update');
//   world.update(dt);
//   profiler.markEnd('ecs.update');
//   ...
//   profiler.mark('render');
//   renderer.render(...);
//   profiler.markEnd('render');
//   profiler.frameEnd();    // 收尾,推进 ring buffer
//   const snap = profiler.snapshot();  // 当前帧聚合数据
//   const hist = profiler.history();   // 最近 N 帧 ring buffer

export interface ProfilerMark {
  name: string;
  /** CPU 起始时间 (performance.now) */
  startMs: number;
  /** 结束时间;若仍 open 则为 frameEnd 时 */
  endMs: number;
  /** GPU 起始 timer(可空) */
  gpuQueryStart?: WebGLQuery;
  /** GPU 结束 timer(可空) */
  gpuQueryEnd?: WebGLQuery;
  /** GPU 实际 ns(异步读到后填入) */
  gpuTimeNs?: number;
  /** 子标记列表(嵌套 mark 同一帧内的) */
  children: ProfilerMark[];
}

export interface DrawCallSample {
  /** 单 mesh 一次 draw call 贡献(name → 统计)。 */
  byMesh: Record<
    string,
    {
      calls: number;
      triangles: number;
      passes: { main: number; shadow: number; ssao: number; helper: number };
    }
  >;
}

export interface FrameSample {
  /** 帧序号 */
  frame: number;
  /** 帧 CPU 总耗时 (ms) */
  cpuMs: number;
  /** 帧 GPU 总耗时 (ms,可能 undefined 若 GPU 查询未就绪) */
  gpuMs?: number;
  /** 帧间 wall clock 间隔 (ms) */
  wallDeltaMs: number;
  /** FPS(从 wallDeltaMs 推算) */
  fps: number;
  /** 各命名 mark 的耗时快照 { name: ms } */
  marks: Record<string, number>;
  /** 时间戳 */
  timestamp: number;
  /** draw call 数(由 caller 提供) */
  drawCalls?: number;
  /** 三角形数(由 caller 提供) */
  triangles?: number;
  /** 按 mesh 拆解的 draw call 贡献(由 caller 提供)。 */
  drawCallBreakdown?: DrawCallSample;
}

export class Profiler {
  readonly ringSize: number;
  private ring: FrameSample[] = [];
  private ringHead: number = 0;
  private ringCount: number = 0;
  private frame: number = 0;

  /** 当前 open 的 mark stack(openMarks[-1] 是当前未结束 mark) */
  private openMarks: ProfilerMark[] = [];
  /** 本帧 root marks 列表(每个 mark 顶层 push 一次) */
  private rootMarks: ProfilerMark[] = [];

  /** frame 起始时间 */
  private frameStartMs: number = 0;
  /** 上一帧 wall clock */
  private lastFrameEndMs: number = 0;

  constructor(opts: { ringSize?: number } = {}) {
    this.ringSize = opts.ringSize ?? 60;
  }

  /** 标记帧开始。必须 frameEnd() 配对调用。 */
  frameStart(): void {
    this.frameStartMs = performance.now();
    this.rootMarks = [];
    this.openMarks = [];
  }

  /**
   * 开始一段 mark。可选附带 GPU timer query。
   * 用法:
   *   profiler.mark('render', { gpu: gl, gl });
   *   renderer.render(scene, camera);
   *   profiler.markEnd('render');
   */
  mark(name: string, opts?: { gpu?: { gl: WebGL2RenderingContext } }): void {
    const m: ProfilerMark = {
      name,
      startMs: performance.now(),
      endMs: 0,
      children: [],
    };
    if (opts?.gpu) {
      try {
        const ext = (opts.gpu.gl as any).getExtension('EXT_disjoint_timer_query_webgl2') as any;
        if (ext) {
          const q1 = opts.gpu.gl.createQuery()!;
          opts.gpu.gl.beginQuery(ext.TIME_ELAPSED_EXT, q1);
          m.gpuQueryStart = q1;
        }
      } catch (e) { /* GPU query 不可用时静默 */ }
    }
    if (this.openMarks.length > 0) {
      this.openMarks[this.openMarks.length - 1].children.push(m);
    } else {
      this.rootMarks.push(m);
    }
    this.openMarks.push(m);
  }

  /** 结束最近一个 mark(按 name 匹配,容错乱序)。 */
  markEnd(name: string, opts?: { gpu?: { gl: WebGL2RenderingContext } }): void {
    let m: ProfilerMark | undefined;
    for (let i = this.openMarks.length - 1; i >= 0; i--) {
      if (this.openMarks[i].name === name) {
        m = this.openMarks[i];
        this.openMarks.splice(i, 1);
        break;
      }
    }
    if (!m) return;
    m.endMs = performance.now();
    if (opts?.gpu && m.gpuQueryStart) {
      try {
        const ext = (opts.gpu.gl as any).getExtension('EXT_disjoint_timer_query_webgl2') as any;
        if (ext) {
          opts.gpu.gl.endQuery(ext.TIME_ELAPSED_EXT);
          m.gpuQueryEnd = m.gpuQueryStart;
        }
      } catch (e) { /* 忽略 */ }
    }
  }

  /**
   * 异步读 GPU query 结果(必须每帧调用)。
   * 不阻塞 mark 流程;若 query 还没就绪,跳过。
   */
  pollGpuTimers(gl: WebGL2RenderingContext): void {
    const ext = (gl as any).getExtension('EXT_disjoint_timer_query_webgl2') as any;
    if (!ext) return;
    const samples = this.allOpenAndClosedMarks();
    for (const m of samples) {
      if (!m.gpuQueryStart || m.gpuTimeNs != null) continue;
      const available = gl.getQueryParameter(m.gpuQueryStart, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (available && !disjoint) {
        const ns = gl.getQueryParameter(m.gpuQueryStart, gl.QUERY_RESULT) as number;
        m.gpuTimeNs = ns;
      }
    }
  }

  private allOpenAndClosedMarks(): ProfilerMark[] {
    const out: ProfilerMark[] = [];
    const walk = (ms: ProfilerMark[]) => { for (const m of ms) { out.push(m); walk(m.children); } };
    walk(this.rootMarks);
    return out;
  }

  /**
   * 收尾本帧。计算 CPU 总耗时,关闭所有未结束 mark(用于错误恢复),推进 ring buffer。
   */
  frameEnd(
    opts: { drawCalls?: number; triangles?: number; drawCallBreakdown?: DrawCallSample } = {},
  ): FrameSample {
    const now = performance.now();
    // 强制关闭仍未结束的 mark
    while (this.openMarks.length > 0) {
      const m = this.openMarks.pop()!;
      m.endMs = now;
    }
    const cpuMs = now - this.frameStartMs;
    const wallDeltaMs = this.lastFrameEndMs > 0 ? now - this.lastFrameEndMs : 16.67;
    this.lastFrameEndMs = now;

    // 汇总 marks(只 root 层级)
    const marks: Record<string, number> = {};
    let gpuTotalMs = 0;
    let gpuAny = false;
    for (const m of this.rootMarks) {
      marks[m.name] = m.endMs - m.startMs;
      if (m.gpuTimeNs != null) {
        gpuTotalMs += m.gpuTimeNs / 1e6;
        gpuAny = true;
      }
    }

    const sample: FrameSample = {
      frame: this.frame++,
      cpuMs,
      gpuMs: gpuAny ? gpuTotalMs : undefined,
      wallDeltaMs,
      fps: wallDeltaMs > 0 ? 1000 / wallDeltaMs : 0,
      marks,
      timestamp: now,
      drawCalls: opts.drawCalls,
      triangles: opts.triangles,
      drawCallBreakdown: opts.drawCallBreakdown,
    };
    this.ring[this.ringHead] = sample;
    this.ringHead = (this.ringHead + 1) % this.ringSize;
    if (this.ringCount < this.ringSize) this.ringCount++;
    return sample;
  }

  /** 最近一帧聚合。 */
  snapshot(): FrameSample | null {
    if (this.ringCount === 0) return null;
    const idx = (this.ringHead - 1 + this.ringSize) % this.ringSize;
    return this.ring[idx];
  }

  /** ring buffer 全部(老→新顺序)。 */
  history(): FrameSample[] {
    if (this.ringCount === 0) return [];
    const start = this.ringCount < this.ringSize ? 0 : this.ringHead;
    const out: FrameSample[] = [];
    for (let i = 0; i < this.ringCount; i++) {
      out.push(this.ring[(start + i) % this.ringSize]);
    }
    return out;
  }

  /** 跨 N 帧平均某 mark 的耗时(返回 ms)。 */
  avgMark(name: string, n: number = this.ringSize): number {
    const hist = this.history();
    if (hist.length === 0) return 0;
    const slice = hist.slice(-n);
    let sum = 0; let cnt = 0;
    for (const s of slice) {
      if (s.marks[name] != null) { sum += s.marks[name]; cnt++; }
    }
    return cnt > 0 ? sum / cnt : 0;
  }

  /** 导出为 JSON(用于 debug 日志或导出)。 */
  toJSON(): unknown {
    return {
      ringSize: this.ringSize,
      ringCount: this.ringCount,
      frame: this.frame,
      history: this.history(),
    };
  }

  /** 释放所有 GPU query。 */
  dispose(gl: WebGL2RenderingContext): void {
    const walk = (ms: ProfilerMark[]) => {
      for (const m of ms) {
        if (m.gpuQueryStart) gl.deleteQuery(m.gpuQueryStart);
        walk(m.children);
      }
    };
    walk(this.rootMarks);
  }
}

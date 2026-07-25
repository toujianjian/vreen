// GpuProfiler — GPU 性能分析器(基于 EXT_disjoint_timer_query_webgl2)。
//
// 设计目标:
//   - 封装 WebGL2 的 timer query 扩展,提供 begin/end/resolve 三段式 API。
//   - 异步读取结果:GPU query 通常需要若干帧后才可读,本类不阻塞主循环。
//   - 与 `Profiler.mark(..., { gpu })` 互补:本类聚焦独立命名的 GPU 区间,
//     不依赖 mark 栈结构,便于在渲染管线特定阶段单独埋点。
//
// 注意:EXT_disjoint_timer_query_webgl2 在某些浏览器(如 Safari)可能不可用,
// 此时所有方法静默 no-op,`getQueryResult` 返回 undefined。

/** 单个 GPU 查询的状态与结果。 */
export interface GpuQuery {
  /** 查询 id(由 `beginQuery` 返回) */
  id: string;
  /** 开始时间戳(performance.now, ms;仅用于 CPU 侧排序参考) */
  beginTime: number;
  /** 结束时间戳(performance.now, ms) */
  endTime: number;
  /** GPU 耗时(ms);未就绪时为 undefined */
  duration?: number;
  /** 是否已就绪(可读取 duration) */
  resolved: boolean;
  /** 内部 WebGLQuery 对象 */
  glQuery?: WebGLQuery;
}

/** EXT_disjoint_timer_query_webgl2 扩展的最小类型描述。 */
interface EXTDisjointTimerQueryWebGL2 {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
  readonly QUERY_COUNTER_BITS_EXT: number;
}

export class GpuProfiler {
  /** 查询名 → 查询记录。 */
  readonly queries: Map<string, GpuQuery> = new Map();

  private ext: EXTDisjointTimerQueryWebGL2 | null = null;
  private extChecked: boolean = false;

  /**
   * 开始 GPU 查询 `id`。若扩展不可用则记录 CPU 侧时间戳作为退化。
   * 同一 `id` 重复调用会覆盖旧记录。
   */
  beginQuery(gl: WebGL2RenderingContext, id: string): void {
    this.ensureExt(gl);
    const record: GpuQuery = {
      id,
      beginTime: performance.now(),
      endTime: 0,
      resolved: false,
    };
    if (this.ext) {
      try {
        const q = gl.createQuery();
        if (q) {
          gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
          record.glQuery = q;
        }
      } catch {
        // 扩展存在但调用失败时,退化为 CPU 计时
      }
    }
    this.queries.set(id, record);
  }

  /** 结束 GPU 查询 `id`。 */
  endQuery(gl: WebGL2RenderingContext, id: string): void {
    const record = this.queries.get(id);
    if (!record) return;
    record.endTime = performance.now();
    if (this.ext && record.glQuery) {
      try {
        gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      } catch {
        // 忽略
      }
    } else {
      // 退化路径:用 CPU 侧差值填充 duration
      record.duration = record.endTime - record.beginTime;
      record.resolved = true;
    }
  }

  /**
   * 尝试读取 `id` 的 GPU 结果。若未就绪返回 undefined。
   * 内部会自动调用 `pollAll(gl)` 刷新待决查询。
   */
  getQueryResult(gl: WebGL2RenderingContext, id: string): number | undefined {
    this.pollAll(gl);
    const record = this.queries.get(id);
    return record?.resolved ? record.duration : undefined;
  }

  /** 获取所有查询的结果快照(已就绪的含 duration)。 */
  getAllResults(gl: WebGL2RenderingContext): GpuQuery[] {
    this.pollAll(gl);
    return Array.from(this.queries.values());
  }

  /**
   * 轮询所有未决查询。建议每帧调用一次。
   * 已就绪的查询会写入 duration 并标记 resolved;GPU disjoint 时丢弃结果。
   */
  pollAll(gl: WebGL2RenderingContext): void {
    if (!this.ext) {
      // 退化路径:所有查询都已用 CPU 时间填充
      return;
    }
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    for (const record of this.queries.values()) {
      if (record.resolved || !record.glQuery) continue;
      const available = gl.getQueryParameter(record.glQuery, gl.QUERY_RESULT_AVAILABLE);
      if (available) {
        if (!disjoint) {
          const ns = gl.getQueryParameter(record.glQuery, gl.QUERY_RESULT) as number;
          record.duration = ns / 1e6; // ns → ms
        }
        record.resolved = true;
        // 释放 query 对象
        gl.deleteQuery(record.glQuery);
        record.glQuery = undefined;
      }
    }
  }

  /** 清空所有查询记录(不删除 WebGLQuery 对象,调用方需自行管理)。 */
  reset(): void {
    this.queries.clear();
  }

  /** 释放所有未删除的 WebGLQuery 对象。 */
  dispose(gl: WebGL2RenderingContext): void {
    for (const record of this.queries.values()) {
      if (record.glQuery) {
        gl.deleteQuery(record.glQuery);
        record.glQuery = undefined;
      }
    }
    this.queries.clear();
  }

  // ---- 内部 ----

  private ensureExt(gl: WebGL2RenderingContext): void {
    if (this.extChecked) return;
    try {
      this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as EXTDisjointTimerQueryWebGL2 | null;
    } catch {
      this.ext = null;
    }
    this.extChecked = true;
  }
}

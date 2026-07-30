// Profiler2 — 增强版引擎性能分析器。
//
// 与早期 `Profiler` (ring-buffer + mark/markEnd) 互补:本类提供面向「帧/区域/事件」
// 三层语义的性能数据收集,并支持导出为 Chrome Trace (chrome://tracing) 格式。
//
// 设计目标:
//   - 帧级聚合:beginFrame / endFrame 自动计算 frameTime / fps / 历史曲线
//   - 区域计时:beginZone / endZone 累计 enterCount / total / min / max / avg
//   - 事件流:recordEvent 记录离散事件(可分类 cpu/gpu/memory/render/physics/audio/network)
//   - 录制开关:startRecording / stopRecording 控制是否累积 events 数组
//   - 导出:exportTrace 产出 Chrome Trace JSON,便于用 chrome://tracing 可视化
//
// 用法:
//   const p = new Profiler({ maxHistorySize: 120 });
//   p.setEnabled(true);
//   p.beginFrame();
//   p.beginZone('render');
//   renderer.render(scene, camera);
//   p.endZone('render');
//   p.setDrawCalls(renderer.drawCalls);
//   p.endFrame();
//   const stats = p.getStats();
//   const trace = p.exportTrace();

/** 事件类别。 */
export type ProfileCategory = 'cpu' | 'gpu' | 'memory' | 'render' | 'physics' | 'audio' | 'network';

/** 单条性能事件。 */
export interface ProfileEvent {
  /** 事件名(如 "render.shadow" / "ecs.update")。 */
  name: string;
  /** 事件类别。 */
  category: ProfileCategory;
  /** 起始时间戳(ms,performance.now 域)。 */
  startTime: number;
  /** 持续时长(ms)。 */
  duration: number;
  /** 可选颜色(用于 UI 高亮,格式 "#rrggbb")。 */
  color?: string;
}

/** 区域(zone)累计统计。 */
export interface ProfileZone {
  /** 区域名。 */
  name: string;
  /** 进入次数(beginZone 调用次数)。 */
  enterCount: number;
  /** 累计耗时(ms)。 */
  totalTime: number;
  /** 单次最小耗时(ms)。 */
  minTime: number;
  /** 单次最大耗时(ms)。 */
  maxTime: number;
  /** 平均耗时(ms,= totalTime / enterCount)。 */
  avgTime: number;
}

/** 内存使用快照。 */
export interface MemoryUsage {
  /** 已使用字节数。 */
  used: number;
  /** 总分配字节数。 */
  total: number;
}

/** Profiler2 构造选项。 */
export interface Profiler2Options {
  /** 历史曲线最大长度(FPS / frameTime)。默认 120。 */
  maxHistorySize?: number;
  /** 初始是否启用。默认 true。 */
  enabled?: boolean;
}

/** getStats 返回的完整统计快照。 */
export interface ProfilerStats {
  enabled: boolean;
  isRecording: boolean;
  frameCount: number;
  fps: number;
  frameTime: number;
  avgFrameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
  cpuTime: number;
  gpuTime: number;
  drawCalls: number;
  triangles: number;
  vertices: number;
  memoryUsage: MemoryUsage;
  zoneCount: number;
  eventCount: number;
}

/** Chrome Trace 事件(详见 https://docs.google.com/document/d/1CvAClvFfyA5R5PhOMUvOc0fQkXnOTnfHABQOZzwJASQ). */
export interface ChromeTraceEvent {
  name: string;
  cat: string;
  ph: 'B' | 'E' | 'X' | 'i' | 'M';
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

/** Chrome Trace 文件根对象。 */
export interface ChromeTrace {
  traceEvents: ChromeTraceEvent[];
}

// 类别名 → Chrome trace category 字符串
const CATEGORY_STR: Record<ProfileCategory, string> = {
  cpu: 'cpu',
  gpu: 'gpu',
  memory: 'memory',
  render: 'render',
  physics: 'physics',
  audio: 'audio',
  network: 'network',
};

// 默认类别 → 颜色映射(UI 高亮用)
const DEFAULT_CATEGORY_COLOR: Record<ProfileCategory, string> = {
  cpu: '#4caf50',
  gpu: '#9c27b0',
  memory: '#ff9800',
  render: '#2196f3',
  physics: '#f44336',
  audio: '#00bcd4',
  network: '#795548',
};

/** 当前打开的 zone 栈帧。 */
interface OpenZone {
  name: string;
  startMs: number;
}

/**
 * 增强版引擎性能分析器。
 *
 * 与 `Profiler` 区别:
 *   - `Profiler` 关注 mark 区间 + GPU timer query 集成(ring buffer 快照)
 *   - `Profiler2` 关注帧/区域/事件三层语义 + Chrome Trace 导出 + FPS 曲线
 *
 * 二者可共存:同一引擎可同时挂载两个分析器,分别服务不同消费者(HUD vs. 离线分析)。
 */
export class Profiler2 {
  /** 是否启用。禁用时所有 begin/end/setXxx 调用为空操作。 */
  enabled: boolean;

  /** 当前帧起始时间(ms,performance.now 域)。 */
  frameStartTime: number = 0;
  /** 当前帧结束时间(ms)。 */
  frameEndTime: number = 0;
  /** 当前帧耗时(ms,= frameEndTime - frameStartTime)。 */
  frameTime: number = 0;
  /** 历史最小帧耗时(ms)。 */
  minFrameTime: number = Infinity;
  /** 历史最大帧耗时(ms)。 */
  maxFrameTime: number = 0;
  /** 平均帧耗时(ms,= 累计 frameTime / frameCount)。 */
  avgFrameTime: number = 0;
  /** 累计帧数。 */
  frameCount: number = 0;
  /** 当前 FPS(由上一帧 wallDelta 推算)。 */
  fps: number = 0;
  /** FPS 历史曲线(老→新)。 */
  fpsHistory: number[] = [];
  /** 帧时间历史曲线(老→新,ms)。 */
  frameTimeHistory: number[] = [];
  /** 历史曲线最大长度。 */
  maxHistorySize: number;

  /** 当前帧 CPU 总耗时(ms,由 zone 累加或 setGPUTime 对应的 CPU 侧)。 */
  cpuTime: number = 0;
  /** 当前帧 GPU 总耗时(ms,由 setGPUTime 设置)。 */
  gpuTime: number = 0;
  /** 当前帧 DrawCall 数。 */
  drawCalls: number = 0;
  /** 当前帧三角形数。 */
  triangles: number = 0;
  /** 当前帧顶点数。 */
  vertices: number = 0;
  /** 内存使用快照(字节)。 */
  memoryUsage: MemoryUsage = { used: 0, total: 0 };

  /** 录制中的事件流(仅在 isRecording = true 时累积)。 */
  events: ProfileEvent[] = [];
  /** 区域统计表(name → zone)。 */
  zones: Map<string, ProfileZone> = new Map();
  /** 是否正在录制事件。 */
  isRecording: boolean = false;

  /** 当前打开的 zone 栈。 */
  private openZones: OpenZone[] = [];
  /** 累计 frameTime 之和(用于 avgFrameTime)。 */
  private frameTimeSum: number = 0;
  /** 上一帧 wall clock 结束时间(用于推算 fps)。 */
  private lastFrameEndMs: number = 0;
  /** 进程 ID(Chrome trace 用,固定 1)。 */
  private readonly pid: number = 1;
  /** 线程 ID(Chrome trace 用,固定 1)。 */
  private readonly tid: number = 1;

  constructor(opts: Profiler2Options = {}) {
    this.maxHistorySize = opts.maxHistorySize ?? 120;
    this.enabled = opts.enabled ?? true;
  }

  /** 启用/禁用分析器。禁用时所有收集方法为空操作。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 开始一帧。必须与 endFrame 配对调用。 */
  beginFrame(): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.frameStartTime = now;
    this.cpuTime = 0;
    this.gpuTime = 0;
    // drawCalls / triangles / vertices 由调用方在帧内 setXxx 设置,
    // 这里不重置以允许「endFrame 前最后一次 set」生效;但 cpu/gpu 与 zone 不同,
    // zone 是 begin/end 配对会自我累计,而 cpu/gpu 需要每帧清零。
  }

  /** 结束一帧。计算 frameTime / fps,推进历史曲线。 */
  endFrame(): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.frameEndTime = now;
    this.frameTime = now - this.frameStartTime;
    // wall delta:首帧无前帧,用 frameTime 近似
    const wallDelta = this.lastFrameEndMs > 0 ? now - this.lastFrameEndMs : this.frameTime;
    this.lastFrameEndMs = now;
    this.fps = wallDelta > 0 ? 1000 / wallDelta : 0;

    this.frameCount++;
    this.frameTimeSum += this.frameTime;
    this.avgFrameTime = this.frameTimeSum / this.frameCount;
    if (this.frameTime < this.minFrameTime) this.minFrameTime = this.frameTime;
    if (this.frameTime > this.maxFrameTime) this.maxFrameTime = this.frameTime;

    // 推进历史曲线(裁剪到 maxHistorySize)
    this.frameTimeHistory.push(this.frameTime);
    this.fpsHistory.push(this.fps);
    if (this.frameTimeHistory.length > this.maxHistorySize) {
      this.frameTimeHistory.shift();
    }
    if (this.fpsHistory.length > this.maxHistorySize) {
      this.fpsHistory.shift();
    }

    // 关闭仍未结束的 zone(错误恢复)
    while (this.openZones.length > 0) {
      this.endZone(this.openZones[this.openZones.length - 1].name);
    }
  }

  /**
   * 开始一段命名区域计时。可与 endZone 嵌套;同名 zone 累计统计。
   * 区域耗时也会累加到当前帧 cpuTime(便于 getStats 总览)。
   */
  beginZone(name: string): void {
    if (!this.enabled) return;
    const startMs = performance.now();
    this.openZones.push({ name, startMs });
    // 若在录制中,记录一个 begin 事件(以 X 完整事件形式在 endZone 时合并输出)
  }

  /** 结束最近一个同名区域。更新 zones 表的累计统计。 */
  endZone(name: string): void {
    if (!this.enabled) return;
    // 从栈顶向下查找匹配的 name(容错乱序)
    let idx = -1;
    for (let i = this.openZones.length - 1; i >= 0; i--) {
      if (this.openZones[i].name === name) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    const open = this.openZones[idx];
    this.openZones.splice(idx, 1);
    const duration = performance.now() - open.startMs;

    // 更新 zone 累计统计
    let z = this.zones.get(name);
    if (!z) {
      z = {
        name,
        enterCount: 0,
        totalTime: 0,
        minTime: Infinity,
        maxTime: 0,
        avgTime: 0,
      };
      this.zones.set(name, z);
    }
    z.enterCount++;
    z.totalTime += duration;
    if (duration < z.minTime) z.minTime = duration;
    if (duration > z.maxTime) z.maxTime = duration;
    z.avgTime = z.totalTime / z.enterCount;

    // 累加到当前帧 cpuTime
    this.cpuTime += duration;

    // 若在录制中,作为完整事件(X)记录
    if (this.isRecording) {
      this.events.push({
        name,
        category: 'cpu',
        startTime: open.startMs,
        duration,
      });
    }
  }

  /**
   * 记录一条离散事件(非 zone 计时,由调用方提供 duration)。
   * 仅在 isRecording = true 时累积到 events。
   */
  recordEvent(name: string, category: ProfileCategory, duration: number, color?: string): void {
    if (!this.enabled || !this.isRecording) return;
    this.events.push({
      name,
      category,
      startTime: performance.now() - duration,
      duration,
      color: color ?? DEFAULT_CATEGORY_COLOR[category],
    });
  }

  /** 设置当前帧 DrawCall 数。 */
  setDrawCalls(count: number): void {
    if (!this.enabled) return;
    this.drawCalls = count;
  }

  /** 设置当前帧三角形数。 */
  setTriangles(count: number): void {
    if (!this.enabled) return;
    this.triangles = count;
  }

  /** 设置当前帧顶点数。 */
  setVertices(count: number): void {
    if (!this.enabled) return;
    this.vertices = count;
  }

  /** 设置内存使用快照(字节)。 */
  setMemoryUsage(used: number, total: number): void {
    if (!this.enabled) return;
    this.memoryUsage = { used, total };
  }

  /** 设置当前帧 GPU 总耗时(ms)。 */
  setGPUTime(time: number): void {
    if (!this.enabled) return;
    this.gpuTime = time;
  }

  /** 开始录制事件流(events 数组开始累积)。 */
  startRecording(): void {
    this.isRecording = true;
  }

  /** 停止录制事件流。 */
  stopRecording(): void {
    this.isRecording = false;
  }

  /** 获取当前 FPS。 */
  getFPS(): number {
    return this.fps;
  }

  /** 获取最近一帧的帧耗时(ms)。 */
  getFrameTime(): number {
    return this.frameTime;
  }

  /** 获取平均帧耗时(ms)。 */
  getAvgFrameTime(): number {
    return this.avgFrameTime;
  }

  /** 获取帧时间历史曲线(ms,老→新)。返回拷贝。 */
  getFrameTimeHistory(): number[] {
    return this.frameTimeHistory.slice();
  }

  /** 获取 FPS 历史曲线(老→新)。返回拷贝。 */
  getFPSHistory(): number[] {
    return this.fpsHistory.slice();
  }

  /** 获取所有区域统计(Map 拷贝)。 */
  getZones(): Map<string, ProfileZone> {
    return new Map(this.zones);
  }

  /** 获取指定区域统计。不存在返回 undefined。 */
  getZone(name: string): ProfileZone | undefined {
    return this.zones.get(name);
  }

  /** 获取录制中的事件流(拷贝)。 */
  getEvents(): ProfileEvent[] {
    return this.events.slice();
  }

  /** 获取完整统计快照。 */
  getStats(): ProfilerStats {
    return {
      enabled: this.enabled,
      isRecording: this.isRecording,
      frameCount: this.frameCount,
      fps: this.fps,
      frameTime: this.frameTime,
      avgFrameTime: this.avgFrameTime,
      minFrameTime: this.minFrameTime === Infinity ? 0 : this.minFrameTime,
      maxFrameTime: this.maxFrameTime,
      cpuTime: this.cpuTime,
      gpuTime: this.gpuTime,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      vertices: this.vertices,
      memoryUsage: { ...this.memoryUsage },
      zoneCount: this.zones.size,
      eventCount: this.events.length,
    };
  }

  /**
   * 清空录制数据(events / zones / openZones),保留帧级历史与统计。
   * 用于长会话中定期清理录制缓冲。
   */
  clear(): void {
    this.events = [];
    this.zones = new Map();
    this.openZones = [];
  }

  /**
   * 重置全部状态:帧统计 + 历史 + zones + events + openZones。
   * 等同于「新建一个 Profiler2 但保留 maxHistorySize / enabled 配置」。
   */
  reset(): void {
    this.frameStartTime = 0;
    this.frameEndTime = 0;
    this.frameTime = 0;
    this.minFrameTime = Infinity;
    this.maxFrameTime = 0;
    this.avgFrameTime = 0;
    this.frameCount = 0;
    this.fps = 0;
    this.fpsHistory = [];
    this.frameTimeHistory = [];
    this.cpuTime = 0;
    this.gpuTime = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.vertices = 0;
    this.memoryUsage = { used: 0, total: 0 };
    this.events = [];
    this.zones = new Map();
    this.openZones = [];
    this.frameTimeSum = 0;
    this.lastFrameEndMs = 0;
    this.isRecording = false;
  }

  /**
   * 导出为 Chrome Trace 格式 JSON(chrome://tracing 可直接加载)。
   *
   * 包含:
   *   - 进程/线程元数据事件(ph='M')
   *   - 每个 zone 作为完整事件(ph='X',ts/dur 单位 μs)
   *   - 每个 recordEvent 作为完整事件(ph='X')
   *
   * 注意:Chrome Trace 时间戳单位为微秒(μs),本类内部用 ms,导出时 ×1000。
   * ts 相对基准为第一个事件的 startTime(若 events 为空则为 0)。
   */
  exportTrace(): ChromeTrace {
    const events: ChromeTraceEvent[] = [];

    // 进程/线程元数据
    events.push({
      name: 'process_name',
      cat: '__metadata',
      ph: 'M',
      ts: 0,
      pid: this.pid,
      tid: this.tid,
      args: { name: 'vreen-engine' },
    });
    events.push({
      name: 'thread_name',
      cat: '__metadata',
      ph: 'M',
      ts: 0,
      pid: this.pid,
      tid: this.tid,
      args: { name: 'main' },
    });

    // 计算 ts 基准(取所有事件 startTime 的最小值)
    let baseMs = Infinity;
    for (const e of this.events) {
      if (e.startTime < baseMs) baseMs = e.startTime;
    }
    if (baseMs === Infinity) baseMs = 0;

    // 输出事件流为 X(完整)事件
    for (const e of this.events) {
      events.push({
        name: e.name,
        cat: CATEGORY_STR[e.category],
        ph: 'X',
        ts: Math.round((e.startTime - baseMs) * 1000),
        dur: Math.round(e.duration * 1000),
        pid: this.pid,
        tid: this.tid,
        args: e.color ? { color: e.color } : undefined,
      });
    }

    return { traceEvents: events };
  }

  /** 导出为 JSON 字符串(便于写入文件)。 */
  toJSON(): ChromeTrace {
    return this.exportTrace();
  }
}

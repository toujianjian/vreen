// Tools barrel — 性能分析工具家族。
//
// - `Profiler`                — 早期 ring-buffer 帧分析器(带 mark / GPU query 集成)。
// - `Profiler2`               — 增强版帧/区域/事件分析器(Chrome Trace 导出 + FPS 曲线)。
// - `FrameProfiler`           — 帧级 FPS / draw calls / triangles 聚合。
// - `SystemProfiler`          — ECS 系统耗时跟踪。
// - `MemoryTracker`           — 引擎显式分配 / 释放跟踪与泄漏检测。
// - `GpuProfiler`             — GPU timer query 封装(EXT_disjoint_timer_query_webgl2)。
// - `PerformanceReport`       — 汇总生成文本 / JSON 报告。
// - `LODManager`              — LOD 管理系统(距离 LOD / 屏幕占比 LOD / HLOD)。
// - `ConsoleCommands`         — 编辑器控制台命令系统(注册/执行/补全/历史)。

export { Profiler, type FrameSample, type ProfilerMark, type DrawCallSample } from './Profiler';
export {
  Profiler2,
  type ProfileCategory,
  type ProfileEvent,
  type ProfileZone,
  type MemoryUsage as ProfilerMemoryUsage,
  type Profiler2Options,
  type ProfilerStats,
  type ChromeTraceEvent,
  type ChromeTrace,
} from './Profiler2';
export {
  FrameProfiler,
  type FrameSample as FrameProfilerSample,
  type FrameMetrics,
  type FrameStats,
} from './FrameProfiler';
export { SystemProfiler, type SystemTiming } from './SystemProfiler';
export {
  MemoryTracker,
  type AllocationRecord,
  type MemorySummary,
} from './MemoryTracker';
export { GpuProfiler, type GpuQuery } from './GpuProfiler';
export { PerformanceReport, type PerformanceReportJson } from './PerformanceReport';
export {
  LODManager,
  type LODGroup,
  type LODLevel,
  type LODStats,
} from './LODManager';
export {
  ConsoleCommands,
  getDefaultConsoleCommands,
  resetDefaultConsoleCommands,
  type ConsoleCommand,
  type ConsoleArg,
  type ConsoleArgType,
  type ConsoleCommandCategory,
  type AutoCompleteSuggestion,
  type HelpEntry,
  type GroupedHelp,
  type ConsoleCommandsStats,
  type ExecuteResult,
  type ParsedArgValue,
} from './ConsoleCommands';

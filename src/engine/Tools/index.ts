// Tools barrel — 性能分析工具家族。
//
// - `Profiler`                — 早期 ring-buffer 帧分析器(带 mark / GPU query 集成)。
// - `FrameProfiler`           — 帧级 FPS / draw calls / triangles 聚合。
// - `SystemProfiler`          — ECS 系统耗时跟踪。
// - `MemoryTracker`           — 引擎显式分配 / 释放跟踪与泄漏检测。
// - `GpuProfiler`             — GPU timer query 封装(EXT_disjoint_timer_query_webgl2)。
// - `PerformanceReport`       — 汇总生成文本 / JSON 报告。
// - `LODManager`              — LOD 管理系统(距离 LOD / 屏幕占比 LOD / HLOD)。

export { Profiler, type FrameSample, type ProfilerMark, type DrawCallSample } from './Profiler';
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

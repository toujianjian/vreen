// PerformanceReport — 性能报告生成器。
//
// 设计目标:
//   - 汇总 FrameProfiler / SystemProfiler / MemoryTracker 的当前状态,
//     生成可读的文本报告或 JSON 报告。
//   - 不持有 profiler 引用,每次调用显式传入,便于跨实例复用。
//   - 文本报告面向日志 / HUD 显示;JSON 报告面向导出 / 自动化分析。
//
// 用法:
//   const report = PerformanceReport.generate(fp, sp, mt);
//   console.log(report);
//   const json = PerformanceReport.toJSON(fp, sp, mt);

import type { FrameProfiler, FrameMetrics } from './FrameProfiler';
import type { SystemProfiler, SystemTiming } from './SystemProfiler';
import type { MemoryTracker, MemorySummary } from './MemoryTracker';

export interface PerformanceReportJson {
  generatedAt: number;
  frame: FrameMetrics;
  systems: SystemTiming[];
  memory: MemorySummary;
  slowestSystems: SystemTiming[];
}

export class PerformanceReport {
  /**
   * 生成文本报告字符串。
   * @param fp 帧级分析器(可空,跳过帧段)
   * @param sp 系统级分析器(可空,跳过系统段)
   * @param mt 内存跟踪器(可空,跳过内存段)
   */
  static generate(
    fp?: FrameProfiler,
    sp?: SystemProfiler,
    mt?: MemoryTracker,
  ): string {
    const lines: string[] = [];
    lines.push('===== VREEN Performance Report =====');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    if (fp) {
      const m = fp.getMetrics();
      lines.push('--- Frame ---');
      lines.push(`  current FPS : ${m.currentFPS.toFixed(1)}`);
      lines.push(`  avg FPS     : ${m.avgFPS.toFixed(1)}`);
      lines.push(`  min FPS     : ${m.minFPS.toFixed(1)}`);
      lines.push(`  max FPS     : ${m.maxFPS.toFixed(1)}`);
      lines.push(`  frame time  : ${m.frameTimeMs.toFixed(2)} ms`);
      lines.push(`  draw calls  : ${m.drawCalls}`);
      lines.push(`  triangles   : ${m.triangles}`);
      lines.push(`  vertices    : ${m.vertices}`);
      lines.push(`  memory      : ${m.memoryMB.toFixed(1)} MB`);
      lines.push(`  samples     : ${m.sampleCount}`);
      lines.push('');
    }

    if (sp) {
      const all = sp.getAllTimings();
      lines.push(`--- Systems (${all.length}) ---`);
      if (all.length === 0) {
        lines.push('  (no samples)');
      } else {
        lines.push('  name                        calls      total(ms)    avg(ms)    max(ms)    last(ms)');
        for (const t of all) {
          lines.push(
            `  ${t.name.padEnd(26)}  ${String(t.callCount).padStart(6)}  ${t.totalTime.toFixed(3).padStart(11)}  ${t.avgTime.toFixed(4).padStart(9)}  ${t.maxTime.toFixed(4).padStart(9)}  ${t.lastTime.toFixed(4).padStart(9)}`,
          );
        }
      }
      lines.push('');
    }

    if (mt) {
      const s = mt.getSummary();
      lines.push('--- Memory ---');
      lines.push(`  active count   : ${s.activeCount}`);
      lines.push(`  total allocated: ${s.totalAllocated} bytes`);
      lines.push(`  total freed    : ${s.totalFreed} bytes`);
      lines.push(`  active bytes   : ${s.activeBytes} bytes`);
      lines.push(`  active MB      : ${s.activeMB.toFixed(3)}`);
      const types = Object.keys(s.byType);
      if (types.length > 0) {
        lines.push('  by type:');
        for (const t of types) {
          const g = s.byType[t];
          lines.push(`    ${t.padEnd(20)} count=${g.count}  bytes=${g.bytes}`);
        }
      }
      lines.push('');
    }

    lines.push('===== End Report =====');
    return lines.join('\n');
  }

  /**
   * 生成 JSON 报告。
   * 字段与文本报告对齐,便于程序化分析。
   */
  static toJSON(
    fp?: FrameProfiler,
    sp?: SystemProfiler,
    mt?: MemoryTracker,
  ): PerformanceReportJson {
    return {
      generatedAt: Date.now(),
      frame: fp ? fp.getMetrics() : emptyFrameMetrics(),
      systems: sp ? sp.getAllTimings() : [],
      memory: mt ? mt.getSummary() : emptyMemorySummary(),
      slowestSystems: sp ? sp.getSlowestSystems(5) : [],
    };
  }
}

function emptyFrameMetrics(): FrameMetrics {
  return {
    currentFPS: 0,
    avgFPS: 0,
    minFPS: 0,
    maxFPS: 0,
    frameTimeMs: 0,
    drawCalls: 0,
    triangles: 0,
    vertices: 0,
    memoryMB: 0,
    sampleCount: 0,
  };
}

function emptyMemorySummary(): MemorySummary {
  return {
    activeCount: 0,
    totalAllocated: 0,
    totalFreed: 0,
    activeBytes: 0,
    activeMB: 0,
    byType: {},
  };
}

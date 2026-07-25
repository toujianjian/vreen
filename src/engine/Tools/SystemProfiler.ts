// SystemProfiler — ECS 系统级性能分析器。
//
// 设计目标:
//   - 跟踪每个 ECS System 的 `update(world, dt)` 耗时。
//   - 通过 `begin(name)` / `end(name)` 钩子手动埋点,与 World 解耦。
//   - 维护调用次数、累计 / 平均 / 最大 / 最近一次耗时。
//   - `getSlowestSystems(count)` 返回最慢的系统,便于定位热点。
//
// 用法:
//   const sp = new SystemProfiler();
//   for (const sys of world.systems) {
//     sp.begin(sys.name);
//     sys.update(world, dt);
//     sp.end(sys.name);
//   }
//   const slow = sp.getSlowestSystems(5);

/** 单个系统的耗时统计。 */
export interface SystemTiming {
  /** 系统名(World.systems[i].name 或手动传入) */
  name: string;
  /** 累计耗时(ms) */
  totalTime: number;
  /** 调用次数 */
  callCount: number;
  /** 平均耗时(ms,= totalTime / callCount) */
  avgTime: number;
  /** 历史最大单次耗时(ms) */
  maxTime: number;
  /** 最近一次耗时(ms) */
  lastTime: number;
}

export class SystemProfiler {
  /** 系统名 → 计时记录。 */
  readonly timings: Map<string, SystemTiming> = new Map();

  /** 当前正在计时的系统名栈(支持嵌套 begin)。 */
  private openStack: { name: string; startMs: number }[] = [];

  /** 开始计时 `name` 系统。可嵌套。 */
  begin(name: string): void {
    this.openStack.push({ name, startMs: performance.now() });
  }

  /** 结束最近一次 `name` 系统的计时。若栈顶 name 不匹配则忽略。 */
  end(name: string): void {
    // 从栈顶向下查找匹配的 name(容错乱序)
    for (let i = this.openStack.length - 1; i >= 0; i--) {
      if (this.openStack[i].name === name) {
        const { startMs } = this.openStack[i];
        this.openStack.splice(i, 1);
        const elapsed = performance.now() - startMs;
        this.record(name, elapsed);
        return;
      }
    }
    // 未匹配则忽略,避免抛错打断主循环
  }

  /** 获取 `name` 系统的计时记录;不存在返回 undefined。 */
  getTiming(name: string): SystemTiming | undefined {
    return this.timings.get(name);
  }

  /** 获取所有系统计时记录(按 totalTime 降序)。 */
  getAllTimings(): SystemTiming[] {
    return Array.from(this.timings.values()).sort((a, b) => b.totalTime - a.totalTime);
  }

  /**
   * 返回最慢的 `count` 个系统(按 avgTime 降序)。
   * `count <= 0` 返回空数组;`count` 超过样本数返回全部。
   */
  getSlowestSystems(count: number = 5): SystemTiming[] {
    if (count <= 0) return [];
    return Array.from(this.timings.values())
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, count);
  }

  /** 清空所有计时记录与开栈。 */
  reset(): void {
    this.timings.clear();
    this.openStack.length = 0;
  }

  // ---- 内部 ----

  private record(name: string, elapsedMs: number): void {
    const existing = this.timings.get(name);
    if (existing) {
      existing.totalTime += elapsedMs;
      existing.callCount += 1;
      existing.avgTime = existing.totalTime / existing.callCount;
      existing.lastTime = elapsedMs;
      if (elapsedMs > existing.maxTime) existing.maxTime = elapsedMs;
    } else {
      this.timings.set(name, {
        name,
        totalTime: elapsedMs,
        callCount: 1,
        avgTime: elapsedMs,
        maxTime: elapsedMs,
        lastTime: elapsedMs,
      });
    }
  }
}

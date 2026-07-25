// MemoryTracker — 内存分配跟踪器。
//
// 设计目标:
//   - 跟踪引擎内部显式分配的 GPU / CPU 资源(Buffer、Texture、Geometry 等)。
//   - 通过 `track(type, size)` 记录分配,返回唯一 id;`untrack(id)` 记录释放。
//   - 维护 allocations 列表与总分配 / 释放字节数。
//   - `getLeaks()` 返回分配未释放的疑似泄漏记录。
//
// 注意:这不是 JS heap profiler — JS GC 由 V8 管理。本类只跟踪引擎显式
// 管理的资源(如 WebGLBuffer / WebGLTexture / typed-array 缓存等),用于
// 定位"分配后忘记释放"的逻辑漏洞。

/** 单条分配记录。 */
export interface AllocationRecord {
  /** 唯一 id(由 `track` 返回,可用于 `untrack`) */
  id: number;
  /** 资源类型标签(如 "BufferGeometry" / "Texture" / "ArrayBuffer") */
  type: string;
  /** 字节大小 */
  size: number;
  /** 分配时间戳(performance.now, ms) */
  time: number;
  /** 简化的调用栈字符串(可选,用于定位泄漏源) */
  stack?: string;
}

/** 内存摘要。 */
export interface MemorySummary {
  /** 当前活跃分配数 */
  activeCount: number;
  /** 累计分配字节数 */
  totalAllocated: number;
  /** 累计释放字节数 */
  totalFreed: number;
  /** 当前活跃字节数(= totalAllocated - totalFreed) */
  activeBytes: number;
  /** 活跃字节数(MB) */
  activeMB: number;
  /** 按类型分组的活跃字节数 */
  byType: Record<string, { count: number; bytes: number }>;
}

export class MemoryTracker {
  /** 当前所有活跃分配记录(id → record)。 */
  readonly allocations: AllocationRecord[] = [];
  /** 累计分配字节数。 */
  totalAllocated: number = 0;
  /** 累计释放字节数。 */
  totalFreed: number = 0;

  private nextId: number = 1;
  /** id → 在 allocations 数组中的索引,用于 O(1) 释放。 */
  private idIndex: Map<number, number> = new Map();

  /**
   * 记录一次分配。
   * @param type 资源类型标签
   * @param size 字节大小
   * @param stack 可选调用栈字符串
   * @returns 分配 id,用于后续 `untrack`
   */
  track(type: string, size: number, stack?: string): number {
    const id = this.nextId++;
    const record: AllocationRecord = {
      id,
      type,
      size,
      time: performance.now(),
      stack,
    };
    this.idIndex.set(id, this.allocations.length);
    this.allocations.push(record);
    this.totalAllocated += size;
    return id;
  }

  /**
   * 记录一次释放。返回是否找到对应分配。
   * 找到后将该记录从 `allocations` 中移除(保持索引一致性)。
   */
  untrack(id: number): boolean {
    const idx = this.idIndex.get(id);
    if (idx === undefined) return false;
    const record = this.allocations[idx];
    this.totalFreed += record.size;
    // 用末尾元素填补空洞,保持 O(1) 删除
    const last = this.allocations.length - 1;
    if (idx !== last) {
      const moved = this.allocations[last];
      this.allocations[idx] = moved;
      this.idIndex.set(moved.id, idx);
    }
    this.allocations.pop();
    this.idIndex.delete(id);
    return true;
  }

  /** 返回当前内存摘要。 */
  getSummary(): MemorySummary {
    const byType: Record<string, { count: number; bytes: number }> = {};
    for (const r of this.allocations) {
      if (!byType[r.type]) byType[r.type] = { count: 0, bytes: 0 };
      byType[r.type].count += 1;
      byType[r.type].bytes += r.size;
    }
    const activeBytes = this.totalAllocated - this.totalFreed;
    return {
      activeCount: this.allocations.length,
      totalAllocated: this.totalAllocated,
      totalFreed: this.totalFreed,
      activeBytes,
      activeMB: activeBytes / (1024 * 1024),
      byType,
    };
  }

  /**
   * 返回疑似泄漏(分配未释放)的记录。
   * 可按 `minAgeMs` 过滤"分配时间距今超过 N ms 仍未释放"的记录,
   * 默认 0 表示返回所有活跃分配。
   */
  getLeaks(minAgeMs: number = 0): AllocationRecord[] {
    if (minAgeMs <= 0) return this.allocations.slice();
    const now = performance.now();
    return this.allocations.filter((r) => now - r.time >= minAgeMs);
  }

  /** 清空所有记录与计数器。 */
  reset(): void {
    this.allocations.length = 0;
    this.idIndex.clear();
    this.totalAllocated = 0;
    this.totalFreed = 0;
    this.nextId = 1;
  }
}

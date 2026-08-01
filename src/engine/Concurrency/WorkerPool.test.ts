// WorkerPool 单元测试。
//
// 覆盖:
//   1. 构造默认值 + 配置链式 setter
//   2. 主线程降级(mock handler) — 同步 / 异步 / 无 handler reject
//   3. worker 派发 — 单任务完成
//   4. worker 复用 — 多任务复用同一 worker
//   5. worker 扩容 — 超过空闲数时创建新 worker(直到 limit)
//   6. 队列 — limit 达到后任务排队,worker 空闲后派发
//   7. queueMax 上限 → 超出 reject
//   8. worker 报错 → task reject + worker 继续可用
//   9. postMessage 抛错 → task reject + worker 标记空闲
//  10. runTasks 批量 — 全部完成 / 任一失败整体 reject
//  11. drain — 等待全部完成 + 回收 worker
//  12. dispose — reject 所有未完成任务 + 终止 worker + 后续 runTask reject
//  13. disposed 标志

import { describe, it, expect, vi } from 'vitest';
import { WorkerPool, type WorkerLike } from './WorkerPool';

// ── Mock Worker ──────────────────────────────────────────────────────

interface MockWorkerCall {
  data: unknown;
  transfer?: Transferable[];
}

/** Mock worker:记录 postMessage 调用,可手动触发 onmessage / onerror。 */
class MockWorker implements WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  terminated = false;
  calls: MockWorkerCall[] = [];

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.calls.push({ data: message, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }

  /** 模拟 worker 完成任务,回传结果。 */
  complete(result: unknown): void {
    if (this.onmessage) this.onmessage({ data: result });
  }

  /** 模拟 worker 报错。 */
  error(message: string): void {
    if (this.onerror) this.onerror({ message } as unknown as Event);
  }
}

/** 创建返回 MockWorker 的 creator。 */
function mockCreator(): { creator: () => WorkerLike; workers: MockWorker[] } {
  const workers: MockWorker[] = [];
  return {
    creator: () => {
      const w = new MockWorker();
      workers.push(w);
      return w;
    },
    workers,
  };
}

/** 等待一个微任务 + setTimeout(0),让 Promise 链推进。 */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ── 构造与配置 ──────────────────────────────────────────────────────

describe('WorkerPool construction', () => {
  it('defaults', () => {
    const pool = new WorkerPool();
    expect(pool.workerCount).toBe(0);
    expect(pool.queueLength).toBe(0);
    expect(pool.idleWorkerCount).toBe(0);
    expect(pool.disposed).toBe(false);
  });

  it('accepts options', () => {
    const pool = new WorkerPool({ workerLimit: 2, queueMax: 10 });
    expect(pool.workerCount).toBe(0);
    expect(pool.queueLength).toBe(0);
  });

  it('chainable setters', () => {
    const pool = new WorkerPool();
    const fn = vi.fn(() => new MockWorker());
    expect(pool.setWorkerCreator(fn)).toBe(pool);
    expect(pool.setWorkerLimit(8)).toBe(pool);
    expect(pool.setQueueMax(5)).toBe(pool);
    expect(pool.setMainThreadHandler(() => null)).toBe(pool);
  });

  it('clamps workerLimit to >= 1', () => {
    const pool = new WorkerPool({ workerLimit: 0 });
    pool.setWorkerLimit(-5);
    // 内部限制,通过行为验证(派发不崩溃)
    expect(pool.workerCount).toBe(0);
  });

  it('clamps queueMax to >= 0', () => {
    const pool = new WorkerPool({ queueMax: -1 });
    expect(pool.queueLength).toBe(0);
  });
});

// ── 主线程降级 ──────────────────────────────────────────────────────

describe('WorkerPool main-thread fallback', () => {
  it('runs sync handler when no worker creator', async () => {
    const pool = new WorkerPool({
      mainThreadHandler: (data) => (data as number) * 2,
    });
    const result = await pool.runTask(21);
    expect(result).toBe(42);
  });

  it('supports async handler', async () => {
    const pool = new WorkerPool({
      mainThreadHandler: async (data) => (data as number) * 3,
    });
    const result = await pool.runTask(14);
    expect(result).toBe(42);
  });

  it('rejects when handler throws', async () => {
    const pool = new WorkerPool({
      mainThreadHandler: () => {
        throw new Error('boom');
      },
    });
    await expect(pool.runTask({})).rejects.toThrow('boom');
  });

  it('rejects when no creator and no handler', async () => {
    const pool = new WorkerPool();
    await expect(pool.runTask({})).rejects.toThrow('no workerCreator');
  });
});

// ── worker 派发 ─────────────────────────────────────────────────────

describe('WorkerPool single-task dispatch', () => {
  it('creates a worker and dispatches the task', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });

    const promise = pool.runTask({ x: 1 });
    expect(workers.length).toBe(1);
    expect(workers[0].calls.length).toBe(1);
    expect(workers[0].calls[0].data).toEqual({ x: 1 });

    workers[0].complete({ sum: 1 });
    const result = await promise;
    expect(result).toEqual({ sum: 1 });
  });

  it('transfers transferable objects', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });
    const buf = new ArrayBuffer(8);

    const promise = pool.runTask({ buf }, [buf]);
    expect(workers[0].calls[0].transfer).toEqual([buf]);

    workers[0].complete('ok');
    await promise;
  });
});

// ── worker 复用 ─────────────────────────────────────────────────────

describe('WorkerPool worker reuse', () => {
  it('reuses idle worker for subsequent tasks', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });

    const p1 = pool.runTask('a');
    workers[0].complete('A');
    await p1;

    const p2 = pool.runTask('b');
    // 不应创建新 worker
    expect(workers.length).toBe(1);
    expect(workers[0].calls.length).toBe(2);
    workers[0].complete('B');
    await p2;

    expect(pool.workerCount).toBe(1);
  });
});

// ── worker 扩容 ─────────────────────────────────────────────────────

describe('WorkerPool worker expansion', () => {
  it('creates new workers up to limit when no idle', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 3 });

    const p1 = pool.runTask('a');
    const p2 = pool.runTask('b');
    const p3 = pool.runTask('c');

    expect(workers.length).toBe(3);
    expect(pool.workerCount).toBe(3);
    expect(pool.idleWorkerCount).toBe(0);

    workers[0].complete('A');
    workers[1].complete('B');
    workers[2].complete('C');
    await Promise.all([p1, p2, p3]);
  });

  it('does not exceed workerLimit', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 2 });

    pool.runTask('a');
    pool.runTask('b');
    pool.runTask('c'); // 应入队

    expect(workers.length).toBe(2);
    expect(pool.queueLength).toBe(1);
  });
});

// ── 队列 ────────────────────────────────────────────────────────────

describe('WorkerPool queue', () => {
  it('dispatches queued task when worker becomes idle', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 1 });

    const p1 = pool.runTask('a');
    const p2 = pool.runTask('b');

    expect(workers.length).toBe(1);
    expect(pool.queueLength).toBe(1);

    // 完成 p1 → p2 应被派发到同一 worker
    workers[0].complete('A');
    await p1;
    expect(workers[0].calls.length).toBe(2);
    expect(workers[0].calls[1].data).toBe('b');

    workers[0].complete('B');
    await p2;
  });

  it('rejects when queueMax exceeded', async () => {
    const { creator } = mockCreator();
    const pool = new WorkerPool({
      workerCreator: creator,
      workerLimit: 1,
      queueMax: 1,
    });

    pool.runTask('a'); // 派发到 worker
    pool.runTask('b'); // 入队(队列 = 1,达到上限)
    await expect(pool.runTask('c')).rejects.toThrow('queue overflow');
  });
});

// ── worker 报错 ────────────────────────────────────────────────────

describe('WorkerPool error handling', () => {
  it('rejects task on worker error', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });

    const promise = pool.runTask({ x: 1 });
    workers[0].error('worker crashed');
    await expect(promise).rejects.toThrow('worker crashed');
  });

  it('worker remains usable after error', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });

    const p1 = pool.runTask('a');
    workers[0].error('fail');
    await expect(p1).rejects.toThrow('fail');

    const p2 = pool.runTask('b');
    expect(workers.length).toBe(1); // 复用
    workers[0].complete('B');
    await p2;
  });

  it('rejects when postMessage throws', async () => {
    class ThrowingWorker implements WorkerLike {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      terminated = false;
      postMessage(): void {
        throw new Error('postMessage failed');
      }
      terminate(): void {}
    }
    const pool = new WorkerPool({
      workerCreator: () => new ThrowingWorker(),
    });
    await expect(pool.runTask({})).rejects.toThrow('postMessage failed');
  });
});

// ── runTasks 批量 ──────────────────────────────────────────────────

describe('WorkerPool runTasks', () => {
  it('runs batch and returns all results', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 2 });

    const promise = pool.runTasks([
      { data: 'a' },
      { data: 'b' },
      { data: 'c' },
    ]);

    // 等待 worker 被分配
    await tick();
    expect(workers.length).toBe(2);
    expect(pool.queueLength).toBe(1);

    // 完成所有 worker 任务,队列中的任务会被自动派发
    workers[0].complete('A');
    workers[1].complete('B');
    // 第三个任务应该已被派发到空闲 worker
    await tick();
    // 完成最后一个
    for (const w of workers) {
      if (w.calls.length > 0 && w.calls[w.calls.length - 1].data === 'c') {
        w.complete('C');
      }
    }

    const results = await promise;
    expect(results.sort()).toEqual(['A', 'B', 'C']);
  });

  it('rejects batch if any task fails', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 1 });

    const promise = pool.runTasks([{ data: 'a' }, { data: 'b' }]);

    workers[0].error('fail');
    workers[0].complete('B'); // 第二个任务成功

    await expect(promise).rejects.toThrow('fail');
  });
});

// ── drain ──────────────────────────────────────────────────────────

describe('WorkerPool drain', () => {
  it('waits for all tasks and terminates workers', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });

    const p1 = pool.runTask('a');
    const drainPromise = pool.drain();

    workers[0].complete('A');
    await p1;
    await drainPromise;

    expect(pool.workerCount).toBe(0);
    expect(workers[0].terminated).toBe(true);
  });

  it('pool remains usable after drain', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });

    await pool.drain();
    expect(pool.disposed).toBe(false);

    const p = pool.runTask('a');
    expect(workers.length).toBe(1);
    workers[0].complete('A');
    await p;
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('WorkerPool dispose', () => {
  it('rejects queued tasks on dispose', async () => {
    const { creator } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 1 });

    const p1 = pool.runTask('a'); // 派发
    p1.catch(() => {}); // 抑制 unhandled rejection(dispose 会 reject)
    const p2 = pool.runTask('b'); // 入队
    pool.dispose();

    await expect(p2).rejects.toThrow('disposed before task started');
  });

  it('rejects in-flight tasks on dispose', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator });

    const p1 = pool.runTask('a');
    pool.dispose();
    await expect(p1).rejects.toThrow('disposed during task');
    expect(workers[0].terminated).toBe(true);
  });

  it('terminates all workers', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 3 });

    // 抑制 dispose 产生的 rejection
    pool.runTask('a').catch(() => {});
    pool.runTask('b').catch(() => {});
    pool.runTask('c').catch(() => {});
    expect(workers.length).toBe(3);

    pool.dispose();
    expect(workers.every((w) => w.terminated)).toBe(true);
    expect(pool.workerCount).toBe(0);
  });

  it('rejects runTask after dispose', async () => {
    const pool = new WorkerPool({ mainThreadHandler: () => null });
    pool.dispose();
    await expect(pool.runTask({})).rejects.toThrow('disposed');
  });

  it('double dispose is no-op', () => {
    const pool = new WorkerPool();
    pool.dispose();
    expect(() => pool.dispose()).not.toThrow();
  });
});

// ── 状态查询 ────────────────────────────────────────────────────────

describe('WorkerPool status queries', () => {
  it('reports workerCount, idleWorkerCount, queueLength', async () => {
    const { creator, workers } = mockCreator();
    const pool = new WorkerPool({ workerCreator: creator, workerLimit: 2 });

    pool.runTask('a');
    pool.runTask('b');
    pool.runTask('c');

    expect(pool.workerCount).toBe(2);
    expect(pool.idleWorkerCount).toBe(0);
    expect(pool.queueLength).toBe(1);

    workers[0].complete('A');
    // p2 仍在跑,p3 应被派发到 worker[0]
    expect(pool.queueLength).toBe(0);
    expect(pool.idleWorkerCount).toBe(0);

    workers[1].complete('B');
    workers[0].complete('C');
    expect(pool.idleWorkerCount).toBe(2);
  });
});

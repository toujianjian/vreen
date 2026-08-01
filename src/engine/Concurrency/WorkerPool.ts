// WorkerPool — Web Worker 池管理器 (并行任务调度)。
//
// 适配 three.js `examples/jsm/utils/WorkerPool.js` 并重构为 TypeScript-first:
//   - Promise 化 API(three.js 原版是回调式,这里统一返回 Promise)
//   - 泛型 worker 接口(不绑定具体 Worker 构造,便于 Node 测试 / 自定义 worker)
//   - 任务队列 + 工作线程复用 + 引用计数 + 自动回收
//   - Transferable 对象支持(零拷贝传输 ArrayBuffer)
//   - 优雅降级:无 worker creator 时,任务在主线程同步执行(mock 模式)
//
// 用途:
//   - KTX2 / Basis 纹理压缩(多线程编码)
//   - GLB / Draco 几何解码
//   - 寻路 / NavMesh 构建
//   - 物理求解 / 粒子模拟分块
//   - 图像处理 / 后处理分块
//
// 不变量:
//   - 同一 worker 同一时刻只处理一个任务;
//   - 任务按 FIFO 顺序派发,空闲 worker 优先复用;
//   - dispose() 后所有未完成任务立即 reject,worker 被终止;
//   - workerLimit >= 1,queueMax >= 0;
//   - 无 creator 时(runTask 回退主线程)忽略 workerLimit。
//
// 参考:
//   - three.js examples/jsm/utils/WorkerPool.js
//   - o3de Job System (AZ::JobSystem)

/** Worker-like 接口:只要支持 postMessage + onmessage + onerror + terminate 即可。 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  terminate(): void;
}

/** Worker 创建器:返回一个 WorkerLike 实例。 */
export type WorkerCreator = () => WorkerLike;

/** 单个任务描述。 */
interface PoolTask {
  /** 自增 ID(调试用)。 */
  id: number;
  /** 任务数据(传给 worker.postMessage)。 */
  data: unknown;
  /** 可转移对象列表(零拷贝)。 */
  transfer?: Transferable[];
  /** 完成 promise 的 resolve。 */
  resolve: (value: unknown) => void;
  /** 完成 promise 的 reject。 */
  reject: (error: Error) => void;
}

/** 已分配的 worker 运行时状态。 */
interface WorkerSlot {
  worker: WorkerLike;
  /** 当前正在执行的任务(null = 空闲)。 */
  current: PoolTask | null;
  /** 引用计数(addWorkerOnRun 模式下用于决定是否回收)。 */
  refCount: number;
  /** 是否已终止。 */
  terminated: boolean;
}

/** WorkerPool 配置。 */
export interface WorkerPoolOptions {
  /** Worker 创建器。若不提供,任务在主线程同步执行(mock 模式)。 */
  workerCreator?: WorkerCreator;
  /** 最大 worker 数。默认 navigator.hardwareConcurrency 或 4。 */
  workerLimit?: number;
  /** 队列上限(超出时拒绝新任务)。默认 0 = 无限。 */
  queueMax?: number;
  /** 主线程 mock 处理器(无 creator 时使用)。 */
  mainThreadHandler?: (data: unknown) => unknown;
}

const _nextTaskId = (() => {
  let id = 0;
  return () => ++id;
})();

/** 推测硬件并发数(Web 环境)。 */
function detectHardwareConcurrency(): number {
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    return navigator.hardwareConcurrency;
  }
  return 4;
}

/**
 * Worker 池管理器。
 *
 * @example
 * ```ts
 * const pool = new WorkerPool({
 *   workerCreator: () => new Worker(new URL('./worker.ts', import.meta.url)),
 *   workerLimit: 4,
 * });
 * const result = await pool.runTask({ type: 'decode', buffer });
 * await pool.dispose();
 * ```
 */
export class WorkerPool {
  private _creator: WorkerCreator | null = null;
  private _workerLimit: number;
  private _queueMax: number;
  private _mainThreadHandler: ((data: unknown) => unknown) | null;

  /** 活跃 worker 槽位。 */
  private _workers: WorkerSlot[] = [];
  /** 等待派发的任务队列(FIFO)。 */
  private _queue: PoolTask[] = [];
  /** 是否已 dispose。 */
  private _disposed = false;

  constructor(opts: WorkerPoolOptions = {}) {
    if (opts.workerCreator) this._creator = opts.workerCreator;
    this._workerLimit = opts.workerLimit ?? detectHardwareConcurrency();
    this._queueMax = opts.queueMax ?? 0;
    this._mainThreadHandler = opts.mainThreadHandler ?? null;
    if (this._workerLimit < 1) this._workerLimit = 1;
    if (this._queueMax < 0) this._queueMax = 0;
  }

  // ── 配置 ──────────────────────────────────────────────────────────

  /** 设置 worker 创建器。 */
  setWorkerCreator(creator: WorkerCreator): this {
    this._creator = creator;
    return this;
  }

  /** 设置最大 worker 数。已存在的 worker 不受影响(直到自然回收)。 */
  setWorkerLimit(limit: number): this {
    if (limit < 1) limit = 1;
    this._workerLimit = limit;
    return this;
  }

  /** 设置队列上限。 */
  setQueueMax(max: number): this {
    if (max < 0) max = 0;
    this._queueMax = max;
    return this;
  }

  /** 设置主线程处理器(无 creator 时使用)。 */
  setMainThreadHandler(handler: (data: unknown) => unknown): this {
    this._mainThreadHandler = handler;
    return this;
  }

  // ── 状态查询 ──────────────────────────────────────────────────────

  /** 当前活跃 worker 总数(含空闲)。 */
  get workerCount(): number {
    return this._workers.length;
  }

  /** 空闲 worker 数。 */
  get idleWorkerCount(): number {
    return this._workers.reduce((n, s) => n + (s.current === null ? 1 : 0), 0);
  }

  /** 等待队列长度。 */
  get queueLength(): number {
    return this._queue.length;
  }

  /** 是否已 dispose。 */
  get disposed(): boolean {
    return this._disposed;
  }

  // ── 任务执行 ──────────────────────────────────────────────────────

  /**
   * 派发一个任务到 worker 池。
   * - 有空闲 worker:立即派发;
   * - worker 数未达上限:创建新 worker 派发;
   * - 否则入队等待。
   *
   * 无 worker creator 时,任务在主线程同步执行(若配置了 mainThreadHandler,
   * 否则直接 reject)。
   *
   * @param data 任务数据。
   * @param transfer 可转移对象(零拷贝)。
   * @returns 任务结果 Promise。
   */
  runTask(data: unknown, transfer?: Transferable[]): Promise<unknown> {
    if (this._disposed) {
      return Promise.reject(new Error('WorkerPool: disposed'));
    }

    // 无 creator → 主线程降级
    if (!this._creator) {
      if (this._mainThreadHandler) {
        try {
          const result = this._mainThreadHandler(data);
          // 支持 thenable 结果
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            return result as Promise<unknown>;
          }
          return Promise.resolve(result);
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
      return Promise.reject(
        new Error('WorkerPool: no workerCreator and no mainThreadHandler'),
      );
    }

    // 队列上限检查
    if (this._queueMax > 0 && this._queue.length >= this._queueMax) {
      return Promise.reject(new Error('WorkerPool: queue overflow'));
    }

    return new Promise<unknown>((resolve, reject) => {
      const task: PoolTask = {
        id: _nextTaskId(),
        data,
        transfer,
        resolve,
        reject,
      };
      this._enqueueOrDispatch(task);
    });
  }

  /**
   * 批量派发任务,等待全部完成(顺序无关)。
   * 任一失败则整体 reject(其他任务继续执行但结果丢弃)。
   */
  async runTasks(
    items: Array<{ data: unknown; transfer?: Transferable[] }>,
  ): Promise<unknown[]> {
    const promises = items.map((it) => this.runTask(it.data, it.transfer));
    return Promise.all(promises);
  }

  /**
   * 等待所有队列任务完成并回收所有 worker。
   * 不影响后续 runTask(可继续使用,会重新创建 worker)。
   */
  async drain(): Promise<void> {
    // 等待队列清空 + 所有 worker 空闲
    while (this._queue.length > 0 || this.idleWorkerCount < this.workerCount) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    this._terminateAll();
  }

  /**
   * 销毁池:终止所有 worker,reject 所有未完成任务。
   * 之后不可再使用(除非重新 setWorkerCreator 并清除 disposed 标志)。
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // reject 队列中未派发的任务
    for (const task of this._queue) {
      task.reject(new Error('WorkerPool: disposed before task started'));
    }
    this._queue.length = 0;

    // reject 正在执行的任务并终止 worker
    for (const slot of this._workers) {
      if (slot.current) {
        slot.current.reject(new Error('WorkerPool: disposed during task'));
        slot.current = null;
      }
      this._terminateSlot(slot);
    }
    this._workers.length = 0;
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 入队或立即派发。 */
  private _enqueueOrDispatch(task: PoolTask): void {
    // 1. 尝试复用空闲 worker
    const idle = this._workers.find((s) => !s.terminated && s.current === null);
    if (idle) {
      this._dispatch(idle, task);
      return;
    }
    // 2. 尝试创建新 worker
    if (this._workers.length < this._workerLimit && this._creator) {
      const slot = this._createSlot();
      if (slot) {
        this._dispatch(slot, task);
        return;
      }
    }
    // 3. 入队等待
    this._queue.push(task);
  }

  /** 创建一个新的 worker 槽位。 */
  private _createSlot(): WorkerSlot | null {
    if (!this._creator) return null;
    let worker: WorkerLike;
    try {
      worker = this._creator();
    } catch (e) {
      return null;
    }
    const slot: WorkerSlot = {
      worker,
      current: null,
      refCount: 0,
      terminated: false,
    };
    worker.onmessage = (ev: { data: unknown }) => {
      this._onWorkerMessage(slot, ev.data);
    };
    worker.onerror = (ev: unknown) => {
      this._onWorkerError(slot, ev);
    };
    this._workers.push(slot);
    return slot;
  }

  /** 派发任务到指定 worker。 */
  private _dispatch(slot: WorkerSlot, task: PoolTask): void {
    slot.current = task;
    slot.refCount++;
    try {
      slot.worker.postMessage(task.data, task.transfer);
    } catch (e) {
      slot.current = null;
      task.reject(e instanceof Error ? e : new Error(String(e)));
      this._onWorkerIdle(slot);
    }
  }

  /** worker 返回结果。 */
  private _onWorkerMessage(slot: WorkerSlot, data: unknown): void {
    const task = slot.current;
    if (!task) return; // 无任务,忽略
    slot.current = null;
    task.resolve(data);
    this._onWorkerIdle(slot);
  }

  /** worker 报错。 */
  private _onWorkerError(slot: WorkerSlot, ev: unknown): void {
    const task = slot.current;
    if (task) {
      slot.current = null;
      const msg =
        ev && typeof ev === 'object' && 'message' in ev
          ? String((ev as { message: unknown }).message)
          : 'Worker error';
      task.reject(new Error(msg));
    }
    this._onWorkerIdle(slot);
  }

  /** worker 空闲:派发下一个队列任务,或在无人引用时回收。 */
  private _onWorkerIdle(slot: WorkerSlot): void {
    if (this._disposed) return;
    // 派发下一个队列任务
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      this._dispatch(slot, next);
      return;
    }
    // 队列为空:保留 worker 等待复用(不主动终止,避免反复创建开销)
    // 真正回收由 drain() / dispose() 触发
  }

  /** 终止单个 worker 槽位。 */
  private _terminateSlot(slot: WorkerSlot): void {
    if (slot.terminated) return;
    slot.terminated = true;
    try {
      slot.worker.terminate();
    } catch {
      // 忽略终止错误
    }
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
  }

  /** 终止所有 worker。 */
  private _terminateAll(): void {
    for (const slot of this._workers) {
      this._terminateSlot(slot);
    }
    this._workers.length = 0;
  }
}

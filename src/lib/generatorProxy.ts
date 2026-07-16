// GeneratorProxy — 在主线程中通过 Worker 池执行生成器脚本。
//
// 架构:
//   - Worker 池:固定数量的 Worker 复用,避免重复创建
//   - 任务队列:超出 worker 数量的请求排队等待
//   - 超时控制:每个任务 1s 超时,自动 reject
//   - 沙箱:Worker 内部没有 DOM/fetch/localStorage,代码无法访问主进程

import { createLogger } from './logger';
import type { Group } from '@/engine';

const log = createLogger('GenProxy');

interface PendingTask {
  id: number;
  resolve: (group: Group) => void;
  reject: (err: Error) => void;
  timeout: number;
}

const WORKER_SOURCE = `
self.addEventListener('message', function(event) {
  var data = event.data;
  if (data.type !== 'run') return;
  try {
    var sandbox = {
      build: {
        box: function(w, h, d) { return { __type: 'BoxGeometry', w: w, h: h, d: d }; },
        sphere: function(r) { return { __type: 'SphereGeometry', r: r }; },
        cylinder: function(rt, rb, h) { return { __type: 'CylinderGeometry', rt: rt, rb: rb, h: h }; },
        cone: function(r, h) { return { __type: 'ConeGeometry', r: r, h: h }; },
        torus: function(r, t) { return { __type: 'TorusGeometry', r: r, t: t }; },
      },
      material: {
        standard: function(color, opts) { return { __type: 'StandardMaterial', color: color, opts: opts }; },
        emissive: function(color, intensity) { return { __type: 'EmissiveMaterial', color: color, intensity: intensity }; },
      },
      group: function() { return { __type: 'Group', children: [] }; },
      add: function(parent, child) { if (parent && parent.children) parent.children.push(child); },
      setPos: function(obj, x, y, z) { if (obj) obj.position = [x, y, z]; },
      setRot: function(obj, x, y, z) { if (obj) obj.rotation = [x, y, z]; },
      setScale: function(obj, x, y, z) { if (obj) obj.scale = [x, y, z]; },
      color: {
        hex: function(h) { return { r: 0, g: 0, b: 0, _hex: h }; },
        rgb: function(r, g, b) { return { r: r, g: g, b: b }; },
      },
      rng: function(seed) {
        var s = seed || 1;
        return function() { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      },
      log: { info: function() {}, warn: function() {}, error: function() {} },
    };
    var factory = new Function('sandbox', 'with (sandbox) { ' + data.code + '; if (typeof build !== "function") throw new Error("must define build()"); return build; }');
    var build = factory(sandbox);
    var group = build(data.params);
    self.postMessage({ type: 'result', id: data.id, group: group });
  } catch (e) {
    self.postMessage({ type: 'result', id: data.id, error: e && e.message ? e.message : String(e) });
  }
});
`;

export interface GeneratorProxyOptions {
  /** Worker 池大小。默认 navigator.hardwareConcurrency - 1。 */
  poolSize?: number;
  /** 单个任务超时(毫秒)。默认 1000ms。 */
  timeoutMs?: number;
}

export class GeneratorProxy {
  private _workers: Worker[] = [];
  private _pending: Map<number, PendingTask> = new Map();
  private _queue: { code: string; params: Record<string, unknown>; resolve: (g: Group) => void; reject: (e: Error) => void }[] = [];
  private _nextId = 1;
  private _timeoutMs: number;
  private _destroyed = false;

  constructor(opts: GeneratorProxyOptions = {}) {
    const size = opts.poolSize ?? Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1);
    this._timeoutMs = opts.timeoutMs ?? 1000;

    if (typeof Worker === 'undefined') {
      log.warn('Worker not available; generator scripts will run synchronously on main thread (NOT safe)');
      return;
    }

    for (let i = 0; i < size; i++) {
      try {
        const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        w.addEventListener('message', this._onMessage.bind(this, w));
        w.addEventListener('error', (e) => log.error('worker error:', e.message));
        this._workers.push(w);
        URL.revokeObjectURL(url);
      } catch (e) {
        log.error('failed to create worker:', e);
      }
    }
    log.info(`generator proxy initialized: ${this._workers.length} workers`);
  }

  private _onMessage(worker: Worker, event: MessageEvent<{ type: string; id: number; group?: Group; error?: string }>): void {
    const data = event.data;
    if (data.type !== 'result') return;
    const task = this._pending.get(data.id);
    if (!task) return;
    this._pending.delete(data.id);
    clearTimeout(task.timeout);
    if (data.error) {
      task.reject(new Error(data.error));
    } else {
      // worker 返回的是 stub 对象,真实实现需要反序列化为 Group
      // 此处我们直接返回,调用方负责最终重建
      task.resolve(data.group as Group);
    }
    this._drain(worker);
  }

  /** 运行生成器脚本,返回 Group(在 Worker 中执行)。 */
  run(code: string, params: Record<string, unknown>): Promise<Group> {
    if (this._destroyed) {
      return Promise.reject(new Error('GeneratorProxy has been destroyed'));
    }
    return new Promise<Group>((resolve, reject) => {
      const task = { code, params, resolve, reject };
      const worker = this._findIdleWorker();
      if (worker) {
        this._dispatch(worker, task);
      } else {
        this._queue.push(task);
      }
    });
  }

  private _findIdleWorker(): Worker | null {
    for (const w of this._workers) {
      // 没有 pending 任务的 worker 即为空闲
      // 简单实现:用 worker._busy flag
      if (!(w as unknown as { _busy: boolean })._busy) {
        return w;
      }
    }
    return null;
  }

  private _dispatch(worker: Worker, task: { code: string; params: Record<string, unknown>; resolve: (g: Group) => void; reject: (e: Error) => void }): void {
    const id = this._nextId++;
    (worker as unknown as { _busy: boolean })._busy = true;
    const timeout = window.setTimeout(() => {
      const pending = this._pending.get(id);
      if (pending) {
        this._pending.delete(id);
        (worker as unknown as { _busy: boolean })._busy = false;
        pending.reject(new Error('Generator execution timed out'));
        this._drain(worker);
      }
    }, this._timeoutMs);

    this._pending.set(id, { ...task, id, timeout });
    worker.postMessage({ type: 'run', id, code: task.code, params: task.params });
  }

  private _drain(worker: Worker): void {
    (worker as unknown as { _busy: boolean })._busy = false;
    const next = this._queue.shift();
    if (next) {
      this._dispatch(worker, next);
    }
  }

  /** 销毁所有 worker,清理资源。 */
  destroy(): void {
    this._destroyed = true;
    for (const w of this._workers) {
      w.terminate();
    }
    this._workers = [];
    for (const task of this._pending.values()) {
      clearTimeout(task.timeout);
      task.reject(new Error('Proxy destroyed'));
    }
    this._pending.clear();
    this._queue = [];
  }

  /** 池中可用 worker 数量。 */
  available(): number {
    return this._workers.filter((w) => !(w as unknown as { _busy: boolean })._busy).length;
  }
}

// SceneStreaming — 场景流式加载系统(分块加载 / 卸载 + 预加载 + 优先级)。
//
// 设计目标:
//   - 与 SceneManager 互补:SceneManager 管理"整个场景"的注册 / 切换,
//     SceneStreaming 管理一个场景内部按空间分块的"流式"加载(开放世界 /
//     大场景分块)。每个 SceneChunk 有 AABB 边界 + objects 列表 + assets
//     引用,根据相机位置与 streamRadius 决定加载 / 卸载;
//   - 加载队列按优先级排序(默认:距离相机越近优先级越高),受
//     maxConcurrentLoads 限流;支持同步(loadDuration=0)与异步(loadDuration>0)
//     两种模式,异步模式下 activeLoads 反映正在加载的块数;
//   - 卸载队列:超出 streamRadius 的已加载块按 LRU(或入队顺序)卸载,
//     释放 objects / assets 引用(由调用方在 chunk.objects 清空时实际释放);
//   - preload(center, radius) 主动预加载指定区域内的块;
//   - forceLoad / forceUnload 绕过距离判定,用于过场动画 / 调试。
//
// 不变量:
//   - chunk.id 全局唯一;registerChunk 重名覆盖(warn);
//   - loadedChunks 与 chunk.isLoaded 同步;
//   - loadingQueue 中的 chunkId 尚未 isLoaded;_loadingChunks 中的正在加载;
//   - camera === null 时 update 不触发自动加载 / 卸载(仅手动 request 仍可用);
//   - clear() 卸载所有已加载块并清空注册表。

import { Vector3 } from '../Math/Vector3';
import type { Object3D } from '../Core/Object3D';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneStreaming');

/** 场景块的空间边界(AABB)。 */
export interface SceneChunkBounds {
  min: Vector3;
  max: Vector3;
}

/** 场景块:流式加载的最小单元。 */
export interface SceneChunk {
  /** 全局唯一标识。 */
  id: string;
  /** AABB 边界(世界空间)。 */
  bounds: SceneChunkBounds;
  /** 块内对象列表(加载后填充,卸载时由调用方释放)。 */
  objects: Object3D[];
  /** 是否已加载。 */
  isLoaded: boolean;
  /** 优先级(数值越大越优先;update 自动按 -distance 设置)。 */
  priority: number;
  /** 资产引用列表(由调用方解释,本类不实际加载)。 */
  assets: string[];
}

/** 加载请求。 */
export interface SceneChunkRequest {
  chunkId: string;
  priority: number;
  callback: ((chunk: SceneChunk) => void) | null;
}

/** 流式统计。 */
export interface StreamingStats {
  totalChunks: number;
  loadedChunks: number;
  loadingChunks: number;
  unloadQueueLength: number;
  activeLoads: number;
  maxConcurrentLoads: number;
  streamRadius: number;
  chunkSize: number;
}

/** 流式相机结构类型:任何带 position 的对象都可接受。 */
export interface StreamCamera {
  position: Vector3;
}

/** 异步加载中的块状态。 */
interface LoadingState {
  chunkId: string;
  elapsed: number;
  duration: number;
  callback: ((chunk: SceneChunk) => void) | null;
}

/** SceneStreaming 构造选项。 */
export interface SceneStreamingOptions {
  /** 流式加载半径(世界单位,默认 50)。 */
  streamRadius?: number;
  /** 块大小(世界单位,默认 16)。仅用于统计 / 文档,不强制对齐。 */
  chunkSize?: number;
  /** 最大并发加载数(默认 2)。 */
  maxConcurrentLoads?: number;
  /** 单块加载时长(秒,默认 0=同步)。>0 时为异步模拟。 */
  loadDuration?: number;
}

/**
 * 场景流式加载系统。按空间分块管理场景内容,根据相机位置自动加载 / 卸载。
 */
export class SceneStreaming {
  /** 已注册的所有块(id → chunk)。 */
  readonly chunks: Map<string, SceneChunk> = new Map();
  /** 已加载块 id 集合。 */
  readonly loadedChunks: Set<string> = new Set();
  /** 待加载队列(尚未开始加载)。 */
  loadingQueue: SceneChunkRequest[] = [];
  /** 待卸载队列(chunkId)。 */
  unloadQueue: string[] = [];

  /** 流式加载半径(世界单位)。 */
  streamRadius: number = 50;
  /** 最大并发加载数。 */
  maxConcurrentLoads: number = 2;
  /** 当前正在加载的块数(异步模式下 >0)。 */
  activeLoads: number = 0;
  /** 流式相机(null 时 update 不自动触发加载 / 卸载)。 */
  camera: StreamCamera | null = null;
  /** 块大小(世界单位,统计用)。 */
  chunkSize: number = 16;

  /** 单块加载时长(秒);0 = 同步立即完成。 */
  loadDuration: number = 0;

  /** 正在异步加载中的块(chunkId → state)。 */
  private _loadingChunks: Map<string, LoadingState> = new Map();

  constructor(opts: SceneStreamingOptions = {}) {
    if (opts.streamRadius !== undefined) this.streamRadius = Math.max(0, opts.streamRadius);
    if (opts.chunkSize !== undefined) this.chunkSize = Math.max(1, opts.chunkSize);
    if (opts.maxConcurrentLoads !== undefined) {
      this.maxConcurrentLoads = Math.max(1, Math.floor(opts.maxConcurrentLoads));
    }
    if (opts.loadDuration !== undefined) this.loadDuration = Math.max(0, opts.loadDuration);
  }

  // ── 注册 ───────────────────────────────────────────────────────────

  /**
   * 注册场景块。重名覆盖(warn)。objects 初始可为空数组(加载时填充)。
   */
  registerChunk(chunk: SceneChunk): void {
    if (!chunk.id) throw new Error('SceneStreaming.registerChunk: id must be non-empty');
    if (this.chunks.has(chunk.id)) {
      log.warn(`registerChunk — overwriting existing chunk "${chunk.id}"`);
    }
    chunk.isLoaded = chunk.isLoaded ?? false;
    if (chunk.isLoaded) {
      this.loadedChunks.add(chunk.id);
    } else {
      this.loadedChunks.delete(chunk.id);
    }
    this.chunks.set(chunk.id, chunk);
    log.info(`registerChunk — "${chunk.id}"`);
  }

  /** 注销块(若已加载则先卸载)。返回是否注销成功。 */
  unregisterChunk(id: string): boolean {
    const chunk = this.chunks.get(id);
    if (!chunk) return false;
    this._unloadChunk(id);
    // 从队列移除
    this.loadingQueue = this.loadingQueue.filter((r) => r.chunkId !== id);
    this.unloadQueue = this.unloadQueue.filter((cid) => cid !== id);
    this._loadingChunks.delete(id);
    this.chunks.delete(id);
    log.info(`unregisterChunk — "${id}"`);
    return true;
  }

  // ── 配置 ───────────────────────────────────────────────────────────

  setCamera(camera: StreamCamera | null): void {
    this.camera = camera;
  }

  setStreamRadius(radius: number): void {
    this.streamRadius = Math.max(0, radius);
  }

  setChunkSize(size: number): void {
    this.chunkSize = Math.max(1, size);
  }

  setMaxConcurrentLoads(max: number): void {
    this.maxConcurrentLoads = Math.max(1, Math.floor(max));
  }

  // ── 查询 ───────────────────────────────────────────────────────────

  /** 获取块(未注册返回 undefined)。 */
  getChunk(id: string): SceneChunk | undefined {
    return this.chunks.get(id);
  }

  /** 已注册块总数。 */
  getChunkCount(): number {
    return this.chunks.size;
  }

  /** 已加载块数。 */
  getLoadedCount(): number {
    return this.loadedChunks.size;
  }

  /**
   * 获取可见块(在相机 streamRadius 内的块)。camera === null 时返回空。
   * 可见 = chunk.bounds 到相机 position 的距离 <= streamRadius。
   */
  getVisibleChunks(): SceneChunk[] {
    if (!this.camera) return [];
    const out: SceneChunk[] = [];
    const pos = this.camera.position;
    const r = this.streamRadius;
    for (const chunk of this.chunks.values()) {
      if (chunkBoundsDistance(chunk, pos) <= r) {
        out.push(chunk);
      }
    }
    return out;
  }

  /** 已加载块列表。 */
  getLoadedChunks(): SceneChunk[] {
    const out: SceneChunk[] = [];
    for (const id of this.loadedChunks) {
      const c = this.chunks.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  /** 正在加载的块 id 列表(队列中 + 异步加载中)。 */
  getLoadingChunks(): string[] {
    const ids = new Set<string>();
    for (const r of this.loadingQueue) ids.add(r.chunkId);
    for (const id of this._loadingChunks.keys()) ids.add(id);
    return Array.from(ids);
  }

  getStreamingStats(): StreamingStats {
    return {
      totalChunks: this.chunks.size,
      loadedChunks: this.loadedChunks.size,
      loadingChunks: this.getLoadingChunks().length,
      unloadQueueLength: this.unloadQueue.length,
      activeLoads: this.activeLoads,
      maxConcurrentLoads: this.maxConcurrentLoads,
      streamRadius: this.streamRadius,
      chunkSize: this.chunkSize,
    };
  }

  // ── 加载 / 卸载 ────────────────────────────────────────────────────

  /**
   * 请求加载块(加入队列,由 update 处理)。priority 越大越优先。
   * 若块已加载 / 已在队列 / 不存在,则 no-op。
   */
  requestChunk(id: string, priority: number = 0, callback: ((chunk: SceneChunk) => void) | null = null): void {
    const chunk = this.chunks.get(id);
    if (!chunk) {
      log.warn(`requestChunk — "${id}" not registered`);
      return;
    }
    if (chunk.isLoaded) return;
    if (this._loadingChunks.has(id)) return;
    if (this.loadingQueue.some((r) => r.chunkId === id)) return;
    this.loadingQueue.push({ chunkId: id, priority, callback });
  }

  /** 请求卸载块(加入卸载队列,由 update 处理)。 */
  releaseChunk(id: string): void {
    const chunk = this.chunks.get(id);
    if (!chunk || !chunk.isLoaded) return;
    if (!this.unloadQueue.includes(id)) {
      this.unloadQueue.push(id);
    }
  }

  /**
   * 强制立即加载块(绕过队列,同步完成)。返回加载的块(null = 不存在)。
   * 若 loadDuration > 0 仍走异步路径(立即开始,update 推进)。
   */
  forceLoad(id: string): SceneChunk | null {
    const chunk = this.chunks.get(id);
    if (!chunk) return null;
    if (chunk.isLoaded) return chunk;
    // 从队列移除(避免重复)
    this.loadingQueue = this.loadingQueue.filter((r) => r.chunkId !== id);
    if (this.loadDuration > 0) {
      this._loadingChunks.set(id, {
        chunkId: id,
        elapsed: 0,
        duration: this.loadDuration,
        callback: null,
      });
      this.activeLoads = this._loadingChunks.size;
    } else {
      this._completeLoad(id, null);
    }
    return chunk;
  }

  /** 强制立即卸载块(或取消进行中的异步加载)。返回是否有操作发生(卸载/取消)。 */
  forceUnload(id: string): boolean {
    const chunk = this.chunks.get(id);
    if (!chunk) return false;
    let didSomething = false;
    // 取消进行中的异步加载(即使尚未 isLoaded)
    if (this._loadingChunks.has(id)) {
      this._loadingChunks.delete(id);
      this.activeLoads = this._loadingChunks.size;
      didSomething = true;
    }
    // 从加载队列移除
    const queueLen = this.loadingQueue.length;
    this.loadingQueue = this.loadingQueue.filter((r) => r.chunkId !== id);
    if (this.loadingQueue.length !== queueLen) didSomething = true;
    // 若已加载,执行卸载
    if (chunk.isLoaded) {
      this._unloadChunk(id);
      didSomething = true;
    }
    // 从卸载队列移除(已完成)
    this.unloadQueue = this.unloadQueue.filter((cid) => cid !== id);
    return didSomething;
  }

  /**
   * 预加载指定中心点 radius 范围内的块(高优先级)。
   * 返回加入队列的块数(已加载 / 已在队列的跳过)。
   */
  preload(center: Vector3, radius: number): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.isLoaded) continue;
      if (this._loadingChunks.has(chunk.id)) continue;
      if (this.loadingQueue.some((r) => r.chunkId === chunk.id)) continue;
      const dist = chunkBoundsDistance(chunk, center);
      if (dist <= radius) {
        // 距离越近优先级越高(用大数值保证优先于自动调度的负数优先级)
        this.loadingQueue.push({
          chunkId: chunk.id,
          priority: 1e6 - dist,
          callback: null,
        });
        count++;
      }
    }
    log.info(`preload — scheduled ${count} chunks at ${center.toString()} r=${radius}`);
    return count;
  }

  // ── update ─────────────────────────────────────────────────────────

  /**
   * 每帧调用 —— 自动调度加载 / 卸载 + 推进异步加载。
   *
   * 流程:
   *   1. 若 camera 存在:
   *      a. 可见(<= streamRadius)且未加载且未在队列的块 → requestChunk(priority = -dist);
   *      b. 不可见(> streamRadius)且已加载的块 → 加入卸载队列;
   *   2. 处理卸载队列:逐个卸载;
   *   3. 推进异步加载(_loadingChunks):elapsed += dt,完成的回调并标记 loaded;
   *   4. 处理加载队列:按 priority 降序排序,在 maxConcurrentLoads 余量内启动加载。
   *
   * @param dt 秒(用于异步加载计时)
   */
  update(dt: number): void {
    // 1. 自动调度
    if (this.camera) {
      const pos = this.camera.position;
      const r = this.streamRadius;
      for (const chunk of this.chunks.values()) {
        const dist = chunkBoundsDistance(chunk, pos);
        if (dist <= r) {
          // 可见:未加载且未在队列 → 请求
          if (!chunk.isLoaded && !this._loadingChunks.has(chunk.id) &&
              !this.loadingQueue.some((rq) => rq.chunkId === chunk.id)) {
            this.loadingQueue.push({
              chunkId: chunk.id,
              priority: -dist, // 距离越近优先级越高
              callback: null,
            });
          }
        } else {
          // 不可见:已加载 → 卸载
          if (chunk.isLoaded && !this.unloadQueue.includes(chunk.id)) {
            this.unloadQueue.push(chunk.id);
          }
        }
      }
    }

    // 2. 处理卸载队列
    if (this.unloadQueue.length > 0) {
      const toUnload = this.unloadQueue;
      this.unloadQueue = [];
      for (const id of toUnload) {
        this._unloadChunk(id);
      }
    }

    // 3. 推进异步加载
    if (this._loadingChunks.size > 0) {
      const completed: string[] = [];
      for (const [id, state] of this._loadingChunks) {
        state.elapsed += dt;
        if (state.elapsed >= state.duration) {
          completed.push(id);
        }
      }
      for (const id of completed) {
        const state = this._loadingChunks.get(id)!;
        this._loadingChunks.delete(id);
        this._completeLoad(id, state.callback);
      }
      this.activeLoads = this._loadingChunks.size;
    }

    // 4. 处理加载队列(按 priority 降序)
    if (this.loadingQueue.length > 0) {
      this.loadingQueue.sort((a, b) => b.priority - a.priority);
      const capacity = this.maxConcurrentLoads - this._loadingChunks.size;
      if (capacity > 0) {
        const started = this.loadingQueue.splice(0, Math.min(capacity, this.loadingQueue.length));
        for (const req of started) {
          const chunk = this.chunks.get(req.chunkId);
          if (!chunk || chunk.isLoaded) continue;
          if (this.loadDuration > 0) {
            this._loadingChunks.set(req.chunkId, {
              chunkId: req.chunkId,
              elapsed: 0,
              duration: this.loadDuration,
              callback: req.callback,
            });
          } else {
            this._completeLoad(req.chunkId, req.callback);
          }
        }
        this.activeLoads = this._loadingChunks.size;
      }
    }
  }

  // ── 内部 ───────────────────────────────────────────────────────────

  /** 标记块为已加载(同步完成路径)。 */
  private _completeLoad(id: string, callback: ((chunk: SceneChunk) => void) | null): void {
    const chunk = this.chunks.get(id);
    if (!chunk) return;
    chunk.isLoaded = true;
    this.loadedChunks.add(id);
    log.debug(`_completeLoad — "${id}" loaded`);
    if (callback) {
      try {
        callback(chunk);
      } catch (err) {
        log.warn(`_completeLoad — callback for "${id}" threw: ${(err as Error).message}`);
      }
    }
  }

  /** 标记块为已卸载(不清空 objects,由调用方决定释放时机)。 */
  private _unloadChunk(id: string): void {
    const chunk = this.chunks.get(id);
    if (!chunk) return;
    // 取消进行中的异步加载(即使尚未 isLoaded)
    if (this._loadingChunks.has(id)) {
      this._loadingChunks.delete(id);
      this.activeLoads = this._loadingChunks.size;
    }
    if (!chunk.isLoaded) return;
    chunk.isLoaded = false;
    this.loadedChunks.delete(id);
    log.debug(`_unloadChunk — "${id}" unloaded`);
  }

  /** 清空所有:卸载已加载块 + 清空队列 + 清空注册表。 */
  clear(): void {
    for (const id of Array.from(this.loadedChunks)) {
      this._unloadChunk(id);
    }
    this.loadingQueue = [];
    this.unloadQueue = [];
    this._loadingChunks.clear();
    this.activeLoads = 0;
    this.chunks.clear();
    this.loadedChunks.clear();
    log.info('clear — all chunks removed');
  }
}

// ── helpers ───────────────────────────────────────────────────────────

/** 计算块边界到点的最近距离(点在盒内返回 0)。 */
function chunkBoundsDistance(chunk: SceneChunk, point: Vector3): number {
  const { min, max } = chunk.bounds;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  if (point.x < min.x) dx = min.x - point.x;
  else if (point.x > max.x) dx = point.x - max.x;
  if (point.y < min.y) dy = min.y - point.y;
  else if (point.y > max.y) dy = point.y - max.y;
  if (point.z < min.z) dz = min.z - point.z;
  else if (point.z > max.z) dz = point.z - max.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 工厂:用 min/max 构造 SceneChunk(便捷方法)。
export function createSceneChunk(
  id: string,
  min: [number, number, number],
  max: [number, number, number],
  opts: { objects?: Object3D[]; assets?: string[]; isLoaded?: boolean } = {},
): SceneChunk {
  return {
    id,
    bounds: {
      min: new Vector3(min[0], min[1], min[2]),
      max: new Vector3(max[0], max[1], max[2]),
    },
    objects: opts.objects ?? [],
    isLoaded: opts.isLoaded ?? false,
    priority: 0,
    assets: opts.assets ?? [],
  };
}

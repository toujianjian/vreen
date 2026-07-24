// AssetManager — 引擎侧的资产加载注册表 + 缓存。
//
// 单一职责：把 (format, source) 映射到 Promise<T>。
//  - 同一个 (format, source) 多次 load 只解析一次。
//  - 显式 invalidate 可以驱逐某条缓存（asset 重新上传/版本变更）。
//  - 内部维护一个 LRU 容量上限（默认 64），避免内存膨胀。
//  - Phase 4.4: prewarm / prefetch / getStats / invalidateAll 缓存策略 API。
//  - 不感知具体 loader 的内部实现；调用方把 loader 通过 registerLoader()
//    注入进来。
//
// 线程模型：所有方法都是同步的"提交 / 查询"语义；load() 返回 Promise。
//
// 用途示例（GLB 资源）：
//   const am = new AssetManager();
//   am.registerLoader('glb', new GLBLoader());
//   const scene = await am.load<Group>('glb', 'model.glb');
//   await am.prewarm([{ format: 'glb', source: 'next.glb' }]);  // 预热下一批

import {
  AssetSource,
  Loader,
  LoaderContext,
  cacheKeyFor,
  isAbortError,
} from './Loader';
import { createLogger } from '@/lib/logger';

const log = createLogger('AssetMgr');

interface CacheEntry {
  promise: Promise<unknown>;
  size: number;
  hits: number;
  /** 创建时间戳(ms)。用于 LRU 淘汰时的辅助排序。 */
  createdAt: number;
}

export interface AssetManagerOptions {
  /** LRU 容量上限（条目数）。0 = 不限。 */
  maxEntries?: number;
}

/** Phase 4.4: 缓存统计信息。 */
export interface CacheStats {
  /** 当前缓存条目数。 */
  entries: number;
  /** LRU 容量上限(0=不限)。 */
  maxEntries: number;
  /** 累计命中次数。 */
  hits: number;
  /** 累计未命中次数。 */
  misses: number;
  /** 累计 LRU 淘汰次数。 */
  evictions: number;
  /** 缓存资产总字节估算。 */
  totalBytes: number;
  /** 命中率(0-1)。 */
  hitRate: number;
}

/** Phase 4.4: 预热条目。 */
export interface PrewarmEntry {
  format: string;
  source: AssetSource;
}

export class AssetManager {
  private loaders = new Map<string, Loader<unknown>>();
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;
  // Phase 4.4: 统计计数器
  private _totalHits = 0;
  private _totalMisses = 0;
  private _totalEvictions = 0;

  constructor(opts: AssetManagerOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 64;
  }

  /** 注册一个 loader。format 重复时后者覆盖前者。 */
  registerLoader<T>(format: string, loader: Loader<T>): void {
    const prev = this.loaders.has(format);
    this.loaders.set(format, loader as unknown as Loader<unknown>);
    log.info(`registerLoader("${format}") ${prev ? '(overriding previous)' : '(new)'}`);
  }

  /** 取消注册。 */
  unregisterLoader(format: string): void {
    if (this.loaders.delete(format)) {
      log.info(`unregisterLoader("${format}")`);
    }
  }

  /** 查询已注册的 loader。 */
  getLoader(format: string): Loader<unknown> | undefined {
    return this.loaders.get(format);
  }

  /** 计算 cache key (含 format 前缀)。 */
  keyFor(format: string, source: AssetSource): string {
    return `${format}::${cacheKeyFor(source)}`;
  }

  /** 同步检查是否已缓存。 */
  has(format: string, source: AssetSource): boolean {
    return this.cache.has(this.keyFor(format, source));
  }

  /** 加载资产。返回解析后的对象。 */
  async load<T>(format: string, source: AssetSource, ctx?: LoaderContext): Promise<T> {
    const key = this.keyFor(format, source);
    const t0 = performance.now();
    const existing = this.cache.get(key);
    if (existing) {
      existing.hits++;
      this._totalHits++;
      log.info(`cache HIT "${format}" key=${truncate(key, 60)} (hits=${existing.hits}, age=${(performance.now() - t0).toFixed(1)}ms)`);
      return existing.promise as Promise<T>;
    }
    this._totalMisses++;
    const loader = this.loaders.get(format);
    if (!loader) {
      const known = Array.from(this.loaders.keys()).join(', ') || '<none>';
      log.error(`no loader for format "${format}" (registered: ${known})`);
      throw new Error(`AssetManager: no loader registered for format "${format}"`);
    }
    log.info(`cache MISS "${format}" key=${truncate(key, 60)} — invoking loader ${loader.constructor.name}`);
    const p = loader.load(source, ctx).then((result) => {
      log.debug(`loader finished for "${format}" key=${truncate(key, 60)} in ${(performance.now() - t0).toFixed(1)}ms`);
      return result;
    }).catch((err) => {
      // 失败时清掉缓存，让下次重试
      if (!isAbortError(err)) {
        this.cache.delete(key);
        log.warn(`loader failed for "${format}" key=${truncate(key, 60)}: ${(err as Error).message ?? err}`);
      } else {
        log.info(`loader aborted for "${format}" key=${truncate(key, 60)}`);
        this.cache.delete(key);
      }
      throw err;
    });
    this.cache.set(key, {
      promise: p, size: estimateSize(source), hits: 0,
      createdAt: performance.now(),
    });
    this._evictIfNeeded();
    return p as Promise<T>;
  }

  /** 显式驱逐某条缓存。 */
  invalidate(format: string, source: AssetSource): void {
    const key = this.keyFor(format, source);
    if (this.cache.delete(key)) {
      log.info(`invalidate("${format}") key=${truncate(key, 60)}`);
    } else {
      log.debug(`invalidate("${format}") key=${truncate(key, 60)} — was not cached`);
    }
  }

  /** Phase 4.4: 按谓词批量失效缓存。
   *  返回被驱逐的条目数。无谓词时等同 clear()。 */
  invalidateAll(predicate?: (format: string, source: AssetSource) => boolean): number {
    if (!predicate) {
      const n = this.cache.size;
      this.clear();
      return n;
    }
    let removed = 0;
    for (const [key] of this.cache) {
      // 反解 key: "format::source"
      const sepIdx = key.indexOf('::');
      if (sepIdx < 0) continue;
      const fmt = key.slice(0, sepIdx);
      const src = key.slice(sepIdx + 2);
      if (predicate(fmt, src)) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      log.info(`invalidateAll() — removed ${removed} entries matching predicate`);
    }
    return removed;
  }

  /** 全部清空。 */
  clear(): void {
    const n = this.cache.size;
    this.cache.clear();
    log.info(`clear() — dropped ${n} entries`);
  }

  /** 当前缓存条目数。 */
  size(): number {
    return this.cache.size;
  }

  // ── Phase 4.4: 缓存策略 API ──────────────────────────────────────

  /** 预取:在后台加载资产但不返回结果。
   *  适用于"用户可能马上需要这个资产"的场景,不阻塞当前帧。
   *  如果已在缓存中,立即 resolve。 */
  prefetch(format: string, source: AssetSource, ctx?: LoaderContext): Promise<void> {
    if (this.has(format, source)) {
      return Promise.resolve();
    }
    log.info(`prefetch("${format}") — background loading`);
    return this.load(format, source, ctx).then(() => { /* swallow result */ }).catch((err) => {
      log.warn(`prefetch("${format}") failed: ${(err as Error).message ?? err}`);
      // 不抛错:prefetch 是 best-effort
    });
  }

  /** 预热:批量加载多个资产,等全部完成(或失败)后返回。
   *  适用于场景切换前预加载下一场景资源。
   *  使用 Promise.allSettled 保证单个失败不影响其他。
   *  返回 { loaded, failed } 计数。 */
  async prewarm(entries: PrewarmEntry[]): Promise<{ loaded: number; failed: number }> {
    if (entries.length === 0) return { loaded: 0, failed: 0 };
    log.info(`prewarm() — ${entries.length} entries`);
    const results = await Promise.allSettled(
      entries.map((e) => this.load(e.format, e.source)),
    );
    let loaded = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') loaded++;
      else failed++;
    }
    log.info(`prewarm() done — ${loaded} loaded, ${failed} failed`);
    return { loaded, failed };
  }

  /** Phase 4.4: 返回缓存统计信息。 */
  getStats(): CacheStats {
    let totalBytes = 0;
    for (const entry of this.cache.values()) {
      totalBytes += entry.size;
    }
    const total = this._totalHits + this._totalMisses;
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      hits: this._totalHits,
      misses: this._totalMisses,
      evictions: this._totalEvictions,
      totalBytes,
      hitRate: total > 0 ? this._totalHits / total : 0,
    };
  }

  // ── private ───────────────────────────────────────────────────────
  private _evictIfNeeded(): void {
    if (this.maxEntries <= 0) return;
    if (this.cache.size <= this.maxEntries) return;
    // LRU by hits 升序；命中少 = 早驱逐。同 hits 时按 createdAt 升序(老先淘汰)。
    const entries = [...this.cache.entries()];
    entries.sort((a, b) => {
      if (a[1].hits !== b[1].hits) return a[1].hits - b[1].hits;
      return a[1].createdAt - b[1].createdAt;
    });
    const toRemove = entries.length - this.maxEntries;
    const evictedKeys: string[] = [];
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
      evictedKeys.push(entries[i][0]);
    }
    this._totalEvictions += toRemove;
    log.warn(`LRU eviction: dropped ${toRemove} entries (cap=${this.maxEntries}, current=${this.cache.size})`);
    for (const k of evictedKeys) log.debug(`  evicted: ${truncate(k, 80)}`);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

function estimateSize(source: AssetSource): number {
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (source instanceof Uint8Array) return source.byteLength;
  if (source instanceof Blob) return source.size;
  if (typeof source === 'string') return source.length;
  if (source instanceof URL) return source.toString().length;
  return 0;
}

/** 全局单例（应用层通常只需要一个）。 */
let _default: AssetManager | null = null;
export function getDefaultAssetManager(): AssetManager {
  if (!_default) _default = new AssetManager();
  return _default;
}

/** 测试 / 资源回收：重置全局单例。 */
export function resetDefaultAssetManager(): void {
  _default?.clear();
  _default = null;
}

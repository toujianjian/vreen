// AssetManager — 引擎侧的资产加载注册表 + 缓存。
//
// 单一职责：把 (format, source) 映射到 Promise<T>。
//  - 同一个 (format, source) 多次 load 只解析一次。
//  - 显式 invalidate 可以驱逐某条缓存（asset 重新上传/版本变更）。
//  - 内部维护一个 LRU 容量上限（默认 64），避免内存膨胀。
//  - 不感知具体 loader 的内部实现；调用方把 loader 通过 registerLoader()
//    注入进来。
//
// 线程模型：所有方法都是同步的"提交 / 查询"语义；load() 返回 Promise。
//
// 用途示例（GLB 资源）：
//   const am = new AssetManager();
//   am.registerLoader('glb', new GLBLoader());
//   const scene = await am.load<Group>('glb', 'model.glb');

import {
  AssetSource,
  Loader,
  LoaderContext,
  cacheKeyFor,
  isAbortError,
} from './Loader';
import { createLogger } from '../logger';

const log = createLogger('AssetMgr');

interface CacheEntry {
  promise: Promise<unknown>;
  size: number;
  hits: number;
}

export interface AssetManagerOptions {
  /** LRU 容量上限（条目数）。0 = 不限。 */
  maxEntries?: number;
}

export class AssetManager {
  private loaders = new Map<string, Loader<unknown>>();
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;

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
      log.info(`cache HIT "${format}" key=${truncate(key, 60)} (hits=${existing.hits}, age=${(performance.now() - t0).toFixed(1)}ms)`);
      return existing.promise as Promise<T>;
    }
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
    this.cache.set(key, { promise: p, size: estimateSize(source), hits: 0 });
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

  // ── private ───────────────────────────────────────────────────────
  private _evictIfNeeded(): void {
    if (this.maxEntries <= 0) return;
    if (this.cache.size <= this.maxEntries) return;
    // LRU by hits 升序；命中少 = 早驱逐。
    const entries = [...this.cache.entries()];
    entries.sort((a, b) => a[1].hits - b[1].hits);
    const toRemove = entries.length - this.maxEntries;
    const evictedKeys: string[] = [];
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
      evictedKeys.push(entries[i][0]);
    }
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

// AssetLoader — 异步资源加载器。
//
// 与 Loaders/AssetManager 的关系：
//   - 内部持有一个 AssetManager 实例（或注入），用其完成实际的 format/source
//     加载与缓存；AssetLoader 在其之上提供"按 URL + 类型"的友好 API。
//   - 内部还持有一个 AssetCache<Texture|Geometry|...>，缓存已解析的引擎对象，
//     供 getCached/invalidate 使用。
//   - loadTexture / loadGeometry / loadGLTF 是便利方法，封装了 format 注册。
//
// 设计要点：
//   - load(url, type) 是模板入口，type 决定调用哪个 AssetManager loader；
//     若该 format 未注册，抛出明确错误。
//   - loadAsync(urls) 批量加载，使用 Promise.allSettled 保证单个失败不阻塞；
//     返回 { results, loaded, failed }。
//   - getCached(url) 同步返回已解析资源；invalidate(url) 同时清 AssetManager
//     与 AssetCache 中的对应条目。
//   - 不直接依赖 DOM；fetch 在浏览器/Electron 中可用。

import { AssetManager, type PrewarmEntry } from '../Loaders/AssetManager';
import type { AssetSource, Loader, LoaderContext } from '../Loaders/Loader';
import { AssetCache } from './AssetCache';
import { createLogger } from '@/lib/logger';

const log = createLogger('AssetLoader');

/** 加载条目：URL + 类型。 */
export interface AssetLoadEntry {
  url: string;
  type: string;
}

/** 批量加载结果。 */
export interface AssetBatchResult<T = unknown> {
  /** 成功项：url → 资源对象。 */
  results: Map<string, T>;
  /** 失败项：url → Error。 */
  errors: Map<string, Error>;
  /** 成功计数。 */
  loaded: number;
  /** 失败计数。 */
  failed: number;
}

export class AssetLoader {
  /** 底层 AssetManager（按 format/source 缓存 Promise）。 */
  readonly assetManager: AssetManager;
  /** 已解析资源实例缓存（按 url）。默认容量 64。 */
  readonly instanceCache: AssetCache<unknown>;
  /** url → type 映射，记录每条 url 的加载类型（用于 invalidate）。 */
  private _urlTypes = new Map<string, string>();

  constructor(opts: { assetManager?: AssetManager; cacheMaxSize?: number } = {}) {
    this.assetManager = opts.assetManager ?? new AssetManager();
    this.instanceCache = new AssetCache<unknown>({ maxSize: opts.cacheMaxSize ?? 64 });
  }

  /** 注册一个底层 loader（按 type/format 索引）。 */
  registerLoader<T>(type: string, loader: Loader<T>): void {
    this.assetManager.registerLoader(type, loader);
  }

  /** 取消注册。 */
  unregisterLoader(type: string): void {
    this.assetManager.unregisterLoader(type);
  }

  /** 异步加载资源。返回解析后的对象。
   *  命中实例缓存时同步 resolve；否则走 AssetManager。 */
  async load<T>(url: string, type: string, ctx?: LoaderContext): Promise<T> {
    // 1. 实例缓存命中
    const cached = this.instanceCache.get(url);
    if (cached !== undefined) {
      log.debug(`load("${url}", "${type}") — instance cache HIT`);
      return cached as T;
    }
    // 2. 走 AssetManager（按 format+source 缓存 Promise，避免重复解析）
    const data = await this.assetManager.load<T>(type, url, ctx);
    this._urlTypes.set(url, type);
    this.instanceCache.set(url, data);
    return data;
  }

  /** 批量加载。使用 allSettled 保证单个失败不阻塞。 */
  async loadAsync<T = unknown>(urls: AssetLoadEntry[]): Promise<AssetBatchResult<T>> {
    const results = new Map<string, T>();
    const errors = new Map<string, Error>();
    if (urls.length === 0) return { results, errors, loaded: 0, failed: 0 };
    log.info(`loadAsync() — ${urls.length} entries`);
    const settled = await Promise.allSettled(
      urls.map((e) => this.load<T>(e.url, e.type)),
    );
    let loaded = 0;
    let failed = 0;
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      const url = urls[i].url;
      if (r.status === 'fulfilled') {
        results.set(url, r.value);
        loaded++;
      } else {
        errors.set(url, r.reason as Error);
        failed++;
      }
    }
    log.info(`loadAsync() done — ${loaded} loaded, ${failed} failed`);
    return { results, errors, loaded, failed };
  }

  /** 加载纹理（便利方法）。需先 registerLoader('texture', ...)。 */
  async loadTexture<T = unknown>(url: string, ctx?: LoaderContext): Promise<T> {
    return this.load<T>(url, 'texture', ctx);
  }

  /** 加载几何体（便利方法）。需先 registerLoader('geometry', ...)。 */
  async loadGeometry<T = unknown>(url: string, ctx?: LoaderContext): Promise<T> {
    return this.load<T>(url, 'geometry', ctx);
  }

  /** 加载 GLTF（便利方法）。需先 registerLoader('gltf', ...)。 */
  async loadGLTF<T = unknown>(url: string, ctx?: LoaderContext): Promise<T> {
    return this.load<T>(url, 'gltf', ctx);
  }

  /** 同步获取已缓存实例。未命中返回 undefined。 */
  getCached<T = unknown>(url: string): T | undefined {
    return this.instanceCache.get(url) as T | undefined;
  }

  /** 使缓存失效。同时清 AssetManager 的 Promise 缓存与实例缓存。
   *  下次 load 会重新走完整路径。 */
  invalidate(url: string): void {
    const type = this._urlTypes.get(url);
    if (type) {
      this.assetManager.invalidate(type, url);
      this._urlTypes.delete(url);
    }
    this.instanceCache.delete(url);
    log.debug(`invalidate("${url}")`);
  }

  /** 是否已缓存（实例层）。 */
  has(url: string): boolean {
    return this.instanceCache.has(url);
  }

  /** 当前实例缓存条目数。 */
  size(): number {
    return this.instanceCache.size;
  }

  /** 清空实例缓存（不动 AssetManager 的 Promise 缓存）。 */
  clearInstanceCache(): void {
    this.instanceCache.clear();
  }

  /** 预热（委托给 AssetManager.prewarm）。 */
  async prewarm(entries: PrewarmEntry[]): Promise<{ loaded: number; failed: number }> {
    return this.assetManager.prewarm(entries);
  }

  /** 预取（委托给 AssetManager.prefetch）。 */
  prefetch(source: AssetSource, type: string, ctx?: LoaderContext): Promise<void> {
    return this.assetManager.prefetch(type, source, ctx);
  }
}

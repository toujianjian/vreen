// AssetCache — LRU 资源缓存。
//
// 设计目标：
//   - 与 Loaders/AssetManager 的 Promise 缓存不同，这里缓存的是已解析的资源
//     对象本身（Texture/BufferGeometry/Material 等），用于"按 key 取实例"。
//   - LRU 策略：访问 (get/set) 时把条目移动到 accessOrder 末尾；溢出时从
//     头部淘汰（最久未用）。
//   - maxSize 为条目数上限；0 表示无上限（测试场景常用）。
//   - 不持有资源 dispose 逻辑：调用方在 delete/clear 前应自行释放 GPU 资源。
//
// 线程模型：纯同步 Map 操作，无锁；适合单线程 JS 主循环。

import { createLogger } from '@/lib/logger';

const log = createLogger('AssetCache');

export interface AssetCacheOptions {
  /** 条目数上限。0 = 不限。 */
  maxSize?: number;
}

export class AssetCache<V> {
  /** 容量上限。0 表示不限。运行时可通过 setMaxSize 调整。 */
  maxSize: number;
  /** 实际存储。key → value。 */
  private _cache = new Map<string, V>();
  /** 访问顺序列表（最近访问在末尾）。与 _cache 的 key 保持一一对应。 */
  private _accessOrder: string[] = [];

  constructor(opts: AssetCacheOptions = {}) {
    this.maxSize = opts.maxSize ?? 64;
  }

  /** 读取并刷新访问顺序。未命中返回 undefined。 */
  get(key: string): V | undefined {
    const v = this._cache.get(key);
    if (v === undefined) return undefined;
    this._touch(key);
    return v;
  }

  /** 写入。若 key 已存在则覆盖原值并刷新顺序；否则新建条目，并在溢出时淘汰。 */
  set(key: string, value: V): this {
    if (this._cache.has(key)) {
      this._cache.set(key, value);
      this._touch(key);
      return this;
    }
    this._cache.set(key, value);
    this._accessOrder.push(key);
    this._evictIfNeeded();
    return this;
  }

  /** 是否存在该 key。不刷新访问顺序（只读判定）。 */
  has(key: string): boolean {
    return this._cache.has(key);
  }

  /** 显式删除某条。返回 true 表示原存在。 */
  delete(key: string): boolean {
    if (!this._cache.delete(key)) return false;
    const i = this._accessOrder.indexOf(key);
    if (i >= 0) this._accessOrder.splice(i, 1);
    log.debug(`delete("${key}")`);
    return true;
  }

  /** 清空所有条目。 */
  clear(): void {
    const n = this._cache.size;
    this._cache.clear();
    this._accessOrder.length = 0;
    if (n > 0) log.debug(`clear() — dropped ${n} entries`);
  }

  /** 当前条目数。 */
  get size(): number {
    return this._cache.size;
  }

  /** 调整容量。若新容量小于当前条目数，立即按 LRU 淘汰。 */
  setMaxSize(newMax: number): void {
    this.maxSize = newMax;
    this._evictIfNeeded();
  }

  /** 把 key 移动到访问顺序末尾（最近使用）。 */
  private _touch(key: string): void {
    const i = this._accessOrder.indexOf(key);
    if (i < 0) {
      // _cache 与 _accessOrder 应同步；这里防御性补回。
      this._accessOrder.push(key);
      return;
    }
    if (i === this._accessOrder.length - 1) return; // 已在末尾
    this._accessOrder.splice(i, 1);
    this._accessOrder.push(key);
  }

  /** 容量溢出时从头部（最久未用）淘汰。 */
  private _evictIfNeeded(): void {
    if (this.maxSize <= 0) return;
    while (this._accessOrder.length > this.maxSize) {
      const oldest = this._accessOrder.shift();
      if (oldest === undefined) break;
      this._cache.delete(oldest);
      log.debug(`LRU evict: ${oldest}`);
    }
  }
}

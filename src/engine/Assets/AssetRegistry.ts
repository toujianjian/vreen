// AssetRegistry — 资源注册表。
//
// 与 Loaders/AssetManager 的差异：
//   - AssetManager 关注"加载 + 解析缓存"（按 format/source 缓存 Promise<T>）；
//   - AssetRegistry 关注"已加载资源对象的生命周期"（按 id 注册 + 引用计数），
//     适用于跨模块共享同一个 Texture / Geometry / Material 实例的场景。
//
// 单一职责：
//   - register(id, type, data) → 注册一个已就绪资源
//   - get(id) / has(id)        → 同步查询
//   - addRef(id) / release(id) → 引用计数 +1/-1；归零时调用 unload
//   - unload(id)               → 引用计数减 1（同 release 的副作用路径）
//   - getStats()               → 总数 / 已加载 / 已卸载
//   - clear()                  → 清空所有
//
// 设计要点：
//   - release 与 unload 等价（任务规范要求 unload 减引用计数）。两者都走
//     _decrementRef，归零时触发 onUnload 回调并把条目从 resources 移到
//     _unloaded 集合，便于 getStats 统计。
//   - 不直接持有资源 dispose 逻辑；通过构造选项注入 onUnload(id, handle)
//     回调由调用方决定如何释放 GPU/JS 资源。
//   - 重复 register 同一 id 视为覆盖（覆盖时清掉旧 refCount，发出 warn）。

import { createLogger } from '@/lib/logger';

const log = createLogger('AssetRegistry');

/** 资源类型标识。语义同 AssetManager 的 format 字段串。 */
export type AssetType = string;

/** 已注册资源的句柄。data 为 unknown 以兼容任意引擎对象。 */
export interface AssetHandle<T = unknown> {
  /** 资源 id（由调用方提供，需在注册表内唯一）。 */
  id: string;
  /** 资源类型，如 'texture' / 'geometry' / 'material' / 'gltf'。 */
  type: AssetType;
  /** 资源对象本身。 */
  data: T;
  /** 原始加载 URL（如有）。仅记录用，不影响缓存 key。 */
  url: string | null;
  /** 是否已加载（register 时为 true，unload 后为 false）。 */
  loaded: boolean;
  /** 加载错误（如果加载失败由 markError 标记）。 */
  error: Error | null;
}

export interface AssetRegistryOptions {
  /** 资源引用归零时触发。调用方在此释放 GPU/JS 资源。 */
  onUnload?: <T = unknown>(id: string, handle: AssetHandle<T>) => void;
}

export interface AssetRegistryStats {
  /** 当前已加载条目数。 */
  loaded: number;
  /** 累计已卸载条目数（不含当前 loaded）。 */
  unloaded: number;
  /** 总条目数 = loaded + unloaded。 */
  total: number;
  /** 当前活跃引用总数（所有 loaded 条目的 refCount 之和）。 */
  activeRefs: number;
}

export class AssetRegistry {
  /** id → 资源句柄。loaded=true 的条目。 */
  private _resources = new Map<string, AssetHandle>();
  /** id → 引用计数。与 _resources 的 key 一一对应。 */
  private _refCount = new Map<string, number>();
  /** 已卸载条目的 id 集合（用于 getStats 统计）。 */
  private _unloaded = new Set<string>();
  private _onUnload?: (id: string, handle: AssetHandle) => void;

  constructor(opts: AssetRegistryOptions = {}) {
    this._onUnload = opts.onUnload;
  }

  /** 注册一个已就绪资源。引用计数从 1 开始（注册者持有一份引用）。
   *  重复注册同一 id 时覆盖原条目（释放旧引用）。 */
  register<T>(id: string, type: AssetType, data: T, url: string | null = null): AssetHandle<T> {
    if (this._resources.has(id)) {
      log.warn(`register("${id}") — overriding existing entry (old refCount=${this._refCount.get(id) ?? 0})`);
      // 直接丢弃旧条目记录（不触发 onUnload，由调用方决定如何处理旧 data）
      this._resources.delete(id);
      this._refCount.delete(id);
    }
    const handle: AssetHandle<T> = {
      id,
      type,
      data,
      url,
      loaded: true,
      error: null,
    };
    this._resources.set(id, handle as AssetHandle);
    this._refCount.set(id, 1);
    this._unloaded.delete(id);
    log.info(`register("${id}", type="${type}") — refCount=1`);
    return handle;
  }

  /** 把某条目标记为加载失败（loader 失败时调用）。 */
  markError(id: string, error: Error): void {
    const h = this._resources.get(id);
    if (!h) {
      log.warn(`markError("${id}") — id not registered`);
      return;
    }
    h.error = error;
    h.loaded = false;
  }

  /** 同步获取资源句柄。未注册或已卸载返回 undefined。 */
  get<T = unknown>(id: string): AssetHandle<T> | undefined {
    const h = this._resources.get(id);
    return h as AssetHandle<T> | undefined;
  }

  /** 是否存在且 loaded。 */
  has(id: string): boolean {
    const h = this._resources.get(id);
    return !!h && h.loaded;
  }

  /** 引用计数 +1。返回新计数值；未注册返回 0。 */
  addRef(id: string): number {
    const cur = this._refCount.get(id);
    if (cur === undefined) {
      log.warn(`addRef("${id}") — id not registered`);
      return 0;
    }
    const next = cur + 1;
    this._refCount.set(id, next);
    return next;
  }

  /** 引用计数 -1（同 unload 的语义）。归零时触发 onUnload 并把条目移出注册表。
   *  返回剩余计数值；归零返回 0；未注册返回 0。 */
  release(id: string): number {
    return this._decrementRef(id);
  }

  /** 任务规范：unload(id) 等价于 release(id)（引用计数减 1）。 */
  unload(id: string): number {
    return this._decrementRef(id);
  }

  /** 当前引用计数。未注册返回 0。 */
  refCount(id: string): number {
    return this._refCount.get(id) ?? 0;
  }

  /** 统计信息。 */
  getStats(): AssetRegistryStats {
    let activeRefs = 0;
    for (const n of this._refCount.values()) activeRefs += n;
    return {
      loaded: this._resources.size,
      unloaded: this._unloaded.size,
      total: this._resources.size + this._unloaded.size,
      activeRefs,
    };
  }

  /** 清空所有资源。不触发 onUnload（调用方应在 clear 前自行释放）。 */
  clear(): void {
    const n = this._resources.size;
    this._resources.clear();
    this._refCount.clear();
    this._unloaded.clear();
    if (n > 0) log.info(`clear() — dropped ${n} entries`);
  }

  // ── private ───────────────────────────────────────────────────

  private _decrementRef(id: string): number {
    const cur = this._refCount.get(id);
    if (cur === undefined) {
      log.warn(`release/unload("${id}") — id not registered`);
      return 0;
    }
    const next = cur - 1;
    if (next > 0) {
      this._refCount.set(id, next);
      return next;
    }
    // 归零：触发 onUnload，移除条目，记入 _unloaded。
    const handle = this._resources.get(id);
    if (handle) {
      handle.loaded = false;
      if (this._onUnload) {
        try {
          this._onUnload(id, handle);
        } catch (err) {
          log.error(`onUnload("${id}") threw: ${(err as Error).message ?? err}`);
        }
      }
    }
    this._resources.delete(id);
    this._refCount.delete(id);
    this._unloaded.add(id);
    log.info(`release/unload("${id}") — refCount reached 0, unloaded`);
    return 0;
  }
}

/** 全局单例（应用层通常只需要一个）。 */
let _default: AssetRegistry | null = null;
export function getDefaultAssetRegistry(): AssetRegistry {
  if (!_default) _default = new AssetRegistry();
  return _default;
}

/** 测试 / 资源回收：重置全局单例。 */
export function resetDefaultAssetRegistry(): void {
  _default?.clear();
  _default = null;
}

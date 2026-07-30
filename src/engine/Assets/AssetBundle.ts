// AssetBundle — 资源打包 / 加载系统。
//
// 设计目标:
//   - 类似 Unity AssetBundle / O3DE Asset Seed:把多个资源(mesh/texture/audio/...)
//     打包成一个有名 bundle,带 manifest(资产清单 + 校验信息),支持依赖声明、
//     并发加载限流、缓存与卸载。
//   - 与 Loaders/AssetManager、Assets/AssetLoader 互补:
//       * AssetManager 关注"按 format/source 解析缓存",细粒度。
//       * AssetBundle 关注"按业务包加载/卸载",粗粒度(一个场景/角色/关卡一个包)。
//   - 数据源:本类只管理 manifest + 加载状态 + 已加载资源 Map;实际 fetch/decode
//     由调用方通过 createBundle 注入的 assets 提供,或通过 registerBundle +
//     loadBundle 时机由调用方填入 data。这样保持引擎零运行时依赖,且测试友好。
//
// 用法:
//   const ab = new AssetBundle();
//   ab.createBundle('player', [
//     { name: 'mesh', type: 'mesh', size: 1024, hash: 'a1' },
//     { name: 'tex',  type: 'texture', size: 2048, hash: 'b2' },
//   ]);
//   await ab.loadBundle('player'); // 调用方在 onLoad 回调里填入 data
//   const mesh = ab.getAsset('player', 'mesh');
//
// 线程模型:加载为 Promise,但并发由 maxConcurrentLoads 限制(简单计数 + 队列)。

import { createLogger } from '@/lib/logger';

const log = createLogger('AssetBundle');

/** 资源类型标识。 */
export type AssetType = 'mesh' | 'texture' | 'audio' | 'animation' | 'material' | 'scene';

/** 单条资源清单条目。 */
export interface AssetEntry {
  /** 资源名(包内唯一)。 */
  name: string;
  /** 资源类型。 */
  type: AssetType;
  /** 字节大小(用于统计与进度估算)。 */
  size: number;
  /** 内容哈希(用于校验/版本对齐)。 */
  hash: string;
}

/** Bundle 清单。 */
export interface AssetManifest {
  /** 资源条目列表。 */
  assets: AssetEntry[];
  /** 总字节数(所有 assets 之和)。 */
  totalSize: number;
  /** manifest 版本号。 */
  version: string;
  /** 整包校验和(可由调用方计算后填入)。 */
  checksum: string;
}

/** 已注册的 Bundle 条目。 */
export interface AssetBundleEntry {
  /** Bundle 名(全局唯一)。 */
  name: string;
  /** 清单。 */
  manifest: AssetManifest;
  /** 依赖的其他 Bundle 名列表(加载本包前会先加载依赖)。 */
  dependencies: string[];
  /** 是否已加载完成。 */
  isLoaded: boolean;
  /** 已加载的资源数据(name → 资源对象)。 */
  data: Map<string, unknown>;
}

/** Bundle 加载选项。 */
export interface AssetBundleOptions {
  /** 最大并发加载数。 */
  maxConcurrentLoads?: number;
  /** 是否启用"压缩"标记(仅记录,实际压缩由调用方实现)。 */
  compressionEnabled?: boolean;
  /** 自定义加载函数:接收 bundle 名,返回资源数据 Map。 */
  loader?: (name: string) => Promise<Map<string, unknown>>;
}

/** Bundle 信息(对外暴露的只读视图)。 */
export interface BundleInfo {
  name: string;
  version: string;
  assetCount: number;
  totalSize: number;
  checksum: string;
  isLoaded: boolean;
  dependencies: string[];
}

/** 加载进度信息。 */
export interface LoadingProgress {
  /** 队列中待加载数。 */
  queued: number;
  /** 当前并发加载数。 */
  active: number;
  /** 已完成加载数(本批次)。 */
  completed: number;
  /** 进度比例(0..1,基于 completed / (completed + queued + active))。 */
  ratio: number;
}

/** AssetBundle 统计信息。 */
export interface AssetBundleStats {
  /** 已注册 Bundle 数。 */
  registeredBundles: number;
  /** 已加载 Bundle 数。 */
  loadedBundles: number;
  /** 当前并发加载数。 */
  activeLoads: number;
  /** 队列长度。 */
  queueLength: number;
  /** 缓存条目数。 */
  cacheSize: number;
  /** 已加载资源总数(所有 bundle 的 data 条目之和)。 */
  totalAssets: number;
  /** 累计加载字节数。 */
  totalLoadedBytes: number;
}

export class AssetBundle {
  /** 已注册的 Bundle(name → entry)。 */
  bundles: Map<string, AssetBundleEntry> = new Map();
  /** 已加载完成的 Bundle 名集合。 */
  loadedBundles: Set<string> = new Set();
  /** 加载队列(按入队顺序)。 */
  loadingQueue: string[] = [];
  /** 最大并发加载数。 */
  maxConcurrentLoads: number;
  /** 当前并发加载数。 */
  activeLoads: number = 0;
  /** 已加载资源缓存(全局,key = `${bundleName}:${assetName}`)。 */
  cache: Map<string, unknown> = new Map();
  /** 是否启用压缩标记。 */
  compressionEnabled: boolean;

  /** 自定义加载器(可选)。 */
  private _loader?: (name: string) => Promise<Map<string, unknown>>;
  /** 已完成的加载数(用于 getLoadingProgress)。 */
  private _completedLoads: number = 0;
  /** 进行中的 Promise(避免重复触发同一 bundle)。 */
  private _pending: Map<string, Promise<void>> = new Map();
  /** 等待并发槽位的 resolver 队列(FIFO)。 */
  private _waiters: Array<() => void> = [];

  constructor(opts: AssetBundleOptions = {}) {
    this.maxConcurrentLoads = opts.maxConcurrentLoads ?? 4;
    this.compressionEnabled = opts.compressionEnabled ?? false;
    this._loader = opts.loader;
  }

  /**
   * 创建资源包:注册 manifest + 立即标记为已加载并把 assets 写入 data。
   * 适用于"内存中已构造好的资源"打包场景(无需异步加载)。
   */
  createBundle(name: string, assets: AssetEntry[], data?: Map<string, unknown>): AssetBundleEntry {
    if (this.bundles.has(name)) {
      log.warn(`createBundle("${name}") — overriding existing bundle`);
    }
    const totalSize = assets.reduce((s, a) => s + a.size, 0);
    const manifest: AssetManifest = {
      assets: [...assets],
      totalSize,
      version: '1.0.0',
      checksum: _computeChecksum(name, assets),
    };
    const entry: AssetBundleEntry = {
      name,
      manifest,
      dependencies: [],
      isLoaded: false,
      data: new Map(),
    };
    this.bundles.set(name, entry);
    // 若提供 data,立即标记为已加载并写入缓存。
    if (data) {
      for (const [k, v] of data) entry.data.set(k, v);
      entry.isLoaded = true;
      this.loadedBundles.add(name);
      for (const [k, v] of data) this.cache.set(`${name}:${k}`, v);
    }
    log.info(`createBundle("${name}") — ${assets.length} assets, ${totalSize} bytes`);
    return entry;
  }

  /**
   * 加载资源包:返回 Promise,完成后 isLoaded=true。
   * - 先递归加载 dependencies;
   * - 若已加载,直接 resolve;
   * - 若已在加载中,返回同一 Promise;
   * - 否则入队,按 maxConcurrentLoads 限流执行。
   * 实际数据来源:若注入了 loader,则调用 loader(name);否则仅标记 isLoaded=true
   * (调用方应在 registerBundle 后自行通过 getAsset 写入数据,或用 createBundle)。
   */
  loadBundle(name: string): Promise<void> {
    const entry = this.bundles.get(name);
    if (!entry) {
      return Promise.reject(new Error(`loadBundle("${name}") — bundle not registered`));
    }
    if (entry.isLoaded) return Promise.resolve();
    const pending = this._pending.get(name);
    if (pending) return pending;

    const p = (async () => {
      // 1. 先加载依赖。
      for (const dep of entry.dependencies) {
        await this.loadBundle(dep);
      }
      // 2. 入队 + 等待并发槽。
      await this._acquireSlot(name);
      try {
        // 3. 实际加载。
        if (this._loader) {
          const data = await this._loader(name);
          for (const [k, v] of data) {
            entry.data.set(k, v);
            this.cache.set(`${name}:${k}`, v);
          }
        }
        entry.isLoaded = true;
        this.loadedBundles.add(name);
        this._completedLoads++;
        log.info(`loadBundle("${name}") — loaded`);
      } catch (err) {
        log.error(`loadBundle("${name}") failed: ${(err as Error).message ?? err}`);
        throw err;
      } finally {
        this._releaseSlot();
      }
    })();

    this._pending.set(name, p);
    // Promise 完成后清理 pending(无论成功/失败)。
    p.finally(() => this._pending.delete(name)).catch(() => { /* 已 reject 由 caller 处理 */ });
    return p;
  }

  /** 卸载资源包:标记为未加载,清理 data 与缓存条目。 */
  unloadBundle(name: string): boolean {
    const entry = this.bundles.get(name);
    if (!entry) return false;
    if (!entry.isLoaded) return false;
    // 清理缓存。
    for (const k of entry.data.keys()) {
      this.cache.delete(`${name}:${k}`);
    }
    entry.data.clear();
    entry.isLoaded = false;
    this.loadedBundles.delete(name);
    log.info(`unloadBundle("${name}")`);
    return true;
  }

  /** 检查 Bundle 是否已加载。未注册返回 false。 */
  isBundleLoaded(name: string): boolean {
    return this.bundles.get(name)?.isLoaded ?? false;
  }

  /**
   * 获取资源。要求 Bundle 已加载,且 assetName 存在于 manifest。
   * 未加载/未注册/不存在返回 undefined。
   */
  getAsset<T = unknown>(bundleName: string, assetName: string): T | undefined {
    const entry = this.bundles.get(bundleName);
    if (!entry || !entry.isLoaded) return undefined;
    const v = entry.data.get(assetName);
    if (v !== undefined) return v as T;
    // 回退到全局缓存(兼容 createBundle 注入的数据)。
    return this.cache.get(`${bundleName}:${assetName}`) as T | undefined;
  }

  /** 检查资源是否存在(Bundle 已加载且 manifest 包含该 name)。 */
  hasAsset(bundleName: string, assetName: string): boolean {
    const entry = this.bundles.get(bundleName);
    if (!entry || !entry.isLoaded) return false;
    return entry.data.has(assetName) || entry.manifest.assets.some((a) => a.name === assetName);
  }

  /** 注册资源包(不加载):仅写入 manifest,等后续 loadBundle 触发。 */
  registerBundle(name: string, manifest: AssetManifest): AssetBundleEntry {
    if (this.bundles.has(name)) {
      log.warn(`registerBundle("${name}") — overriding existing bundle`);
    }
    const entry: AssetBundleEntry = {
      name,
      manifest: {
        assets: [...manifest.assets],
        totalSize: manifest.totalSize,
        version: manifest.version,
        checksum: manifest.checksum,
      },
      dependencies: [],
      isLoaded: false,
      data: new Map(),
    };
    this.bundles.set(name, entry);
    log.info(`registerBundle("${name}") — ${manifest.assets.length} assets`);
    return entry;
  }

  /** 添加依赖关系(本包加载前会先加载依赖)。 */
  addDependency(bundleName: string, dependency: string): boolean {
    const entry = this.bundles.get(bundleName);
    if (!entry) return false;
    if (entry.dependencies.includes(dependency)) return true;
    entry.dependencies.push(dependency);
    return true;
  }

  /** 获取指定 Bundle 的依赖列表(副本)。未注册返回空数组。 */
  getDependencies(name: string): string[] {
    const entry = this.bundles.get(name);
    return entry ? [...entry.dependencies] : [];
  }

  /** 启用/禁用压缩标记。 */
  setCompression(enabled: boolean): void {
    this.compressionEnabled = enabled;
  }

  /** 设置最大并发加载数。 */
  setMaxConcurrentLoads(max: number): void {
    this.maxConcurrentLoads = Math.max(1, Math.floor(max));
  }

  /** 获取当前加载进度(基于队列 + 并发 + 已完成)。 */
  getLoadingProgress(): LoadingProgress {
    const queued = this.loadingQueue.length;
    const active = this.activeLoads;
    const completed = this._completedLoads;
    const total = queued + active + completed;
    return {
      queued,
      active,
      completed,
      ratio: total > 0 ? completed / total : 1,
    };
  }

  /** 获取已加载 Bundle 名列表(数组,顺序按 Set 迭代序)。 */
  getLoadedBundles(): string[] {
    return Array.from(this.loadedBundles);
  }

  /** 获取 Bundle 信息(只读视图)。未注册返回 undefined。 */
  getBundleInfo(name: string): BundleInfo | undefined {
    const entry = this.bundles.get(name);
    if (!entry) return undefined;
    return {
      name: entry.name,
      version: entry.manifest.version,
      assetCount: entry.manifest.assets.length,
      totalSize: entry.manifest.totalSize,
      checksum: entry.manifest.checksum,
      isLoaded: entry.isLoaded,
      dependencies: [...entry.dependencies],
    };
  }

  /** 清除全局资源缓存(不影响 Bundle 自身的 data)。 */
  clearCache(): void {
    const n = this.cache.size;
    this.cache.clear();
    if (n > 0) log.debug(`clearCache() — dropped ${n} entries`);
  }

  /** 导出指定 Bundle 的 manifest 副本。未注册返回 undefined。 */
  exportManifest(name: string): AssetManifest | undefined {
    const entry = this.bundles.get(name);
    if (!entry) return undefined;
    return {
      assets: entry.manifest.assets.map((a) => ({ ...a })),
      totalSize: entry.manifest.totalSize,
      version: entry.manifest.version,
      checksum: entry.manifest.checksum,
    };
  }

  /** 获取统计信息。 */
  getStats(): AssetBundleStats {
    let totalAssets = 0;
    let totalLoadedBytes = 0;
    for (const entry of this.bundles.values()) {
      if (entry.isLoaded) {
        totalAssets += entry.data.size;
        totalLoadedBytes += entry.manifest.totalSize;
      }
    }
    return {
      registeredBundles: this.bundles.size,
      loadedBundles: this.loadedBundles.size,
      activeLoads: this.activeLoads,
      queueLength: this.loadingQueue.length,
      cacheSize: this.cache.size,
      totalAssets,
      totalLoadedBytes,
    };
  }

  // ── private ───────────────────────────────────────────────────

  /**
   * 获取并发加载槽位:若 activeLoads < maxConcurrentLoads 则立即返回;
   * 否则入队等待。队列按 FIFO 唤醒。
   */
  private _acquireSlot(name: string): Promise<void> {
    if (this.activeLoads < this.maxConcurrentLoads) {
      this.activeLoads++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      // 入队等待:loadingQueue 跟踪 name 顺序,_waiters 跟踪 resolver。
      this.loadingQueue.push(name);
      this._waiters.push(resolve);
    });
  }

  /** 释放并发加载槽位,并唤醒队列首部的等待者。 */
  private _releaseSlot(): void {
    if (this._waiters.length > 0) {
      // 把槽位转交给下一个等待者(保持 activeLoads 不变)。
      const next = this._waiters.shift()!;
      // 同时从 loadingQueue 移除对应的 name(队列首部)。
      this.loadingQueue.shift();
      try {
        next();
      } catch (e) {
        // resolver 抛错不应影响后续调度。
        log.error(`_releaseSlot waiter threw: ${(e as Error).message ?? e}`);
        this.activeLoads--;
      }
      return;
    }
    this.activeLoads--;
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────

/**
 * 计算 Bundle 校验和(简易哈希,基于 name + assets 拼接)。
 * 非加密强度,用于版本对齐与变更检测;调用方可覆盖 manifest.checksum。
 */
function _computeChecksum(name: string, assets: AssetEntry[]): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  const str = name + '|' + assets.map((a) => `${a.name}:${a.type}:${a.size}:${a.hash}`).join('|');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0; // FNV prime
  }
  return h.toString(16).padStart(8, '0');
}

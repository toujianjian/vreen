// HotReloader — 资源热重载系统。
//
// 设计原则 (参考 Webpack DevServer / Vite HMR / Unity Hot Reload):
//   - 监视文件变化 → 防抖聚合 → 触发重载回调 → 状态保持 / 恢复。
//   - FileWatcher 持 path + lastModified + callback; checkChanges() 轮询
//     mtime (跨平台,无需 fs.watch 的 OS 句柄;Node/Electron 主进程可用,
//     浏览器侧可注入 fetch/stat adapter)。
//   - LoadedResource 记录 path / type / data / lastReload / reloadCount,
//     供状态恢复使用。
//   - debounceTime 默认 100ms: 同一资源短时间多次变化聚合为一次重载。
//   - update(dt) 是主循环入口: 检查 mtime + 处理 pendingReloads。
//
// 与 AssetLoader / AssetRegistry 的差异:
//   - AssetLoader 关注"加载与缓存";
//   - AssetRegistry 关注"引用计数与生命周期";
//   - HotReloader 关注"变化检测与重载调度"。
//   三者正交: HotReloader 触发重载 → 调用方用 AssetLoader.invalidate + load
//   重新加载,并用 saveState/restoreState 保持场景状态。
//
// 不变量:
//   - addWatch 同 path 覆盖 (更新 callback + lastModified);
//   - checkChanges 只在 isWatching=true 时生效;
//   - reloadResource 触发 callback (若注册) 并更新 LoadedResource;
//   - saveState/restoreState 是简单的 stateful Memento,由调用方决定状态内容。

import { createLogger } from '@/lib/logger';
import * as fs from 'fs';

const log = createLogger('HotReloader');

/** 文件监视条目。 */
export interface FileWatcher {
  /** 监视的绝对路径。 */
  path: string;
  /** 上次记录的修改时间 (ms since epoch)。 */
  lastModified: number;
  /** 文件变化时触发的回调 (path → 资源已重载)。 */
  callback: (path: string) => void;
}

/** 已加载资源记录。 */
export interface LoadedResource {
  /** 资源路径 (唯一 key)。 */
  path: string;
  /** 资源类型 (如 'texture' / 'gltf' / 'material')。 */
  type: string;
  /** 资源数据 (由调用方注入)。 */
  data: any;
  /** 上次重载时间戳 (ms since epoch)。 */
  lastReload: number;
  /** 累计重载次数。 */
  reloadCount: number;
}

/** 待重载条目。 */
export interface PendingReload {
  /** 资源路径。 */
  path: string;
  /** 触发时间戳 (用于防抖判定)。 */
  triggeredAt: number;
}

/** HotReloader 统计信息。 */
export interface HotReloaderStats {
  /** 监视路径数。 */
  watchCount: number;
  /** 已加载资源数。 */
  loadedResourceCount: number;
  /** 是否正在监视。 */
  isWatching: boolean;
  /** 防抖时间 (ms)。 */
  debounceTime: number;
  /** 待重载数。 */
  pendingCount: number;
  /** 累计重载次数。 */
  totalReloads: number;
  /** 最近一次重载时间。 */
  lastReloadAt: number | null;
}

/**
 * 资源热重载系统。
 *
 * 典型用法:
 * ```ts
 * const hr = new HotReloader();
 * hr.addWatch('/assets/tex.png', (path) => {
 *   console.log('reloading', path);
 * });
 * hr.registerResource('/assets/tex.png', 'texture', texInstance);
 * hr.startWatching();
 * // 主循环中:
 * hr.update(dt);
 * ```
 */
export class HotReloader {
  /** 监视路径列表 (与 watchers 的 key 一一对应)。 */
  watchPaths: string[] = [];
  /** path → FileWatcher。 */
  watchers: Map<string, FileWatcher> = new Map();
  /** path → LoadedResource。 */
  loadedResources: Map<string, LoadedResource> = new Map();
  /** 是否正在监视。 */
  isWatching: boolean = false;
  /** 防抖时间 (ms)。同一资源在此时间内多次变化聚合为一次重载。 */
  debounceTime: number = 100;
  /** path → 触发时间戳 (待重载队列)。 */
  pendingReloads: Map<string, number> = new Map();

  /** 累计重载次数。 */
  private _totalReloads: number = 0;
  /** 最近一次重载时间戳。 */
  private _lastReloadAt: number | null = null;
  /** 内部时钟 (ms,由 update 累加)。 */
  private _clock: number = 0;
  /** 状态快照 (由 saveState 设置,restoreState 消费)。 */
  private _stateSnapshot: any = null;
  /** stat 函数 (可注入,默认 fs.statSync)。 */
  private _stat: (path: string) => { mtimeMs: number } | null;

  constructor(opts?: {
    debounceTime?: number;
    /** 自定义 stat 函数 (测试 / 浏览器环境注入)。 */
    statFn?: (path: string) => { mtimeMs: number } | null;
  }) {
    if (opts?.debounceTime !== undefined) this.debounceTime = opts.debounceTime;
    this._stat = opts?.statFn ?? defaultStat;
  }

  // ── 监视管理 ────────────────────────────────────────────────

  /**
   * 添加监视。同 path 覆盖 (更新 callback + 重读 lastModified)。
   * @param path 监视的绝对路径
   * @param callback 文件变化时触发的回调
   */
  addWatch(path: string, callback: (path: string) => void): void {
    const existing = this.watchers.get(path);
    const mtime = this._safeStat(path);
    if (existing) {
      existing.callback = callback;
      existing.lastModified = mtime;
      log.debug(`addWatch("${path}") — updated existing watcher`);
    } else {
      this.watchers.set(path, { path, lastModified: mtime, callback });
      this.watchPaths.push(path);
      log.debug(`addWatch("${path}") — new watcher, mtime=${mtime}`);
    }
  }

  /**
   * 移除监视。返回是否成功移除。
   */
  removeWatch(path: string): boolean {
    if (!this.watchers.delete(path)) return false;
    const i = this.watchPaths.indexOf(path);
    if (i >= 0) this.watchPaths.splice(i, 1);
    this.pendingReloads.delete(path);
    log.debug(`removeWatch("${path}")`);
    return true;
  }

  /** 开始监视 (设置 isWatching=true)。 */
  startWatching(): void {
    if (this.isWatching) {
      log.debug('startWatching() — already watching');
      return;
    }
    this.isWatching = true;
    log.info(`startWatching() — ${this.watchers.size} paths`);
  }

  /** 停止监视 (设置 isWatching=false,不清除 watchers)。 */
  stopWatching(): void {
    if (!this.isWatching) return;
    this.isWatching = false;
    log.info('stopWatching()');
  }

  /**
   * 检查所有 watcher 的 mtime 变化。变化则加入 pendingReloads。
   * 仅在 isWatching=true 时生效。
   * @returns 本次检查发现变化的路径列表
   */
  checkChanges(): string[] {
    if (!this.isWatching) return [];
    const changed: string[] = [];
    const now = this._clock;
    for (const [path, w] of this.watchers) {
      const mtime = this._safeStat(path);
      if (mtime > w.lastModified) {
        w.lastModified = mtime;
        // 防抖: 记录触发时间,等 debounceTime 后由 update 触发重载。
        this.pendingReloads.set(path, now);
        changed.push(path);
        log.debug(`checkChanges() — "${path}" changed (mtime=${mtime})`);
      }
    }
    return changed;
  }

  /**
   * 重载指定资源。触发 watcher.callback (若注册) 并更新 LoadedResource。
   * 未注册资源则只触发回调。
   * @param path 资源路径
   * @returns 是否成功 (path 在 watchers 中或 loadedResources 中)
   */
  reloadResource(path: string): boolean {
    const w = this.watchers.get(path);
    const rec = this.loadedResources.get(path);
    if (!w && !rec) {
      log.warn(`reloadResource("${path}") — not watched nor registered`);
      return false;
    }
    const now = Date.now();
    // 触发回调
    if (w) {
      try {
        w.callback(path);
      } catch (err) {
        log.error(`reloadResource("${path}") — callback threw: ${(err as Error).message ?? err}`);
      }
    }
    // 更新 LoadedResource
    if (rec) {
      rec.lastReload = now;
      rec.reloadCount++;
    }
    this._totalReloads++;
    this._lastReloadAt = now;
    // 从 pending 中移除
    this.pendingReloads.delete(path);
    log.info(`reloadResource("${path}") — reloaded (count=${rec?.reloadCount ?? 0})`);
    return true;
  }

  // ── 资源管理 ────────────────────────────────────────────────

  /**
   * 注册资源 (与 watcher 配合使用)。
   * 同 path 覆盖; reloadCount 保留。
   */
  registerResource(path: string, type: string, data: any): LoadedResource {
    const existing = this.loadedResources.get(path);
    const rec: LoadedResource = {
      path,
      type,
      data,
      lastReload: existing?.lastReload ?? 0,
      reloadCount: existing?.reloadCount ?? 0,
    };
    this.loadedResources.set(path, rec);
    log.debug(`registerResource("${path}", type="${type}")`);
    return rec;
  }

  /**
   * 注销资源。返回是否成功移除。
   */
  unregisterResource(path: string): boolean {
    const removed = this.loadedResources.delete(path);
    if (removed) log.debug(`unregisterResource("${path}")`);
    return removed;
  }

  /** 获取所有已加载资源 (快照数组)。 */
  getLoadedResources(): LoadedResource[] {
    return Array.from(this.loadedResources.values());
  }

  /** 获取指定资源。未注册返回 undefined。 */
  getResource(path: string): LoadedResource | undefined {
    return this.loadedResources.get(path);
  }

  /** 是否在监视该路径。 */
  isWatchingPath(path: string): boolean {
    return this.watchers.has(path);
  }

  // ── 防抖 / 待重载 ────────────────────────────────────────────

  /** 设置防抖时间 (ms)。 */
  setDebounceTime(time: number): void {
    if (time < 0) {
      log.warn(`setDebounceTime(${time}) — negative not allowed, clamped to 0`);
      time = 0;
    }
    this.debounceTime = time;
    log.debug(`setDebounceTime(${time}ms)`);
  }

  /** 获取待重载路径列表 (快照)。 */
  getPendingReloads(): PendingReload[] {
    return Array.from(this.pendingReloads.entries()).map(([path, triggeredAt]) => ({
      path,
      triggeredAt,
    }));
  }

  /** 清除所有待重载。 */
  clearPending(): void {
    const n = this.pendingReloads.size;
    this.pendingReloads.clear();
    if (n > 0) log.debug(`clearPending() — dropped ${n} pending reloads`);
  }

  // ── 主循环 ───────────────────────────────────────────────────

  /**
   * 每帧更新: 检查 mtime 变化 + 处理 pendingReloads (防抖到期触发重载)。
   * @param dt 帧间隔 (秒)
   */
  update(dt: number): void {
    if (!this.isWatching) return;
    // dt 是秒,转 ms 累加到内部时钟。
    this._clock += dt * 1000;
    // 1. 检查文件变化
    this.checkChanges();
    // 2. 处理待重载: 防抖到期则触发
    if (this.pendingReloads.size === 0) return;
    const due: string[] = [];
    for (const [path, triggeredAt] of this.pendingReloads) {
      if (this._clock - triggeredAt >= this.debounceTime) {
        due.push(path);
      }
    }
    for (const path of due) {
      this.reloadResource(path);
    }
  }

  // ── 状态保持 / 恢复 ─────────────────────────────────────────

  /**
   * 保存状态 (用于重载后恢复)。
   * @param state 任意可序列化状态 (由调用方决定内容)
   */
  saveState(state?: any): any {
    const snapshot = state ?? this._stateSnapshot;
    this._stateSnapshot = snapshot;
    log.debug(`saveState() — snapshot saved`);
    return snapshot;
  }

  /**
   * 恢复状态 (返回之前 saveState 保存的快照)。
   * 未保存返回 undefined。
   */
  restoreState(state?: any): any {
    if (state !== undefined) {
      this._stateSnapshot = state;
      return state;
    }
    // _stateSnapshot 初始为 null; 规范要求未保存返回 undefined。
    return this._stateSnapshot ?? undefined;
  }

  // ── 统计 ────────────────────────────────────────────────────

  /** 获取统计信息。 */
  getStats(): HotReloaderStats {
    return {
      watchCount: this.watchers.size,
      loadedResourceCount: this.loadedResources.size,
      isWatching: this.isWatching,
      debounceTime: this.debounceTime,
      pendingCount: this.pendingReloads.size,
      totalReloads: this._totalReloads,
      lastReloadAt: this._lastReloadAt,
    };
  }

  /** 清空所有 (watchers + resources + pending + 状态)。 */
  clear(): void {
    const w = this.watchers.size;
    const r = this.loadedResources.size;
    this.watchers.clear();
    this.watchPaths.length = 0;
    this.loadedResources.clear();
    this.pendingReloads.clear();
    this._stateSnapshot = null;
    this._totalReloads = 0;
    this._lastReloadAt = null;
    this._clock = 0;
    this.isWatching = false;
    if (w + r > 0) log.info(`clear() — dropped ${w} watchers, ${r} resources`);
  }

  // ── private ─────────────────────────────────────────────────

  /** 安全 stat: 失败返回 0 (文件不存在 / 无权限)。 */
  private _safeStat(path: string): number {
    try {
      const r = this._stat(path);
      return r?.mtimeMs ?? 0;
    } catch {
      return 0;
    }
  }
}

/**
 * 默认 stat 函数: 使用 fs.statSync 读取 mtimeMs。
 * 失败 (文件不存在等) 返回 null。
 */
function defaultStat(path: string): { mtimeMs: number } | null {
  try {
    const stat = fs.statSync(path);
    return { mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/** 全局默认 HotReloader 单例 (与 getDefaultAssetRegistry 风格一致)。 */
let _default: HotReloader | null = null;
export function getDefaultHotReloader(): HotReloader {
  if (!_default) _default = new HotReloader();
  return _default;
}

/** 测试 / 重置全局单例。 */
export function resetDefaultHotReloader(): void {
  _default?.clear();
  _default = null;
}

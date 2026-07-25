// LocalStorageAdapter — 存档系统的本地存储适配器。
//
// 设计目标：
//   - 抽象"按 key 读写 string"的存储层，使 SaveSystem 不直接依赖 localStorage；
//   - 浏览器侧使用 window.localStorage；Node/测试侧使用内存 Map 兜底
//     (localStorage 在 vitest environment: 'node' 下不存在)；
//   - 所有 key 加前缀，避免与其他模块的 localStorage 数据冲突。
//
// 接口 StorageAdapter 是一个最小契约，未来可被 IndexedDBAdapter /
// FileSystemAdapter 实现，注入到 SaveSystem 中。

import { createLogger } from '@/lib/logger';

const log = createLogger('LocalStorageAdapter');

/** 存储适配器契约：按 key 读写 string。 */
export interface StorageAdapter {
  save(key: string, data: string): void;
  load(key: string): string | null;
  remove(key: string): void;
  exists(key: string): boolean;
  clear(): void;
}

/** LocalStorageAdapter 选项。 */
export interface LocalStorageAdapterOptions {
  /** key 前缀，默认 'vreen:save:'。 */
  prefix?: string;
  /** 注入自定义的 localStorage 实现（测试用）。若不提供，自动检测全局 localStorage。 */
  backend?: StorageBackend;
}

/** 底层后端契约（window.localStorage 的子集）。 */
export interface StorageBackend {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
  clear(): void;
}

/** 内存后端 —— 测试 / Node 环境兜底。实现完整 localStorage 接口 (含 length/key)，
 *  以便 LocalStorageAdapter.clear() 的按前缀过滤路径对内存后端也生效。 */
export class MemoryStorageBackend implements StorageBackend {
  private _store = new Map<string, string>();
  /** key 插入顺序的快照（与 Map 迭代顺序一致）。 */
  private _keys(): string[] {
    return Array.from(this._store.keys());
  }
  setItem(key: string, value: string): void {
    this._store.set(key, value);
  }
  getItem(key: string): string | null {
    return this._store.has(key) ? this._store.get(key)! : null;
  }
  removeItem(key: string): void {
    this._store.delete(key);
  }
  clear(): void {
    this._store.clear();
  }
  /** 当前条目数 (兼容 localStorage.length)。 */
  get length(): number {
    return this._store.size;
  }
  /** 按索引取 key (兼容 localStorage.key)。越界返回 null。 */
  key(index: number): string | null {
    const k = this._keys()[index];
    return k === undefined ? null : k;
  }
}

/**
 * 默认后端选择：
 *   - 浏览器 / jsdom：window.localStorage；
 *   - Node (vitest environment: 'node')：MemoryStorageBackend。
 */
function pickDefaultBackend(): StorageBackend {
  const g = globalThis as {
    localStorage?: StorageBackend;
  };
  if (g.localStorage) return g.localStorage;
  log.warn(
    'LocalStorageAdapter — global localStorage not found, falling back to MemoryStorageBackend',
  );
  return new MemoryStorageBackend();
}

/**
 * LocalStorageAdapter —— 基于 (内存或浏览器) localStorage 的字符串键值存储。
 *
 * - 所有 key 自动加前缀，避免污染全局 localStorage 命名空间。
 * - save/load 抛错时不吞异常（数据完整性优先），但 localStorage 满时
 *   会抛 QuotaExceededError，由调用方决定是否删除旧存档。
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly prefix: string;
  private _backend: StorageBackend;

  constructor(opts: LocalStorageAdapterOptions = {}) {
    this.prefix = opts.prefix ?? 'vreen:save:';
    this._backend = opts.backend ?? pickDefaultBackend();
  }

  /** 当前使用的底层后端（调试用）。 */
  get backend(): StorageBackend {
    return this._backend;
  }

  private _fullKey(key: string): string {
    return this.prefix + key;
  }

  save(key: string, data: string): void {
    const full = this._fullKey(key);
    try {
      this._backend.setItem(full, data);
    } catch (err) {
      log.error(`save("${key}") failed: ${(err as Error).message ?? err}`);
      throw err;
    }
  }

  load(key: string): string | null {
    return this._backend.getItem(this._fullKey(key));
  }

  remove(key: string): void {
    this._backend.removeItem(this._fullKey(key));
  }

  exists(key: string): boolean {
    return this._backend.getItem(this._fullKey(key)) !== null;
  }

  /**
   * 清空所有以本 adapter 前缀开头的条目。
   *
   * 注意：浏览器 localStorage 没有按前缀删除的 API，必须遍历所有 key
   * 逐个 removeItem；不能直接 backend.clear()，否则会清掉其他模块的数据。
   */
  clear(): void {
    // 优先尝试遍历 + 按前缀过滤（兼容浏览器 localStorage）。
    const g = this._backend as StorageBackend & {
      length?: number;
      key?(index: number): string | null;
    };
    if (typeof g.length === 'number' && typeof g.key === 'function') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < g.length; i++) {
        const k = g.key(i);
        if (k && k.startsWith(this.prefix)) keysToRemove.push(k);
      }
      for (const k of keysToRemove) this._backend.removeItem(k);
      log.info(`clear — removed ${keysToRemove.length} entries with prefix "${this.prefix}"`);
      return;
    }
    // MemoryStorageBackend 没有 length/key，直接 clear() 即可。
    this._backend.clear();
    log.info('clear — backend cleared');
  }
}

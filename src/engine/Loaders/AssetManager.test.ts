// AssetManager 测试 — Phase 4.4 缓存策略完善
//
// 验证:
//   • 基础 load/has/invalidate/clear
//   • LRU 淘汰策略(hits + createdAt)
//   • Phase 4.4 新 API:prefetch / prewarm / getStats / invalidateAll
//   • 失败时缓存清理 + 重试
//   • 全局单例
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AssetManager,
  getDefaultAssetManager,
  resetDefaultAssetManager,
} from './AssetManager';
import type { Loader, AssetSource, LoaderContext } from './Loader';

// ── 测试用 mock loader ─────────────────────────────────────────

class MockLoader<T> implements Loader<T> {
  readonly format: string;
  private _result: T;
  private _delay: number;
  private _shouldFail: boolean;
  loadCount = 0;

  constructor(format: string, result: T, opts?: { delay?: number; shouldFail?: boolean }) {
    this.format = format;
    this._result = result;
    this._delay = opts?.delay ?? 0;
    this._shouldFail = opts?.shouldFail ?? false;
  }

  canLoad(_source: AssetSource, _hints?: Record<string, unknown>): boolean { return true; }

  async load(source: AssetSource, _ctx?: LoaderContext): Promise<T> {
    this.loadCount++;
    if (this._delay > 0) {
      await new Promise((r) => setTimeout(r, this._delay));
    }
    if (this._shouldFail) {
      throw new Error(`MockLoader failure for ${String(source)}`);
    }
    return this._result;
  }
}

// ── 基础测试 ───────────────────────────────────────────────────

describe('AssetManager — 基础', () => {
  it('registerLoader + load 基本流程', async () => {
    const am = new AssetManager();
    const loader = new MockLoader('test', { data: 42 });
    am.registerLoader('test', loader);

    const result = await am.load<{ data: number }>('test', 'a.txt');
    expect(result.data).toBe(42);
    expect(loader.loadCount).toBe(1);
  });

  it('相同 source 第二次 load 命中缓存,loader 只调用一次', async () => {
    const am = new AssetManager();
    const loader = new MockLoader('test', { data: 1 });
    am.registerLoader('test', loader);

    await am.load('test', 'a.txt');
    await am.load('test', 'a.txt');
    await am.load('test', 'a.txt');

    expect(loader.loadCount).toBe(1);
    expect(am.has('test', 'a.txt')).toBe(true);
  });

  it('不同 source 不命中缓存', async () => {
    const am = new AssetManager();
    const loader = new MockLoader('test', { data: 1 });
    am.registerLoader('test', loader);

    await am.load('test', 'a.txt');
    await am.load('test', 'b.txt');

    expect(loader.loadCount).toBe(2);
  });

  it('未注册 format 抛错', async () => {
    const am = new AssetManager();
    await expect(am.load('unknown', 'a.txt')).rejects.toThrow(/no loader registered/);
  });

  it('has() 同步检查缓存', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));
    expect(am.has('test', 'a.txt')).toBe(false);
    await am.load('test', 'a.txt');
    expect(am.has('test', 'a.txt')).toBe(true);
  });

  it('invalidate 驱逐单条', async () => {
    const am = new AssetManager();
    const loader = new MockLoader('test', 1);
    am.registerLoader('test', loader);

    await am.load('test', 'a.txt');
    expect(am.has('test', 'a.txt')).toBe(true);

    am.invalidate('test', 'a.txt');
    expect(am.has('test', 'a.txt')).toBe(false);

    // 再次 load 重新调用 loader
    await am.load('test', 'a.txt');
    expect(loader.loadCount).toBe(2);
  });

  it('clear 清空全部', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));
    await am.load('test', 'a.txt');
    await am.load('test', 'b.txt');
    expect(am.size()).toBe(2);

    am.clear();
    expect(am.size()).toBe(0);
  });

  it('load 失败时清除缓存允许重试', async () => {
    const am = new AssetManager();
    // 先失败,后成功
    const loader = new MockLoader('test', 1, { shouldFail: true });
    am.registerLoader('test', loader);

    await expect(am.load('test', 'a.txt')).rejects.toThrow();
    expect(am.has('test', 'a.txt')).toBe(false);

    // 替换为成功 loader
    am.registerLoader('test', new MockLoader('test', 1));
    const result = await am.load('test', 'a.txt');
    expect(result).toBe(1);
  });
});

// ── LRU 淘汰 ──────────────────────────────────────────────────

describe('AssetManager — LRU 淘汰', () => {
  it('超过 maxEntries 时淘汰 hits 最少的', async () => {
    const am = new AssetManager({ maxEntries: 3 });
    am.registerLoader('test', new MockLoader('test', 1));

    await am.load('test', 'a.txt');
    await am.load('test', 'b.txt');
    await am.load('test', 'c.txt');

    // 让 a 多命中几次
    await am.load('test', 'a.txt');
    await am.load('test', 'a.txt');
    // b 只命中一次
    await am.load('test', 'b.txt');
    // c 没有额外命中

    // 插入第 4 个,应淘汰 c(hits 最少)
    await am.load('test', 'd.txt');

    expect(am.size()).toBe(3);
    expect(am.has('test', 'c.txt')).toBe(false);
    expect(am.has('test', 'a.txt')).toBe(true);
    expect(am.has('test', 'b.txt')).toBe(true);
    expect(am.has('test', 'd.txt')).toBe(true);
  });

  it('maxEntries=0 不限制', async () => {
    const am = new AssetManager({ maxEntries: 0 });
    am.registerLoader('test', new MockLoader('test', 1));

    for (let i = 0; i < 10; i++) {
      await am.load('test', `file${i}.txt`);
    }
    expect(am.size()).toBe(10);
  });
});

// ── Phase 4.4: prefetch ────────────────────────────────────────

describe('AssetManager — prefetch (Phase 4.4)', () => {
  it('prefetch 在后台加载,不返回结果', async () => {
    const am = new AssetManager();
    const loader = new MockLoader('test', { data: 42 });
    am.registerLoader('test', loader);

    await am.prefetch('test', 'a.txt');
    expect(am.has('test', 'a.txt')).toBe(true);
    expect(loader.loadCount).toBe(1);
  });

  it('prefetch 已缓存的资产不重复加载', async () => {
    const am = new AssetManager();
    const loader = new MockLoader('test', 1);
    am.registerLoader('test', loader);

    await am.load('test', 'a.txt');
    await am.prefetch('test', 'a.txt');

    expect(loader.loadCount).toBe(1);
  });

  it('prefetch 失败时不抛错(best-effort)', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1, { shouldFail: true }));

    // 不应抛错
    await am.prefetch('test', 'a.txt');
    expect(am.has('test', 'a.txt')).toBe(false);
  });
});

// ── Phase 4.4: prewarm ─────────────────────────────────────────

describe('AssetManager — prewarm (Phase 4.4)', () => {
  it('prewarm 批量加载多个资产', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));

    const result = await am.prewarm([
      { format: 'test', source: 'a.txt' },
      { format: 'test', source: 'b.txt' },
      { format: 'test', source: 'c.txt' },
    ]);

    expect(result.loaded).toBe(3);
    expect(result.failed).toBe(0);
    expect(am.size()).toBe(3);
  });

  it('prewarm 空数组返回 0/0', async () => {
    const am = new AssetManager();
    const result = await am.prewarm([]);
    expect(result).toEqual({ loaded: 0, failed: 0 });
  });

  it('prewarm 部分失败时返回正确计数', async () => {
    const am = new AssetManager();
    am.registerLoader('ok', new MockLoader('ok', 1));
    am.registerLoader('bad', new MockLoader('bad', 1, { shouldFail: true }));

    const result = await am.prewarm([
      { format: 'ok', source: 'a.txt' },
      { format: 'bad', source: 'b.txt' },
      { format: 'ok', source: 'c.txt' },
    ]);

    expect(result.loaded).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('prewarm 后资产在缓存中', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));

    await am.prewarm([
      { format: 'test', source: 'a.txt' },
    ]);

    expect(am.has('test', 'a.txt')).toBe(true);
  });
});

// ── Phase 4.4: getStats ────────────────────────────────────────

describe('AssetManager — getStats (Phase 4.4)', () => {
  it('初始状态:全零', () => {
    const am = new AssetManager({ maxEntries: 64 });
    const stats = am.getStats();
    expect(stats.entries).toBe(0);
    expect(stats.maxEntries).toBe(64);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.evictions).toBe(0);
    expect(stats.totalBytes).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  it('记录 hits 和 misses', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));

    await am.load('test', 'a.txt'); // miss
    await am.load('test', 'a.txt'); // hit
    await am.load('test', 'a.txt'); // hit
    await am.load('test', 'b.txt'); // miss

    const stats = am.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('记录 evictions', async () => {
    const am = new AssetManager({ maxEntries: 2 });
    am.registerLoader('test', new MockLoader('test', 1));

    await am.load('test', 'a.txt');
    await am.load('test', 'b.txt');
    await am.load('test', 'c.txt'); // 触发淘汰

    expect(am.getStats().evictions).toBe(1);
  });

  it('totalBytes 累计缓存大小', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));

    const data = new Uint8Array(100);
    await am.load('test', data);

    const stats = am.getStats();
    expect(stats.totalBytes).toBe(100);
  });
});

// ── Phase 4.4: invalidateAll ───────────────────────────────────

describe('AssetManager — invalidateAll (Phase 4.4)', () => {
  it('无谓词时等同 clear', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));
    await am.load('test', 'a.txt');
    await am.load('test', 'b.txt');

    const removed = am.invalidateAll();
    expect(removed).toBe(2);
    expect(am.size()).toBe(0);
  });

  it('按 format 谓词批量失效', async () => {
    const am = new AssetManager();
    am.registerLoader('glb', new MockLoader('glb', 1));
    am.registerLoader('hdr', new MockLoader('hdr', 1));

    await am.load('glb', 'a.glb');
    await am.load('hdr', 'b.hdr');
    await am.load('glb', 'c.glb');

    const removed = am.invalidateAll((fmt) => fmt === 'glb');
    expect(removed).toBe(2);
    expect(am.has('glb', 'a.glb')).toBe(false);
    expect(am.has('glb', 'c.glb')).toBe(false);
    expect(am.has('hdr', 'b.hdr')).toBe(true);
  });

  it('按 source 谓词失效', async () => {
    const am = new AssetManager();
    am.registerLoader('test', new MockLoader('test', 1));

    await am.load('test', 'keep.txt');
    await am.load('test', 'remove.txt');
    await am.load('test', 'also-remove.txt');

    const removed = am.invalidateAll((_fmt, src) => typeof src === 'string' && src.includes('remove'));
    expect(removed).toBe(2);
    expect(am.has('test', 'keep.txt')).toBe(true);
    expect(am.has('test', 'remove.txt')).toBe(false);
    expect(am.has('test', 'also-remove.txt')).toBe(false);
  });
});

// ── 全局单例 ───────────────────────────────────────────────────

describe('AssetManager — 全局单例', () => {
  beforeEach(() => {
    resetDefaultAssetManager();
  });

  it('getDefaultAssetManager 返回同一实例', () => {
    const a = getDefaultAssetManager();
    const b = getDefaultAssetManager();
    expect(a).toBe(b);
  });

  it('resetDefaultAssetManager 清除单例', () => {
    const a = getDefaultAssetManager();
    resetDefaultAssetManager();
    const b = getDefaultAssetManager();
    expect(a).not.toBe(b);
  });
});

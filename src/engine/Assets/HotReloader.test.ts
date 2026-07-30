// HotReloader 单元测试。
//
// 验证:
//   • addWatch / removeWatch / isWatchingPath
//   • startWatching / stopWatching + isWatching
//   • checkChanges 检测 mtime 变化 (注入 statFn)
//   • reloadResource 触发 callback + 更新 LoadedResource
//   • registerResource / unregisterResource / getResource / getLoadedResources
//   • setDebounceTime / getPendingReloads / clearPending
//   • update(dt) 防抖聚合 + 触发重载
//   • saveState / restoreState
//   • getStats
//   • clear + 全局单例

import { describe, it, expect } from 'vitest';
import {
  HotReloader,
  getDefaultHotReloader,
  resetDefaultHotReloader,
} from './HotReloader';

/** 构造一个可控 mtime 的 stat 函数。 */
function makeStatFn(mtimes: Map<string, number>) {
  return (path: string): { mtimeMs: number } | null => {
    const m = mtimes.get(path);
    if (m === undefined) return null;
    return { mtimeMs: m };
  };
}

describe('HotReloader — addWatch / removeWatch', () => {
  it('addWatch adds watcher and updates watchPaths', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    const cb = () => {};
    hr.addWatch('/a.txt', cb);
    expect(hr.isWatchingPath('/a.txt')).toBe(true);
    expect(hr.watchPaths).toContain('/a.txt');
    expect(hr.watchers.size).toBe(1);
    const w = hr.watchers.get('/a.txt')!;
    expect(w.lastModified).toBe(1000);
    expect(w.callback).toBe(cb);
  });

  it('addWatch same path overwrites callback and refreshes lastModified', () => {
    const mtimes = new Map<string, number>([['/a.txt', 2000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    const cb1 = () => {};
    const cb2 = () => {};
    hr.addWatch('/a.txt', cb1);
    hr.addWatch('/a.txt', cb2);
    expect(hr.watchers.size).toBe(1);
    expect(hr.watchPaths).toHaveLength(1);
    const w = hr.watchers.get('/a.txt')!;
    expect(w.callback).toBe(cb2);
    expect(w.lastModified).toBe(2000);
  });

  it('addWatch on nonexistent file sets lastModified=0', () => {
    const hr = new HotReloader({ statFn: makeStatFn(new Map()) });
    hr.addWatch('/missing.txt', () => {});
    expect(hr.watchers.get('/missing.txt')!.lastModified).toBe(0);
  });

  it('removeWatch returns true and removes from both maps', () => {
    const hr = new HotReloader({ statFn: makeStatFn(new Map()) });
    hr.addWatch('/a.txt', () => {});
    expect(hr.removeWatch('/a.txt')).toBe(true);
    expect(hr.isWatchingPath('/a.txt')).toBe(false);
    expect(hr.watchPaths).not.toContain('/a.txt');
    expect(hr.pendingReloads.has('/a.txt')).toBe(false);
  });

  it('removeWatch on unknown returns false', () => {
    const hr = new HotReloader();
    expect(hr.removeWatch('/nope')).toBe(false);
  });
});

describe('HotReloader — watching state', () => {
  it('startWatching / stopWatching toggle isWatching', () => {
    const hr = new HotReloader();
    expect(hr.isWatching).toBe(false);
    hr.startWatching();
    expect(hr.isWatching).toBe(true);
    hr.startWatching(); // 幂等
    expect(hr.isWatching).toBe(true);
    hr.stopWatching();
    expect(hr.isWatching).toBe(false);
    hr.stopWatching(); // 幂等
    expect(hr.isWatching).toBe(false);
  });
});

describe('HotReloader — checkChanges', () => {
  it('returns [] when not watching', () => {
    const mtimes = new Map<string, number>([['/a.txt', 2000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {}); // 初始 mtime=1000? 不,初始也读到 2000
    // 注意: addWatch 时已读取 mtime=2000 作为 lastModified。
    // 修改 mtimes 到 3000:
    mtimes.set('/a.txt', 3000);
    expect(hr.checkChanges()).toEqual([]); // 未 startWatching
  });

  it('detects mtime increase and adds to pendingReloads', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    hr.startWatching();
    // 模拟文件变化
    mtimes.set('/a.txt', 2000);
    const changed = hr.checkChanges();
    expect(changed).toEqual(['/a.txt']);
    expect(hr.pendingReloads.has('/a.txt')).toBe(true);
    // 第二次检查无变化 (mtime 未再变)
    expect(hr.checkChanges()).toEqual([]);
  });

  it('does not detect unchanged files', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    hr.startWatching();
    expect(hr.checkChanges()).toEqual([]);
    expect(hr.pendingReloads.size).toBe(0);
  });

  it('updates lastModified after detecting change', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    hr.startWatching();
    mtimes.set('/a.txt', 5000);
    hr.checkChanges();
    expect(hr.watchers.get('/a.txt')!.lastModified).toBe(5000);
  });
});

describe('HotReloader — reloadResource', () => {
  it('triggers callback and updates LoadedResource', () => {
    const hr = new HotReloader();
    let calls = 0;
    let lastPath = '';
    hr.addWatch('/a.txt', (p) => { calls++; lastPath = p; });
    hr.registerResource('/a.txt', 'texture', { v: 1 });
    const ok = hr.reloadResource('/a.txt');
    expect(ok).toBe(true);
    expect(calls).toBe(1);
    expect(lastPath).toBe('/a.txt');
    const rec = hr.getResource('/a.txt')!;
    expect(rec.reloadCount).toBe(1);
    expect(rec.lastReload).toBeGreaterThan(0);
  });

  it('returns false for unknown path', () => {
    const hr = new HotReloader();
    expect(hr.reloadResource('/nope')).toBe(false);
  });

  it('catches callback errors and still updates resource', () => {
    const hr = new HotReloader();
    hr.addWatch('/a.txt', () => { throw new Error('boom'); });
    hr.registerResource('/a.txt', 'texture', {});
    expect(hr.reloadResource('/a.txt')).toBe(true);
    expect(hr.getResource('/a.txt')!.reloadCount).toBe(1);
  });

  it('removes path from pendingReloads', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    hr.registerResource('/a.txt', 'texture', {});
    hr.startWatching();
    mtimes.set('/a.txt', 2000);
    hr.checkChanges();
    expect(hr.pendingReloads.has('/a.txt')).toBe(true);
    hr.reloadResource('/a.txt');
    expect(hr.pendingReloads.has('/a.txt')).toBe(false);
  });

  it('works for resource-only (no watcher)', () => {
    const hr = new HotReloader();
    hr.registerResource('/only.txt', 'mesh', { v: 1 });
    expect(hr.reloadResource('/only.txt')).toBe(true);
    expect(hr.getResource('/only.txt')!.reloadCount).toBe(1);
  });
});

describe('HotReloader — resource management', () => {
  it('registerResource + getResource + getLoadedResources', () => {
    const hr = new HotReloader();
    const rec = hr.registerResource('/a.txt', 'texture', { v: 1 });
    expect(rec.path).toBe('/a.txt');
    expect(rec.type).toBe('texture');
    expect(rec.data).toEqual({ v: 1 });
    expect(rec.reloadCount).toBe(0);
    expect(hr.getResource('/a.txt')).toBe(rec);
    expect(hr.getLoadedResources()).toHaveLength(1);
  });

  it('registerResource same path preserves reloadCount', () => {
    const hr = new HotReloader();
    hr.registerResource('/a.txt', 'texture', { v: 1 });
    hr.reloadResource('/a.txt');
    expect(hr.getResource('/a.txt')!.reloadCount).toBe(1);
    hr.registerResource('/a.txt', 'texture', { v: 2 });
    expect(hr.getResource('/a.txt')!.reloadCount).toBe(1);
    expect(hr.getResource('/a.txt')!.data).toEqual({ v: 2 });
  });

  it('unregisterResource removes and returns true', () => {
    const hr = new HotReloader();
    hr.registerResource('/a.txt', 'texture', {});
    expect(hr.unregisterResource('/a.txt')).toBe(true);
    expect(hr.getResource('/a.txt')).toBeUndefined();
    expect(hr.unregisterResource('/a.txt')).toBe(false);
  });
});

describe('HotReloader — debounce + pending', () => {
  it('setDebounceTime updates the value', () => {
    const hr = new HotReloader();
    hr.setDebounceTime(250);
    expect(hr.debounceTime).toBe(250);
  });

  it('setDebounceTime clamps negative to 0', () => {
    const hr = new HotReloader();
    hr.setDebounceTime(-10);
    expect(hr.debounceTime).toBe(0);
  });

  it('getPendingReloads returns snapshot', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000], ['/b.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    hr.addWatch('/b.txt', () => {});
    hr.startWatching();
    mtimes.set('/a.txt', 2000);
    mtimes.set('/b.txt', 2000);
    hr.checkChanges();
    const pending = hr.getPendingReloads();
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.path).sort()).toEqual(['/a.txt', '/b.txt']);
  });

  it('clearPending empties the queue', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    hr.startWatching();
    mtimes.set('/a.txt', 2000);
    hr.checkChanges();
    expect(hr.pendingReloads.size).toBe(1);
    hr.clearPending();
    expect(hr.pendingReloads.size).toBe(0);
  });
});

describe('HotReloader — update(dt)', () => {
  it('update does nothing when not watching', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    mtimes.set('/a.txt', 2000);
    hr.update(0.016);
    expect(hr.pendingReloads.size).toBe(0);
  });

  it('update detects change and adds to pending', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes), debounceTime: 100 });
    hr.addWatch('/a.txt', () => {});
    hr.startWatching();
    mtimes.set('/a.txt', 2000);
    hr.update(0.016);
    expect(hr.pendingReloads.size).toBe(1);
  });

  it('update triggers reload after debounce time elapses', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    let calls = 0;
    const hr = new HotReloader({ statFn: makeStatFn(mtimes), debounceTime: 100 });
    hr.addWatch('/a.txt', () => { calls++; });
    hr.registerResource('/a.txt', 'texture', {});
    hr.startWatching();
    // 触发变化
    mtimes.set('/a.txt', 2000);
    hr.update(0.016); // +16ms, pending 起算
    expect(calls).toBe(0);
    // 防抖未到 (100ms), 多帧累积
    hr.update(0.05); // +50ms
    expect(calls).toBe(0);
    // 防抖到期
    hr.update(0.05); // +50ms, 总计 116ms > 100
    expect(calls).toBe(1);
    expect(hr.pendingReloads.size).toBe(0);
  });

  it('update with 0 debounce triggers reload immediately on next frame', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    let calls = 0;
    const hr = new HotReloader({ statFn: makeStatFn(mtimes), debounceTime: 0 });
    hr.addWatch('/a.txt', () => { calls++; });
    hr.registerResource('/a.txt', 'texture', {});
    hr.startWatching();
    mtimes.set('/a.txt', 2000);
    hr.update(0.016); // 检测变化 + 防抖 0 → 同帧重载
    expect(calls).toBe(1);
  });
});

describe('HotReloader — saveState / restoreState', () => {
  it('saveState + restoreState round-trip', () => {
    const hr = new HotReloader();
    const state = { player: { hp: 100, pos: [1, 2, 3] } };
    hr.saveState(state);
    const restored = hr.restoreState();
    expect(restored).toEqual(state);
  });

  it('restoreState without saving returns undefined', () => {
    const hr = new HotReloader();
    expect(hr.restoreState()).toBeUndefined();
  });

  it('restoreState with explicit state sets and returns it', () => {
    const hr = new HotReloader();
    const s = { foo: 1 };
    const r = hr.restoreState(s);
    expect(r).toBe(s);
    expect(hr.restoreState()).toBe(s);
  });
});

describe('HotReloader — getStats', () => {
  it('returns correct stats', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes), debounceTime: 50 });
    hr.addWatch('/a.txt', () => {});
    hr.registerResource('/a.txt', 'texture', {});
    hr.startWatching();
    mtimes.set('/a.txt', 2000);
    hr.update(0.016);
    hr.update(0.1); // 触发重载
    const stats = hr.getStats();
    expect(stats.watchCount).toBe(1);
    expect(stats.loadedResourceCount).toBe(1);
    expect(stats.isWatching).toBe(true);
    expect(stats.debounceTime).toBe(50);
    expect(stats.pendingCount).toBe(0);
    expect(stats.totalReloads).toBe(1);
    expect(stats.lastReloadAt).toBeGreaterThan(0);
  });

  it('stats with empty HotReloader', () => {
    const hr = new HotReloader();
    const stats = hr.getStats();
    expect(stats.watchCount).toBe(0);
    expect(stats.loadedResourceCount).toBe(0);
    expect(stats.isWatching).toBe(false);
    expect(stats.pendingCount).toBe(0);
    expect(stats.totalReloads).toBe(0);
    expect(stats.lastReloadAt).toBeNull();
  });
});

describe('HotReloader — clear + singleton', () => {
  it('clear empties all state', () => {
    const mtimes = new Map<string, number>([['/a.txt', 1000]]);
    const hr = new HotReloader({ statFn: makeStatFn(mtimes) });
    hr.addWatch('/a.txt', () => {});
    hr.registerResource('/a.txt', 'texture', {});
    hr.startWatching();
    hr.clear();
    expect(hr.watchers.size).toBe(0);
    expect(hr.watchPaths).toHaveLength(0);
    expect(hr.loadedResources.size).toBe(0);
    expect(hr.pendingReloads.size).toBe(0);
    expect(hr.isWatching).toBe(false);
    expect(hr.getStats().totalReloads).toBe(0);
  });

  it('getDefaultHotReloader returns same instance', () => {
    resetDefaultHotReloader();
    const a = getDefaultHotReloader();
    const b = getDefaultHotReloader();
    expect(a).toBe(b);
  });

  it('resetDefaultHotReloader resets singleton', () => {
    const a = getDefaultHotReloader();
    a.addWatch('/temp.txt', () => {});
    resetDefaultHotReloader();
    const b = getDefaultHotReloader();
    expect(b).not.toBe(a);
    expect(b.watchers.size).toBe(0);
  });
});

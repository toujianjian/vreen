// SceneStreaming 单元测试。
//
// 覆盖:
//   1. registerChunk / unregisterChunk / getChunk / getChunkCount
//   2. setCamera / setStreamRadius / setChunkSize / setMaxConcurrentLoads
//   3. update 自动调度(可见加载 / 不可见卸载)
//   4. getVisibleChunks / getLoadedChunks / getLoadingChunks / getStreamingStats
//   5. requestChunk / releaseChunk(回调)
//   6. forceLoad / forceUnload
//   7. preload
//   8. 异步加载(loadDuration > 0)
//   9. clear

import { describe, it, expect } from 'vitest';
import {
  SceneStreaming,
  createSceneChunk,
  type SceneChunk,
} from './SceneStreaming';
import { Vector3 } from '../Math/Vector3';

function makeChunk(id: string, min: [number, number, number], max: [number, number, number]): SceneChunk {
  return createSceneChunk(id, min, max);
}

function makeStreaming(): SceneStreaming {
  return new SceneStreaming({ streamRadius: 10, chunkSize: 4, maxConcurrentLoads: 2 });
}

// ── 注册 ────────────────────────────────────────────────────────────

describe('SceneStreaming register / unregister', () => {
  it('registerChunk adds chunk', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    expect(s.getChunkCount()).toBe(1);
    expect(s.getChunk('a')).toBeDefined();
  });

  it('registerChunk empty id throws', () => {
    const s = makeStreaming();
    expect(() => s.registerChunk(makeChunk('', [0, 0, 0], [1, 1, 1]))).toThrow(/non-empty/);
  });

  it('registerChunk overwrites (warn)', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('a', [0, 0, 0], [8, 8, 8]));
    expect(s.getChunkCount()).toBe(1);
    expect(s.getChunk('a')!.bounds.max.x).toBe(8);
  });

  it('registerChunk with isLoaded=true adds to loadedChunks', () => {
    const s = makeStreaming();
    const c = makeChunk('a', [0, 0, 0], [4, 4, 4]);
    c.isLoaded = true;
    s.registerChunk(c);
    expect(s.getLoadedCount()).toBe(1);
  });

  it('unregisterChunk unloads and removes', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    expect(s.unregisterChunk('a')).toBe(true);
    expect(s.getChunkCount()).toBe(0);
    expect(s.getLoadedCount()).toBe(0);
  });

  it('unregisterChunk unknown returns false', () => {
    const s = makeStreaming();
    expect(s.unregisterChunk('x')).toBe(false);
  });
});

// ── 配置 setters ───────────────────────────────────────────────────

describe('SceneStreaming setters', () => {
  it('setStreamRadius', () => {
    const s = makeStreaming();
    s.setStreamRadius(100);
    expect(s.streamRadius).toBe(100);
  });

  it('setChunkSize', () => {
    const s = makeStreaming();
    s.setChunkSize(32);
    expect(s.chunkSize).toBe(32);
  });

  it('setMaxConcurrentLoads', () => {
    const s = makeStreaming();
    s.setMaxConcurrentLoads(8);
    expect(s.maxConcurrentLoads).toBe(8);
  });

  it('setMaxConcurrentLoads floors and >=1', () => {
    const s = makeStreaming();
    s.setMaxConcurrentLoads(0);
    expect(s.maxConcurrentLoads).toBe(1);
    s.setMaxConcurrentLoads(3.9);
    expect(s.maxConcurrentLoads).toBe(3);
  });

  it('setCamera / setCamera(null)', () => {
    const s = makeStreaming();
    const cam = { position: new Vector3(0, 0, 0) };
    s.setCamera(cam);
    expect(s.camera).toBe(cam);
    s.setCamera(null);
    expect(s.camera).toBeNull();
  });
});

// ── update 自动调度 ────────────────────────────────────────────────

describe('SceneStreaming update auto-scheduling', () => {
  it('visible chunks are loaded on update (sync)', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('near', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('far', [100, 0, 0], [104, 4, 4]));
    s.setCamera({ position: new Vector3(2, 2, 2) });
    s.update(0);
    expect(s.getLoadedCount()).toBe(1);
    expect(s.getChunk('near')!.isLoaded).toBe(true);
    expect(s.getChunk('far')!.isLoaded).toBe(false);
  });

  it('loaded chunks outside radius are unloaded on update', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    expect(s.getLoadedCount()).toBe(1);
    // 相机远离
    s.setCamera({ position: new Vector3(100, 100, 100) });
    s.update(0);
    expect(s.getLoadedCount()).toBe(0);
    expect(s.getChunk('a')!.isLoaded).toBe(false);
  });

  it('camera null: update does nothing', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.update(0);
    expect(s.getLoadedCount()).toBe(0);
  });

  it('maxConcurrentLoads limits loads per update', () => {
    const s = new SceneStreaming({ streamRadius: 100, maxConcurrentLoads: 2 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('b', [10, 0, 0], [14, 4, 4]));
    s.registerChunk(makeChunk('c', [20, 0, 0], [24, 4, 4]));
    s.registerChunk(makeChunk('d', [30, 0, 0], [34, 4, 4]));
    s.setCamera({ position: new Vector3(0, 0, 0) });
    s.update(0);
    // 只加载 2 个(同步模式,队列处理限 maxConcurrentLoads)
    expect(s.getLoadedCount()).toBe(2);
    // 剩余在队列
    expect(s.getLoadingChunks().length).toBe(2);
    // 再 update 加载剩余
    s.update(0);
    expect(s.getLoadedCount()).toBe(4);
  });

  it('closer chunks have higher priority', () => {
    const s = new SceneStreaming({ streamRadius: 100, maxConcurrentLoads: 1 });
    s.registerChunk(makeChunk('far', [50, 0, 0], [54, 4, 4]));
    s.registerChunk(makeChunk('near', [1, 0, 0], [5, 4, 4]));
    s.setCamera({ position: new Vector3(0, 0, 0) });
    s.update(0);
    // 优先加载 near(距离更近)
    expect(s.getChunk('near')!.isLoaded).toBe(true);
    expect(s.getChunk('far')!.isLoaded).toBe(false);
  });
});

// ── 查询 ────────────────────────────────────────────────────────────

describe('SceneStreaming queries', () => {
  it('getVisibleChunks returns chunks within radius', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('near', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('far', [100, 0, 0], [104, 4, 4]));
    s.setCamera({ position: new Vector3(2, 2, 2) });
    const vis = s.getVisibleChunks();
    expect(vis.length).toBe(1);
    expect(vis[0].id).toBe('near');
  });

  it('getVisibleChunks with null camera returns empty', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    expect(s.getVisibleChunks().length).toBe(0);
  });

  it('getLoadedChunks returns loaded list', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('b', [10, 0, 0], [14, 4, 4]));
    s.forceLoad('a');
    const loaded = s.getLoadedChunks();
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe('a');
  });

  it('getLoadingChunks returns queued + in-flight', () => {
    const s = new SceneStreaming({ streamRadius: 100, maxConcurrentLoads: 1, loadDuration: 1.0 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('b', [5, 0, 0], [9, 4, 4]));
    s.setCamera({ position: new Vector3(0, 0, 0) });
    s.update(0);
    // 一个在加载中,一个在队列
    const loading = s.getLoadingChunks();
    expect(loading.length).toBe(2);
  });

  it('getStreamingStats', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('b', [10, 0, 0], [14, 4, 4]));
    s.forceLoad('a');
    const stats = s.getStreamingStats();
    expect(stats.totalChunks).toBe(2);
    expect(stats.loadedChunks).toBe(1);
    expect(stats.loadingChunks).toBe(0);
    expect(stats.maxConcurrentLoads).toBe(2);
    expect(stats.streamRadius).toBe(10);
    expect(stats.chunkSize).toBe(4);
  });
});

// ── requestChunk / releaseChunk ────────────────────────────────────

describe('SceneStreaming requestChunk / releaseChunk', () => {
  it('requestChunk queues and update loads (with callback)', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    let called = false;
    s.requestChunk('a', 0, () => { called = true; });
    expect(s.getLoadingChunks()).toContain('a');
    s.update(0);
    expect(s.getChunk('a')!.isLoaded).toBe(true);
    expect(called).toBe(true);
  });

  it('requestChunk on already-loaded is no-op', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    s.requestChunk('a');
    expect(s.getLoadingChunks().length).toBe(0);
  });

  it('requestChunk on unknown id warns and no-op', () => {
    const s = makeStreaming();
    s.requestChunk('x');
    expect(s.getLoadingChunks().length).toBe(0);
  });

  it('requestChunk twice (not yet loaded) does not duplicate', () => {
    const s = new SceneStreaming({ maxConcurrentLoads: 1, loadDuration: 1.0 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.requestChunk('a');
    s.requestChunk('a');
    expect(s.loadingQueue.length).toBe(1);
  });

  it('releaseChunk queues for unload', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    s.releaseChunk('a');
    expect(s.unloadQueue).toContain('a');
    s.update(0);
    expect(s.getChunk('a')!.isLoaded).toBe(false);
  });

  it('releaseChunk on unloaded is no-op', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.releaseChunk('a');
    expect(s.unloadQueue.length).toBe(0);
  });
});

// ── forceLoad / forceUnload ────────────────────────────────────────

describe('SceneStreaming forceLoad / forceUnload', () => {
  it('forceLoad loads immediately (sync)', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    const c = s.forceLoad('a');
    expect(c).not.toBeNull();
    expect(c!.isLoaded).toBe(true);
    expect(s.getLoadedCount()).toBe(1);
  });

  it('forceLoad on already-loaded returns chunk', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    const c = s.forceLoad('a');
    expect(c).not.toBeNull();
    expect(s.getLoadedCount()).toBe(1);
  });

  it('forceLoad unknown returns null', () => {
    const s = makeStreaming();
    expect(s.forceLoad('x')).toBeNull();
  });

  it('forceUnload unloads immediately', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    expect(s.forceUnload('a')).toBe(true);
    expect(s.getLoadedCount()).toBe(0);
  });

  it('forceUnload on unloaded returns false', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    expect(s.forceUnload('a')).toBe(false);
  });

  it('forceLoad removes from queue', () => {
    const s = new SceneStreaming({ maxConcurrentLoads: 1, loadDuration: 1.0 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.requestChunk('a');
    expect(s.loadingQueue.length).toBe(1);
    s.forceLoad('a'); // loadDuration>0 → 进入 _loadingChunks
    expect(s.loadingQueue.length).toBe(0);
  });
});

// ── preload ────────────────────────────────────────────────────────

describe('SceneStreaming preload', () => {
  it('preload schedules chunks within radius', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('b', [5, 0, 0], [9, 4, 4]));
    s.registerChunk(makeChunk('c', [100, 0, 0], [104, 4, 4]));
    const count = s.preload(new Vector3(0, 0, 0), 20);
    expect(count).toBe(2);
    expect(s.getLoadingChunks().sort()).toEqual(['a', 'b']);
  });

  it('preload skips already loaded', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    const count = s.preload(new Vector3(0, 0, 0), 20);
    expect(count).toBe(0);
  });

  it('preload respects existing queue', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.requestChunk('a');
    const count = s.preload(new Vector3(0, 0, 0), 20);
    expect(count).toBe(0);
  });
});

// ── 异步加载 ────────────────────────────────────────────────────────

describe('SceneStreaming async loading', () => {
  it('loadDuration>0: chunk completes after duration', () => {
    const s = new SceneStreaming({ streamRadius: 100, maxConcurrentLoads: 2, loadDuration: 1.0 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.setCamera({ position: new Vector3(0, 0, 0) });
    s.update(0);
    // 尚未完成
    expect(s.getChunk('a')!.isLoaded).toBe(false);
    expect(s.activeLoads).toBe(1);
    // 推进时间到完成
    s.update(1.0);
    expect(s.getChunk('a')!.isLoaded).toBe(true);
    expect(s.activeLoads).toBe(0);
  });

  it('forceLoad with loadDuration>0 enters async path', () => {
    const s = new SceneStreaming({ loadDuration: 0.5 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    expect(s.activeLoads).toBe(1);
    expect(s.getChunk('a')!.isLoaded).toBe(false);
    s.update(0.5);
    expect(s.getChunk('a')!.isLoaded).toBe(true);
  });

  it('async load callback fires on completion', () => {
    const s = new SceneStreaming({ maxConcurrentLoads: 1, loadDuration: 0.3 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    let called = false;
    s.requestChunk('a', 0, () => { called = true; });
    s.update(0);
    expect(called).toBe(false);
    s.update(0.3);
    expect(called).toBe(true);
  });

  it('unload cancels in-flight async load', () => {
    const s = new SceneStreaming({ maxConcurrentLoads: 2, loadDuration: 1.0 });
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.forceLoad('a');
    expect(s.activeLoads).toBe(1);
    s.forceUnload('a');
    expect(s.activeLoads).toBe(0);
    // 即使再 update,也不会完成
    s.update(2.0);
    expect(s.getChunk('a')!.isLoaded).toBe(false);
  });
});

// ── clear ──────────────────────────────────────────────────────────

describe('SceneStreaming clear', () => {
  it('clear unloads all and empties registry', () => {
    const s = makeStreaming();
    s.registerChunk(makeChunk('a', [0, 0, 0], [4, 4, 4]));
    s.registerChunk(makeChunk('b', [10, 0, 0], [14, 4, 4]));
    s.forceLoad('a');
    s.forceLoad('b');
    s.clear();
    expect(s.getChunkCount()).toBe(0);
    expect(s.getLoadedCount()).toBe(0);
    expect(s.loadingQueue.length).toBe(0);
    expect(s.unloadQueue.length).toBe(0);
    expect(s.activeLoads).toBe(0);
  });

  it('clear is idempotent', () => {
    const s = makeStreaming();
    s.clear();
    s.clear();
    expect(s.getChunkCount()).toBe(0);
  });
});

// ── createSceneChunk helper ────────────────────────────────────────

describe('createSceneChunk helper', () => {
  it('creates chunk with bounds and defaults', () => {
    const c = createSceneChunk('x', [1, 2, 3], [4, 5, 6]);
    expect(c.id).toBe('x');
    expect(c.bounds.min.x).toBe(1);
    expect(c.bounds.max.z).toBe(6);
    expect(c.isLoaded).toBe(false);
    expect(c.priority).toBe(0);
    expect(c.objects).toEqual([]);
    expect(c.assets).toEqual([]);
  });

  it('creates chunk with options', () => {
    const c = createSceneChunk('y', [0, 0, 0], [1, 1, 1], {
      assets: ['mesh1'],
      isLoaded: true,
    });
    expect(c.assets).toEqual(['mesh1']);
    expect(c.isLoaded).toBe(true);
  });
});

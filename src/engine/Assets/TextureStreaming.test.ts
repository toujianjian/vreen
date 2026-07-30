// TextureStreaming 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项(maxMemoryUsage / updateInterval)
//   2. registerTexture / unregisterTexture / getTexture / getTextureCount
//   3. 重复 register 覆盖原条目(currentMemoryUsage 扣减)
//   4. requestMipLevel — 加载/卸载回调触发 + baseTexture.version bump
//   5. setMaxMemory + evict 内存超限驱逐
//   6. setCamera + update 节流
//   7. computeDesiredMip 距离调度(近 / 远 / 中间)
//   8. getStats 字段
//   9. clear 清空
//  10. position 为 null 时不参与距离调度

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextureStreaming, type StreamingTextureConfig } from './TextureStreaming';
import { Texture } from '../Core/Texture';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';

function makeConfig(overrides: Partial<StreamingTextureConfig> = {}): StreamingTextureConfig {
  return {
    url: '/tex.png',
    mipLevels: 5,
    size: 1024 * 1024,
    width: 1024,
    height: 1024,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

// ── 构造 ────────────────────────────────────────────────────────

describe('TextureStreaming construction', () => {
  it('defaults: maxMemoryUsage=256MB, updateInterval=100, no camera', () => {
    const ts = new TextureStreaming();
    expect(ts.maxMemoryUsage).toBe(256 * 1024 * 1024);
    expect(ts.updateInterval).toBe(100);
    expect(ts.camera).toBeNull();
    expect(ts.currentMemoryUsage).toBe(0);
    expect(ts.textures.size).toBe(0);
    expect(ts.getTextureCount()).toBe(0);
  });

  it('accepts custom options', () => {
    const ts = new TextureStreaming({ maxMemoryUsage: 64 * 1024 * 1024, updateInterval: 50 });
    expect(ts.maxMemoryUsage).toBe(64 * 1024 * 1024);
    expect(ts.updateInterval).toBe(50);
  });
});

// ── register / unregister ───────────────────────────────────────

describe('TextureStreaming register / unregister', () => {
  let ts: TextureStreaming;
  beforeEach(() => {
    ts = new TextureStreaming();
  });

  it('registerTexture adds entry and updates memoryUsage', () => {
    const tex = ts.registerTexture('t1', makeConfig({ size: 4096 }));
    expect(tex.id).toBe('t1');
    expect(tex.mipLevels).toBe(5);
    expect(tex.size).toBe(4096);
    expect(ts.getTextureCount()).toBe(1);
    expect(ts.getMemoryUsage()).toBe(4096);
    expect(ts.getTexture('t1')).toBeDefined();
  });

  it('registerTexture clamps loadedMips to [0, mipLevels]', () => {
    const tex = ts.registerTexture('t1', makeConfig({ mipLevels: 3, loadedMips: 99 }));
    expect(tex.loadedMips).toBe(3);
    const tex2 = ts.registerTexture('t2', makeConfig({ mipLevels: 3, loadedMips: -1 }));
    expect(tex2.loadedMips).toBe(0);
  });

  it('registerTexture overriding existing entry subtracts old size', () => {
    ts.registerTexture('t1', makeConfig({ size: 1000 }));
    expect(ts.getMemoryUsage()).toBe(1000);
    ts.registerTexture('t1', makeConfig({ size: 500 }));
    expect(ts.getMemoryUsage()).toBe(500);
    expect(ts.getTexture('t1')!.size).toBe(500);
  });

  it('unregisterTexture removes entry and decrements memoryUsage', () => {
    ts.registerTexture('t1', makeConfig({ size: 1000 }));
    expect(ts.unregisterTexture('t1')).toBe(true);
    expect(ts.getTextureCount()).toBe(0);
    expect(ts.getMemoryUsage()).toBe(0);
    expect(ts.getTexture('t1')).toBeUndefined();
  });

  it('unregisterTexture unknown id returns false', () => {
    expect(ts.unregisterTexture('missing')).toBe(false);
  });
});

// ── requestMipLevel ─────────────────────────────────────────────

describe('TextureStreaming requestMipLevel', () => {
  it('triggers onLoadMip when increasing loadedMips', () => {
    const onLoad = vi.fn();
    const ts = new TextureStreaming({ onLoadMip: onLoad });
    const baseTex = new Texture();
    const startVersion = baseTex.version;
    ts.registerTexture('t1', makeConfig({ baseTexture: baseTex, mipLevels: 4, loadedMips: 0 }));
    ts.requestMipLevel('t1', 3);
    expect(ts.getTexture('t1')!.loadedMips).toBe(3);
    expect(onLoad).toHaveBeenCalledTimes(3);
    expect(onLoad).toHaveBeenNthCalledWith(1, 't1', 0, baseTex);
    expect(onLoad).toHaveBeenNthCalledWith(2, 't1', 1, baseTex);
    expect(onLoad).toHaveBeenNthCalledWith(3, 't1', 2, baseTex);
    // baseTexture.version 应被 bump
    expect(baseTex.version).toBeGreaterThan(startVersion);
  });

  it('triggers onUnloadMip when decreasing loadedMips', () => {
    const onUnload = vi.fn();
    const ts = new TextureStreaming({ onUnloadMip: onUnload });
    ts.registerTexture('t1', makeConfig({ mipLevels: 4, loadedMips: 4 }));
    ts.requestMipLevel('t1', 2);
    expect(ts.getTexture('t1')!.loadedMips).toBe(2);
    expect(onUnload).toHaveBeenCalledTimes(2);
    expect(onUnload).toHaveBeenNthCalledWith(1, 't1', 2, null);
    expect(onUnload).toHaveBeenNthCalledWith(2, 't1', 3, null);
  });

  it('clamps requested level to [0, mipLevels]', () => {
    const ts = new TextureStreaming();
    ts.registerTexture('t1', makeConfig({ mipLevels: 3, loadedMips: 0 }));
    ts.requestMipLevel('t1', 99);
    expect(ts.getTexture('t1')!.loadedMips).toBe(3);
    ts.requestMipLevel('t1', -5);
    expect(ts.getTexture('t1')!.loadedMips).toBe(0);
  });

  it('no-op when requested level equals current', () => {
    const onLoad = vi.fn();
    const ts = new TextureStreaming({ onLoadMip: onLoad });
    ts.registerTexture('t1', makeConfig({ mipLevels: 3, loadedMips: 2 }));
    ts.requestMipLevel('t1', 2);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('warns on unknown id (no throw)', () => {
    const ts = new TextureStreaming();
    expect(() => ts.requestMipLevel('missing', 1)).not.toThrow();
  });
});

// ── setMaxMemory + evict ────────────────────────────────────────

describe('TextureStreaming setMaxMemory + evict', () => {
  it('setMaxMemory triggers immediate eviction when over limit', () => {
    const ts = new TextureStreaming({ maxMemoryUsage: 10000 });
    ts.registerTexture('a', makeConfig({ size: 4000, priority: 1 }));
    ts.registerTexture('b', makeConfig({ size: 4000, priority: 0 }));
    ts.registerTexture('c', makeConfig({ size: 4000, priority: 5 }));
    expect(ts.getMemoryUsage()).toBe(12000);
    ts.setMaxMemory(8000);
    expect(ts.getMemoryUsage()).toBeLessThanOrEqual(8000);
    // 优先级最低的 b 应被驱逐
    expect(ts.getTexture('b')).toBeUndefined();
    expect(ts.getTexture('a')).toBeDefined();
    expect(ts.getTexture('c')).toBeDefined();
  });

  it('evict returns evicted ids and respects target', () => {
    const ts = new TextureStreaming();
    ts.registerTexture('a', makeConfig({ size: 1000, priority: 1 }));
    ts.registerTexture('b', makeConfig({ size: 1000, priority: 0 }));
    ts.registerTexture('c', makeConfig({ size: 1000, priority: 5 }));
    const evicted = ts.evict(1500);
    // 优先级最低的 b 先驱逐;若不够再驱逐 a
    expect(evicted.length).toBeGreaterThanOrEqual(1);
    expect(evicted[0]).toBe('b');
    expect(ts.getMemoryUsage()).toBeLessThanOrEqual(1500);
  });

  it('evict prefers low priority then old lastUsed', () => {
    const ts = new TextureStreaming();
    const a = ts.registerTexture('a', makeConfig({ size: 1000, priority: 1 }));
    const b = ts.registerTexture('b', makeConfig({ size: 1000, priority: 1 }));
    // 让 a 更旧
    a.lastUsed = 100;
    b.lastUsed = 9999;
    const evicted = ts.evict(1000);
    expect(evicted).toContain('a');
    expect(evicted).not.toContain('b');
  });

  it('update evicts when memory exceeds limit during runtime', () => {
    const ts = new TextureStreaming({ maxMemoryUsage: 1000, updateInterval: 0 });
    ts.registerTexture('a', makeConfig({ size: 800, priority: 1 }));
    ts.registerTexture('b', makeConfig({ size: 800, priority: 0 }));
    ts.update(0, null);
    expect(ts.getMemoryUsage()).toBeLessThanOrEqual(1000);
    expect(ts.getTexture('b')).toBeUndefined();
  });
});

// ── update + computeDesiredMip ─────────────────────────────────

describe('TextureStreaming computeDesiredMip', () => {
  it('returns mipLevels when no position (always full quality)', () => {
    const ts = new TextureStreaming();
    const tex = ts.registerTexture('t1', makeConfig({ mipLevels: 5, position: null }));
    expect(ts.computeDesiredMip(tex)).toBe(5);
  });

  it('returns 0 (max quality) when camera is at texture position', () => {
    const ts = new TextureStreaming();
    const tex = ts.registerTexture('t1', makeConfig({
      mipLevels: 5,
      width: 1024,
      height: 1024,
      position: { x: 0, y: 0, z: 0 },
    }));
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    expect(ts.computeDesiredMip(tex, cam)).toBe(0);
  });

  it('returns mipLevels (min quality) when camera is far away', () => {
    const ts = new TextureStreaming();
    const tex = ts.registerTexture('t1', makeConfig({
      mipLevels: 5,
      width: 256,
      height: 256,
      position: { x: 0, y: 0, z: 0 },
    }));
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(10000, 0, 0);
    cam.updateMatrixWorld(true);
    expect(ts.computeDesiredMip(tex, cam)).toBe(5);
  });

  it('returns intermediate mip at mid distance', () => {
    const ts = new TextureStreaming();
    const tex = ts.registerTexture('t1', makeConfig({
      mipLevels: 10,
      width: 100,
      height: 100,
      position: { x: 0, y: 0, z: 0 },
    }));
    // nearDist=100, farDist=800; mid distance=450 → t=0.5 → desired=5
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(450, 0, 0);
    cam.updateMatrixWorld(true);
    expect(ts.computeDesiredMip(tex, cam)).toBe(5);
  });

  it('returns mipLevels when no camera available', () => {
    const ts = new TextureStreaming();
    const tex = ts.registerTexture('t1', makeConfig({
      mipLevels: 4,
      position: { x: 0, y: 0, z: 0 },
    }));
    expect(ts.computeDesiredMip(tex, null)).toBe(4);
  });
});

// ── update 节流 + camera-driven requestMipLevel ────────────────

describe('TextureStreaming update', () => {
  it('throttles by updateInterval', () => {
    const ts = new TextureStreaming({ updateInterval: 1000 });
    const onLoad = vi.fn();
    ts.setLoadMipCallback(onLoad);
    ts.registerTexture('t1', makeConfig({
      mipLevels: 3,
      width: 100,
      height: 100,
      position: { x: 0, y: 0, z: 0 },
      loadedMips: 0,
    }));
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    ts.setCamera(cam);
    ts.lastUpdate = performance.now(); // 强制下次 update 被节流
    ts.update(0, cam);
    // 被节流 → 不触发 requestMipLevel
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('runs when updateInterval=0', () => {
    const onLoad = vi.fn();
    const ts = new TextureStreaming({ updateInterval: 0, onLoadMip: onLoad });
    ts.registerTexture('t1', makeConfig({
      mipLevels: 3,
      width: 100,
      height: 100,
      position: { x: 0, y: 0, z: 0 },
      loadedMips: 0,
    }));
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    ts.update(0, cam);
    // 距离 0 → desired=0,但当前 loadedMips=0,no-op
    expect(ts.getTexture('t1')!.loadedMips).toBe(0);
    // 把相机移远 → desired=mipLevels=3,触发加载
    cam.position.set(10000, 0, 0);
    cam.updateMatrixWorld(true);
    ts.update(0, cam);
    expect(ts.getTexture('t1')!.loadedMips).toBe(3);
    expect(onLoad).toHaveBeenCalledTimes(3);
  });

  it('uses stored camera when camera arg omitted', () => {
    const onLoad = vi.fn();
    const ts = new TextureStreaming({ updateInterval: 0, onLoadMip: onLoad });
    ts.registerTexture('t1', makeConfig({
      mipLevels: 3,
      width: 100,
      height: 100,
      position: { x: 0, y: 0, z: 0 },
      loadedMips: 0,
    }));
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(10000, 0, 0);
    cam.updateMatrixWorld(true);
    ts.setCamera(cam);
    ts.update(0);
    expect(ts.getTexture('t1')!.loadedMips).toBe(3);
  });
});

// ── getStats ────────────────────────────────────────────────────

describe('TextureStreaming getStats', () => {
  it('reports correct stats for mixed loading states', () => {
    const ts = new TextureStreaming({ maxMemoryUsage: 10000 });
    ts.registerTexture('a', makeConfig({ mipLevels: 4, loadedMips: 4, size: 1000 })); // fullyLoaded
    ts.registerTexture('b', makeConfig({ mipLevels: 4, loadedMips: 0, size: 2000 })); // unloaded
    ts.registerTexture('c', makeConfig({ mipLevels: 4, loadedMips: 2, size: 3000 })); // partial
    const stats = ts.getStats();
    expect(stats.registered).toBe(3);
    expect(stats.fullyLoaded).toBe(1);
    expect(stats.unloaded).toBe(1);
    expect(stats.loadedMipTotal).toBe(6); // 4+0+2
    expect(stats.memoryUsage).toBe(6000);
    expect(stats.memoryLimit).toBe(10000);
    expect(stats.memoryRatio).toBeCloseTo(0.6, 5);
  });

  it('memoryRatio=0 when limit=0', () => {
    const ts = new TextureStreaming({ maxMemoryUsage: 0 });
    ts.registerTexture('a', makeConfig({ size: 100 }));
    // size 100 > limit 0 → 立即被驱逐
    expect(ts.getStats().memoryRatio).toBe(0);
  });
});

// ── clear ───────────────────────────────────────────────────────

describe('TextureStreaming clear', () => {
  it('clears all textures and resets memoryUsage', () => {
    const ts = new TextureStreaming();
    ts.registerTexture('a', makeConfig({ size: 1000 }));
    ts.registerTexture('b', makeConfig({ size: 2000 }));
    ts.clear();
    expect(ts.getTextureCount()).toBe(0);
    expect(ts.getMemoryUsage()).toBe(0);
  });
});

// ── setCamera / setLoadMipCallback / setUnloadMipCallback ──────

describe('TextureStreaming setters', () => {
  it('setCamera stores camera', () => {
    const ts = new TextureStreaming();
    const cam = new PerspectiveCamera();
    ts.setCamera(cam);
    expect(ts.camera).toBe(cam);
    ts.setCamera(null);
    expect(ts.camera).toBeNull();
  });

  it('setLoadMipCallback / setUnloadMipCallback change callbacks at runtime', () => {
    const ts = new TextureStreaming();
    const onLoad = vi.fn();
    const onUnload = vi.fn();
    ts.setLoadMipCallback(onLoad);
    ts.setUnloadMipCallback(onUnload);
    ts.registerTexture('t1', makeConfig({ mipLevels: 3, loadedMips: 0 }));
    ts.requestMipLevel('t1', 2);
    expect(onLoad).toHaveBeenCalledTimes(2);
    ts.requestMipLevel('t1', 0);
    expect(onUnload).toHaveBeenCalledTimes(2);
  });
});

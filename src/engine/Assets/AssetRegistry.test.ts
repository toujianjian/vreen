// AssetRegistry 测试 — 资源注册表 + 引用计数
//
// 验证:
//   • register/get/has 基础 API
//   • addRef/release/unload 引用计数（归零触发 onUnload）
//   • getStats 统计（loaded/unloaded/total/activeRefs）
//   • clear 清空
//   • 重复 register 覆盖
//   • markError 标记加载失败
//   • 全局单例
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AssetRegistry,
  getDefaultAssetRegistry,
  resetDefaultAssetRegistry,
} from './AssetRegistry';

describe('AssetRegistry — 基础', () => {
  let reg: AssetRegistry;
  beforeEach(() => {
    reg = new AssetRegistry();
  });

  it('register + get + has', () => {
    const handle = reg.register('tex1', 'texture', { width: 256 });
    expect(handle.id).toBe('tex1');
    expect(handle.type).toBe('texture');
    expect(handle.data).toEqual({ width: 256 });
    expect(handle.loaded).toBe(true);
    expect(handle.error).toBeNull();

    const got = reg.get('tex1');
    expect(got).toBeDefined();
    expect(got?.data).toEqual({ width: 256 });
    expect(reg.has('tex1')).toBe(true);
    expect(reg.has('missing')).toBe(false);
  });

  it('register 时 url 字段被记录', () => {
    reg.register('tex1', 'texture', { data: 1 }, '/assets/tex.png');
    expect(reg.get('tex1')?.url).toBe('/assets/tex.png');
  });

  it('get 未注册返回 undefined', () => {
    expect(reg.get('missing')).toBeUndefined();
  });

  it('重复 register 覆盖原条目', () => {
    reg.register('a', 'texture', { v: 1 });
    reg.addRef('a'); // refCount=2
    expect(reg.refCount('a')).toBe(2);
    // 覆盖
    reg.register('a', 'geometry', { v: 2 });
    expect(reg.refCount('a')).toBe(1); // 重置为 1
    const h = reg.get('a');
    expect(h?.type).toBe('geometry');
    expect(h?.data).toEqual({ v: 2 });
  });
});

describe('AssetRegistry — 引用计数', () => {
  let reg: AssetRegistry;
  let unloadCalls: string[];
  beforeEach(() => {
    unloadCalls = [];
    reg = new AssetRegistry({
      onUnload: (id) => unloadCalls.push(id),
    });
  });

  it('register 后初始 refCount=1', () => {
    reg.register('a', 'texture', { v: 1 });
    expect(reg.refCount('a')).toBe(1);
  });

  it('addRef 累加', () => {
    reg.register('a', 'texture', { v: 1 });
    expect(reg.addRef('a')).toBe(2);
    expect(reg.addRef('a')).toBe(3);
    expect(reg.refCount('a')).toBe(3);
  });

  it('addRef 未注册返回 0', () => {
    expect(reg.addRef('missing')).toBe(0);
  });

  it('release 减 1', () => {
    reg.register('a', 'texture', { v: 1 });
    reg.addRef('a'); // 2
    expect(reg.release('a')).toBe(1);
    expect(reg.refCount('a')).toBe(1);
    expect(reg.has('a')).toBe(true);
  });

  it('release 归零触发 onUnload 并移除条目', () => {
    reg.register('a', 'texture', { v: 1 });
    reg.release('a'); // 0
    expect(unloadCalls).toEqual(['a']);
    expect(reg.has('a')).toBe(false);
    expect(reg.get('a')).toBeUndefined();
  });

  it('unload 等价于 release（引用计数减 1）', () => {
    reg.register('a', 'texture', { v: 1 });
    reg.addRef('a'); // 2
    expect(reg.unload('a')).toBe(1); // 1
    expect(reg.has('a')).toBe(true);
    reg.unload('a'); // 0
    expect(unloadCalls).toEqual(['a']);
    expect(reg.has('a')).toBe(false);
  });

  it('release 未注册返回 0 不抛错', () => {
    expect(() => reg.release('missing')).not.toThrow();
    expect(reg.release('missing')).toBe(0);
  });

  it('onUnload 回调可访问 handle.data', () => {
    let unloadedData: unknown = null;
    const r = new AssetRegistry({
      onUnload: (_id, handle) => { unloadedData = handle.data; },
    });
    r.register('a', 'texture', { v: 42 });
    r.release('a');
    expect(unloadedData).toEqual({ v: 42 });
  });

  it('onUnload 抛错被吞掉,不影响后续逻辑', () => {
    const r = new AssetRegistry({
      onUnload: () => { throw new Error('boom'); },
    });
    r.register('a', 'texture', { v: 1 });
    expect(() => r.release('a')).not.toThrow();
    expect(r.has('a')).toBe(false);
  });
});

describe('AssetRegistry — 统计', () => {
  it('getStats 反映 loaded/unloaded/total/activeRefs', () => {
    const reg = new AssetRegistry();
    reg.register('a', 'texture', 1);
    reg.register('b', 'texture', 2);
    reg.addRef('a'); // a=2, b=1, activeRefs=3
    let stats = reg.getStats();
    expect(stats.loaded).toBe(2);
    expect(stats.unloaded).toBe(0);
    expect(stats.total).toBe(2);
    expect(stats.activeRefs).toBe(3);

    reg.release('a'); // a=1
    stats = reg.getStats();
    expect(stats.loaded).toBe(2);
    expect(stats.activeRefs).toBe(2);

    reg.release('b'); // b=0 → unloaded
    stats = reg.getStats();
    expect(stats.loaded).toBe(1);
    expect(stats.unloaded).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.activeRefs).toBe(1);
  });

  it('clear 重置所有统计', () => {
    const reg = new AssetRegistry();
    reg.register('a', 'texture', 1);
    reg.register('b', 'texture', 2);
    reg.clear();
    const stats = reg.getStats();
    expect(stats.loaded).toBe(0);
    expect(stats.unloaded).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.activeRefs).toBe(0);
  });
});

describe('AssetRegistry — markError', () => {
  it('标记加载失败', () => {
    const reg = new AssetRegistry();
    reg.register('a', 'texture', { v: 1 });
    const err = new Error('decode failed');
    reg.markError('a', err);
    const h = reg.get('a');
    expect(h?.error).toBe(err);
    expect(h?.loaded).toBe(false);
    // has() 仍要求 loaded=true，所以这里返回 false
    expect(reg.has('a')).toBe(false);
  });

  it('markError 未注册不抛错', () => {
    const reg = new AssetRegistry();
    expect(() => reg.markError('missing', new Error('x'))).not.toThrow();
  });
});

describe('AssetRegistry — 全局单例', () => {
  beforeEach(() => {
    resetDefaultAssetRegistry();
  });

  it('getDefaultAssetRegistry 返回同一实例', () => {
    const a = getDefaultAssetRegistry();
    const b = getDefaultAssetRegistry();
    expect(a).toBe(b);
  });

  it('resetDefaultAssetRegistry 后获取新实例', () => {
    const a = getDefaultAssetRegistry();
    a.register('x', 'texture', 1);
    resetDefaultAssetRegistry();
    const b = getDefaultAssetRegistry();
    expect(b).not.toBe(a);
    expect(b.has('x')).toBe(false);
  });
});

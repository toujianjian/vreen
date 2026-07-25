// AssetCache 测试 — LRU 资源缓存
//
// 验证:
//   • get/set/has/delete/clear/size 基础 API
//   • LRU 淘汰策略（溢出时从最久未用开始淘汰）
//   • get/set 刷新访问顺序
//   • setMaxSize 动态调整容量
import { describe, it, expect, beforeEach } from 'vitest';
import { AssetCache } from './AssetCache';

describe('AssetCache — 基础', () => {
  let cache: AssetCache<number>;
  beforeEach(() => {
    cache = new AssetCache<number>({ maxSize: 3 });
  });

  it('set/get 基本流程', () => {
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('get 未命中返回 undefined', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('set 覆盖原值', () => {
    cache.set('a', 1);
    cache.set('a', 999);
    expect(cache.get('a')).toBe(999);
    expect(cache.size).toBe(1);
  });

  it('delete 删除条目', () => {
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.delete('a')).toBe(false);
  });

  it('clear 清空所有', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
  });
});

describe('AssetCache — LRU 淘汰', () => {
  it('溢出时从最久未用开始淘汰', () => {
    const cache = new AssetCache<string>({ maxSize: 3 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    expect(cache.size).toBe(3);
    // 插入 d → a 被淘汰
    cache.set('d', 'D');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('get 刷新访问顺序,避免被淘汰', () => {
    const cache = new AssetCache<string>({ maxSize: 3 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    // 访问 a → a 移到末尾
    cache.get('a');
    // 插入 d → 应淘汰 b（最久未用），而不是 a
    cache.set('d', 'D');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('set 已存在 key 刷新访问顺序', () => {
    const cache = new AssetCache<string>({ maxSize: 3 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    // 重新 set a（不改变 size）
    cache.set('a', 'A2');
    expect(cache.size).toBe(3);
    // 插入 d → 应淘汰 b
    cache.set('d', 'D');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });

  it('maxSize=0 表示不限', () => {
    const cache = new AssetCache<string>({ maxSize: 0 });
    for (let i = 0; i < 100; i++) cache.set(`k${i}`, `v${i}`);
    expect(cache.size).toBe(100);
  });

  it('setMaxSize 动态调整容量', () => {
    const cache = new AssetCache<string>({ maxSize: 5 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    cache.set('d', 'D');
    cache.set('e', 'E');
    expect(cache.size).toBe(5);
    // 缩容到 2 → 淘汰 3 个最旧的
    cache.setMaxSize(2);
    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
    expect(cache.has('d')).toBe(true);
    expect(cache.has('e')).toBe(true);
  });
});

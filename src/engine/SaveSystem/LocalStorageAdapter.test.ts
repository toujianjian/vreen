// LocalStorageAdapter 测试 — 存储适配器。
//
// 验证:
//   • save/load/exists/remove 基础 API
//   • clear 清空前缀条目 (不影响其他模块的 key)
//   • 注入 MemoryStorageBackend 时使用注入实例
//   • prefix 命名空间隔离
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalStorageAdapter,
  MemoryStorageBackend,
} from './LocalStorageAdapter';

describe('LocalStorageAdapter — 基础', () => {
  let adapter: LocalStorageAdapter;
  beforeEach(() => {
    adapter = new LocalStorageAdapter({ backend: new MemoryStorageBackend() });
  });

  it('save / load 往返', () => {
    adapter.save('slot1', 'hello');
    expect(adapter.load('slot1')).toBe('hello');
    expect(adapter.exists('slot1')).toBe(true);
  });

  it('load 不存在的 key 返回 null', () => {
    expect(adapter.load('missing')).toBeNull();
    expect(adapter.exists('missing')).toBe(false);
  });

  it('save 覆盖原值', () => {
    adapter.save('k', 'v1');
    adapter.save('k', 'v2');
    expect(adapter.load('k')).toBe('v2');
  });

  it('remove 删除条目', () => {
    adapter.save('k', 'v');
    expect(adapter.remove('k')).toBeUndefined();
    expect(adapter.exists('k')).toBe(false);
  });
});

describe('LocalStorageAdapter — prefix 隔离', () => {
  it('不同 prefix 不互相干扰', () => {
    const backend = new MemoryStorageBackend();
    const a = new LocalStorageAdapter({ prefix: 'a:', backend });
    const b = new LocalStorageAdapter({ prefix: 'b:', backend });
    a.save('k', 'A');
    b.save('k', 'B');
    expect(a.load('k')).toBe('A');
    expect(b.load('k')).toBe('B');
  });

  it('clear 仅清空本前缀的条目', () => {
    const backend = new MemoryStorageBackend();
    const a = new LocalStorageAdapter({ prefix: 'a:', backend });
    const b = new LocalStorageAdapter({ prefix: 'b:', backend });
    a.save('1', 'x');
    a.save('2', 'y');
    b.save('1', 'z');
    a.clear();
    expect(a.exists('1')).toBe(false);
    expect(a.exists('2')).toBe(false);
    // b 的条目不受影响
    expect(b.exists('1')).toBe(true);
    expect(b.load('1')).toBe('z');
  });
});

describe('LocalStorageAdapter — MemoryStorageBackend', () => {
  it('MemoryStorageBackend 基础 API', () => {
    const b = new MemoryStorageBackend();
    b.setItem('k', 'v');
    expect(b.getItem('k')).toBe('v');
    b.removeItem('k');
    expect(b.getItem('k')).toBeNull();
  });

  it('MemoryStorageBackend.clear 清空全部', () => {
    const b = new MemoryStorageBackend();
    b.setItem('a', '1');
    b.setItem('b', '2');
    b.clear();
    expect(b.getItem('a')).toBeNull();
    expect(b.getItem('b')).toBeNull();
  });
});

describe('LocalStorageAdapter — 默认前缀', () => {
  it('不提供 prefix 时使用默认 vreen:save:', () => {
    const adapter = new LocalStorageAdapter({ backend: new MemoryStorageBackend() });
    adapter.save('k', 'v');
    // 通过 backend 直接查默认前缀
    const b = adapter.backend as MemoryStorageBackend;
    expect(b.getItem('vreen:save:k')).toBe('v');
  });
});

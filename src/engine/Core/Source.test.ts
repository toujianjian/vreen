// Source 单元测试(数据层,不依赖 WebGL / DOM)。

import { describe, it, expect } from 'vitest';
import { Source } from './Source';

describe('Source', () => {
  it('constructs with sensible defaults', () => {
    const s = new Source();
    expect(s.isSource).toBe(true);
    expect(s.data).toBeNull();
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
    expect(s.version).toBe(0);
  });

  it('constructs with data and dimensions', () => {
    const data = new Uint8Array(4);
    const s = new Source(data, { width: 1, height: 1 });
    expect(s.data).toBe(data);
    expect(s.width).toBe(1);
    expect(s.height).toBe(1);
  });

  it('clamps width/height to >= 0 and floors', () => {
    const s = new Source(null, { width: -5, height: 2.9 });
    expect(s.width).toBe(0);
    expect(s.height).toBe(2);
  });

  it('needsUpdate bumps version', () => {
    const s = new Source();
    expect(s.version).toBe(0);
    s.needsUpdate();
    expect(s.version).toBe(1);
    s.needsUpdate();
    expect(s.version).toBe(2);
  });

  it('needsUpdate is chainable', () => {
    const s = new Source();
    expect(s.needsUpdate()).toBe(s);
  });

  it('setData replaces data, updates dimensions, and bumps version', () => {
    const s = new Source();
    const v0 = s.version;
    const data = new Uint8Array(16);
    s.setData(data, 4, 4);
    expect(s.data).toBe(data);
    expect(s.width).toBe(4);
    expect(s.height).toBe(4);
    expect(s.version).toBe(v0 + 1);
  });

  it('setData floors and clamps dimensions', () => {
    const s = new Source();
    s.setData(new Uint8Array(4), -1, 2.9);
    expect(s.width).toBe(0);
    expect(s.height).toBe(2);
  });

  it('copy duplicates data/width/height without bumping version', () => {
    const src = new Source(new Uint8Array(8), { width: 2, height: 2 });
    src.needsUpdate();
    const v0 = src.version;
    const dst = new Source();
    dst.copy(src);
    expect(dst.data).toBe(src.data);
    expect(dst.width).toBe(2);
    expect(dst.height).toBe(2);
    // copy 不 bump version(由调用方按需 needsUpdate)
    expect(src.version).toBe(v0);
  });

  it('clone produces an equal but independent Source (shared data ref)', () => {
    const data = new Float32Array(12);
    const src = new Source(data, { width: 3, height: 1 });
    const c = src.clone();
    expect(c.data).toBe(data);
    expect(c.width).toBe(3);
    expect(c.height).toBe(1);
    expect(c).not.toBe(src);
  });

  it('toJSON serializes typed-array data type and length', () => {
    const s = new Source(new Uint8Array([1, 2, 3, 4]), { width: 1, height: 1 });
    s.needsUpdate();
    const json = s.toJSON() as Record<string, unknown>;
    expect(json.width).toBe(1);
    expect(json.height).toBe(1);
    expect(json.version).toBe(1);
    expect(json.dataType).toBe('Uint8Array');
    expect(json.dataLength).toBe(4);
  });

  it('toJSON serializes Float32Array data type', () => {
    const s = new Source(new Float32Array(8), { width: 2, height: 2 });
    const json = s.toJSON() as Record<string, unknown>;
    expect(json.dataType).toBe('Float32Array');
    expect(json.dataLength).toBe(8);
  });

  it('toJSON reports null dataType when data is null', () => {
    const s = new Source(null);
    const json = s.toJSON() as Record<string, unknown>;
    expect(json.dataType).toBeNull();
    expect(json.dataLength).toBe(0);
  });

  it('accepts various typed array types', () => {
    const u8 = new Uint8Array(2);
    const u16 = new Uint16Array(2);
    const u32 = new Uint32Array(2);
    const f32 = new Float32Array(2);
    expect(new Source(u8, { width: 1, height: 1 }).data).toBe(u8);
    expect(new Source(u16, { width: 1, height: 1 }).data).toBe(u16);
    expect(new Source(u32, { width: 1, height: 1 }).data).toBe(u32);
    expect(new Source(f32, { width: 1, height: 1 }).data).toBe(f32);
  });
});

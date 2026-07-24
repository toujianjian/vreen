// Fog 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { Fog } from './Fog';
import { Color } from '../Math/Color';

describe('Fog', () => {
  it('constructs with sensible defaults', () => {
    const f = new Fog();
    expect(f.isFog).toBe(true);
    expect(f.color.getHex()).toBe(0xffffff);
    expect(f.near).toBe(1);
    expect(f.far).toBe(1000);
    expect(f.name).toBe('');
  });

  it('accepts hex number / string / Color for color', () => {
    expect(new Fog(0xcccccc).color.getHex()).toBe(0xcccccc);
    expect(new Fog('#336699').color.getHex()).toBe(0x336699);
    const src = new Color(0x112233);
    const f = new Fog(src);
    expect(f.color.getHex()).toBe(0x112233);
    // 传入 Color 时应克隆,后续改动 src 不影响 fog
    src.setHex(0xffffff);
    expect(f.color.getHex()).toBe(0x112233);
  });

  it('stores near/far', () => {
    const f = new Fog(0x000000, 10, 15);
    expect(f.near).toBe(10);
    expect(f.far).toBe(15);
  });

  it('copy duplicates color/near/far/name', () => {
    const a = new Fog(0x123456, 4, 20);
    a.name = 'haze';
    const b = new Fog();
    b.copy(a);
    expect(b.color.getHex()).toBe(0x123456);
    expect(b.near).toBe(4);
    expect(b.far).toBe(20);
    expect(b.name).toBe('haze');
    // copy 不应共享 Color 引用
    b.color.setHex(0x000000);
    expect(a.color.getHex()).toBe(0x123456);
  });

  it('clone returns an equal but independent instance', () => {
    const a = new Fog(0xabcdef, 2, 8);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b).toBeInstanceOf(Fog);
    expect(b.color.getHex()).toBe(0xabcdef);
    expect(b.near).toBe(2);
    expect(b.far).toBe(8);
    b.near = 99;
    expect(a.near).toBe(2);
  });

  it('toJSON serializes type/name/color/near/far', () => {
    const f = new Fog(0x00ff00, 3, 30);
    f.name = 'greenish';
    const json = f.toJSON();
    expect(json).toEqual({
      type: 'Fog',
      name: 'greenish',
      color: 0x00ff00,
      near: 3,
      far: 30,
    });
  });
});

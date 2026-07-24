// FogExp2 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { FogExp2 } from './FogExp2';
import { Color } from '../Math/Color';

describe('FogExp2', () => {
  it('constructs with sensible defaults', () => {
    const f = new FogExp2();
    expect(f.isFogExp2).toBe(true);
    expect(f.color.getHex()).toBe(0xffffff);
    expect(f.density).toBe(0.00025);
    expect(f.name).toBe('');
  });

  it('accepts hex number / string / Color for color', () => {
    expect(new FogExp2(0xcccccc).color.getHex()).toBe(0xcccccc);
    expect(new FogExp2('#336699').color.getHex()).toBe(0x336699);
    const src = new Color(0x112233);
    const f = new FogExp2(src);
    expect(f.color.getHex()).toBe(0x112233);
    src.setHex(0xffffff);
    expect(f.color.getHex()).toBe(0x112233);
  });

  it('stores density', () => {
    expect(new FogExp2(0x000000, 0.002).density).toBe(0.002);
  });

  it('copy duplicates color/density/name', () => {
    const a = new FogExp2(0x123456, 0.5);
    a.name = 'heavy';
    const b = new FogExp2();
    b.copy(a);
    expect(b.color.getHex()).toBe(0x123456);
    expect(b.density).toBe(0.5);
    expect(b.name).toBe('heavy');
    b.color.setHex(0x000000);
    expect(a.color.getHex()).toBe(0x123456);
  });

  it('clone returns an equal but independent instance', () => {
    const a = new FogExp2(0xabcdef, 0.25);
    const b = a.clone();
    expect(b).not.toBe(a);
    expect(b).toBeInstanceOf(FogExp2);
    expect(b.color.getHex()).toBe(0xabcdef);
    expect(b.density).toBe(0.25);
    b.density = 99;
    expect(a.density).toBe(0.25);
  });

  it('toJSON serializes type/name/color/density', () => {
    const f = new FogExp2(0x00ff00, 0.01);
    f.name = 'greenish';
    expect(f.toJSON()).toEqual({
      type: 'FogExp2',
      name: 'greenish',
      color: 0x00ff00,
      density: 0.01,
    });
  });
});

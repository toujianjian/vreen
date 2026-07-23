// CubeTexture 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { CubeTexture } from './CubeTexture';
import { Texture } from './Texture';

describe('CubeTexture', () => {
  it('constructs with 6 null faces and sensible defaults', () => {
    const t = new CubeTexture();
    expect(t.isCubeTexture).toBe(true);
    expect(t.images).toHaveLength(6);
    expect(t.images.every((f) => f === null)).toBe(true);
    expect(t.mapping).toBe('cube-reflection');
    expect(t.format).toBe('rgba');
    expect(t.type).toBe('unsigned-byte');
    expect(t.flipY).toBe(false);
    expect(t.generateMipmaps).toBe(true);
    expect(t.colorSpace).toBe('srgb');
    expect(t.wrapS).toBe('clamp');
    expect(t.wrapT).toBe('clamp');
  });

  it('extends Texture', () => {
    expect(new CubeTexture()).toBeInstanceOf(Texture);
  });

  it('assigns unique uuids', () => {
    const a = new CubeTexture();
    const b = new CubeTexture();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('accepts a 6-element images array and clips non-6 input to empty', () => {
    const arr = [1, 2, 3, 4, 5, 6].map(() => null);
    const t = new CubeTexture(arr);
    expect(t.images).toHaveLength(6);
    // 传入长度 != 6 的数组回退为全 null
    const t2 = new CubeTexture([null, null]);
    expect(t2.images).toHaveLength(6);
    expect(t2.images.every((f) => f === null)).toBe(true);
  });

  it('applies option overrides', () => {
    const t = new CubeTexture([], {
      mapping: 'cube-refraction',
      format: 'rgb',
      type: 'float',
      flipY: true,
      generateMipmaps: false,
      colorSpace: 'linear',
    });
    expect(t.mapping).toBe('cube-refraction');
    expect(t.format).toBe('rgb');
    expect(t.type).toBe('float');
    expect(t.flipY).toBe(true);
    expect(t.generateMipmaps).toBe(false);
    expect(t.colorSpace).toBe('linear');
  });

  it('set replaces 6 faces and bumps version', () => {
    const t = new CubeTexture();
    const v0 = t.version;
    const faces = [null, null, null, null, null, null];
    t.set(faces);
    expect(t.version).toBe(v0 + 1);
    expect(t.images).toHaveLength(6);
  });

  it('set throws on non-6-length array', () => {
    const t = new CubeTexture();
    expect(() => t.set([null, null])).toThrow();
  });

  it('copy duplicates fields and bumps version', () => {
    const src = new CubeTexture([], { mapping: 'cube-refraction', format: 'rg', type: 'half-float' });
    src.name = 'env';
    const dst = new CubeTexture();
    const v0 = dst.version;
    dst.copy(src);
    expect(dst.name).toBe('env');
    expect(dst.mapping).toBe('cube-refraction');
    expect(dst.format).toBe('rg');
    expect(dst.type).toBe('half-float');
    expect(dst.version).toBe(v0 + 1);
  });

  it('clone produces an equal but independent CubeTexture', () => {
    const src = new CubeTexture([], { format: 'r', type: 'unsigned-short' });
    const c = src.clone();
    expect(c).toBeInstanceOf(CubeTexture);
    expect(c.format).toBe('r');
    expect(c.type).toBe('unsigned-short');
    expect(c).not.toBe(src);
    expect(c.images).not.toBe(src.images);
  });

  it('fromEquirectangular fills 6 faces with the source and bumps version', () => {
    const t = new CubeTexture();
    const v0 = t.version;
    // 用一个占位对象模拟位图源(运行时不访问像素)
    const stub = {} as unknown as Parameters<CubeTexture['fromEquirectangular']>[0];
    t.fromEquirectangular(stub);
    expect(t.version).toBe(v0 + 1);
    expect(t.images.every((f) => f === stub)).toBe(true);
  });
});

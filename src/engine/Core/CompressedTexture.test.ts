// CompressedTexture 单元测试(数据层,不依赖 WebGL / DOM)。

import { describe, it, expect } from 'vitest';
import { CompressedTexture, type CompressedMipmap } from './CompressedTexture';
import { Texture } from './Texture';

/** 构造一个最小可用的 mip level stub。 */
function makeMip(size: number, fill: number): CompressedMipmap {
  return { data: new Uint8Array(size).fill(fill), width: 4, height: 4 };
}

describe('CompressedTexture', () => {
  it('constructs with sensible defaults', () => {
    const t = new CompressedTexture();
    expect(t.isCompressedTexture).toBe(true);
    expect(t.mipmaps).toHaveLength(0);
    expect(t.format).toBe('s3tc-dxt5');
    expect(t.type).toBe('unsigned-byte');
    expect(t.flipY).toBe(false);
    expect(t.generateMipmaps).toBe(false);
    expect(t.colorSpace).toBe('srgb');
    expect(t.minFilter).toBe('linear-mipmap-linear');
    expect(t.magFilter).toBe('linear');
    expect(t.wrapS).toBe('clamp');
    expect(t.wrapT).toBe('clamp');
  });

  it('extends Texture', () => {
    expect(new CompressedTexture()).toBeInstanceOf(Texture);
  });

  it('assigns unique uuids', () => {
    const a = new CompressedTexture();
    const b = new CompressedTexture();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('accepts initial mipmaps (defensively copied)', () => {
    const mips = [makeMip(8, 1), makeMip(4, 2)];
    const input = mips.slice();
    const t = new CompressedTexture(mips, { format: 'etc2-rgb' });
    expect(t.mipmaps).toHaveLength(2);
    expect(t.mipmaps[0]).toBe(mips[0]); // 元素引用共享
    expect(t.mipmaps).not.toBe(input); // 但数组本身是副本
    expect(t.format).toBe('etc2-rgb');
  });

  it('applies option overrides', () => {
    const t = new CompressedTexture([], {
      format: 'bptc',
      type: 'unsigned-short',
      flipY: true,
      generateMipmaps: true,
      colorSpace: 'linear',
      minFilter: 'nearest',
      magFilter: 'nearest',
      wrapS: 'repeat',
      wrapT: 'mirror',
    });
    expect(t.format).toBe('bptc');
    expect(t.type).toBe('unsigned-short');
    expect(t.flipY).toBe(true);
    expect(t.generateMipmaps).toBe(true);
    expect(t.colorSpace).toBe('linear');
    expect(t.minFilter).toBe('nearest');
    expect(t.magFilter).toBe('nearest');
    expect(t.wrapS).toBe('repeat');
    expect(t.wrapT).toBe('mirror');
  });

  it('setMipmaps replaces chain and bumps version', () => {
    const t = new CompressedTexture();
    const v0 = t.version;
    t.setMipmaps([makeMip(8, 1)]);
    expect(t.mipmaps).toHaveLength(1);
    expect(t.version).toBe(v0 + 1);
  });

  it('addMipmap appends a level and bumps version', () => {
    const t = new CompressedTexture([makeMip(8, 1)]);
    const v0 = t.version;
    t.addMipmap(makeMip(4, 2));
    expect(t.mipmaps).toHaveLength(2);
    expect(t.version).toBe(v0 + 1);
  });

  it('getSize returns base level dimensions', () => {
    const t = new CompressedTexture([
      { data: new Uint8Array(8), width: 16, height: 8 },
      { data: new Uint8Array(4), width: 8, height: 4 },
    ]);
    const size = t.getSize();
    expect(size.width).toBe(16);
    expect(size.height).toBe(8);
  });

  it('getSize returns 0x0 when mipmaps empty', () => {
    const t = new CompressedTexture();
    const size = t.getSize();
    expect(size.width).toBe(0);
    expect(size.height).toBe(0);
  });

  it('copy duplicates fields, deep-copies mipmaps array, and bumps version', () => {
    const src = new CompressedTexture(
      [makeMip(8, 1), makeMip(4, 2)],
      { format: 'astc-4x4', colorSpace: 'linear' },
    );
    src.name = 'src';
    const dst = new CompressedTexture();
    const v0 = dst.version;
    dst.copy(src);
    expect(dst.name).toBe('src');
    expect(dst.mipmaps).toHaveLength(2);
    expect(dst.mipmaps[0]).not.toBe(src.mipmaps[0]); // 元素被重新包装(新对象)
    expect(dst.mipmaps[0].data).toBe(src.mipmaps[0].data); // 但 Uint8Array 引用共享
    expect(dst.mipmaps[0].width).toBe(4);
    expect(dst.mipmaps[0].height).toBe(4);
    expect(dst.format).toBe('astc-4x4');
    expect(dst.colorSpace).toBe('linear');
    expect(dst.version).toBe(v0 + 1);
  });

  it('clone produces an equal but independent CompressedTexture', () => {
    const src = new CompressedTexture([makeMip(8, 1)], { format: 'etc1' });
    const c = src.clone();
    expect(c).toBeInstanceOf(CompressedTexture);
    expect(c.format).toBe('etc1');
    expect(c.mipmaps).toHaveLength(1);
    expect(c).not.toBe(src);
    expect(c.mipmaps).not.toBe(src.mipmaps);
  });
});

// DataTexture 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { DataTexture } from './DataTexture';
import { Texture } from './Texture';

describe('DataTexture', () => {
  it('constructs with sensible defaults', () => {
    const t = new DataTexture();
    expect(t.isDataTexture).toBe(true);
    expect(t.data).toBeNull();
    expect(t.width).toBe(1);
    expect(t.height).toBe(1);
    expect(t.format).toBe('rgba');
    expect(t.type).toBe('unsigned-byte');
    expect(t.unpackAlignment).toBe(1);
    expect(t.flipY).toBe(false);
    expect(t.generateMipmaps).toBe(false);
    expect(t.colorSpace).toBe('linear');
    expect(t.minFilter).toBe('nearest');
    expect(t.magFilter).toBe('nearest');
    expect(t.wrapS).toBe('clamp');
    expect(t.wrapT).toBe('clamp');
  });

  it('extends Texture', () => {
    expect(new DataTexture()).toBeInstanceOf(Texture);
  });

  it('assigns unique uuids', () => {
    const a = new DataTexture();
    const b = new DataTexture();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('infers type=float from Float32Array data when type not specified', () => {
    const data = new Float32Array(4 * 2 * 2);
    const t = new DataTexture(data, 2, 2);
    expect(t.type).toBe('float');
    expect(t.data).toBe(data);
    expect(t.width).toBe(2);
    expect(t.height).toBe(2);
  });

  it('infers type=unsigned-byte from Uint8Array data', () => {
    const data = new Uint8Array(4);
    const t = new DataTexture(data, 1, 1);
    expect(t.type).toBe('unsigned-byte');
  });

  it('clamps width/height to >= 1 and floors', () => {
    const t = new DataTexture(new Uint8Array(4), -5, 2.9);
    expect(t.width).toBe(1);
    expect(t.height).toBe(2);
  });

  it('applies option overrides', () => {
    const t = new DataTexture(new Uint8Array(4), 1, 1, {
      format: 'r',
      type: 'unsigned-int',
      flipY: true,
      generateMipmaps: true,
      colorSpace: 'srgb',
      minFilter: 'linear',
      magFilter: 'linear',
      wrapS: 'repeat',
      wrapT: 'mirror',
      unpackAlignment: 4,
    });
    expect(t.format).toBe('r');
    expect(t.type).toBe('unsigned-int');
    expect(t.flipY).toBe(true);
    expect(t.generateMipmaps).toBe(true);
    expect(t.colorSpace).toBe('srgb');
    expect(t.minFilter).toBe('linear');
    expect(t.magFilter).toBe('linear');
    expect(t.wrapS).toBe('repeat');
    expect(t.wrapT).toBe('mirror');
    expect(t.unpackAlignment).toBe(4);
  });

  it('copy duplicates fields and bumps version', () => {
    const src = new DataTexture(new Uint8Array([1, 2, 3, 4]), 2, 2, { format: 'r', type: 'unsigned-byte' });
    src.name = 'src';
    const dst = new DataTexture();
    const v0 = dst.version;
    dst.copy(src);
    expect(dst.name).toBe('src');
    expect(dst.data).toBe(src.data);
    expect(dst.width).toBe(2);
    expect(dst.height).toBe(2);
    expect(dst.format).toBe('r');
    expect(dst.type).toBe('unsigned-byte');
    expect(dst.version).toBe(v0 + 1);
  });

  it('clone produces an equal but independent DataTexture', () => {
    const src = new DataTexture(new Float32Array(8), 2, 2, { type: 'float' });
    const c = src.clone();
    expect(c).toBeInstanceOf(DataTexture);
    expect(c.type).toBe('float');
    expect(c.width).toBe(2);
    expect(c.height).toBe(2);
    expect(c.data).toBe(src.data);
    expect(c).not.toBe(src);
  });

  it('toJSON serializes scalar fields and data length', () => {
    const t = new DataTexture(new Uint8Array([10, 20, 30, 40]), 1, 1, { format: 'rgba' });
    const json = t.toJSON() as Record<string, unknown>;
    expect(json.width).toBe(1);
    expect(json.height).toBe(1);
    expect(json.format).toBe('rgba');
    expect(json.dataLength).toBe(4);
    expect(json.dataByteLength).toBe(4);
    expect(json.uuid).toBe(t.uuid);
    // 不直接序列化原始 buffer
    expect(json.data).toBeUndefined();
  });
});

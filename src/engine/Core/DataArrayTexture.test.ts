// DataArrayTexture 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { DataArrayTexture } from './DataArrayTexture';
import { Texture } from './Texture';

describe('DataArrayTexture', () => {
  it('constructs with sensible defaults', () => {
    const t = new DataArrayTexture();
    expect(t.isDataArrayTexture).toBe(true);
    expect(t.data).toBeNull();
    expect(t.width).toBe(1);
    expect(t.height).toBe(1);
    expect(t.depth).toBe(1);
    expect(t.format).toBe('rgba');
    expect(t.type).toBe('unsigned-byte');
    expect(t.wrapR).toBe('clamp');
    expect(t.unpackAlignment).toBe(1);
    expect(t.flipY).toBe(false);
    expect(t.generateMipmaps).toBe(false);
    expect(t.colorSpace).toBe('linear');
    expect(t.minFilter).toBe('nearest');
    expect(t.magFilter).toBe('nearest');
    expect(t.wrapS).toBe('clamp');
    expect(t.wrapT).toBe('clamp');
    expect(t.layerUpdates).toBeInstanceOf(Set);
    expect(t.layerUpdates.size).toBe(0);
  });

  it('extends Texture', () => {
    expect(new DataArrayTexture()).toBeInstanceOf(Texture);
  });

  it('assigns unique uuids', () => {
    const a = new DataArrayTexture();
    const b = new DataArrayTexture();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('infers type=float from Float32Array data', () => {
    const data = new Float32Array(4 * 2 * 2 * 3);
    const t = new DataArrayTexture(data, 2, 2, 3);
    expect(t.type).toBe('float');
    expect(t.depth).toBe(3);
  });

  it('clamps width/height/depth to >= 1 and floors', () => {
    const t = new DataArrayTexture(new Uint8Array(4), -1, 0, 2.9);
    expect(t.width).toBe(1);
    expect(t.height).toBe(1);
    expect(t.depth).toBe(2);
  });

  it('applies option overrides', () => {
    const t = new DataArrayTexture(new Uint8Array(4), 1, 1, 1, {
      format: 'rg',
      type: 'unsigned-short',
      flipY: true,
      generateMipmaps: true,
      colorSpace: 'srgb',
      wrapR: 'repeat',
      unpackAlignment: 4,
    });
    expect(t.format).toBe('rg');
    expect(t.type).toBe('unsigned-short');
    expect(t.flipY).toBe(true);
    expect(t.generateMipmaps).toBe(true);
    expect(t.colorSpace).toBe('srgb');
    expect(t.wrapR).toBe('repeat');
    expect(t.unpackAlignment).toBe(4);
  });

  it('addLayerUpdate records layer index and bumps version', () => {
    const t = new DataArrayTexture();
    const v0 = t.version;
    t.addLayerUpdate(2);
    t.addLayerUpdate(5);
    expect(t.layerUpdates.has(2)).toBe(true);
    expect(t.layerUpdates.has(5)).toBe(true);
    expect(t.layerUpdates.size).toBe(2);
    expect(t.version).toBe(v0 + 2);
  });

  it('clearLayerUpdates empties the set', () => {
    const t = new DataArrayTexture();
    t.addLayerUpdate(1);
    t.clearLayerUpdates();
    expect(t.layerUpdates.size).toBe(0);
  });

  it('copy duplicates fields including layerUpdates and bumps version', () => {
    const src = new DataArrayTexture(new Uint8Array(8), 2, 2, 2, { format: 'r', wrapR: 'mirror' });
    src.addLayerUpdate(0);
    src.name = 'src';
    const dst = new DataArrayTexture();
    const v0 = dst.version;
    dst.copy(src);
    expect(dst.name).toBe('src');
    expect(dst.data).toBe(src.data);
    expect(dst.width).toBe(2);
    expect(dst.height).toBe(2);
    expect(dst.depth).toBe(2);
    expect(dst.format).toBe('r');
    expect(dst.wrapR).toBe('mirror');
    expect(dst.layerUpdates.has(0)).toBe(true);
    expect(dst.version).toBe(v0 + 1);
    // copy 应产生独立的 layerUpdates 集合
    expect(dst.layerUpdates).not.toBe(src.layerUpdates);
  });

  it('clone produces an equal but independent DataArrayTexture', () => {
    const src = new DataArrayTexture(new Uint8Array(8), 2, 2, 2, { type: 'unsigned-int' });
    src.addLayerUpdate(1);
    const c = src.clone();
    expect(c).toBeInstanceOf(DataArrayTexture);
    expect(c.type).toBe('unsigned-int');
    expect(c.depth).toBe(2);
    expect(c.layerUpdates.has(1)).toBe(true);
    expect(c).not.toBe(src);
  });
});

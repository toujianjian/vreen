// DepthTexture 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { DepthTexture } from './DepthTexture';
import { Texture } from './Texture';

describe('DepthTexture', () => {
  it('constructs with sensible defaults', () => {
    const t = new DepthTexture(1024, 1024);
    expect(t.isDepthTexture).toBe(true);
    expect(t.width).toBe(1024);
    expect(t.height).toBe(1024);
    expect(t.type).toBe('unsigned-int');
    expect(t.format).toBe('depth');
    expect(t.compareFunction).toBeNull();
    expect(t.flipY).toBe(false);
    expect(t.generateMipmaps).toBe(false);
    expect(t.colorSpace).toBe('linear');
    expect(t.minFilter).toBe('nearest');
    expect(t.magFilter).toBe('nearest');
    expect(t.wrapS).toBe('clamp');
    expect(t.wrapT).toBe('clamp');
  });

  it('extends Texture', () => {
    expect(new DepthTexture(1, 1)).toBeInstanceOf(Texture);
  });

  it('assigns unique uuids', () => {
    const a = new DepthTexture(1, 1);
    const b = new DepthTexture(1, 1);
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('clamps width/height to >= 1 and floors', () => {
    const t = new DepthTexture(-5, 2.9);
    expect(t.width).toBe(1);
    expect(t.height).toBe(2);
  });

  it('applies option overrides', () => {
    const t = new DepthTexture(512, 512, {
      type: 'float',
      format: 'depth-stencil',
      flipY: true,
      generateMipmaps: true,
      compareFunction: 'less',
    });
    expect(t.type).toBe('float');
    expect(t.format).toBe('depth-stencil');
    expect(t.flipY).toBe(true);
    expect(t.generateMipmaps).toBe(true);
    expect(t.compareFunction).toBe('less');
  });

  it('throws when format is neither depth nor depth-stencil', () => {
    expect(() => new DepthTexture(1, 1, { format: 'rgba' as never })).toThrow();
    expect(() => new DepthTexture(1, 1, { format: 'rgb' as never })).toThrow();
  });

  it('accepts all valid compare functions', () => {
    const fns = ['never', 'less', 'equal', 'less-equal', 'greater', 'not-equal', 'greater-equal', 'always'] as const;
    for (const f of fns) {
      const t = new DepthTexture(1, 1, { compareFunction: f });
      expect(t.compareFunction).toBe(f);
    }
  });

  it('copy duplicates fields and bumps version', () => {
    const src = new DepthTexture(256, 256, { type: 'float', format: 'depth-stencil', compareFunction: 'less-equal' });
    src.name = 'shadow';
    const dst = new DepthTexture(1, 1);
    const v0 = dst.version;
    dst.copy(src);
    expect(dst.name).toBe('shadow');
    expect(dst.width).toBe(256);
    expect(dst.height).toBe(256);
    expect(dst.type).toBe('float');
    expect(dst.format).toBe('depth-stencil');
    expect(dst.compareFunction).toBe('less-equal');
    expect(dst.version).toBe(v0 + 1);
  });

  it('clone produces an equal but independent DepthTexture', () => {
    const src = new DepthTexture(64, 64, { type: 'unsigned-short', compareFunction: 'always' });
    const c = src.clone();
    expect(c).toBeInstanceOf(DepthTexture);
    expect(c.width).toBe(64);
    expect(c.height).toBe(64);
    expect(c.type).toBe('unsigned-short');
    expect(c.compareFunction).toBe('always');
    expect(c).not.toBe(src);
  });
});

// CanvasTexture 单元测试(数据层,不依赖 WebGL / DOM)。
//
// 测试环境为 node(无 DOM),用一个最小 stub 对象模拟 HTMLCanvasElement,
// 仅提供 width / height 字段供基类 getSize() 读取。

import { describe, it, expect } from 'vitest';
import { CanvasTexture } from './CanvasTexture';
import { Texture } from './Texture';

/** 构造一个最小 canvas stub:提供 width / height,duck-typed 为 HTMLCanvasElement。 */
function makeCanvasStub(width = 256, height = 256): HTMLCanvasElement {
  return { width, height } as unknown as HTMLCanvasElement;
}

describe('CanvasTexture', () => {
  it('constructs with sensible defaults', () => {
    const c = makeCanvasStub();
    const t = new CanvasTexture(c);
    expect(t.isCanvasTexture).toBe(true);
    expect(t.canvas).toBe(c);
    expect(t.flipY).toBe(true);
    expect(t.generateMipmaps).toBe(true);
    expect(t.colorSpace).toBe('srgb');
    expect(t.minFilter).toBe('linear-mipmap-linear');
    expect(t.magFilter).toBe('linear');
    expect(t.wrapS).toBe('clamp');
    expect(t.wrapT).toBe('clamp');
    // 构造时 image 同步指向 canvas,version 起步为 1
    expect(t.image).toBe(c);
    expect(t.version).toBe(1);
  });

  it('extends Texture', () => {
    expect(new CanvasTexture(makeCanvasStub())).toBeInstanceOf(Texture);
  });

  it('assigns unique uuids', () => {
    const a = new CanvasTexture(makeCanvasStub());
    const b = new CanvasTexture(makeCanvasStub());
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('applies option overrides', () => {
    const t = new CanvasTexture(makeCanvasStub(), {
      flipY: false,
      generateMipmaps: false,
      colorSpace: 'linear',
      minFilter: 'nearest',
      magFilter: 'nearest',
      wrapS: 'repeat',
      wrapT: 'mirror',
    });
    expect(t.flipY).toBe(false);
    expect(t.generateMipmaps).toBe(false);
    expect(t.colorSpace).toBe('linear');
    expect(t.minFilter).toBe('nearest');
    expect(t.magFilter).toBe('nearest');
    expect(t.wrapS).toBe('repeat');
    expect(t.wrapT).toBe('mirror');
  });

  it('update bumps version', () => {
    const t = new CanvasTexture(makeCanvasStub());
    const v0 = t.version;
    t.update();
    expect(t.version).toBe(v0 + 1);
    t.update();
    expect(t.version).toBe(v0 + 2);
  });

  it('setCanvas replaces canvas, syncs image, and bumps version', () => {
    const c1 = makeCanvasStub(64, 64);
    const c2 = makeCanvasStub(128, 128);
    const t = new CanvasTexture(c1);
    const v0 = t.version;
    t.setCanvas(c2);
    expect(t.canvas).toBe(c2);
    expect(t.image).toBe(c2);
    expect(t.version).toBe(v0 + 1);
  });

  it('copy duplicates fields and bumps version', () => {
    const c = makeCanvasStub(64, 64);
    const src = new CanvasTexture(c, {
      flipY: false,
      generateMipmaps: false,
      colorSpace: 'linear',
      minFilter: 'nearest',
      wrapS: 'repeat',
      wrapT: 'mirror',
    });
    src.name = 'src';
    const dst = new CanvasTexture(makeCanvasStub());
    const v0 = dst.version;
    dst.copy(src);
    expect(dst.name).toBe('src');
    expect(dst.canvas).toBe(c);
    expect(dst.image).toBe(c);
    expect(dst.flipY).toBe(false);
    expect(dst.generateMipmaps).toBe(false);
    expect(dst.colorSpace).toBe('linear');
    expect(dst.minFilter).toBe('nearest');
    expect(dst.wrapS).toBe('repeat');
    expect(dst.wrapT).toBe('mirror');
    expect(dst.version).toBe(v0 + 1);
  });

  it('clone produces an equal but independent CanvasTexture', () => {
    const c = makeCanvasStub(32, 32);
    const src = new CanvasTexture(c, { flipY: false, colorSpace: 'linear' });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(CanvasTexture);
    expect(cl.canvas).toBe(c);
    expect(cl.image).toBe(c);
    expect(cl.flipY).toBe(false);
    expect(cl.colorSpace).toBe('linear');
    expect(cl).not.toBe(src);
  });
});

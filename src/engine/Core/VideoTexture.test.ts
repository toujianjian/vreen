// VideoTexture 单元测试(数据层,不依赖 WebGL / DOM)。
//
// 测试环境为 node(无 DOM),用一个最小 stub 对象模拟 HTMLVideoElement,
// 仅提供 update() 所需的 readyState 字段与 rVFC duck-typing 检查。

import { describe, it, expect } from 'vitest';
import { VideoTexture } from './VideoTexture';
import { Texture } from './Texture';

/** 构造一个最小 video stub:不提供 requestVideoFrameCallback,以便走 update() 路径。 */
function makeVideoStub(readyState = 2): HTMLVideoElement {
  return { readyState } as unknown as HTMLVideoElement;
}

describe('VideoTexture', () => {
  it('constructs with sensible defaults', () => {
    const t = new VideoTexture(makeVideoStub());
    expect(t.isVideoTexture).toBe(true);
    expect(t.generateMipmaps).toBe(false);
    expect(t.flipY).toBe(true);
    expect(t.colorSpace).toBe('srgb');
    expect(t.minFilter).toBe('linear');
    expect(t.magFilter).toBe('linear');
    expect(t.wrapS).toBe('clamp');
    expect(t.wrapT).toBe('clamp');
    expect(t.video).toBeDefined();
  });

  it('extends Texture', () => {
    expect(new VideoTexture(makeVideoStub())).toBeInstanceOf(Texture);
  });

  it('assigns unique uuids', () => {
    const a = new VideoTexture(makeVideoStub());
    const b = new VideoTexture(makeVideoStub());
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('applies option overrides', () => {
    const t = new VideoTexture(makeVideoStub(), {
      flipY: false,
      colorSpace: 'linear',
      minFilter: 'nearest',
      magFilter: 'nearest',
      wrapS: 'repeat',
      wrapT: 'mirror',
    });
    expect(t.flipY).toBe(false);
    expect(t.colorSpace).toBe('linear');
    expect(t.minFilter).toBe('nearest');
    expect(t.magFilter).toBe('nearest');
    expect(t.wrapS).toBe('repeat');
    expect(t.wrapT).toBe('mirror');
  });

  it('update bumps version when readyState >= HAVE_CURRENT_DATA and no rVFC', () => {
    const t = new VideoTexture(makeVideoStub(2));
    const v0 = t.version;
    t.update();
    expect(t.version).toBe(v0 + 1);
  });

  it('update does not bump version when readyState < HAVE_CURRENT_DATA', () => {
    const t = new VideoTexture(makeVideoStub(1));
    const v0 = t.version;
    t.update();
    expect(t.version).toBe(v0);
  });

  it('stores the video element reference', () => {
    const v = makeVideoStub(2);
    const t = new VideoTexture(v);
    expect(t.video).toBe(v);
  });

  it('does not crash when video lacks requestVideoFrameCallback (node env)', () => {
    expect(() => new VideoTexture(makeVideoStub(0))).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioLoader } from './AudioLoader';
import { AudioContextManager } from './AudioContext';
import { createMockAudioContext, type MockAudioContext } from './audioContextMock';

describe('AudioLoader', () => {
  let mock: MockAudioContext;

  beforeEach(() => {
    mock = createMockAudioContext();
    AudioContextManager.setContext(mock as unknown as AudioContext);
  });

  afterEach(() => {
    AudioContextManager.setContext(undefined);
    (globalThis as Record<string, unknown>).fetch = undefined;
  });

  it('format 字段为 "audio"', () => {
    expect(new AudioLoader().format).toBe('audio');
  });

  it('canLoad：按扩展名识别字符串 / File', () => {
    const loader = new AudioLoader();
    expect(loader.canLoad('foo.mp3')).toBe(true);
    expect(loader.canLoad('foo.wav')).toBe(true);
    expect(loader.canLoad('foo.ogg?query=1')).toBe(true);
    expect(loader.canLoad('foo.txt')).toBe(false);
    expect(loader.canLoad(new File([new Uint8Array([0])], 'bar.flac'))).toBe(true);
    expect(loader.canLoad(new File([new Uint8Array([0])], 'bar.bin'))).toBe(false);
  });

  it('canLoad：通过 hints.mime 命中', () => {
    const loader = new AudioLoader();
    expect(loader.canLoad('stream', { mime: 'audio/mpeg' })).toBe(true);
    expect(loader.canLoad('stream', { mime: 'application/octet-stream' })).toBe(false);
  });

  it('canLoad：Blob/ArrayBuffer/Uint8Source 直接接受', () => {
    const loader = new AudioLoader();
    expect(loader.canLoad(new Blob([new Uint8Array([0])]))).toBe(true);
    expect(loader.canLoad(new ArrayBuffer(8))).toBe(true);
    expect(loader.canLoad(new Uint8Array(8))).toBe(true);
  });

  it('load：ArrayBuffer 输入走 decodeAudioData 返回 AudioBuffer', async () => {
    const loader = new AudioLoader();
    const buf = await loader.load(new ArrayBuffer(16));
    expect(mock.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(buf).toBe(mock.__decodedBuffers[0]);
  });

  it('load：URL 输入经 fetch 后再解码', async () => {
    const fetchBytes = new Uint8Array([1, 2, 3, 4]);
    (globalThis as Record<string, unknown>).fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => '4' },
        body: null,
        arrayBuffer: () => Promise.resolve(fetchBytes.buffer),
      }),
    );
    const loader = new AudioLoader();
    const buf = await loader.load('http://example.com/sound.mp3');
    expect(fetch).toHaveBeenCalledWith('http://example.com/sound.mp3', expect.anything());
    expect(mock.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(buf).toBe(mock.__decodedBuffers[0]);
  });

  it('load：使用注入的 context 而非全局', async () => {
    const localCtx = createMockAudioContext();
    const loader = new AudioLoader(localCtx as unknown as AudioContext);
    await loader.load(new ArrayBuffer(8));
    expect(localCtx.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(mock.decodeAudioData).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Audio } from './Audio';
import { AudioListener } from './AudioListener';
import { AudioContextManager } from './AudioContext';
import {
  createMockAudioContext,
  createMockAudioBuffer,
  type MockAudioContext,
  type MockAudioParam,
  type MockBufferSourceNode,
  type MockGainNode,
} from './audioContextMock';

describe('Audio', () => {
  let mock: MockAudioContext;
  let listener: AudioListener;

  beforeEach(() => {
    mock = createMockAudioContext();
    AudioContextManager.setContext(mock as unknown as AudioContext);
    listener = new AudioListener();
  });

  afterEach(() => {
    AudioContextManager.setContext(undefined);
  });

  it('构造：默认值', () => {
    const a = new Audio(listener);
    expect(a.type).toBe('Audio');
    expect(a.listener).toBe(listener);
    expect(a.context).toBe(mock);
    expect(a.autoplay).toBe(false);
    expect(a.buffer).toBeNull();
    expect(a.loop).toBe(false);
    expect(a.isPlaying).toBe(false);
    expect(a.hasPlaybackControl).toBe(true);
    expect(a.sourceType).toBe('empty');
    expect(a.playbackRate).toBe(1);
    expect(a.detune).toBe(0);
    // gain 连到 listener.getInput()
    const gain = a.gain as MockGainNode;
    expect(gain.__connects[0].to).toBe(listener.getInput());
  });

  it('setBuffer 设置缓冲与 sourceType；autoplay=false 不会播放', () => {
    const a = new Audio(listener);
    const buf = createMockAudioBuffer();
    a.setBuffer(buf);
    expect(a.buffer).toBe(buf);
    expect(a.sourceType).toBe('buffer');
    expect(a.isPlaying).toBe(false);
    expect(mock.createBufferSource).not.toHaveBeenCalled();
  });

  it('autoplay=true 时 setBuffer 自动 play', () => {
    const a = new Audio(listener);
    a.autoplay = true;
    const buf = createMockAudioBuffer();
    a.setBuffer(buf);
    expect(a.isPlaying).toBe(true);
    expect(mock.createBufferSource).toHaveBeenCalledTimes(1);
    const src = mock.__bufferSources[0] as MockBufferSourceNode;
    expect(src.buffer).toBe(buf);
    expect(src.start).toHaveBeenCalled();
  });

  it('play 后 source.connect 到 gain', () => {
    const a = new Audio(listener);
    a.setBuffer(createMockAudioBuffer());
    a.play();
    const src = mock.__bufferSources[0] as MockBufferSourceNode;
    expect(src.__connects[0].to).toBe(a.gain);
  });

  it('play 调用 setDetune / setPlaybackRate 同步到 source', () => {
    const a = new Audio(listener);
    a.detune = 50;
    a.playbackRate = 1.5;
    a.setBuffer(createMockAudioBuffer());
    a.play();
    const src = mock.__bufferSources[0] as MockBufferSourceNode;
    expect(src.detune.lastTarget?.value).toBe(50);
    expect(src.playbackRate.lastTarget?.value).toBe(1.5);
  });

  it('pause 记录进度并停 source', () => {
    const a = new Audio(listener);
    a.playbackRate = 1.5;
    a.setBuffer(createMockAudioBuffer());
    a.play();
    mock.tick(0.5);
    a.pause();
    expect(a.isPlaying).toBe(false);
    const src = mock.__bufferSources[0] as MockBufferSourceNode;
    expect(src.stop).toHaveBeenCalled();
    expect(a['_progress']).toBeCloseTo(0.75, 4); // 0.5s * 1.5 rate
  });

  it('stop 复位进度与 isPlaying', () => {
    const a = new Audio(listener);
    a.setBuffer(createMockAudioBuffer());
    a.play();
    a.stop();
    expect(a.isPlaying).toBe(false);
    expect(a['_progress']).toBe(0);
  });

  it('setLoop / setLoopStart / setLoopEnd 修改属性', () => {
    const a = new Audio(listener);
    a.setLoop(true);
    expect(a.loop).toBe(true);
    a.setLoopStart(0.5).setLoopEnd(2.5);
    expect(a.loopStart).toBe(0.5);
    expect(a.loopEnd).toBe(2.5);
  });

  it('setVolume 写入 gain.gain', () => {
    const a = new Audio(listener);
    a.setVolume(0.3);
    expect((a.gain.gain as MockAudioParam).lastTarget?.value).toBe(0.3);
    expect(a.getVolume()).toBe(0.3);
  });

  it('setFilter 添加滤波并串接到 source 与 gain 之间', () => {
    const a = new Audio(listener);
    a.setBuffer(createMockAudioBuffer());
    a.play();
    // 此时 source 已连接 gain
    const filterNode = mock.createGain(); // 复用 gain 作为 filter 节点占位
    a.setFilters([filterNode]);
    const src = mock.__bufferSources[0] as MockBufferSourceNode;
    // 应有 source → filter 的连接
    const lastSrcConnect = src.__connects[src.__connects.length - 1];
    expect(lastSrcConnect.to).toBe(filterNode);
  });

  it('onEnded 把状态复位', () => {
    const a = new Audio(listener);
    a.setBuffer(createMockAudioBuffer());
    a.play();
    a.onEnded();
    expect(a.isPlaying).toBe(false);
    expect(a['_progress']).toBe(0);
  });
});

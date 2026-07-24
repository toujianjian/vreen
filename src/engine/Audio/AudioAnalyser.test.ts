import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalyser } from './AudioAnalyser';
import { Audio } from './Audio';
import { AudioListener } from './AudioListener';
import { AudioContextManager } from './AudioContext';
import {
  createMockAudioContext,
  type MockAudioContext,
  type MockAnalyserNode,
} from './audioContextMock';

describe('AudioAnalyser', () => {
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

  it('构造：默认 fftSize=2048，data 长度=frequencyBinCount', () => {
    const audio = new Audio(listener);
    const aa = new AudioAnalyser(audio);
    const analyser = aa.analyser as unknown as MockAnalyserNode;
    expect(analyser.fftSize).toBe(2048);
    expect(analyser.frequencyBinCount).toBe(1024);
    expect(aa.data.length).toBe(1024);
    // audio.getOutput() (=gain) 应当把 analyser 加入 connect 列表
    const gain = audio.gain as unknown as { __connects: { to: unknown }[] };
    expect(gain.__connects.some((c) => c.to === aa.analyser)).toBe(true);
  });

  it('构造：自定义 fftSize', () => {
    const audio = new Audio(listener);
    const aa = new AudioAnalyser(audio, 256);
    const analyser = aa.analyser as unknown as MockAnalyserNode;
    expect(analyser.fftSize).toBe(256);
    expect(analyser.frequencyBinCount).toBe(128);
    expect(aa.data.length).toBe(128);
  });

  it('getFrequencyData：触发一次采样', () => {
    const audio = new Audio(listener);
    const aa = new AudioAnalyser(audio, 256);
    // mock 默认 fillValue=0；调用后 data 全 0
    const data = aa.getFrequencyData();
    const analyser = aa.analyser as unknown as MockAnalyserNode;
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);
    expect(data).toBe(aa.data);
    expect(data.length).toBe(128);
  });

  it('getAverageFrequency：返回所有 bin 的平均值', () => {
    const audio = new Audio(listener);
    const aa = new AudioAnalyser(audio, 256);
    const analyser = aa.analyser as unknown as MockAnalyserNode;
    // 让 mock 写入已知模式：偶数索引=200, 奇数=100 → 平均 150
    analyser.getByteFrequencyData = ((arr: Uint8Array<ArrayBuffer>) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i % 2 === 0 ? 200 : 100;
    }) as unknown as unknown as MockAnalyserNode['getByteFrequencyData'];
    const avg = aa.getAverageFrequency();
    expect(avg).toBeCloseTo(150, 5);
  });

  it('getAverageFrequency：空数据返回 0', () => {
    const audio = new Audio(listener);
    const aa = new AudioAnalyser(audio, 256);
    // 把 data 长度置为 0（极端场景）
    (aa as unknown as { data: { length: number } }).data = { length: 0 } as unknown as Uint8Array<ArrayBuffer>;
    expect(aa.getAverageFrequency()).toBe(0);
  });
});

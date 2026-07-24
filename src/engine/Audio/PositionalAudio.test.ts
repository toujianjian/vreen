import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PositionalAudio } from './PositionalAudio';
import { AudioListener } from './AudioListener';
import { AudioContextManager } from './AudioContext';
import {
  createMockAudioContext,
  createMockAudioBuffer,
  type MockAudioContext,
  type MockPannerNode,
  type MockBufferSourceNode,
} from './audioContextMock';

describe('PositionalAudio', () => {
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

  it('构造：panner 已创建并接到 gain', () => {
    const p = new PositionalAudio(listener);
    expect(p.type).toBe('PositionalAudio');
    expect(p.panner).toBe(mock.__pannerNodes[0]);
    const panner = p.panner as MockPannerNode;
    // panner 应连接到 gain
    expect(panner.__connects[0].to).toBe(p.gain);
    // 默认值来自原生 panner
    expect(p.distanceModel).toBe(panner.distanceModel);
    expect(p.refDistance).toBe(panner.refDistance);
    expect(p.maxDistance).toBe(panner.maxDistance);
    expect(p.rolloffFactor).toBe(panner.rolloffFactor);
  });

  it('getOutput 返回 panner 而非 gain', () => {
    const p = new PositionalAudio(listener);
    expect(p.getOutput()).toBe(p.panner);
  });

  it('play 后 source → panner 连接', () => {
    const p = new PositionalAudio(listener);
    p.setBuffer(createMockAudioBuffer());
    p.play();
    const src = mock.__bufferSources[0] as MockBufferSourceNode;
    expect(src.__connects[src.__connects.length - 1].to).toBe(p.panner);
  });

  it('setRefDistance / setRolloffFactor / setMaxDistance / setDistanceModel 写入 panner', () => {
    const p = new PositionalAudio(listener);
    p.setRefDistance(5);
    p.setRolloffFactor(2);
    p.setMaxDistance(50);
    p.setDistanceModel('linear');
    const panner = p.panner as MockPannerNode;
    expect(panner.refDistance).toBe(5);
    expect(panner.rolloffFactor).toBe(2);
    expect(panner.maxDistance).toBe(50);
    expect(panner.distanceModel).toBe('linear');
    expect(p.refDistance).toBe(5);
    expect(p.rolloffFactor).toBe(2);
  });

  it('setDirectionalCone 写入 panner 三个 cone 属性', () => {
    const p = new PositionalAudio(listener);
    p.setDirectionalCone(60, 120, 0.3);
    const panner = p.panner as MockPannerNode;
    expect(panner.coneInnerAngle).toBe(60);
    expect(panner.coneOuterAngle).toBe(120);
    expect(panner.coneOuterGain).toBe(0.3);
  });

  it('update 不在播放时（且 hasPlaybackControl）跳过 panner 写入', () => {
    const p = new PositionalAudio(listener);
    p.position.set(1, 2, 3);
    p.updateMatrixWorld(true);
    const panner = p.panner as MockPannerNode;
    // 没播放时 update 不应写入 panner
    expect(panner.positionX.lastRamp).toBeNull();
  });

  it('播放后 update 把世界位置写入 panner.positionX/Y/Z', () => {
    const p = new PositionalAudio(listener);
    p.setBuffer(createMockAudioBuffer());
    p.play();
    p.position.set(4, 5, 6);
    p.updateMatrixWorld(true);
    const panner = p.panner as MockPannerNode;
    expect(panner.positionX.lastRamp?.value).toBe(4);
    expect(panner.positionY.lastRamp?.value).toBe(5);
    expect(panner.positionZ.lastRamp?.value).toBe(6);
  });
});

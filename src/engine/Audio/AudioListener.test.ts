import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioListener, decomposeMatrix, applyQuaternionToVector } from './AudioListener';
import { AudioContextManager } from './AudioContext';
import {
  createMockAudioContext,
  createMockAudioNode,
  type MockAudioContext,
  type MockAudioNode,
  type MockAudioParam,
  type MockGainNode,
} from './audioContextMock';
import { Matrix4 } from '../Math/Matrix4';
import { Quaternion } from '../Math/Quaternion';
import { Vector3 } from '../Math/Vector3';

describe('AudioListener', () => {
  let mock: MockAudioContext;

  beforeEach(() => {
    mock = createMockAudioContext();
    AudioContextManager.setContext(mock as unknown as AudioContext);
  });

  afterEach(() => {
    AudioContextManager.setContext(undefined);
  });

  it('构造：默认值与节点拓扑', () => {
    const l = new AudioListener();
    expect(l.type).toBe('AudioListener');
    expect(l.context).toBe(mock);
    expect(l.gain).toBe(mock.__gainNodes[0]);
    expect(l.filter).toBeNull();
    expect(l.timeDelta).toBe(0);
    expect(l.getMasterVolume()).toBe(1);
    // gain 应连接到 destination
    const gain = l.gain as MockGainNode;
    expect(gain.__connects.length).toBe(1);
    expect(gain.__connects[0].to).toBe(mock.destination);
  });

  it('getInput 返回自身 gain', () => {
    const l = new AudioListener();
    expect(l.getInput()).toBe(l.gain);
  });

  it('setMasterVolume / getMasterVolume 通过 setTargetAtTime 写入', () => {
    const l = new AudioListener();
    l.setMasterVolume(0.5);
    expect((l.gain.gain as MockAudioParam).lastTarget?.value).toBe(0.5);
    expect(l.gain.gain.value).toBe(0.5);
  });

  it('setFilter 把 gain → filter → destination 串联，removeFilter 还原直连', () => {
    const l = new AudioListener();
    const filter = createMockAudioNode() as MockAudioNode;
    l.setFilter(filter);
    expect(l.filter).toBe(filter);
    // filter 应当被 gain 连接，且 filter 自己连接到 destination
    const gain = l.gain as MockGainNode;
    const lastConnect = gain.__connects[gain.__connects.length - 1];
    expect(lastConnect.to).toBe(filter);
    expect(filter.__connects[0].to).toBe(mock.destination);

    l.removeFilter();
    expect(l.filter).toBeNull();
  });

  it('updateMatrixWorld 把世界位置写到 native listener', () => {
    const l = new AudioListener();
    l.position.set(2, 3, 5);
    l.updateMatrixWorld(true);
    // AudioListener 默认 forward=-Z；identity 旋转下应为 (0,0,-1)
    expect(mock.listener.positionX.lastRamp?.value).toBe(2);
    expect(mock.listener.positionY.lastRamp?.value).toBe(3);
    expect(mock.listener.positionZ.lastRamp?.value).toBe(5);
    expect(mock.listener.forwardX.lastRamp?.value).toBe(0);
    expect(mock.listener.forwardZ.lastRamp?.value).toBe(-1);
    expect(mock.listener.upY.lastRamp?.value).toBe(1);
  });

  it('updateMatrixWorld 后 timeDelta 随上下文时间推进', () => {
    const l = new AudioListener();
    mock.tick(0.1);
    l.updateMatrixWorld(true);
    expect(l.timeDelta).toBeCloseTo(0.1, 5);
  });
});

describe('decomposeMatrix', () => {
  it('从纯平移矩阵提取位置', () => {
    const m = new Matrix4();
    const e = m.elements;
    e[12] = 10; e[13] = 20; e[14] = 30;
    const pos = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    decomposeMatrix(m, pos, q, s);
    expect(pos.x).toBe(10);
    expect(pos.y).toBe(20);
    expect(pos.z).toBe(30);
    // 无旋转
    expect(q.w).toBeCloseTo(1, 5);
    expect(s.x).toBeCloseTo(1, 5);
    expect(s.y).toBeCloseTo(1, 5);
    expect(s.z).toBeCloseTo(1, 5);
  });

  it('从缩放矩阵提取缩放', () => {
    const m = new Matrix4();
    const e = m.elements;
    e[0] = 2; e[5] = 3; e[10] = 4;
    const pos = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    decomposeMatrix(m, pos, q, s);
    expect(s.x).toBeCloseTo(2, 5);
    expect(s.y).toBeCloseTo(3, 5);
    expect(s.z).toBeCloseTo(4, 5);
  });
});

describe('applyQuaternionToVector', () => {
  it('identity 旋转保持向量不变', () => {
    const q = new Quaternion(0, 0, 0, 1);
    const v = new Vector3(1, 2, 3);
    const out = new Vector3();
    applyQuaternionToVector(q, v, out);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.y).toBeCloseTo(2, 5);
    expect(out.z).toBeCloseTo(3, 5);
  });

  it('绕 Y 轴 90° 旋转让 -Z → +X', () => {
    const q = new Quaternion();
    q.setFromEuler(0, Math.PI / 2, 0);
    const v = new Vector3(0, 0, -1);
    const out = new Vector3();
    applyQuaternionToVector(q, v, out);
    expect(out.x).toBeCloseTo(-1, 5); // -Z 绕 +Y 90° → -X
    expect(out.z).toBeCloseTo(0, 5);
  });
});

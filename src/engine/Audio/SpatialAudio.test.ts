import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpatialAudio, SpatialAudioSource } from './SpatialAudio';
import { AudioListener } from './AudioListener';
import { AudioContextManager } from './AudioContext';
import { Audio } from './Audio';
import {
  createMockAudioContext,
  createMockAudioBuffer,
  type MockAudioContext,
  type MockGainNode,
  type MockAudioParam,
} from './audioContextMock';
import { Vector3 } from '../Math/Vector3';

describe('SpatialAudio', () => {
  let mock: MockAudioContext;
  let listener: AudioListener;
  let spatial: SpatialAudio;

  beforeEach(() => {
    mock = createMockAudioContext();
    AudioContextManager.setContext(mock as unknown as AudioContext);
    listener = new AudioListener();
    spatial = new SpatialAudio(listener);
  });

  afterEach(() => {
    AudioContextManager.setContext(undefined);
  });

  describe('createSource', () => {
    it('创建源:写入 buffer、加入 map、Audio.gain 接到 listener', () => {
      const buf = createMockAudioBuffer();
      const src = spatial.createSource('sfx', buf, new Vector3(1, 2, 3));
      expect(src).not.toBeNull();
      expect(spatial.getSourceCount()).toBe(1);
      expect(src!.id).toBe('sfx');
      expect(src!.source.buffer).toBe(buf);
      expect(src!.position.x).toBe(1);
      expect(src!.position.y).toBe(2);
      expect(src!.position.z).toBe(3);
      // 默认值
      expect(src!.refDistance).toBe(1);
      expect(src!.maxDistance).toBe(100);
      expect(src!.rolloffFactor).toBe(1);
      expect(src!.coneInnerAngle).toBe(360);
      expect(src!.distanceModel).toBe('inverse');
      expect(src!.baseVolume).toBe(1);
      // Audio.gain 应连到 listener.getInput()
      const gain = src!.source.gain as MockGainNode;
      expect(gain.__connects[0].to).toBe(listener.getInput());
    });

    it('同 id 重复调用返回既有源', () => {
      const buf = createMockAudioBuffer();
      const s1 = spatial.createSource('a', buf, new Vector3());
      const s2 = spatial.createSource('a', createMockAudioBuffer(), new Vector3(9, 9, 9));
      expect(s2).toBe(s1);
      expect(spatial.getSourceCount()).toBe(1);
    });

    it('达到 maxSources 时返回 null', () => {
      spatial.maxSources = 2;
      const a = spatial.createSource('a', createMockAudioBuffer(), new Vector3());
      const b = spatial.createSource('b', createMockAudioBuffer(), new Vector3());
      const c = spatial.createSource('c', createMockAudioBuffer(), new Vector3());
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(c).toBeNull();
      expect(spatial.getSourceCount()).toBe(2);
    });

    it('mock 不支持 createStereoPanner:stereoPanner 为 null(优雅降级)', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3());
      expect(src!.stereoPanner).toBeNull();
    });
  });

  describe('removeSource', () => {
    it('移除存在的源并返回 true', () => {
      spatial.createSource('s', createMockAudioBuffer(), new Vector3());
      expect(spatial.removeSource('s')).toBe(true);
      expect(spatial.getSourceCount()).toBe(0);
    });

    it('移除不存在的源返回 false', () => {
      expect(spatial.removeSource('nope')).toBe(false);
    });
  });

  describe('播放控制', () => {
    it('play / pause / stop 委托到底层 Audio', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3())!;
      expect(src.source.isPlaying).toBe(false);
      spatial.play('s');
      expect(src.source.isPlaying).toBe(true);
      spatial.pause('s');
      expect(src.source.isPlaying).toBe(false);
      // stop 后进度归零
      spatial.stop('s');
      expect(src.source.isPlaying).toBe(false);
    });

    it('对未知 id 调用 play/pause/stop 不抛错', () => {
      expect(() => spatial.play('x')).not.toThrow();
      expect(() => spatial.pause('x')).not.toThrow();
      expect(() => spatial.stop('x')).not.toThrow();
    });
  });

  describe('setter 方法', () => {
    it('setPosition 复制位置(不持有引用)', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      const v = new Vector3(5, 0, 0);
      spatial.setPosition('s', v);
      expect(src.position.x).toBe(5);
      v.x = 99; // 修改原对象不应影响源
      expect(src.position.x).toBe(5);
    });

    it('setVelocity 复制速度', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      spatial.setVelocity('s', new Vector3(1, 0, 0));
      expect(src.velocity.x).toBe(1);
    });

    it('setVolume 写入 baseVolume', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      spatial.setVolume('s', 0.5);
      expect(src.baseVolume).toBe(0.5);
    });

    it('setCone 写入三个 cone 参数', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      spatial.setCone('s', 60, 120, 0.3);
      expect(src.coneInnerAngle).toBe(60);
      expect(src.coneOuterAngle).toBe(120);
      expect(src.coneOuterGain).toBe(0.3);
    });

    it('setDistanceModel 写入模型', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      spatial.setDistanceModel('s', 'linear');
      expect(src.distanceModel).toBe('linear');
    });

    it('对未知 id 调用 setter 不抛错', () => {
      expect(() => spatial.setPosition('x', new Vector3())).not.toThrow();
      expect(() => spatial.setVelocity('x', new Vector3())).not.toThrow();
      expect(() => spatial.setVolume('x', 1)).not.toThrow();
      expect(() => spatial.setCone('x', 1, 2, 0)).not.toThrow();
      expect(() => spatial.setDistanceModel('x', 'linear')).not.toThrow();
    });
  });

  describe('computeDistanceAttenuation', () => {
    it('inverse 模型:距离越远衰减越大', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      src.refDistance = 1;
      src.rolloffFactor = 1;
      src.distanceModel = 'inverse';
      src.lastDistance = 1;
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(1, 5);
      src.lastDistance = 11;
      // ref / (ref + rolloff * (d - ref)) = 1 / (1 + 10) = 1/11
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(1 / 11, 4);
      src.lastDistance = 0;
      // d < ref → 不衰减
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(1, 5);
    });

    it('linear 模型:d=max 时衰减为 0(rolloff=1)', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      src.refDistance = 1;
      src.maxDistance = 100;
      src.rolloffFactor = 1;
      src.distanceModel = 'linear';
      src.lastDistance = 1;
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(1, 5);
      src.lastDistance = 100;
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(0, 5);
      src.lastDistance = 50;
      // t = (50-1)/(100-1) = 49/99; v = 1 - 49/99 = 50/99
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(50 / 99, 4);
    });

    it('exponential 模型:d=ref 时为 1', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      src.refDistance = 1;
      src.rolloffFactor = 1;
      src.distanceModel = 'exponential';
      src.lastDistance = 1;
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(1, 5);
      src.lastDistance = 10;
      // (10/1)^-1 = 0.1
      expect(spatial.computeDistanceAttenuation(src)).toBeCloseTo(0.1, 4);
    });

    it('衰减结果钳制到 [0, 1]', () => {
      const src = spatial.createSource('s', createMockAudioBuffer())!;
      src.distanceModel = 'linear';
      src.refDistance = 1;
      src.maxDistance = 10;
      src.rolloffFactor = 2; // rolloff=2 会让线性模型超出 [0,1]
      src.lastDistance = 100;
      const v = spatial.computeDistanceAttenuation(src);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  describe('computeDoppler', () => {
    beforeEach(() => {
      listener.position.set(0, 0, 0);
    });

    it('源静止:shift = 1', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(10, 0, 0))!;
      const shift = spatial.computeDoppler(src);
      expect(shift).toBeCloseTo(1, 5);
    });

    it('源朝听者运动:shift > 1(音升高)', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(10, 0, 0))!;
      spatial.setVelocity('s', new Vector3(-10, 0, 0)); // 朝 -X 也就是朝听者运动
      const shift = spatial.computeDoppler(src);
      // c=343.3, vRadial=+10(接近);shift = 343.3 / (343.3 - 10) ≈ 1.0300
      expect(shift).toBeGreaterThan(1);
      expect(shift).toBeCloseTo(343.3 / 333.3, 3);
    });

    it('源背离听者运动:shift < 1(音降低)', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(10, 0, 0))!;
      spatial.setVelocity('s', new Vector3(10, 0, 0)); // 远离听者
      const shift = spatial.computeDoppler(src);
      expect(shift).toBeLessThan(1);
      expect(shift).toBeCloseTo(343.3 / 353.3, 3);
    });

    it('dopplerFactor=0 关闭多普勒:shift 恒为 1', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(10, 0, 0))!;
      spatial.setVelocity('s', new Vector3(-10, 0, 0));
      spatial.dopplerFactor = 0;
      expect(spatial.computeDoppler(src)).toBeCloseTo(1, 5);
    });

    it('源与听者重合:shift = 1(无法定方向)', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(0, 0, 0))!;
      spatial.setVelocity('s', new Vector3(-10, 0, 0));
      expect(spatial.computeDoppler(src)).toBeCloseTo(1, 5);
    });
  });

  describe('computeHRTF', () => {
    beforeEach(() => {
      // 默认 identity 朝向:forward=-Z, up=+Y, right=+X
      listener.position.set(0, 0, 0);
    });

    it('源在正前方:azimuth=0, pan=0', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(0, 0, -1))!;
      const h = spatial.computeHRTF(src);
      expect(h.azimuth).toBeCloseTo(0, 5);
      expect(h.pan).toBeCloseTo(0, 5);
      expect(h.itdMs).toBeCloseTo(0, 5);
      expect(h.ildDb).toBeCloseTo(0, 5);
      // 等功率 pan law 居中:left=right=cos(π/4)=√2/2
      expect(h.leftGain).toBeCloseTo(Math.SQRT1_2, 4);
      expect(h.rightGain).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('源在右侧:azimuth=π/2, pan=1', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(1, 0, 0))!;
      const h = spatial.computeHRTF(src);
      expect(h.azimuth).toBeCloseTo(Math.PI / 2, 5);
      expect(h.pan).toBeCloseTo(1, 5);
      expect(h.itdMs).toBeCloseTo(0.6, 4); // 右耳先听到
      expect(h.ildDb).toBeCloseTo(6, 4); // 右耳更响
      // pan=+1 → angle=(1+1)π/4=π/2 → left=cos(π/2)=0, right=sin(π/2)=1
      expect(h.leftGain).toBeCloseTo(0, 5);
      expect(h.rightGain).toBeCloseTo(1, 5);
    });

    it('源在左侧:azimuth=-π/2, pan=-1', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(-1, 0, 0))!;
      const h = spatial.computeHRTF(src);
      expect(h.azimuth).toBeCloseTo(-Math.PI / 2, 5);
      expect(h.pan).toBeCloseTo(-1, 5);
      expect(h.itdMs).toBeCloseTo(-0.6, 4); // 左耳先听到
      expect(h.leftGain).toBeCloseTo(1, 5);
      expect(h.rightGain).toBeCloseTo(0, 5);
    });

    it('源在正上方:elevation=π/2', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(0, 1, 0))!;
      const h = spatial.computeHRTF(src);
      expect(h.elevation).toBeCloseTo(Math.PI / 2, 5);
      // 正上方在水平面投影为零 → azimuth=atan2(0,0)=0
      expect(h.azimuth).toBeCloseTo(0, 5);
    });

    it('源与听者重合:返回居中默认值', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(0, 0, 0))!;
      const h = spatial.computeHRTF(src);
      expect(h.azimuth).toBe(0);
      expect(h.pan).toBe(0);
      expect(h.leftGain).toBe(1);
      expect(h.rightGain).toBe(1);
    });
  });

  describe('update', () => {
    it('应用距离衰减到 gain,playbackRate 反映多普勒', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(10, 0, 0))!;
      src.refDistance = 1;
      src.rolloffFactor = 1;
      src.distanceModel = 'inverse';
      src.baseVolume = 1;
      // 必须先 play,playbackRate 才会写到 source 节点
      spatial.play('s');

      listener.position.set(0, 0, 0);
      listener.updateMatrixWorld(true);

      spatial.update(0.016);

      // 距离 10,inverse:1 / (1 + 9) = 0.1
      expect(src.lastDistance).toBeCloseTo(10, 5);
      expect(src.lastAttenuation).toBeCloseTo(0.1, 4);
      // gain = baseVolume * attenuation * coneGain = 1 * 0.1 * 1 = 0.1
      const gainParam = src.source.gain.gain as MockAudioParam;
      expect(gainParam.value).toBeCloseTo(0.1, 4);
      // 静止 → doppler=1 → playbackRate=1
      expect(src.source.playbackRate).toBeCloseTo(1, 5);
    });

    it('listener 旋转后 HRTF 反映新朝向', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(0, 0, -1))!;
      // 源在 -Z(默认前方)
      listener.position.set(0, 0, 0);
      listener.updateMatrixWorld(true);
      spatial.update(0.016);
      expect(src.lastHRTF.azimuth).toBeCloseTo(0, 4);

      // 让 listener 绕 +Y 转 90°:forward 从 -Z 变为 -X
      // 用 rotation.set(0, sin(π/4), 0, cos(π/4)) 而非 setFromEuler,
      // 因为 _BoundQuaternion.setFromEuler 不触发 markDirty(VREEN 已知行为)
      const s = Math.SQRT1_2;
      listener.rotation.set(0, s, 0, s);
      listener.updateMatrixWorld(true);
      spatial.update(0.016);
      // 旋转后,原本在前方(-Z)的源相对 listener 在 +X 方位 → azimuth 应非零
      expect(Math.abs(src.lastHRTF.azimuth)).toBeGreaterThan(0.01);
    });

    it('listener 速度由位置差/dt 推导', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(0, 0, 0))!;
      spatial.play('s');
      listener.position.set(0, 0, 0);
      listener.updateMatrixWorld(true);
      spatial.update(0.1); // 第一次 update:无前位置,velocity=0

      // listener 移动到 (10, 0, 0):velocity ≈ (10,0,0)/0.1 = (100,0,0)
      listener.position.set(10, 0, 0);
      listener.updateMatrixWorld(true);
      spatial.update(0.1);
      // 此时 listener 朝 +X 远离源(源在原点),源相对 listener 朝 -X 远离
      // 但源静止,listener 速度 (100,0,0);dirToListener = (10,0,0) - (0,0,0) normalized = (1,0,0)
      // relVel = sourceVel - listenerVel = (0,0,0) - (100,0,0) = (-100,0,0)
      // vRadial = (-100,0,0) · (1,0,0) = -100 (远离) → shift = c / (c - (-100)) = c/(c+100) < 1
      expect(src.lastDopplerShift).toBeLessThan(1);
      expect(src.lastDopplerShift).toBeCloseTo(343.3 / (343.3 + 100), 2);
    });

    it('coneInnerAngle < 360 时对锥外源衰减', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(0, 0, 10))!;
      // 源在 +Z(listener 后方)
      src.orientation.set(0, 0, 1); // 源朝 +Z(默认)
      // 让源朝向背离听者 → listener 在源后方 → 锥外
      src.coneInnerAngle = 30;
      src.coneOuterAngle = 90;
      src.coneOuterGain = 0.2;
      src.refDistance = 1;
      src.maxDistance = 1000;
      src.rolloffFactor = 0; // 关闭距离衰减,只测锥
      spatial.play('s');

      listener.position.set(0, 0, 0);
      listener.updateMatrixWorld(true);
      spatial.update(0.016);
      // listener 在源 -Z 方向(源朝 +Z,listener 在源后方)
      // 源 orientation = (0,0,1),listener 相对源的方向 = (0,0,-1)
      // cos(angle) = -1,远小于 cos(coneOuter/2)=cos(45°) → 锥外
      expect(src.lastConeGain).toBeCloseTo(0.2, 4);
    });

    it('update 对未 play 的源也写 gain(便于预先设置)', () => {
      const src = spatial.createSource('s', createMockAudioBuffer(), new Vector3(10, 0, 0))!;
      // 不调用 play
      listener.position.set(0, 0, 0);
      listener.updateMatrixWorld(true);
      expect(() => spatial.update(0.016)).not.toThrow();
      // gain 仍然被设置
      const gainParam = src.source.gain.gain as MockAudioParam;
      expect(gainParam.value).toBeCloseTo(0.1, 4);
    });
  });

  describe('getActiveSources', () => {
    it('返回正在播放的源', () => {
      const a = spatial.createSource('a', createMockAudioBuffer(), new Vector3())!;
      spatial.createSource('b', createMockAudioBuffer(), new Vector3());
      spatial.play('a');
      const active = spatial.getActiveSources();
      expect(active.length).toBe(1);
      expect(active[0]).toBe(a);
    });

    it('无播放源时返回空数组', () => {
      spatial.createSource('a', createMockAudioBuffer(), new Vector3());
      expect(spatial.getActiveSources().length).toBe(0);
    });
  });

  describe('SpatialAudioSource', () => {
    it('构造:position 为 clone,velocity/orientation 为独立实例', () => {
      const audio = new Audio(listener);
      const pos = new Vector3(1, 2, 3);
      const s = new SpatialAudioSource('id', audio, pos);
      expect(s.position).not.toBe(pos);
      expect(s.position.x).toBe(1);
      expect(s.velocity).toBeDefined();
      expect(s.orientation.x).toBe(0);
      expect(s.orientation.z).toBe(1);
      // 默认 lastHRTF 居中
      expect(s.lastHRTF.pan).toBe(0);
      expect(s.lastHRTF.leftGain).toBe(1);
    });
  });
});

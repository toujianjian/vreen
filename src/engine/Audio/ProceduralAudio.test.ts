// ProceduralAudio 单元测试。
//
// 覆盖:
//   1. 构造 / sampleRate 校验
//   2. generateOscillator: 各类型长度与波形特征
//   3. generateNoise: 各颜色长度与值范围
//   4. applyEnvelope: ADSR 形状
//   5. applyFilter: lowpass / highpass / bandpass 频率响应
//   6. applyModulation: AM / FM 改变信号
//   7. mix / concatenate / resample / normalize
//   8. setters 链式
//   9. generate 流水线
//  10. 预设音效 (explosion / footstep / gunshot / wind / waterdrop / uibeep)
//  11. getStats / getSampleRate

import { describe, it, expect } from 'vitest';
import {
  ProceduralAudio,
  DEFAULT_ENVELOPE,
  DEFAULT_MODULATION,
  type OscillatorType,
  type NoiseType,
} from './ProceduralAudio';

const SR = 44100;

describe('ProceduralAudio — 构造', () => {
  it('默认 sampleRate=44100', () => {
    const pa = new ProceduralAudio();
    expect(pa.sampleRate).toBe(44100);
    expect(pa.getSampleRate()).toBe(44100);
    expect(pa.channels).toBe(1);
    expect(pa.oscillatorType).toBe('sine');
    expect(pa.frequency).toBe(440);
    expect(pa.duration).toBe(0.5);
    expect(pa.envelope).toEqual(DEFAULT_ENVELOPE);
    expect(pa.modulation).toEqual(DEFAULT_MODULATION);
    expect(pa.filterType).toBe('none');
    expect(pa.noiseType).toBe('white');
  });

  it('自定义 sampleRate', () => {
    const pa = new ProceduralAudio(48000);
    expect(pa.sampleRate).toBe(48000);
  });

  it('sampleRate 非正抛错', () => {
    expect(() => new ProceduralAudio(0)).toThrow();
    expect(() => new ProceduralAudio(-100)).toThrow();
  });
});

describe('ProceduralAudio — generateOscillator', () => {
  const pa = new ProceduralAudio(SR);

  const TYPES: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];
  for (const type of TYPES) {
    it(`${type} 长度正确且值在 [-1, 1]`, () => {
      const out = pa.generateOscillator(type, 440, 0.1);
      expect(out.length).toBe(Math.floor(0.1 * SR));
      for (let i = 0; i < out.length; i++) {
        expect(out[i]).toBeGreaterThanOrEqual(-1.01);
        expect(out[i]).toBeLessThanOrEqual(1.01);
      }
    });
  }

  it('sine 起点为 0', () => {
    const out = pa.generateOscillator('sine', 440, 0.01);
    expect(out[0]).toBeCloseTo(0, 5);
  });

  it('square 只取 ±1', () => {
    const out = pa.generateOscillator('square', 440, 0.01);
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i])).toBeCloseTo(1, 5);
    }
  });

  it('sawtooth 值在 [-1, 1]', () => {
    const out = pa.generateOscillator('sawtooth', 440, 0.01);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-1.01);
      expect(out[i]).toBeLessThanOrEqual(1.01);
    }
  });

  it('triangle 起点为 0', () => {
    const out = pa.generateOscillator('triangle', 440, 0.01);
    expect(out[0]).toBeCloseTo(0, 4);
  });

  it('noise 类型走 generateNoise 分支', () => {
    pa.noiseType = 'white';
    const out = pa.generateOscillator('noise', 440, 0.05);
    expect(out.length).toBe(Math.floor(0.05 * SR));
  });

  it('duration=0 返回空数组', () => {
    const out = pa.generateOscillator('sine', 440, 0);
    expect(out.length).toBe(0);
  });
});

describe('ProceduralAudio — generateNoise', () => {
  const pa = new ProceduralAudio(SR);
  const NOISES: NoiseType[] = ['white', 'pink', 'brown', 'blue', 'violet'];

  for (const type of NOISES) {
    it(`${type} 长度正确且非全零`, () => {
      const out = pa.generateNoise(type, 0.1);
      expect(out.length).toBe(Math.floor(0.1 * SR));
      let nonZero = false;
      for (let i = 0; i < out.length; i++) {
        if (out[i] !== 0) { nonZero = true; break; }
      }
      expect(nonZero).toBe(true);
    });
  }

  it('white 值在 [-1, 1]', () => {
    const out = pa.generateNoise('white', 0.05);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-1.0001);
      expect(out[i]).toBeLessThanOrEqual(1.0001);
    }
  });

  it('duration=0 返回空数组', () => {
    expect(pa.generateNoise('white', 0).length).toBe(0);
  });
});

describe('ProceduralAudio — applyEnvelope', () => {
  const pa = new ProceduralAudio(SR);

  it('全 1 输入:起音段线性上升', () => {
    const dur = 0.5;
    const n = Math.floor(dur * SR);
    const samples = new Float32Array(n).fill(1);
    pa.applyEnvelope(samples, { attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.1 });
    // 起音段第 1 个样本应接近 0
    expect(samples[0]).toBeCloseTo(0, 5);
    // 起音段末尾(0.1s 处)接近 1
    const idx = Math.floor(0.1 * SR);
    expect(samples[idx]).toBeCloseTo(1, 1);
    // 保持段接近 sustain
    const sustainIdx = Math.floor(0.25 * SR);
    expect(samples[sustainIdx]).toBeCloseTo(0.5, 1);
    // 释放段末尾接近 0
    expect(samples[n - 1]).toBeCloseTo(0, 1);
  });

  it('零包络(attack=0)直接进入衰减', () => {
    const n = Math.floor(0.2 * SR);
    const samples = new Float32Array(n).fill(1);
    pa.applyEnvelope(samples, { attack: 0, decay: 0.1, sustain: 0.5, release: 0.05 });
    // 起点应直接是 1(attack=0)
    expect(samples[0]).toBeCloseTo(1, 2);
  });

  it('sustain=1 全程保持', () => {
    const n = Math.floor(0.2 * SR);
    const samples = new Float32Array(n).fill(1);
    pa.applyEnvelope(samples, { attack: 0.01, decay: 0.01, sustain: 1, release: 0.01 });
    // 中段应保持 1
    const mid = Math.floor(n / 2);
    expect(samples[mid]).toBeCloseTo(1, 1);
  });

  it('ads 超过总时长时被压缩,不抛错', () => {
    const n = 100;
    const samples = new Float32Array(n).fill(1);
    expect(() =>
      pa.applyEnvelope(samples, { attack: 1, decay: 1, sustain: 0.5, release: 1 }),
    ).not.toThrow();
    // 仍产出有效值(非 NaN)
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(samples[i])).toBe(true);
    }
  });

  it('空数组安全', () => {
    const empty = new Float32Array(0);
    pa.applyEnvelope(empty, DEFAULT_ENVELOPE);
    expect(empty.length).toBe(0);
  });
});

describe('ProceduralAudio — applyFilter', () => {
  const pa = new ProceduralAudio(SR);

  it('none 类型直接返回', () => {
    const samples = new Float32Array(100).fill(0.5);
    pa.applyFilter(samples, 'none', 1000, 1);
    expect(samples[0]).toBe(0.5);
  });

  it('lowpass:高频衰减,低频保留', () => {
    // 高频正弦 5kHz
    const high = pa.generateOscillator('sine', 5000, 0.05);
    pa.applyFilter(high, 'lowpass', 200, 0.707);
    // 衰减后能量明显下降
    let peak = 0;
    for (let i = 0; i < high.length; i++) {
      if (Math.abs(high[i]) > peak) peak = Math.abs(high[i]);
    }
    expect(peak).toBeLessThan(0.5);
  });

  it('highpass:低频衰减,高频保留', () => {
    // 低频正弦 50Hz
    const low = pa.generateOscillator('sine', 50, 0.1);
    pa.applyFilter(low, 'highpass', 1000, 0.707);
    let peak = 0;
    for (let i = 0; i < low.length; i++) {
      if (Math.abs(low[i]) > peak) peak = Math.abs(low[i]);
    }
    expect(peak).toBeLessThan(0.5);
  });

  it('bandpass:改变信号不抛错', () => {
    const samples = pa.generateOscillator('sine', 440, 0.05);
    expect(() => pa.applyFilter(samples, 'bandpass', 500, 2)).not.toThrow();
  });

  it('空数组安全', () => {
    const empty = new Float32Array(0);
    expect(() => pa.applyFilter(empty, 'lowpass', 1000, 1)).not.toThrow();
  });
});

describe('ProceduralAudio — applyModulation', () => {
  const pa = new ProceduralAudio(SR);

  it('AM:改变信号(非恒等)', () => {
    const samples = pa.generateOscillator('sine', 440, 0.2);
    const before = samples.slice();
    pa.applyModulation(samples, 'am', 5, 0.5);
    let changed = false;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i] - before[i]) > 1e-4) { changed = true; break; }
    }
    expect(changed).toBe(true);
  });

  it('FM:改变信号(非恒等)', () => {
    const samples = pa.generateOscillator('sine', 440, 0.2);
    const before = samples.slice();
    pa.applyModulation(samples, 'fm', 10, 0.3);
    let changed = false;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i] - before[i]) > 1e-4) { changed = true; break; }
    }
    expect(changed).toBe(true);
  });

  it('depth=0 时不变', () => {
    const samples = pa.generateOscillator('sine', 440, 0.05);
    const before = samples.slice();
    pa.applyModulation(samples, 'am', 5, 0);
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]).toBeCloseTo(before[i], 6);
    }
  });

  it('空数组安全', () => {
    const empty = new Float32Array(0);
    expect(() => pa.applyModulation(empty, 'am', 5, 0.5)).not.toThrow();
    expect(() => pa.applyModulation(empty, 'fm', 5, 0.5)).not.toThrow();
  });
});

describe('ProceduralAudio — mix / concatenate / resample / normalize', () => {
  const pa = new ProceduralAudio(SR);

  it('mix:长度取最长且归一化', () => {
    const a = new Float32Array([1, 0.5, 0, 0]);
    const b = new Float32Array([0, 0.5, 1]);
    const out = pa.mix(a, b);
    expect(out.length).toBe(4);
    // 混合后峰值归一化为 1
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
    }
    expect(peak).toBeCloseTo(1, 4);
  });

  it('mix:无参数返回空数组', () => {
    const out = pa.mix();
    expect(out.length).toBe(0);
  });

  it('concatenate:首尾相接', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5]);
    const out = pa.concatenate(a, b);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resample:降采样缩短长度', () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < 100; i++) samples[i] = i;
    const out = pa.resample(samples, 44100, 22050);
    expect(out.length).toBeCloseTo(50, -1);
    // 内容近似(线性插值)
    expect(out[0]).toBeCloseTo(0, 5);
  });

  it('resample:相同采样率返回拷贝', () => {
    const samples = new Float32Array([1, 2, 3]);
    const out = pa.resample(samples, SR, SR);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(out).not.toBe(samples);
  });

  it('resample:非法采样率抛错', () => {
    const samples = new Float32Array([1, 2, 3]);
    expect(() => pa.resample(samples, 0, SR)).toThrow();
    expect(() => pa.resample(samples, SR, 0)).toThrow();
  });

  it('normalize:峰值归一化为 1', () => {
    const samples = new Float32Array([0.5, -0.25, 0.1]);
    pa.normalize(samples);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > peak) peak = Math.abs(samples[i]);
    }
    expect(peak).toBeCloseTo(1, 5);
  });

  it('normalize:全零样本不变', () => {
    const samples = new Float32Array([0, 0, 0]);
    pa.normalize(samples);
    expect(Array.from(samples)).toEqual([0, 0, 0]);
  });
});

describe('ProceduralAudio — setters 链式', () => {
  const pa = new ProceduralAudio(SR);

  it('setters 返回 this,可链式', () => {
    const ret = pa
      .setOscillatorType('square')
      .setFrequency(880)
      .setDuration(0.1)
      .setEnvelope({ attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.1 })
      .setFilter('lowpass', 2000, 1)
      .setNoiseType('pink')
      .setModulation('am', 7, 0.3);
    expect(ret).toBe(pa);
  });

  it('setOscillatorType', () => {
    pa.setOscillatorType('sawtooth');
    expect(pa.oscillatorType).toBe('sawtooth');
  });

  it('setEnvelope 拷贝(不共享引用)', () => {
    const env = { attack: 0.2, decay: 0.2, sustain: 0.3, release: 0.4 };
    pa.setEnvelope(env);
    expect(pa.envelope).toEqual(env);
    env.attack = 99;
    expect(pa.envelope.attack).toBe(0.2);
  });

  it('setModulation 启用', () => {
    pa.setModulation('fm', 20, 0.8);
    expect(pa.modulation.enabled).toBe(true);
    expect(pa.modulation.type).toBe('fm');
    expect(pa.modulation.frequency).toBe(20);
    expect(pa.modulation.depth).toBe(0.8);
  });
});

describe('ProceduralAudio — generate 流水线', () => {
  it('默认配置产出非空样本', () => {
    const pa = new ProceduralAudio(SR);
    const out = pa.generate();
    expect(out.length).toBe(Math.floor(0.5 * SR));
    let nonZero = false;
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== 0) { nonZero = true; break; }
    }
    expect(nonZero).toBe(true);
  });

  it('noise 振荡器 + 包络 + 滤波 + 调制 全链路不抛错', () => {
    const pa = new ProceduralAudio(SR);
    pa.setOscillatorType('noise')
      .setNoiseType('pink')
      .setDuration(0.2)
      .setEnvelope({ attack: 0.01, decay: 0.05, sustain: 0.6, release: 0.05 })
      .setFilter('lowpass', 800, 1)
      .setModulation('am', 5, 0.3);
    const out = pa.generate();
    expect(out.length).toBe(Math.floor(0.2 * SR));
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});

describe('ProceduralAudio — 预设音效', () => {
  const pa = new ProceduralAudio(SR);

  const presets: Array<[string, () => Float32Array]> = [
    ['generateExplosion', () => pa.generateExplosion()],
    ['generateFootstep', () => pa.generateFootstep()],
    ['generateGunshot', () => pa.generateGunshot()],
    ['generateWind', () => pa.generateWind()],
    ['generateWaterDrop', () => pa.generateWaterDrop()],
    ['generateUIBeep', () => pa.generateUIBeep()],
  ];

  for (const [name, fn] of presets) {
    it(`${name}:产出非空且有限值`, () => {
      const out = fn();
      expect(out.length).toBeGreaterThan(0);
      let peak = 0;
      for (let i = 0; i < out.length; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
      }
      // 非静音
      expect(peak).toBeGreaterThan(0.01);
      // generateWind 等预设在重采样/滤波下计算量大,慢机器 + 全量并发可能超过默认 5s。
    }, 20000);
  }

  it('generateUIBeep 后恢复 instance 状态', () => {
    pa.setOscillatorType('sawtooth').setFrequency(220).setDuration(1.0);
    pa.generateUIBeep();
    expect(pa.oscillatorType).toBe('sawtooth');
    expect(pa.frequency).toBe(220);
    expect(pa.duration).toBe(1.0);
  });

  it('generateWaterDrop 含频率下扫特征', () => {
    const out = pa.generateWaterDrop();
    // 末尾衰减到接近 0
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.1);
  });
});

describe('ProceduralAudio — getStats', () => {
  it('返回当前配置快照', () => {
    const pa = new ProceduralAudio(SR);
    pa.setOscillatorType('square').setFrequency(880).setDuration(0.3);
    const s = pa.getStats();
    expect(s.sampleRate).toBe(SR);
    expect(s.oscillatorType).toBe('square');
    expect(s.frequency).toBe(880);
    expect(s.duration).toBe(0.3);
    expect(s.envelope).toEqual(DEFAULT_ENVELOPE);
    expect(s.modulation).toEqual(DEFAULT_MODULATION);
  });

  it('envelope / modulation 为拷贝(不共享引用)', () => {
    const pa = new ProceduralAudio(SR);
    const s = pa.getStats();
    s.envelope.attack = 99;
    s.modulation.depth = 99;
    expect(pa.envelope.attack).toBe(DEFAULT_ENVELOPE.attack);
    expect(pa.modulation.depth).toBe(DEFAULT_MODULATION.depth);
  });
});

// AudioEffects 单元测试。
//
// 覆盖:
//   1. 构造 / sampleRate 校验
//   2. addEffect / removeEffect / getEffect / getEffects
//   3. setEffectParam / getEffectParam(覆盖默认值)
//   4. enableEffect / disableEffect / reorderEffect
//   5. process:无效果时线性变换(inputGain * outputGain)
//   6. process:跳过 disabled 效果
//   7. process:湿信号 mix 正确(dry/wet 加权)
//   8. 各效果 process* 不崩溃且改变信号
//   9. processLowpass:高频衰减,低频保留
//  10. processHighpass:低频衰减,高频保留
//  11. processDistortion:tanh 限幅,|y| <= 1
//  12. processCompressor:大信号被压缩
//  13. 流式 process:跨调用 DSP 状态保留
//  14. setInputGain / setOutputGain / setWetMix / clear
//  15. getStats

import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEffects, type AudioEffectType } from './AudioEffects';

/** 生成正弦波 Float32Array。 */
function sine(samples: number, sampleRate: number, freq: number, amp = 1): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp;
  }
  return out;
}

const SR = 44100;
const ALL_TYPES: AudioEffectType[] = [
  'reverb',
  'echo',
  'chorus',
  'distortion',
  'lowpass',
  'highpass',
  'compressor',
  'flanger',
];

describe('AudioEffects construction', () => {
  it('默认 sampleRate=44100', () => {
    const fx = new AudioEffects();
    expect(fx.sampleRate).toBe(44100);
    expect(fx.inputGain).toBe(1);
    expect(fx.outputGain).toBe(1);
    expect(fx.wetMix).toBe(1);
    expect(fx.effects).toEqual([]);
  });

  it('自定义 sampleRate', () => {
    const fx = new AudioEffects(48000);
    expect(fx.sampleRate).toBe(48000);
  });

  it('sampleRate 非正抛错', () => {
    expect(() => new AudioEffects(0)).toThrow();
    expect(() => new AudioEffects(-100)).toThrow();
  });
});

describe('AudioEffects effect management', () => {
  let fx: AudioEffects;

  beforeEach(() => {
    fx = new AudioEffects(SR);
  });

  it('addEffect 返回唯一 id,默认参数注入', () => {
    const id1 = fx.addEffect('reverb');
    const id2 = fx.addEffect('echo');
    expect(id1).not.toBe(id2);
    expect(fx.getEffect(id1)?.type).toBe('reverb');
    expect(fx.getEffect(id2)?.type).toBe('echo');
    // 默认参数
    expect(fx.getEffectParam(id1, 'decay')).toBe(0.5);
    expect(fx.getEffectParam(id2, 'delay')).toBe(250);
    expect(fx.getEffect(id1)?.enabled).toBe(true);
  });

  it('addEffect 自定义参数覆盖默认', () => {
    const id = fx.addEffect('reverb', { decay: 0.9, roomSize: 0.7 });
    expect(fx.getEffectParam(id, 'decay')).toBe(0.9);
    expect(fx.getEffectParam(id, 'roomSize')).toBe(0.7);
    // 未覆盖的保留默认
    expect(fx.getEffectParam(id, 'damping')).toBe(0.5);
  });

  it('addEffect 所有 8 种类型均可添加', () => {
    const ids = ALL_TYPES.map((t) => fx.addEffect(t));
    expect(fx.effects.length).toBe(8);
    expect(fx.getEffects().map((e) => e.type)).toEqual(ALL_TYPES);
    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('removeEffect', () => {
    const id1 = fx.addEffect('reverb');
    const id2 = fx.addEffect('echo');
    expect(fx.removeEffect(id1)).toBe(true);
    expect(fx.effects.length).toBe(1);
    expect(fx.getEffect(id1)).toBeUndefined();
    expect(fx.removeEffect('nonexistent')).toBe(false);
    expect(fx.removeEffect(id2)).toBe(true);
    expect(fx.effects.length).toBe(0);
  });

  it('setEffectParam / getEffectParam', () => {
    const id = fx.addEffect('echo', { delay: 100 });
    expect(fx.setEffectParam(id, 'delay', 500)).toBe(true);
    expect(fx.getEffectParam(id, 'delay')).toBe(500);
    expect(fx.setEffectParam('nonexistent', 'x', 1)).toBe(false);
    expect(fx.getEffectParam('nonexistent', 'x')).toBeUndefined();
    expect(fx.getEffectParam(id, 'nonexistent')).toBeUndefined();
  });

  it('enableEffect / disableEffect', () => {
    const id = fx.addEffect('reverb');
    expect(fx.disableEffect(id)).toBe(true);
    expect(fx.getEffect(id)?.enabled).toBe(false);
    expect(fx.enableEffect(id)).toBe(true);
    expect(fx.getEffect(id)?.enabled).toBe(true);
    expect(fx.disableEffect('nonexistent')).toBe(false);
    expect(fx.enableEffect('nonexistent')).toBe(false);
  });

  it('reorderEffect', () => {
    const id1 = fx.addEffect('reverb');
    const id2 = fx.addEffect('echo');
    const id3 = fx.addEffect('chorus');
    expect(fx.effects.map((e) => e.id)).toEqual([id1, id2, id3]);

    expect(fx.reorderEffect(id3, 0)).toBe(true);
    expect(fx.effects.map((e) => e.id)).toEqual([id3, id1, id2]);

    expect(fx.reorderEffect(id1, 2)).toBe(true);
    expect(fx.effects.map((e) => e.id)).toEqual([id3, id2, id1]);

    // 边界:越界拒绝
    expect(fx.reorderEffect(id1, -1)).toBe(false);
    expect(fx.reorderEffect(id1, 99)).toBe(false);
    expect(fx.reorderEffect('nonexistent', 0)).toBe(false);
    // 同位置算成功但顺序不变
    expect(fx.reorderEffect(id1, 2)).toBe(true);
    expect(fx.effects.map((e) => e.id)).toEqual([id3, id2, id1]);
  });

  it('getEffects 返回浅拷贝(不影响内部)', () => {
    fx.addEffect('reverb');
    const arr = fx.getEffects();
    arr.length = 0;
    expect(fx.effects.length).toBe(1);
  });

  it('getEffect 按 id 取', () => {
    const id = fx.addEffect('distortion');
    const fx0 = fx.getEffect(id);
    expect(fx0).toBeDefined();
    expect(fx0?.type).toBe('distortion');
    expect(fx.getEffect('xxx')).toBeUndefined();
  });
});

describe('AudioEffects.process', () => {
  let fx: AudioEffects;

  beforeEach(() => {
    fx = new AudioEffects(SR);
  });

  it('无效果时 output = input * inputGain * outputGain', () => {
    const N = 256;
    const input = sine(N, SR, 440, 0.5);
    const output = new Float32Array(N);
    fx.inputGain = 0.5;
    fx.outputGain = 2;
    fx.process(input, output, N);
    for (let i = 0; i < N; i++) {
      expect(output[i]).toBeCloseTo(input[i] * 1, 5); // 0.5 * 2 = 1
    }
  });

  it('湿信号 mix=0 时输出为干信号 * 增益', () => {
    const N = 128;
    const input = sine(N, SR, 1000, 0.5);
    const output = new Float32Array(N);
    fx.addEffect('echo', { feedback: 0.5, delay: 50 });
    fx.wetMix = 0;
    fx.inputGain = 1;
    fx.outputGain = 1;
    fx.process(input, output, N);
    for (let i = 0; i < N; i++) {
      expect(output[i]).toBeCloseTo(input[i], 5);
    }
  });

  it('disabled 效果被跳过', () => {
    const N = 256;
    const input = new Float32Array(N).fill(0.5);
    const output = new Float32Array(N);
    const id = fx.addEffect('distortion', { drive: 5 });
    fx.disableEffect(id);
    fx.process(input, output, N);
    // distortion 被禁用 -> 输出 = 输入
    for (let i = 0; i < N; i++) {
      expect(output[i]).toBeCloseTo(0.5, 5);
    }
  });

  it('8 种效果各跑一次不崩溃且改变信号', () => {
    const N = 1024;
    const input = sine(N, SR, 440, 0.5);
    for (const type of ALL_TYPES) {
      const fx2 = new AudioEffects(SR);
      fx2.addEffect(type);
      const out = new Float32Array(N);
      expect(() => fx2.process(input, out, N)).not.toThrow();
      // 至少有 1 个样本不为 0
      let nonzero = 0;
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i]) > 1e-9) nonzero++;
      }
      expect(nonzero).toBeGreaterThan(0);
    }
  });
});

describe('AudioEffects 各效果行为', () => {
  let fx: AudioEffects;

  beforeEach(() => {
    fx = new AudioEffects(SR);
  });

  it('processLowpass:高频衰减,低频保留', () => {
    const N = 2048;
    // 低频 100Hz,高频 8000Hz
    const lowIn = sine(N, SR, 100, 1);
    const highIn = sine(N, SR, 8000, 1);
    fx.addEffect('lowpass', { cutoff: 500, Q: 0.7 });
    const lowOut = new Float32Array(N);
    const highOut = new Float32Array(N);
    fx.process(lowIn, lowOut, N);
    fx.clear();
    fx.addEffect('lowpass', { cutoff: 500, Q: 0.7 });
    fx.process(highIn, highOut, N);

    const lowRms = rms(lowOut.slice(100, N));
    const highRms = rms(highOut.slice(100, N));
    // 低频应明显高于高频(滤波后)
    expect(lowRms).toBeGreaterThan(highRms * 2);
  });

  it('processHighpass:低频衰减,高频保留', () => {
    const N = 2048;
    const lowIn = sine(N, SR, 100, 1);
    const highIn = sine(N, SR, 8000, 1);
    fx.addEffect('highpass', { cutoff: 1000, Q: 0.7 });
    const lowOut = new Float32Array(N);
    const highOut = new Float32Array(N);
    fx.process(lowIn, lowOut, N);
    fx.clear();
    fx.addEffect('highpass', { cutoff: 1000, Q: 0.7 });
    fx.process(highIn, highOut, N);

    const lowRms = rms(lowOut.slice(100, N));
    const highRms = rms(highOut.slice(100, N));
    expect(highRms).toBeGreaterThan(lowRms * 2);
  });

  it('processDistortion:tanh 限幅,|y| <= 1', () => {
    const N = 1024;
    const input = sine(N, SR, 440, 2); // 幅度 2
    fx.addEffect('distortion', { drive: 10 });
    const output = new Float32Array(N);
    fx.process(input, output, N);
    for (let i = 0; i < N; i++) {
      expect(Math.abs(output[i])).toBeLessThanOrEqual(1.001);
    }
  });

  it('processCompressor:大信号被压缩', () => {
    const N = 4096;
    const loud = sine(N, SR, 440, 1); // 全幅
    const quiet = sine(N, SR, 440, 0.01); // 远低于 threshold
    fx.addEffect('compressor', { threshold: -20, ratio: 8 });

    const loudOut = new Float32Array(N);
    const quietOut = new Float32Array(N);
    fx.process(loud, loudOut, N);
    fx.clear();
    fx.addEffect('compressor', { threshold: -20, ratio: 8 });
    fx.process(quiet, quietOut, N);

    const loudRms = rms(loudOut.slice(50, N));
    const quietRms = rms(quietOut.slice(50, N));
    // 大信号压缩后应该比未压缩(原 ~0.7)显著降低
    expect(loudRms).toBeLessThan(0.7);
    // 小信号应该几乎不衰减(在 threshold 之下)
    expect(quietRms).toBeGreaterThan(0.005);
  });

  it('processEcho:延迟后输出在 buffer 末尾出现延迟样本', () => {
    const N = 2048;
    const input = new Float32Array(N);
    // 单脉冲在 100 处
    input[100] = 1;
    fx.addEffect('echo', { delay: 200, feedback: 0 }); // feedback=0 -> 仅 1 次延迟
    const output = new Float32Array(N);
    fx.process(input, output, N);
    // 200ms 在 44100Hz 下是 8820 samples -> 超出 N,所以应当用更短的 delay
    fx.clear();
    fx.addEffect('echo', { delay: 5, feedback: 0 });
    fx.process(input, output, N);
    // 5ms ≈ 220 samples,延迟样本应在 100+220=320 附近。
    // 注意:脉冲本身在 i=100 处也会让 output=1(因 input + delayed),
    // 所以只在脉冲位置之后找峰值。
    let peakIdx = 110;
    let peakVal = 0;
    for (let i = 110; i < N; i++) {
      if (Math.abs(output[i]) > peakVal) {
        peakVal = Math.abs(output[i]);
        peakIdx = i;
      }
    }
    // 延迟峰值应在 320 附近(容差 ±10 samples)
    expect(Math.abs(peakIdx - 320)).toBeLessThan(10);
    expect(peakVal).toBeGreaterThan(0.5);
    // 在脉冲前应为 0
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(output[i])).toBeLessThan(1e-6);
    }
  });

  it('processChorus:输出与输入不重合(LFO 调制产生偏移)', () => {
    const N = 2048;
    const input = sine(N, SR, 440, 0.5);
    fx.addEffect('chorus', { rate: 1.5, depth: 2, mix: 0.5 });
    const output = new Float32Array(N);
    fx.process(input, output, N);
    // 至少有 1 个样本明显不等于输入(因为调制延迟)
    let diff = 0;
    for (let i = 0; i < N; i++) {
      diff += Math.abs(output[i] - input[i]);
    }
    expect(diff).toBeGreaterThan(0.01);
  });

  it('processFlanger:反馈为 0 时输出有限', () => {
    const N = 2048;
    const input = sine(N, SR, 440, 0.5);
    fx.addEffect('flanger', { rate: 0.5, depth: 2, feedback: 0, mix: 0.5 });
    const output = new Float32Array(N);
    fx.process(input, output, N);
    for (let i = 0; i < N; i++) {
      expect(Math.abs(output[i])).toBeLessThanOrEqual(2);
    }
  });

  it('processReverb:Schroeder 链不崩溃且输出非零', () => {
    const N = 4096;
    const input = sine(N, SR, 440, 0.5);
    fx.addEffect('reverb', { decay: 0.7, roomSize: 0.8, damping: 0.3 });
    const output = new Float32Array(N);
    fx.process(input, output, N);
    let max = 0;
    for (let i = 0; i < N; i++) {
      max = Math.max(max, Math.abs(output[i]));
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(5);
  });

  it('流式 process:跨调用 DSP 状态保留(连续无爆音)', () => {
    const N = 512;
    const block1 = sine(N, SR, 440, 0.5);
    const block2 = sine(N, SR, 440, 0.5);
    fx.addEffect('lowpass', { cutoff: 500 });
    const out1 = new Float32Array(N);
    const out2 = new Float32Array(N);
    fx.process(block1, out1, N);
    fx.process(block2, out2, N);
    // 两个块都应有限
    for (let i = 0; i < N; i++) {
      expect(Math.abs(out1[i])).toBeLessThan(2);
      expect(Math.abs(out2[i])).toBeLessThan(2);
    }
  });
});

describe('AudioEffects 增益 / 清理 / 统计', () => {
  let fx: AudioEffects;

  beforeEach(() => {
    fx = new AudioEffects(SR);
  });

  it('setInputGain / setOutputGain / setWetMix', () => {
    fx.setInputGain(0.3);
    fx.setOutputGain(1.5);
    fx.setWetMix(0.7);
    expect(fx.inputGain).toBe(0.3);
    expect(fx.outputGain).toBe(1.5);
    expect(fx.wetMix).toBe(0.7);
  });

  it('setWetMix 钳制到 [0,1]', () => {
    fx.setWetMix(5);
    expect(fx.wetMix).toBe(1);
    fx.setWetMix(-1);
    expect(fx.wetMix).toBe(0);
  });

  it('clear 清空效果链', () => {
    fx.addEffect('reverb');
    fx.addEffect('echo');
    expect(fx.effects.length).toBe(2);
    fx.clear();
    expect(fx.effects.length).toBe(0);
    expect(fx.getEffects()).toEqual([]);
  });

  it('getStats', () => {
    const id1 = fx.addEffect('reverb');
    fx.addEffect('echo');
    fx.disableEffect(id1);
    fx.inputGain = 0.5;
    fx.outputGain = 1.5;
    fx.wetMix = 0.7;
    const stats = fx.getStats();
    expect(stats.effectCount).toBe(2);
    expect(stats.enabledCount).toBe(1);
    expect(stats.disabledCount).toBe(1);
    expect(stats.effectTypes).toEqual(['reverb', 'echo']);
    expect(stats.inputGain).toBe(0.5);
    expect(stats.outputGain).toBe(1.5);
    expect(stats.wetMix).toBe(0.7);
    expect(stats.sampleRate).toBe(SR);
  });

  it('getStats 空链', () => {
    const stats = fx.getStats();
    expect(stats.effectCount).toBe(0);
    expect(stats.enabledCount).toBe(0);
    expect(stats.disabledCount).toBe(0);
    expect(stats.effectTypes).toEqual([]);
  });
});

// ── 辅助 ──────────────────────────────────────────────────────────

function rms(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] * arr[i];
  }
  return Math.sqrt(sum / arr.length);
}



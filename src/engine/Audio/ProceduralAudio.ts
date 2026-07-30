// ProceduralAudio — 程序化音效生成(振荡器 + 噪声 + ADSR 包络 + 滤波 + AM/FM 调制 + 混合)。
//
// 设计目标:
//   - 纯 DSP,不依赖 AudioContext / 浏览器节点图(与 AudioEffects 同理念):
//     输入输出都是 Float32Array(单声道 PCM),便于离线渲染 / 测试 / 预生成
//     音效库 / 录音后处理;
//   - 可组合的原子操作:
//       generateOscillator / generateNoise   → 信号源
//       applyEnvelope (ADSR)                 → 形状
//       applyFilter (biquad RBJ)             → 音色
//       applyModulation (AM/FM)              → 调制
//       mix / concatenate / resample / normalize → 拼接
//   - 顶层 generate() 按 instance 状态(振荡器类型 / 频率 / 时长 / 包络 /
//     滤波 / 调制)流水线产出一段样本;
//   - 内置预设音效:generateExplosion / generateFootstep / generateGunshot /
//     generateWind / generateWaterDrop / generateUIBeep,各自组装上述原子
//     操作,直接产出可用样本。
//
// 与 Audio / PositionalAudio 的关系:
//   - Audio 走 Web Audio 节点图(浏览器做 DSP);
//   - ProceduralAudio 离线合成,产出 PCM,可灌入 AudioBufferSourceNode
//     播放,也可落盘 / 序列化;
//   - 与 AudioEffects 互补:AudioEffects 处理已有样本(效果链),
//     ProceduralAudio 从零合成样本。
//
// DSP 算法参考:
//   - 振荡器:sin / 方波 / 锯齿 / 三角 的标准解析式;
//   - 噪声:白(均匀)、粉(Paul Kellet refined)、棕(积分白噪声 + 漏)、
//     蓝(差分白噪声,高通)、紫(二次差分,更高通);
//   - ADSR:线性段;
//   - 滤波:RBJ Audio EQ Cookbook biquad(双线性变换);
//   - 调制:AM = 幅度相乘;FM = 可变读指针重采样(相位调制等价);
//   - 重采样:线性插值。

import { createLogger } from '@/lib/logger';

const log = createLogger('ProceduralAudio');
void log; // 预留:预设与原子操作目前静默,后续可在出错处补 log

/** 振荡器类型。 */
export type OscillatorType =
  | 'sine'
  | 'square'
  | 'sawtooth'
  | 'triangle'
  | 'noise';

/** 噪声类型(颜色)。 */
export type NoiseType = 'white' | 'pink' | 'brown' | 'blue' | 'violet';

/** 滤波器类型。 */
export type ProceduralFilterType = 'none' | 'lowpass' | 'highpass' | 'bandpass';

/** ADSR 包络。 */
export interface Envelope {
  /** 起音(秒):0 → 1。 */
  attack: number;
  /** 衰减(秒):1 → sustain。 */
  decay: number;
  /** 保持电平(0..1)。 */
  sustain: number;
  /** 释放(秒):sustain → 0。 */
  release: number;
}

/** 调制参数。 */
export interface Modulation {
  enabled: boolean;
  /** 'am' 幅度调制 | 'fm' 频率调制。 */
  type: 'am' | 'fm';
  /** 调制频率(Hz)。 */
  frequency: number;
  /** 调制深度(0..1)。 */
  depth: number;
}

/** 程序化音效统计。 */
export interface ProceduralAudioStats {
  sampleRate: number;
  channels: number;
  oscillatorType: OscillatorType;
  frequency: number;
  duration: number;
  envelope: Envelope;
  filterType: ProceduralFilterType;
  filterCutoff: number;
  filterResonance: number;
  noiseType: NoiseType;
  modulation: Modulation;
}

/** 默认 ADSR。 */
export const DEFAULT_ENVELOPE: Envelope = {
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.2,
};

/** 默认调制(关闭)。 */
export const DEFAULT_MODULATION: Modulation = {
  enabled: false,
  type: 'am',
  frequency: 5,
  depth: 0.5,
};

/** 限制 v 到 [lo, hi]。 */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * 程序化音效生成器。
 *
 * 用法:
 *   const pa = new ProceduralAudio(44100);
 *   pa.setOscillatorType('sine').setFrequency(440).setDuration(0.5);
 *   const pcm = pa.generate(); // Float32Array
 *   // 预设:
 *   const boom = pa.generateExplosion();
 */
export class ProceduralAudio {
  /** 采样率(Hz)。 */
  readonly sampleRate: number;
  /** 通道数(1=单声道,2=立体声)。generate() 输出单声道;此值为元数据。 */
  channels: number = 1;
  /** 振荡器类型(默认 sine)。 */
  oscillatorType: OscillatorType = 'sine';
  /** 频率(Hz,默认 A4=440)。 */
  frequency: number = 440;
  /** 时长(秒)。 */
  duration: number = 0.5;
  /** ADSR 包络。 */
  envelope: Envelope = { ...DEFAULT_ENVELOPE };
  /** 滤波器。 */
  filterType: ProceduralFilterType = 'none';
  /** 滤波截止频率(Hz)。 */
  filterCutoff: number = 1000;
  /** 滤波谐振(Q,0.1..20)。 */
  filterResonance: number = 0.707;
  /** 噪声类型(当 oscillatorType='noise' 时使用)。 */
  noiseType: NoiseType = 'white';
  /** 调制参数。 */
  modulation: Modulation = { ...DEFAULT_MODULATION };

  constructor(sampleRate: number = 44100) {
    if (sampleRate <= 0) {
      throw new Error(`ProceduralAudio: sampleRate must be positive, got ${sampleRate}`);
    }
    this.sampleRate = sampleRate;
  }

  // ── 信号源 ────────────────────────────────────────────────────────

  /**
   * 生成振荡器样本。
   * @param type 振荡器类型
   * @param frequency 频率(Hz)
   * @param duration 时长(秒)
   * @returns Float32Array(单声道)
   */
  generateOscillator(
    type: OscillatorType,
    frequency: number,
    duration: number,
  ): Float32Array {
    const n = Math.max(0, Math.floor(duration * this.sampleRate));
    const out = new Float32Array(n);
    if (n === 0) return out;

    if (type === 'noise') {
      return this.generateNoise(this.noiseType, duration);
    }

    const twoPiF = 2 * Math.PI * frequency;
    const inv = 1 / this.sampleRate;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i * inv;
      switch (type) {
        case 'sine':
          out[i] = Math.sin(twoPiF * t);
          break;
        case 'square':
          // 标准方波:sign(sin)
          out[i] = Math.sin(phase) >= 0 ? 1 : -1;
          break;
        case 'sawtooth':
          // 锯齿:2 * (phase/2π - floor(0.5 + phase/2π))
          out[i] = 2 * (phase / (2 * Math.PI) - Math.floor(0.5 + phase / (2 * Math.PI)));
          break;
        case 'triangle':
          // 三角:2/π * asin(sin(phase))
          out[i] = (2 / Math.PI) * Math.asin(Math.sin(phase));
          break;
      }
      phase += twoPiF * inv;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    }
    return out;
  }

  /**
   * 生成噪声样本。
   * @param type 噪声颜色
   * @param duration 时长(秒)
   */
  generateNoise(type: NoiseType, duration: number): Float32Array {
    const n = Math.max(0, Math.floor(duration * this.sampleRate));
    const out = new Float32Array(n);
    if (n === 0) return out;

    switch (type) {
      case 'white': {
        for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
        break;
      }
      case 'pink': {
        // Paul Kellet refined method:多个 b0..b6 一阶滤波器叠加
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < n; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.969 * b2 + white * 0.153852;
          b3 = 0.8665 * b3 + white * 0.3104856;
          b4 = 0.55 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.016898;
          out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        }
        break;
      }
      case 'brown': {
        // 棕噪声:积分白噪声 + 漏(避免直流漂移)
        let last = 0;
        for (let i = 0; i < n; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          out[i] = last * 3.5; // 增益补偿
        }
        break;
      }
      case 'blue': {
        // 蓝噪声:差分白噪声(高通一阶)
        let last = 0;
        for (let i = 0; i < n; i++) {
          const white = Math.random() * 2 - 1;
          out[i] = (white - last) * 0.7;
          last = white;
        }
        break;
      }
      case 'violet': {
        // 紫噪声:二次差分白噪声(更高通)
        let last1 = 0, last2 = 0;
        for (let i = 0; i < n; i++) {
          const white = Math.random() * 2 - 1;
          out[i] = (white - 2 * last1 + last2) * 0.5;
          last2 = last1;
          last1 = white;
        }
        break;
      }
    }
    return out;
  }

  // ── DSP 原子操作 ──────────────────────────────────────────────────

  /**
   * 应用 ADSR 包络(就地修改)。
   * @param samples 样本(将被修改)
   * @param env ADSR 参数
   * @returns 同一 Float32Array(就地)
   */
  applyEnvelope(samples: Float32Array, env: Envelope): Float32Array {
    const n = samples.length;
    if (n === 0) return samples;

    const sr = this.sampleRate;
    const attackSamp = Math.max(0, Math.floor(env.attack * sr));
    const decaySamp = Math.max(0, Math.floor(env.decay * sr));
    const releaseSamp = Math.max(0, Math.floor(env.release * sr));
    const sustainLevel = clamp(env.sustain, 0, 1);

    // 释放段必须从某点开始;若 attack+decay+release > n,按比例压缩。
    const adsSum = attackSamp + decaySamp + releaseSamp;
    let a = attackSamp;
    let d = decaySamp;
    let r = releaseSamp;
    if (adsSum > n) {
      const scale = n / adsSum;
      a = Math.floor(attackSamp * scale);
      d = Math.floor(decaySamp * scale);
      r = n - a - d;
      if (r < 0) {
        r = 0;
        if (a + d > n) d = n - a;
      }
    }

    const releaseStart = Math.max(a + d, n - r);
    const sustainEnd = Math.max(releaseStart, n);

    for (let i = 0; i < n; i++) {
      let g: number;
      if (i < a) {
        // 起音:0 → 1
        g = a > 0 ? i / a : 1;
      } else if (i < a + d) {
        // 衰减:1 → sustain
        g = a < n ? 1 + (sustainLevel - 1) * ((i - a) / Math.max(1, d)) : sustainLevel;
      } else if (i < releaseStart) {
        // 保持:sustain
        g = sustainLevel;
      } else {
        // 释放:sustain → 0
        const relLen = Math.max(1, n - releaseStart);
        g = sustainLevel * (1 - (i - releaseStart) / relLen);
      }
      samples[i] *= g;
    }
    void sustainEnd;
    return samples;
  }

  /**
   * 应用 biquad 滤波(RBJ cookbook)。
   * @param samples 样本(将被修改)
   * @param type 滤波类型
   * @param cutoff 截止频率(Hz)
   * @param resonance Q(0.1..20)
   */
  applyFilter(
    samples: Float32Array,
    type: ProceduralFilterType,
    cutoff: number,
    resonance: number,
  ): Float32Array {
    if (type === 'none') return samples;
    const n = samples.length;
    if (n === 0) return samples;

    const fc = clamp(cutoff, 10, this.sampleRate / 2 - 1);
    const Q = clamp(resonance, 0.1, 20);
    const w0 = (2 * Math.PI * fc) / this.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Q);

    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cosW0) / 2;
        b1 = 1 - cosW0;
        b2 = (1 - cosW0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cosW0) / 2;
        b1 = -(1 + cosW0);
        b2 = (1 + cosW0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        // constant 0 dB peak gain
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;
      default:
        return samples;
    }

    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = samples[i];
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      samples[i] = y;
    }
    return samples;
  }

  /**
   * 应用调制(AM / FM)。
   * @param samples 样本(将被修改;FM 时长度可能不变)
   * @param type 'am' | 'fm'
   * @param frequency 调制频率(Hz)
   * @param depth 调制深度(0..1)
   */
  applyModulation(
    samples: Float32Array,
    type: 'am' | 'fm',
    frequency: number,
    depth: number,
  ): Float32Array {
    const n = samples.length;
    if (n === 0) return samples;
    const d = clamp(depth, 0, 1);
    if (d === 0) return samples;

    const twoPiF = 2 * Math.PI * frequency;
    const inv = 1 / this.sampleRate;

    if (type === 'am') {
      // AM:out = in * (1 + depth * sin(2π*f*t))
      for (let i = 0; i < n; i++) {
        const mod = 1 + d * Math.sin(twoPiF * i * inv);
        samples[i] *= mod;
      }
      return samples;
    }

    // FM:可变读指针重采样(相位调制等价)。
    // 读指针前进速率 = 1 + depth * sin(2π*f*t);线性插值读取输入。
    const src = samples.slice();
    let readPos = 0;
    for (let i = 0; i < n; i++) {
      const t = i * inv;
      const rate = 1 + d * Math.sin(twoPiF * t);
      const idx0 = Math.floor(readPos);
      const frac = readPos - idx0;
      const idx1 = idx0 + 1;
      const s0 = idx0 < n ? src[idx0] : src[n - 1];
      const s1 = idx1 < n ? src[idx1] : src[n - 1];
      samples[i] = s0 * (1 - frac) + s1 * frac;
      readPos += rate;
      // 若读指针超过范围,环绕(保持相位连续)
      if (readPos >= n) readPos -= n;
    }
    return samples;
  }

  // ── 拼接 / 混合 / 重采样 ──────────────────────────────────────────

  /**
   * 混合多个音频源(等权重平均后归一化,防爆音)。
   * @param sources 多个 Float32Array(长度可不同)
   * @returns 混合后的 Float32Array(取最长长度)
   */
  mix(...sources: Float32Array[]): Float32Array {
    if (sources.length === 0) return new Float32Array(0);
    let maxLen = 0;
    for (const s of sources) if (s.length > maxLen) maxLen = s.length;
    const out = new Float32Array(maxLen);
    for (const s of sources) {
      for (let i = 0; i < s.length; i++) out[i] += s[i];
    }
    // 平均 + 归一化
    const count = sources.length;
    for (let i = 0; i < maxLen; i++) out[i] /= count;
    return this.normalize(out);
  }

  /**
   * 连接多个音频源(首尾相接)。
   * @param sources 多个 Float32Array
   * @returns 连接后的 Float32Array
   */
  concatenate(...sources: Float32Array[]): Float32Array {
    let total = 0;
    for (const s of sources) total += s.length;
    const out = new Float32Array(total);
    let offset = 0;
    for (const s of sources) {
      out.set(s, offset);
      offset += s.length;
    }
    return out;
  }

  /**
   * 重采样(线性插值)。
   * @param samples 输入样本
   * @param fromRate 原采样率
   * @param toRate 目标采样率
   */
  resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate <= 0 || toRate <= 0) {
      throw new Error('resample: rates must be positive');
    }
    if (fromRate === toRate) return samples.slice();
    const ratio = fromRate / toRate;
    const outLen = Math.max(0, Math.floor(samples.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcPos = i * ratio;
      const idx0 = Math.floor(srcPos);
      const frac = srcPos - idx0;
      const idx1 = idx0 + 1;
      const s0 = idx0 < samples.length ? samples[idx0] : 0;
      const s1 = idx1 < samples.length ? samples[idx1] : s0;
      out[i] = s0 * (1 - frac) + s1 * frac;
    }
    return out;
  }

  /**
   * 峰值归一化(使最大绝对值 = 1)。
   * @param samples 样本(将被修改)
   */
  normalize(samples: Float32Array): Float32Array {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    if (peak < 1e-9) return samples;
    const inv = 1 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= inv;
    return samples;
  }

  // ── 顶层 generate ────────────────────────────────────────────────

  /**
   * 按 instance 状态(振荡器 / 频率 / 时长 / 包络 / 滤波 / 调制)生成样本。
   * 流水线:信号源 → 包络 → 滤波 → 调制。
   */
  generate(): Float32Array {
    const samples =
      this.oscillatorType === 'noise'
        ? this.generateNoise(this.noiseType, this.duration)
        : this.generateOscillator(this.oscillatorType, this.frequency, this.duration);
    this.applyEnvelope(samples, this.envelope);
    if (this.filterType !== 'none') {
      this.applyFilter(samples, this.filterType, this.filterCutoff, this.filterResonance);
    }
    if (this.modulation.enabled) {
      this.applyModulation(
        samples,
        this.modulation.type,
        this.modulation.frequency,
        this.modulation.depth,
      );
    }
    return samples;
  }

  // ── Setter ────────────────────────────────────────────────────────

  setOscillatorType(type: OscillatorType): this {
    this.oscillatorType = type;
    return this;
  }

  setFrequency(freq: number): this {
    this.frequency = freq;
    return this;
  }

  setDuration(duration: number): this {
    this.duration = duration;
    return this;
  }

  setEnvelope(envelope: Envelope): this {
    this.envelope = { ...envelope };
    return this;
  }

  setFilter(type: ProceduralFilterType, cutoff: number, resonance: number): this {
    this.filterType = type;
    this.filterCutoff = cutoff;
    this.filterResonance = resonance;
    return this;
  }

  setNoiseType(type: NoiseType): this {
    this.noiseType = type;
    return this;
  }

  setModulation(type: 'am' | 'fm', frequency: number, depth: number): this {
    this.modulation = { enabled: true, type, frequency, depth };
    return this;
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  getSampleRate(): number {
    return this.sampleRate;
  }

  getStats(): ProceduralAudioStats {
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      oscillatorType: this.oscillatorType,
      frequency: this.frequency,
      duration: this.duration,
      envelope: { ...this.envelope },
      filterType: this.filterType,
      filterCutoff: this.filterCutoff,
      filterResonance: this.filterResonance,
      noiseType: this.noiseType,
      modulation: { ...this.modulation },
    };
  }

  // ── 预设音效 ──────────────────────────────────────────────────────

  /**
   * 生成爆炸音效:低频隆隆 + 滤波噪声衰减。
   * 噪声 burst + 低通(随时间下降) + 长释放。
   */
  generateExplosion(): Float32Array {
    const dur = 1.2;
    const n = Math.floor(dur * this.sampleRate);
    const noise = this.generateNoise('brown', dur);
    // 低通 200Hz,高 Q
    this.applyFilter(noise, 'lowpass', 200, 1.2);
    // 包络:快速起音 + 缓慢衰减
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // 起音 5ms,然后指数衰减
      const attackEnd = Math.floor(0.005 * this.sampleRate);
      let g: number;
      if (i < attackEnd) {
        g = i / attackEnd;
      } else {
        g = Math.exp(-3 * t);
      }
      noise[i] *= g;
    }
    return this.normalize(noise);
  }

  /**
   * 生成脚步声:短噪声 burst + 低通,两段(脚跟 + 脚尖)。
   */
  generateFootstep(): Float32Array {
    const sr = this.sampleRate;
    const stepDur = 0.15;
    const gap = 0.05;
    // 第一段(脚跟)
    const s1 = this.generateNoise('white', stepDur);
    this.applyFilter(s1, 'lowpass', 800, 1.0);
    for (let i = 0; i < s1.length; i++) {
      const t = i / sr;
      s1[i] *= Math.exp(-25 * t);
    }
    // 第二段(脚尖)
    const s2 = this.generateNoise('white', stepDur);
    this.applyFilter(s2, 'lowpass', 600, 1.0);
    for (let i = 0; i < s2.length; i++) {
      const t = i / sr;
      s2[i] *= Math.exp(-30 * t);
    }
    const gapBuf = new Float32Array(Math.floor(gap * sr));
    return this.concatenate(s1, gapBuf, s2);
  }

  /**
   * 生成枪声:尖锐噪声 burst + 快速衰减 + 低频冲击。
   */
  generateGunshot(): Float32Array {
    const dur = 0.3;
    const n = Math.floor(dur * this.sampleRate);
    const high = this.generateNoise('white', dur);
    this.applyFilter(high, 'highpass', 1000, 0.7);
    const low = this.generateNoise('brown', dur);
    this.applyFilter(low, 'lowpass', 150, 1.5);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / this.sampleRate;
      // 高频快速衰减,低频慢一点
      const gHigh = Math.exp(-40 * t);
      const gLow = Math.exp(-15 * t);
      out[i] = high[i] * gHigh * 0.7 + low[i] * gLow;
    }
    return this.normalize(out);
  }

  /**
   * 生成风声:粉红噪声 + 带通(中心频率缓慢漂移)。
   */
  generateWind(): Float32Array {
    const dur = 2.0;
    const n = Math.floor(dur * this.sampleRate);
    const noise = this.generateNoise('pink', dur);
    // 基础带通 ~ 500Hz
    this.applyFilter(noise, 'bandpass', 500, 2.0);
    // LFO 调制幅度模拟阵风
    for (let i = 0; i < n; i++) {
      const t = i / this.sampleRate;
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.3 * t);
      const gust = 0.3 + 0.7 * lfo;
      noise[i] *= gust;
    }
    return this.normalize(noise);
  }

  /**
   * 生成水滴声:正弦快速下扫频率 + 短衰减。
   */
  generateWaterDrop(): Float32Array {
    const dur = 0.15;
    const n = Math.floor(dur * this.sampleRate);
    const out = new Float32Array(n);
    // 频率从 1200Hz 指数下降到 400Hz
    for (let i = 0; i < n; i++) {
      const t = i / this.sampleRate;
      const freq = 1200 * Math.exp(-8 * t) + 400;
      const phase = 2 * Math.PI * freq * t;
      out[i] = Math.sin(phase);
      // 指数衰减
      out[i] *= Math.exp(-20 * t);
    }
    return this.normalize(out);
  }

  /**
   * 生成 UI 提示音:短促正弦(默认 880Hz)+ 快速 ADSR。
   */
  generateUIBeep(): Float32Array {
    const saved = {
      osc: this.oscillatorType,
      freq: this.frequency,
      dur: this.duration,
      env: { ...this.envelope },
      filter: this.filterType,
    };
    this.oscillatorType = 'sine';
    this.frequency = 880;
    this.duration = 0.12;
    this.envelope = { attack: 0.005, decay: 0.03, sustain: 0.6, release: 0.08 };
    this.filterType = 'none';
    const out = this.generate();
    // 恢复
    this.oscillatorType = saved.osc;
    this.frequency = saved.freq;
    this.duration = saved.dur;
    this.envelope = saved.env;
    this.filterType = saved.filter;
    return out;
  }
}

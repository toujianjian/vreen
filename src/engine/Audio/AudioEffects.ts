// AudioEffects — 离线音频效果链(纯 DSP,不依赖 AudioContext)。
//
// 设计目标:
//   - 提供一条可任意组合 / 重排序的样本级效果链:reverb / echo / chorus /
//     distortion / lowpass / highpass / compressor / flanger;
//   - 输入输出都是 Float32Array(单声道 PCM),不绑定 Web Audio 节点图,
//     便于离线渲染 / 测试 / 录音后处理;
//   - 每个效果自带内部状态(延迟线、滤波器状态、LFO 相位等),跨 process
//     调用保持连续,适合流式分块处理;
//   - 支持 inputGain / outputGain / wetMix 三段控制。
//
// 与 Audio / PositionalAudio 的关系:
//   - Audio / PositionalAudio 走 Web Audio 节点图(BiquadFilterNode /
//     ConvolverNode 等),由浏览器实现 DSP;
//   - AudioEffects 是引擎内的纯 JS DSP 实现,可用于:
//       1) 离线预渲染(把 AudioBuffer 跑过效果链生成处理后的 buffer);
//       2) 自定义空间音频(配合 SpatialAudio 的 HRTF 输出);
//       3) 录音 / 后处理管线;
//   - 不与 Audio 互继承或共享节点;调用方负责桥接(如把 AudioBuffer
//     的 getChannelData 喂给 process())。
//
// DSP 算法参考:
//   - Reverb: Schroeder 1962 — 4 parallel comb filters + 2 series allpass;
//   - Biquad: RBJ Audio EQ Cookbook 公式(bilinear 变换);
//   - Chorus/Flanger: LFO 调制可变延迟线 + 线性插值读指针;
//   - Distortion: tanh 波形整形(soft clip);
//   - Compressor: feed-forward 峰值检测 + 一阶平滑包络。

import { createLogger } from '@/lib/logger';

const log = createLogger('AudioEffects');

/** 效果类型。 */
export type AudioEffectType =
  | 'reverb'
  | 'echo'
  | 'chorus'
  | 'distortion'
  | 'lowpass'
  | 'highpass'
  | 'compressor'
  | 'flanger';

/** 单个效果实例。state 为 DSP 内部状态(延迟线等),不进序列化。 */
export interface AudioEffect {
  /** 唯一 id(addEffect 返回)。 */
  id: string;
  /** 效果类型。 */
  type: AudioEffectType;
  /** 是否启用(disable 时跳过 process)。 */
  enabled: boolean;
  /** 参数表(name → value)。 */
  params: Map<string, number>;
  /** DSP 内部状态(延迟线、滤波器状态、LFO 相位等),跨 process 保持。 */
  state: Record<string, unknown>;
}

/** 效果链统计。 */
export interface AudioEffectStats {
  effectCount: number;
  enabledCount: number;
  disabledCount: number;
  effectTypes: AudioEffectType[];
  inputGain: number;
  outputGain: number;
  wetMix: number;
  sampleRate: number;
}

/** 自增 id 计数器。 */
let _nextEffectId = 0;

/**
 * 音频效果链。
 *
 * 用法:
 *   const fx = new AudioEffects(44100);
 *   const reverbId = fx.addEffect('reverb', { decay: 0.7 });
 *   const out = new Float32Array(512);
 *   fx.process(inputBlock, out, 512);
 *
 * 流式处理:重复调用 process() 即可,DSP 状态(延迟线、相位)跨调用保持。
 */
export class AudioEffects {
  /** 效果链(按顺序应用)。 */
  effects: AudioEffect[] = [];
  /** 输入增益(线性,0..2)。 */
  inputGain: number = 1;
  /** 输出增益(线性,0..2)。 */
  outputGain: number = 1;
  /** 湿信号混合(0=纯干,1=纯湿)。 */
  wetMix: number = 1;

  /** 采样率(Hz)。 */
  readonly sampleRate: number;

  constructor(sampleRate: number = 44100) {
    if (sampleRate <= 0) {
      throw new Error(`AudioEffects: sampleRate must be positive, got ${sampleRate}`);
    }
    this.sampleRate = sampleRate;
  }

  // ── 效果管理 ──────────────────────────────────────────────────────

  /**
   * 添加效果到链尾。
   * @param type 效果类型
   * @param params 初始参数(覆盖默认)
   * @returns 新效果的 id
   */
  addEffect(type: AudioEffectType, params?: Record<string, number>): string {
    const id = `fx_${++_nextEffectId}`;
    const paramMap = new Map<string, number>();
    const defaults = defaultParamsFor(type);
    for (const [k, v] of Object.entries(defaults)) paramMap.set(k, v);
    if (params) {
      for (const [k, v] of Object.entries(params)) paramMap.set(k, v);
    }
    this.effects.push({
      id,
      type,
      enabled: true,
      params: paramMap,
      state: {},
    });
    log.debug(`addEffect(${type}) -> ${id}`);
    return id;
  }

  /** 移除效果。返回是否成功。 */
  removeEffect(id: string): boolean {
    const idx = this.effects.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.effects.splice(idx, 1);
    return true;
  }

  /** 设置效果参数。返回是否成功。 */
  setEffectParam(id: string, name: string, value: number): boolean {
    const fx = this.effects.find((e) => e.id === id);
    if (!fx) return false;
    fx.params.set(name, value);
    return true;
  }

  /** 获取效果参数。不存在返回 undefined。 */
  getEffectParam(id: string, name: string): number | undefined {
    const fx = this.effects.find((e) => e.id === id);
    if (!fx) return undefined;
    return fx.params.get(name);
  }

  /** 启用效果。返回是否成功。 */
  enableEffect(id: string): boolean {
    const fx = this.effects.find((e) => e.id === id);
    if (!fx) return false;
    fx.enabled = true;
    return true;
  }

  /** 禁用效果。返回是否成功。 */
  disableEffect(id: string): boolean {
    const fx = this.effects.find((e) => e.id === id);
    if (!fx) return false;
    fx.enabled = false;
    return true;
  }

  /**
   * 重排序效果:把 id 移到 newIndex 位置。
   * @param id 效果 id
   * @param newIndex 目标位置(0..effects.length-1)
   */
  reorderEffect(id: string, newIndex: number): boolean {
    const idx = this.effects.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    if (newIndex < 0 || newIndex >= this.effects.length) return false;
    if (idx === newIndex) return true;
    const [fx] = this.effects.splice(idx, 1);
    this.effects.splice(newIndex, 0, fx);
    return true;
  }

  /** 获取所有效果(浅拷贝)。 */
  getEffects(): AudioEffect[] {
    return this.effects.slice();
  }

  /** 按 id 获取效果。 */
  getEffect(id: string): AudioEffect | undefined {
    return this.effects.find((e) => e.id === id);
  }

  // ── 主处理 ────────────────────────────────────────────────────────

  /**
   * 处理音频:按顺序应用效果链。
   *
   * @param input 输入样本(Float32Array,samples 长度)
   * @param output 输出样本(同长度,可等于 input 就地处理)
   * @param samples 样本数
   */
  process(input: Float32Array, output: Float32Array, samples: number): void {
    // 1. 应用输入增益,把 input 复制到 output(就地处理也安全)。
    const inGain = this.inputGain;
    for (let i = 0; i < samples; i++) {
      output[i] = input[i] * inGain;
    }

    // 2. 保存干信号(用于 wetMix 混合)。
    const dry = new Float32Array(samples);
    for (let i = 0; i < samples; i++) dry[i] = output[i];

    // 3. 双缓冲交替应用效果链。
    const bufA = new Float32Array(samples);
    const bufB = new Float32Array(samples);
    let current = bufA;
    let next = bufB;
    for (let i = 0; i < samples; i++) current[i] = output[i];

    for (const fx of this.effects) {
      if (!fx.enabled) continue;
      switch (fx.type) {
        case 'reverb':
          this.processReverb(current, next, samples, fx);
          break;
        case 'echo':
          this.processEcho(current, next, samples, fx);
          break;
        case 'chorus':
          this.processChorus(current, next, samples, fx);
          break;
        case 'distortion':
          this.processDistortion(current, next, samples, fx);
          break;
        case 'lowpass':
          this.processLowpass(current, next, samples, fx);
          break;
        case 'highpass':
          this.processHighpass(current, next, samples, fx);
          break;
        case 'compressor':
          this.processCompressor(current, next, samples, fx);
          break;
        case 'flanger':
          this.processFlanger(current, next, samples, fx);
          break;
      }
      const tmp = current;
      current = next;
      next = tmp;
    }

    // 4. wet/dry 混合 + 输出增益。
    const wet = this.wetMix;
    const dryMix = 1 - wet;
    const outGain = this.outputGain;
    for (let i = 0; i < samples; i++) {
      output[i] = (dry[i] * dryMix + current[i] * wet) * outGain;
    }
  }

  // ── 各效果 DSP 实现 ────────────────────────────────────────────────

  /**
   * Schroeder 混响:4 并行 comb 滤波器 + 2 级联 allpass。
   * 参数:decay(0..1)、roomSize(0..1)、damping(0..1)。
   */
  processReverb(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const decay = effect.params.get('decay') ?? 0.5;
    const roomSize = effect.params.get('roomSize') ?? 0.5;
    const damping = effect.params.get('damping') ?? 0.5;

    // 基础 comb 延迟(44.1kHz 下的 Freeverb 标准值)。
    const baseCombDelays = [1116, 1188, 1277, 1356];
    const baseApDelays = [556, 441];

    // 按 sampleRate 比例缩放(默认 44100)。
    const srScale = this.sampleRate / 44100;
    const combDelays = baseCombDelays.map((d) => Math.max(1, Math.floor(d * srScale)));
    const apDelays = baseApDelays.map((d) => Math.max(1, Math.floor(d * srScale)));

    // 房间大小缩放:0.5..1.5 倍延迟长度。
    const roomScale = 0.5 + roomSize;

    // 初始化或重建延迟线(若长度变化)。
    const state = effect.state as {
      combs?: { buffer: Float32Array; index: number; delay: number; gain: number }[];
      aps?: { buffer: Float32Array; index: number; delay: number }[];
    };
    if (!state.combs) {
      state.combs = combDelays.map((d, i) => ({
        buffer: new Float32Array(d),
        index: 0,
        delay: d,
        gain: 0.84 * Math.pow(0.96, i) * decay,
      }));
      state.aps = apDelays.map((d) => ({
        buffer: new Float32Array(d),
        index: 0,
        delay: d,
      }));
    } else {
      // 参数变更:更新 gain。
      state.combs.forEach((c, i) => {
        c.gain = 0.84 * Math.pow(0.96, i) * decay;
      });
    }

    // 实际使用长度按 roomScale 缩放,但 buffer 大小固定(避免频繁重建)。
    const combEffDelays = combDelays.map((d) => Math.min(d, Math.max(1, Math.floor(d * roomScale))));
    const apEffDelays = apDelays.map((d) => Math.min(d, Math.max(1, Math.floor(d * roomScale))));
    const apGain = 0.7;
    const dampFactor = 1 - damping * 0.2; // 0.8..1

    for (let i = 0; i < samples; i++) {
      const inSample = input[i];
      let combSum = 0;
      for (let c = 0; c < state.combs!.length; c++) {
        const cb = state.combs![c];
        const effDelay = combEffDelays[c];
        const delayed = cb.buffer[cb.index];
        // damping 一阶低通(简化):低通后反馈
        const filtered = delayed * dampFactor;
        cb.buffer[cb.index] = inSample + filtered * cb.gain;
        cb.index = (cb.index + 1) % effDelay;
        combSum += cb.buffer[cb.index === 0 ? effDelay - 1 : cb.index - 1];
      }

      let outSample = combSum / state.combs!.length;

      for (let a = 0; a < state.aps!.length; a++) {
        const ap = state.aps![a];
        const effDelay = apEffDelays[a];
        const delayed = ap.buffer[ap.index];
        ap.buffer[ap.index] = outSample + delayed * apGain;
        const newOut = delayed - outSample * apGain;
        outSample = newOut;
        ap.index = (ap.index + 1) % effDelay;
      }

      output[i] = outSample;
    }
  }

  /**
   * 回声:延迟反馈环。
   * 参数:delay(ms)、feedback(0..0.99)。
   */
  processEcho(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const delayMs = effect.params.get('delay') ?? 250;
    const feedback = clamp(effect.params.get('feedback') ?? 0.3, 0, 0.99);
    const delaySamples = Math.max(1, Math.floor(delayMs * 0.001 * this.sampleRate));

    const state = effect.state as {
      buffer?: Float32Array;
      index?: number;
    };
    if (!state.buffer || state.buffer.length !== delaySamples) {
      state.buffer = new Float32Array(delaySamples);
      state.index = 0;
    }

    const buf = state.buffer!;
    let idx = state.index ?? 0;

    for (let i = 0; i < samples; i++) {
      const delayed = buf[idx];
      const inPlusFb = input[i] + delayed * feedback;
      buf[idx] = inPlusFb;
      idx = (idx + 1) % delaySamples;
      output[i] = input[i] + delayed;
    }
    state.index = idx;
  }

  /**
   * 合唱:LFO 调制可变延迟线 + 线性插值读指针。
   * 参数:rate(Hz)、depth(ms)、mix(0..1)。
   */
  processChorus(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const rate = effect.params.get('rate') ?? 1.5;
    const depth = effect.params.get('depth') ?? 0.5;
    const mix = effect.params.get('mix') ?? 0.5;

    const depthSamples = depth * 0.001 * this.sampleRate;
    const maxDelay = Math.max(2, Math.ceil(depthSamples * 2) + 2);

    const state = effect.state as {
      buffer?: Float32Array;
      writeIndex?: number;
      phase?: number;
    };
    if (!state.buffer || state.buffer.length !== maxDelay) {
      state.buffer = new Float32Array(maxDelay);
      state.writeIndex = 0;
      state.phase = 0;
    }

    const buf = state.buffer!;
    let wIdx = state.writeIndex ?? 0;
    let phase = state.phase ?? 0;
    const phaseInc = (2 * Math.PI * rate) / this.sampleRate;

    for (let i = 0; i < samples; i++) {
      buf[wIdx] = input[i];
      wIdx = (wIdx + 1) % maxDelay;

      const lfo = Math.sin(phase);
      phase += phaseInc;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

      // 延迟 = depth * (1 + lfo),范围 [0, 2*depth]。
      const delaySamp = depthSamples * (1 + lfo);
      const readPos = (wIdx - delaySamp + maxDelay) % maxDelay;
      const idx0 = Math.floor(readPos);
      const frac = readPos - idx0;
      const idx1 = (idx0 + 1) % maxDelay;
      const delayed = buf[idx0] * (1 - frac) + buf[idx1] * frac;

      output[i] = input[i] * (1 - mix) + delayed * mix;
    }
    state.writeIndex = wIdx;
    state.phase = phase;
  }

  /**
   * 失真:tanh 波形整形(soft clip)。
   * 参数:drive(0..5)、tone(0..1,高频衰减)。
   */
  processDistortion(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const drive = effect.params.get('drive') ?? 1.5;
    const tone = clamp(effect.params.get('tone') ?? 0.5, 0, 1);

    const state = effect.state as {
      last?: number;
    };
    let last = state.last ?? 0;
    const toneAlpha = 0.5 + tone * 0.5; // 0.5..1, 越大越亮

    for (let i = 0; i < samples; i++) {
      const x = input[i] * drive;
      const shaped = Math.tanh(x);
      // 简单一阶低通(tone 越小越低通)
      last = last + toneAlpha * (shaped - last);
      output[i] = last;
    }
    state.last = last;
  }

  /**
   * 低通:biquad 滤波器(RBJ cookbook)。
   * 参数:cutoff(Hz)、Q(0.1..10)。
   */
  processLowpass(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const cutoff = clamp(effect.params.get('cutoff') ?? 1000, 10, this.sampleRate / 2 - 1);
    const Q = clamp(effect.params.get('Q') ?? 0.707, 0.1, 20);

    const w0 = (2 * Math.PI * cutoff) / this.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Q);

    const b0 = (1 - cosW0) / 2;
    const b1 = 1 - cosW0;
    const b2 = (1 - cosW0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosW0;
    const a2 = 1 - alpha;

    const state = effect.state as {
      x1?: number;
      x2?: number;
      y1?: number;
      y2?: number;
    };
    let x1 = state.x1 ?? 0;
    let x2 = state.x2 ?? 0;
    let y1 = state.y1 ?? 0;
    let y2 = state.y2 ?? 0;

    for (let i = 0; i < samples; i++) {
      const x = input[i];
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      output[i] = y;
    }
    state.x1 = x1;
    state.x2 = x2;
    state.y1 = y1;
    state.y2 = y2;
  }

  /**
   * 高通:biquad 滤波器(RBJ cookbook)。
   * 参数:cutoff(Hz)、Q(0.1..10)。
   */
  processHighpass(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const cutoff = clamp(effect.params.get('cutoff') ?? 1000, 10, this.sampleRate / 2 - 1);
    const Q = clamp(effect.params.get('Q') ?? 0.707, 0.1, 20);

    const w0 = (2 * Math.PI * cutoff) / this.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Q);

    const b0 = (1 + cosW0) / 2;
    const b1 = -(1 + cosW0);
    const b2 = (1 + cosW0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosW0;
    const a2 = 1 - alpha;

    const state = effect.state as {
      x1?: number;
      x2?: number;
      y1?: number;
      y2?: number;
    };
    let x1 = state.x1 ?? 0;
    let x2 = state.x2 ?? 0;
    let y1 = state.y1 ?? 0;
    let y2 = state.y2 ?? 0;

    for (let i = 0; i < samples; i++) {
      const x = input[i];
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      output[i] = y;
    }
    state.x1 = x1;
    state.x2 = x2;
    state.y1 = y1;
    state.y2 = y2;
  }

  /**
   * 压缩器:feed-forward 峰值检测 + 一阶平滑包络。
   * 参数:threshold(dB)、ratio、attack(s)、release(s)。
   */
  processCompressor(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const threshold = effect.params.get('threshold') ?? -20;
    const ratio = clamp(effect.params.get('ratio') ?? 4, 1, 50);
    const attack = clamp(effect.params.get('attack') ?? 0.005, 0.0001, 1);
    const release = clamp(effect.params.get('release') ?? 0.05, 0.001, 5);

    const attackCoef = Math.exp(-1 / (attack * this.sampleRate));
    const releaseCoef = Math.exp(-1 / (release * this.sampleRate));

    const state = effect.state as {
      gainEnv?: number;
    };
    let gainEnv = state.gainEnv ?? 1;

    for (let i = 0; i < samples; i++) {
      const absX = Math.abs(input[i]);
      const db = absX > 1e-6 ? 20 * Math.log10(absX) : -120;

      let targetGain = 1;
      if (db > threshold) {
        const overDb = db - threshold;
        const reducedDb = overDb * (1 - 1 / ratio);
        targetGain = Math.pow(10, -reducedDb / 20);
      }

      const coef = targetGain < gainEnv ? attackCoef : releaseCoef;
      gainEnv = coef * gainEnv + (1 - coef) * targetGain;

      output[i] = input[i] * gainEnv;
    }
    state.gainEnv = gainEnv;
  }

  /**
   * 镶边:带反馈的可变延迟线 + LFO 调制。
   * 参数:rate(Hz)、depth(ms)、feedback(0..0.95)、mix(0..1)。
   */
  processFlanger(
    input: Float32Array,
    output: Float32Array,
    samples: number,
    effect: AudioEffect,
  ): void {
    const rate = effect.params.get('rate') ?? 0.5;
    const depth = effect.params.get('depth') ?? 1;
    const feedback = clamp(effect.params.get('feedback') ?? 0.3, 0, 0.95);
    const mix = effect.params.get('mix') ?? 0.5;

    const depthSamples = depth * 0.001 * this.sampleRate;
    const maxDelay = Math.max(4, Math.ceil(depthSamples * 2) + 4);

    const state = effect.state as {
      buffer?: Float32Array;
      writeIndex?: number;
      phase?: number;
    };
    if (!state.buffer || state.buffer.length !== maxDelay) {
      state.buffer = new Float32Array(maxDelay);
      state.writeIndex = 0;
      state.phase = 0;
    }

    const buf = state.buffer!;
    let wIdx = state.writeIndex ?? 0;
    let phase = state.phase ?? 0;
    const phaseInc = (2 * Math.PI * rate) / this.sampleRate;

    for (let i = 0; i < samples; i++) {
      const lfo = (Math.sin(phase) + 1) * 0.5; // 0..1
      phase += phaseInc;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

      // 延迟范围 [1, depthSamples + 1]。
      const delaySamp = depthSamples * lfo + 1;
      const readPos = (wIdx - delaySamp + maxDelay) % maxDelay;
      const idx0 = Math.floor(readPos);
      const frac = readPos - idx0;
      const idx1 = (idx0 + 1) % maxDelay;
      const delayed = buf[idx0] * (1 - frac) + buf[idx1] * frac;

      const outSample = input[i] * (1 - mix) + delayed * mix;

      buf[wIdx] = input[i] + delayed * feedback;
      wIdx = (wIdx + 1) % maxDelay;

      output[i] = outSample;
    }
    state.writeIndex = wIdx;
    state.phase = phase;
  }

  // ── 增益 / 清理 ──────────────────────────────────────────────────

  /** 设置输入增益。 */
  setInputGain(gain: number): void {
    this.inputGain = gain;
  }

  /** 设置输出增益。 */
  setOutputGain(gain: number): void {
    this.outputGain = gain;
  }

  /** 设置湿信号混合(0=纯干,1=纯湿)。 */
  setWetMix(mix: number): void {
    this.wetMix = clamp(mix, 0, 1);
  }

  /** 清空效果链并重置内部状态。 */
  clear(): void {
    this.effects = [];
  }

  /** 获取统计。 */
  getStats(): AudioEffectStats {
    const enabledCount = this.effects.filter((e) => e.enabled).length;
    return {
      effectCount: this.effects.length,
      enabledCount,
      disabledCount: this.effects.length - enabledCount,
      effectTypes: this.effects.map((e) => e.type),
      inputGain: this.inputGain,
      outputGain: this.outputGain,
      wetMix: this.wetMix,
      sampleRate: this.sampleRate,
    };
  }
}

// ── 辅助 ──────────────────────────────────────────────────────────

/** 限制 v 到 [lo, hi]。 */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** 各效果的默认参数。 */
function defaultParamsFor(type: AudioEffectType): Record<string, number> {
  switch (type) {
    case 'reverb':
      return { decay: 0.5, roomSize: 0.5, damping: 0.5 };
    case 'echo':
      return { delay: 250, feedback: 0.3 };
    case 'chorus':
      return { rate: 1.5, depth: 0.5, mix: 0.5 };
    case 'distortion':
      return { drive: 1.5, tone: 0.5 };
    case 'lowpass':
      return { cutoff: 1000, Q: 0.707 };
    case 'highpass':
      return { cutoff: 1000, Q: 0.707 };
    case 'compressor':
      return { threshold: -20, ratio: 4, attack: 0.005, release: 0.05 };
    case 'flanger':
      return { rate: 0.5, depth: 1, feedback: 0.3, mix: 0.5 };
    default:
      return {};
  }
}

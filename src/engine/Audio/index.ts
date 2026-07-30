// Audio — 自研引擎音频模块 barrel。
//
// 设计参考 three.js audio/，但做了两点调整：
//   1. 全局上下文管理类命名为 `AudioContextManager`，避免遮蔽浏览器
//      原生 `AudioContext` 类型（three.js 直接叫 AudioContext，导致用户
//      拿不到原生类型）。如需创建独立原生上下文，请用 `new AudioContext()`
//      或 `new (window.AudioContext)()`。
//   2. AudioListener / PositionalAudio 的 update 自带从 matrixWorld
//      分解位置 / 朝向的逻辑（引擎 Matrix4 暂未提供 decompose）。

export { AudioContextManager } from './AudioContext';
export { AudioListener } from './AudioListener';
export {
  decomposeMatrix,
  setQuaternionFromRotationMatrix,
  applyQuaternionToVector,
} from './AudioListener';
export { Audio, type AudioSourceType } from './Audio';
export { PositionalAudio, type AudioDistanceModel } from './PositionalAudio';
export { AudioLoader } from './AudioLoader';
export { AudioAnalyser } from './AudioAnalyser';
export {
  SpatialAudio,
  SpatialAudioSource,
  type SpatialDistanceModel,
  type HRTFResult,
} from './SpatialAudio';
// AudioEffects — 离线音频效果链(纯 DSP,reverb/echo/chorus/distortion/lowpass/highpass/compressor/flanger)。
export {
  AudioEffects,
  type AudioEffect,
  type AudioEffectType,
  type AudioEffectStats,
} from './AudioEffects';
// ProceduralAudio — 程序化音效生成 (振荡器 + 噪声 + ADSR 包络 + 滤波 + AM/FM 调制 + 混合 + 预设音效)。
export {
  ProceduralAudio,
  DEFAULT_ENVELOPE,
  DEFAULT_MODULATION,
  type OscillatorType,
  type NoiseType,
  type ProceduralFilterType,
  type Envelope,
  type Modulation,
  type ProceduralAudioStats,
} from './ProceduralAudio';

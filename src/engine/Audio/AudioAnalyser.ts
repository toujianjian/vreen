// AudioAnalyser — 把 Audio.getOutput() 接到 AnalyserNode 上做 FFT 频谱分析。
//
// 与 three.js 的 AudioAnalyser 行为对齐：构造时建立 analyser 节点，
// 暴露 getByteFrequencyData 结果。data 数组按 frequencyBinCount = fftSize/2 分配。

import { Audio } from './Audio';

export class AudioAnalyser {
  /** 底层 AnalyserNode。 */
  readonly analyser: AnalyserNode;
  /** 频谱数据缓冲，长度 = frequencyBinCount。 */
  readonly data: Uint8Array<ArrayBuffer>;

  constructor(audio: Audio, fftSize: number = 2048) {
    this.analyser = audio.context.createAnalyser();
    this.analyser.fftSize = fftSize;
    // 用 ArrayBuffer 显式构造，让 data 推导为 Uint8Array<ArrayBuffer>，
    // 匹配 lib.dom.d.ts 中 getByteFrequencyData 入参类型（TS 5.7+ 行为）。
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    audio.getOutput().connect(this.analyser);
  }

  /** 触发一次采样，返回字节数组（0..255）。 */
  getFrequencyData(): Uint8Array {
    this.analyser.getByteFrequencyData(this.data);
    return this.data;
  }

  /** 取频率平均值；空数据返回 0。 */
  getAverageFrequency(): number {
    const data = this.getFrequencyData();
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return data.length > 0 ? sum / data.length : 0;
  }
}

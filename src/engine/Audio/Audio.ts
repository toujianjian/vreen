// Audio — 非定位（全局）音频。继承 Object3D，可挂到场景任意节点；
// 但其播放的声音不带 3D 衰减，所有听者听到的音量相同。
//
// 节点链：source → (filters…) → gain → listener.getInput()
// 对应 three.js 的 Audio.js（非 PositionalAudio）。

import { Object3D } from '../Core/Object3D';
import { AudioListener } from './AudioListener';

/** 音频源类型，决定 hasPlaybackControl 是否生效。 */
export type AudioSourceType = 'empty' | 'audioNode' | 'mediaNode' | 'mediaStreamNode' | 'buffer';

export class Audio extends Object3D {
  /** 关联的全局监听器。 */
  readonly listener: AudioListener;
  /** 原生上下文（来自 listener）。 */
  readonly context: AudioContext;
  /** 自身音量节点，连接到 listener.getInput()。 */
  readonly gain: GainNode;
  /** 是否在 setBuffer 后自动播放。 */
  autoplay: boolean = false;
  /** 当前音频缓冲；通过 setBuffer 设置。 */
  buffer: AudioBuffer | null = null;
  /** 音高微调，单位 cents。±100 为半音，±1200 为八度。 */
  detune: number = 0;
  /** 是否循环。 */
  loop: boolean = false;
  /** 循环起点（秒）。 */
  loopStart: number = 0;
  /** 循环终点（秒）。 */
  loopEnd: number = 0;
  /** 播放偏移（秒）。 */
  offset: number = 0;
  /** 自定义播放时长（秒），undefined 表示用 buffer 自然长度。 */
  duration: number | undefined = undefined;
  /** 播放速率。 */
  playbackRate: number = 1;
  /** 是否正在播放。 */
  isPlaying: boolean = false;
  /** 是否允许 play/pause/stop 控制（buffer 类型为 true，流类型为 false）。 */
  hasPlaybackControl: boolean = true;
  /** 当前音频源节点。 */
  source: AudioNode | null = null;
  /** 源类型。 */
  sourceType: AudioSourceType = 'empty';
  /** 滤波器链，依序串在 source 与 gain 之间。 */
  filters: AudioNode[] = [];

  protected _startedAt: number = 0;
  protected _progress: number = 0;
  protected _connected: boolean = false;

  constructor(listener: AudioListener) {
    super();
    this.type = 'Audio';
    this.listener = listener;
    this.context = listener.context;
    this.gain = this.context.createGain();
    this.gain.connect(listener.getInput());
  }

  /** 输出节点：滤波链尾或 source 直接连接的目标。子类可返回更具体类型。 */
  getOutput(): AudioNode {
    return this.gain;
  }

  /** 用任意 AudioNode 作为源（如 OscillatorNode）。之后不可控制播放。 */
  setNodeSource(audioNode: AudioNode): this {
    this.hasPlaybackControl = false;
    this.sourceType = 'audioNode';
    this.source = audioNode;
    this.connect();
    return this;
  }

  /** 用 HTMLMediaElement 作为源。 */
  setMediaElementSource(mediaElement: HTMLMediaElement): this {
    this.hasPlaybackControl = false;
    this.sourceType = 'mediaNode';
    this.source = this.context.createMediaElementSource(mediaElement);
    this.connect();
    return this;
  }

  /** 用 MediaStream 作为源。 */
  setMediaStreamSource(mediaStream: MediaStream): this {
    this.hasPlaybackControl = false;
    this.sourceType = 'mediaStreamNode';
    this.source = this.context.createMediaStreamSource(mediaStream);
    this.connect();
    return this;
  }

  /** 设置 AudioBuffer 作为源，恢复播放控制权。autoplay=true 时立即播放。 */
  setBuffer(audioBuffer: AudioBuffer): this {
    this.buffer = audioBuffer;
    this.sourceType = 'buffer';
    if (this.autoplay) this.play();
    return this;
  }

  /**
   * 开始播放。仅对 hasPlaybackControl=true 的源生效。
   * @param delay 距当前时刻的延迟（秒）
   */
  play(delay: number = 0): this | undefined {
    if (this.isPlaying) {
      // three.js 选择静默 warn，不抛错
      return undefined;
    }
    if (!this.hasPlaybackControl) return undefined;
    if (this.buffer === null) return undefined;

    this._startedAt = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.loop;
    source.loopStart = this.loopStart;
    source.loopEnd = this.loopEnd;
    source.onended = this.onEnded.bind(this);
    source.start(this._startedAt, this._progress + this.offset, this.duration);

    this.isPlaying = true;
    this.source = source;
    this.setDetune(this.detune);
    this.setPlaybackRate(this.playbackRate);
    return this.connect();
  }

  /** 暂停；记录进度以便 resume 续播。 */
  pause(): this | undefined {
    if (!this.hasPlaybackControl) return undefined;
    if (this.isPlaying && this.source !== null) {
      this._progress += Math.max(this.context.currentTime - this._startedAt, 0) * this.playbackRate;
      if (this.loop) {
        const dur = this.duration ?? this.buffer?.duration ?? 0;
        if (dur > 0) this._progress = this._progress % dur;
      }
      const src = this.source as unknown as { stop: () => void; onended: ((e?: unknown) => void) | null };
      src.stop();
      src.onended = null;
      this.isPlaying = false;
    }
    return this;
  }

  /** 停止并复位进度。 */
  stop(delay: number = 0): this | undefined {
    if (!this.hasPlaybackControl) return undefined;
    this._progress = 0;
    if (this.source !== null) {
      const src = this.source as unknown as {
        stop: (when: number) => void;
        onended: ((e?: unknown) => void) | null;
      };
      src.stop(this.context.currentTime + delay);
      src.onended = null;
    }
    this.isPlaying = false;
    return this;
  }

  /** 把 source 连到滤波链或直接到 gain。 */
  connect(): this {
    if (this.source === null) return this;
    if (this.filters.length > 0) {
      this.source.connect(this.filters[0]);
      for (let i = 1; i < this.filters.length; i++) {
        this.filters[i - 1].connect(this.filters[i]);
      }
      this.filters[this.filters.length - 1].connect(this.getOutput());
    } else {
      this.source.connect(this.getOutput());
    }
    this._connected = true;
    return this;
  }

  /** 断开 source 与滤波链 / gain 的连接。 */
  disconnect(): this | undefined {
    if (!this._connected || this.source === null) return undefined;
    if (this.filters.length > 0) {
      this.source.disconnect(this.filters[0]);
      for (let i = 1; i < this.filters.length; i++) {
        this.filters[i - 1].disconnect(this.filters[i]);
      }
      this.filters[this.filters.length - 1].disconnect(this.getOutput());
    } else {
      this.source.disconnect(this.getOutput());
    }
    this._connected = false;
    return this;
  }

  getFilters(): AudioNode[] {
    return this.filters;
  }

  /** 替换滤波链。若已连接，先 disconnect 再重连。 */
  setFilters(value: AudioNode[] | undefined): this {
    const next = value ?? [];
    if (this._connected) this.disconnect();
    this.filters = next.slice();
    this.connect();
    return this;
  }

  setDetune(value: number): this {
    this.detune = value;
    if (this.isPlaying && this.source !== null) {
      const src = this.source as unknown as { detune?: AudioParam };
      if (src.detune) src.detune.setTargetAtTime(this.detune, this.context.currentTime, 0.01);
    }
    return this;
  }

  getDetune(): number {
    return this.detune;
  }

  /** 取第一个滤波器，便于单滤波场景。 */
  getFilter(): AudioNode | undefined {
    return this.filters[0];
  }

  setFilter(filter: AudioNode | undefined): this {
    return this.setFilters(filter ? [filter] : []);
  }

  setPlaybackRate(value: number): this | undefined {
    if (!this.hasPlaybackControl) return undefined;
    this.playbackRate = value;
    if (this.isPlaying && this.source !== null) {
      const src = this.source as unknown as { playbackRate: AudioParam };
      src.playbackRate.setTargetAtTime(this.playbackRate, this.context.currentTime, 0.01);
    }
    return this;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  /** AudioBufferSourceNode 自然结束时的回调。 */
  onEnded(): void {
    this.isPlaying = false;
    this._progress = 0;
  }

  getLoop(): boolean {
    return this.loop;
  }

  setLoop(value: boolean): this | undefined {
    if (!this.hasPlaybackControl) return undefined;
    this.loop = value;
    if (this.isPlaying && this.source !== null) {
      const src = this.source as unknown as { loop: boolean };
      src.loop = this.loop;
    }
    return this;
  }

  setLoopStart(value: number): this {
    this.loopStart = value;
    return this;
  }

  setLoopEnd(value: number): this {
    this.loopEnd = value;
    return this;
  }

  getVolume(): number {
    return this.gain.gain.value;
  }

  setVolume(value: number): this {
    this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
    return this;
  }
}

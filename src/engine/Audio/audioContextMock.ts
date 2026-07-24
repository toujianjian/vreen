// audioContextMock — 给音频模块单测用的 Web Audio API 最小 mock。
//
// vitest 跑在 node 环境，浏览器全局 AudioContext / GainNode / PannerNode
// 都不存在。这里提供工厂函数，返回带 spy 的伪实例。生产代码不引用本文件。

import { vi } from 'vitest';

/** 模拟 AudioParam：跟踪最近一次 setTargetAtTime 调用的值，便于断言。 */
export interface MockAudioParam extends AudioParam {
  value: number;
  lastTarget: { value: number; time: number; timeConstant: number } | null;
  lastRamp: { value: number; endTime: number } | null;
}

export function createMockAudioParam(initial = 0): MockAudioParam {
  const param: MockAudioParam = {
    value: initial,
    defaultValue: initial,
    minValue: -3.4028235e38,
    maxValue: 3.4028235e38,
    automationRate: 'a-rate',
    lastTarget: null,
    lastRamp: null,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn((value: number, endTime: number) => {
      param.lastRamp = { value, endTime };
      param.value = value;
    }),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn((value: number, time: number, timeConstant: number) => {
      param.lastTarget = { value, time, timeConstant };
      param.value = value;
    }),
    setValueCurveAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
  } as unknown as MockAudioParam;
  return param;
}

/** 通用可连接节点：记录 connect/disconnect 调用，便于断言链路拓扑。 */
export interface MockAudioNode extends AudioNode {
  __connects: { to: unknown }[];
  __disconnects: { to: unknown }[];
}

export function createMockAudioNode(): MockAudioNode {
  const connects: { to: unknown }[] = [];
  const disconnects: { to: unknown }[] = [];
  return {
    __connects: connects,
    __disconnects: disconnects,
    connect: vi.fn((to: unknown) => {
      connects.push({ to });
      return to as AudioNode;
    }),
    disconnect: vi.fn((to?: unknown) => {
      disconnects.push({ to });
    }),
    context: undefined as unknown as AudioContext,
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
  } as unknown as MockAudioNode;
}

/** GainNode mock：包含 gain AudioParam。 */
export interface MockGainNode extends MockAudioNode {
  gain: MockAudioParam;
}

export function createMockGainNode(initial = 1): MockGainNode {
  const gain = createMockAudioParam(initial);
  return {
    gain,
    ...createMockAudioNode(),
  } as unknown as MockGainNode;
}

/** PannerNode mock：暴露 positionX/Y/Z、orientationX/Y/Z 等 AudioParam。 */
export interface MockPannerNode extends MockAudioNode {
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
  positionX: MockAudioParam;
  positionY: MockAudioParam;
  positionZ: MockAudioParam;
  orientationX: MockAudioParam;
  orientationY: MockAudioParam;
  orientationZ: MockAudioParam;
  setPosition: ReturnType<typeof vi.fn>;
  setOrientation: ReturnType<typeof vi.fn>;
}

export function createMockPannerNode(): MockPannerNode {
  return {
    ...createMockAudioNode(),
    panningModel: 'equalpower',
    distanceModel: 'inverse',
    refDistance: 1,
    maxDistance: 10000,
    rolloffFactor: 1,
    coneInnerAngle: 360,
    coneOuterAngle: 360,
    coneOuterGain: 0,
    positionX: createMockAudioParam(),
    positionY: createMockAudioParam(),
    positionZ: createMockAudioParam(),
    orientationX: createMockAudioParam(),
    orientationY: createMockAudioParam(),
    orientationZ: createMockAudioParam(),
    setPosition: vi.fn(),
    setOrientation: vi.fn(),
  } as unknown as MockPannerNode;
}

/** AnalyserNode mock：getByteFrequencyData 写入预设数据。 */
export interface MockAnalyserNode extends MockAudioNode {
  fftSize: number;
  frequencyBinCount: number;
  __freqData: Uint8Array;
  getByteFrequencyData: ReturnType<typeof vi.fn>;
}

export function createMockAnalyserNode(initialFftSize = 2048, fillValue = 0): MockAnalyserNode {
  // fftSize setter 必须同步更新 frequencyBinCount 与 __freqData 长度，
  // 模拟浏览器 AnalyserNode 行为（AudioAnalyser 构造时先 create 再 set）。
  let fftSize = initialFftSize;
  let binCount = fftSize / 2;
  let freqData = new Uint8Array(new ArrayBuffer(binCount)).fill(fillValue);

  return {
    ...createMockAudioNode(),
    get fftSize() {
      return fftSize;
    },
    set fftSize(v: number) {
      fftSize = v;
      binCount = v / 2;
      freqData = new Uint8Array(new ArrayBuffer(binCount)).fill(fillValue);
    },
    get frequencyBinCount() {
      return binCount;
    },
    get __freqData() {
      return freqData;
    },
    getByteFrequencyData: vi.fn((arr: Uint8Array<ArrayBuffer>) => {
      for (let i = 0; i < arr.length; i++) arr[i] = fillValue;
    }),
  } as unknown as MockAnalyserNode;
}

/** AudioBufferSourceNode mock。 */
export interface MockBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  playbackRate: MockAudioParam;
  detune: MockAudioParam;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: ((e?: unknown) => void) | null;
}

export function createMockBufferSourceNode(): MockBufferSourceNode {
  return {
    ...createMockAudioNode(),
    buffer: null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    playbackRate: createMockAudioParam(1),
    detune: createMockAudioParam(0),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  } as unknown as MockBufferSourceNode;
}

/** AudioListener mock：positionX/Y/Z + forwardX/Y/Z + upX/Y/Z 等 AudioParam。
 *  不 extends AudioListener —— 原生接口方法签名与 vi.fn() mock 不兼容，
 *  测试中通过 `as unknown as AudioContext` 断言注入。 */
export interface MockAudioListener {
  positionX: MockAudioParam;
  positionY: MockAudioParam;
  positionZ: MockAudioParam;
  forwardX: MockAudioParam;
  forwardY: MockAudioParam;
  forwardZ: MockAudioParam;
  upX: MockAudioParam;
  upY: MockAudioParam;
  upZ: MockAudioParam;
  setPosition: ReturnType<typeof vi.fn>;
  setOrientation: ReturnType<typeof vi.fn>;
}

export function createMockAudioListener(): MockAudioListener {
  return {
    positionX: createMockAudioParam(),
    positionY: createMockAudioParam(),
    positionZ: createMockAudioParam(),
    forwardX: createMockAudioParam(),
    forwardY: createMockAudioParam(),
    forwardZ: createMockAudioParam(),
    upX: createMockAudioParam(),
    upY: createMockAudioParam(),
    upZ: createMockAudioParam(),
    setPosition: vi.fn(),
    setOrientation: vi.fn(),
  };
}

/** AudioBuffer mock。 */
export function createMockAudioBuffer(durationSec = 1, sampleRate = 44100, channels = 1): AudioBuffer {
  const length = Math.ceil(durationSec * sampleRate);
  return {
    duration: durationSec,
    length,
    sampleRate,
    numberOfChannels: channels,
    getChannelData: vi.fn(() => new Float32Array(new ArrayBuffer(length * 4))),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

/** AudioContext mock：聚合上述各节点工厂，并暴露时间控制。
 *  不 extends AudioContext —— 原生接口的 listener.setOrientation 等方法签名
 *  与 vi.fn() mock 不兼容；测试中通过 `as unknown as AudioContext` 断言注入。 */
export interface MockAudioContext {
  currentTime: number;
  destination: MockAudioNode;
  state: AudioContextState;
  sampleRate: number;
  /** 覆盖为 MockAudioListener，便于断言 positionX.lastRamp 等。 */
  listener: MockAudioListener;
  createGain: (() => MockGainNode) & ReturnType<typeof vi.fn>;
  createPanner: ReturnType<typeof vi.fn>;
  createAnalyser: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  createMediaElementSource: ReturnType<typeof vi.fn>;
  createMediaStreamSource: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  suspend: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  __currentTime: number;
  __gainNodes: MockGainNode[];
  __pannerNodes: MockPannerNode[];
  __analyserNodes: MockAnalyserNode[];
  __bufferSources: MockBufferSourceNode[];
  __decodedBuffers: AudioBuffer[];
  tick(deltaSec: number): void;
}

export function createMockAudioContext(): MockAudioContext {
  const state: {
    currentTime: number;
    gainNodes: MockGainNode[];
    pannerNodes: MockPannerNode[];
    analyserNodes: MockAnalyserNode[];
    bufferSources: MockBufferSourceNode[];
    decodedBuffers: AudioBuffer[];
  } = {
    currentTime: 0,
    gainNodes: [],
    pannerNodes: [],
    analyserNodes: [],
    bufferSources: [],
    decodedBuffers: [],
  };

  const listener = createMockAudioListener();
  // destination 缓存为稳定引用：AudioListener 会在 connect/disconnect 间
  // 复用它做断开，每次返回新实例会让断言失配。
  const destination = createMockAudioNode();

  const ctx = {
    get currentTime() {
      return state.currentTime;
    },
    destination,
    state: 'running',
    sampleRate: 44100,
    listener,
    createGain: vi.fn(() => {
      const n = createMockGainNode();
      state.gainNodes.push(n);
      return n;
    }),
    createPanner: vi.fn(() => {
      const n = createMockPannerNode();
      state.pannerNodes.push(n);
      return n;
    }),
    createAnalyser: vi.fn((fftSize: number = 2048) => {
      const n = createMockAnalyserNode(fftSize);
      state.analyserNodes.push(n);
      return n;
    }),
    createBufferSource: vi.fn(() => {
      const n = createMockBufferSourceNode();
      state.bufferSources.push(n);
      return n;
    }),
    createMediaElementSource: vi.fn(() => createMockAudioNode()),
    createMediaStreamSource: vi.fn(() => createMockAudioNode()),
    decodeAudioData: vi.fn((_data: ArrayBuffer) => {
      const buf = createMockAudioBuffer();
      state.decodedBuffers.push(buf);
      return Promise.resolve(buf);
    }),
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    tick(deltaSec: number) {
      state.currentTime += deltaSec;
    },
    __currentTime: 0,
    __gainNodes: state.gainNodes,
    __pannerNodes: state.pannerNodes,
    __analyserNodes: state.analyserNodes,
    __bufferSources: state.bufferSources,
    __decodedBuffers: state.decodedBuffers,
  } as unknown as MockAudioContext;
  return ctx;
}

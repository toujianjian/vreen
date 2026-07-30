// SpatialAudio — 3D 空间音频系统(HRTF + 距离衰减 + 多普勒效应)。
//
// 与 PositionalAudio 的区别:
//   * PositionalAudio 把空间化交给浏览器 PannerNode(黑盒)
//   * SpatialAudio 自行计算 HRTF / 距离衰减 / 多普勒,显式驱动
//     Audio 实例的 gain / playbackRate / StereoPannerNode.pan
//
// 这种「白盒空间化」有两个用途:
//   1. 算法可被测试与可视化(SpatialAudioSource.lastHRTF 等字段暴露每帧结果)
//   2. 可以在不支持 PannerNode 的环境(Node / 离线渲染)中复现空间效果
//
// 节点链(若 context 支持 createStereoPanner):
//   source → filters → stereoPanner → gain → listener.getInput()
// 否则与基类 Audio 一致:
//   source → filters → gain → listener.getInput()
//
// 简化的 HRTF 模型(只取 ITD + ILD,不含 HRTF 卷积):
//   * 方位角 azimuth ∈ [-π, π]:0 = 正前, π/2 = 正右, π = 正后
//   * ITD(双耳时间差)≈ 0.6ms × sin(azimuth)(Woodworth 公式,正=右耳先听到)
//   * ILD(双耳强度差)≈ 6dB × sin(azimuth)(正=右耳更响)
//   * pan = sin(azimuth) ∈ [-1, 1],直送 StereoPannerNode
// 完整 HRTF 需要测量数据卷积,本类不实现,留给上层扩展。
//
// 多普勒效应:基于源与听者的径向相对速度,沿声源→听者方向投影。
//   dopplerShift = c / (c + dopplerFactor × vRadial)
//   vRadial > 0(源远离):pitch 降低(shift < 1)
//   vRadial < 0(源靠近):pitch 升高(shift > 1)

import { Audio } from './Audio';
import { AudioListener, decomposeMatrix, applyQuaternionToVector } from './AudioListener';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 距离衰减模型。 */
export type SpatialDistanceModel = 'linear' | 'inverse' | 'exponential';

/** HRTF 计算结果。 */
export interface HRTFResult {
  /** 方位角(弧度,[-π, π];0 = 正前,π/2 = 正右)。 */
  azimuth: number;
  /** 仰角(弧度,[-π/2, π/2];正 = 上方)。 */
  elevation: number;
  /** 双耳时间差(毫秒;正 = 右耳先听到)。 */
  itdMs: number;
  /** 双耳强度差(dB;正 = 右耳更响)。 */
  ildDb: number;
  /** 立体声 pan 值([-1, 1];-1 = 左, +1 = 右)。 */
  pan: number;
  /** 左耳增益(0..1,基于等功率 pan law)。 */
  leftGain: number;
  /** 右耳增益(0..1,基于等功率 pan law)。 */
  rightGain: number;
}

/**
 * 空间音频源:Audio 实例 + 3D 位置/速度/方向 + 空间参数。
 *
 * 由 SpatialAudio.createSource 创建;调用方通常通过 SpatialAudio.play(id) 等方法
 * 间接控制,而非直接操作 source 字段。需要直接读取空间计算结果时,
 * 读 lastDistance / lastAttenuation / lastHRTF / lastDopplerShift / lastConeGain。
 */
export class SpatialAudioSource {
  /** 源 ID(由 createSource 分配)。 */
  readonly id: string;
  /** 底层 Audio 实例(由 SpatialAudio 创建并 setBuffer)。 */
  readonly source: Audio;
  /** 世界位置。 */
  position: Vector3;
  /** 世界速度(用于多普勒)。 */
  velocity: Vector3;
  /** 源朝向(默认 +Z),用于音锥计算。 */
  orientation: Vector3;
  /** 衰减起始参考距离。 */
  refDistance: number = 1;
  /** 衰减终止最大距离(仅 linear 模型使用)。 */
  maxDistance: number = 100;
  /** 衰减速率系数。 */
  rolloffFactor: number = 1;
  /** 内锥角度(度),锥内不衰减。 */
  coneInnerAngle: number = 360;
  /** 外锥角度(度)。 */
  coneOuterAngle: number = 360;
  /** 外锥区域音量增益(0..1)。 */
  coneOuterGain: number = 0;
  /** 距离衰减模型。 */
  distanceModel: SpatialDistanceModel = 'inverse';
  /** 基础音量(被距离/锥衰减乘的原始音量)。 */
  baseVolume: number = 1;
  /** 基础播放速率(被多普勒乘的原始速率)。 */
  basePlaybackRate: number = 1;

  // ----- 上一帧 update 计算结果(只读,供外部读取) -----
  /** 上一帧的距离。 */
  lastDistance: number = 0;
  /** 上一帧的距离衰减增益(0..1)。 */
  lastAttenuation: number = 1;
  /** 上一帧的音锥增益(0..1)。 */
  lastConeGain: number = 1;
  /** 上一帧的多普勒速率倍率(1 = 无频移)。 */
  lastDopplerShift: number = 1;
  /** 上一帧的 HRTF 结果。 */
  lastHRTF: HRTFResult = {
    azimuth: 0, elevation: 0, itdMs: 0, ildDb: 0,
    pan: 0, leftGain: 1, rightGain: 1,
  };

  /** 可选的立体声声像节点(若 context 支持 createStereoPanner 则创建)。 */
  stereoPanner: StereoPannerNode | null = null;

  constructor(id: string, source: Audio, position?: Vector3) {
    this.id = id;
    this.source = source;
    this.position = position ? position.clone() : new Vector3();
    this.velocity = new Vector3();
    this.orientation = new Vector3(0, 0, 1);
  }
}

/**
 * 3D 空间音频管理器。
 *
 * 用法:
 *   const listener = new AudioListener();
 *   const spatial = new SpatialAudio(listener);
 *   spatial.createSource('sfx', audioBuffer, new Vector3(5, 0, 0));
 *   spatial.play('sfx');
 *   // 每帧:
 *   spatial.update(dt);
 *
 * listener 的位置/朝向从其 matrixWorld 解出(由场景图遍历更新);
 * 因此调用方应在 listener.updateMatrixWorld() 之后再调用 spatial.update(dt)。
 */
export class SpatialAudio {
  /** 关联的监听器。 */
  readonly listener: AudioListener;
  /** 当前管理的所有空间音频源(id → source)。 */
  readonly sources: Map<string, SpatialAudioSource> = new Map();
  /** 最大并发源数(超出时 createSource 返回 null)。 */
  maxSources: number = 32;
  /** 声速(m/s,默认 20°C 空气中 343.3)。 */
  speedOfSound: number = 343.3;
  /** 多普勒强度因子(0 = 关闭,1 = 真实,>1 夸张)。 */
  dopplerFactor: number = 1;

  // 内部:听者位置历史用于推导听者速度(听者本身没有 velocity 字段)
  private _prevListenerPos: Vector3 = new Vector3();
  private _listenerVelocity: Vector3 = new Vector3();
  private _hasPrevListenerPos: boolean = false;

  // 复用临时变量,避免每帧分配
  private static readonly _tmpPos = new Vector3();
  private static readonly _tmpQuat = new Quaternion();
  private static readonly _tmpScale = new Vector3();
  private static readonly _tmpForward = new Vector3();
  private static readonly _tmpUp = new Vector3();
  private static readonly _tmpRight = new Vector3();
  private static readonly _tmpToSource = new Vector3();

  constructor(listener: AudioListener) {
    this.listener = listener;
  }

  /**
   * 创建一个空间音频源。
   *
   * @param id          唯一 ID;若已存在则返回既有源(忽略 buffer / position)
   * @param audioBuffer 音频缓冲;调用 Audio.setBuffer
   * @param position    初始世界位置
   * @returns 新建的 SpatialAudioSource;若达到 maxSources 或 buffer 为 null 返回 null
   */
  createSource(
    id: string,
    audioBuffer: AudioBuffer,
    position: Vector3 = new Vector3(),
  ): SpatialAudioSource | null {
    const existing = this.sources.get(id);
    if (existing !== undefined) return existing;
    if (this.sources.size >= this.maxSources) return null;

    const audio = new Audio(this.listener);
    audio.setBuffer(audioBuffer);
    const src = new SpatialAudioSource(id, audio, position);

    // 若 context 支持 StereoPannerNode,创建并设为 filter,实现左右声像
    const ctx = this.listener.context as AudioContext & {
      createStereoPanner?: () => StereoPannerNode;
    };
    if (typeof ctx.createStereoPanner === 'function') {
      try {
        const panner = ctx.createStereoPanner();
        // setFilter 会把 panner 插在 source 与 gain 之间(若 source 还未创建,
        // 仅记录到 filters,play 时 connect 会自动串联)
        audio.setFilter(panner);
        src.stereoPanner = panner;
      } catch {
        // 某些环境 createStereoPanner 存在但创建失败(权限 / 离线上下文):
        // 静默降级,不阻断创建流程
        src.stereoPanner = null;
      }
    }

    this.sources.set(id, src);
    return src;
  }

  /** 移除指定源;断开底层 Audio 节点连接。 */
  removeSource(id: string): boolean {
    const src = this.sources.get(id);
    if (src === undefined) return false;
    src.source.stop();
    src.source.disconnect();
    this.sources.delete(id);
    return true;
  }

  /** 播放指定源。 */
  play(id: string): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.source.play();
    return this;
  }

  /** 暂停指定源。 */
  pause(id: string): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.source.pause();
    return this;
  }

  /** 停止并复位指定源。 */
  stop(id: string): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.source.stop();
    return this;
  }

  /** 设置源的世界位置(直接 copy,不持有引用)。 */
  setPosition(id: string, position: Vector3): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.position.copy(position);
    return this;
  }

  /** 设置源的速度(用于多普勒计算)。 */
  setVelocity(id: string, velocity: Vector3): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.velocity.copy(velocity);
    return this;
  }

  /** 设置源的基础音量(0..1)。实际增益 = baseVolume × 距离衰减 × 音锥增益。 */
  setVolume(id: string, volume: number): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.baseVolume = volume;
    return this;
  }

  /** 设置源的音锥参数(角度单位:度)。 */
  setCone(id: string, innerAngle: number, outerAngle: number, outerGain: number): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.coneInnerAngle = innerAngle;
    src.coneOuterAngle = outerAngle;
    src.coneOuterGain = outerGain;
    return this;
  }

  /** 设置源的距离衰减模型。 */
  setDistanceModel(id: string, model: SpatialDistanceModel): this {
    const src = this.sources.get(id);
    if (src === undefined) return this;
    src.distanceModel = model;
    return this;
  }

  /**
   * 每帧更新:解算听者位置/速度,对每个源计算并应用空间效果。
   *
   * 调用时机:listener.updateMatrixWorld() 之后(scene graph 遍历已经把
   * matrixWorld 刷新过)。
   *
   * @param dt 距上一帧的时间间隔(秒);<=0 时不计算听者速度(视为静止)
   */
  update(dt: number = 0): this {
    // ---- 解出听者世界位置与朝向 ----
    const lp = SpatialAudio._tmpPos;
    const lq = SpatialAudio._tmpQuat;
    const ls = SpatialAudio._tmpScale;
    decomposeMatrix(this.listener.matrixWorld, lp, lq, ls);

    // forward = (0,0,-1) 应用听者四元数;up = (0,1,0) 应用听者四元数
    const lf = SpatialAudio._tmpForward.set(0, 0, -1);
    applyQuaternionToVector(lq, lf, lf);
    const lu = SpatialAudio._tmpUp.set(0, 1, 0);
    applyQuaternionToVector(lq, lu, lu);
    // right = forward × up(右手坐标系)
    const lr = SpatialAudio._tmpRight.copy(lf).cross(lu);
    if (lr.lengthSq() < 1e-12) {
      // forward 与 up 平行(奇异情况):用 +X 兜底
      lr.set(1, 0, 0);
    } else {
      lr.normalize();
    }

    // ---- 听者速度 = (pos - prevPos) / dt ----
    if (dt > 0 && this._hasPrevListenerPos) {
      this._listenerVelocity.copy(lp).sub(this._prevListenerPos).divideScalar(dt);
    }
    this._prevListenerPos.copy(lp);
    this._hasPrevListenerPos = true;

    // ---- 逐源计算 ----
    // 注意:_tmpToSource 会在下面的辅助方法中被复用;此处只用它取距离,
    // 取完即让出,辅助方法可自由覆盖。
    const toSrcTmp = SpatialAudio._tmpToSource;
    for (const src of this.sources.values()) {
      // 源 → 听者向量(用于距离)
      toSrcTmp.copy(lp).sub(src.position);
      const distance = toSrcTmp.length();
      src.lastDistance = distance;
      // 之后 _tmpToSource 由辅助方法复用,这里不再持有引用

      const attenuation = this.computeDistanceAttenuation(src);
      const coneGain = this.computeConeAttenuation(src, lp);
      const hrtf = this._computeHRTFInternal(src, lp, lf, lu, lr);
      const dopplerShift = this._computeDopplerInternal(src, lp);

      // 应用到 Audio
      const finalGain = src.baseVolume * attenuation * coneGain;
      src.source.setVolume(finalGain);
      src.source.setPlaybackRate(src.basePlaybackRate * dopplerShift);

      // 应用声像到 StereoPannerNode(若存在)
      if (src.stereoPanner !== null) {
        const panParam = src.stereoPanner.pan as unknown as {
          setTargetAtTime: (v: number, t: number, tc: number) => void;
          value: number;
        };
        const ctxTime = this.listener.context.currentTime;
        try {
          panParam.setTargetAtTime(hrtf.pan, ctxTime, 0.01);
        } catch {
          panParam.value = hrtf.pan;
        }
      }

      // 缓存计算结果
      src.lastDistance = distance;
      src.lastAttenuation = attenuation;
      src.lastConeGain = coneGain;
      src.lastDopplerShift = dopplerShift;
      src.lastHRTF = hrtf;
    }
    return this;
  }

  /**
   * 计算距离衰减增益(0..1)。
   *
   * 三种模型(与 PannerNode / PositionalAudio 行为一致):
   *   * linear     : 1 - rolloff × (d - ref) / (max - ref),钳到 [0, 1]
   *   * inverse    : ref / (ref + rolloff × (d - ref)),不可负
   *   * exponential: (max(ref, d) / ref) ^ (-rolloff)
   */
  computeDistanceAttenuation(source: SpatialAudioSource): number {
    const { refDistance: ref, maxDistance: max, rolloffFactor: rolloff } = source;
    // 用上一帧的 lastDistance 作为输入;若调用方独立调用此方法,需先 update
    const d = source.lastDistance;
    const safeRef = ref > 0 ? ref : 1e-6;
    switch (source.distanceModel) {
      case 'linear': {
        if (max <= safeRef) return d <= safeRef ? 1 : 0;
        const t = (d - safeRef) / (max - safeRef);
        const v = 1 - rolloff * Math.max(0, t);
        return clamp01(v);
      }
      case 'exponential': {
        const dd = Math.max(safeRef, d);
        const v = Math.pow(dd / safeRef, -rolloff);
        return clamp01(v);
      }
      case 'inverse':
      default: {
        const dd = Math.max(0, d - safeRef);
        const denom = safeRef + rolloff * dd;
        return denom > 0 ? safeRef / denom : 0;
      }
    }
  }

  /**
   * 计算多普勒频移倍率(1 = 无频移;<1 = 音降低;>1 = 音升高)。
   *
   * 径向速度 vRadial 沿「源 → 听者」方向投影:
   *   * vRadial > 0:相对速度方向 = 朝听者(源接近听者)→ 升高
   *   * vRadial < 0:相对速度方向 = 背离听者(源远离听者)→ 降低
   *
   * 公式(听者静止参考系;接近为正):
   *   dopplerShift = c / (c - dopplerFactor × vRadial)
   *
   * 注:独立调用时使用 listener.position(假定 listener 在 root);
   * 若需用 listener 世界变换,请先 updateMatrixWorld 再调用本方法。
   */
  computeDoppler(source: SpatialAudioSource): number {
    return this._computeDopplerInternal(source, this.listener.position);
  }

  /** 内部多普勒计算,允许 update 复用已解出的 listenerPos。 */
  private _computeDopplerInternal(source: SpatialAudioSource, listenerPos: Vector3): number {
    const dirToListener = SpatialAudio._tmpToSource.copy(listenerPos).sub(source.position);
    const dist = dirToListener.length();
    if (dist < 1e-6) return 1;
    dirToListener.divideScalar(dist);

    // 相对速度 = sourceVel - listenerVel;正分量表示朝听者方向运动(接近)
    const relVel = source.velocity.clone().sub(this._listenerVelocity);
    const vRadial = relVel.dot(dirToListener); // 正 = 接近,负 = 远离
    const c = this.speedOfSound;
    const factor = this.dopplerFactor;
    const denom = c - factor * vRadial;
    if (Math.abs(denom) < 1e-6) return 1;
    let shift = c / denom;
    // 钳制到合理范围,避免极端值
    if (shift < 0.1) shift = 0.1;
    else if (shift > 10) shift = 10;
    return shift;
  }

  /**
   * 计算 HRTF 简化模型(ITD + ILD)。
   *
   * 输入:source 位置、听者位置 / 朝向(forward / up / right,均归一化)。
   * 输出:见 {@link HRTFResult}
   *
   * 算法:
   *   toSource = source.position - listenerPos
   *   forwardComp = toSource · listenerForward
   *   rightComp   = toSource · listenerRight
   *   upComp      = toSource · listenerUp
   *   distance    = |toSource|
   *   azimuth   = atan2(rightComp, forwardComp)
   *   elevation = asin(upComp / distance)
   *   itdMs   = 0.6 × sin(azimuth)
   *   ildDb   = 6  × sin(azimuth)
   *   pan     = sin(azimuth)
   *   leftGain  = cos((pan + 1) × π / 4)  (等功率 pan law)
   *   rightGain = sin((pan + 1) × π / 4)
   *
   * 注:独立调用(update 之外)时仅传 source,内部用 listener.position;
   * 若需要使用 listener 世界变换,请先 updateMatrixWorld。
   */
  computeHRTF(source: SpatialAudioSource): HRTFResult {
    return this._computeHRTFInternal(source, this.listener.position);
  }

  /** 内部 HRTF 计算,允许 update 复用已解出的 listenerPos / forward / up / right。 */
  private _computeHRTFInternal(
    source: SpatialAudioSource,
    listenerPos: Vector3,
    listenerForward?: Vector3,
    listenerUp?: Vector3,
    listenerRight?: Vector3,
  ): HRTFResult {
    // 若未提供 listener 朝向,用 identity 推导(forward=-Z, up=+Y, right=+X)
    const lf = listenerForward ?? SpatialAudio._tmpForward.set(0, 0, -1);
    const lu = listenerUp ?? SpatialAudio._tmpUp.set(0, 1, 0);
    const lr = listenerRight ?? SpatialAudio._tmpRight.set(1, 0, 0);

    const toSrc = SpatialAudio._tmpToSource.copy(source.position).sub(listenerPos);
    const dist = toSrc.length();
    if (dist < 1e-6) {
      return {
        azimuth: 0, elevation: 0, itdMs: 0, ildDb: 0,
        pan: 0, leftGain: 1, rightGain: 1,
      };
    }
    const forwardComp = toSrc.dot(lf);
    const rightComp = toSrc.dot(lr);
    const upComp = toSrc.dot(lu);
    const azimuth = Math.atan2(rightComp, forwardComp);
    const elevation = Math.asin(clamp(-1, 1, upComp / dist));
    const sinA = Math.sin(azimuth);
    const pan = clamp(-1, 1, sinA);
    const itdMs = 0.6 * sinA;
    const ildDb = 6 * sinA;
    const angle = (pan + 1) * Math.PI / 4;
    const leftGain = Math.cos(angle);
    const rightGain = Math.sin(angle);
    return { azimuth, elevation, itdMs, ildDb, pan, leftGain, rightGain };
  }

  /**
   * 计算音锥增益(0..1)。
   *
   * 源方向 orientation 与「源 → 听者」方向的夹角 θ:
   *   * θ ≤ coneInnerAngle/2:锥内,无衰减(增益 1)
   *   * θ ≥ coneOuterAngle/2:锥外,增益 = coneOuterGain
   *   * 之间:线性插值
   *
   * 默认 coneInnerAngle=360 表示全向,任何角度都在锥内 → 始终返回 1。
   */
  private computeConeAttenuation(source: SpatialAudioSource, listenerPos: Vector3): number {
    const inner = source.coneInnerAngle;
    const outer = source.coneOuterAngle;
    if (inner >= 360) return 1; // 全向
    // 源 → 听者方向
    const toListener = SpatialAudio._tmpToSource.copy(listenerPos).sub(source.position);
    const dist = toListener.length();
    if (dist < 1e-6) return 1;
    toListener.divideScalar(dist);
    const cosAngle = toListener.dot(source.orientation);
    const halfInnerRad = (inner * 0.5) * Math.PI / 180;
    const halfOuterRad = (outer * 0.5) * Math.PI / 180;
    const cosHalfInner = Math.cos(halfInnerRad);
    const cosHalfOuter = Math.cos(halfOuterRad);
    // cos 单调递减:角度越大 cos 越小
    if (cosAngle >= cosHalfInner) {
      // 锥内
      return 1;
    }
    if (cosAngle <= cosHalfOuter) {
      // 锥外
      return clamp01(source.coneOuterGain);
    }
    // 之间:按角度线性插值
    // 角度 α ∈ [halfInner, halfOuter];t = (α - halfInner) / (halfOuter - halfInner)
    const alpha = Math.acos(clamp(-1, 1, cosAngle));
    const denom = halfOuterRad - halfInnerRad;
    const t = denom > 1e-6 ? (alpha - halfInnerRad) / denom : 0;
    return clamp01(1 - t * (1 - source.coneOuterGain));
  }

  /** 当前源总数。 */
  getSourceCount(): number {
    return this.sources.size;
  }

  /** 返回所有正在播放的源。 */
  getActiveSources(): SpatialAudioSource[] {
    const out: SpatialAudioSource[] = [];
    for (const src of this.sources.values()) {
      if (src.source.isPlaying) out.push(src);
    }
    return out;
  }
}

/** 钳制到 [min, max]。 */
function clamp(min: number, max: number, v: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** 钳制到 [0, 1]。 */
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

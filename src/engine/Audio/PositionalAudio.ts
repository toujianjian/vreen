// PositionalAudio — 3D 定位音频。在 Audio 基础上插入一个 PannerNode，
// 让声音随源相对听者的位置 / 朝向衰减。节点链：
//
//   source → (filters…) → panner → gain → listener.getInput()
//
// 与 three.js 的 PositionalAudio 行为对齐：每帧根据自身 matrixWorld
// 把世界位置与朝向写入 panner，由浏览器 Web Audio 引擎计算声像。

import { Audio } from './Audio';
import { Quaternion } from '../Math/Quaternion';
import { Vector3 } from '../Math/Vector3';
import { decomposeMatrix, applyQuaternionToVector } from './AudioListener';

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _orientation = new Vector3();

/** PannerNode 支持的距离衰减模型。 */
export type AudioDistanceModel = 'linear' | 'inverse' | 'exponential';

export class PositionalAudio extends Audio {
  /** 空间化节点。 */
  readonly panner: PannerNode;
  /** 距离衰减模型（与 panner.distanceModel 同步）。 */
  distanceModel: AudioDistanceModel;
  /** 衰减起始参考距离。 */
  refDistance: number;
  /** 衰减终止最大距离（仅 linear 模型使用）。 */
  maxDistance: number;
  /** 衰减速率系数。 */
  rolloffFactor: number;
  /** 内锥角度（度），锥内不衰减。 */
  coneInnerAngle: number;
  /** 外锥角度（度）。 */
  coneOuterAngle: number;
  /** 外锥区域音量增益。 */
  coneOuterGain: number;

  constructor(listener: import('./AudioListener').AudioListener) {
    super(listener);
    this.type = 'PositionalAudio';
    this.panner = this.context.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.connect(this.gain);

    this.distanceModel = this.panner.distanceModel as AudioDistanceModel;
    this.refDistance = this.panner.refDistance;
    this.maxDistance = this.panner.maxDistance;
    this.rolloffFactor = this.panner.rolloffFactor;
    this.coneInnerAngle = this.panner.coneInnerAngle;
    this.coneOuterAngle = this.panner.coneOuterAngle;
    this.coneOuterGain = this.panner.coneOuterGain;
  }

  /** PositionalAudio 的输出节点是 panner，而非 gain。 */
  getOutput(): PannerNode {
    return this.panner;
  }

  /** 重写：source → filters → panner（而非 gain）。 */
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

  getRefDistance(): number {
    return this.panner.refDistance;
  }

  setRefDistance(value: number): this {
    this.refDistance = value;
    this.panner.refDistance = value;
    return this;
  }

  getRolloffFactor(): number {
    return this.panner.rolloffFactor;
  }

  setRolloffFactor(value: number): this {
    this.rolloffFactor = value;
    this.panner.rolloffFactor = value;
    return this;
  }

  getDistanceModel(): AudioDistanceModel {
    return this.panner.distanceModel as AudioDistanceModel;
  }

  setDistanceModel(value: AudioDistanceModel): this {
    this.distanceModel = value;
    this.panner.distanceModel = value;
    return this;
  }

  getMaxDistance(): number {
    return this.panner.maxDistance;
  }

  setMaxDistance(value: number): this {
    this.maxDistance = value;
    this.panner.maxDistance = value;
    return this;
  }

  /** 设置方向锥：锥内不衰减，锥外按 coneOuterGain 衰减。 */
  setDirectionalCone(
    coneInnerAngle: number,
    coneOuterAngle: number,
    coneOuterGain: number,
  ): this {
    this.coneInnerAngle = coneInnerAngle;
    this.coneOuterAngle = coneOuterAngle;
    this.coneOuterGain = coneOuterGain;
    this.panner.coneInnerAngle = coneInnerAngle;
    this.panner.coneOuterAngle = coneOuterAngle;
    this.panner.coneOuterGain = coneOuterGain;
    return this;
  }

  /**
   * 根据当前 matrixWorld 计算并写入 panner 的位置 / 朝向。
   *
   * 公开方法，便于在 updateMatrixWorld 之外（如动画回调）显式触发。
   */
  update(): void {
    if (this.hasPlaybackControl && !this.isPlaying) return;
    decomposeMatrix(this.matrixWorld, _position, _quaternion, _scale);
    _orientation.set(0, 0, 1);
    applyQuaternionToVector(_quaternion, _orientation, _orientation);

    const panner = this.panner;
    const endTime = this.context.currentTime + this.listener.timeDelta;
    if (panner.positionX) {
      panner.positionX.linearRampToValueAtTime(_position.x, endTime);
      panner.positionY.linearRampToValueAtTime(_position.y, endTime);
      panner.positionZ.linearRampToValueAtTime(_position.z, endTime);
      panner.orientationX.linearRampToValueAtTime(_orientation.x, endTime);
      panner.orientationY.linearRampToValueAtTime(_orientation.y, endTime);
      panner.orientationZ.linearRampToValueAtTime(_orientation.z, endTime);
    } else {
      const legacy = panner as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number): void;
      };
      legacy.setPosition(_position.x, _position.y, _position.z);
      legacy.setOrientation(_orientation.x, _orientation.y, _orientation.z);
    }
  }

  /** 调用父类更新世界矩阵，然后同步 panner 声像。 */
  updateMatrixWorld(force: boolean = false): void {
    super.updateMatrixWorld(force);
    this.update();
  }
}

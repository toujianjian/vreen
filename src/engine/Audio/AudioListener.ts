// AudioListener — 场景中的“耳朵”。继承 Object3D，便于作为 camera 子节点
// 跟随相机移动 / 转向，与 three.js 的 AudioListener 行为对齐。
//
// 关键约束：Web Audio API 的 AudioListener 由 context.listener 暴露，
// 它本身没有 transform 概念，需要我们每帧把自身 matrixWorld 解出来的
// 世界位置 / 朝向写到 context.listener 上。引擎 Matrix4 暂未提供 decompose，
// 因此本模块内置一份 4x4 → (位置, 旋转, 缩放) 的分解实现，复用给
// PositionalAudio.update()。

import { Object3D } from '../Core/Object3D';
import { Matrix4 } from '../Math/Matrix4';
import { Quaternion } from '../Math/Quaternion';
import { Vector3 } from '../Math/Vector3';
import { AudioContextManager } from './AudioContext';

// 复用的临时向量，避免 update 热路径上分配。
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _forward = new Vector3();
const _up = new Vector3();

/**
 * 把列优先 4x4 矩阵分解为平移 / 旋转（四元数）/ 缩放。
 *
 * 列优先布局：elements[0..3]=col0, [4..7]=col1, [8..11]=col2, [12..15]=col3。
 * 平移在 col3 的 x/y/z 分量；旋转通过左上 3x3 去除缩放后转四元数得到。
 */
export function decomposeMatrix(
  m: Matrix4,
  outPos: Vector3,
  outQuat: Quaternion,
  outScale: Vector3,
): void {
  const e = m.elements;
  outPos.set(e[12], e[13], e[14]);

  // 缩放 = 各列向量长度
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  outScale.set(sx, sy, sz);

  // 去除缩放得到纯旋转 3x3，再转四元数
  const invSx = sx !== 0 ? 1 / sx : 0;
  const invSy = sy !== 0 ? 1 / sy : 0;
  const invSz = sz !== 0 ? 1 / sz : 0;
  setQuaternionFromRotationMatrix(
    outQuat,
    e[0] * invSx, e[4] * invSy, e[8] * invSz,
    e[1] * invSx, e[5] * invSy, e[9] * invSz,
    e[2] * invSx, e[6] * invSy, e[10] * invSz,
  );
}

/**
 * 从行优先 3x3 旋转矩阵构造四元数（Shepperd 方法）。
 * 入参 m00..m22 是旋转矩阵的 9 个元素，按行展开。
 */
export function setQuaternionFromRotationMatrix(
  q: Quaternion,
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): void {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q.w = 0.25 / s;
    q.x = (m21 - m12) * s;
    q.y = (m02 - m20) * s;
    q.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q.w = (m21 - m12) / s;
    q.x = 0.25 * s;
    q.y = (m01 + m10) / s;
    q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q.w = (m02 - m20) / s;
    q.x = (m01 + m10) / s;
    q.y = 0.25 * s;
    q.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q.w = (m10 - m01) / s;
    q.x = (m02 + m20) / s;
    q.y = (m12 + m21) / s;
    q.z = 0.25 * s;
  }
  q.normalize();
}

/**
 * 把单位四元数 q 应用到向量 v 上，结果写入 out（不修改 v）。
 * 公式：out = q * v * q^-1，展开为 27 次乘加，避免临时四元数分配。
 */
export function applyQuaternionToVector(q: Quaternion, v: Vector3, out: Vector3): void {
  const x = v.x, y = v.y, z = v.z;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  // out = v + qw * t + cross(q.xyz, t)
  out.x = x + qw * tx + (qy * tz - qz * ty);
  out.y = y + qw * ty + (qz * tx - qx * tz);
  out.z = z + qw * tz + (qx * ty - qy * tx);
}

export class AudioListener extends Object3D {
  /** 原生 AudioContext，所有音频节点共享。 */
  readonly context: AudioContext;
  /** 主音量节点，连接到 context.destination。 */
  readonly gain: GainNode;
  /** 可选滤波器；通过 setFilter 设置。 */
  filter: AudioNode | null = null;
  /** 上一帧到当前帧的时长（秒），供 ramp 计算用。 */
  timeDelta: number = 0;

  private _lastTime: number = 0;

  constructor(context?: AudioContext) {
    super();
    this.type = 'AudioListener';
    this.context = context ?? AudioContextManager.getContext();
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);
    this._lastTime = this.context.currentTime;
  }

  /** 子节点连接到此监听器的入口节点。 */
  getInput(): GainNode {
    return this.gain;
  }

  /** 移除当前滤波器，恢复 gain → destination 直连。 */
  removeFilter(): this {
    if (this.filter !== null) {
      this.gain.disconnect(this.filter);
      this.filter.disconnect(this.context.destination);
      this.gain.connect(this.context.destination);
      this.filter = null;
    }
    return this;
  }

  getFilter(): AudioNode | null {
    return this.filter;
  }

  /** 设置滤波器；插在 gain 与 destination 之间。 */
  setFilter(value: AudioNode): this {
    if (this.filter !== null) {
      this.gain.disconnect(this.filter);
      this.filter.disconnect(this.context.destination);
    } else {
      this.gain.disconnect(this.context.destination);
    }
    this.filter = value;
    this.gain.connect(this.filter);
    this.filter.connect(this.context.destination);
    return this;
  }

  getMasterVolume(): number {
    return this.gain.gain.value;
  }

  /** 设置主音量，影响所有挂在此监听器上的音频。 */
  setMasterVolume(value: number): this {
    this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
    return this;
  }

  /**
   * 重写以把自身世界变换同步到原生 AudioListener。
   *
   * 调用时机：父级（通常是 camera）调用 updateMatrixWorld 后，
   * 监听器自身被一并更新；本方法用分解后的位置 / 朝向驱动
   * context.listener。
   */
  updateMatrixWorld(force: boolean = false): void {
    super.updateMatrixWorld(force);

    const now = this.context.currentTime;
    this.timeDelta = Math.max(now - this._lastTime, 0);
    this._lastTime = now;

    decomposeMatrix(this.matrixWorld, _position, _quaternion, _scale);

    // 默认 forward = -Z，up = +Y；用世界四元数旋转得到监听器朝向
    _forward.set(0, 0, -1);
    _up.set(0, 1, 0);
    applyQuaternionToVector(_quaternion, _forward, _forward);
    applyQuaternionToVector(_quaternion, _up, _up);

    const listener = this.context.listener;
    // 现代浏览器（Chrome/Firefox）暴露 positionX/forwardX 等 AudioParam
    if (listener.positionX) {
      const endTime = now + this.timeDelta;
      listener.positionX.linearRampToValueAtTime(_position.x, endTime);
      listener.positionY.linearRampToValueAtTime(_position.y, endTime);
      listener.positionZ.linearRampToValueAtTime(_position.z, endTime);
      listener.forwardX.linearRampToValueAtTime(_forward.x, endTime);
      listener.forwardY.linearRampToValueAtTime(_forward.y, endTime);
      listener.forwardZ.linearRampToValueAtTime(_forward.z, endTime);
      listener.upX.linearRampToValueAtTime(_up.x, endTime);
      listener.upY.linearRampToValueAtTime(_up.y, endTime);
      listener.upZ.linearRampToValueAtTime(_up.z, endTime);
    } else {
      // 老 API：一次性 setPosition / setOrientation
      const legacy = listener as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(
          fx: number, fy: number, fz: number,
          ux: number, uy: number, uz: number,
        ): void;
      };
      legacy.setPosition(_position.x, _position.y, _position.z);
      legacy.setOrientation(
        _forward.x, _forward.y, _forward.z,
        _up.x, _up.y, _up.z,
      );
    }
  }
}

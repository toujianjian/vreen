// AdditiveBlend — 加法混合工具。
//
// 加法动画(additive animation)存储相对于参考姿势的"增量",
// 而非绝对姿势。播放时把增量叠加到任意基础姿势之上,实现:
//   • 呼吸/待机微动叠加到走/跑
//   • 头部看向目标叠加到身体动作
//   • 伤痛跛行叠加到走
//
// 增量计算:
//   • Vector3 (position/scale): delta = pose - ref
//   • Quaternion (rotation):     delta = pose * ref^-1  (旋转差)
// 应用:
//   • Vector3: out = base + delta * weight
//   • Quaternion: out = slerp(identity, delta, weight) * base
//
// applyAdditive 提供通用分量级实现(适用于 Vector3/Number);
// applyAdditiveQuaternion 处理四元数旋转加法混合。

import { AnimationClip } from './AnimationClip';
import {
  KeyframeTrack,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
} from './KeyframeTrack';

export class AdditiveBlend {
  /** 根据 clip 与参考姿势 refPose 计算增量 clip。
   *  refPose: trackName → 参考值数组(长度 = track.valueSize)。
   *  返回新 clip,其 track 值为 pose - ref(Vector3/Number)
   *  或 pose * ref^-1(Quaternion)。
   *  refPose 中未提供的 track 原样保留。 */
  static computeAdditiveBase(clip: AnimationClip, refPose: Map<string, number[]>): AnimationClip {
    const newTracks: KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const ref = refPose.get(track.name);
      if (!ref) {
        newTracks.push(track);
        continue;
      }
      const size = track.valueSize;
      const newValues = new Float32Array(track.values.length);
      if (size === 4) {
        // Quaternion: delta = pose * refInv (refInv = conjugate for unit quat)
        for (let i = 0; i < track.values.length; i += 4) {
          const px = track.values[i],     py = track.values[i + 1];
          const pz = track.values[i + 2], pw = track.values[i + 3];
          const rx = -ref[0], ry = -ref[1], rz = -ref[2], rw = ref[3];
          // delta = pose * refInv
          newValues[i]     = pw * rx + px * rw + py * rz - pz * ry;
          newValues[i + 1] = pw * ry + py * rw + pz * rx - px * rz;
          newValues[i + 2] = pw * rz + pz * rw + px * ry - py * rx;
          newValues[i + 3] = pw * rw - px * rx - py * ry - pz * rz;
        }
      } else {
        // Vector3 / Number: delta = pose - ref
        for (let i = 0; i < track.values.length; i++) {
          newValues[i] = track.values[i] - ref[i % size];
        }
      }
      newTracks.push(cloneTrack(track, newValues));
    }
    return new AnimationClip(`${clip.name}_additive`, clip.duration, newTracks);
  }

  /** 将增量叠加到基础值。通用分量级实现,适用于 Vector3/Number。
   *  out[i] = base[i] + additive[i] * weight。
   *  四元数加法混合请使用 applyAdditiveQuaternion。 */
  static applyAdditive(base: number[], additive: number[], weight: number, out?: number[]): number[] {
    const o = out ?? base;
    const n = Math.min(base.length, additive.length);
    for (let i = 0; i < n; i++) {
      o[i] = base[i] + additive[i] * weight;
    }
    return o;
  }

  /** 四元数加法混合: out = slerp(identity, deltaQuat, weight) * baseQuat。
   *  输入/输出均为 [x,y,z,w] 分量数组。 */
  static applyAdditiveQuaternion(base: number[], delta: number[], weight: number, out?: number[]): number[] {
    const o = out ?? new Array(4);
    // scaled = slerp(identity, delta, weight)
    const scaled = slerpIdentity(delta, weight);
    // out = scaled * base
    const bx = base[0], by = base[1], bz = base[2], bw = base[3];
    const sx = scaled[0], sy = scaled[1], sz = scaled[2], sw = scaled[3];
    o[0] = sw * bx + sx * bw + sy * bz - sz * by;
    o[1] = sw * by + sy * bw + sz * bx - sx * bz;
    o[2] = sw * bz + sz * bw + sx * by - sy * bx;
    o[3] = sw * bw - sx * bx - sy * by - sz * bz;
    return o;
  }
}

/** 按相同类型构造新 track(复用 name/times/interp,替换 values)。 */
function cloneTrack(src: KeyframeTrack, newValues: Float32Array): KeyframeTrack {
  if (src instanceof QuaternionKeyframeTrack) {
    return new QuaternionKeyframeTrack(src.name, src.times, newValues, src.interp);
  }
  if (src instanceof VectorKeyframeTrack) {
    return new VectorKeyframeTrack(src.name, src.times, newValues, src.interp);
  }
  if (src instanceof NumberKeyframeTrack) {
    return new NumberKeyframeTrack(src.name, src.times, newValues, src.interp);
  }
  throw new Error(`Unknown KeyframeTrack subtype: ${src.constructor.name}`);
}

/** slerp(identity, q, t): 对小增量,线性插值后归一化足够精确。 */
function slerpIdentity(q: number[], t: number): number[] {
  let x = q[0] * t;
  let y = q[1] * t;
  let z = q[2] * t;
  let w = 1 * (1 - t) + q[3] * t;
  const len = Math.hypot(x, y, z, w);
  if (len > 0) {
    const inv = 1 / len;
    x *= inv; y *= inv; z *= inv; w *= inv;
  }
  return [x, y, z, w];
}

// AnimationSync — 动画同步与镜像工具。
//
// syncPhase: 计算两个 clip 的相位同步比率,使 B 的播放速率匹配 A,
//   让脚步等关键事件对齐。
// mirrorClip: 生成左右镜像 clip,用于对称动画复用(如左挥剑 → 右挥剑)。
//   镜像策略:
//     • position: 反转指定轴分量(如 axis='x' → x 取负)
//     • quaternion: 反转对应轴分量(镜像 YZ 平面 → quat.x 取负)
//     • scale / scalar: 不变

import { AnimationClip } from './AnimationClip';
import {
  KeyframeTrack,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
} from './KeyframeTrack';

export interface SyncConfig {
  /** B 应使用的 timeScale,使其相位与 A 对齐。 */
  timeScale: number;
}

export class AnimationSync {
  /** 计算 clipB 相对 clipA 的相位同步配置。
   *  返回 timeScale = clipA.duration / clipB.duration,
   *  使 B 跑完一周的时间 = A 跑完一周。
   *  任一 duration <= 0 返回 timeScale=1。 */
  static syncPhase(clipA: AnimationClip, clipB: AnimationClip): SyncConfig {
    if (clipB.duration <= 0 || clipA.duration <= 0) return { timeScale: 1 };
    return { timeScale: clipA.duration / clipB.duration };
  }

  /** 生成 clip 的镜像版本。
   *  axis='x' 镜像 YZ 平面(左右翻转);'y' 镜像 XZ 平面;'z' 镜像 XY 平面。
   *  position/quaternion 按轴反转;scale 与 scalar 保持不变。 */
  static mirrorClip(clip: AnimationClip, axis: 'x' | 'y' | 'z'): AnimationClip {
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const newTracks: KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const propName = track.name.slice(track.name.lastIndexOf('.') + 1);
      const newValues = new Float32Array(track.values.length);
      const size = track.valueSize;
      if (propName === 'scale' || size === 1) {
        // scale 与 scalar 不镜像
        newValues.set(track.values);
      } else if (size === 3) {
        // Vector3 position: 反转指定轴
        for (let i = 0; i < track.values.length; i += 3) {
          newValues[i]     = track.values[i];
          newValues[i + 1] = track.values[i + 1];
          newValues[i + 2] = track.values[i + 2];
          newValues[i + idx] = -newValues[i + idx];
        }
      } else if (size === 4) {
        // Quaternion: 反转对应轴分量
        for (let i = 0; i < track.values.length; i += 4) {
          newValues[i]     = track.values[i];
          newValues[i + 1] = track.values[i + 1];
          newValues[i + 2] = track.values[i + 2];
          newValues[i + 3] = track.values[i + 3];
          newValues[i + idx] = -newValues[i + idx];
        }
      } else {
        newValues.set(track.values);
      }
      newTracks.push(cloneTrack(track, newValues));
    }
    return new AnimationClip(`${clip.name}_mirror`, clip.duration, newTracks);
  }
}

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

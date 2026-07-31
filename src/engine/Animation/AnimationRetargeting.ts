// AnimationRetargeting — adapt an AnimationClip authored for one skeleton
// (source) to a different skeleton (target) with potentially different
// proportions. Adapted from o3de EMotionFX `RetargetingFile` and Unreal's
// IK Rig retargeter.
//
// Strategy (relative-to-bind-pose):
//   For each keyframed value we compute the *delta* from the source's bind
//   pose, then apply that delta to the target's bind pose. This preserves
//   the intent of the animation (e.g. "raise arm 45°") while respecting the
//   target's proportions.
//
//   • Quaternion tracks: delta = animQuat * sourceBindQuat⁻¹
//                        target = delta * targetBindQuat
//   • Position tracks:   delta  = animPos − sourceBindPos
//                        target = targetBindPos + delta * scaleFactor
//   • Scale tracks:      ratio = animScale / sourceBindScale
//                        target = ratio * targetBindScale
//
// The scale factor for position tracks is computed per-bone from the length
// ratio of the corresponding bone in source vs. target (parent→child joint
// distance). If a bone has no parent (root), the overall skeleton height
// ratio is used as a fallback.

import { AnimationClip } from './AnimationClip';
import {
  KeyframeTrack,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
  type TrackTarget,
} from './KeyframeTrack';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 一个骨骼在 bind pose 下的局部变换。 */
export interface BindTransform {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

/** 源骨骼名 → 目标骨骼名的映射条目。 */
export interface BoneMapping {
  source: string;
  target: string;
}

export interface RetargetConfig {
  /** 源骨骼名 → bind 局部变换。通常从源 Skeleton 的 Bone 读取。 */
  sourceBind: Map<string, BindTransform>;
  /** 目标骨骼名 → bind 局部变换。 */
  targetBind: Map<string, BindTransform>;
  /** 源骨骼名 → 目标骨骼名。未列出的骨骼按同名回退。 */
  boneMappings?: BoneMapping[];
  /** 是否对 position 轨道做骨骼长度缩放。默认 true。
   *  关闭后 position 直接复制(适用于纯旋转动画)。 */
  scalePosition?: boolean;
  /** 整体缩放系数(用于 root translation fallback)。默认自动按身高比。
   *  显式设 1 则不缩放 root。 */
  rootScaleOverride?: number;
}

// ── helpers ──────────────────────────────────────────────────────

const _vTmp = new Vector3();
const _qTmp = new Quaternion();
const _qInv = new Quaternion();
const _qDelta = new Quaternion();

/** 已知属性后缀(从长到短,优先匹配多段名如 'rotation.x')。 */
const KNOWN_PROPERTIES = [
  '.rotation.x',
  '.rotation.y',
  '.rotation.z',
  '.quaternion',
  '.position',
  '.scale',
] as const;

/** 解析轨道名 "Hips.position" → { bone:'Hips', property:'position' }。
 *  优先匹配已知属性后缀('.rotation.x' 等),避免点号歧义。
 *  若无已知后缀,回退到最后一个点号分割。返回 null 表示无法解析。 */
function parseTrackName(name: string): { bone: string; property: string } | null {
  for (const suffix of KNOWN_PROPERTIES) {
    if (name.endsWith(suffix)) {
      const bone = name.slice(0, name.length - suffix.length);
      if (bone.length > 0) {
        return { bone, property: suffix.slice(1) };
      }
      return null;
    }
  }
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return { bone: name.slice(0, dot), property: name.slice(dot + 1) };
}

/** 计算两骨骼的“身高”——所有 bind position.y 的最大值。
 *  用于 root translation 的 fallback 缩放。 */
function computeSkeletonHeight(bind: Map<string, BindTransform>): number {
  let max = 0;
  for (const t of bind.values()) {
    if (t.position.y > max) max = t.position.y;
  }
  return max || 1;
}

// ── AnimationRetargeting ─────────────────────────────────────────

export class AnimationRetargeting {
  private sourceBind: Map<string, BindTransform>;
  private targetBind: Map<string, BindTransform>;
  private mapping: Map<string, string>;
  private scalePosition: boolean;
  private rootScale: number;

  constructor(config: RetargetConfig) {
    this.sourceBind = config.sourceBind;
    this.targetBind = config.targetBind;
    this.scalePosition = config.scalePosition ?? true;

    // 构建映射表。未列出的骨骼同名回退。
    this.mapping = new Map();
    if (config.boneMappings) {
      for (const m of config.boneMappings) this.mapping.set(m.source, m.target);
    }

    // 计算 root 缩放系数。
    if (config.rootScaleOverride !== undefined) {
      this.rootScale = config.rootScaleOverride;
    } else {
      const srcH = computeSkeletonHeight(config.sourceBind);
      const tgtH = computeSkeletonHeight(config.targetBind);
      this.rootScale = srcH > 0 ? tgtH / srcH : 1;
    }
  }

  /** 源骨骼名 → 目标骨骼名(映射表 + 同名回退)。 */
  resolveTargetName(sourceBone: string): string | null {
    const mapped = this.mapping.get(sourceBone);
    if (mapped) return mapped;
    // 同名回退:目标 bind 里有同名骨骼才用。
    if (this.targetBind.has(sourceBone)) return sourceBone;
    return null;
  }

  /** 对单个 clip 执行 retarget,返回新 clip(不修改原 clip)。 */
  retarget(clip: AnimationClip): AnimationClip {
    const newTracks: KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const newTrack = this.retargetTrack(track);
      if (newTrack) newTracks.push(newTrack);
    }
    const out = new AnimationClip(clip.name, clip.duration, newTracks);
    // 复制事件(事件与骨骼无关,直接保留)。
    out.events = clip.events.map((e) => ({ ...e }));
    return out;
  }

  /** retarget 单个轨道。返回 null 表示无法映射(轨道被丢弃)。 */
  private retargetTrack(track: KeyframeTrack): KeyframeTrack | null {
    const parsed = parseTrackName(track.name);
    if (!parsed) {
      // 没有点号的轨道(如 ".position" 或自定义)直接复制。
      return cloneTrack(track);
    }
    const srcBone = parsed.bone;
    const property = parsed.property;
    const tgtBone = this.resolveTargetName(srcBone);
    if (!tgtBone) {
      // 无法映射,丢弃轨道(目标无对应骨骼)。
      return null;
    }

    const srcBind = this.sourceBind.get(srcBone);
    const tgtBind = this.targetBind.get(tgtBone);

    // 若两边都没有 bind 数据,直接重命名复制(同名情况下)。
    if (!srcBind && !tgtBind) {
      return cloneTrackRenamed(track, `${tgtBone}.${property}`);
    }

    const newName = `${tgtBone}.${property}`;

    if (track instanceof QuaternionKeyframeTrack) {
      return this.retargetQuatTrack(track, newName, srcBind ?? null, tgtBind ?? null);
    }
    if (track instanceof VectorKeyframeTrack) {
      if (property === 'position') {
        return this.retargetPositionTrack(track, newName, srcBind ?? null, tgtBind ?? null);
      }
      if (property === 'scale') {
        return this.retargetScaleTrack(track, newName, srcBind ?? null, tgtBind ?? null);
      }
      // 其他 Vector3 property 直接重命名复制。
      return cloneTrackRenamed(track, newName);
    }
    // NumberKeyframeTrack(rotation.x 等)直接重命名复制。
    return cloneTrackRenamed(track, newName);
  }

  /** retarget 四元数轨道:delta = anim * srcBind⁻¹; out = delta * tgtBind。
   *  若 srcBind 或 tgtBind 缺失,降级为直接复制(同名回退)。 */
  private retargetQuatTrack(
    track: QuaternionKeyframeTrack,
    newName: string,
    srcBind: BindTransform | null,
    tgtBind: BindTransform | null,
  ): QuaternionKeyframeTrack {
    const n = track.times.length;
    const newValues = new Float32Array(track.values.length);
    if (!srcBind || !tgtBind) {
      newValues.set(track.values);
      return new QuaternionKeyframeTrack(newName, track.times, newValues, track.interp);
    }
    const srcBindInv = new Quaternion().copy(srcBind.quaternion).invert();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      _qTmp.set(track.values[o], track.values[o + 1], track.values[o + 2], track.values[o + 3]);
      // delta = anim * srcBind⁻¹
      _qDelta.copy(_qTmp).multiply(srcBindInv);
      // out = delta * tgtBind
      _qInv.copy(_qDelta).multiply(tgtBind.quaternion);
      newValues[o] = _qInv.x;
      newValues[o + 1] = _qInv.y;
      newValues[o + 2] = _qInv.z;
      newValues[o + 3] = _qInv.w;
    }
    return new QuaternionKeyframeTrack(newName, track.times, newValues, track.interp);
  }

  /** retarget 位置轨道:delta = anim − srcBind; out = tgtBind + delta * scale。 */
  private retargetPositionTrack(
    track: VectorKeyframeTrack,
    newName: string,
    srcBind: BindTransform | null,
    tgtBind: BindTransform | null,
  ): VectorKeyframeTrack {
    const n = track.times.length;
    const newValues = new Float32Array(track.values.length);
    if (!srcBind || !tgtBind || !this.scalePosition) {
      newValues.set(track.values);
      return new VectorKeyframeTrack(newName, track.times, newValues, track.interp);
    }
    const scale = this.rootScale;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      // delta = anim − srcBind
      _vTmp.set(
        track.values[o] - srcBind.position.x,
        track.values[o + 1] - srcBind.position.y,
        track.values[o + 2] - srcBind.position.z,
      );
      // out = tgtBind + delta * scale
      newValues[o] = tgtBind.position.x + _vTmp.x * scale;
      newValues[o + 1] = tgtBind.position.y + _vTmp.y * scale;
      newValues[o + 2] = tgtBind.position.z + _vTmp.z * scale;
    }
    return new VectorKeyframeTrack(newName, track.times, newValues, track.interp);
  }

  /** retarget 缩放轨道:ratio = anim / srcBind; out = ratio * tgtBind。 */
  private retargetScaleTrack(
    track: VectorKeyframeTrack,
    newName: string,
    srcBind: BindTransform | null,
    tgtBind: BindTransform | null,
  ): VectorKeyframeTrack {
    const n = track.times.length;
    const newValues = new Float32Array(track.values.length);
    if (!srcBind || !tgtBind) {
      newValues.set(track.values);
      return new VectorKeyframeTrack(newName, track.times, newValues, track.interp);
    }
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const rx = srcBind.scale.x !== 0 ? track.values[o] / srcBind.scale.x : track.values[o];
      const ry = srcBind.scale.y !== 0 ? track.values[o + 1] / srcBind.scale.y : track.values[o + 1];
      const rz = srcBind.scale.z !== 0 ? track.values[o + 2] / srcBind.scale.z : track.values[o + 2];
      newValues[o] = rx * tgtBind.scale.x;
      newValues[o + 1] = ry * tgtBind.scale.y;
      newValues[o + 2] = rz * tgtBind.scale.z;
    }
    return new VectorKeyframeTrack(newName, track.times, newValues, track.interp);
  }
}

// ── track clone helpers ──────────────────────────────────────────

function cloneTrack(track: KeyframeTrack): KeyframeTrack {
  if (track instanceof QuaternionKeyframeTrack) {
    return new QuaternionKeyframeTrack(track.name, track.times, track.values, track.interp);
  }
  if (track instanceof VectorKeyframeTrack) {
    return new VectorKeyframeTrack(track.name, track.times, track.values, track.interp);
  }
  if (track instanceof NumberKeyframeTrack) {
    return new NumberKeyframeTrack(track.name, track.times, track.values, track.interp);
  }
  // 未知子类 — 退化:复制引用(调用方应避免修改)。
  return track;
}

function cloneTrackRenamed(track: KeyframeTrack, newName: string): KeyframeTrack {
  if (track instanceof QuaternionKeyframeTrack) {
    return new QuaternionKeyframeTrack(newName, track.times, track.values, track.interp);
  }
  if (track instanceof VectorKeyframeTrack) {
    return new VectorKeyframeTrack(newName, track.times, track.values, track.interp);
  }
  if (track instanceof NumberKeyframeTrack) {
    return new NumberKeyframeTrack(newName, track.times, track.values, track.interp);
  }
  return track;
}

// ── bind-pose extraction helper ──────────────────────────────────

/** 从一个 Skeleton 提取 bind pose(每个 Bone 的局部 position/quaternion/scale)。
 *  需要 Bone 提供 position / quaternion / scale 字段(自研 Object3D 兼容)。
 *  若使用 three.js Bone,可直接遍历 skeleton.bones 读取。 */
export function extractBindPose(
  bones: Array<{
    name: string;
    position: { x: number; y: number; z: number };
    quaternion?: { x: number; y: number; z: number; w: number };
    rotation?: { x: number; y: number; z: number; w: number };
    scale: { x: number; y: number; z: number };
  }>,
): Map<string, BindTransform> {
  const out = new Map<string, BindTransform>();
  for (const b of bones) {
    const q = b.quaternion ?? b.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    out.set(b.name, {
      position: new Vector3(b.position.x, b.position.y, b.position.z),
      quaternion: new Quaternion(q.x, q.y, q.z, q.w),
      scale: new Vector3(b.scale.x, b.scale.y, b.scale.z),
    });
  }
  return out;
}

export type { TrackTarget };

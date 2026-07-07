// threeToCustomAnim — 把 three.js 的 AnimationClip[] 转换成自研 engine 的
// AnimationClip[]。两条用途：
//
//   1. Phase 2: SceneContents 还在用 r3f + three.js 渲染,但 ECS 端
//      SkinnedMeshRef 需要自研 AnimationMixer。把 three.js clip 转成自研 clip,
//      自研 mixer.bind(threeRoot) 就能直接写 three.js 节点的
//      position / scale / rotation (三个引擎都有同名 setter)。
//   2. 等 step2.7 之后 SceneContents 切到自研 renderer 时,这层 bridge
//      就不需要了 — 直接走自研 GLBLoader。
//
// 转换范围:
//   ✅ VectorKeyframeTrack   → VectorKeyframeTrack (position / scale)
//   ✅ QuaternionKeyframeTrack → QuaternionKeyframeTrack (quaternion)
//   ✅ NumberKeyframeTrack   → NumberKeyframeTrack (rotation.x/y/z 等)
//   ⚠️ Color / String / Boolean 跳过(自研目前不支持)
//   ⚠️ CubicInterpolant 不实现,统一按 linear (Quaternion 走 slerp)

import * as THREE from 'three';
import {
  AnimationClip,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from '@/engine/Animation';

const SUPPORTED_PROPS = new Set([
  'position',
  'scale',
  'quaternion',
  'rotation.x',
  'rotation.y',
  'rotation.z',
]);

export function convertThreeClips(
  threeClips: THREE.AnimationClip[],
): AnimationClip[] {
  const out: AnimationClip[] = [];
  for (const c of threeClips) {
    const customTracks = [];
    for (const t of c.tracks) {
      const prop = propertyFromTrackName(t.name);
      if (!prop || !SUPPORTED_PROPS.has(prop)) continue;
      const times = (t as unknown as { times: ArrayLike<number> }).times;
      const values = (t as unknown as { values: ArrayLike<number> }).values;
      const valueSize = t.getValueSize();
      if (valueSize === 1) {
        customTracks.push(new NumberKeyframeTrack(t.name, times, values, 'linear'));
      } else if (valueSize === 3) {
        customTracks.push(new VectorKeyframeTrack(t.name, times, values, 'linear'));
      } else if (valueSize === 4) {
        customTracks.push(new QuaternionKeyframeTrack(t.name, times, values, 'slerp'));
      }
    }
    if (customTracks.length === 0) continue;
    out.push(new AnimationClip(c.name || 'clip', c.duration, customTracks));
  }
  return out;
}

function propertyFromTrackName(trackName: string): string | null {
  // three.js: "NodeName.position" / "NodeName.quaternion" / "NodeName.scale"
  //           "NodeName.rotation[x]" / ...(Euler)
  // 自研 NumberKeyframeTrack 用 "rotation.x" / "rotation.y" / "rotation.z"。
  const dot = trackName.lastIndexOf('.');
  if (dot < 0) return null;
  const raw = trackName.slice(dot + 1);
  // Euler rotation: "rotation[x]" / "rotation[y]" / "rotation[z]" → 归一化成 "rotation.x" 等
  const m = /^rotation\[([xyz])\]$/.exec(raw);
  if (m) return `rotation.${m[1]}`;
  return raw;
}

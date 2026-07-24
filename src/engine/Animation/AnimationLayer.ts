// AnimationLayer — 独立动画层,可与其他层混合。
//
// 每层持有一组 AnimationAction,其中最多一个处于 active 状态。
// 层与层之间通过 AnimationLayerMixer 顺序叠加,后层基于前层结果混合。
//
// 混合模式:
//   • 'override': 用本层采样的姿势覆盖当前骨骼姿势(按 weight 插值)。
//       weight=1 时完全覆盖;weight<1 时与现有姿势 lerp/slerp。
//   • 'additive': 在当前姿势上叠加增量(适合呼吸/微动)。
//       Vector3: out = cur + delta*weight;
//       Quaternion: out = slerp(id, delta, w) * cur。
//   • 'mask':    同 override,但只影响 mask 包含的骨骼(其余骨骼不动)。
//
// 注意:本层不调用 AnimationAction.update()(因其会直接 apply 到 target,
// 破坏分层混合)。update() 内部仅推进 playhead;实际写入由 apply() 完成。

import { AnimationClip } from './AnimationClip';
import { AnimationAction } from './AnimationAction';
import { KeyframeTrack, type TrackTarget } from './KeyframeTrack';
import { BoneMask } from './BoneMask';
import { AdditiveBlend } from './AdditiveBlend';
import { Bone } from '../Core/Bone';

export type LayerBlendMode = 'override' | 'additive' | 'mask';

// 复用的采样/混合缓冲区(模块级,避免每帧 GC)
const _bufA = [0, 0, 0, 1];
const _bufB = [0, 0, 0, 1];
const _blend = [0, 0, 0, 1];
const _cur = [0, 0, 0, 1];
const _out = [0, 0, 0, 1];

export class AnimationLayer {
  name: string;
  /** 目标权重(用户设定,0-1)。 */
  weight: number = 1;
  /** 混合模式。 */
  blendMode: LayerBlendMode = 'override';
  /** 骨骼遮罩。blendMode='mask' 时生效;'override'/'additive' 也可设以限制范围。 */
  mask: BoneMask | null = null;
  /** 已注册的 action(按 clip.name 索引)。 */
  actions: Map<string, AnimationAction> = new Map();
  /** 当前激活的 action。 */
  activeAction: AnimationAction | null = null;
  /** 当前实际生效权重(随 fade 平滑过渡)。 */
  currentWeight: number = 1;

  // ── 权重 fade(play 淡入 / stop 淡出) ──────────────────────────
  private fadeActive: boolean = false;
  private fadeFrom: number = 0;
  private fadeTo: number = 1;
  private fadeT: number = 0;
  private fadeDur: number = 0;

  // ── crossFade 状态 ─────────────────────────────────────────────
  /** crossFade 期间的源 action(过渡完成后清空)。 */
  private crossFadeFrom: AnimationAction | null = null;
  private crossFadeT: number = 0;
  private crossFadeDur: number = 0;

  constructor(name: string, blendMode: LayerBlendMode = 'override', mask: BoneMask | null = null) {
    this.name = name;
    this.blendMode = blendMode;
    this.mask = mask;
  }

  /** 注册一个 action(按 clip.name 去重)。 */
  addAction(clip: AnimationClip): AnimationAction {
    let a = this.actions.get(clip.name);
    if (!a) {
      a = new AnimationAction(clip);
      this.actions.set(clip.name, a);
    }
    return a;
  }

  /** 播放名为 name 的 action。fadeIn>0 时权重从 0 淡入到 weight。 */
  play(name: string, fadeIn: number = 0): AnimationAction | null {
    const a = this.actions.get(name);
    if (!a) return null;
    if (this.activeAction && this.activeAction !== a) {
      this.activeAction.isPlaying = false;
    }
    this.crossFadeFrom = null;
    a.reset();
    a.play();
    this.activeAction = a;
    if (fadeIn > 0) {
      this.fadeActive = true;
      this.fadeFrom = 0;
      this.fadeTo = this.weight;
      this.currentWeight = 0;
      this.fadeT = 0;
      this.fadeDur = fadeIn;
    } else {
      this.fadeActive = false;
      this.currentWeight = this.weight;
    }
    return a;
  }

  /** 停止当前 action。fadeOut>0 时权重淡出到 0 后再停止。 */
  stop(fadeOut: number = 0): void {
    if (!this.activeAction) return;
    if (fadeOut > 0) {
      this.fadeActive = true;
      this.fadeFrom = this.currentWeight;
      this.fadeTo = 0;
      this.fadeT = 0;
      this.fadeDur = fadeOut;
    } else {
      this.activeAction.isPlaying = false;
      this.activeAction = null;
      this.currentWeight = 0;
      this.fadeActive = false;
      this.crossFadeFrom = null;
    }
  }

  /** 从当前 action 交叉淡入到名为 name 的 action,过渡时长 duration。 */
  crossFade(name: string, duration: number): AnimationAction | null {
    const a = this.actions.get(name);
    if (!a) return null;
    if (!this.activeAction || this.activeAction === a) {
      return this.play(name, duration);
    }
    this.crossFadeFrom = this.activeAction;
    this.activeAction = a;
    a.reset();
    a.play();
    this.crossFadeT = 0;
    this.crossFadeDur = duration;
    if (!this.fadeActive) this.currentWeight = this.weight;
    return a;
  }

  /** 设置目标权重(立即生效,不经过 fade)。 */
  setWeight(w: number): void {
    this.weight = clamp01(w);
    if (this.fadeActive) {
      this.fadeTo = this.weight;
    } else {
      this.currentWeight = this.weight;
    }
  }

  /** 推进 fade 与 playhead。不写入骨骼。 */
  update(dt: number): void {
    // 权重 fade
    if (this.fadeActive) {
      this.fadeT += dt;
      const k = this.fadeDur > 0 ? clamp01(this.fadeT / this.fadeDur) : 1;
      this.currentWeight = lerp(this.fadeFrom, this.fadeTo, k);
      if (k >= 1) {
        this.fadeActive = false;
        this.currentWeight = this.fadeTo;
        if (this.fadeTo <= 0 && this.activeAction) {
          this.activeAction.isPlaying = false;
          this.activeAction = null;
        }
      }
    }

    // crossfade 计时
    if (this.crossFadeFrom) {
      this.crossFadeT += dt;
      if (this.crossFadeDur > 0 && this.crossFadeT >= this.crossFadeDur) {
        this.crossFadeFrom.isPlaying = false;
        this.crossFadeFrom = null;
      }
    }

    // 推进 playhead(不调用 action.update 避免其内部 apply)
    if (this.activeAction) advanceTime(this.activeAction, dt);
    if (this.crossFadeFrom) advanceTime(this.crossFadeFrom, dt);
  }

  /** 把本层动画(按 blendMode/weight/mask)写入 bones。 */
  apply(bones: Bone[]): void {
    if (this.currentWeight <= 0) return;
    if (!this.activeAction && !this.crossFadeFrom) return;

    // 构建骨骼引用查找表(只处理 bones 数组中的节点)
    const lookup = new Set<object>();
    for (const b of bones) lookup.add(b);

    if (this.crossFadeFrom && this.activeAction) {
      const t = this.crossFadeDur > 0 ? clamp01(this.crossFadeT / this.crossFadeDur) : 1;
      this.applyCrossFade(this.crossFadeFrom, this.activeAction, t, this.currentWeight, lookup);
    } else if (this.activeAction) {
      this.applyAction(this.activeAction, this.currentWeight, lookup);
    }
  }

  /** 应用单个 action。 */
  private applyAction(action: AnimationAction, weight: number, lookup: Set<object>): void {
    const clip = action.clip;
    const time = action.time;
    for (const track of clip.tracks) {
      if (!track.target) continue;
      const node = track.target.node;
      if (!lookup.has(node)) continue;
      if (!this.boneAllowed(node.name)) continue;

      ensureBuf(track.valueSize);
      track.sample(time, _bufA);
      this.applySampledValue(track, node, _bufA, weight);
    }
  }

  /** crossFade:采样两个 action,按 t 混合后应用。 */
  private applyCrossFade(
    from: AnimationAction, to: AnimationAction,
    t: number, layerWeight: number, lookup: Set<object>,
  ): void {
    const tracksFrom = from.clip.tracks;
    const tracksTo = to.clip.tracks;
    const n = Math.min(tracksFrom.length, tracksTo.length);
    for (let i = 0; i < n; i++) {
      const tf = tracksFrom[i];
      const tt = tracksTo[i];
      if (!tf.target || !tt.target) continue;
      const node = tf.target.node;
      if (!lookup.has(node)) continue;
      if (!this.boneAllowed(node.name)) continue;

      const size = tf.valueSize;
      ensureBuf(size);
      tf.sample(from.time, _bufA);
      tt.sample(to.time, _bufB);

      // 混合 from→to
      if (size === 4 && tf.interp !== 'step') {
        slerpQuat(_bufA, _bufB, t, _blend);
      } else {
        const inv = 1 - t;
        for (let j = 0; j < size; j++) _blend[j] = _bufA[j] * inv + _bufB[j] * t;
      }

      this.applySampledValue(tf, node, _blend, layerWeight);
    }
  }

  /** 把采样值(已含本层权重逻辑)写入节点。
   *  override/mask: 按 weight 与当前值 lerp/slerp。
   *  additive: 叠加增量。 */
  private applySampledValue(
    track: KeyframeTrack, node: { name: string } & object,
    sampled: number[], weight: number,
  ): void {
    const size = track.valueSize;
    const target = track.target!;
    if (this.blendMode === 'additive') {
      readNodeValue(node, target.property, _cur, size);
      if (size === 4) {
        AdditiveBlend.applyAdditiveQuaternion(_cur, sampled, weight, _out);
      } else {
        for (let i = 0; i < size; i++) _out[i] = _cur[i] + sampled[i] * weight;
      }
      track.applyValue(_out);
    } else {
      // override / mask
      if (weight >= 1) {
        track.applyValue(sampled);
      } else {
        readNodeValue(node, target.property, _cur, size);
        if (size === 4) {
          slerpQuat(_cur, sampled, weight, _out);
        } else {
          const inv = 1 - weight;
          for (let i = 0; i < size; i++) _out[i] = _cur[i] * inv + sampled[i] * weight;
        }
        track.applyValue(_out);
      }
    }
  }

  /** 判断此骨骼是否被本层允许(综合 blendMode 与 mask)。 */
  private boneAllowed(name: string): boolean {
    if (this.blendMode === 'mask') {
      return this.mask ? this.mask.affects(name) : true;
    }
    if (this.mask) return this.mask.affects(name);
    return true;
  }
}

// ── helpers ──────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ensureBuf(size: number): void {
  if (_bufA.length < size) { _bufA.length = size; _bufB.length = size; _blend.length = size; _cur.length = size; _out.length = size; }
}

/** 从 Object3D 读取当前属性值到 out 数组。 */
function readNodeValue(
  node: object,
  prop: TrackTarget['property'],
  out: number[],
  size: number,
): void {
  const n = node as {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    scale: { x: number; y: number; z: number };
  };
  switch (prop) {
    case 'position':
      out[0] = n.position.x; out[1] = n.position.y; out[2] = n.position.z;
      break;
    case 'scale':
      out[0] = n.scale.x; out[1] = n.scale.y; out[2] = n.scale.z;
      break;
    case 'quaternion':
      out[0] = n.rotation.x; out[1] = n.rotation.y; out[2] = n.rotation.z; out[3] = n.rotation.w;
      break;
    case 'rotation.x':
      out[0] = n.rotation.x;
      break;
    case 'rotation.y':
      out[0] = n.rotation.y;
      break;
    case 'rotation.z':
      out[0] = n.rotation.z;
      break;
  }
  void size;
}

/** 对两个四元数(raw [x,y,z,w])做 slerp,结果写入 out。 */
function slerpQuat(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: number[]): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (1 - cos > 1e-5) {
    const omega = Math.acos(cos);
    const sinOm = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sinOm;
    s1 = Math.sin(t * omega) / sinOm;
  } else {
    s0 = 1 - t; s1 = t;
  }
  out[0] = s0 * ax + s1 * bx;
  out[1] = s0 * ay + s1 * by;
  out[2] = s0 * az + s1 * bz;
  out[3] = s0 * aw + s1 * bw;
}

/** 推进 action 的 playhead(复制 AnimationAction 的 loop 逻辑,但不 apply)。
 *  这避免 AnimationAction.update() 内部的 track.apply() 破坏分层混合。 */
function advanceTime(action: AnimationAction, dt: number): void {
  if (!action.isPlaying) return;
  let t = action.time + action.timeScale * dt;
  const d = action.clip.duration;
  switch (action.loop) {
    case 'once':
      if (t >= d) { t = d; action.isPlaying = false; }
      break;
    case 'repeat':
      if (d > 0) t = ((t % d) + d) % d;
      break;
    case 'pingpong': {
      if (d > 0) {
        const period = 2 * d;
        const phase = ((t % period) + period) % period;
        t = phase > d ? period - phase : phase;
      }
      break;
    }
  }
  action.time = t;
}

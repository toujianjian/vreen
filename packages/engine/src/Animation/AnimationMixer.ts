// AnimationMixer — drives a hierarchy of Object3Ds. Owns the active
// set of AnimationActions; calling `mixer.update(dt)` advances them
// all. Clips are bound lazily on first use so the same Mixer instance
// can be reused across reloads of the same root.

import { AnimationClip } from './AnimationClip';
import { AnimationAction } from './AnimationAction';
import { Object3D } from '../Core/Object3D';

export class AnimationMixer {
  root: Object3D;
  /** action key → AnimationAction. Keys are unique per clip.name+clip. */
  private actions: Map<string, AnimationAction> = new Map();
  /** Tracks whether each clip has been bound to the root. */
  private boundClips: WeakSet<AnimationClip> = new WeakSet();

  constructor(root: Object3D) {
    this.root = root;
  }

  /** Create (or fetch) an action that plays `clip`. */
  actionFor(clip: AnimationClip): AnimationAction {
    const key = `${this.root.uuid}:${clip.name}`;
    let a = this.actions.get(key);
    if (a) return a;
    a = new AnimationAction(clip);
    this.actions.set(key, a);
    this.boundClips.has(clip) || (clip.bind(this.root), this.boundClips.add(clip));
    return a;
  }

  /** Convenience: get-or-create the action and start it. */
  play(clip: AnimationClip, opts: { loop?: AnimationAction['loop']; timeScale?: number } = {}): AnimationAction {
    const a = this.actionFor(clip);
    if (opts.loop !== undefined) a.loop = opts.loop;
    if (opts.timeScale !== undefined) a.timeScale = opts.timeScale;
    a.reset();
    a.play();
    return a;
  }

  /** Stop all actions. */
  stopAll(): void {
    for (const a of this.actions.values()) a.stop();
  }

  /** Advance all actions by `dt` seconds. */
  update(dt: number): void {
    for (const a of this.actions.values()) a.update(dt);
  }
}

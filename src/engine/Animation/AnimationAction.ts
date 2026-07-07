// AnimationAction — a playing instance of an AnimationClip, with
// playback controls (play, pause, stop, loop, timeScale, weight).
//
// The action's "effective time" is the clip's local time, advanced by
// `timeScale` * `dt`. When `loop` is true, the effective time wraps
// into [0, duration]; when false, it clamps to duration.

import { AnimationClip } from './AnimationClip';

export type LoopMode = 'once' | 'repeat' | 'pingpong';

export class AnimationAction {
  clip: AnimationClip;
  timeScale: number = 1;
  weight: number = 1;
  loop: LoopMode = 'repeat';
  /** Direction for 'pingpong' mode. Flipped each wrap. */
  private _pingDir: 1 | -1 = 1;
  /** Current play time (seconds). */
  time: number = 0;
  isPlaying: boolean = false;
  /** Set by Mixer after bind; resolves clip tracks to nodes. */
  isBound: boolean = false;

  constructor(clip: AnimationClip) {
    this.clip = clip;
  }

  play(): this {
    this.isPlaying = true;
    return this;
  }

  pause(): this {
    this.isPlaying = false;
    return this;
  }

  stop(): this {
    this.isPlaying = false;
    this.time = 0;
    return this;
  }

  reset(): this {
    this.time = 0;
    this._pingDir = 1;
    return this;
  }

  /** Advance the playhead by `dt` seconds and apply the clip. */
  update(dt: number): void {
    if (!this.isPlaying) return;
    let t = this.time + this.timeScale * dt;
    const d = this.clip.duration;
    if (this.loop === 'once') {
      if (t >= d) {
        t = d;
        this.isPlaying = false;
      }
    } else if (this.loop === 'repeat') {
      if (d > 0) t = ((t % d) + d) % d;
    } else if (this.loop === 'pingpong') {
      if (d > 0) {
        const period = 2 * d;
        let phase = ((t % period) + period) % period;
        if (phase > d) {
          t = period - phase;
        } else {
          t = phase;
        }
      }
    }
    this.time = t;
    for (const track of this.clip.tracks) track.apply(this.time);
  }
}

// AnimationClip — a named collection of KeyframeTracks with a total
// duration. Tracks reference Object3D nodes by name (UUID).
//
// The binding step (called by AnimationMixer before the first frame)
// walks a target root and looks up nodes by `name`. The first matching
// node is bound; collisions are warned about.

import { KeyframeTrack, TrackTarget } from './KeyframeTrack';
import { Object3D } from '../Core/Object3D';

export class AnimationClip {
  name: string;
  duration: number;
  tracks: KeyframeTrack[] = [];

  constructor(name: string, duration: number, tracks: KeyframeTrack[] = []) {
    this.name = name;
    this.duration = duration;
    this.tracks = tracks;
  }

  /** Bind tracks to concrete nodes under `root`. Each track's name is
   *  parsed as "<nodeName>.<property>" and looked up in the root's
   *  descendants. */
  bind(root: Object3D): void {
    for (const track of this.tracks) {
      const dot = track.name.lastIndexOf('.');
      if (dot < 0) continue;
      const nodeName = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1) as TrackTarget['property'];
      const node = root.getObjectByName(nodeName);
      if (!node) continue;
      track.target = { node, property };
    }
  }
}

// AnimationMixer 单元测试(数据层,不依赖 WebGL)。
// 覆盖 clipAction get-or-create 幂等性与 uncacheAction 解绑语义
// (three.js AnimationMixer.clipAction/uncacheAction 适配)。

import { describe, it, expect } from 'vitest';
import { AnimationMixer } from './AnimationMixer';
import { AnimationClip } from './AnimationClip';
import { VectorKeyframeTrack } from './KeyframeTrack';
import { Group } from '../Core/Group';
import { Object3D } from '../Core/Object3D';

function makeClip(): AnimationClip {
  // 一条 1 秒 position 轨道:0s=(0,0,0), 1s=(1,2,3)
  return new AnimationClip('run', 1, [
    new VectorKeyframeTrack('Root.position', [0, 1], [0, 0, 0, 1, 2, 3]),
  ]);
}

function makeRoot(): Object3D {
  const root = new Group();
  const node = new Object3D();
  node.name = 'Root';
  root.add(node);
  return root;
}

describe('AnimationMixer', () => {
  it('clipAction returns the same action instance for the same clip', () => {
    const mixer = new AnimationMixer(makeRoot());
    const clip = makeClip();
    const a = mixer.clipAction(clip);
    expect(mixer.clipAction(clip)).toBe(a);
  });

  it('clipAction binds clip tracks to root nodes', () => {
    const root = makeRoot();
    const mixer = new AnimationMixer(root);
    const clip = makeClip();
    const a = mixer.clipAction(clip);
    expect(a.isBound).toBe(true);
    const track = clip.tracks[0];
    expect(track.target).not.toBeNull();
    expect(track.target?.node.name).toBe('Root');
    expect(track.target?.property).toBe('position');
  });

  it('uncacheAction stops the action and unbinds the clip tracks', () => {
    const root = makeRoot();
    const mixer = new AnimationMixer(root);
    const clip = makeClip();
    const a = mixer.clipAction(clip);
    a.play();
    expect(a.isPlaying).toBe(true);

    mixer.uncacheAction(clip);
    expect(a.isPlaying).toBe(false);
    expect(a.time).toBe(0);
    expect(clip.tracks[0].target).toBeNull();
    // 再次 clipAction 会重建 action 并重新 bind
    const b = mixer.clipAction(clip);
    expect(b).not.toBe(a);
    expect(clip.tracks[0].target).not.toBeNull();
  });

  it('uncacheAction is a no-op for a clip that was never requested', () => {
    const mixer = new AnimationMixer(makeRoot());
    const clip = makeClip();
    expect(() => mixer.uncacheAction(clip)).not.toThrow();
  });
});

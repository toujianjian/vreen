import { describe, it, expect } from 'vitest';
import { Object3D } from '../Core/Object3D';
import { Bone } from '../Core/Bone';
import { AnimationClip } from './AnimationClip';
import { VectorKeyframeTrack, QuaternionKeyframeTrack } from './KeyframeTrack';
import { AnimationLayer } from './AnimationLayer';
import { AnimationLayerMixer } from './AnimationLayerMixer';
import { BoneMask } from './BoneMask';
import { AnimationSync } from './AnimationSync';

/** 构建一个绑定到 root 的 position track clip。 */
function makePosClip(
  name: string, boneName: string,
  times: number[], pts: [number, number, number][],
  duration: number,
): { clip: AnimationClip; bone: Bone } {
  const root = new Object3D();
  const bone = new Bone();
  bone.name = boneName;
  root.add(bone);
  const values: number[] = [];
  for (const p of pts) values.push(p[0], p[1], p[2]);
  const track = new VectorKeyframeTrack(`${boneName}.position`, times, values);
  const clip = new AnimationClip(name, duration, [track]);
  clip.bind(root);
  return { clip, bone };
}

describe('AnimationLayer', () => {
  it('addAction + play + apply writes pose to bone (override w=1)', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    const layer = new AnimationLayer('base', 'override');
    layer.addAction(clip);
    layer.play('walk');
    layer.update(0.5);
    layer.apply([bone]);

    expect(bone.position.x).toBeCloseTo(5);
    expect(bone.position.y).toBeCloseTo(0);
    expect(bone.position.z).toBeCloseTo(0);
  });

  it('update advances time without applying', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    const layer = new AnimationLayer('base');
    layer.addAction(clip);
    layer.play('walk');
    layer.update(0.5);
    // time advanced but bone not yet written
    expect(bone.position.x).toBeCloseTo(0);
    expect(layer.activeAction!.time).toBeCloseTo(0.5);
  });

  it('weight < 1 blends with current pose', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    // base pose at origin
    bone.position.set(0, 0, 0);
    const layer = new AnimationLayer('base', 'override');
    layer.weight = 0.5;
    layer.addAction(clip);
    layer.play('walk');
    layer.update(0.5);
    layer.apply([bone]);
    // sampled = (5,0,0); result = lerp((0,0,0), (5,0,0), 0.5) = (2.5, 0, 0)
    expect(bone.position.x).toBeCloseTo(2.5);
  });

  it('weight = 0 does not write', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    bone.position.set(1, 1, 1);
    const layer = new AnimationLayer('base', 'override');
    layer.weight = 0;
    layer.addAction(clip);
    layer.play('walk');
    layer.update(0.5);
    layer.apply([bone]);
    expect(bone.position.x).toBeCloseTo(1);
  });

  it('mask excludes bones from override', () => {
    const root = new Object3D();
    const upper = new Bone(); upper.name = 'Upper';
    const lower = new Bone(); lower.name = 'Lower';
    root.add(upper);
    root.add(lower);
    const tUp = new VectorKeyframeTrack('Upper.position', [0, 1], [0, 0, 0, 10, 0, 0]);
    const tLo = new VectorKeyframeTrack('Lower.position', [0, 1], [0, 0, 0, 10, 0, 0]);
    const clip = new AnimationClip('test', 1, [tUp, tLo]);
    clip.bind(root);

    const mask = new BoneMask(['Upper'], true); // 只影响 Upper
    const layer = new AnimationLayer('masked', 'override', mask);
    layer.addAction(clip);
    layer.play('test');
    layer.update(0.5);
    layer.apply([upper, lower]);

    expect(upper.position.x).toBeCloseTo(5);
    expect(lower.position.x).toBeCloseTo(0); // 未被影响
  });

  it('blendMode=mask only affects masked bones', () => {
    const root = new Object3D();
    const a = new Bone(); a.name = 'Arm';
    const b = new Bone(); b.name = 'Leg';
    root.add(a);
    root.add(b);
    const tA = new VectorKeyframeTrack('Arm.position', [0, 1], [0, 0, 0, 8, 0, 0]);
    const tB = new VectorKeyframeTrack('Leg.position', [0, 1], [0, 0, 0, 8, 0, 0]);
    const clip = new AnimationClip('wave', 1, [tA, tB]);
    clip.bind(root);

    const mask = new BoneMask(['Arm'], true);
    const layer = new AnimationLayer('armOnly', 'mask', mask);
    layer.addAction(clip);
    layer.play('wave');
    layer.update(0.5);
    layer.apply([a, b]);

    expect(a.position.x).toBeCloseTo(4);
    expect(b.position.x).toBeCloseTo(0);
  });

  it('additive blendMode adds delta to current pose', () => {
    const { clip, bone } = makePosClip('breath', 'Chest',
      [0, 1], [[0, 0, 0], [0, 2, 0]], 1);
    // base pose
    bone.position.set(1, 0, 0);
    const layer = new AnimationLayer('breath', 'additive');
    layer.weight = 1;
    layer.addAction(clip);
    layer.play('breath');
    layer.update(0.5);
    layer.apply([bone]);
    // sampled delta at 0.5 = (0, 1, 0); result = (1,0,0) + (0,1,0) = (1, 1, 0)
    expect(bone.position.x).toBeCloseTo(1);
    expect(bone.position.y).toBeCloseTo(1);
  });

  it('additive with weight scales the delta', () => {
    const { clip, bone } = makePosClip('breath', 'Chest',
      [0, 1], [[0, 0, 0], [0, 4, 0]], 1);
    bone.position.set(0, 0, 0);
    const layer = new AnimationLayer('breath', 'additive');
    layer.weight = 0.5;
    layer.addAction(clip);
    layer.play('breath');
    layer.update(0.5);
    layer.apply([bone]);
    // sampled = (0, 2, 0); result = (0,0,0) + (0,2,0)*0.5 = (0, 1, 0)
    expect(bone.position.y).toBeCloseTo(1);
  });

  it('crossFade blends two clips by progress', () => {
    const { clip: clipA, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    // clip B shares the same bone (rebind a second clip to same root)
    const root = new Object3D();
    root.add(bone);
    const tB = new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 20, 0, 0]);
    const clipB = new AnimationClip('run', 1, [tB]);
    clipB.bind(root);

    const layer = new AnimationLayer('base', 'override');
    layer.weight = 1;
    layer.addAction(clipA);
    layer.addAction(clipB);
    layer.play('walk');
    layer.update(0.5); // A.time = 0.5, sampled A = (5,0,0)
    layer.apply([bone]);
    expect(bone.position.x).toBeCloseTo(5);

    // cross-fade to run over 0.4s
    layer.crossFade('run', 0.4);
    layer.update(0.2);
    // crossFadeT = 0.2 → t = 0.5
    // A.time = 0.5 + 0.2 = 0.7 → sampled A = (7,0,0)
    // B.time = 0 + 0.2 = 0.2 → sampled B = (4,0,0)
    // blend = lerp((7,0,0), (4,0,0), 0.5) = (5.5, 0, 0)
    layer.apply([bone]);
    expect(bone.position.x).toBeCloseTo(5.5);
  });

  it('crossFade completes and drops from action', () => {
    const { clip: clipA, bone } = makePosClip('a', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    const root = new Object3D();
    root.add(bone);
    const tB = new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 20, 0, 0]);
    const clipB = new AnimationClip('b', 1, [tB]);
    clipB.bind(root);

    const layer = new AnimationLayer('base');
    layer.addAction(clipA);
    layer.addAction(clipB);
    layer.play('a');
    layer.crossFade('b', 0.4);
    // advance past crossfade duration
    layer.update(0.5);
    layer.apply([bone]);
    // crossfade done, only B active; B.time = 0.5 → sampled = (10,0,0)
    expect(bone.position.x).toBeCloseTo(10);
  });

  it('fadeIn ramps weight from 0', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    bone.position.set(0, 0, 0);
    const layer = new AnimationLayer('base', 'override');
    layer.weight = 1;
    layer.addAction(clip);
    layer.play('walk', 1.0); // fadeIn 1s
    // at 0 weight initially
    expect(layer.currentWeight).toBeCloseTo(0);
    layer.update(0.5);
    layer.apply([bone]);
    // weight ≈ 0.5; sampled at t=0.5 = (5,0,0); lerp((0,0,0),(5,0,0),0.5)=(2.5,0,0)
    expect(bone.position.x).toBeCloseTo(2.5);
  });

  it('stop with fadeOut ramps weight to 0 then clears', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    bone.position.set(0, 0, 0);
    const layer = new AnimationLayer('base', 'override');
    layer.weight = 1;
    layer.addAction(clip);
    layer.play('walk');
    layer.update(0.5);
    layer.stop(0.4);
    expect(layer.activeAction).not.toBeNull();
    // halfway through fadeout
    layer.update(0.2);
    layer.apply([bone]);
    // weight ≈ 0.5; sampled at time 0.7 = (7,0,0); lerp((0,0,0),(7,0,0),0.5) = (3.5,0,0)
    expect(bone.position.x).toBeCloseTo(3.5);
    // complete fadeout
    layer.update(0.2);
    expect(layer.activeAction).toBeNull();
  });

  it('play returns null for unknown action', () => {
    const layer = new AnimationLayer('base');
    expect(layer.play('missing')).toBeNull();
  });

  it('setWeight updates effective weight', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    bone.position.set(0, 0, 0);
    const layer = new AnimationLayer('base', 'override');
    layer.addAction(clip);
    layer.play('walk');
    layer.setWeight(0.3);
    layer.update(0.5);
    layer.apply([bone]);
    // sampled (5,0,0); lerp((0,0,0),(5,0,0),0.3) = (1.5, 0, 0)
    expect(bone.position.x).toBeCloseTo(1.5);
  });

  it('apply ignores tracks whose target is not in bones array', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    const layer = new AnimationLayer('base');
    layer.addAction(clip);
    layer.play('walk');
    layer.update(0.5);
    // pass empty bones → nothing applied
    layer.apply([]);
    expect(bone.position.x).toBeCloseTo(0);
  });
});

describe('AnimationLayerMixer', () => {
  it('addLayer / getLayer / removeLayer', () => {
    const bones: Bone[] = [];
    const mixer = new AnimationLayerMixer(bones);
    const l1 = new AnimationLayer('base');
    const l2 = new AnimationLayer('upper');
    mixer.addLayer(l1);
    mixer.addLayer(l2);
    expect(mixer.layers).toHaveLength(2);
    expect(mixer.getLayer('base')).toBe(l1);
    expect(mixer.getLayer('upper')).toBe(l2);
    expect(mixer.getLayer('missing')).toBeUndefined();
    expect(mixer.removeLayer('base')).toBe(true);
    expect(mixer.layers).toHaveLength(1);
    expect(mixer.getLayer('base')).toBeUndefined();
    expect(mixer.removeLayer('nope')).toBe(false);
  });

  it('layers stack: upper layer blends on top of base', () => {
    const root = new Object3D();
    const upper = new Bone(); upper.name = 'Upper';
    const lower = new Bone(); lower.name = 'Lower';
    root.add(upper);
    root.add(lower);
    // base clip animates both bones 0→4
    const baseTrackUp = new VectorKeyframeTrack('Upper.position', [0, 1], [0, 0, 0, 4, 0, 0]);
    const baseTrackLo = new VectorKeyframeTrack('Lower.position', [0, 1], [0, 0, 0, 4, 0, 0]);
    const baseClip = new AnimationClip('base', 1, [baseTrackUp, baseTrackLo]);
    baseClip.bind(root);
    // wave clip animates Upper 0→10
    const waveTrack = new VectorKeyframeTrack('Upper.position', [0, 1], [0, 0, 0, 10, 0, 0]);
    const waveClip = new AnimationClip('wave', 1, [waveTrack]);
    waveClip.bind(root);

    const mixer = new AnimationLayerMixer([upper, lower]);
    const baseLayer = mixer.addLayer(new AnimationLayer('base', 'override'));
    baseLayer.addAction(baseClip);
    baseLayer.play('base');

    const upperLayer = mixer.addLayer(
      new AnimationLayer('upper', 'override', new BoneMask(['Upper'], true)),
    );
    upperLayer.weight = 0.5;
    upperLayer.addAction(waveClip);
    upperLayer.play('wave');

    mixer.update(0.5);
    mixer.blend();

    // base: both → (2, 0, 0)
    // upper layer (Upper only, weight 0.5): lerp((2,0,0), (5,0,0), 0.5) = (3.5, 0, 0)
    expect(upper.position.x).toBeCloseTo(3.5);
    expect(lower.position.x).toBeCloseTo(2);
  });

  it('update advances all layers; blend applies all', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    const mixer = new AnimationLayerMixer([bone]);
    const layer = mixer.addLayer(new AnimationLayer('base'));
    layer.addAction(clip);
    layer.play('walk');
    mixer.update(0.5);
    // not yet blended
    expect(bone.position.x).toBeCloseTo(0);
    mixer.blend();
    expect(bone.position.x).toBeCloseTo(5);
  });

  it('accepts a Skeleton as target', () => {
    const { clip, bone } = makePosClip('walk', 'Hips',
      [0, 1], [[0, 0, 0], [10, 0, 0]], 1);
    // minimal skeleton-like object
    const skeleton = { bones: [bone] } as unknown as import('./../Core/Skeleton').Skeleton;
    const mixer = new AnimationLayerMixer(skeleton);
    const layer = mixer.addLayer(new AnimationLayer('base'));
    layer.addAction(clip);
    layer.play('walk');
    mixer.update(0.5);
    mixer.blend();
    expect(bone.position.x).toBeCloseTo(5);
  });
});

describe('AnimationSync', () => {
  it('syncPhase returns timeScale ratio', () => {
    const a = new AnimationClip('a', 2);
    const b = new AnimationClip('b', 4);
    const sync = AnimationSync.syncPhase(a, b);
    // B should run at 0.5x to match A's phase
    expect(sync.timeScale).toBeCloseTo(0.5);
  });

  it('syncPhase returns 1 when either duration is 0', () => {
    const a = new AnimationClip('a', 0);
    const b = new AnimationClip('b', 4);
    expect(AnimationSync.syncPhase(a, b).timeScale).toBe(1);
    expect(AnimationSync.syncPhase(new AnimationClip('a', 2), new AnimationClip('b', 0)).timeScale).toBe(1);
  });

  it('mirrorClip negates the mirrored axis of position', () => {
    const track = new VectorKeyframeTrack('Hips.position', [0, 1], [1, 2, 3, 4, 5, 6]);
    const clip = new AnimationClip('walk', 1, [track]);
    const mirrored = AnimationSync.mirrorClip(clip, 'x');
    const mt = mirrored.tracks[0] as VectorKeyframeTrack;
    // x negated, y/z unchanged
    expect(mt.values[0]).toBeCloseTo(-1);
    expect(mt.values[1]).toBeCloseTo(2);
    expect(mt.values[2]).toBeCloseTo(3);
    expect(mt.values[3]).toBeCloseTo(-4);
    expect(mt.values[4]).toBeCloseTo(5);
    expect(mt.values[5]).toBeCloseTo(6);
  });

  it('mirrorClip does not modify scale tracks', () => {
    const track = new VectorKeyframeTrack('Hips.scale', [0, 1], [1, 1, 1, 2, 2, 2]);
    const clip = new AnimationClip('grow', 1, [track]);
    const mirrored = AnimationSync.mirrorClip(clip, 'x');
    const mt = mirrored.tracks[0] as VectorKeyframeTrack;
    expect(mt.values[0]).toBeCloseTo(1);
    expect(mt.values[3]).toBeCloseTo(2);
  });

  it('mirrorClip negates quaternion axis component', () => {
    // 90° around Y: [0, √2/2, 0, √2/2]
    const track = new QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [
      0, Math.SQRT1_2, 0, Math.SQRT1_2,
      0, Math.SQRT1_2, 0, Math.SQRT1_2,
    ]);
    const clip = new AnimationClip('rot', 1, [track]);
    // mirror across YZ plane (axis x) → negate quat.x
    const mirrored = AnimationSync.mirrorClip(clip, 'x');
    const mt = mirrored.tracks[0] as QuaternionKeyframeTrack;
    expect(mt.values[0]).toBeCloseTo(-0);
    expect(mt.values[1]).toBeCloseTo(Math.SQRT1_2); // y unchanged
    expect(mt.values[3]).toBeCloseTo(Math.SQRT1_2);
  });

  it('mirrorClip preserves duration and track count', () => {
    const t1 = new VectorKeyframeTrack('A.position', [0, 1], [0, 0, 0, 1, 1, 1]);
    const t2 = new QuaternionKeyframeTrack('B.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const clip = new AnimationClip('c', 2.5, [t1, t2]);
    const m = AnimationSync.mirrorClip(clip, 'y');
    expect(m.duration).toBeCloseTo(2.5);
    expect(m.tracks).toHaveLength(2);
    expect(m.name).toBe('c_mirror');
  });
});

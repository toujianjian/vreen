import { describe, it, expect } from 'vitest';
import { Object3D } from '../Core/Object3D';
import { AnimationClip } from './AnimationClip';
import {
  NumberKeyframeTrack,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
} from './KeyframeTrack';
import { AnimationAction } from './AnimationAction';
import { AnimationMixer } from './AnimationMixer';
import { AnimationStateMachine } from './AnimationStateMachine';
import { World } from '../ECS/World';

describe('AnimationClip', () => {
  it('constructs with name and duration', () => {
    const clip = new AnimationClip('walk', 2.0);
    expect(clip.name).toBe('walk');
    expect(clip.duration).toBe(2.0);
    expect(clip.tracks).toEqual([]);
  });

  it('bind resolves track targets by node name', () => {
    const root = new Object3D();
    const child = new Object3D();
    child.name = 'Bone';
    root.add(child);

    const track = new VectorKeyframeTrack('Bone.position', [0, 1], [0, 0, 0, 1, 1, 0]);
    const clip = new AnimationClip('test', 1, [track]);
    clip.bind(root);

    expect(track.target).not.toBeNull();
    expect(track.target!.node).toBe(child);
    expect(track.target!.property).toBe('position');
  });

  it('bind skips tracks with no dot in name', () => {
    const track = new VectorKeyframeTrack('noDot', [0], [0, 0, 0]);
    const clip = new AnimationClip('test', 1, [track]);
    clip.bind(new Object3D());
    expect(track.target).toBeNull();
  });
});

describe('KeyframeTrack', () => {
  describe('findTime', () => {
    it('returns first key when time <= start', () => {
      const t = new NumberKeyframeTrack('x.rotation.x', [0.5, 1.0], [0, 1]);
      const { i0, i1, alpha } = t.findTime(0);
      expect(i0).toBe(0);
      expect(i1).toBe(0);
      expect(alpha).toBe(0);
      expect(alpha).toBe(0);
    });

    it('returns last key when time >= end', () => {
      const t = new NumberKeyframeTrack('x.rotation.x', [0, 1], [0, 1]);
      const { i0, i1 } = t.findTime(2);
      expect(i0).toBe(1);
      expect(i1).toBe(1);
    });

    it('interpolates between keys', () => {
      const t = new NumberKeyframeTrack('x.rotation.x', [0, 1], [0, 10]);
      const { i0, i1, alpha } = t.findTime(0.5);
      expect(i0).toBe(0);
      expect(i1).toBe(1);
      expect(alpha).toBeCloseTo(0.5);
    });

    it('returns correct indices for single key', () => {
      const t = new NumberKeyframeTrack('x.rotation.x', [1], [5]);
      const { i0, i1 } = t.findTime(0.5);
      expect(i0).toBe(0);
      expect(i1).toBe(0);
    });
  });

  describe('NumberKeyframeTrack.apply', () => {
    it('sets rotation.x on target', () => {
      const node = new Object3D();
      const track = new NumberKeyframeTrack('node.rotation.x', [0, 1], [0, 90]);
      track.target = { node, property: 'rotation.x' };
      track.apply(0.5);
      expect(node.rotation.x).toBeCloseTo(45);
    });
  });

  describe('VectorKeyframeTrack.apply', () => {
    it('sets position on target', () => {
      const node = new Object3D();
      const track = new VectorKeyframeTrack('node.position', [0, 1], [0, 0, 0, 10, 20, 30]);
      track.target = { node, property: 'position' };
      track.apply(0.5);
      expect(node.position.x).toBeCloseTo(5);
      expect(node.position.y).toBeCloseTo(10);
      expect(node.position.z).toBeCloseTo(15);
    });

    it('sets scale on target', () => {
      const node = new Object3D();
      const track = new VectorKeyframeTrack('node.scale', [0, 1], [1, 1, 1, 2, 2, 2]);
      track.target = { node, property: 'scale' };
      track.apply(1);
      expect(node.scale.x).toBeCloseTo(2);
    });
  });

  describe('QuaternionKeyframeTrack.apply', () => {
    it('sets rotation quaternion via slerp', () => {
      const node = new Object3D();
      // Identity → 90° around Y
      const track = new QuaternionKeyframeTrack('node.quaternion', [0, 1], [
        0, 0, 0, 1,
        0, Math.SQRT1_2, 0, Math.SQRT1_2,
      ]);
      track.target = { node, property: 'quaternion' };
      track.apply(0);
      expect(node.rotation.w).toBeCloseTo(1);
      track.apply(1);
      expect(node.rotation.y).toBeCloseTo(Math.SQRT1_2);
    });
  });
});

describe('AnimationAction', () => {
  it('play/pause/stop control isPlaying', () => {
    const clip = new AnimationClip('test', 1);
    const action = new AnimationAction(clip);
    expect(action.isPlaying).toBe(false);
    action.play();
    expect(action.isPlaying).toBe(true);
    action.pause();
    expect(action.isPlaying).toBe(false);
    action.stop();
    expect(action.isPlaying).toBe(false);
    expect(action.time).toBe(0);
  });

  it('update advances time with repeat loop', () => {
    const clip = new AnimationClip('test', 2);
    const action = new AnimationAction(clip);
    action.play();
    action.update(1);
    expect(action.time).toBeCloseTo(1);
    action.update(1.5);
    // 2.5 % 2 = 0.5
    expect(action.time).toBeCloseTo(0.5);
  });

  it('once loop stops at duration', () => {
    const clip = new AnimationClip('test', 2);
    const action = new AnimationAction(clip);
    action.loop = 'once';
    action.play();
    action.update(3);
    expect(action.time).toBeCloseTo(2);
    expect(action.isPlaying).toBe(false);
  });

  it('pingpong loop reverses direction', () => {
    const clip = new AnimationClip('test', 1);
    const action = new AnimationAction(clip);
    action.loop = 'pingpong';
    action.play();
    action.update(0.6);
    // forward: 0.6
    expect(action.time).toBeCloseTo(0.6);
    action.update(0.6);
    // 1.2 → period=2, phase=1.2, 1.2 > 1 → 2-1.2=0.8
    expect(action.time).toBeCloseTo(0.8);
  });

  it('timeScale affects playback speed', () => {
    const clip = new AnimationClip('test', 5);
    const action = new AnimationAction(clip);
    action.timeScale = 2;
    action.play();
    action.update(1);
    expect(action.time).toBeCloseTo(2);
  });

  it('update does nothing when not playing', () => {
    const clip = new AnimationClip('test', 5);
    const action = new AnimationAction(clip);
    action.update(1);
    expect(action.time).toBe(0);
  });
});

describe('AnimationMixer', () => {
  it('actionFor creates and caches actions', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const clip = new AnimationClip('test', 1);
    const a1 = mixer.actionFor(clip);
    const a2 = mixer.actionFor(clip);
    expect(a1).toBe(a2);
  });

  it('play creates action and starts playing', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const clip = new AnimationClip('test', 2);
    const action = mixer.play(clip);
    expect(action.isPlaying).toBe(true);
    expect(action.loop).toBe('repeat');
  });

  it('stopAll stops all actions', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const clip = new AnimationClip('test', 2);
    mixer.play(clip);
    mixer.stopAll();
    const action = mixer.actionFor(clip);
    expect(action.isPlaying).toBe(false);
  });

  it('update advances all actions', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const clip = new AnimationClip('test', 10);
    mixer.play(clip);
    mixer.update(1);
    const action = mixer.actionFor(clip);
    expect(action.time).toBeCloseTo(1);
  });
});

describe('AnimationStateMachine', () => {
  it('add and enter state', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const sm = new AnimationStateMachine(mixer);
    const clip = new AnimationClip('idle', 5);
    sm.add({ name: 'idle', clip, loop: 'repeat' });
    const ok = sm.enter('idle');
    expect(ok).toBe(true);
    expect(sm.current?.name).toBe('idle');
  });

  it('enter returns false for unknown state', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const sm = new AnimationStateMachine(mixer);
    expect(sm.enter('missing')).toBe(false);
  });

  it('enter returns false if already in that state', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const sm = new AnimationStateMachine(mixer);
    const clip = new AnimationClip('idle', 5);
    sm.add({ name: 'idle', clip, loop: 'repeat' });
    sm.enter('idle');
    expect(sm.enter('idle')).toBe(false);
  });

  it('tick transitions via guard', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const sm = new AnimationStateMachine(mixer);
    const idle = new AnimationClip('idle', 5);
    const walk = new AnimationClip('walk', 2);
    sm.add({ name: 'idle', clip: idle, loop: 'repeat' });
    sm.add({ name: 'walk', clip: walk, loop: 'repeat' });
    sm.on({ from: 'idle', to: 'walk', guard: () => true });
    sm.enter('idle');

    const world = new World();
    const entity = world.createEntity('test');
    sm.tick(world, entity, 0.016);
    expect(sm.current?.name).toBe('walk');
  });

  it('tick does not transition when guard returns false', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const sm = new AnimationStateMachine(mixer);
    sm.add({ name: 'idle', clip: new AnimationClip('idle', 5), loop: 'repeat' });
    sm.add({ name: 'walk', clip: new AnimationClip('walk', 2), loop: 'repeat' });
    sm.on({ from: 'idle', to: 'walk', guard: () => false });
    sm.enter('idle');

    const world = new World();
    sm.tick(world, 0, 0.016);
    expect(sm.current?.name).toBe('idle');
  });

  it('tick handles transition with duration', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const sm = new AnimationStateMachine(mixer);
    sm.add({ name: 'idle', clip: new AnimationClip('idle', 5), loop: 'repeat' });
    sm.add({ name: 'run', clip: new AnimationClip('run', 2), loop: 'repeat' });
    sm.on({ from: 'idle', to: 'run', guard: () => true, duration: 0.5 });
    sm.enter('idle');

    const world = new World();
    sm.tick(world, 0, 0.016);
    // Should set pending state, not switch immediately
    expect(sm.current?.name).toBe('idle');
    expect(sm.pendingState?.name).toBe('run');
    expect(sm.transitionT).toBeGreaterThan(0);
  });

  it('listStateNames returns registered state names', () => {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    const sm = new AnimationStateMachine(mixer);
    sm.add({ name: 'idle', clip: new AnimationClip('idle', 5), loop: 'repeat' });
    sm.add({ name: 'walk', clip: new AnimationClip('walk', 2), loop: 'repeat' });
    expect(sm.listStateNames()).toEqual(['idle', 'walk']);
  });
});
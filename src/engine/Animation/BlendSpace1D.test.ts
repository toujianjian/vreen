// Phase 2.5.1 — Blend Space 1D 测试:根据速度混合两个动画 clip。
//
// 覆盖:
//   - 单样本播放(playhead 推进、wrap)
//   - 两样本:bracket 查找、alpha 计算
//   - 越界 speed:clamp 到端点
//   - Vector3 track 线性混合
//   - Quaternion track slerp 混合
//   - timeScale 影响 playhead 推进
//   - 三样本:Idle→Walk→Run 中间点混合
//   - add 重复 speed 覆盖
//   - reset 清零 playhead

import { describe, it, expect } from 'vitest';
import { Object3D } from '../Core/Object3D';
import { AnimationClip } from './AnimationClip';
import {
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
} from './KeyframeTrack';
import { AnimationMixer } from './AnimationMixer';
import { BlendSpace1D } from './BlendSpace1D';

/** 构造一个简单的 position 动画:在 [0, duration] 内从 p0 到 p1。 */
function makePosClip(name: string, duration: number, p0: [number, number, number], p1: [number, number, number]): AnimationClip {
  const track = new VectorKeyframeTrack('Bone.position', [0, duration], [...p0, ...p1]);
  const clip = new AnimationClip(name, duration, [track]);
  return clip;
}

/** 构造一个 quaternion 动画:从 q0 到 q1。 */
function makeQuatClip(name: string, duration: number, q0: [number, number, number, number], q1: [number, number, number, number]): AnimationClip {
  const track = new QuaternionKeyframeTrack('Bone.quaternion', [0, duration], [...q0, ...q1]);
  return new AnimationClip(name, duration, [track]);
}

function bindClip(clip: AnimationClip, root: Object3D): void {
  clip.bind(root);
}

describe('Phase 2.5.1 — Blend Space 1D', () => {
  describe('单样本播放', () => {
    it('单样本:update 推进 playhead 并 apply', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const clip = makePosClip('Idle', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(clip, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip });

      // t=0.5 → position 应该是 (5, 0, 0)
      bs.update(0, 0.5);
      expect(bone.position.x).toBeCloseTo(5, 5);
      expect(bone.position.y).toBeCloseTo(0, 5);
    });

    it('单样本:playhead wrap 到 [0, duration]', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const clip = makePosClip('Idle', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(clip, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip });

      // 推进 1.5 秒 → playhead wrap 到 0.5
      bs.update(0, 1.5);
      expect(bone.position.x).toBeCloseTo(5, 5);
    });
  });

  describe('两样本混合', () => {
    it('speed 在中间:alpha=0.5 线性混合 position', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      // Idle: speed=0, position (0,0,0)→(0,0,0)(静止)
      const idle = makePosClip('Idle', 1.0, [0, 0, 0], [0, 0, 0]);
      // Walk: speed=2, position (0,0,0)→(10,0,0)(移动)
      const walk = makePosClip('Walk', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(idle, root);
      bindClip(walk, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 2, clip: walk });

      // speed=1, alpha=0.5, t=0.5(两 clip 同 duration 同步推进)
      bs.update(1, 0.5);
      // idle 在 t=0.5 → (0,0,0);walk 在 t=0.5 → (5,0,0)
      // 混合 0.5*(0,0,0) + 0.5*(5,0,0) = (2.5, 0, 0)
      expect(bone.position.x).toBeCloseTo(2.5, 5);
    });

    it('alpha=0.25 偏向 idle', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const idle = makePosClip('Idle', 1.0, [0, 0, 0], [0, 0, 0]);
      const walk = makePosClip('Walk', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(idle, root);
      bindClip(walk, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 4, clip: walk });

      // speed=1, alpha = 1/4 = 0.25
      bs.update(1, 0.5);
      // idle t=0.5 → 0;walk t=0.5 → 5
      // 混合 0.75*0 + 0.25*5 = 1.25
      expect(bone.position.x).toBeCloseTo(1.25, 5);
    });

    it('越界 speed < min:只用 idle', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const idle = makePosClip('Idle', 1.0, [0, 0, 0], [0, 0, 0]);
      const walk = makePosClip('Walk', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(idle, root);
      bindClip(walk, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 2, clip: idle });
      bs.add({ speed: 4, clip: walk });

      // speed=0 < 2 → clamp 到 idle
      bs.update(0, 0.5);
      expect(bone.position.x).toBeCloseTo(0, 5);
    });

    it('越界 speed > max:只用 walk', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const idle = makePosClip('Idle', 1.0, [0, 0, 0], [0, 0, 0]);
      const walk = makePosClip('Walk', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(idle, root);
      bindClip(walk, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 2, clip: walk });

      // speed=10 > 2 → clamp 到 walk
      bs.update(10, 0.5);
      expect(bone.position.x).toBeCloseTo(5, 5);
    });
  });

  describe('Quaternion slerp 混合', () => {
    it('两个 quat clip:slerp 中点等于半角旋转', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      // idle: identity quat (0° rotation)
      const idle = makeQuatClip('Idle', 1.0, [0, 0, 0, 1], [0, 0, 0, 1]);
      // walk: 绕 Y 旋转 90° → quat [0, sin(45°), 0, cos(45°)] = [0, 0.7071, 0, 0.7071]
      const walk = makeQuatClip('Walk', 1.0, [0, 0, 0, 1], [0, 0.7071, 0, 0.7071]);
      bindClip(idle, root);
      bindClip(walk, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 2, clip: walk });

      // speed=1 → alpha=0.5, t=0.5
      // idle t=0.5 → identity (0° rotation)
      // walk t=0.5 → slerp(0°, 90°, 0.5) = 45° rotation → quat [0, sin(22.5°), 0, cos(22.5°)]
      // BlendSpace 再 slerp(identity, 45°Y, 0.5) = 22.5° rotation
      //   → quat [0, sin(11.25°), 0, cos(11.25°)]
      bs.update(1, 0.5);
      const sinHalf = Math.sin(Math.PI / 16); // sin(11.25°)
      const cosHalf = Math.cos(Math.PI / 16); // cos(11.25°)
      expect(bone.rotation.x).toBeCloseTo(0, 4);
      expect(bone.rotation.y).toBeCloseTo(sinHalf, 4);
      expect(bone.rotation.z).toBeCloseTo(0, 4);
      expect(bone.rotation.w).toBeCloseTo(cosHalf, 4);
    });

    it('两端的 quat clip:slerp 端点保持原值', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      // idle: identity
      const idle = makeQuatClip('Idle', 1.0, [0, 0, 0, 1], [0, 0, 0, 1]);
      // walk: 90°Y
      const walk = makeQuatClip('Walk', 1.0, [0, 0.7071, 0, 0.7071], [0, 0.7071, 0, 0.7071]);
      bindClip(idle, root);
      bindClip(walk, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 2, clip: walk });

      // speed=0 → alpha=0,只播 idle → identity
      bs.update(0, 0.5);
      expect(bone.rotation.w).toBeCloseTo(1, 4);

      // speed=2 → alpha=1,只播 walk → 90°Y
      bs.update(2, 0.5);
      expect(bone.rotation.y).toBeCloseTo(0.7071, 3);
      expect(bone.rotation.w).toBeCloseTo(0.7071, 3);
    });
  });

  describe('timeScale', () => {
    it('timeScale=2 让 playhead 推进两倍', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const idle = makePosClip('Idle', 1.0, [0, 0, 0], [0, 0, 0]);
      const run = makePosClip('Run', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(idle, root);
      bindClip(run, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 5, clip: run, timeScale: 2 });

      // 推进 0.3 秒,run 的 playhead = 0.3*2 = 0.6 → position.x = 6
      // speed=5 → alpha=1,只播 run
      bs.update(5, 0.3);
      expect(bone.position.x).toBeCloseTo(6, 5);
    });
  });

  describe('三样本 Idle→Walk→Run', () => {
    it('中间 speed 落在 Walk-Run bracket', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const idle = makePosClip('Idle', 1.0, [0, 0, 0], [0, 0, 0]);
      const walk = makePosClip('Walk', 1.0, [0, 0, 0], [4, 0, 0]);
      const run = makePosClip('Run', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(idle, root);
      bindClip(walk, root);
      bindClip(run, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 2, clip: walk });
      bs.add({ speed: 5, clip: run });

      // speed=3.5 → bracket [walk(2), run(5)], alpha = 1.5/3 = 0.5
      // t=0.5: walk → (2,0,0), run → (5,0,0)
      // 混合 0.5*2 + 0.5*5 = 3.5
      bs.update(3.5, 0.5);
      expect(bone.position.x).toBeCloseTo(3.5, 5);
    });

    it('speed 落在 Idle-Walk bracket', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const idle = makePosClip('Idle', 1.0, [0, 0, 0], [0, 0, 0]);
      const walk = makePosClip('Walk', 1.0, [0, 0, 0], [4, 0, 0]);
      const run = makePosClip('Run', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(idle, root);
      bindClip(walk, root);
      bindClip(run, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: idle });
      bs.add({ speed: 2, clip: walk });
      bs.add({ speed: 5, clip: run });

      // speed=1 → bracket [idle(0), walk(2)], alpha=0.5
      // t=0.5: idle → 0, walk → 2
      // 混合 0.5*0 + 0.5*2 = 1
      bs.update(1, 0.5);
      expect(bone.position.x).toBeCloseTo(1, 5);
    });
  });

  describe('API 行为', () => {
    it('add 重复 speed 覆盖旧 clip', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const clipA = makePosClip('A', 1.0, [0, 0, 0], [1, 0, 0]);
      const clipB = makePosClip('B', 1.0, [0, 0, 0], [99, 0, 0]);
      bindClip(clipA, root);
      bindClip(clipB, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip: clipA });
      expect(bs.size()).toBe(1);

      // 覆盖同 speed
      bs.add({ speed: 0, clip: clipB });
      expect(bs.size()).toBe(1);

      // 应该用 clipB 的值
      bs.update(0, 0.5);
      expect(bone.position.x).toBeCloseTo(49.5, 1); // 99*0.5
    });

    it('reset 清零所有 playhead', () => {
      const root = new Object3D();
      const bone = new Object3D();
      bone.name = 'Bone';
      root.add(bone);

      const clip = makePosClip('Idle', 1.0, [0, 0, 0], [10, 0, 0]);
      bindClip(clip, root);

      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      bs.add({ speed: 0, clip });

      bs.update(0, 0.7); // playhead = 0.7
      bs.reset();
      bs.update(0, 0); // playhead = 0
      expect(bone.position.x).toBeCloseTo(0, 5);
    });

    it('add 自动按 speed 升序排序', () => {
      const root = new Object3D();
      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);

      const c1 = makePosClip('A', 1, [0, 0, 0], [0, 0, 0]);
      const c2 = makePosClip('B', 1, [0, 0, 0], [0, 0, 0]);
      const c3 = makePosClip('C', 1, [0, 0, 0], [0, 0, 0]);
      bs.add({ speed: 5, clip: c3 });
      bs.add({ speed: 0, clip: c1 });
      bs.add({ speed: 2, clip: c2 });

      const list = bs.list();
      expect(list[0].speed).toBe(0);
      expect(list[1].speed).toBe(2);
      expect(list[2].speed).toBe(5);
    });

    it('空 BlendSpace.update 不抛错', () => {
      const root = new Object3D();
      const mixer = new AnimationMixer(root);
      const bs = new BlendSpace1D(mixer);
      expect(() => bs.update(1, 0.016)).not.toThrow();
    });
  });
});

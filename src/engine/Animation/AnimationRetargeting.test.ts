import { describe, it, expect } from 'vitest';
import {
  AnimationRetargeting,
  extractBindPose,
  type BindTransform,
} from './AnimationRetargeting';
import { AnimationClip } from './AnimationClip';
import {
  NumberKeyframeTrack,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
} from './KeyframeTrack';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

function makeBind(
  px: number, py: number, pz: number,
  qx = 0, qy = 0, qz = 0, qw = 1,
  sx = 1, sy = 1, sz = 1,
): BindTransform {
  return {
    position: new Vector3(px, py, pz),
    quaternion: new Quaternion(qx, qy, qz, qw),
    scale: new Vector3(sx, sy, sz),
  };
}

describe('AnimationRetargeting', () => {
  it('同名骨骼无映射表:直接按同名回退 retarget', () => {
    const srcBind = new Map([
      ['Hips', makeBind(0, 1, 0)],
      ['Spine', makeBind(0, 0.2, 0)],
    ]);
    // 目标骨骼更高
    const tgtBind = new Map([
      ['Hips', makeBind(0, 1.5, 0)],
      ['Spine', makeBind(0, 0.3, 0)],
    ]);

    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    const clip = new AnimationClip('walk', 1.0, [
      new VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 1.1, 0], 'linear'),
      new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1], 'slerp'),
    ]);

    const out = r.retarget(clip);
    expect(out.tracks.length).toBe(2);
    expect(out.tracks[0].name).toBe('Hips.position');
    expect(out.tracks[1].name).toBe('Hips.quaternion');
  });

  it('position 轨道按 rootScale 缩放 delta', () => {
    const srcBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Hips', makeBind(0, 2, 0)]]);
    // rootScale = 2/1 = 2
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    const clip = new AnimationClip('c', 1.0, [
      // bind pos 是 (0,1,0),动画值 (0,1.5,0) → delta = (0,0.5,0)
      // 目标 bind (0,2,0) + delta*2 = (0, 3, 0)
      new VectorKeyframeTrack('Hips.position', [0], [0, 1.5, 0], 'linear'),
    ]);
    const out = r.retarget(clip);
    const t = out.tracks[0] as VectorKeyframeTrack;
    expect(t.values[0]).toBeCloseTo(0, 5);
    expect(t.values[1]).toBeCloseTo(3, 5);
    expect(t.values[2]).toBeCloseTo(0, 5);
  });

  it('quaternion 轨道用 delta = anim * srcBind⁻¹ 再乘 tgtBind', () => {
    // srcBind 旋转 90° around Y, tgtBind 旋转 180° around Y
    const srcQ = new Quaternion().setFromEuler(0, Math.PI / 2, 0);
    const tgtQ = new Quaternion().setFromEuler(0, Math.PI, 0);
    const srcBind = new Map([['Bone', makeBind(0, 0, 0, srcQ.x, srcQ.y, srcQ.z, srcQ.w)]]);
    const tgtBind = new Map([['Bone', makeBind(0, 0, 0, tgtQ.x, tgtQ.y, tgtQ.z, tgtQ.w)]]);

    // 动画四元数 = srcBind(90°Y) → delta 应为单位四元数
    const animQ = srcQ.clone();
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    const clip = new AnimationClip('c', 1.0, [
      new QuaternionKeyframeTrack('Bone.quaternion', [0], [animQ.x, animQ.y, animQ.z, animQ.w], 'slerp'),
    ]);
    const out = r.retarget(clip);
    const t = out.tracks[0] as QuaternionKeyframeTrack;
    // delta = anim * srcBind⁻¹ = identity → out = identity * tgtBind = tgtBind
    expect(t.values[0]).toBeCloseTo(tgtQ.x, 5);
    expect(t.values[1]).toBeCloseTo(tgtQ.y, 5);
    expect(t.values[2]).toBeCloseTo(tgtQ.z, 5);
    expect(t.values[3]).toBeCloseTo(tgtQ.w, 5);
  });

  it('scale 轨道按 ratio 缩放', () => {
    const srcBind = new Map([['Bone', makeBind(0, 0, 0, 0, 0, 0, 1, 2, 2, 2)]]);
    const tgtBind = new Map([['Bone', makeBind(0, 0, 0, 0, 0, 0, 1, 4, 4, 4)]]);
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    const clip = new AnimationClip('c', 1.0, [
      // animScale (1,2,2) / srcBind (2,2,2) = (0.5,1,1) * tgtBind (4,4,4) = (2,4,4)
      new VectorKeyframeTrack('Bone.scale', [0], [1, 2, 2], 'linear'),
    ]);
    const out = r.retarget(clip);
    const t = out.tracks[0] as VectorKeyframeTrack;
    expect(t.values[0]).toBeCloseTo(2, 5);
    expect(t.values[1]).toBeCloseTo(4, 5);
    expect(t.values[2]).toBeCloseTo(4, 5);
  });

  it('boneMappings 重命名:源骨骼名 → 目标骨骼名', () => {
    const srcBind = new Map([['Hip', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Pelvis', makeBind(0, 1, 0)]]);
    const r = new AnimationRetargeting({
      sourceBind: srcBind,
      targetBind: tgtBind,
      boneMappings: [{ source: 'Hip', target: 'Pelvis' }],
    });
    const clip = new AnimationClip('c', 1.0, [
      new VectorKeyframeTrack('Hip.position', [0], [0, 1, 0], 'linear'),
    ]);
    const out = r.retarget(clip);
    expect(out.tracks[0].name).toBe('Pelvis.position');
  });

  it('无法映射的骨骼:轨道被丢弃', () => {
    const srcBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    const clip = new AnimationClip('c', 1.0, [
      new VectorKeyframeTrack('UnknownBone.position', [0], [0, 0, 0], 'linear'),
      new VectorKeyframeTrack('Hips.position', [0], [0, 1, 0], 'linear'),
    ]);
    const out = r.retarget(clip);
    expect(out.tracks.length).toBe(1);
    expect(out.tracks[0].name).toBe('Hips.position');
  });

  it('scalePosition=false:position 直接复制不缩放', () => {
    const srcBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Hips', makeBind(0, 2, 0)]]);
    const r = new AnimationRetargeting({
      sourceBind: srcBind,
      targetBind: tgtBind,
      scalePosition: false,
    });
    const clip = new AnimationClip('c', 1.0, [
      new VectorKeyframeTrack('Hips.position', [0], [0, 1.5, 0], 'linear'),
    ]);
    const out = r.retarget(clip);
    const t = out.tracks[0] as VectorKeyframeTrack;
    expect(t.values[1]).toBeCloseTo(1.5, 5);
  });

  it('NumberKeyframeTrack(rotation.x)重命名复制', () => {
    const srcBind = new Map([['Bone', makeBind(0, 0, 0)]]);
    const tgtBind = new Map([['BoneT', makeBind(0, 0, 0)]]);
    const r = new AnimationRetargeting({
      sourceBind: srcBind,
      targetBind: tgtBind,
      boneMappings: [{ source: 'Bone', target: 'BoneT' }],
    });
    const clip = new AnimationClip('c', 1.0, [
      new NumberKeyframeTrack('Bone.rotation.x', [0], [0.5], 'linear'),
    ]);
    const out = r.retarget(clip);
    expect(out.tracks[0].name).toBe('BoneT.rotation.x');
    expect((out.tracks[0] as NumberKeyframeTrack).values[0]).toBeCloseTo(0.5, 5);
  });

  it('events 被复制到新 clip', () => {
    const srcBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    const clip = new AnimationClip('c', 1.0, []);
    clip.addEvent({ time: 0.3, name: 'footstep' });
    const out = r.retarget(clip);
    expect(out.events.length).toBe(1);
    expect(out.events[0].name).toBe('footstep');
  });

  it('rootScaleOverride 显式覆盖自动缩放', () => {
    const srcBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Hips', makeBind(0, 2, 0)]]);
    const r = new AnimationRetargeting({
      sourceBind: srcBind,
      targetBind: tgtBind,
      rootScaleOverride: 1,
    });
    const clip = new AnimationClip('c', 1.0, [
      new VectorKeyframeTrack('Hips.position', [0], [0, 1.5, 0], 'linear'),
    ]);
    const out = r.retarget(clip);
    const t = out.tracks[0] as VectorKeyframeTrack;
    // delta = 1.5-1=0.5, scale=1 → 2+0.5=2.5
    expect(t.values[1]).toBeCloseTo(2.5, 5);
  });

  it('原 clip 不被修改(不可变性)', () => {
    const srcBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Hips', makeBind(0, 2, 0)]]);
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    const origValues = [0, 1.5, 0];
    const clip = new AnimationClip('c', 1.0, [
      new VectorKeyframeTrack('Hips.position', [0], origValues, 'linear'),
    ]);
    r.retarget(clip);
    expect(Array.from(clip.tracks[0].values)).toEqual([0, 1.5, 0]);
  });

  it('extractBindPose 从 bone 数组提取 bind pose', () => {
    const bones = [
      {
        name: 'Hips',
        position: { x: 0, y: 1, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      {
        name: 'Spine',
        position: { x: 0, y: 0.2, z: 0 },
        // 缺 quaternion 字段 → 用 rotation 回退
        rotation: { x: 0.1, y: 0, z: 0, w: 0.99 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ];
    const bind = extractBindPose(bones);
    expect(bind.size).toBe(2);
    expect(bind.get('Hips')!.position.y).toBe(1);
    expect(bind.get('Spine')!.quaternion.x).toBeCloseTo(0.1, 5);
  });

  it('缺 bind 数据时降级为重命名复制(同名)', () => {
    const srcBind = new Map<string, BindTransform>();
    const tgtBind = new Map<string, BindTransform>();
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    // 源/目标 bind 都为空 → 目标无对应骨骼(无法同名回退) → 轨道丢弃
    const clip = new AnimationClip('c', 1.0, [
      new VectorKeyframeTrack('Hips.position', [0], [0, 1, 0], 'linear'),
    ]);
    const out = r.retarget(clip);
    expect(out.tracks.length).toBe(0);
  });

  it('多 keyframe 位置轨道逐帧 retarget', () => {
    const srcBind = new Map([['Hips', makeBind(0, 1, 0)]]);
    const tgtBind = new Map([['Hips', makeBind(0, 2, 0)]]);
    const r = new AnimationRetargeting({ sourceBind: srcBind, targetBind: tgtBind });
    // 3 个 keyframe:0s → (0,1,0); 0.5s → (0,1.5,0); 1s → (0,1,0)
    const clip = new AnimationClip('c', 1.0, [
      new VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 1, 0, 0, 1.5, 0, 0, 1, 0], 'linear'),
    ]);
    const out = r.retarget(clip);
    const t = out.tracks[0] as VectorKeyframeTrack;
    // key0: delta=(0,0,0) → (0,2,0)
    expect(t.values[1]).toBeCloseTo(2, 5);
    // key1: delta=(0,0.5,0) *2 → (0,1,0) + (0,2,0) = (0,3,0)
    expect(t.values[4]).toBeCloseTo(3, 5);
    // key2: delta=(0,0,0) → (0,2,0)
    expect(t.values[7]).toBeCloseTo(2, 5);
  });
});

import { describe, it, expect } from 'vitest';
import { AnimationClip } from './AnimationClip';
import { VectorKeyframeTrack, QuaternionKeyframeTrack } from './KeyframeTrack';
import { AdditiveBlend } from './AdditiveBlend';

describe('AdditiveBlend', () => {
  describe('computeAdditiveBase', () => {
    it('subtracts ref for Vector3 tracks', () => {
      // position: (0,0,0) → (2,2,2), ref=[1,1,1]
      // delta: (-1,-1,-1) → (1,1,1)
      const track = new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 2, 2, 2]);
      const clip = new AnimationClip('test', 1, [track]);
      const ref = new Map([['Hips.position', [1, 1, 1]]]);
      const delta = AdditiveBlend.computeAdditiveBase(clip, ref);

      expect(delta.name).toBe('test_additive');
      expect(delta.tracks).toHaveLength(1);
      const dt = delta.tracks[0] as VectorKeyframeTrack;
      expect(dt.values[0]).toBeCloseTo(-1);
      expect(dt.values[1]).toBeCloseTo(-1);
      expect(dt.values[2]).toBeCloseTo(-1);
      expect(dt.values[3]).toBeCloseTo(1);
      expect(dt.values[4]).toBeCloseTo(1);
      expect(dt.values[5]).toBeCloseTo(1);
    });

    it('keeps tracks not in refPose unchanged', () => {
      const track = new VectorKeyframeTrack('Other.position', [0, 1], [1, 2, 3, 4, 5, 6]);
      const clip = new AnimationClip('test', 1, [track]);
      const ref = new Map<string, number[]>([]);
      const delta = AdditiveBlend.computeAdditiveBase(clip, ref);

      // track kept by reference (same values)
      expect(delta.tracks[0]).toBe(track);
    });

    it('computes quaternion delta as pose * refInv', () => {
      // clip: identity at t=0, 90° Y at t=1
      const track = new QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [
        0, 0, 0, 1,
        0, Math.SQRT1_2, 0, Math.SQRT1_2,
      ]);
      const clip = new AnimationClip('rot', 1, [track]);
      // ref = identity → delta = pose * identity = pose
      const ref = new Map([['Bone.quaternion', [0, 0, 0, 1]]]);
      const delta = AdditiveBlend.computeAdditiveBase(clip, ref);
      const dt = delta.tracks[0] as QuaternionKeyframeTrack;

      // delta == original since ref is identity
      expect(dt.values[0]).toBeCloseTo(0);
      expect(dt.values[1]).toBeCloseTo(0);
      expect(dt.values[2]).toBeCloseTo(0);
      expect(dt.values[3]).toBeCloseTo(1);
      expect(dt.values[4]).toBeCloseTo(0);
      expect(dt.values[5]).toBeCloseTo(Math.SQRT1_2);
      expect(dt.values[6]).toBeCloseTo(0);
      expect(dt.values[7]).toBeCloseTo(Math.SQRT1_2);
    });

    it('quaternion delta with non-identity ref yields rotation difference', () => {
      // clip at t=0 is identity; ref = 90° Y
      // delta = identity * refInv = conjugate(ref) = [0, -√2/2, 0, √2/2]
      const track = new QuaternionKeyframeTrack('Bone.quaternion', [0], [
        0, 0, 0, 1,
      ]);
      const clip = new AnimationClip('rot', 1, [track]);
      const ref = new Map([['Bone.quaternion', [0, Math.SQRT1_2, 0, Math.SQRT1_2]]]);
      const delta = AdditiveBlend.computeAdditiveBase(clip, ref);
      const dt = delta.tracks[0] as QuaternionKeyframeTrack;

      expect(dt.values[0]).toBeCloseTo(0);
      expect(dt.values[1]).toBeCloseTo(-Math.SQRT1_2);
      expect(dt.values[2]).toBeCloseTo(0);
      expect(dt.values[3]).toBeCloseTo(Math.SQRT1_2);
    });
  });

  describe('applyAdditive', () => {
    it('adds weighted delta to base', () => {
      const base = [1, 2, 3];
      const additive = [4, 5, 6];
      const out = AdditiveBlend.applyAdditive(base, additive, 0.5);
      // 1 + 4*0.5 = 3, 2 + 5*0.5 = 4.5, 3 + 6*0.5 = 6
      expect(out[0]).toBeCloseTo(3);
      expect(out[1]).toBeCloseTo(4.5);
      expect(out[2]).toBeCloseTo(6);
    });

    it('weight=0 leaves base unchanged', () => {
      const base = [1, 2, 3];
      const additive = [4, 5, 6];
      const out = AdditiveBlend.applyAdditive(base, additive, 0);
      expect(out[0]).toBeCloseTo(1);
      expect(out[1]).toBeCloseTo(2);
      expect(out[2]).toBeCloseTo(3);
    });

    it('weight=1 adds full delta', () => {
      const base = [1, 1, 1];
      const additive = [2, 3, 4];
      const out = AdditiveBlend.applyAdditive(base, additive, 1);
      expect(out[0]).toBeCloseTo(3);
      expect(out[1]).toBeCloseTo(4);
      expect(out[2]).toBeCloseTo(5);
    });

    it('writes to provided out array', () => {
      const base = [1, 2, 3];
      const additive = [1, 1, 1];
      const out = [0, 0, 0];
      const ret = AdditiveBlend.applyAdditive(base, additive, 0.5, out);
      expect(ret).toBe(out);
      expect(out[0]).toBeCloseTo(1.5);
      expect(out[1]).toBeCloseTo(2.5);
      expect(out[2]).toBeCloseTo(3.5);
    });
  });

  describe('applyAdditiveQuaternion', () => {
    it('weight=1 with identity base applies full delta', () => {
      const base = [0, 0, 0, 1]; // identity
      const delta = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90° Y
      const out = AdditiveBlend.applyAdditiveQuaternion(base, delta, 1);
      expect(out[0]).toBeCloseTo(0);
      expect(out[1]).toBeCloseTo(Math.SQRT1_2);
      expect(out[2]).toBeCloseTo(0);
      expect(out[3]).toBeCloseTo(Math.SQRT1_2);
    });

    it('weight=0 leaves base unchanged', () => {
      const base = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90° Y
      const delta = [0, 1, 0, 0]; // 180° X
      const out = AdditiveBlend.applyAdditiveQuaternion(base, delta, 0);
      expect(out[0]).toBeCloseTo(0);
      expect(out[1]).toBeCloseTo(Math.SQRT1_2);
      expect(out[2]).toBeCloseTo(0);
      expect(out[3]).toBeCloseTo(Math.SQRT1_2);
    });

    it('identity delta leaves base unchanged at any weight', () => {
      const base = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
      const delta = [0, 0, 0, 1]; // identity
      const out = AdditiveBlend.applyAdditiveQuaternion(base, delta, 0.5);
      expect(out[0]).toBeCloseTo(0);
      expect(out[1]).toBeCloseTo(Math.SQRT1_2);
      expect(out[2]).toBeCloseTo(0);
      expect(out[3]).toBeCloseTo(Math.SQRT1_2);
    });
  });
});

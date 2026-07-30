// RootMotion tests — covers first-frame seeding, position/rotation extraction,
// horizontalOnly clamping, scale, accumulation, consume/reset, disabled no-op,
// and bone write-back (keeps the root bone planted).

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { RootMotionExtractor } from './RootMotion';

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const HALF_PI = Math.PI / 2;
const SQRT1_2 = Math.SQRT1_2;

function yaw(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(Y, angle);
}

describe('RootMotionExtractor', () => {
  it('1. first-frame produces no delta', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(1, 2, 3), yaw(HALF_PI));
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0);
    expect(d.position.y).toBeCloseTo(0);
    expect(d.position.z).toBeCloseTo(0);
    expect(d.rotation.x).toBeCloseTo(0);
    expect(d.rotation.y).toBeCloseTo(0);
    expect(d.rotation.z).toBeCloseTo(0);
    expect(d.rotation.w).toBeCloseTo(1);
  });

  it('2. linear forward motion yields delta.x = dx * scale', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(0, 0, 0), new Quaternion()); // seed prev
    rm.extract(new Vector3(0.1, 0, 0), new Quaternion());
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0.1);
    expect(d.position.y).toBeCloseTo(0);
    expect(d.position.z).toBeCloseTo(0);
  });

  it('3. horizontalOnly zeros the Y component', () => {
    const rm = new RootMotionExtractor(); // horizontalOnly defaults to true
    rm.extract(new Vector3(0, 0, 0), new Quaternion());
    rm.extract(new Vector3(0.1, 0.2, 0.05), new Quaternion());
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0.1);
    expect(d.position.y).toBeCloseTo(0);
    expect(d.position.z).toBeCloseTo(0.05);
  });

  it('4. scale multiplier amplifies the delta', () => {
    const rm = new RootMotionExtractor({ scale: 2 });
    rm.extract(new Vector3(0, 0, 0), new Quaternion());
    rm.extract(new Vector3(0.1, 0, 0), new Quaternion());
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0.2);
  });

  it('5. rotation delta is yaw when rotating around Y', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(), new Quaternion()); // prev = identity
    rm.extract(new Vector3(), yaw(HALF_PI));     // current = 90° Y
    const d = rm.peekDelta();
    expect(d.rotation.x).toBeCloseTo(0);
    expect(d.rotation.y).toBeCloseTo(SQRT1_2);
    expect(d.rotation.z).toBeCloseTo(0);
    expect(d.rotation.w).toBeCloseTo(SQRT1_2);
  });

  it('6. horizontalOnly clamps rotation to yaw (pitch removed)', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(), new Quaternion()); // prev = identity
    rm.extract(new Vector3(), new Quaternion().setFromAxisAngle(X, HALF_PI)); // 90° X
    const d = rm.peekDelta();
    expect(d.rotation.x).toBeCloseTo(0);
    expect(d.rotation.y).toBeCloseTo(0);
    expect(d.rotation.z).toBeCloseTo(0);
    expect(d.rotation.w).toBeCloseTo(1);
  });

  it('7. consumeDelta clears the accumulator', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(0, 0, 0), new Quaternion());
    rm.extract(new Vector3(0.1, 0, 0), new Quaternion());
    rm.consumeDelta();
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0);
    expect(d.position.y).toBeCloseTo(0);
    expect(d.position.z).toBeCloseTo(0);
    expect(d.rotation.x).toBeCloseTo(0);
    expect(d.rotation.y).toBeCloseTo(0);
    expect(d.rotation.z).toBeCloseTo(0);
    expect(d.rotation.w).toBeCloseTo(1);
  });

  it('8. reset clears state so the next extract yields no delta', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(0, 0, 0), new Quaternion());
    rm.extract(new Vector3(0.1, 0, 0), new Quaternion());
    rm.reset();
    rm.extract(new Vector3(0.5, 0, 0), new Quaternion()); // re-seeds prev, no delta
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0);
    expect(d.rotation.w).toBeCloseTo(1);
  });

  it('9. disabled makes extract a no-op', () => {
    const rm = new RootMotionExtractor({ enabled: false });
    let setterCalls = 0;
    rm.extract(new Vector3(0.1, 0, 0), new Quaternion(), () => { setterCalls++; });
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0);
    expect(d.rotation.w).toBeCloseTo(1);
    expect(setterCalls).toBe(0);
  });

  it('10. boneSetter is called with the previous transform (keeps bone planted)', () => {
    const rm = new RootMotionExtractor();
    const seedPos = new Vector3(1, 0, 0);
    const seedRot = yaw(HALF_PI);
    rm.extract(seedPos, seedRot); // seed prev
    let capturedPos: Vector3 | null = null;
    let capturedRot: Quaternion | null = null;
    rm.extract(new Vector3(2, 0, 0), yaw(Math.PI), (p, r) => {
      capturedPos = p;
      capturedRot = r;
    });
    expect(capturedPos).not.toBeNull();
    expect(capturedRot).not.toBeNull();
    expect(capturedPos!.x).toBeCloseTo(1);            // previous position
    expect(capturedRot!.y).toBeCloseTo(SQRT1_2);      // previous rotation = 90° Y
    expect(capturedRot!.w).toBeCloseTo(SQRT1_2);
  });

  it('11. multiple extracts accumulate position', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(0, 0, 0), new Quaternion());
    rm.extract(new Vector3(0.1, 0, 0), new Quaternion());
    rm.extract(new Vector3(0.2, 0, 0), new Quaternion());
    const d = rm.peekDelta();
    expect(d.position.x).toBeCloseTo(0.2);
    expect(d.position.y).toBeCloseTo(0);
    expect(d.position.z).toBeCloseTo(0);
  });

  it('12. multiple extracts accumulate rotation to 180° Y', () => {
    const rm = new RootMotionExtractor();
    rm.extract(new Vector3(), new Quaternion()); // prev = identity
    rm.extract(new Vector3(), yaw(HALF_PI));     // +90° Y
    rm.extract(new Vector3(), yaw(Math.PI));     // +90° Y (180 - 90)
    const d = rm.peekDelta();
    expect(d.rotation.x).toBeCloseTo(0);
    expect(d.rotation.y).toBeCloseTo(1);
    expect(d.rotation.z).toBeCloseTo(0);
    expect(d.rotation.w).toBeCloseTo(0);
  });
});

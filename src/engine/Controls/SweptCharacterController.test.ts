import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { BoxShape } from '../Shapes/BoxShape';
import { SphereShape } from '../Shapes/SphereShape';
import { CapsuleShape } from '../Shapes/CapsuleShape';
import {
  SweptCharacterController,
  sweepCapsule,
  type ColliderProvider,
  type SweepHit,
} from './SweptCharacterController';

/** Provider that returns every shape regardless of the AABB query. */
function makeProvider(shapes: Array<{ shape: any; id?: string }>): ColliderProvider {
  return {
    queryAabb() {
      return shapes;
    },
  };
}

describe('SweptCharacterController', () => {
  it('constructor sets position and creates a capsule shape', () => {
    const pos = new Vector3(1, 2, 3);
    const cc = new SweptCharacterController(pos, { radius: 0.5, halfHeight: 0.7 });
    expect(cc.position.equals(new Vector3(1, 2, 3))).toBe(true);
    expect(cc.shape).toBeInstanceOf(CapsuleShape);
    expect(cc.shape.radius).toBe(0.5);
    expect(cc.shape.halfHeight).toBe(0.7);
    // velocity defaults to zero, onGround false.
    expect(cc.velocity.equals(new Vector3(0, 0, 0))).toBe(true);
    expect(cc.isOnGround()).toBe(false);
  });

  it('move with no collider provider: moves fully, blocked=false, no hits', () => {
    const cc = new SweptCharacterController(new Vector3(0, 0, 0));
    const res = cc.move(new Vector3(2, 0, 0));
    expect(res.blocked).toBe(false);
    expect(res.hits.length).toBe(0);
    expect(res.movedDistance).toBeCloseTo(2, 5);
    expect(res.finalPosition.equals(new Vector3(2, 0, 0))).toBe(true);
  });

  it('move with empty collider list: moves fully, blocked=false', () => {
    const cc = new SweptCharacterController(new Vector3(0, 0, 0));
    cc.setColliderProvider(makeProvider([]));
    const res = cc.move(new Vector3(3, 0, 0));
    expect(res.blocked).toBe(false);
    expect(res.hits.length).toBe(0);
    expect(res.movedDistance).toBeCloseTo(3, 5);
    expect(res.finalPosition.x).toBeCloseTo(3, 5);
  });

  it('move into a wall (box shape): blocked, stops before wall', () => {
    // Wall: x in [2, 4], full height/depth. Capsule radius 0.4 + skin 0.08 = 0.48.
    const wall = new BoxShape(new Vector3(2, -5, -5), new Vector3(4, 5, 5));
    const cc = new SweptCharacterController(new Vector3(0, 0, 0), {
      radius: 0.4,
      halfHeight: 0.6,
      skinWidth: 0.08,
    });
    cc.setColliderProvider(makeProvider([{ shape: wall, id: 'wall' }]));
    const res = cc.move(new Vector3(5, 0, 0));
    expect(res.blocked).toBe(true);
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.movedDistance).toBeLessThan(5);
    // Capsule center stops at x = 2 - 0.48 = 1.52 (minus epsilon).
    expect(res.finalPosition.x).toBeLessThan(2);
    expect(res.finalPosition.x).toBeGreaterThan(1.4);
  });

  it('move sliding along a wall (45° into wall): slides, movedDistance > 0', () => {
    // Wall at x in [1, 3]. Capsule starts at (-2, 0, 0), moves (+x, +z).
    const wall = new BoxShape(new Vector3(1, -5, -5), new Vector3(3, 5, 5));
    const cc = new SweptCharacterController(new Vector3(-2, 0, 0), {
      radius: 0.4,
      halfHeight: 0.6,
      skinWidth: 0.08,
      maxSlides: 3,
    });
    cc.setColliderProvider(makeProvider([{ shape: wall }]));
    const res = cc.move(new Vector3(4, 0, 4));
    expect(res.blocked).toBe(true);
    expect(res.movedDistance).toBeGreaterThan(4); // slid a significant distance
    expect(res.movedDistance).toBeLessThan(Math.hypot(4, 4)); // less than full request
    // Did not pass through the wall.
    expect(res.finalPosition.x).toBeLessThan(1);
    // Slid along +Z (positive z progress).
    expect(res.finalPosition.z).toBeGreaterThan(3);
  });

  it('move with maxSlides=0: stops on first hit, no sliding', () => {
    const wall = new BoxShape(new Vector3(1, -5, -5), new Vector3(3, 5, 5));
    const cc = new SweptCharacterController(new Vector3(-2, 0, 0), {
      radius: 0.4,
      halfHeight: 0.6,
      skinWidth: 0.08,
      maxSlides: 0,
    });
    cc.setColliderProvider(makeProvider([{ shape: wall }]));
    const res = cc.move(new Vector3(4, 0, 4));
    expect(res.hits.length).toBe(1);
    expect(res.movedDistance).toBeLessThan(4); // did not slide
    expect(res.movedDistance).toBeGreaterThan(3);
    // Did not slide along Z beyond the first contact's z.
    expect(res.finalPosition.z).toBeLessThan(3);
  });

  it('move onto a floor (box below): onGround=true after move', () => {
    // Floor: top at y=0. Capsule starts above and falls.
    const floor = new BoxShape(new Vector3(-5, -5, -5), new Vector3(5, 0, 5));
    const cc = new SweptCharacterController(new Vector3(0, 2, 0), {
      radius: 0.4,
      halfHeight: 0.6,
      skinWidth: 0.08,
    });
    cc.setColliderProvider(makeProvider([{ shape: floor }]));
    const res = cc.move(new Vector3(0, -3, 0));
    expect(cc.isOnGround()).toBe(true);
    expect(res.blocked).toBe(true);
    // Capsule center stops at y = 0 + 0.48 + 0.6 = 1.08 (bottom sphere on floor).
    expect(res.finalPosition.y).toBeGreaterThan(0.9);
    expect(res.finalPosition.y).toBeLessThan(1.3);
  });

  it('move into a steep surface (vertical wall with up-delta): does not climb', () => {
    // Vertical wall = steep (normal horizontal, not walkable).
    // Delta moves up-and-into the wall; the slide up-component must be zeroed.
    const wall = new BoxShape(new Vector3(1, -5, -5), new Vector3(3, 5, 5));
    const cc = new SweptCharacterController(new Vector3(-3, 0, 0), {
      radius: 0.4,
      halfHeight: 0.6,
      skinWidth: 0.08,
      maxSlopeAngle: 0.785, // ~45°
      maxSlides: 3,
    });
    cc.setColliderProvider(makeProvider([{ shape: wall }]));
    const res = cc.move(new Vector3(5, 1, 0));
    // Wall is steep — not walkable.
    expect(cc.isOnGround()).toBe(false);
    expect(res.blocked).toBe(true);
    // Stopped before the wall.
    expect(res.finalPosition.x).toBeLessThan(1);
    // Did not climb to the full up-delta (slide up-component zeroed).
    // Full climb would be ~1.0; advance-only climb is ~0.70.
    expect(res.finalPosition.y).toBeLessThan(0.85);
  });

  it('move down-and-into a steep surface: slides down (downward component preserved)', () => {
    // Same vertical wall (steep). Delta moves down-and-into the wall; the
    // downward slide component must NOT be zeroed (only positive up-components
    // are zeroed on steep surfaces), so the controller slides down along the wall.
    const wall = new BoxShape(new Vector3(1, -5, -5), new Vector3(3, 5, 5));
    const cc = new SweptCharacterController(new Vector3(-3, 5, 0), {
      radius: 0.4,
      halfHeight: 0.6,
      skinWidth: 0.08,
      maxSlopeAngle: 0.785,
      maxSlides: 3,
    });
    cc.setColliderProvider(makeProvider([{ shape: wall }]));
    const res = cc.move(new Vector3(5, -2, 0));
    expect(cc.isOnGround()).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.finalPosition.x).toBeLessThan(1); // stopped before wall
    // The advance reaches y ≈ 3.59; the downward slide carries it to ≈ 3.0.
    // If the downward component had been (incorrectly) zeroed, y would stay ≈ 3.6.
    expect(res.finalPosition.y).toBeLessThan(3.3);
    expect(res.movedDistance).toBeGreaterThan(4);
  });

  it('moveWithVelocity applies delta = velocity * dt (no gravity)', () => {
    const cc = new SweptCharacterController(new Vector3(0, 0, 0), {
      applyGravity: false,
    });
    const res = cc.moveWithVelocity(new Vector3(1, 0, 0), 2);
    expect(res.finalPosition.x).toBeCloseTo(2, 5);
    expect(res.movedDistance).toBeCloseTo(2, 5);
    expect(res.blocked).toBe(false);
    // Velocity is not modified when applyGravity is false.
    expect(cc.velocity.equals(new Vector3(0, 0, 0))).toBe(true);
  });

  it('teleport sets position and clears velocity', () => {
    const cc = new SweptCharacterController(new Vector3(0, 0, 0));
    cc.velocity.set(5, 5, 5);
    cc.onGround = true;
    cc.teleport(new Vector3(10, 20, 30));
    expect(cc.position.equals(new Vector3(10, 20, 30))).toBe(true);
    expect(cc.velocity.equals(new Vector3(0, 0, 0))).toBe(true);
    expect(cc.isOnGround()).toBe(false);
  });

  it('setDimensions updates the capsule', () => {
    const cc = new SweptCharacterController(new Vector3(0, 0, 0), {
      radius: 0.4,
      halfHeight: 0.6,
    });
    cc.setDimensions(0.6, 0.9);
    expect(cc.shape.radius).toBe(0.6);
    expect(cc.shape.halfHeight).toBe(0.9);
  });

  it('SweepHit has distance/point/normal', () => {
    const capsule = new CapsuleShape(new Vector3(0, 0, 0), 0.4, 0.6);
    const sphere = new SphereShape(new Vector3(5, -0.6, 0), 1);
    const hit: SweepHit | null = sweepCapsule(capsule, new Vector3(10, 0, 0), [{ shape: sphere }]);
    expect(hit).not.toBeNull();
    expect(typeof hit!.distance).toBe('number');
    expect(hit!.point).toBeInstanceOf(Vector3);
    expect(hit!.normal).toBeInstanceOf(Vector3);
  });
});

describe('sweepCapsule helper', () => {
  it('hits a sphere and returns distance/point/normal', () => {
    // Capsule at origin (halfHeight 0.6, radius 0.4). Sphere collider at the
    // bottom-sphere height (y = -0.6) so the bottom test sphere hits exactly
    // at distance = 5 - (0.4 + 1) = 3.6, normal = (-1, 0, 0).
    const capsule = new CapsuleShape(new Vector3(0, 0, 0), 0.4, 0.6);
    const sphere = new SphereShape(new Vector3(5, -0.6, 0), 1);
    const hit = sweepCapsule(capsule, new Vector3(10, 0, 0), [{ shape: sphere, id: 's1' }]);
    expect(hit).not.toBeNull();
    expect(hit!.colliderId).toBe('s1');
    expect(hit!.distance).toBeCloseTo(3.6, 2);
    // Normal points from the sphere toward the capsule (negative x).
    expect(hit!.normal.x).toBeCloseTo(-1, 2);
    expect(hit!.normal.y).toBeCloseTo(0, 2);
    expect(hit!.normal.z).toBeCloseTo(0, 2);
    // Hit point is the swept sphere center at contact.
    expect(hit!.point.x).toBeCloseTo(3.6, 2);
    expect(hit!.point.y).toBeCloseTo(-0.6, 2);
  });

  it('misses when shapes are far away → returns null', () => {
    const capsule = new CapsuleShape(new Vector3(0, 0, 0), 0.4, 0.6);
    const sphere = new SphereShape(new Vector3(100, 0, 0), 1);
    const hit = sweepCapsule(capsule, new Vector3(1, 0, 0), [{ shape: sphere }]);
    expect(hit).toBeNull();
  });

  it('returns the nearest hit across multiple shapes', () => {
    const capsule = new CapsuleShape(new Vector3(0, 0, 0), 0.4, 0.6);
    const near = new SphereShape(new Vector3(3, -0.6, 0), 0.5);
    const far = new SphereShape(new Vector3(8, -0.6, 0), 0.5);
    const hit = sweepCapsule(capsule, new Vector3(20, 0, 0), [
      { shape: far, id: 'far' },
      { shape: near, id: 'near' },
    ]);
    expect(hit).not.toBeNull();
    expect(hit!.colliderId).toBe('near');
    // Near sphere: distance = 3 - (0.4 + 0.5) = 2.1.
    expect(hit!.distance).toBeCloseTo(2.1, 2);
  });

  it('returns null for an empty shape list', () => {
    const capsule = new CapsuleShape(new Vector3(0, 0, 0), 0.4, 0.6);
    const hit = sweepCapsule(capsule, new Vector3(5, 0, 0), []);
    expect(hit).toBeNull();
  });

  it('hits a box and returns a face normal', () => {
    // Box at x in [2, 4]. Capsule moving +x. Inflated entry at x = 2 - 0.4 = 1.6.
    const capsule = new CapsuleShape(new Vector3(0, 0, 0), 0.4, 0.6);
    const box = new BoxShape(new Vector3(2, -5, -5), new Vector3(4, 5, 5));
    const hit = sweepCapsule(capsule, new Vector3(5, 0, 0), [{ shape: box }]);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(1.6, 2);
    expect(hit!.normal.x).toBeCloseTo(-1, 2);
  });
});

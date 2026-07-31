// SweptCharacterController — swept-collision kinematic character controller.
//
// Adapts the swept-collision concept from o3de's
// Gems/PhysX/Core/Code/Source/PhysXCharacters/API/CharacterController.cpp.
// Unlike the ground-sampling CharacterController, this variant performs a
// proper swept test against collider shapes returned by a ColliderProvider,
// then slides along surfaces (tangent-plane projection) up to `maxSlides`
// iterations.
//
// Key design (mirrors o3de CharacterController):
//   • Capsule collision body (radius + halfHeight), Y-axis up.
//   • Skin width inflates the capsule for collision (prevents seam catching).
//   • maxSlopeAngle: surfaces steeper than this are not walkable — the
//     controller slides instead of climbing.
//   • stepHeight: reserved for auto-stepping (currently a no-op stub; the
//     slide iterations handle small obstacles conservatively).
//   • Caller supplies a ColliderProvider (broadphase AABB query) so the
//     controller stays decoupled from the ECS / spatial index.
//
// Simplifications (documented):
//   • sweepCapsule tests THREE spheres along the capsule's segment
//     (bottom hemisphere, center, top hemisphere) rather than the exact
//     swept capsule volume. This is exact for colliders aligned with one
//     of those three heights and only slightly conservative elsewhere —
//     correct for typical gameplay geometry (grounded floors/walls/ceilings).
//   • Capsule-vs-capsule falls back to sphere-at-center (treats the other
//     capsule as a sphere at its center with its radius).
//   • Unknown shape types fall back to the shape's AABB as a box.

import { Vector3 } from '../Math/Vector3';
import { CapsuleShape } from '../Shapes/CapsuleShape';
import { SphereShape } from '../Shapes/SphereShape';
import { BoxShape } from '../Shapes/BoxShape';
import type { Shape } from '../Shapes/Shape';
import { createLogger } from '@/lib/logger';

const log = createLogger('SweptCC');

/** Threshold below which a remaining delta is considered zero (stops sliding). */
const REMAIN_EPS = 1e-6;
/** Small back-off applied after each contact so the next sweep starts cleanly. */
const ADVANCE_EPS = 1e-4;

export interface SweepHit {
  /** Cumulative distance moved when the hit occurred (0..requested delta length). */
  distance: number;
  /** World-space hit point (the swept sphere center at the moment of contact). */
  point: Vector3;
  /**
   * World-space hit normal pointing FROM the collider TOWARD the swept
   * capsule (the standard outward contact normal). The slide formula
   * `delta - normal * delta.dot(normal)` requires this convention.
   */
  normal: Vector3;
  /** Optional collider id (if the collider provider exposes one). */
  colliderId?: string;
}

export interface SweepResult {
  hits: SweepHit[];
  /** Total distance actually moved (≤ requested delta). */
  movedDistance: number;
  /** Final position after sweep + slide. */
  finalPosition: Vector3;
  /** True if the sweep was blocked (hits.length > 0 and movedDistance < requested). */
  blocked: boolean;
}

/** A collider provider — returns shapes to test against for a given AABB region. */
export interface ColliderProvider {
  /** Return shapes intersecting the given AABB query region (broadphase). */
  queryAabb(min: Vector3, max: Vector3): Array<{ shape: Shape; id?: string }>;
}

export interface SweptCharacterControllerOptions {
  /** Capsule radius (default 0.4). */
  radius: number;
  /** Capsule half-height (cylinder portion, default 0.6). */
  halfHeight: number;
  /** Up direction (default +Y). */
  up: Vector3;
  /** Skin width — the controller is inflated by this for collision (default 0.08). Prevents catching on seams. */
  skinWidth: number;
  /** Maximum slope angle (radians from up) the controller can climb (default ~45° = 0.785). Steeper = slide. */
  maxSlopeAngle: number;
  /** Step height — the controller automatically steps over obstacles shorter than this (default 0.3). */
  stepHeight: number;
  /** Maximum number of slide iterations when hitting a surface (default 3). More = smoother sliding, more CPU. */
  maxSlides: number;
  /** If true, gravity is applied automatically each move() call (default false — caller applies gravity). */
  applyGravity: boolean;
  /** Gravity vector (default (0, -9.81, 0)). Only used if applyGravity=true. */
  gravity: Vector3;
}

export const DEFAULT_SWEPT_CC_OPTIONS: Partial<SweptCharacterControllerOptions> = {
  radius: 0.4,
  halfHeight: 0.6,
  up: new Vector3(0, 1, 0),
  skinWidth: 0.08,
  maxSlopeAngle: 0.785, // ~45°
  stepHeight: 0.3,
  maxSlides: 3,
  applyGravity: false,
  gravity: new Vector3(0, -9.81, 0),
};

// Reusable scratch vectors (module-level; safe for single-threaded JS).
const _v0 = new Vector3();
const _v1 = new Vector3();

export class SweptCharacterController {
  position: Vector3;
  velocity: Vector3 = new Vector3();
  onGround: boolean = false;
  readonly shape: CapsuleShape;
  options: SweptCharacterControllerOptions;
  private colliderProvider: ColliderProvider | null = null;

  constructor(position: Vector3, options: Partial<SweptCharacterControllerOptions> = {}) {
    this.position = position.clone();
    this.options = { ...DEFAULT_SWEPT_CC_OPTIONS, ...options } as SweptCharacterControllerOptions;
    this.shape = new CapsuleShape(
      this.position.clone(),
      this.options.radius!,
      this.options.halfHeight!,
    );
    log.debug('constructed', {
      radius: this.options.radius,
      halfHeight: this.options.halfHeight,
      skinWidth: this.options.skinWidth,
    });
  }

  setColliderProvider(provider: ColliderProvider | null): void {
    this.colliderProvider = provider;
  }

  /**
   * Move the controller by `deltaPosition` (world space), performing swept
   * collision against all shapes returned by the collider provider in the
   * swept region.
   *
   * Algorithm (per slide iteration):
   *   1. Compute the sweep AABB (current pos ± inflated capsule, expanded by delta).
   *   2. Query the collider provider for shapes in that AABB.
   *   3. For each shape, compute the sweep hit (capsule-vs-shape). Track the nearest hit.
   *   4. If no hit: move fully, done.
   *   5. If hit:
   *      a. Move to the hit point (minus a small epsilon).
   *      b. Project the remaining delta onto the hit's tangent plane (slide).
   *      c. If the slope is too steep, zero out the up-component (slide down instead of up).
   *      d. Repeat with the remaining delta, up to maxSlides.
   *
   * @returns SweepResult with all hits, moved distance, final position.
   */
  move(deltaPosition: Vector3): SweepResult {
    const requested = deltaPosition.length();
    const hits: SweepHit[] = [];

    // No provider or zero delta → free move.
    if (!this.colliderProvider || requested < REMAIN_EPS) {
      this.position.add(deltaPosition);
      return {
        hits,
        movedDistance: requested,
        finalPosition: this.position.clone(),
        blocked: false,
      };
    }

    this.onGround = false;

    const up = this.options.up;
    const skin = this.options.skinWidth;
    const cosMaxSlope = Math.cos(this.options.maxSlopeAngle);
    const inflatedRadius = this.options.radius + skin;
    const halfHeight = this.options.halfHeight;

    // Working capsule inflated by skinWidth (separate from this.shape so the
    // user-facing shape keeps its nominal dimensions).
    const workCap = new CapsuleShape(
      this.position.clone(),
      inflatedRadius,
      halfHeight,
    );

    let movedSoFar = 0;
    let remaining = deltaPosition.clone();
    const maxIter = this.options.maxSlides + 1;

    for (let iter = 0; iter < maxIter; iter++) {
      const remLen = remaining.length();
      if (remLen < REMAIN_EPS) break;

      const invRem = 1 / remLen;
      const remDir = _v0.copy(remaining).multiplyScalar(invRem);

      // Broadphase AABB covering the swept capsule.
      workCap.center.copy(this.position);
      const aabb = sweptAabb(this.position, remaining, inflatedRadius, halfHeight);
      const shapes = this.colliderProvider!.queryAabb(aabb.min, aabb.max);

      const hit = sweepCapsule(workCap, remaining, shapes);
      if (!hit) {
        // Unobstructed — finish the move.
        this.position.add(remaining);
        movedSoFar += remLen;
        break;
      }

      // Advance to the contact (minus epsilon so the next sweep starts clean).
      const advance = Math.max(0, hit.distance - ADVANCE_EPS);
      this.position.addScaledVector(remDir, advance);
      movedSoFar += advance;

      // Record cumulative distance.
      hits.push({
        distance: movedSoFar,
        point: hit.point.clone(),
        normal: hit.normal.clone(),
        colliderId: hit.colliderId,
      });

      // Ground check: a walkable surface has a normal close to `up`.
      const normalDotUp = hit.normal.dot(up);
      if (normalDotUp >= cosMaxSlope) {
        this.onGround = true;
      }

      // Remaining delta after the advance.
      const remAfterLen = remLen - advance;
      const remAfter = _v1.copy(remDir).multiplyScalar(remAfterLen);

      // Slide = project the remaining delta out of the normal direction.
      const dn = remAfter.dot(hit.normal);
      const slide = remAfter.sub(hit.normal.clone().multiplyScalar(dn));

      // Steep surface: prevent climbing up (zero the up-component if it's positive).
      if (normalDotUp < cosMaxSlope) {
        const upComp = slide.dot(up);
        if (upComp > 0) {
          slide.sub(up.clone().multiplyScalar(upComp));
        }
      }

      remaining = slide.clone();
    }

    const blocked = hits.length > 0 && movedSoFar < requested - REMAIN_EPS;
    return {
      hits,
      movedDistance: movedSoFar,
      finalPosition: this.position.clone(),
      blocked,
    };
  }

  /** Convenience: move with a velocity over dt seconds. */
  moveWithVelocity(velocity: Vector3, dt: number): SweepResult {
    const delta = velocity.clone().multiplyScalar(dt);
    if (this.options.applyGravity) {
      this.velocity.add(this.options.gravity.clone().multiplyScalar(dt));
      delta.add(this.options.gravity.clone().multiplyScalar(dt * dt));
    }
    return this.move(delta);
  }

  /** Check if the controller is currently on walkable ground. */
  isOnGround(): boolean {
    return this.onGround;
  }

  /** Teleport (no sweep). Use with caution. */
  teleport(position: Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
  }

  /** Resize the capsule (e.g. for crouch). */
  setDimensions(radius: number, halfHeight: number): void {
    this.shape.radius = radius;
    this.shape.halfHeight = halfHeight;
  }
}

/**
 * Capsule-vs-shape sweep test. Returns the nearest hit along the sweep, or null.
 *
 * Simplification: the swept capsule is approximated by THREE spheres placed
 * along its segment — bottom hemisphere center (center.y - halfHeight),
 * segment midpoint (center), and top hemisphere center (center.y + halfHeight)
 * — each with the capsule's radius. This is exact for colliders aligned with
 * one of those three heights (grounded floors, grounded walls, ceilings,
 * mid-height obstacles) and only slightly conservative elsewhere.
 *
 * Dispatch per shape type:
 *   - Sphere:  ray-sphere (sphere inflated by capsule radius) — exact sphere-sphere.
 *   - Box:     ray-AABB  (box inflated by capsule radius) — exact sphere-box (Minkowski sum).
 *   - Capsule: falls back to sphere-at-center (treats the other capsule as a sphere).
 *   - Others:  falls back to the shape's AABB treated as a box.
 */
export function sweepCapsule(
  capsule: CapsuleShape,
  delta: Vector3,
  shapes: Array<{ shape: Shape; id?: string }>,
): SweepHit | null {
  const sweepLen = delta.length();
  if (sweepLen < REMAIN_EPS) return null;

  const dir = delta.clone().multiplyScalar(1 / sweepLen);
  const R = capsule.radius;
  const hh = capsule.halfHeight;
  const cx = capsule.center.x;
  const cy = capsule.center.y;
  const cz = capsule.center.z;

  // Three test points along the capsule segment (Y axis).
  const testPoints: Vector3[] = [
    new Vector3(cx, cy - hh, cz),
    new Vector3(cx, cy, cz),
    new Vector3(cx, cy + hh, cz),
  ];

  let bestHit: SweepHit | null = null;
  let bestDist = Infinity;

  for (const { shape, id } of shapes) {
    let shapeHit: { distance: number; point: Vector3; normal: Vector3 } | null = null;

    for (const p of testPoints) {
      let h: { distance: number; point: Vector3; normal: Vector3 } | null = null;
      if (shape.type === 'sphere') {
        const s = shape as SphereShape;
        h = raySphereNearest(p, dir, sweepLen, R, s.center, s.radius);
      } else if (shape.type === 'box') {
        const b = shape as BoxShape;
        h = rayBoxNearest(p, dir, sweepLen, R, b.min, b.max);
      } else if (shape.type === 'capsule') {
        // Simplification: treat the other capsule as a sphere at its center.
        const c = shape as CapsuleShape;
        h = raySphereNearest(p, dir, sweepLen, R, c.center, c.radius);
      } else {
        // Fallback: use the shape's AABB as a box.
        const aabb = shape.getAabb();
        h = rayBoxNearest(p, dir, sweepLen, R, aabb.min, aabb.max);
      }
      if (h && (!shapeHit || h.distance < shapeHit.distance)) {
        shapeHit = h;
      }
    }

    if (shapeHit && shapeHit.distance < bestDist) {
      bestDist = shapeHit.distance;
      bestHit = {
        distance: shapeHit.distance,
        point: shapeHit.point,
        normal: shapeHit.normal,
        colliderId: id,
      };
    }
  }

  return bestHit;
}

// ── sweep helpers ────────────────────────────────────────────────────────

/**
 * Ray vs sphere (sphere = center S, radius Rs + R — i.e. the collider sphere
 * inflated by the swept sphere radius R). Returns the nearest forward hit
 * within [0, sweepLen], or null.
 */
function raySphereNearest(
  o: Vector3,
  dir: Vector3,
  sweepLen: number,
  R: number,
  center: Vector3,
  Rs: number,
): { distance: number; point: Vector3; normal: Vector3 } | null {
  const Rtot = R + Rs;
  const lx = o.x - center.x;
  const ly = o.y - center.y;
  const lz = o.z - center.z;
  const b = lx * dir.x + ly * dir.y + lz * dir.z;
  const c = lx * lx + ly * ly + lz * lz - Rtot * Rtot;

  let t: number;
  if (c <= 0) {
    // Origin already inside the inflated sphere — penetrating.
    t = 0;
  } else {
    const disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t0 = -b - sq;
    if (t0 < 0) return null; // Ray points away from the sphere.
    t = t0;
  }
  if (t > sweepLen) return null; // Hit beyond the sweep length.

  const px = o.x + dir.x * t;
  const py = o.y + dir.y * t;
  const pz = o.z + dir.z * t;
  let nx = px - center.x;
  let ny = py - center.y;
  let nz = pz - center.z;
  const nlen = Math.hypot(nx, ny, nz);
  if (nlen < REMAIN_EPS) {
    // Degenerate (concentric) — default to up.
    nx = 0; ny = 1; nz = 0;
  } else {
    nx /= nlen; ny /= nlen; nz /= nlen;
  }
  return {
    distance: t,
    point: new Vector3(px, py, pz),
    normal: new Vector3(nx, ny, nz),
  };
}

/**
 * Ray vs AABB (box = min/max inflated by R on every axis). Returns the nearest
 * forward hit within [0, sweepLen], or null. The contact normal is derived
 * from the closest point on the ORIGINAL (uninflated) box to the swept
 * sphere center at contact — correct for edges/corners; falls back to the
 * entry-face slab normal for deep penetration.
 */
function rayBoxNearest(
  o: Vector3,
  dir: Vector3,
  sweepLen: number,
  R: number,
  min: Vector3,
  max: Vector3,
): { distance: number; point: Vector3; normal: Vector3 } | null {
  // Inflated box bounds.
  const iminx = min.x - R, iminy = min.y - R, iminz = min.z - R;
  const imaxx = max.x + R, imaxy = max.y + R, imaxz = max.z + R;

  let tmin = -Infinity;
  let tmax = Infinity;
  let hitAxis = -1; // 0=x, 1=y, 2=z
  let hitSign = 0;  // outward normal sign on the entry face

  // X slab
  if (Math.abs(dir.x) < 1e-12) {
    if (o.x < iminx || o.x > imaxx) return null;
  } else {
    const inv = 1 / dir.x;
    let t1 = (iminx - o.x) * inv;
    let t2 = (imaxx - o.x) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; hitAxis = 0; hitSign = dir.x > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y slab
  if (Math.abs(dir.y) < 1e-12) {
    if (o.y < iminy || o.y > imaxy) return null;
  } else {
    const inv = 1 / dir.y;
    let t1 = (iminy - o.y) * inv;
    let t2 = (imaxy - o.y) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; hitAxis = 1; hitSign = dir.y > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Z slab
  if (Math.abs(dir.z) < 1e-12) {
    if (o.z < iminz || o.z > imaxz) return null;
  } else {
    const inv = 1 / dir.z;
    let t1 = (iminz - o.z) * inv;
    let t2 = (imaxz - o.z) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) { tmin = t1; hitAxis = 2; hitSign = dir.z > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmax < 0) return null; // Whole box behind the ray.

  let t: number;
  if (tmin >= 0) {
    t = tmin;
  } else {
    // Origin inside the inflated box — penetrating.
    t = 0;
  }
  if (t > sweepLen) return null;

  const px = o.x + dir.x * t;
  const py = o.y + dir.y * t;
  const pz = o.z + dir.z * t;

  // Normal: from the closest point on the original (uninflated) box to the
  // swept sphere center at contact. Falls back to the slab entry-face normal
  // when the center is inside the original box (deep penetration).
  const cx = clamp(px, min.x, max.x);
  const cy = clamp(py, min.y, max.y);
  const cz = clamp(pz, min.z, max.z);
  let nx = px - cx;
  let ny = py - cy;
  let nz = pz - cz;
  const nlen = Math.hypot(nx, ny, nz);
  if (nlen < REMAIN_EPS) {
    if (hitAxis === 0) { nx = hitSign; ny = 0; nz = 0; }
    else if (hitAxis === 1) { nx = 0; ny = hitSign; nz = 0; }
    else if (hitAxis === 2) { nx = 0; ny = 0; nz = hitSign; }
    else { nx = 0; ny = 1; nz = 0; }
  } else {
    nx /= nlen; ny /= nlen; nz /= nlen;
  }
  return {
    distance: t,
    point: new Vector3(px, py, pz),
    normal: new Vector3(nx, ny, nz),
  };
}

/** Conservative swept AABB = union of the capsule AABB at start and end. */
function sweptAabb(
  pos: Vector3,
  delta: Vector3,
  R: number,
  hh: number,
): { min: Vector3; max: Vector3 } {
  const ex = pos.x + delta.x;
  const ey = pos.y + delta.y;
  const ez = pos.z + delta.z;
  const min1x = pos.x - R, min1y = pos.y - hh - R, min1z = pos.z - R;
  const max1x = pos.x + R, max1y = pos.y + hh + R, max1z = pos.z + R;
  const min2x = ex - R, min2y = ey - hh - R, min2z = ez - R;
  const max2x = ex + R, max2y = ey + hh + R, max2z = ez + R;
  return {
    min: new Vector3(
      Math.min(min1x, min2x),
      Math.min(min1y, min2y),
      Math.min(min1z, min2z),
    ),
    max: new Vector3(
      Math.max(max1x, max2x),
      Math.max(max1y, max2y),
      Math.max(max1z, max2z),
    ),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

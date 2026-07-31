// VegetationFilter — 植被过滤器:决定候选点是否可放置植被。
// 参考 o3de Gems/Vegetation:Filter 链式过滤,每个过滤器检查一个条件 (海拔/坡度/表面标签/距离/形状/随机)。

import { Vector3 } from '../Math/Vector3';
import type { Shape } from '../Shapes/Shape';
import type { SurfacePoint } from '../SurfaceData/SurfacePoint';
import { getTagWeight } from '../SurfaceData/SurfacePoint';
import type { VegetationDescriptor } from './VegetationDescriptor';

export interface VegetationFilterContext {
  position: Vector3;            // candidate spawn position (world)
  surface: SurfacePoint | null; // surface data at position (may be null if no provider)
  normal: Vector3;              // surface normal at position
  slope: number;                // radians from up
  altitude: number;             // y coordinate
  descriptor: VegetationDescriptor;
}

export abstract class VegetationFilter {
  abstract readonly type: string;
  abstract accept(ctx: VegetationFilterContext): boolean;
  enabled: boolean = true;
}

/** Accept points whose altitude is within [min, max]. */
export class SurfaceAltitudeFilter extends VegetationFilter {
  readonly type = 'altitude';
  constructor(public min: number, public max: number) { super(); }
  accept(ctx: VegetationFilterContext): boolean {
    return ctx.altitude >= this.min && ctx.altitude <= this.max;
  }
}

/** Accept points whose slope (radians from up) is within [min, max]. */
export class SurfaceSlopeFilter extends VegetationFilter {
  readonly type = 'slope';
  constructor(public min: number, public max: number) { super(); }
  accept(ctx: VegetationFilterContext): boolean {
    return ctx.slope >= this.min && ctx.slope <= this.max;
  }
}

/** Accept points whose surface has `tag` with weight >= `minWeight`. */
export class SurfaceMaskFilter extends VegetationFilter {
  readonly type = 'surfaceMask';
  constructor(public tag: string, public minWeight: number = 0.5) { super(); }
  accept(ctx: VegetationFilterContext): boolean {
    if (!ctx.surface) return false;
    return getTagWeight(ctx.surface, this.tag) >= this.minWeight;
  }
}

/** Reject points within `minDistance` of any already-placed instance in this area. */
export class DistanceBetweenFilter extends VegetationFilter {
  readonly type = 'distanceBetween';
  /** mutable list of placed positions (shared with the spawner) */
  placed: Vector3[] = [];
  constructor(public minDistance: number) { super(); }
  accept(ctx: VegetationFilterContext): boolean {
    for (const p of this.placed) {
      if (p.distanceTo(ctx.position) < this.minDistance) return false;
    }
    return true;
  }
}

/** Accept points inside any of the given shapes (union). */
export class ShapeIntersectionFilter extends VegetationFilter {
  readonly type = 'shapeIntersection';
  constructor(public shapes: Shape[]) { super(); }
  accept(ctx: VegetationFilterContext): boolean {
    for (const s of this.shapes) {
      if (s.containsPoint(ctx.position)) return true;
    }
    return false;
  }
}

/** Deterministic pseudo-random filter (accept with probability `probability`, seeded). */
export class DistributionFilter extends VegetationFilter {
  readonly type = 'distribution';
  private state: number;
  constructor(public probability: number, seed: number = 12345) {
    super();
    this.state = seed >>> 0;
  }
  private next(): number {
    // mulberry32
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  accept(_ctx: VegetationFilterContext): boolean {
    return this.next() < this.probability;
  }
}

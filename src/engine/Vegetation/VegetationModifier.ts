// VegetationModifier — 植被修改器:在过滤器通过后,修改实例的 position/rotation/scale。
// 参考 o3de Gems/Vegetation:Modifier 链式修改,每个修改器叠加一层随机变化 (位置抖动/旋转/缩放/坡度对齐)。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import type { VegetationFilterContext } from './VegetationFilter';

export interface VegetationModifierContext extends VegetationFilterContext {
  position: Vector3;       // mutated in place
  rotation: Quaternion;    // mutated in place
  scale: Vector3;          // mutated in place
}

export abstract class VegetationModifier {
  abstract readonly type: string;
  abstract apply(ctx: VegetationModifierContext): void;
  enabled: boolean = true;
}

/** Shared up vector (Y axis). Read-only — setFromAxisAngle does not mutate the axis. */
const UP_Y = new Vector3(0, 1, 0);

/** Add random jitter to position within radius. */
export class PositionModifier extends VegetationModifier {
  readonly type = 'position';
  private state: number;
  constructor(public radius: number, seed: number = 1) {
    super();
    this.state = seed >>> 0;
  }
  private next(): number {
    // mulberry32, return [-1, 1]
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return r * 2 - 1;
  }
  apply(ctx: VegetationModifierContext): void {
    ctx.position.x += this.next() * this.radius;
    ctx.position.z += this.next() * this.radius;
  }
}

/** Random Y rotation in [min, max] radians. */
export class RotationModifier extends VegetationModifier {
  readonly type = 'rotation';
  constructor(public min: number = 0, public max: number = Math.PI * 2) { super(); }
  apply(ctx: VegetationModifierContext): void {
    const angle = this.min + Math.random() * (this.max - this.min);
    ctx.rotation.setFromAxisAngle(UP_Y, angle);
  }
}

/** Random uniform scale in [min, max]. */
export class ScaleModifier extends VegetationModifier {
  readonly type = 'scale';
  constructor(public min: number = 0.8, public max: number = 1.2) { super(); }
  apply(ctx: VegetationModifierContext): void {
    const s = this.min + Math.random() * (this.max - this.min);
    ctx.scale.set(s, s, s);
  }
}

/** Align rotation to surface normal (lerp factor 0..1, 1 = fully aligned). */
export class SlopeAlignmentModifier extends VegetationModifier {
  readonly type = 'slopeAlignment';
  constructor(public factor: number = 1.0) { super(); }
  apply(ctx: VegetationModifierContext): void {
    // Build rotation from UP_Y to ctx.normal (slerp by factor)
    const normal = ctx.normal.clone().normalize();
    const target = new Quaternion().setFromUnitVectors(UP_Y, normal);
    ctx.rotation.slerp(target, this.factor);
  }
}

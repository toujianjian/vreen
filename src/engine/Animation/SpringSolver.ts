// SpringSolver — 二次骨骼弹簧物理求解器。
//
// 为头发 / 布料 / 耳朵 / 尾巴等附加骨骼提供 follow-through(跟随余动)。
// 动画混合器完成主骨架姿态后,SpringSolver 对注册的骨骼施加弹簧力,
// 产生自然二次运动,无需在动画 clip 中手工 authored。
//
// 算法(adapted from o3de EMotionFX SpringSolver):
//   每帧:
//     1. 由 AnimationMixer 完成主骨架姿态。
//     2. 对每个弹簧骨骼施加:
//        - 弹簧力 = -stiffness * offset      (拉回静止方向)
//        - 阻尼力 = -damping * velocity      (衰减速度)
//        - 重力   = gravity * mass           (mass=1)
//     3. 加速度 = 合力 / mass;速度 += 加速度 * dt;位移 += 速度 * dt。
//     4. 通过 setBoneTransform 把 offset 叠加回骨骼。
//
// 数值积分采用半隐式 Euler(symplectic),固定时间步 + 子步进保证稳定性。
// 当帧时间 dt 超过 fixedDt*maxSubsteps 时,只模拟 fixedDt*maxSubsteps
// (避免"死亡螺旋"),剩余时间丢弃。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { createLogger } from '@/lib/logger';

const log = createLogger('SpringSolver');

export interface SpringBone {
  /** Bone name in the skeleton. */
  name: string;
  /** Spring stiffness (higher = snappier, default 100). */
  stiffness: number;
  /** Damping (0 = no damping, 1 = critical, default 0.3). */
  damping: number;
  /** Gravity influence magnitude (default 9.81). */
  gravity: number;
  /** Bone length (for child position computation, default 0.1). */
  length: number;
  /** Current position offset (relative to rest pose). */
  offset: Vector3;
  /** Current velocity. */
  velocity: Vector3;
  /** Rest direction (in bone local space, default +Y). */
  restDirection: Vector3;
}

export interface SpringSolverOptions {
  /** Fixed timestep for the solver (default 1/60). */
  fixedDt?: number;
  /** Max substeps per update (default 4). */
  maxSubsteps?: number;
  /** Global gravity (default (0, -9.81, 0)). */
  gravity?: Vector3;
}

/**
 * Spring physics solver for secondary bone animation (hair, cloth, ears, tail).
 * Adapted from o3de EMotionFX `SpringSolver`.
 *
 * Each frame:
 *   1. The skeleton is posed by the animation mixer.
 *   2. `SpringSolver` applies spring forces to registered bones:
 *      - Spring force pulls the bone back toward its rest direction.
 *      - Damping reduces velocity over time.
 *      - Gravity pulls the bone down.
 *   3. The bone's transform is offset by the spring result.
 */
export class SpringSolver {
  bones = new Map<string, SpringBone>();
  gravity: Vector3;
  fixedDt: number;
  maxSubsteps: number;

  constructor(options: SpringSolverOptions = {}) {
    this.gravity = options.gravity ?? new Vector3(0, -9.81, 0);
    this.fixedDt = options.fixedDt ?? 1 / 60;
    this.maxSubsteps = Math.max(1, Math.floor(options.maxSubsteps ?? 4));
  }

  addBone(bone: SpringBone): this {
    this.bones.set(bone.name, bone);
    return this;
  }

  removeBone(name: string): boolean {
    return this.bones.delete(name);
  }

  getBone(name: string): SpringBone | undefined {
    return this.bones.get(name);
  }

  clear(): void {
    this.bones.clear();
  }

  /**
   * Update all spring bones by `dt` seconds.
   * Uses fixed timestep with substepping for stability.
   *
   * @param dt Elapsed time since last update (seconds).
   * @param getBoneTransform Returns a bone's current world position + rotation
   *   (from the posed skeleton, without the spring offset).
   * @param setBoneTransform Applies the spring offset back to the bone.
   */
  update(
    dt: number,
    getBoneTransform: (name: string) => { position: Vector3; rotation: Quaternion } | null,
    setBoneTransform: (name: string, position: Vector3, rotation: Quaternion) => void,
  ): void {
    if (this.bones.size === 0) return;
    if (dt <= 0) return;

    let elapsed = 0;
    let substeps = 0;
    while (elapsed < dt && substeps < this.maxSubsteps) {
      const step = Math.min(this.fixedDt, dt - elapsed);
      for (const bone of this.bones.values()) {
        const base = getBoneTransform(bone.name);
        if (!base) continue;

        const mass = 1;
        // Per-bone gravity scale: default bone.gravity (9.81) maps to 1.0×.
        const gScale = bone.gravity / 9.81;
        const gx = this.gravity.x * gScale;
        const gy = this.gravity.y * gScale;
        const gz = this.gravity.z * gScale;

        // Spring force: -stiffness * offset.
        const sx = -bone.stiffness * bone.offset.x;
        const sy = -bone.stiffness * bone.offset.y;
        const sz = -bone.stiffness * bone.offset.z;
        // Damping force: -damping * velocity.
        const dx = -bone.damping * bone.velocity.x;
        const dy = -bone.damping * bone.velocity.y;
        const dz = -bone.damping * bone.velocity.z;

        // acceleration = (spring + damping + gravity) / mass (mass = 1).
        const ax = (sx + dx + gx) / mass;
        const ay = (sy + dy + gy) / mass;
        const az = (sz + dz + gz) / mass;

        // Semi-implicit Euler: velocity first, then position.
        bone.velocity.x += ax * step;
        bone.velocity.y += ay * step;
        bone.velocity.z += az * step;
        bone.offset.x += bone.velocity.x * step;
        bone.offset.y += bone.velocity.y * step;
        bone.offset.z += bone.velocity.z * step;

        // Apply offset to bone (rest position + spring offset).
        setBoneTransform(
          bone.name,
          new Vector3(
            base.position.x + bone.offset.x,
            base.position.y + bone.offset.y,
            base.position.z + bone.offset.z,
          ),
          base.rotation,
        );
      }
      elapsed += step;
      substeps++;
    }
    log.debug('update', { dt, substeps });
  }

  /** Reset all springs to rest pose. */
  reset(): void {
    for (const bone of this.bones.values()) {
      bone.offset.set(0, 0, 0);
      bone.velocity.set(0, 0, 0);
    }
  }
}

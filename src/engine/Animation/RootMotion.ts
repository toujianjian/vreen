// RootMotion — extracts the relative motion of a designated root bone from a
// played clip and redirects it to the actor's world transform (instead of the
// bone), so in-place walk/run clips drive the character forward with correct
// foot planting. Concept adapted from o3de EMotionFX `RepositioningLayerPass`.
//
// Flow:
//   1. AnimationMixer.update() poses the skeleton for the frame.
//   2. RootMotionExtractor.extract() reads the root bone's current local
//      transform, computes the per-frame delta from the previous frame,
//      subtracts it from the bone (so the bone stays planted) and accumulates
//      the delta internally.
//   3. CharacterController consumes the accumulated delta via consumeDelta()
//      and applies it to the actor's world transform.

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { createLogger } from '@/lib/logger';

const log = createLogger('RootMotion');

export interface RootMotionConfig {
  /** Name of the root bone node in the clip whose transform drives the actor. */
  rootBoneName: string;
  /** If true, the extracted root motion delta is applied to the actor's world transform
   *  and subtracted from the bone so feet stay planted. Default true. */
  enabled: boolean;
  /** Scale applied to the extracted delta (use 0 to disable, 1 = clip authored speed, >1 = faster). Default 1. */
  scale: number;
  /** If true, only horizontal (XZ) translation is extracted (Y is ignored — useful for non-flying characters). Default true. */
  horizontalOnly: boolean;
}

export const DEFAULT_ROOT_MOTION_CONFIG: RootMotionConfig = {
  rootBoneName: 'Root',
  enabled: true,
  scale: 1,
  horizontalOnly: true,
};

const Y_AXIS = new Vector3(0, 1, 0);

export class RootMotionExtractor {
  /** Previous frame's root bone world position (clip-local). Null = first frame. */
  private prevPosition: Vector3 | null = null;
  /** Previous frame's root bone world rotation. Null = first frame. */
  private prevRotation: Quaternion | null = null;
  /** Accumulated delta for the current update tick. Reset on consume(). */
  private deltaPosition: Vector3 = new Vector3();
  private deltaRotation: Quaternion = new Quaternion();

  config: RootMotionConfig;

  constructor(config: Partial<RootMotionConfig> = {}) {
    this.config = { ...DEFAULT_ROOT_MOTION_CONFIG, ...config };
  }

  /**
   * Called by AnimationMixer.update AFTER posing the skeleton for this frame.
   * Reads the root bone's current local position/rotation, computes the delta
   * from the previous frame, subtracts the delta from the bone (so it stays put),
   * and accumulates the delta for later consumption by the CharacterController.
   *
   * @param currentPos Root bone's current position (in clip-local / skeleton space)
   * @param currentRot Root bone's current rotation (in clip-local / skeleton space)
   * @param boneSetter Callback to write the new bone transform back (signature: (pos, rot) => void).
   *                   Pass null/undefined to skip write-back (e.g. for testing).
   */
  extract(
    currentPos: Vector3,
    currentRot: Quaternion,
    boneSetter?: (pos: Vector3, rot: Quaternion) => void,
  ): void {
    // Disabled = complete no-op (no delta, no bone write-back).
    if (!this.config.enabled) return;

    // 1. First frame: seed the previous transform and produce no delta.
    if (this.prevPosition === null || this.prevRotation === null) {
      this.prevPosition = currentPos.clone();
      this.prevRotation = currentRot.clone();
      return;
    }

    // 2. Position delta = (current - prev) * scale; zero Y when horizontalOnly.
    const posDelta = currentPos.clone().sub(this.prevPosition).multiplyScalar(this.config.scale);
    if (this.config.horizontalOnly) posDelta.y = 0;
    this.deltaPosition.add(posDelta);

    // 3. Rotation delta: q_delta = currentRot * prevRotation^-1.
    const rotDelta = currentRot.clone().multiply(this.prevRotation.clone().invert());

    if (this.config.horizontalOnly) {
      // Project to yaw only: decompose to axis-angle and keep the Y component
      // of the axis (pitch/roll removed). Exact for pure-axis rotations.
      const axis = new Vector3();
      const angle = rotDelta.toAxisAngle(axis);
      const yawDelta = new Quaternion().setFromAxisAngle(Y_AXIS, angle * axis.y);
      this.deltaRotation.premultiply(yawDelta);
    } else {
      this.deltaRotation.premultiply(rotDelta);
    }

    // 5. Keep the bone planted: write the previous transform back so the
    //    extracted motion is not also applied to the bone.
    if (boneSetter) {
      boneSetter(this.prevPosition.clone(), this.prevRotation.clone());
    }

    // 6. Advance the previous transform to the current one for next frame.
    this.prevPosition = currentPos.clone();
    this.prevRotation = currentRot.clone();
  }

  /** Consume and clear the accumulated delta. The caller (CharacterController) applies this to the actor. */
  consumeDelta(): { position: Vector3; rotation: Quaternion } {
    const pos = this.deltaPosition.clone();
    const rot = this.deltaRotation.clone();
    this.deltaPosition.set(0, 0, 0);
    this.deltaRotation.identity();
    return { position: pos, rotation: rot };
  }

  /** Peek at the accumulated delta without consuming. */
  peekDelta(): { position: Vector3; rotation: Quaternion } {
    return { position: this.deltaPosition.clone(), rotation: this.deltaRotation.clone() };
  }

  /** Reset the extractor (e.g. on clip change / blend transition). Clears prev + delta. */
  reset(): void {
    this.prevPosition = null;
    this.prevRotation = null;
    this.deltaPosition.set(0, 0, 0);
    this.deltaRotation.identity();
    log.debug('reset');
  }

  /** Update config (e.g. enable/disable at runtime). */
  setConfig(partial: Partial<RootMotionConfig>): void {
    this.config = { ...this.config, ...partial };
    if (!this.config.enabled) this.reset();
  }
}

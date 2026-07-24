// IKHumanoid — pre-built IK configuration for a standard bipedal rig.
//
// The default rest pose mirrors the proportions of
// `src/engine/Animation/Humanoid.ts` (the procedural humanoid builder):
//
//   root → pelvis → spine → chest → head
//                          ├→ shoulder.{L,R} → upperArm.{L,R} → lowerArm.{L,R}
//   pelvis → thigh.{L,R} → shin.{L,R} → foot.{L,R}
//
// The class owns a map of named rest-pose bone positions (world space)
// and exposes `createArmChain(side)` / `createLegChain(side)` which
// build ready-to-solve IKChains wired to fresh IKBone instances.
//
// Joint constraints reflect typical humanoid ranges:
//   • elbow  — hinge around Y, 0..150° (flex only, no hyperextension)
//   • knee   — hinge around Y, 0..160°
//   • shoulder/thigh — unconstrained (3-DOF ball joint)
//
// Lengths are derived from the rest-pose segment lengths so the chain
// works without any external Skeleton reference. Callers that want to
// bind the IK to an existing engine Skeleton should walk the Skeleton's
// bones, build a name → world-position map, and pass it to the
// constructor — the chain geometry will follow that rig.

import { IKBone, type JointConstraint } from './IKBone';
import { IKChain } from './IKChain';
import { Vector3 } from '../../Math/Vector3';

export type Side = 'L' | 'R';

export interface HumanoidRestPose {
  /** Named rest-pose world positions, e.g. `bones.get('upperArm.L')`. */
  bones: Map<string, Vector3>;
}

/** Default rest-pose positions (scale 1.0), matching Humanoid.ts proportions. */
export function defaultHumanoidRestPose(): Map<string, Vector3> {
  const m = new Map<string, Vector3>();
  const set = (name: string, x: number, y: number, z: number) => m.set(name, new Vector3(x, y, z));
  set('root', 0, 0, 0);
  set('pelvis', 0, 0.95, 0);
  set('spine', 0, 0.95, 0);
  set('chest', 0, 1.25, 0);
  set('head', 0, 1.55, 0);
  // arms: chest at y=1.25, shoulders ±0.20 above chest top
  set('shoulder.L', 0.20, 1.45, 0);
  set('upperArm.L', 0.20, 1.27, 0);
  set('lowerArm.L', 0.20, 1.07, 0);
  set('shoulder.R', -0.20, 1.45, 0);
  set('upperArm.R', -0.20, 1.27, 0);
  set('lowerArm.R', -0.20, 1.07, 0);
  // legs: pelvis at y=0.95, thighs ±0.10 below pelvis
  set('thigh.L', 0.10, 0.90, 0);
  set('shin.L', 0.10, 0.65, 0);
  set('foot.L', 0.10, 0.40, 0.04);
  set('thigh.R', -0.10, 0.90, 0);
  set('shin.R', -0.10, 0.65, 0);
  set('foot.R', -0.10, 0.40, 0.04);
  return m;
}

/** Elbow constraint: hinge around local Y, 0..150° flexion (no hyperextension). */
function elbowConstraint(): JointConstraint {
  return { minAngle: 0, maxAngle: (150 * Math.PI) / 180, axis: new Vector3(0, 1, 0) };
}

/** Knee constraint: hinge around local Y, 0..160° flexion. */
function kneeConstraint(): JointConstraint {
  return { minAngle: 0, maxAngle: (160 * Math.PI) / 180, axis: new Vector3(0, 1, 0) };
}

export class IKHumanoid {
  /** Named rest-pose world positions used to derive segment lengths. */
  readonly restPose: Map<string, Vector3>;

  constructor(restPose?: Map<string, Vector3>) {
    this.restPose = restPose ?? defaultHumanoidRestPose();
  }

  /** Build a 3-bone arm IK chain: shoulder → upperArm → lowerArm (end effector).
   *  The elbow is constrained as a hinge (0..150° flexion). */
  createArmChain(side: Side, opts: { iterations?: number; tolerance?: number } = {}): IKChain {
    const s = side === 'L' ? '.L' : '.R';
    const shoulderPos = this._get(`shoulder${s}`);
    const upperArmPos = this._get(`upperArm${s}`);
    const lowerArmPos = this._get(`lowerArm${s}`);

    const chain = new IKChain(opts);
    // Bones are constructed with WORLD positions; we then convert to local
    // offsets by setting the parent appropriately (addBone wires parent).
    // To keep getWorldPosition() working, we provide LOCAL offsets:
    //   bone.position = worldPos - parentWorldPos (with parent rotation = identity)
    // Since the chain is constructed fresh and all rotations start as identity,
    // the local offset equals the world delta from the parent.

    const shoulder = new IKBone(`shoulder${s}`, shoulderPos.clone(), undefined, 0);
    chain.addBone(shoulder);

    const upperArmOffset = upperArmPos.clone().sub(shoulderPos);
    const upperArm = new IKBone(
      `upperArm${s}`,
      upperArmOffset,
      undefined,
      upperArmPos.distanceTo(lowerArmPos),
      shoulder,
      elbowConstraint(),
    );
    chain.addBone(upperArm);

    const lowerArmOffset = lowerArmPos.clone().sub(upperArmPos);
    const lowerArm = new IKBone(`lowerArm${s}`, lowerArmOffset, undefined, 0, upperArm);
    chain.addBone(lowerArm);

    // Initialize the target at the current end-effector position so the
    // first solve() with no target change is a no-op.
    chain.target.copy(lowerArmPos);
    return chain;
  }

  /** Build a 3-bone leg IK chain: thigh → shin → foot (end effector).
   *  The knee is constrained as a hinge (0..160° flexion). */
  createLegChain(side: Side, opts: { iterations?: number; tolerance?: number } = {}): IKChain {
    const s = side === 'L' ? '.L' : '.R';
    const pelvisPos = this._get('pelvis');
    const thighPos = this._get(`thigh${s}`);
    const shinPos = this._get(`shin${s}`);
    const footPos = this._get(`foot${s}`);

    const chain = new IKChain(opts);

    const thigh = new IKBone(`thigh${s}`, thighPos.clone().sub(pelvisPos), undefined, thighPos.distanceTo(shinPos));
    chain.addBone(thigh);

    const shinOffset = shinPos.clone().sub(thighPos);
    const shin = new IKBone(`shin${s}`, shinOffset, undefined, shinPos.distanceTo(footPos), thigh, kneeConstraint());
    chain.addBone(shin);

    const footOffset = footPos.clone().sub(shinPos);
    const foot = new IKBone(`foot${s}`, footOffset, undefined, 0, shin);
    chain.addBone(foot);

    chain.target.copy(footPos);
    return chain;
  }

  /** Build all five standard humanoid IK chains at once. */
  createAllChains(opts: { iterations?: number; tolerance?: number } = {}): {
    leftArm: IKChain;
    rightArm: IKChain;
    leftLeg: IKChain;
    rightLeg: IKChain;
  } {
    return {
      leftArm: this.createArmChain('L', opts),
      rightArm: this.createArmChain('R', opts),
      leftLeg: this.createLegChain('L', opts),
      rightLeg: this.createLegChain('R', opts),
    };
  }

  private _get(name: string): Vector3 {
    const v = this.restPose.get(name);
    if (!v) throw new Error(`IKHumanoid: rest pose missing bone "${name}"`);
    return v;
  }
}

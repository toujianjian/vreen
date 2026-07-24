// IK barrel — inverse-kinematics subsystem.
//
//   IKBone      — a single joint in an IK chain (local pos/rot, parent,
//                 optional joint constraint)
//   IKChain     — FABRIK solver for a single chain (positions only)
//   IKSolver    — manages multiple chains, solves them together
//   CCDSolver   — Cyclic Coordinate Descent solver (rotations, constraint-friendly)
//   IKHumanoid  — pre-built arm/leg chains for a standard biped rig
//
// Usage:
//   import { IKChain, IKBone } from '@/engine/Animation/IK';
//   const chain = new IKChain({ iterations: 20 });
//   chain.addBone(new IKBone('root', new Vector3(0,0,0)));
//   chain.addBone(new IKBone('elbow', new Vector3(0,1,0)));
//   chain.addBone(new IKBone('hand', new Vector3(0,2,0)));
//   chain.target.set(1, 1, 0);
//   const err = chain.solve();

export { IKBone, type JointConstraint } from './IKBone';
export { IKChain, type IKChainOptions } from './IKChain';
export { IKSolver, type IKSolverOptions } from './IKSolver';
export { CCDSolver } from './CCDSolver';
export { IKHumanoid, type Side, type HumanoidRestPose, defaultHumanoidRestPose } from './IKHumanoid';

# Inverse Kinematics (IK) Module

> Path: `src/engine/Animation/IK/`
>
> Provides inverse kinematics solvers for character animation, including
> FABRIK, CCD, and a humanoid biped rig.

---

## Overview

The IK module provides three solver strategies for computing joint
rotations that position an end-effector at a target location:

```
IK/
  ├── IKSolver.ts        ← FABRIK (Forward And Backward Reaching Inverse Kinematics)
  ├── CCDSolver.ts       ← CCD (Cyclic Coordinate Descent)
  ├── IKHumanoid.ts      ← Humanoid biped rig (2-arm, 2-leg, spine)
  └── types.ts           ← Shared types (IKEffector, IKChain, IKTarget)
```

---

## Solvers

### FABRIK (`IKSolver.ts`)

**Algorithm**: Forward And Backward Reaching Inverse Kinematics
(Aristidou & Lasenby, 2011).

FABRIK works in two phases per iteration:
1. **Backward**: Move the end-effector to the target, then iteratively
   move each parent joint to maintain bone lengths.
2. **Forward**: Move the root back to its original position, then
   iteratively move each child joint to maintain bone lengths.

#### API

```ts
class IKSolver {
  constructor(chain: IKChain);
  solve(target: Vector3, iterations?: number): void;
  getPositions(): Vector3[];
}
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `chain` | `IKChain` | Bone chain (root → end-effector) |
| `iterations` | `number` | Default: 10 (higher = more accurate, slower) |
| `tolerance` | `number` | Default: 0.001 (convergence threshold) |

---

### CCDSolver (`CCDSolver.ts`)

**Algorithm**: Cyclic Coordinate Descent (Wang & Chen, 1991).

CCD rotates one joint at a time, starting from the end-effector, to
align the end-effector with the target. Simpler than FABRIK but
converges slower for long chains.

#### API

```ts
class CCDSolver {
  constructor(chain: IKChain);
  solve(target: Vector3, iterations?: number): void;
  getRotations(): Quaternion[];
}
```

---

### IKHumanoid (`IKHumanoid.ts`)

A complete humanoid biped rig with:
- 2 arms (shoulder → elbow → hand)
- 2 legs (hip → knee → foot)
- Spine (pelvis → chest → head)
- Support for pole targets (elbow / knee direction)

#### API

```ts
class IKHumanoid {
  constructor(bones: HumanoidBones);
  solveLeftHand(target: Vector3): void;
  solveRightHand(target: Vector3): void;
  solveLeftFoot(target: Vector3, poleTarget?: Vector3): void;
  solveRightFoot(target: Vector3, poleTarget?: Vector3): void;
  solveHead(target: Vector3): void;
}
```

---

## Types

```ts
interface IKChain {
  joints: Vector3[];      // Joint positions (root → end)
  lengths: number[];      // Bone lengths between joints
}

interface IKEffector {
  target: Vector3;        // Target position
  chainIndex: number;     // End-effector joint index
  weight: number;         // 0..1 blend factor
}
```

---

## Usage

```ts
import { IKSolver } from '@/engine/Animation/IK';

// Define arm chain: shoulder → elbow → hand
const chain = {
  joints: [
    new Vector3(0, 1.5, 0),   // shoulder
    new Vector3(0.3, 1.2, 0), // elbow
    new Vector3(0.6, 1.0, 0), // hand
  ],
  lengths: [0.36, 0.36],
};

const solver = new IKSolver(chain);
solver.solve(new Vector3(0.8, 0.9, 0.2), 10);

const positions = solver.getPositions();
// positions[2] should now be close to (0.8, 0.9, 0.2)
```

---

## References

| Algorithm | Paper |
|-----------|-------|
| FABRIK | Aristidou & Lasenby, "FABRIK: A fast, iterative solver for the Inverse Kinematics problem" (2011) |
| CCD | Wang & Chen, "A combined optimization method for solving the inverse kinematics problem of mechanical manipulators" (1991) |

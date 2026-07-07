// Math barrel — single import surface for the engine's vector / matrix
// / quaternion types. Re-exports match three.js's `THREE` namespace so
// that future cross-engine bridges can `import { Vector3 } from ...`.

export { Vector3 } from './Vector3';
export { Matrix4 } from './Matrix4';
export { Quaternion } from './Quaternion';
export * as MathUtils from './MathUtils';

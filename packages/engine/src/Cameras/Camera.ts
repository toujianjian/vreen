// Camera — base for the two projection modes (perspective, ortho).
// We keep projection matrix calculation in the subclasses; the base
// only carries the world transform (position, quaternion, matrixWorld)
// and the cached `projectionMatrix` / `projectionMatrixInverse`.

import { Matrix4 } from '../Math';
import { Object3D } from '../Core/Object3D';

export abstract class Camera extends Object3D {
  override readonly type: string = 'Camera';
  isCamera: boolean = true;
  /** Projection matrix, used by the renderer to set `uniforms.projection`. */
  projectionMatrix = new Matrix4();
  /** Inverse of projectionMatrix. Updated whenever projectionMatrix changes. */
  projectionMatrixInverse = new Matrix4();

  /**
   * Returns a world-space direction that this camera is looking at.
   * In our scene, the camera's local -Z axis (after world transform) is
   * the look direction; we encode that into the provided target vector.
   */
  getWorldDirection(target: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    // local -Z axis in world space: matrixWorld * (0,0,-1)
    const e = this.matrixWorld.elements;
    const x = -(e[8]);
    const y = -(e[9]);
    const z = -(e[10]);
    target.x = x;
    target.y = y;
    target.z = z;
    return target;
  }

  /** Subclasses override this to (re)compute projectionMatrix. */
  abstract updateProjectionMatrix(): void;
}

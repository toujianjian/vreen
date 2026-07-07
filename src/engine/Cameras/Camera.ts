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

  /** Subclasses override this to (re)compute projectionMatrix. */
  abstract updateProjectionMatrix(): void;
}

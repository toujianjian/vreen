// Camera — base for the two projection modes (perspective, ortho).
// We keep projection matrix calculation in the subclasses; the base
// only carries the world transform (position, quaternion, matrixWorld)
// and the cached `projectionMatrix` / `projectionMatrixInverse`.

import { Matrix4, Vector3 } from '../Math';
import { Object3D } from '../Core/Object3D';

export abstract class Camera extends Object3D {
  override readonly type: string = 'Camera';
  isCamera: boolean = true;
  /** Projection matrix, used by the renderer to set `uniforms.projection`. */
  projectionMatrix = new Matrix4();
  /** Inverse of projectionMatrix. Updated whenever projectionMatrix changes. */
  projectionMatrixInverse = new Matrix4();

  /**
   * Override updateMatrixWorld so `matrixWorldInverse` is always kept in
   * sync with the world transform. three.js computes the view matrix on the
   * fly inside WebGLRenderer; VREEN keeps it as a persistent field that the
   * renderer reads directly as `u_view` (WebGL2Renderer.render → camera.
   * matrixWorldInverse). Without this override the field would never be
   * populated and the view matrix would be the identity.
   */
  override updateMatrixWorld(force: boolean = false): void {
    super.updateMatrixWorld(force);
    if (this.matrixWorldAutoUpdate) {
      this.matrixWorldInverse.copy(this.matrixWorld).invert();
    }
  }

  /**
   * Returns a world-space direction that this camera is looking at.
   * In our scene, the camera's local -Z axis (after world transform) is
   * the look direction; we encode that into the provided target vector.
   */
  getWorldDirection(target: Vector3 = new Vector3()): Vector3 {
    // local -Z axis in world space: matrixWorld * (0,0,-1)
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    target.x = -e[8];
    target.y = -e[9];
    target.z = -e[10];
    return target;
  }

  /** Subclasses override this to (re)compute projectionMatrix. */
  abstract updateProjectionMatrix(): void;
}

// PerspectiveCamera — most common 3D camera. fov is in degrees, matching
// the Inspector's slider. Aspect should be set every frame from the
// canvas size; the Renderer does that automatically.

import { Camera } from './Camera';

export class PerspectiveCamera extends Camera {
  override readonly type: string = 'PerspectiveCamera';
  fov: number;     // degrees
  aspect: number;
  near: number;
  far: number;

  constructor(fov = 50, aspect = 1, near = 0.1, far = 1000) {
    super();
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  override updateProjectionMatrix(): void {
    const top = this.near * Math.tan((this.fov * Math.PI) / 360);
    const height = 2 * top;
    const width = this.aspect * height;
    const left = -width / 2;
    // We delegate the actual frustum build to Matrix4.makePerspective —
    // symmetric vertical fov, WebGL depth [-1, 1]. (Same as three.js with
    // filmOffset = 0.)
    this.projectionMatrix.makePerspective(
      (this.fov * Math.PI) / 180,
      this.aspect,
      this.near,
      this.far,
    );
    this.projectionMatrixInverse.getInverse(this.projectionMatrix);
    // We *do not* shift the frustum; symmetric camera. (Keeping the vars
    // around to remind future readers why the local `left` calc exists.)
    void left;
  }
}

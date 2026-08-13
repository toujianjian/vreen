// PerspectiveCamera — most common 3D camera. fov is in degrees, matching
// the Inspector's slider. Aspect should be set every frame from the
// canvas size; the Renderer does that automatically.

import { Camera } from './Camera';

export class PerspectiveCamera extends Camera {
  override readonly type: string = 'PerspectiveCamera';
  isPerspectiveCamera: boolean = true;
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
    // 对称垂直视锥 (filmOffset = 0):top/bottom 由 fov 决定,left/right 由 aspect 决定。
    const top = this.near * Math.tan((this.fov * Math.PI) / 360);
    const height = 2 * top;
    const width = this.aspect * height;
    const left = -width / 2;
    const right = -left;
    const bottom = -top;
    // 委托 Matrix4.makePerspective 构建视锥,WebGL 深度 [-1, 1]。
    this.projectionMatrix.makePerspective(left, right, top, bottom, this.near, this.far);
    this.projectionMatrixInverse.getInverse(this.projectionMatrix);
  }
}

// OrthographicCamera — for 2D HUDs, technical drawings, blueprint view.

import { Camera } from './Camera';

export class OrthographicCamera extends Camera {
  override readonly type: string = 'OrthographicCamera';
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;

  constructor(
    left = -1,
    right = 1,
    top = 1,
    bottom = -1,
    near = 0.1,
    far = 1000,
  ) {
    super();
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  override updateProjectionMatrix(): void {
    const e = this.projectionMatrix.elements;
    const lr = 1 / (this.left - this.right);
    const tb = 1 / (this.top - this.bottom);
    const nf = 1 / (this.near - this.far);
    e[0] = -2 * lr;          e[4] = 0;                 e[8]  = 0;                  e[12] = (this.left + this.right) * lr;
    e[1] = 0;                e[5] = -2 * tb;           e[9]  = 0;                  e[13] = (this.top + this.bottom) * tb;
    e[2] = 0;                e[6] = 0;                 e[10] = 2 * nf;             e[14] = (this.far + this.near) * nf;
    e[3] = 0;                e[7] = 0;                 e[11] = 0;                  e[15] = 1;
    this.projectionMatrixInverse.getInverse(this.projectionMatrix);
  }
}

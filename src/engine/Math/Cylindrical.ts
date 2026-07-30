// Cylindrical — 柱坐标 (radius, theta, y)。
// 参考 three.js Cylindrical.js:radius 是 xz 平面上的距离,
// theta 是 xz 平面上从 +z 轴起逆时针的角 [-π, π],y 是高度。
// 用于环绕相机的水平旋转 (FPS/OrbitControls 的柱坐标变体)。

import type { Vector3 } from './Vector3';

export class Cylindrical {
  radius: number;
  theta: number;
  y: number;

  constructor(radius = 1, theta = 0, y = 0) {
    this.radius = radius;
    this.theta = theta;
    this.y = y;
  }

  set(radius: number, theta: number, y: number): this {
    this.radius = radius;
    this.theta = theta;
    this.y = y;
    return this;
  }

  copy(c: Cylindrical): this {
    this.radius = c.radius;
    this.theta = c.theta;
    this.y = c.y;
    return this;
  }

  clone(): Cylindrical {
    return new Cylindrical(this.radius, this.theta, this.y);
  }

  /** 从笛卡尔坐标设置柱坐标。
   *  radius = sqrt(x² + z²),theta = atan2(x, z),y = v.y。 */
  setFromVector3(v: Vector3): this {
    return this.setFromCartesianCoords(v.x, v.y, v.z);
  }

  setFromCartesianCoords(x: number, y: number, z: number): this {
    this.radius = Math.sqrt(x * x + z * z);
    this.theta = Math.atan2(x, z);
    this.y = y;
    return this;
  }
}

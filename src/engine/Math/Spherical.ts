// Spherical — 球坐标 (radius, phi, theta)。
// 参考 three.js Spherical.js:phi 是从 +y 轴量起的极角 [0, π],
// theta 是绕 +y 轴的方位角 [-π, π] (atan2 返回值范围)。
// 与 three.js 的差异:新增 restrictPhi / restrictTheta 用于交互式
// 相机控制器 (OrbitControls) 限制视角范围;three.js 原版只有 makeSafe。

import { clamp } from './MathUtils';
import type { Vector3 } from './Vector3';

export class Spherical {
  radius: number;
  phi: number;
  theta: number;

  constructor(radius = 1, phi = 0, theta = 0) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
  }

  set(radius: number, phi: number, theta: number): this {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
    return this;
  }

  copy(s: Spherical): this {
    this.radius = s.radius;
    this.phi = s.phi;
    this.theta = s.theta;
    return this;
  }

  clone(): Spherical {
    return new Spherical(this.radius, this.phi, this.theta);
  }

  /** 从笛卡尔坐标设置球坐标。
   *  phi = acos(y / radius),theta = atan2(x, z)。
   *  原点 (radius=0) 时 phi=theta=0,避免 NaN。 */
  setFromVector3(v: Vector3): this {
    return this.setFromCartesianCoords(v.x, v.y, v.z);
  }

  setFromCartesianCoords(x: number, y: number, z: number): this {
    this.radius = Math.sqrt(x * x + y * y + z * z);
    if (this.radius === 0) {
      this.theta = 0;
      this.phi = 0;
    } else {
      this.theta = Math.atan2(x, z);
      this.phi = Math.acos(clamp(y / this.radius, -1, 1));
    }
    return this;
  }

  /** 将 phi 限制在 [min, max] 范围内。用于 OrbitControls 限制俯仰角。 */
  restrictPhi(min: number, max: number): this {
    this.phi = clamp(this.phi, min, max);
    return this;
  }

  /** 将 theta 限制在 [min, max] 范围内。用于 OrbitControls 限制水平旋转。 */
  restrictTheta(min: number, max: number): this {
    this.theta = clamp(this.theta, min, max);
    return this;
  }
}

// PointLight — 点光源。
// 参考 three.js PointLight：从单点向四面八方均匀发光，带距离衰减。
// 物理上正确衰减使用 inverse-square（decay=2）。
//
// power getter/setter 把强度（cd 坎德拉）与光通量（lm 流明）互转：
//   各向同性点光源: 光通量(lm) = 4π × 发光强度(cd)

import { Light } from './Light';

export class PointLight extends Light {
  override readonly type: string = 'PointLight';
  /** 此标志可用于类型测试。 */
  isPointLight: boolean = true;

  /**
   * 最大照射距离。`0` 表示无限远，按 inverse-square 衰减到无穷；
   * 非 0 时在 cutoff 附近平滑过渡到 0（非物理正确，但便于美术控制）。
   */
  distance: number;

  /**
   * 距离衰减系数。物理正确值是 2（inverse-square）；改成 0/1 可得线性/常数衰减。
   */
  decay: number;

  constructor(
    color: number | string = 0xffffff,
    intensity = 1,
    distance = 0,
    decay = 2,
  ) {
    super(color, intensity);
    this.distance = distance;
    this.decay = decay;
  }

  /** 光通量（lm）。读取时由强度（cd）换算；写入时反向设置强度。 */
  get power(): number {
    return this.intensity * 4 * Math.PI;
  }

  set power(power: number) {
    this.intensity = power / (4 * Math.PI);
  }
}

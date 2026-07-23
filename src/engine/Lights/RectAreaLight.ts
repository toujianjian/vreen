// RectAreaLight — 矩形面光源。
// 参考 three.js RectAreaLight：从一块矩形平面均匀发光，可模拟窗户、
// 灯带等面状光源。
//
// 限制（与 three.js 一致）：
//   - 不支持阴影。
//   - 仅 PBR 材质支持（VREEN StandardMaterial）。
//
// power getter/setter 按 three.js 约定把强度（nit 尼特）与光通量（lm）互转：
//   矩形面光源: 光通量(lm) = 强度(nit) × 面积 × π

import { Light } from './Light';

export class RectAreaLight extends Light {
  override readonly type: string = 'RectAreaLight';
  /** 此标志可用于类型测试。 */
  isRectAreaLight: boolean = true;

  /** 矩形宽度（世界单位）。 */
  width: number;
  /** 矩形高度（世界单位）。 */
  height: number;

  constructor(
    color: number | string = 0xffffff,
    intensity = 1,
    width = 10,
    height = 10,
  ) {
    super(color, intensity);
    this.width = width;
    this.height = height;
  }

  /** 光通量（lm）。读取时由强度（nit）换算；写入时反向设置强度。 */
  get power(): number {
    return this.intensity * this.width * this.height * Math.PI;
  }

  set power(power: number) {
    this.intensity = power / (this.width * this.height * Math.PI);
  }
}

// HemisphereLight — 半球光。
// 参考 three.js HemisphereLight：光源位于场景正上方，颜色从天空色
// 渐变到地面色。不能投射阴影。
//
// 继承自 Light 的 `color` 字段在 three.js 原版中即天空色（skyColor），
// 这里保持同样语义：color = skyColor，新增 `groundColor` 表示地面色。
// 默认 position = (0,1,0)，与 three.js DEFAULT_UP 一致。

import { Light, parseColor, type RGBColor } from './Light';

export class HemisphereLight extends Light {
  override readonly type: string = 'HemisphereLight';
  /** 此标志可用于类型测试。 */
  isHemisphereLight: boolean = true;

  /** 地面反射光颜色。 */
  groundColor: RGBColor;

  constructor(
    skyColor: number | string = 0xffffff,
    groundColor: number | string = 0xffffff,
    intensity = 1,
  ) {
    super(skyColor, intensity);
    this.groundColor = parseColor(groundColor);
  }
}

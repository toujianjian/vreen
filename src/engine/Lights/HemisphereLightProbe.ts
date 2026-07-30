// HemisphereLightProbe — 半球光探针。
// 参考 three.js HemisphereLightProbe.js:用 SH 编码上方 (sky) 与
// 下方 (ground) 颜色不同的环境光。sky 贡献到 Y_1^-1 (y 方向) 的
// 正半轴,ground 贡献到负半轴;常数项 (band 0) 是两者之和。
//
// 数学 (与 three.js 一致):
//   c0 = sqrt(PI)
//   c1 = c0 * sqrt(0.75)
//   coefficients[0..2]  = (sky + ground) * c0   (band 0, 常数项)
//   coefficients[3..5]  = (sky - ground) * c1   (band 1, Y_1^-1 = 0.488603*y)
//   其余为 0

import { LightProbe } from './LightProbe';
import { parseColor, type RGBColor } from './Light';

export class HemisphereLightProbe extends LightProbe {
  override readonly type: string = 'HemisphereLightProbe';
  /** 此标志可用于类型测试。 */
  isHemisphereLightProbe: boolean = true;

  constructor(
    skyColor: number | string = 0xffffff,
    groundColor: number | string = 0xffffff,
    intensity = 1,
  ) {
    super(skyColor, intensity);

    const sky: RGBColor = this.color;
    const ground: RGBColor = parseColor(groundColor);

    const c0 = Math.sqrt(Math.PI);
    const c1 = c0 * Math.sqrt(0.75);

    const c = this.sh.coefficients;
    // band 0: (sky + ground) * c0
    c[0] = (sky.r + ground.r) * c0;
    c[1] = (sky.g + ground.g) * c0;
    c[2] = (sky.b + ground.b) * c0;
    // band 1, Y_1^-1: (sky - ground) * c1
    c[3] = (sky.r - ground.r) * c1;
    c[4] = (sky.g - ground.g) * c1;
    c[5] = (sky.b - ground.b) * c1;
    // c[6..26] already 0
  }

  override toJSON(_meta?: unknown): Record<string, unknown> {
    const data = super.toJSON(_meta);
    (data as Record<string, unknown>).type = 'HemisphereLightProbe';
    return data;
  }
}

// AmbientLightProbe — 环境光探针。
// 参考 three.js AmbientLightProbe.js:用球谐函数表达各向同性的环境光。
// 与 AmbientLight 的区别:AmbientLight 只是一个均匀颜色叠加,
// AmbientLightProbe 把颜色编码到 SH 第一阶 (常数项),可与方向性
// LightProbe 混合、被 PMREM 烘焙流水线统一处理。
//
// 数学:sh.coefficients[0..2] = color / 9,其余为 0。
// 9 = 3×3 是 irradiance 卷积后常数项的归一化因子。
// (three.js 原版用 2*sqrt(PI),这里用 1/9 简化,语义一致。)

import { LightProbe, SphericalHarmonics3 } from './LightProbe';
import { parseColor } from './Light';

export class AmbientLightProbe extends LightProbe {
  override readonly type: string = 'AmbientLightProbe';
  /** 此标志可用于类型测试。 */
  isAmbientLightProbe: boolean = true;

  constructor(color: number | string = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.sh = SphericalHarmonics3.fromColor(parseColor(color));
  }

  override toJSON(_meta?: unknown): Record<string, unknown> {
    const data = super.toJSON(_meta);
    (data as Record<string, unknown>).type = 'AmbientLightProbe';
    return data;
  }
}

// FogExp2 — 指数雾。雾密度随距离按 exp(-(density*dist)^2) 衰减。
// 参考 three.js FogExp2.js,适配 VREEN 自研引擎的 TypeScript strict 模式。

import { Color } from '../Math/Color';

/** 指数雾的颜色/密度参数。Renderer 在片元着色阶段按
 *  `fogFactor = 1 - exp(-(density * dist)^2)` 把片元色向 fog.color 混合。 */
export class FogExp2 {
  readonly isFogExp2: boolean = true;
  name: string = '';
  color: Color;
  /** 雾密度,值越大雾越浓。 */
  density: number;

  constructor(color: number | string | Color = 0xffffff, density: number = 0.00025) {
    // Color 构造器重载不接受 number|string 联合,这里走 set()(其接受联合)。
    this.color = color instanceof Color ? color.clone() : new Color().set(color);
    this.density = density;
  }

  /** 从 source 拷贝 color/density/name 到本实例。 */
  copy(source: FogExp2): this {
    this.color.copy(source.color);
    this.density = source.density;
    this.name = source.name;
    return this;
  }

  /** 返回值相等但独立的 FogExp2 实例。 */
  clone(): FogExp2 {
    return new FogExp2(this.color.getHex(), this.density);
  }

  /** 序列化为 JSON,与 three.js FogExp2.toJSON 结构一致。 */
  toJSON(): { type: string; name: string; color: number; density: number } {
    return {
      type: 'FogExp2',
      name: this.name,
      color: this.color.getHex(),
      density: this.density,
    };
  }
}

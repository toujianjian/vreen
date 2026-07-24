// Fog — 线性雾。颜色随距离在 near..far 之间线性插值到背景色。
// 参考 three.js Fog.js,适配 VREEN 自研引擎的 TypeScript strict 模式。

import { Color } from '../Math/Color';

/** 线性雾的颜色/距离参数。Renderer 在片元着色阶段按
 *  `fogFactor = (dist - near) / (far - near)` 把片元色向 fog.color 混合。 */
export class Fog {
  readonly isFog: boolean = true;
  name: string = '';
  color: Color;
  /** 雾开始生效的最小距离(小于此距离的片元不受雾影响)。 */
  near: number;
  /** 雾达到最大浓度的最大距离(大于此距离的片元完全为雾色)。 */
  far: number;

  constructor(color: number | string | Color = 0xffffff, near: number = 1, far: number = 1000) {
    // Color 构造器重载不接受 number|string 联合,这里走 set()(其接受联合)。
    this.color = color instanceof Color ? color.clone() : new Color().set(color);
    this.near = near;
    this.far = far;
  }

  /** 从 source 拷贝 color/near/far 到本实例。 */
  copy(source: Fog): this {
    this.color.copy(source.color);
    this.near = source.near;
    this.far = source.far;
    this.name = source.name;
    return this;
  }

  /** 返回值相等但独立的 Fog 实例。 */
  clone(): Fog {
    return new Fog(this.color.getHex(), this.near, this.far);
  }

  /** 序列化为 JSON,与 three.js Fog.toJSON 结构一致。 */
  toJSON(): { type: string; name: string; color: number; near: number; far: number } {
    return {
      type: 'Fog',
      name: this.name,
      color: this.color.getHex(),
      near: this.near,
      far: this.far,
    };
  }
}

// Light — 所有光源的抽象基类。
// 自研 Light 继承 Object3D 这样可以 scene.add()、访问 userData、matrixWorld
// 跟 Mesh/Group 在一个 scene graph 里统一遍历（WebGL2Renderer 通过 children
// 自动发现灯光，不需要单独维护 lightList）。
//
// DirectionalLight 的 direction 是 *光传播方向*（three.js 约定）：
// 默认 (0, -1, 0) 意味着光从上往下照；EngineDemoPage 里改成 (4, 8, 5) 表示
// 光从右上前方斜射下来。

import { Object3D } from '../Core/Object3D';

/** RGB 颜色（线性 0..1 分量）。 */
export type RGBColor = { r: number; g: number; b: number };

export abstract class Light extends Object3D {
  override readonly type: string = 'Light';
  isLight: boolean = true;
  color: RGBColor;
  intensity: number;

  constructor(color: number | string = 0xffffff, intensity = 1) {
    super();
    this.color = parseColor(color);
    this.intensity = intensity;
  }
}

/**
 * 将数字（0xRRGGBB）或 CSS hex 字符串解析为线性 RGB 分量。
 * 同时支持 3 位简写（#abc）与 6 位（#aabbcc）形式。
 */
export function parseColor(c: number | string): RGBColor {
  if (typeof c === 'number') {
    return { r: ((c >> 16) & 0xff) / 255, g: ((c >> 8) & 0xff) / 255, b: (c & 0xff) / 255 };
  }
  // CSS color (hex).
  const hex = c.replace('#', '');
  const v = parseInt(hex.length === 3
    ? hex.split('').map((c2) => c2 + c2).join('')
    : hex, 16);
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}

// AmbientLight — 环境光。
// 参考 three.js AmbientLight：全局均匀照明，无方向、无衰减、不能投射阴影。
// 仅仅作为基色给着色器叠加，常用来抬升暗部。

import { Light } from './Light';

export class AmbientLight extends Light {
  override readonly type: string = 'AmbientLight';
  /** 此标志可用于类型测试。 */
  isAmbientLight: boolean = true;

  constructor(color: number | string = 0xffffff, intensity = 1) {
    super(color, intensity);
  }
}

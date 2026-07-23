// SpotLight — 聚光灯。
// 参考 three.js SpotLight：从单点沿一个方向锥形发射，锥角随距离增大，
// 带 distance/decay 衰减与 penumbra 半影过渡。
//
// 默认 position = (0,1,0)（沿用 three.js Object3D.DEFAULT_UP 语义），
// 方向由 position → target 反推（target 需加入场景才能改默认位置）。
//
// power getter/setter 按 three.js 约定：
//   聚光灯: 光通量(lm) = π × 发光强度(cd)

import { Light } from './Light';
import { Object3D } from '../Core/Object3D';

export class SpotLight extends Light {
  override readonly type: string = 'SpotLight';
  /** 此标志可用于类型测试。 */
  isSpotLight: boolean = true;

  /** 光照指向的目标节点。 */
  target: Object3D;

  /** 最大照射距离，`0` 表示无限。 */
  distance: number;

  /**
   * 光锥最大发散角（弧度）。从方向轴向外测量，上界为 `Math.PI/2`。
   */
  angle: number;

  /**
   * 半影比例 ∈ [0,1]。0 = 硬边锥，1 = 整个锥内由中心到边缘线性衰减。
   */
  penumbra: number;

  /** 距离衰减系数，物理正确值 2。 */
  decay: number;

  constructor(
    color: number | string = 0xffffff,
    intensity = 1,
    distance = 0,
    angle: number = Math.PI / 3,
    penumbra = 0,
    decay = 2,
  ) {
    super(color, intensity);
    this.target = new Object3D();
    this.distance = distance;
    this.angle = angle;
    this.penumbra = penumbra;
    this.decay = decay;
  }

  /** 光通量（lm）。读取时由强度（cd）换算；写入时反向设置强度。 */
  get power(): number {
    return this.intensity * Math.PI;
  }

  set power(power: number) {
    this.intensity = power / Math.PI;
  }
}

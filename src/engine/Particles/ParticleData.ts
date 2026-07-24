// ParticleData — 单个粒子的完整状态。
//
// 设计:
// - 拥有独立的 position / velocity / acceleration / color / size / rotation
// - startColor/endColor + startSize/endSize 用于生命周期插值
// - customData: number[] 通用槽位,供 modifier 存储逐粒子状态
//   (例如 SubEmittersModifier 的触发标记、VelocityOverLife 的初始速度)
// - alive 标志由 ParticleSystem2 在 update 中维护;isAlive() 同时检查
//   alive 与 life < maxLife
// - reset() 把粒子恢复到"刚出厂"状态,配合 ParticleSystem2 的对象池复用

import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';

export class ParticleData {
  /** 世界位置。 */
  position: Vector3;
  /** 线速度 (m/s)。 */
  velocity: Vector3;
  /** 加速度 (m/s²),由 emitter.gravity 设置,可被 modifier 修改。 */
  acceleration: Vector3;
  /** 当前颜色 (r,g,b ∈ 0..1)。 */
  color: Color;
  /** 起始颜色 (生命周期 t=0)。 */
  startColor: Color;
  /** 结束颜色 (生命周期 t=1)。 */
  endColor: Color;
  /** 当前大小 (world units)。 */
  size: number;
  /** 起始大小。 */
  startSize: number;
  /** 结束大小。 */
  endSize: number;
  /** 已存活时间 (s)。 */
  life: number;
  /** 最大寿命 (s)。 */
  maxLife: number;
  /** 绕Billboard法线的旋转 (rad)。 */
  rotation: number;
  /** 角速度 (rad/s)。 */
  angularVelocity: number;
  /** 通用数据槽,modifier 自行约定含义。 */
  customData: number[];
  /** 是否存活(由系统在 update 中维护)。 */
  alive: boolean;

  constructor() {
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.acceleration = new Vector3();
    this.color = new Color(1, 1, 1);
    this.startColor = new Color(1, 1, 1);
    this.endColor = new Color(1, 1, 1);
    this.size = 0.1;
    this.startSize = 0.1;
    this.endSize = 0.1;
    this.life = 0;
    this.maxLife = 1;
    this.rotation = 0;
    this.angularVelocity = 0;
    this.customData = [];
    this.alive = true;
  }

  /** 重置到出厂状态,供对象池复用。 */
  reset(): void {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.color.setRGB(1, 1, 1);
    this.startColor.setRGB(1, 1, 1);
    this.endColor.setRGB(1, 1, 1);
    this.size = 0.1;
    this.startSize = 0.1;
    this.endSize = 0.1;
    this.life = 0;
    this.maxLife = 1;
    this.rotation = 0;
    this.angularVelocity = 0;
    this.customData.length = 0;
    this.alive = true;
  }

  /** 粒子是否存活:alive 标志为真且未超过最大寿命。 */
  isAlive(): boolean {
    return this.alive && this.life < this.maxLife;
  }
}

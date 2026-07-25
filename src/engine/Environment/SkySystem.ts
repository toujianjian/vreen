// SkySystem — 天空系统(日夜循环)。
//
// 设计:
//   * timeOfDay: 0..24, 小数表示分钟
//   * 太阳/月亮位置由时间映射成轨道角度,地平线为 XZ 平面,Y 朝上
//   * 太阳从东方升起(X 轴负向),经过天顶,在西方落下
//   * 月亮位置与太阳相反(180°)
//   * 颜色随时间分四段插值:黎明 / 白天 / 黄昏 / 夜晚
//
// 与 WeatherSystem 的关系:
//   * 天气可叠加 dim 系数,这里不直接耦合
//   * 外部读取 sunColor / skyColor 后自行与天气混合

import { Vector3 } from '../Math';
import { Color } from '../Math';

/** 时间段(用于分段颜色插值)。 */
export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

/** 天空颜色关键帧(按 timeOfDay 升序)。 */
interface SkyKeyframe {
  /** 时间(0..24)。 */
  time: number;
  /** 太阳颜色。 */
  sunColor: Color;
  /** 天空颜色。 */
  skyColor: Color;
  /** 地平线颜色。 */
  horizonColor: Color;
  /** 星光强度(0..1)。 */
  starIntensity: number;
  /** 太阳光强度(0..1)。 */
  sunIntensity: number;
}

// 4 个关键帧(夜晚 / 黎明 / 中午 / 黄昏),其余时间在两点之间插值
const SKY_KEYFRAMES: SkyKeyframe[] = [
  {
    time: 0, // 子夜
    sunColor: new Color(0.1, 0.1, 0.2),
    skyColor: new Color(0.02, 0.03, 0.08),
    horizonColor: new Color(0.05, 0.05, 0.1),
    starIntensity: 1.0,
    sunIntensity: 0.0,
  },
  {
    time: 6, // 日出
    sunColor: new Color(1.0, 0.6, 0.3),
    skyColor: new Color(0.6, 0.4, 0.3),
    horizonColor: new Color(0.9, 0.5, 0.3),
    starIntensity: 0.2,
    sunIntensity: 0.6,
  },
  {
    time: 12, // 正午
    sunColor: new Color(1.0, 1.0, 0.95),
    skyColor: new Color(0.4, 0.6, 0.9),
    horizonColor: new Color(0.75, 0.85, 0.95),
    starIntensity: 0.0,
    sunIntensity: 1.0,
  },
  {
    time: 18, // 日落
    sunColor: new Color(1.0, 0.5, 0.2),
    skyColor: new Color(0.7, 0.4, 0.3),
    horizonColor: new Color(0.9, 0.4, 0.2),
    starIntensity: 0.3,
    sunIntensity: 0.5,
  },
  {
    time: 24, // 次日子夜(与 time=0 一致,便于跨 24 边界插值)
    sunColor: new Color(0.1, 0.1, 0.2),
    skyColor: new Color(0.02, 0.03, 0.08),
    horizonColor: new Color(0.05, 0.05, 0.1),
    starIntensity: 1.0,
    sunIntensity: 0.0,
  },
];

/** 计算太阳轨道角度(从 +X 轴绕 Z 轴顺时针,匹配天空关键帧)。
 *  hours: 0..24
 *  返回弧度:0 对应 +X(东方),π/2 对应 +Y(天顶),π 对应 -X(西方) */
function sunAngleAt(hours: number): number {
  // 6:00 → 0 (东, +X),12:00 → π/2 (天顶),18:00 → π (西, -X)
  // 0:00 → 3π/2 (地下),22:00 → ... 
  // 公式: angle = (hours - 6) / 24 * 2π
  return ((hours - 6) / 24) * Math.PI * 2;
}

/**
 * 天空系统 — 时间驱动太阳/月亮位置与天空颜色。
 */
export class SkySystem {
  /** 当前时间(0..24,小数表示分钟)。 */
  timeOfDay: number = 8; // 默认 8:00 上午
  /** 太阳位置(世界坐标,长度约 1)。 */
  sunPosition: Vector3 = new Vector3();
  /** 月亮位置(与太阳相反方向)。 */
  moonPosition: Vector3 = new Vector3();
  /** 太阳颜色(经时间插值)。 */
  sunColor: Color = new Color();
  /** 天空颜色(经时间插值)。 */
  skyColor: Color = new Color();
  /** 地平线颜色(经时间插值)。 */
  horizonColor: Color = new Color();
  /** 星光强度(0..1)。 */
  starIntensity: number = 0;
  /** 太阳光强度(0..1)。 */
  sunIntensity: number = 1;
  /** 时间流逝速度(默认 1,>1 加速)。 */
  daySpeed: number = 1;
  /** 是否激活(若 false,update 不推进时间)。 */
  enabled: boolean = true;

  constructor(initialHours: number = 8) {
    this.setTime(initialHours);
  }

  /** 推进时间。
   *  dt: 实际帧时间(秒)。
   *  实际游戏内时间增量 = dt * daySpeed / 60 (即 60 秒 = 1 小时 @ speed=1)。 */
  update(dt: number): this {
    if (!this.enabled) return this;
    const hoursDelta = (dt * this.daySpeed) / 60;
    this.timeOfDay = (this.timeOfDay + hoursDelta) % 24;
    if (this.timeOfDay < 0) this.timeOfDay += 24;
    this.recompute();
    return this;
  }

  /** 设置时间(0..24),立即重算太阳/月亮/颜色。 */
  setTime(hours: number): this {
    let h = hours % 24;
    if (h < 0) h += 24;
    this.timeOfDay = h;
    this.recompute();
    return this;
  }

  /** 获取太阳方向(指向太阳,长度 1)。 */
  getSunDirection(): Vector3 {
    return this.sunPosition.clone();
  }

  /** 获取月亮方向(指向月亮,长度 1)。 */
  getMoonDirection(): Vector3 {
    return this.moonPosition.clone();
  }

  /** 获取天空颜色(克隆)。 */
  getSkyColor(): Color {
    return this.skyColor.clone();
  }

  /** 是否白天(太阳在地平线以上)。 */
  isDaytime(): boolean {
    return this.sunPosition.y > 0;
  }

  /** 内部:根据 timeOfDay 重算所有派生量。 */
  private recompute(): void {
    // 1. 太阳位置
    const ang = sunAngleAt(this.timeOfDay);
    this.sunPosition.set(Math.cos(ang), Math.sin(ang), 0.2).normalize();
    // 月亮位置 = -sunPosition
    this.moonPosition.copy(this.sunPosition).multiplyScalar(-1);

    // 2. 找到当前时间所在的两个关键帧,做线性插值
    let k0 = SKY_KEYFRAMES[0];
    let k1 = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
    for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
      if (this.timeOfDay >= SKY_KEYFRAMES[i].time && this.timeOfDay <= SKY_KEYFRAMES[i + 1].time) {
        k0 = SKY_KEYFRAMES[i];
        k1 = SKY_KEYFRAMES[i + 1];
        break;
      }
    }
    const span = k1.time - k0.time;
    const t = span > 0 ? (this.timeOfDay - k0.time) / span : 0;
    this.sunColor.copy(k0.sunColor).lerp(k1.sunColor, t);
    this.skyColor.copy(k0.skyColor).lerp(k1.skyColor, t);
    this.horizonColor.copy(k0.horizonColor).lerp(k1.horizonColor, t);
    this.starIntensity = k0.starIntensity + (k1.starIntensity - k0.starIntensity) * t;
    this.sunIntensity = k0.sunIntensity + (k1.sunIntensity - k0.sunIntensity) * t;
  }

  /** 获取当前时间段(夜晚 / 黎明 / 白天 / 黄昏)。 */
  getPhase(): DayPhase {
    const t = this.timeOfDay;
    if (t < 5 || t >= 20) return 'night';
    if (t < 7) return 'dawn';
    if (t < 17) return 'day';
    return 'dusk';
  }
}

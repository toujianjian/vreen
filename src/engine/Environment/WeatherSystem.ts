// WeatherSystem — 天气系统(综合天气类型 / 强度 / 风 / 雾 / 光照)。
//
// 设计:
//   * 持单一 source-of-truth:当前 type / intensity / wind / temperature / humidity
//   * transitionTo(type, duration) 平滑过渡,update(dt) 推进过渡进度
//   * 与 SkySystem / CloudSystem / PrecipitationSystem 解耦:
//       WeatherSystem 只产出 WeatherData(供着色器/外部系统读取)
//       实际可见效果(粒子/云量/雾)由外部系统消费 WeatherData 后各自实现
//   * 渲染端不直接依赖任何 GL 对象,纯数据 + 时间推进
//
// 天气类型:
//   * clear   晴朗
//   * rain    雨
//   * snow    雪
//   * fog     雾
//   * storm   暴风雨(雨 + 强风 + 雷电)

import { Vector3 } from '../Math';
import { Color } from '../Math';

/** 天气类型。 */
export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog' | 'storm';

/** 天气数据(供着色器或外部系统消费)。 */
export interface WeatherData {
  /** 当前天气类型(过渡完成后即为目标类型)。 */
  type: WeatherType;
  /** 强度(0..1)。 */
  intensity: number;
  /** 风向(归一化)。 */
  windDirection: Vector3;
  /** 风强(m/s)。 */
  windStrength: number;
  /** 温度(摄氏度)。 */
  temperature: number;
  /** 湿度(0..1)。 */
  humidity: number;
  /** 雾密度(0..1)。 */
  fogDensity: number;
  /** 雾色。 */
  fogColor: Color;
  /** 环境光强度(0..1)。 */
  ambientIntensity: number;
  /** 太阳光强度(0..1)。 */
  sunIntensity: number;
}

/** 天气预设(根据 type 决定默认参数)。 */
const WEATHER_PRESETS: Record<WeatherType, Omit<WeatherData, 'type' | 'windDirection'>> = {
  clear: {
    intensity: 0,
    windStrength: 1,
    temperature: 22,
    humidity: 0.4,
    fogDensity: 0.01,
    fogColor: new Color(0.8, 0.85, 0.9),
    ambientIntensity: 0.6,
    sunIntensity: 1.0,
  },
  rain: {
    intensity: 0.6,
    windStrength: 4,
    temperature: 15,
    humidity: 0.85,
    fogDensity: 0.05,
    fogColor: new Color(0.5, 0.55, 0.6),
    ambientIntensity: 0.4,
    sunIntensity: 0.4,
  },
  snow: {
    intensity: 0.5,
    windStrength: 2,
    temperature: -3,
    humidity: 0.75,
    fogDensity: 0.04,
    fogColor: new Color(0.85, 0.85, 0.9),
    ambientIntensity: 0.5,
    sunIntensity: 0.5,
  },
  fog: {
    intensity: 0.5,
    windStrength: 0.5,
    temperature: 18,
    humidity: 0.95,
    fogDensity: 0.15,
    fogColor: new Color(0.7, 0.7, 0.7),
    ambientIntensity: 0.5,
    sunIntensity: 0.5,
  },
  storm: {
    intensity: 0.9,
    windStrength: 8,
    temperature: 12,
    humidity: 0.95,
    fogDensity: 0.08,
    fogColor: new Color(0.3, 0.3, 0.35),
    ambientIntensity: 0.3,
    sunIntensity: 0.2,
  },
};

/** 过渡状态。 */
interface TransitionState {
  from: WeatherType;
  to: WeatherType;
  elapsed: number;
  duration: number;
  // 起始/结束的预设参数(用于插值)
  fromPreset: Omit<WeatherData, 'type' | 'windDirection'>;
  toPreset: Omit<WeatherData, 'type' | 'windDirection'>;
}

const _tmpColor = new Color();

/**
 * 天气系统 — 单实例管理当前天气状态与过渡。
 *
 * 用法:
 *   const ws = new WeatherSystem();
 *   ws.setWeather('rain', 0.5);
 *   ws.transitionTo('snow', 5);  // 5 秒过渡到雪
 *   ws.update(dt);
 *   const data = ws.getWeatherData(); // 传给着色器
 */
export class WeatherSystem {
  /** 当前天气类型。 */
  type: WeatherType = 'clear';
  /** 当前强度(0..1)。 */
  intensity: number = 0;
  /** 风向(归一化)。 */
  windDirection: Vector3 = new Vector3(1, 0, 0);
  /** 风强(m/s)。 */
  windStrength: number = 1;
  /** 温度(摄氏度)。 */
  temperature: number = 22;
  /** 湿度(0..1)。 */
  humidity: number = 0.4;
  /** 雾密度(0..1)。 */
  fogDensity: number = 0.01;
  /** 雾色。 */
  fogColor: Color = new Color(0.8, 0.85, 0.9);
  /** 环境光强度。 */
  ambientIntensity: number = 0.6;
  /** 太阳光强度。 */
  sunIntensity: number = 1.0;
  /** 当前过渡状态(无过渡时为 null)。 */
  transition: TransitionState | null = null;

  /** 直接设置天气(立即生效,无过渡)。
   *  注意:intensity 参数会覆盖预设的 intensity,优先使用调用方传入的值。 */
  setWeather(type: WeatherType, intensity: number): this {
    this.type = type;
    const preset = WEATHER_PRESETS[type];
    this.applyPreset(preset);
    // 调用方传入的 intensity 优先于预设
    this.intensity = intensity;
    this.transition = null;
    return this;
  }

  /** 平滑过渡到目标天气(在 duration 秒内线性插值)。 */
  transitionTo(type: WeatherType, duration: number): this {
    if (duration <= 0) {
      return this.setWeather(type, WEATHER_PRESETS[type].intensity);
    }
    this.transition = {
      from: this.type,
      to: type,
      elapsed: 0,
      duration,
      fromPreset: this.snapshotPreset(),
      toPreset: { ...WEATHER_PRESETS[type] },
    };
    // type 在过渡完成后再切换;过渡期间 intensity 渐变
    return this;
  }

  /** 推进时间。
   *  dt: 秒。 */
  update(dt: number): this {
    if (!this.transition) return this;
    this.transition.elapsed += dt;
    const t = Math.min(1, this.transition.elapsed / this.transition.duration);
    this.lerpPreset(this.transition.fromPreset, this.transition.toPreset, t);
    if (t >= 1) {
      this.type = this.transition.to;
      this.transition = null;
    }
    return this;
  }

  /** 获取天气数据快照(用于着色器 uniforms)。 */
  getWeatherData(): WeatherData {
    return {
      type: this.type,
      intensity: this.intensity,
      windDirection: this.windDirection.clone(),
      windStrength: this.windStrength,
      temperature: this.temperature,
      humidity: this.humidity,
      fogDensity: this.fogDensity,
      fogColor: this.fogColor.clone(),
      ambientIntensity: this.ambientIntensity,
      sunIntensity: this.sunIntensity,
    };
  }

  /** 设置风向(自动归一化)。 */
  setWindDirection(dir: Vector3): this {
    this.windDirection.copy(dir);
    const len = this.windDirection.length();
    if (len > 0) this.windDirection.multiplyScalar(1 / len);
    return this;
  }

  /** 设置风强。 */
  setWindStrength(strength: number): this {
    this.windStrength = Math.max(0, strength);
    return this;
  }

  /** 应用一个预设到当前状态。 */
  private applyPreset(preset: Omit<WeatherData, 'type' | 'windDirection'>): void {
    this.intensity = preset.intensity;
    this.windStrength = preset.windStrength;
    this.temperature = preset.temperature;
    this.humidity = preset.humidity;
    this.fogDensity = preset.fogDensity;
    this.fogColor.copy(preset.fogColor);
    this.ambientIntensity = preset.ambientIntensity;
    this.sunIntensity = preset.sunIntensity;
  }

  /** 拍摄当前参数快照为预设。 */
  private snapshotPreset(): Omit<WeatherData, 'type' | 'windDirection'> {
    return {
      intensity: this.intensity,
      windStrength: this.windStrength,
      temperature: this.temperature,
      humidity: this.humidity,
      fogDensity: this.fogDensity,
      fogColor: this.fogColor.clone(),
      ambientIntensity: this.ambientIntensity,
      sunIntensity: this.sunIntensity,
    };
  }

  /** 在两个预设之间线性插值。 */
  private lerpPreset(
    a: Omit<WeatherData, 'type' | 'windDirection'>,
    b: Omit<WeatherData, 'type' | 'windDirection'>,
    t: number,
  ): void {
    this.intensity = a.intensity + (b.intensity - a.intensity) * t;
    this.windStrength = a.windStrength + (b.windStrength - a.windStrength) * t;
    this.temperature = a.temperature + (b.temperature - a.temperature) * t;
    this.humidity = a.humidity + (b.humidity - a.humidity) * t;
    this.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
    this.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
    this.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
    // Color.lerp 改自身,用 _tmpColor 借力
    _tmpColor.copy(a.fogColor);
    _tmpColor.lerp(b.fogColor, t);
    this.fogColor.copy(_tmpColor);
  }
}

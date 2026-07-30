// WeatherSystem — 动态天气系统(雨/雪/雾/雷电/风 + 天气过渡)。
//
// 设计:
//   * 持单一 source-of-truth:当前/目标天气类型 + 强度 + 风 + 温湿度 + 雾 + 云量 + 时间
//   * setWeather(type, duration) 平滑过渡,update(dt) 推进过渡进度并插值参数
//   * 雷电子系统:storm 天气下自动随机触发闪电,triggerLightning() 手动触发,
//     getLightningFlash() 返回当前闪烁强度(供着色器/后处理消费)
//   * 与 SkySystem / CloudSystem / PrecipitationSystem 解耦:
//       WeatherSystem 只产出参数与 uniform,实际可见效果由外部系统消费
//   * 渲染端不直接依赖任何 GL 对象,纯数据 + 时间推进
//
// 天气类型:
//   * clear      晴朗
//   * cloudy     多云
//   * rain       雨
//   * heavyRain  大雨
//   * snow       雪
//   * fog        雾
//   * storm      暴风雨(雨 + 强风 + 雷电)
//   * sandstorm  沙尘暴

import { Vector3 } from '../Math';

/** 天气类型。 */
export type WeatherType =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'heavyRain'
  | 'snow'
  | 'fog'
  | 'storm'
  | 'sandstorm';

/** 雾色(RGB,0..1)。 */
export interface WeatherFogColor {
  r: number;
  g: number;
  b: number;
}

/** 天气参数快照(供外部系统消费)。 */
export interface WeatherParams {
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
  fogColor: WeatherFogColor;
  /** 云量(0..1)。 */
  cloudCoverage: number;
  /** 时间(0..24)。 */
  timeOfDay: number;
  /** 是否启用雷电。 */
  lightningEnabled: boolean;
}

/** 着色器 uniform(扁平化,可直接灌入 GLSL)。 */
export interface WeatherShaderUniforms {
  /** 天气强度。 */
  u_weatherIntensity: number;
  /** 风向(vec3)。 */
  u_windDirection: [number, number, number];
  /** 风强。 */
  u_windStrength: number;
  /** 雾密度。 */
  u_fogDensity: number;
  /** 雾色(vec3)。 */
  u_fogColor: [number, number, number];
  /** 云量。 */
  u_cloudCoverage: number;
  /** 时间(0..24)。 */
  u_timeOfDay: number;
  /** 闪电闪烁强度(0..1)。 */
  u_lightningFlash: number;
  /** 天气类型枚举(0..7)。 */
  u_weatherType: number;
}

/** 天气预设(根据 type 决定默认参数)。 */
interface WeatherPreset {
  intensity: number;
  windStrength: number;
  temperature: number;
  humidity: number;
  fogDensity: number;
  fogColor: WeatherFogColor;
  cloudCoverage: number;
}

const WEATHER_PRESETS: Record<WeatherType, WeatherPreset> = {
  clear: {
    intensity: 0.0,
    windStrength: 1,
    temperature: 22,
    humidity: 0.4,
    fogDensity: 0.01,
    fogColor: { r: 0.8, g: 0.85, b: 0.9 },
    cloudCoverage: 0.1,
  },
  cloudy: {
    intensity: 0.2,
    windStrength: 2,
    temperature: 20,
    humidity: 0.55,
    fogDensity: 0.02,
    fogColor: { r: 0.7, g: 0.72, b: 0.75 },
    cloudCoverage: 0.7,
  },
  rain: {
    intensity: 0.5,
    windStrength: 4,
    temperature: 15,
    humidity: 0.85,
    fogDensity: 0.05,
    fogColor: { r: 0.5, g: 0.55, b: 0.6 },
    cloudCoverage: 0.85,
  },
  heavyRain: {
    intensity: 0.85,
    windStrength: 6,
    temperature: 13,
    humidity: 0.92,
    fogDensity: 0.08,
    fogColor: { r: 0.4, g: 0.42, b: 0.45 },
    cloudCoverage: 0.95,
  },
  snow: {
    intensity: 0.5,
    windStrength: 2,
    temperature: -3,
    humidity: 0.75,
    fogDensity: 0.04,
    fogColor: { r: 0.85, g: 0.85, b: 0.9 },
    cloudCoverage: 0.8,
  },
  fog: {
    intensity: 0.5,
    windStrength: 0.5,
    temperature: 18,
    humidity: 0.95,
    fogDensity: 0.15,
    fogColor: { r: 0.7, g: 0.7, b: 0.7 },
    cloudCoverage: 0.5,
  },
  storm: {
    intensity: 0.9,
    windStrength: 8,
    temperature: 12,
    humidity: 0.95,
    fogDensity: 0.08,
    fogColor: { r: 0.3, g: 0.3, b: 0.35 },
    cloudCoverage: 0.98,
  },
  sandstorm: {
    intensity: 0.8,
    windStrength: 10,
    temperature: 35,
    humidity: 0.1,
    fogDensity: 0.12,
    fogColor: { r: 0.76, g: 0.6, b: 0.35 },
    cloudCoverage: 0.0,
  },
};

/** 天气类型 → 着色器枚举值。 */
const WEATHER_TYPE_INDEX: Record<WeatherType, number> = {
  clear: 0,
  cloudy: 1,
  rain: 2,
  heavyRain: 3,
  snow: 4,
  fog: 5,
  storm: 6,
  sandstorm: 7,
};

/** 所有天气类型列表。 */
const WEATHER_LIST: WeatherType[] = [
  'clear',
  'cloudy',
  'rain',
  'heavyRain',
  'snow',
  'fog',
  'storm',
  'sandstorm',
];

/** 雷电自动触发间隔下限(秒)。 */
const LIGHTNING_MIN_INTERVAL = 3;
/** 雷电自动触发间隔上限(秒)。 */
const LIGHTNING_MAX_INTERVAL = 8;
/** 闪电闪烁衰减速率(1/秒,越大衰减越快)。 */
const LIGHTNING_DECAY_RATE = 5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 天气系统 — 单实例管理当前天气状态、平滑过渡与雷电。
 *
 * 用法:
 *   const ws = new WeatherSystem();
 *   ws.setWeather('rain', 5);     // 5 秒过渡到雨
 *   ws.enableLightning(true);     // 启用雷电(仅 storm 自动触发)
 *   ws.update(dt);
 *   const uniforms = ws.getShaderUniforms(); // 传给着色器
 */
export class WeatherSystem {
  /** 当前天气类型(过渡完成后切换为目标类型)。 */
  currentWeather: WeatherType = 'clear';
  /** 目标天气类型。 */
  targetWeather: WeatherType = 'clear';
  /** 过渡进度(0..1,1 表示无过渡进行中)。 */
  transitionProgress: number = 1;
  /** 过渡持续时间(秒)。 */
  transitionDuration: number = 0;
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
  /** 雾色(RGB,0..1)。 */
  fogColor: WeatherFogColor = { r: 0.8, g: 0.85, b: 0.9 };
  /** 云量(0..1)。 */
  cloudCoverage: number = 0.1;
  /** 时间(0..24)。 */
  timeOfDay: number = 12;
  /** 是否启用雷电自动触发。 */
  lightningEnabled: boolean = false;
  /** 雷电触发计时器(秒,<=0 时触发下次闪电)。 */
  lightningTimer: number = 0;

  /** 当前闪电闪烁强度(0..1,update 中衰减)。 */
  private _flashIntensity: number = 0;
  /** 过渡起始预设快照。 */
  private _fromPreset: WeatherPreset | null = null;
  /** 过渡目标预设快照。 */
  private _toPreset: WeatherPreset | null = null;

  /** 设置天气(带过渡)。
   *  duration <= 0 时立即切换。 */
  setWeather(type: WeatherType, duration: number): this {
    if (duration <= 0) {
      return this.setWeatherImmediate(type);
    }
    this.targetWeather = type;
    this.transitionDuration = duration;
    this.transitionProgress = 0;
    this._fromPreset = this._snapshotPreset();
    this._toPreset = { ...WEATHER_PRESETS[type], fogColor: { ...WEATHER_PRESETS[type].fogColor } };
    return this;
  }

  /** 立即切换天气(无过渡)。 */
  setWeatherImmediate(type: WeatherType): this {
    this.currentWeather = type;
    this.targetWeather = type;
    this.transitionProgress = 1;
    this.transitionDuration = 0;
    this._fromPreset = null;
    this._toPreset = null;
    this._applyPreset(WEATHER_PRESETS[type]);
    return this;
  }

  /** 设置强度(0..1)。 */
  setIntensity(intensity: number): this {
    this.intensity = clamp(intensity, 0, 1);
    return this;
  }

  /** 设置风(方向自动归一化)。 */
  setWind(direction: Vector3, strength: number): this {
    this.windDirection.copy(direction);
    const len = this.windDirection.length();
    if (len > 0) this.windDirection.multiplyScalar(1 / len);
    this.windStrength = Math.max(0, strength);
    return this;
  }

  /** 设置温度(摄氏度)。 */
  setTemperature(temp: number): this {
    this.temperature = temp;
    return this;
  }

  /** 设置湿度(0..1)。 */
  setHumidity(humidity: number): this {
    this.humidity = clamp(humidity, 0, 1);
    return this;
  }

  /** 设置雾(密度 + 颜色)。 */
  setFog(density: number, color: WeatherFogColor): this {
    this.fogDensity = clamp(density, 0, 1);
    this.fogColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置云量(0..1)。 */
  setCloudCoverage(coverage: number): this {
    this.cloudCoverage = clamp(coverage, 0, 1);
    return this;
  }

  /** 设置时间(0..24,自动回绕)。 */
  setTimeOfDay(time: number): this {
    this.timeOfDay = ((time % 24) + 24) % 24;
    return this;
  }

  /** 启用/禁用雷电自动触发。 */
  enableLightning(enabled: boolean): this {
    this.lightningEnabled = enabled;
    if (enabled && this.lightningTimer <= 0) {
      this._resetLightningTimer();
    }
    if (!enabled) {
      this._flashIntensity = 0;
      this.lightningTimer = 0;
    }
    return this;
  }

  /** 更新:推进过渡 / 闪烁衰减 / 雷电触发。
   *  注意:闪烁衰减在雷电触发之前执行,确保触发帧闪烁强度为 1(下一帧起衰减)。
   *  dt: 秒。 */
  update(dt: number): this {
    if (dt < 0) dt = 0;
    // 过渡推进
    if (this.transitionProgress < 1 && this._fromPreset && this._toPreset) {
      this.transitionProgress = Math.min(1, this.transitionProgress + dt / this.transitionDuration);
      this._lerpPreset(this._fromPreset, this._toPreset, this.transitionProgress);
      if (this.transitionProgress >= 1) {
        this.currentWeather = this.targetWeather;
        this._fromPreset = null;
        this._toPreset = null;
      }
    }
    // 闪烁衰减(先衰减,再判定触发,使触发帧强度为 1)
    if (this._flashIntensity > 0) {
      this._flashIntensity = Math.max(0, this._flashIntensity - LIGHTNING_DECAY_RATE * dt);
    }
    // 雷电自动触发(仅 storm 天气)
    if (this.lightningEnabled && this.currentWeather === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.triggerLightning();
        this._resetLightningTimer();
      }
    }
    return this;
  }

  /** 获取当前天气类型。 */
  getCurrentWeather(): WeatherType {
    return this.currentWeather;
  }

  /** 获取天气参数快照。 */
  getWeatherParams(): WeatherParams {
    return {
      intensity: this.intensity,
      windDirection: this.windDirection.clone(),
      windStrength: this.windStrength,
      temperature: this.temperature,
      humidity: this.humidity,
      fogDensity: this.fogDensity,
      fogColor: { r: this.fogColor.r, g: this.fogColor.g, b: this.fogColor.b },
      cloudCoverage: this.cloudCoverage,
      timeOfDay: this.timeOfDay,
      lightningEnabled: this.lightningEnabled,
    };
  }

  /** 手动触发一次闪电(无视 lightningEnabled 与天气类型)。 */
  triggerLightning(): this {
    this._flashIntensity = 1;
    return this;
  }

  /** 获取当前闪电闪烁强度(0..1)。 */
  getLightningFlash(): number {
    return this._flashIntensity;
  }

  /** 获取着色器 uniform(扁平化)。 */
  getShaderUniforms(): WeatherShaderUniforms {
    return {
      u_weatherIntensity: this.intensity,
      u_windDirection: [this.windDirection.x, this.windDirection.y, this.windDirection.z],
      u_windStrength: this.windStrength,
      u_fogDensity: this.fogDensity,
      u_fogColor: [this.fogColor.r, this.fogColor.g, this.fogColor.b],
      u_cloudCoverage: this.cloudCoverage,
      u_timeOfDay: this.timeOfDay,
      u_lightningFlash: this._flashIntensity,
      u_weatherType: WEATHER_TYPE_INDEX[this.currentWeather],
    };
  }

  /** 获取所有天气类型列表。 */
  getWeatherList(): WeatherType[] {
    return WEATHER_LIST.slice();
  }

  // ---------- 内部辅助 ----------

  /** 重置雷电计时器为随机间隔。 */
  private _resetLightningTimer(): void {
    this.lightningTimer =
      LIGHTNING_MIN_INTERVAL + Math.random() * (LIGHTNING_MAX_INTERVAL - LIGHTNING_MIN_INTERVAL);
  }

  /** 应用一个预设到当前状态。 */
  private _applyPreset(preset: WeatherPreset): void {
    this.intensity = preset.intensity;
    this.windStrength = preset.windStrength;
    this.temperature = preset.temperature;
    this.humidity = preset.humidity;
    this.fogDensity = preset.fogDensity;
    this.fogColor = { r: preset.fogColor.r, g: preset.fogColor.g, b: preset.fogColor.b };
    this.cloudCoverage = preset.cloudCoverage;
  }

  /** 拍摄当前参数快照为预设。 */
  private _snapshotPreset(): WeatherPreset {
    return {
      intensity: this.intensity,
      windStrength: this.windStrength,
      temperature: this.temperature,
      humidity: this.humidity,
      fogDensity: this.fogDensity,
      fogColor: { r: this.fogColor.r, g: this.fogColor.g, b: this.fogColor.b },
      cloudCoverage: this.cloudCoverage,
    };
  }

  /** 在两个预设之间线性插值并写回当前状态。 */
  private _lerpPreset(a: WeatherPreset, b: WeatherPreset, t: number): void {
    this.intensity = lerp(a.intensity, b.intensity, t);
    this.windStrength = lerp(a.windStrength, b.windStrength, t);
    this.temperature = lerp(a.temperature, b.temperature, t);
    this.humidity = lerp(a.humidity, b.humidity, t);
    this.fogDensity = lerp(a.fogDensity, b.fogDensity, t);
    this.cloudCoverage = lerp(a.cloudCoverage, b.cloudCoverage, t);
    this.fogColor = {
      r: lerp(a.fogColor.r, b.fogColor.r, t),
      g: lerp(a.fogColor.g, b.fogColor.g, t),
      b: lerp(a.fogColor.b, b.fogColor.b, t),
    };
  }
}

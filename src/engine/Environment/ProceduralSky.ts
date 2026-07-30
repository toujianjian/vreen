// ProceduralSky — 程序化天空 (Preetham 大气散射近似 + 太阳/月亮/星星/云)。
//
// 设计:
//   * 与 SkySystem 互补:SkySystem 用关键帧插值驱动颜色 (轻量、可控);
//     ProceduralSky 基于物理近似 (瑞利 + 米氏散射),面向"写实现感强、
//     可对接 shader uniform"的场景。
//   * 太阳/月亮位置由 timeOfDay + latitude + dayOfYear 通过天文学公式计算
//     (太阳赤纬 + 时角 → 高度角/方位角)。
//   * 大气散射采用 Preetham 1999 的解析近似:
//       - 瑞利散射 (Rayleigh):短波 (蓝) 强散射,天空呈蓝色;
//       - 米氏散射 (Mie):气溶胶前向散射,太阳周围呈白光晕;
//       - 浊度 (turbidity) 综合反映气溶胶浓度。
//   * 星空:球面均匀分布 + 亮度幂分布,只在太阳低于地平线时启用。
//   * 输出 getShaderUniforms() 供上层材质/天空盒直接消费。
//
// 与 SkySystem 的关系:
//   * 二者独立,不互继承;调用方按需选用或组合 (ProceduralSky 提供物理量,
//     SkySystem 提供关键帧艺术调色)。

import { Vector3 } from '../Math/Vector3';

/** RGB 颜色三元组 (0..1 线性)。 */
export interface SkyRGB {
  r: number;
  g: number;
  b: number;
}

/** 大气散射结果。 */
export interface AtmosphereSample {
  /** 透射率 (经散射衰减后的剩余光强)。 */
  transmittance: SkyRGB;
  /** 散射光 (来自太阳的方向光散射到 view 方向)。 */
  scatter: SkyRGB;
  /** 合成颜色 = sunColor * (transmittance + scatter)。 */
  color: SkyRGB;
}

/** 程序化天空统计。 */
export interface ProceduralSkyStats {
  /** 当前时间 (0..24)。 */
  timeOfDay: number;
  /** 太阳高度角 (弧度,0=地平线,π/2=天顶)。 */
  sunAltitude: number;
  /** 太阳方位角 (弧度,0=正北,顺时针)。 */
  sunAzimuth: number;
  /** 月亮高度角 (弧度)。 */
  moonAltitude: number;
  /** 星星数量 (启用时)。 */
  starCount: number;
  /** 云量 (0..1)。 */
  cloudCoverage: number;
  /** 是否为白天 (太阳在地平线以上)。 */
  isDaytime: boolean;
  /** 上次 update 的 dt (秒)。 */
  lastDt: number;
}

/** 着色器 uniform (供天空盒 shader 消费)。 */
export interface ProceduralSkyUniforms {
  uSunPosition: [number, number, number];
  uSunDirection: [number, number, number];
  uSunColor: [number, number, number];
  uSunIntensity: number;
  uMoonPosition: [number, number, number];
  uMoonDirection: [number, number, number];
  uMoonColor: [number, number, number];
  uMoonIntensity: number;
  uTurbidity: number;
  uRayleigh: number;
  uMieCoefficient: number;
  uMieDirectionalG: number;
  uSkyColor: [number, number, number];
  uHorizonColor: [number, number, number];
  uStarData: Float32Array | null;
  uStarCount: number;
  uCloudCoverage: number;
  uCloudColor: [number, number, number];
}

/** 度 → 弧度。 */
const DEG2RAD = Math.PI / 180;
/** 弧度 → 度。 */
const RAD2DEG = 180 / Math.PI;

/**
 * 程序化天空系统 — 基于物理近似的太阳/月亮/大气/星空。
 */
export class ProceduralSky {
  // ── 太阳 ──────────────────────────────────────────────
  /** 太阳位置 (世界坐标,长度约 1)。 */
  sunPosition: Vector3 = new Vector3(0, 1, 0);
  /** 太阳方向 (归一化,指向太阳)。 */
  sunDirection: Vector3 = new Vector3(0, 1, 0);
  /** 太阳强度 (0..1+,由高度角决定)。 */
  sunIntensity: number = 1;
  /** 太阳颜色。 */
  sunColor: SkyRGB = { r: 1, g: 1, b: 0.95 };

  // ── 月亮 ──────────────────────────────────────────────
  /** 月亮位置。 */
  moonPosition: Vector3 = new Vector3(0, -1, 0);
  /** 月亮方向。 */
  moonDirection: Vector3 = new Vector3(0, -1, 0);
  /** 月亮强度。 */
  moonIntensity: number = 0.1;
  /** 月亮颜色。 */
  moonColor: SkyRGB = { r: 0.9, g: 0.95, b: 1.0 };

  // ── 时间与地理 ────────────────────────────────────────
  /** 当前时间 (0..24,小数表示分钟)。 */
  timeOfDay: number = 12;
  /** 纬度 (度,-90..90,默认北纬 30°)。 */
  latitude: number = 30;
  /** 年中天数 (1..365,影响太阳赤纬)。 */
  dayOfYear: number = 80;
  /** 时间流逝速度 (默认 1,>1 加速)。 */
  daySpeed: number = 1;
  /** 是否激活。 */
  enabled: boolean = true;

  // ── 大气参数 ──────────────────────────────────────────
  /** 浊度 (1..10,越大越浑浊)。 */
  turbidity: number = 2;
  /** 瑞利散射系数 (0..4,典型 1)。 */
  rayleigh: number = 1;
  /** 米氏散射系数 (0..1,典型 0.005)。 */
  mieCoefficient: number = 0.005;
  /** 米氏方向性 g (-1..1,典型 0.76)。 */
  mieDirectionalG: number = 0.76;

  // ── 星空 ──────────────────────────────────────────────
  /** 是否启用星星。 */
  starsEnabled: boolean = true;
  /** 星星数量。 */
  starCount: number = 1000;
  /** 星星数据 (x,y,z, brightness 4 个浮点/星)。 */
  starData: Float32Array | null = null;

  // ── 云 ────────────────────────────────────────────────
  /** 云量 (0..1)。 */
  cloudCoverage: number = 0.3;
  /** 云颜色。 */
  cloudColor: SkyRGB = { r: 1, g: 1, b: 1 };

  // ── 缓存 ──────────────────────────────────────────────
  /** 天空颜色 (天顶)。 */
  private _skyColor: SkyRGB = { r: 0.4, g: 0.6, b: 0.9 };
  /** 地平线颜色。 */
  private _horizonColor: SkyRGB = { r: 0.75, g: 0.85, b: 0.95 };
  /** 上次 update 的 dt。 */
  private _lastDt: number = 0;
  /** 太阳高度角 (弧度)。 */
  private _sunAltitude: number = Math.PI / 2;
  /** 太阳方位角 (弧度)。 */
  private _sunAzimuth: number = 0;
  /** 月亮高度角 (弧度)。 */
  private _moonAltitude: number = -Math.PI / 2;

  constructor(initialHours: number = 12) {
    this.setTimeOfDay(initialHours);
    this.regenerateStars();
  }

  /** 推进时间并重算太阳/月亮/星空。 */
  update(dt: number): this {
    this._lastDt = dt;
    if (!this.enabled) return this;
    const hoursDelta = (dt * this.daySpeed) / 60; // 60 秒 = 1 小时 @ speed=1
    let t = this.timeOfDay + hoursDelta;
    t = ((t % 24) + 24) % 24;
    this.timeOfDay = t;
    this.recompute();
    return this;
  }

  /** 设置时间 (0..24),立即重算。 */
  setTimeOfDay(time: number): this {
    let t = time % 24;
    if (t < 0) t += 24;
    this.timeOfDay = t;
    this.recompute();
    return this;
  }

  /** 设置纬度 (度)。 */
  setLatitude(lat: number): this {
    this.latitude = Math.max(-90, Math.min(90, lat));
    this.recompute();
    return this;
  }

  /** 设置年中天数 (1..365)。 */
  setDayOfYear(day: number): this {
    this.dayOfYear = Math.max(1, Math.min(365, day));
    this.recompute();
    return this;
  }

  /** 设置太阳强度倍率 (会与高度角自动计算的强度相乘,这里覆盖自动值)。 */
  setSunIntensity(intensity: number): this {
    this.sunIntensity = Math.max(0, intensity);
    return this;
  }

  /** 设置月亮强度。 */
  setMoonIntensity(intensity: number): this {
    this.moonIntensity = Math.max(0, intensity);
    return this;
  }

  /** 设置浊度 (1..10)。 */
  setTurbidity(t: number): this {
    this.turbidity = Math.max(1, Math.min(10, t));
    this.recompute();
    return this;
  }

  /** 设置瑞利系数 (0..4)。 */
  setRayleigh(r: number): this {
    this.rayleigh = Math.max(0, Math.min(4, r));
    this.recompute();
    return this;
  }

  /** 设置米氏系数与方向性 g。 */
  setMie(coefficient: number, g: number): this {
    this.mieCoefficient = Math.max(0, Math.min(1, coefficient));
    this.mieDirectionalG = Math.max(-1, Math.min(1, g));
    this.recompute();
    return this;
  }

  /** 启用/禁用星星并设置数量。 */
  enableStars(enabled: boolean, count: number = 1000): this {
    this.starsEnabled = enabled;
    this.starCount = enabled ? Math.max(0, Math.floor(count)) : 0;
    this.regenerateStars();
    return this;
  }

  /** 设置云量 (0..1)。 */
  setCloudCoverage(coverage: number): this {
    this.cloudCoverage = Math.max(0, Math.min(1, coverage));
    return this;
  }

  /** 设置云颜色。 */
  setCloudColor(color: SkyRGB): this {
    this.cloudColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 获取太阳方向 (归一化)。 */
  getSunDirection(): Vector3 {
    return this.sunDirection.clone();
  }

  /** 获取月亮方向 (归一化)。 */
  getMoonDirection(): Vector3 {
    return this.moonDirection.clone();
  }

  /** 获取太阳颜色。 */
  getSunColor(): SkyRGB {
    return { ...this.sunColor };
  }

  /** 获取天空颜色 (天顶)。 */
  getSkyColor(): SkyRGB {
    return { ...this._skyColor };
  }

  /** 获取地平线颜色。 */
  getHorizonColor(): SkyRGB {
    return { ...this._horizonColor };
  }

  /** 获取星星数据 (Float32Array,每星 4 浮点 x,y,z,brightness)。 */
  getStarData(): Float32Array | null {
    return this.starData;
  }

  /**
   * 计算太阳位置 (基于天文学近似公式)。
   * 返回世界坐标 (长度约 1)。
   */
  computeSunPosition(): Vector3 {
    const decl = this.solarDeclination(this.dayOfYear);
    const lat = this.latitude * DEG2RAD;
    // 时角:正午 0,每小时 15° (π/12),上午为负
    const hourAngle = (this.timeOfDay - 12) * 15 * DEG2RAD;
    const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
    const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const cosAz = (Math.sin(decl) - sinAlt * Math.sin(lat)) / (Math.cos(altitude) * Math.cos(lat));
    let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth; // 下午:方位角取负向 (东→南→西)

    this._sunAltitude = altitude;
    this._sunAzimuth = azimuth;

    // 世界坐标:X=东, Y=上, Z=北
    // 方位角 0=正北 → -Z, 顺时针:东(+X)→南(-Z 反向即 +Z 南?) 这里采用:
    // 北 (az=0): -Z 方向;东 (az=π/2): +X;南 (az=π): +Z;西 (az=3π/2): -X
    const x = Math.sin(azimuth) * Math.cos(altitude);
    const y = Math.sin(altitude);
    const z = -Math.cos(azimuth) * Math.cos(altitude);
    return new Vector3(x, y, z).normalize();
  }

  /**
   * 计算月亮位置 (近似:与太阳反向 + 30° 偏移模拟月相)。
   */
  computeMoonPosition(): Vector3 {
    // 月亮大致与太阳相反 (满月时严格相反,其他月相有偏移)
    // 这里用简化模型:月亮位置 = -sunPosition (近似满月)
    // 真实月相周期 29.5 天,这里不模拟,取相反位置即可
    const moonDir = this.sunPosition.clone().multiplyScalar(-1);
    this._moonAltitude = Math.asin(Math.max(-1, Math.min(1, moonDir.y)));
    return moonDir.normalize();
  }

  /**
   * 计算大气散射 (Preetham 近似:瑞利 + 米氏)。
   * @param direction 视线方向 (归一化)。
   * @returns 散射结果 (transmittance / scatter / color)。
   */
  computeAtmosphere(direction: Vector3): AtmosphereSample {
    const dir = direction.clone().normalize();
    const sunDir = this.sunDirection;
    const cosTheta = Math.max(0, dir.dot(sunDir)); // 视线与太阳夹角

    // 瑞利散射相位函数 (对称)
    const rayleighPhase = 0.75 * (1 + cosTheta * cosTheta);
    // 米氏散射相位函数 (Henyey-Greenstein)
    const g = this.mieDirectionalG;
    const g2 = g * g;
    const miePhase = (1 - g2) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5) * (1 / (4 * Math.PI));

    // 大气光学厚度 (近似,沿视线积分)
    // 用视线仰角 cos 作为权重:仰角高 → 厚度小
    const upDot = Math.max(0, dir.y);
    const opticalDepth = 1 / (upDot + 0.05); // 地平线附近厚度大

    // 瑞利系数 (标准海平面)
    const betaR: SkyRGB = {
      r: 5.8e-6 * this.rayleigh,
      g: 13.5e-6 * this.rayleigh,
      b: 33.1e-6 * this.rayleigh,
    };
    // 米氏系数 (与浊度相关)
    const c = (0.2 * this.turbidity) * 10e-6;
    const betaM: SkyRGB = {
      r: c * this.mieCoefficient * 1e3,
      g: c * this.mieCoefficient * 1e3,
      b: c * this.mieCoefficient * 1e3,
    };

    // 透射率 (Beer-Lambert):e^(-(betaR + betaM) * depth)
    const tauR = Math.exp(-betaR.r * opticalDepth * 1e5);
    const tauG = Math.exp(-betaR.g * opticalDepth * 1e5);
    const tauB = Math.exp(-betaR.b * opticalDepth * 1e5);
    const tauM = Math.exp(-0.2 * this.turbidity * this.mieCoefficient * opticalDepth * 1e3);
    const transmittance: SkyRGB = {
      r: Math.max(0, Math.min(1, tauR * tauM)),
      g: Math.max(0, Math.min(1, tauG * tauM)),
      b: Math.max(0, Math.min(1, tauB * tauM)),
    };

    // 散射光 = sunColor * (rayleigh * phaseR + mie * phaseM)
    const sunCol = this.sunColor;
    const sR = sunCol.r * (betaR.r * rayleighPhase + betaM.r * miePhase) * 1e5;
    const sG = sunCol.g * (betaR.g * rayleighPhase + betaM.g * miePhase) * 1e5;
    const sB = sunCol.b * (betaR.b * rayleighPhase + betaM.b * miePhase) * 1e5;
    const scatter: SkyRGB = {
      r: Math.max(0, Math.min(1, sR * this.sunIntensity)),
      g: Math.max(0, Math.min(1, sG * this.sunIntensity)),
      b: Math.max(0, Math.min(1, sB * this.sunIntensity)),
    };

    const color: SkyRGB = {
      r: Math.max(0, Math.min(1, transmittance.r + scatter.r)),
      g: Math.max(0, Math.min(1, transmittance.g + scatter.g)),
      b: Math.max(0, Math.min(1, transmittance.b + scatter.b)),
    };
    return { transmittance, scatter, color };
  }

  /** 获取着色器 uniform (供天空盒 shader 消费)。 */
  getShaderUniforms(): ProceduralSkyUniforms {
    return {
      uSunPosition: [this.sunPosition.x, this.sunPosition.y, this.sunPosition.z],
      uSunDirection: [this.sunDirection.x, this.sunDirection.y, this.sunDirection.z],
      uSunColor: [this.sunColor.r, this.sunColor.g, this.sunColor.b],
      uSunIntensity: this.sunIntensity,
      uMoonPosition: [this.moonPosition.x, this.moonPosition.y, this.moonPosition.z],
      uMoonDirection: [this.moonDirection.x, this.moonDirection.y, this.moonDirection.z],
      uMoonColor: [this.moonColor.r, this.moonColor.g, this.moonColor.b],
      uMoonIntensity: this.moonIntensity,
      uTurbidity: this.turbidity,
      uRayleigh: this.rayleigh,
      uMieCoefficient: this.mieCoefficient,
      uMieDirectionalG: this.mieDirectionalG,
      uSkyColor: [this._skyColor.r, this._skyColor.g, this._skyColor.b],
      uHorizonColor: [this._horizonColor.r, this._horizonColor.g, this._horizonColor.b],
      uStarData: this.starData,
      uStarCount: this.starsEnabled ? this.starCount : 0,
      uCloudCoverage: this.cloudCoverage,
      uCloudColor: [this.cloudColor.r, this.cloudColor.g, this.cloudColor.b],
    };
  }

  /** 获取统计。 */
  getStats(): ProceduralSkyStats {
    return {
      timeOfDay: this.timeOfDay,
      sunAltitude: this._sunAltitude,
      sunAzimuth: this._sunAzimuth,
      moonAltitude: this._moonAltitude,
      starCount: this.starsEnabled ? this.starCount : 0,
      cloudCoverage: this.cloudCoverage,
      isDaytime: this._sunAltitude > 0,
      lastDt: this._lastDt,
    };
  }

  /** 是否白天 (太阳在地平线以上)。 */
  isDaytime(): boolean {
    return this._sunAltitude > 0;
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 重算所有派生量 (太阳/月亮位置、强度、颜色、天空/地平线颜色)。 */
  private recompute(): void {
    // 1. 太阳/月亮位置
    this.sunPosition = this.computeSunPosition();
    this.sunDirection = this.sunPosition.clone().normalize();
    this.moonPosition = this.computeMoonPosition();
    this.moonDirection = this.moonPosition.clone().normalize();

    // 2. 太阳强度 (由高度角决定,地平线附近衰减)
    const sunAlt = this._sunAltitude;
    const sunAltDeg = sunAlt * RAD2DEG;
    if (sunAltDeg <= -6) {
      // 夜晚 (民用暮光以下)
      this.sunIntensity = 0;
    } else if (sunAltDeg < 6) {
      // 暮光过渡
      this.sunIntensity = (sunAltDeg + 6) / 12 * 0.3;
    } else if (sunAltDeg < 12) {
      // 日出/日落过渡
      this.sunIntensity = 0.3 + (sunAltDeg - 6) / 6 * 0.4;
    } else {
      // 白天
      this.sunIntensity = Math.min(1.5, 0.7 + (sunAltDeg - 12) / 78 * 0.8);
    }

    // 3. 月亮强度 (夜晚显现)
    const moonAltDeg = this._moonAltitude * RAD2DEG;
    this.moonIntensity = moonAltDeg > 0
      ? Math.min(0.3, moonAltDeg / 90 * 0.3)
      : 0;

    // 4. 太阳颜色 (低空偏橙红,高空偏白)
    const sunAltNorm = Math.max(0, Math.min(1, sunAlt / (Math.PI / 2)));
    this.sunColor = {
      r: 1.0,
      g: 0.3 + 0.7 * sunAltNorm,
      b: 0.3 + 0.7 * sunAltNorm,
    };

    // 5. 天空/地平线颜色 (由大气散射近似)
    const zenithDir = new Vector3(0, 1, 0);
    const horizonDir = new Vector3(
      Math.sin(this._sunAzimuth),
      0.01,
      -Math.cos(this._sunAzimuth),
    ).normalize();
    const skySample = this.computeAtmosphere(zenithDir);
    const horizonSample = this.computeAtmosphere(horizonDir);
    this._skyColor = this.applyNightTint(skySample.color, sunAlt);
    this._horizonColor = this.applyNightTint(horizonSample.color, sunAlt);
  }

  /** 夜晚加暗 + 偏蓝调。 */
  private applyNightTint(color: SkyRGB, sunAlt: number): SkyRGB {
    const altDeg = sunAlt * RAD2DEG;
    if (altDeg > 0) return color;
    // 太阳低于地平线:暮光/夜晚
    const nightFactor = Math.max(0, Math.min(1, -altDeg / 18)); // -18° 完全黑夜
    const nightColor: SkyRGB = { r: 0.02, g: 0.03, b: 0.08 };
    return {
      r: color.r * (1 - nightFactor) + nightColor.r * nightFactor,
      g: color.g * (1 - nightFactor) + nightColor.g * nightFactor,
      b: color.b * (1 - nightFactor) + nightColor.b * nightFactor,
    };
  }

  /** 重新生成星空数据 (球面均匀分布 + 亮度幂分布)。 */
  private regenerateStars(): void {
    if (!this.starsEnabled || this.starCount <= 0) {
      this.starData = null;
      return;
    }
    const n = this.starCount;
    const data = new Float32Array(n * 4);
    // 确定性 PRNG (基于索引),保证可重现
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < n; i++) {
      // 球面均匀分布 (Marsaglia 方法)
      let u: number, v: number, s: number;
      do {
        u = rand() * 2 - 1;
        v = rand() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1);
      const factor = 2 * Math.sqrt(1 - s);
      const x = u * factor;
      const y = Math.abs(v * factor); // 仅上半球 (天空)
      const z = u * u - v * v; // 此处简化,保证单位球面
      // 归一化
      const len = Math.sqrt(x * x + y * y + z * z);
      data[i * 4 + 0] = x / len;
      data[i * 4 + 1] = y / len;
      data[i * 4 + 2] = z / len;
      // 亮度:幂分布 (大部分暗星,少量亮星)
      data[i * 4 + 3] = Math.pow(rand(), 3) * 0.8 + 0.2;
    }
    this.starData = data;
  }

  /**
   * 太阳赤纬 (基于 dayOfYear 的近似公式)。
   * 返回弧度。春分 (day 80) ≈ 0,夏至 (day 172) ≈ +23.45°,冬至 ≈ -23.45°。
   */
  private solarDeclination(dayOfYear: number): number {
    // Cooper 1969 公式:δ = 23.45° * sin(360° * (284 + n) / 365)
    const angle = 360 * (284 + dayOfYear) / 365 * DEG2RAD;
    return 23.45 * DEG2RAD * Math.sin(angle);
  }
}

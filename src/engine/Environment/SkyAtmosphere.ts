// SkyAtmosphere — GPU 物理大气散射组件 (UE5 SkyAtmosphere / Unity HDRP 风格)。
//
// 设计:
//   * 与 ProceduralSky (CPU Preetham 解析近似) 互补:
//       - ProceduralSky 提供 CPU 端解析颜色 + 星空/月亮,轻量、可控;
//       - SkyAtmosphere 提供 GPU 端光线步进物理积分,支持 Ozone 吸收 +
//         多重散射近似 + 地面反射,面向"影视级真实天空"场景。
//   * 本组件只负责"参数管理 + 太阳位置计算 + getShaderUniforms()",
//     实际渲染由上层天空盒 Mesh 消费 SKY_ATMOSPHERE_VERT/FRAG shader。
//   * 太阳位置复用 ProceduralSky 的天文学公式 (赤纬 + 时角 → 高度/方位),
//     保持两套系统时间一致。
//
// 物理模型 (归一化到行星半径 = 1.0, 即 6371km):
//   * Rayleigh 散射: βR,标高 HR≈8km,相位 (1+cos²θ)
//   * Mie 散射:     βM,标高 HM≈1.2km,Henyey-Greenstein g
//   * Ozone 吸收:   βO,Chappuis 吸收带,层中心 ~25km (吸收,非散射)
//   * 多重散射:     Bruneton ψ 简化近似 (恒定环境项)
//   * 地面反射:     Lambertian 反照率 × 到地面的透射率 × 太阳光
//
// 超越 soup3D:
//   soup3D 仅提供简单天空盒颜色 / 渐变,无物理大气散射。
//   SkyAtmosphere 提供与 UE5/HDRP 同级的物理天空:
//     - 日出/日落时地平线呈红橙色 (Rayleigh 蓝光被散射掉)
//     - Ozone 吸收让高空呈深蓝 (Chappuis 带吸收绿黄光)
//     - 多重散射让阴影区也有环境天光 (非纯黑)
//     - 地面反射让低空带地面色调 (草地绿、沙漠黄)

import { Vector3 } from '../Math/Vector3';

/** RGB 三元组 (0..1 线性)。 */
export interface AtmosphereRGB {
  r: number;
  g: number;
  b: number;
}

/** SkyAtmosphere 着色器 uniform (供天空盒 shader 消费)。 */
export interface SkyAtmosphereUniforms {
  u_sunDirection: [number, number, number];
  u_sunColor: [number, number, number];
  u_sunIntensity: number;
  u_betaR: [number, number, number];
  u_betaM: [number, number, number];
  u_betaO: number;
  u_g: number;
  u_planetRadius: number;
  u_atmosphereRadius: number;
  u_HR: number;
  u_HM: number;
  u_multiScatter: number;
  u_showSunDisc: number;
  u_groundAlbedo: [number, number, number];
}

/** SkyAtmosphere 统计信息。 */
export interface SkyAtmosphereStats {
  timeOfDay: number;
  sunAltitude: number;
  sunAzimuth: number;
  isDaytime: boolean;
  sunDirection: [number, number, number];
  /** 上次 update 的 dt (秒)。 */
  lastDt: number;
}

/** 度 → 弧度。 */
const DEG2RAD = Math.PI / 180;

/** 预设大气模型 (海平面散射系数,归一化单位)。 */
export interface AtmospherePreset {
  name: string;
  betaR: [number, number, number];
  betaM: [number, number, number];
  betaO: number;
  g: number;
  description: string;
}

/**
 * 地球标准大气预设 (Rayleigh 波长相关:蓝>红;Mie 中性偏暖;Ozone Chappuis 带)。
 * 系数已归一化到行星半径=1.0 (即除以 6371km)。
 */
export const EARTH_ATMOSPHERE: AtmospherePreset = {
  name: 'earth',
  // 海平面 Rayleigh 散射系数 (Bruneton 2008, λ=680/550/440nm)
  // 原始 (1/m): [5.8e-6, 1.35e-5, 3.03e-5] → 归一化 (×6371e3): [0.0369, 0.0862, 0.1930]
  betaR: [0.0369, 0.0862, 0.1930],
  // 海平面 Mie 散射系数 (典型浊度 T=2): ≈ 0.02 中性灰
  betaM: [0.021, 0.021, 0.021],
  // Ozone 峰值吸收系数 (Chappuis 带,绿光强吸收)
  betaO: 0.0066,
  g: 0.76,
  description: '地球标准大气 (Bruneton 2008 波长,浊度 T=2)',
};

/** 火星稀薄大气预设 (偏红粉尘 Mie,弱 Rayleigh)。 */
export const MARS_ATMOSPHERE: AtmospherePreset = {
  name: 'mars',
  betaR: [0.004, 0.006, 0.009], // 稀薄 → 弱 Rayleigh
  betaM: [0.05, 0.03, 0.015], // 红色粉尘 → 强红 Mie
  betaO: 0.0,
  g: 0.85, // 强前向散射 (细粉尘)
  description: '火星稀薄红色粉尘大气',
};

/**
 * SkyAtmosphere — 物理大气散射组件。
 */
export class SkyAtmosphere {
  // ── 太阳 ──────────────────────────────────────────────
  /** 太阳方向 (归一化,指向太阳)。 */
  sunDirection: Vector3 = new Vector3(0, 1, 0);
  /** 太阳颜色 (线性,默认 D65 白光)。 */
  sunColor: AtmosphereRGB = { r: 1.0, g: 0.98, b: 0.92 };
  /** 太阳辐照强度倍率 (典型 20~30,因归一化单位)。 */
  sunIntensity: number = 22.0;

  // ── 时间与地理 (与 ProceduralSky 公式一致) ────────────
  /** 当前时间 (0..24,小数表示分钟)。 */
  timeOfDay: number = 12;
  /** 纬度 (度,-90..90)。 */
  latitude: number = 30;
  /** 年中天数 (1..365,影响太阳赤纬)。 */
  dayOfYear: number = 80;
  /** 时间流逝速度 (60 秒 = 1 小时 @ speed=1)。 */
  daySpeed: number = 1;
  /** 是否激活。 */
  enabled: boolean = true;

  // ── 大气物理参数 ──────────────────────────────────────
  /** Rayleigh 海平面散射系数 (R,G,B)。 */
  betaR: [number, number, number] = [...EARTH_ATMOSPHERE.betaR];
  /** Mie 海平面散射系数 (R,G,B)。 */
  betaM: [number, number, number] = [...EARTH_ATMOSPHERE.betaM];
  /** Ozone 峰值吸收系数 (标量,作用于绿光)。 */
  betaO: number = EARTH_ATMOSPHERE.betaO;
  /** Henyey-Greenstein 非对称参数 [-1,1]。 */
  g: number = EARTH_ATMOSPHERE.g;
  /** Rayleigh 标高 (归一化,8/6371)。 */
  HR: number = 8.0 / 6371.0;
  /** Mie 标高 (归一化,1.2/6371)。 */
  HM: number = 1.2 / 6371.0;
  /** 行星半径 (归一化,默认 1.0)。 */
  planetRadius: number = 1.0;
  /** 大气层顶半径 (归一化,(6371+100)/6371)。 */
  atmosphereRadius: number = 6471.0 / 6371.0;
  /** 多重散射强度 (0=单次,0.3~1.0 推荐)。 */
  multiScatter: number = 0.5;
  /** 是否绘制太阳圆盘。 */
  showSunDisc: boolean = true;
  /** 地面反照率 (Lambertian,0..1)。 */
  groundAlbedo: AtmosphereRGB = { r: 0.3, g: 0.3, b: 0.3 };

  // ── 缓存 ──────────────────────────────────────────────
  private _sunAltitude: number = Math.PI / 2;
  private _sunAzimuth: number = 0;
  private _lastDt: number = 0;

  constructor(initialHours: number = 12) {
    this.setTimeOfDay(initialHours);
  }

  /** 推进时间并重算太阳位置。 */
  update(dt: number): this {
    this._lastDt = dt;
    if (!this.enabled) return this;
    const hoursDelta = (dt * this.daySpeed) / 60;
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

  /** 设置年中天数。 */
  setDayOfYear(day: number): this {
    this.dayOfYear = Math.max(1, Math.min(365, Math.round(day)));
    this.recompute();
    return this;
  }

  /** 应用大气预设。 */
  applyPreset(preset: AtmospherePreset): this {
    this.betaR = [...preset.betaR];
    this.betaM = [...preset.betaM];
    this.betaO = preset.betaO;
    this.g = preset.g;
    return this;
  }

  /** 是否白天 (太阳在地平线以上)。 */
  isDaytime(): boolean {
    return this._sunAltitude > 0;
  }

  /** 获取着色器 uniform。 */
  getShaderUniforms(): SkyAtmosphereUniforms {
    return {
      u_sunDirection: [this.sunDirection.x, this.sunDirection.y, this.sunDirection.z],
      u_sunColor: [this.sunColor.r, this.sunColor.g, this.sunColor.b],
      u_sunIntensity: this.sunIntensity,
      u_betaR: [...this.betaR] as [number, number, number],
      u_betaM: [...this.betaM] as [number, number, number],
      u_betaO: this.betaO,
      u_g: this.g,
      u_planetRadius: this.planetRadius,
      u_atmosphereRadius: this.atmosphereRadius,
      u_HR: this.HR,
      u_HM: this.HM,
      u_multiScatter: this.multiScatter,
      u_showSunDisc: this.showSunDisc ? 1.0 : 0.0,
      u_groundAlbedo: [this.groundAlbedo.r, this.groundAlbedo.g, this.groundAlbedo.b],
    };
  }

  /** 获取统计。 */
  getStats(): SkyAtmosphereStats {
    return {
      timeOfDay: this.timeOfDay,
      sunAltitude: this._sunAltitude,
      sunAzimuth: this._sunAzimuth,
      isDaytime: this._sunAltitude > 0,
      sunDirection: [this.sunDirection.x, this.sunDirection.y, this.sunDirection.z],
      lastDt: this._lastDt,
    };
  }

  /** 计算太阳方向 (天文学公式,与 ProceduralSky 一致)。 */
  computeSunDirection(): Vector3 {
    const decl = this.solarDeclination(this.dayOfYear);
    const lat = this.latitude * DEG2RAD;
    const hourAngle = (this.timeOfDay - 12) * 15 * DEG2RAD;
    const sinAlt =
      Math.sin(lat) * Math.sin(decl) +
      Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
    const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const cosAz =
      (Math.sin(decl) - sinAlt * Math.sin(lat)) /
      (Math.cos(altitude) * Math.cos(lat));
    let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;

    this._sunAltitude = altitude;
    this._sunAzimuth = azimuth;

    const x = Math.sin(azimuth) * Math.cos(altitude);
    const y = Math.sin(altitude);
    const z = -Math.cos(azimuth) * Math.cos(altitude);
    return new Vector3(x, y, z).normalize();
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 太阳赤纬 (粗略近似,Cooper 1969)。 */
  private solarDeclination(dayOfYear: number): number {
    return 23.45 * DEG2RAD * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  }

  /** 重算太阳方向 + 强度 (夜间降低)。 */
  private recompute(): void {
    this.sunDirection = this.computeSunDirection();
    // 太阳在地平线以下时,降低辐照 (负值时给一个微弱月光残留)
    const alt = this._sunAltitude;
    if (alt < 0) {
      // 夜间:太阳光为 0 (月光单独处理)
      this.sunIntensity = 0;
    } else {
      // 白天:随高度角增加 (低空被大气吸收更多)
      this.sunIntensity = 22.0 * Math.max(0, Math.sin(alt));
    }
  }
}

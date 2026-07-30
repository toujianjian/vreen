// ProceduralSky.test.ts — 程序化天空 (ProceduralSky) 测试。
//
// 验证:
//   * 构造与默认值
//   * setTimeOfDay / setLatitude / setDayOfYear
//   * update 推进时间
//   * setSunIntensity / setMoonIntensity / setTurbidity / setRayleigh / setMie
//   * enableStars / setCloudCoverage / setCloudColor
//   * getSunDirection / getMoonDirection / getSunColor / getSkyColor / getHorizonColor
//   * computeSunPosition / computeMoonPosition / computeAtmosphere
//   * getShaderUniforms / getStats
//   * 物理:正午太阳在天顶附近,子夜太阳在地平线下

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { ProceduralSky } from './ProceduralSky';

describe('ProceduralSky — 构造与默认值', () => {
  it('默认构造 12 点', () => {
    const s = new ProceduralSky();
    expect(s.timeOfDay).toBe(12);
    expect(s.sunPosition.length()).toBeCloseTo(1, 5);
    expect(s.sunDirection.length()).toBeCloseTo(1, 5);
  });

  it('指定初始时间', () => {
    const s = new ProceduralSky(8);
    expect(s.timeOfDay).toBe(8);
  });

  it('默认大气参数', () => {
    const s = new ProceduralSky();
    expect(s.turbidity).toBe(2);
    expect(s.rayleigh).toBe(1);
    expect(s.mieCoefficient).toBe(0.005);
    expect(s.mieDirectionalG).toBeCloseTo(0.76, 5);
  });

  it('默认启用星星', () => {
    const s = new ProceduralSky();
    expect(s.starsEnabled).toBe(true);
    expect(s.starCount).toBe(1000);
    expect(s.starData).not.toBeNull();
    expect(s.starData!.length).toBe(1000 * 4);
  });

  it('默认云量与云色', () => {
    const s = new ProceduralSky();
    expect(s.cloudCoverage).toBeCloseTo(0.3, 5);
    expect(s.cloudColor).toEqual({ r: 1, g: 1, b: 1 });
  });
});

describe('ProceduralSky — 时间与地理', () => {
  it('setTimeOfDay 设置并重算', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(6);
    expect(s.timeOfDay).toBe(6);
    // 6 点太阳应在地平线附近 (高度角接近 0)
    expect(s.getStats().sunAltitude).toBeGreaterThan(-Math.PI / 6);
    expect(s.getStats().sunAltitude).toBeLessThan(Math.PI / 6);
  });

  it('setTimeOfDay 接受越界值并取模', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(30);
    expect(s.timeOfDay).toBe(6);
    s.setTimeOfDay(-2);
    expect(s.timeOfDay).toBe(22);
  });

  it('setLatitude 限制在 [-90, 90]', () => {
    const s = new ProceduralSky();
    s.setLatitude(120);
    expect(s.latitude).toBe(90);
    s.setLatitude(-120);
    expect(s.latitude).toBe(-90);
    s.setLatitude(45);
    expect(s.latitude).toBe(45);
  });

  it('setDayOfYear 限制在 [1, 365]', () => {
    const s = new ProceduralSky();
    s.setDayOfYear(0);
    expect(s.dayOfYear).toBe(1);
    s.setDayOfYear(400);
    expect(s.dayOfYear).toBe(365);
    s.setDayOfYear(172);
    expect(s.dayOfYear).toBe(172);
  });

  it('update 推进时间', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(0);
    s.update(60); // 60 秒 → 1 小时 @ speed=1
    expect(s.timeOfDay).toBeCloseTo(1, 5);
  });

  it('update daySpeed 加速', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(0);
    s.daySpeed = 2;
    s.update(60);
    expect(s.timeOfDay).toBeCloseTo(2, 5);
  });

  it('update enabled=false 不推进', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(0);
    s.enabled = false;
    s.update(60);
    expect(s.timeOfDay).toBe(0);
  });

  it('update 跨过 24 小时回到 0', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(23);
    s.update(120);
    expect(s.timeOfDay).toBeCloseTo(1, 5);
  });
});

describe('ProceduralSky — 大气参数', () => {
  it('setTurbidity 限制在 [1, 10]', () => {
    const s = new ProceduralSky();
    s.setTurbidity(0);
    expect(s.turbidity).toBe(1);
    s.setTurbidity(20);
    expect(s.turbidity).toBe(10);
    s.setTurbidity(5);
    expect(s.turbidity).toBe(5);
  });

  it('setRayleigh 限制在 [0, 4]', () => {
    const s = new ProceduralSky();
    s.setRayleigh(-1);
    expect(s.rayleigh).toBe(0);
    s.setRayleigh(10);
    expect(s.rayleigh).toBe(4);
    s.setRayleigh(2);
    expect(s.rayleigh).toBe(2);
  });

  it('setMie 设置系数与方向性', () => {
    const s = new ProceduralSky();
    s.setMie(0.1, 0.9);
    expect(s.mieCoefficient).toBe(0.1);
    expect(s.mieDirectionalG).toBeCloseTo(0.9, 5);
  });

  it('setMie 限制范围', () => {
    const s = new ProceduralSky();
    s.setMie(-1, -2);
    expect(s.mieCoefficient).toBe(0);
    expect(s.mieDirectionalG).toBe(-1);
    s.setMie(2, 2);
    expect(s.mieCoefficient).toBe(1);
    expect(s.mieDirectionalG).toBe(1);
  });
});

describe('ProceduralSky — 强度', () => {
  it('setSunIntensity 设置非负值', () => {
    const s = new ProceduralSky();
    s.setSunIntensity(1.5);
    expect(s.sunIntensity).toBeCloseTo(1.5, 5);
    s.setSunIntensity(-1);
    expect(s.sunIntensity).toBe(0);
  });

  it('setMoonIntensity 设置非负值', () => {
    const s = new ProceduralSky();
    s.setMoonIntensity(0.3);
    expect(s.moonIntensity).toBeCloseTo(0.3, 5);
    s.setMoonIntensity(-1);
    expect(s.moonIntensity).toBe(0);
  });

  it('正午太阳强度大于子夜', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    const noon = s.sunIntensity;
    s.setTimeOfDay(0);
    const midnight = s.sunIntensity;
    expect(noon).toBeGreaterThan(midnight);
  });
});

describe('ProceduralSky — 星空与云', () => {
  it('enableStars 启用并重生成', () => {
    const s = new ProceduralSky();
    s.enableStars(false);
    expect(s.starsEnabled).toBe(false);
    expect(s.starCount).toBe(0);
    expect(s.starData).toBeNull();
    s.enableStars(true, 500);
    expect(s.starsEnabled).toBe(true);
    expect(s.starCount).toBe(500);
    expect(s.starData).not.toBeNull();
    expect(s.starData!.length).toBe(500 * 4);
  });

  it('星星数据每颗 4 浮点 (x,y,z,brightness)', () => {
    const s = new ProceduralSky();
    s.enableStars(true, 10);
    const data = s.getStarData()!;
    expect(data.length).toBe(40);
    // 亮度范围 [0.2, 1.0]
    for (let i = 0; i < 10; i++) {
      const b = data[i * 4 + 3];
      expect(b).toBeGreaterThanOrEqual(0.2);
      expect(b).toBeLessThanOrEqual(1.0);
    }
  });

  it('星星位置在单位球面附近 (上半球 y>=0)', () => {
    const s = new ProceduralSky();
    s.enableStars(true, 50);
    const data = s.getStarData()!;
    for (let i = 0; i < 50; i++) {
      const x = data[i * 4 + 0];
      const y = data[i * 4 + 1];
      const z = data[i * 4 + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len).toBeCloseTo(1, 3);
      expect(y).toBeGreaterThanOrEqual(0); // 仅上半球
    }
  });

  it('setCloudCoverage 限制在 [0, 1]', () => {
    const s = new ProceduralSky();
    s.setCloudCoverage(-1);
    expect(s.cloudCoverage).toBe(0);
    s.setCloudCoverage(2);
    expect(s.cloudCoverage).toBe(1);
    s.setCloudCoverage(0.5);
    expect(s.cloudCoverage).toBeCloseTo(0.5, 5);
  });

  it('setCloudColor 设置颜色', () => {
    const s = new ProceduralSky();
    s.setCloudColor({ r: 0.5, g: 0.6, b: 0.7 });
    expect(s.cloudColor).toEqual({ r: 0.5, g: 0.6, b: 0.7 });
  });

  it('getStarData 返回引用 (允许 null)', () => {
    const s = new ProceduralSky();
    s.enableStars(false);
    expect(s.getStarData()).toBeNull();
  });
});

describe('ProceduralSky — 方向与颜色', () => {
  it('getSunDirection 返回归一化克隆', () => {
    const s = new ProceduralSky();
    const d = s.getSunDirection();
    expect(d.length()).toBeCloseTo(1, 5);
    d.x = 999;
    expect(s.sunDirection.x).not.toBe(999);
  });

  it('getMoonDirection 返回归一化克隆', () => {
    const s = new ProceduralSky();
    const d = s.getMoonDirection();
    expect(d.length()).toBeCloseTo(1, 5);
    d.x = 999;
    expect(s.moonDirection.x).not.toBe(999);
  });

  it('getSunColor 返回克隆', () => {
    const s = new ProceduralSky();
    const c = s.getSunColor();
    c.r = 999;
    expect(s.sunColor.r).not.toBe(999);
  });

  it('getSkyColor 返回克隆', () => {
    const s = new ProceduralSky();
    const c = s.getSkyColor();
    c.r = 999;
    const c2 = s.getSkyColor();
    expect(c2.r).not.toBe(999);
  });

  it('getHorizonColor 返回克隆', () => {
    const s = new ProceduralSky();
    const c = s.getHorizonColor();
    c.r = 999;
    const c2 = s.getHorizonColor();
    expect(c2.r).not.toBe(999);
  });

  it('正午太阳颜色偏白 (b 接近 r)', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    const c = s.getSunColor();
    expect(c.b).toBeGreaterThan(0.7);
    expect(c.r).toBeGreaterThan(c.b - 0.2);
  });

  it('日出/日落太阳颜色偏橙 (r > b)', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(6);
    const c = s.getSunColor();
    expect(c.r).toBeGreaterThan(c.b);
  });

  it('月亮位置与太阳相反', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    const sun = s.getSunDirection();
    const moon = s.getMoonDirection();
    expect(moon.x).toBeCloseTo(-sun.x, 4);
    expect(moon.y).toBeCloseTo(-sun.y, 4);
    expect(moon.z).toBeCloseTo(-sun.z, 4);
  });
});

describe('ProceduralSky — 太阳位置计算', () => {
  it('computeSunPosition 返回归一化向量', () => {
    const s = new ProceduralSky();
    const p = s.computeSunPosition();
    expect(p.length()).toBeCloseTo(1, 5);
  });

  it('正午太阳高度角接近 90° - 纬度 (春分)', () => {
    const s = new ProceduralSky();
    s.setLatitude(0); // 赤道
    s.setDayOfYear(80); // 春分 (赤纬 ≈ 0)
    s.setTimeOfDay(12);
    const stats = s.getStats();
    // 赤道春分正午:太阳在天顶,高度角 ≈ π/2
    expect(stats.sunAltitude).toBeGreaterThan(Math.PI / 2 - 0.1);
  });

  it('子夜太阳在地平线下', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(0);
    expect(s.getStats().sunAltitude).toBeLessThan(0);
  });

  it('isDaytime 正午返回 true', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    expect(s.isDaytime()).toBe(true);
  });

  it('isDaytime 子夜返回 false', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(0);
    expect(s.isDaytime()).toBe(false);
  });

  it('computeMoonPosition 返回归一化向量', () => {
    const s = new ProceduralSky();
    const p = s.computeMoonPosition();
    expect(p.length()).toBeCloseTo(1, 5);
  });

  it('夏至正午北纬 30° 太阳高度角 ≈ 83.45°', () => {
    const s = new ProceduralSky();
    s.setLatitude(30);
    s.setDayOfYear(172); // 夏至 (赤纬 ≈ +23.45°)
    s.setTimeOfDay(12);
    const stats = s.getStats();
    // 高度角 = 90° - |纬度 - 赤纬| = 90° - |30 - 23.45| = 83.45°
    const expectedDeg = 90 - Math.abs(30 - 23.45);
    const expectedRad = expectedDeg * Math.PI / 180;
    expect(stats.sunAltitude).toBeGreaterThan(expectedRad - 0.05);
    expect(stats.sunAltitude).toBeLessThan(expectedRad + 0.05);
  });
});

describe('ProceduralSky — 大气散射', () => {
  it('computeAtmosphere 返回有效结果', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    const dir = new Vector3(0, 1, 0); // 天顶
    const sample = s.computeAtmosphere(dir);
    expect(sample.transmittance.r).toBeGreaterThanOrEqual(0);
    expect(sample.transmittance.r).toBeLessThanOrEqual(1);
    expect(sample.scatter.r).toBeGreaterThanOrEqual(0);
    expect(sample.color.r).toBeGreaterThanOrEqual(0);
    expect(sample.color.r).toBeLessThanOrEqual(1);
  });

  it('computeAtmosphere 视线朝向太阳时散射更强', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    const towardSun = s.getSunDirection();
    const awayFromSun = towardSun.clone().multiplyScalar(-1);
    const sampleToward = s.computeAtmosphere(towardSun);
    const sampleAway = s.computeAtmosphere(awayFromSun);
    // 朝向太阳的总散射光应大于背离
    const towardSum = sampleToward.scatter.r + sampleToward.scatter.g + sampleToward.scatter.b;
    const awaySum = sampleAway.scatter.r + sampleAway.scatter.g + sampleAway.scatter.b;
    expect(towardSum).toBeGreaterThan(awaySum);
  });

  it('computeAtmosphere 输入零向量不抛错', () => {
    const s = new ProceduralSky();
    const dir = new Vector3(0, 0, 0);
    expect(() => s.computeAtmosphere(dir)).not.toThrow();
  });
});

describe('ProceduralSky — uniform 与统计', () => {
  it('getShaderUniforms 返回完整字段', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    const u = s.getShaderUniforms();
    expect(u.uSunPosition).toHaveLength(3);
    expect(u.uSunDirection).toHaveLength(3);
    expect(u.uSunColor).toHaveLength(3);
    expect(typeof u.uSunIntensity).toBe('number');
    expect(u.uMoonPosition).toHaveLength(3);
    expect(u.uMoonDirection).toHaveLength(3);
    expect(u.uMoonColor).toHaveLength(3);
    expect(typeof u.uMoonIntensity).toBe('number');
    expect(typeof u.uTurbidity).toBe('number');
    expect(typeof u.uRayleigh).toBe('number');
    expect(typeof u.uMieCoefficient).toBe('number');
    expect(typeof u.uMieDirectionalG).toBe('number');
    expect(u.uSkyColor).toHaveLength(3);
    expect(u.uHorizonColor).toHaveLength(3);
    expect(typeof u.uStarCount).toBe('number');
    expect(typeof u.uCloudCoverage).toBe('number');
    expect(u.uCloudColor).toHaveLength(3);
  });

  it('getShaderUniforms 反映当前状态', () => {
    const s = new ProceduralSky();
    s.setTurbidity(5);
    s.setRayleigh(2);
    s.setCloudCoverage(0.7);
    s.setCloudColor({ r: 0.5, g: 0.5, b: 0.5 });
    const u = s.getShaderUniforms();
    expect(u.uTurbidity).toBe(5);
    expect(u.uRayleigh).toBe(2);
    expect(u.uCloudCoverage).toBeCloseTo(0.7, 5);
    expect(u.uCloudColor).toEqual([0.5, 0.5, 0.5]);
  });

  it('getShaderUniforms 禁用星星时 uStarCount 为 0', () => {
    const s = new ProceduralSky();
    s.enableStars(false);
    const u = s.getShaderUniforms();
    expect(u.uStarCount).toBe(0);
  });

  it('getStats 返回正确统计', () => {
    const s = new ProceduralSky();
    s.setTimeOfDay(12);
    s.enableStars(true, 500);
    s.setCloudCoverage(0.4);
    const stats = s.getStats();
    expect(stats.timeOfDay).toBe(12);
    expect(stats.starCount).toBe(500);
    expect(stats.cloudCoverage).toBeCloseTo(0.4, 5);
    expect(stats.isDaytime).toBe(true);
    expect(typeof stats.sunAltitude).toBe('number');
    expect(typeof stats.sunAzimuth).toBe('number');
    expect(typeof stats.moonAltitude).toBe('number');
  });

  it('getStats.lastDt 在 update 后反映上次 dt', () => {
    const s = new ProceduralSky();
    s.update(0.016);
    expect(s.getStats().lastDt).toBeCloseTo(0.016, 5);
  });
});

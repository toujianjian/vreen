// SkyAtmosphere.test.ts — GPU 物理大气散射组件测试。
//
// 验证:
//   * 构造与默认值 (时间、大气参数、预设)
//   * setTimeOfDay / setLatitude / setDayOfYear / update
//   * applyPreset (地球 / 火星)
//   * computeSunDirection (正午近天顶,子夜地平线下)
//   * getShaderUniforms (字段完整性 + 归一化)
//   * isDaytime / getStats
//   * 物理:夜间 sunIntensity=0,白天随高度角增加

import { describe, it, expect } from 'vitest';
import {
  SkyAtmosphere,
  EARTH_ATMOSPHERE,
  MARS_ATMOSPHERE,
} from './SkyAtmosphere';

describe('SkyAtmosphere — 构造与默认值', () => {
  it('默认构造 12 点', () => {
    const s = new SkyAtmosphere();
    expect(s.timeOfDay).toBe(12);
    expect(s.sunDirection.length()).toBeCloseTo(1, 5);
  });

  it('指定初始时间', () => {
    const s = new SkyAtmosphere(8);
    expect(s.timeOfDay).toBe(8);
  });

  it('默认地球大气预设', () => {
    const s = new SkyAtmosphere();
    expect(s.betaR).toEqual(EARTH_ATMOSPHERE.betaR);
    expect(s.betaM).toEqual(EARTH_ATMOSPHERE.betaM);
    expect(s.betaO).toBe(EARTH_ATMOSPHERE.betaO);
    expect(s.g).toBe(EARTH_ATMOSPHERE.g);
  });

  it('默认物理常数', () => {
    const s = new SkyAtmosphere();
    expect(s.HR).toBeCloseTo(8.0 / 6371.0, 8);
    expect(s.HM).toBeCloseTo(1.2 / 6371.0, 8);
    expect(s.planetRadius).toBeCloseTo(1.0, 8);
    expect(s.atmosphereRadius).toBeCloseTo(6471.0 / 6371.0, 8);
    expect(s.multiScatter).toBeCloseTo(0.5, 5);
  });

  it('默认启用太阳圆盘 + 地面反照率', () => {
    const s = new SkyAtmosphere();
    expect(s.showSunDisc).toBe(true);
    expect(s.groundAlbedo).toEqual({ r: 0.3, g: 0.3, b: 0.3 });
  });
});

describe('SkyAtmosphere — 时间与地理', () => {
  it('setTimeOfDay 设置并重算', () => {
    const s = new SkyAtmosphere();
    s.setTimeOfDay(6);
    expect(s.timeOfDay).toBe(6);
    // 6 点太阳应在地平线附近 (高度角接近 0)
    expect(s.getStats().sunAltitude).toBeGreaterThan(-Math.PI / 6);
    expect(s.getStats().sunAltitude).toBeLessThan(Math.PI / 6);
  });

  it('正午太阳在天顶附近 (北纬 0°)', () => {
    const s = new SkyAtmosphere(12);
    s.setLatitude(0);
    // 春分附近 dayOfYear=80,赤道正午太阳在天顶
    expect(s.getStats().sunAltitude).toBeGreaterThan(Math.PI / 3);
  });

  it('子夜太阳在地平线下', () => {
    const s = new SkyAtmosphere(0);
    expect(s.getStats().sunAltitude).toBeLessThan(0);
    expect(s.isDaytime()).toBe(false);
  });

  it('setLatitude 钳制到 [-90, 90]', () => {
    const s = new SkyAtmosphere();
    s.setLatitude(200);
    expect(s.latitude).toBe(90);
    s.setLatitude(-200);
    expect(s.latitude).toBe(-90);
  });

  it('setDayOfYear 钳制到 [1, 365] 并取整', () => {
    const s = new SkyAtmosphere();
    s.setDayOfYear(400.7);
    expect(s.dayOfYear).toBe(365);
    s.setDayOfYear(0);
    expect(s.dayOfYear).toBe(1);
  });

  it('update 推进时间 (60 秒 = 1 小时 @ speed=1)', () => {
    const s = new SkyAtmosphere(12);
    s.update(60);
    expect(s.timeOfDay).toBeCloseTo(13, 5);
  });

  it('update 跨日循环 (24 → 0)', () => {
    const s = new SkyAtmosphere(23);
    s.update(60); // +1h → 24 → 0
    expect(s.timeOfDay).toBeCloseTo(0, 5);
  });

  it('disabled 时 update 不推进', () => {
    const s = new SkyAtmosphere(12);
    s.enabled = false;
    s.update(60);
    expect(s.timeOfDay).toBe(12);
  });
});

describe('SkyAtmosphere — 预设', () => {
  it('applyPreset 地球', () => {
    const s = new SkyAtmosphere();
    s.applyPreset(EARTH_ATMOSPHERE);
    expect(s.betaR).toEqual(EARTH_ATMOSPHERE.betaR);
    expect(s.betaO).toBe(EARTH_ATMOSPHERE.betaO);
  });

  it('applyPreset 火星 (改变参数)', () => {
    const s = new SkyAtmosphere();
    s.applyPreset(MARS_ATMOSPHERE);
    expect(s.betaR).toEqual(MARS_ATMOSPHERE.betaR);
    expect(s.g).toBe(MARS_ATMOSPHERE.g);
    expect(s.betaO).toBe(0);
  });

  it('预设不影响原数组 (浅拷贝隔离)', () => {
    const s = new SkyAtmosphere();
    s.applyPreset(MARS_ATMOSPHERE);
    s.betaR[0] = 999;
    // 原预设不应被修改
    expect(MARS_ATMOSPHERE.betaR[0]).not.toBe(999);
  });
});

describe('SkyAtmosphere — 物理强度', () => {
  it('夜间 sunIntensity = 0', () => {
    const s = new SkyAtmosphere(0);
    expect(s.sunIntensity).toBe(0);
  });

  it('白天 sunIntensity 随高度角增加', () => {
    const s = new SkyAtmosphere(6); // 日出
    const morning = s.sunIntensity;
    s.setTimeOfDay(12);
    s.setLatitude(0);
    const noon = s.sunIntensity;
    expect(noon).toBeGreaterThan(morning);
    expect(noon).toBeGreaterThan(0);
  });

  it('白天 sunIntensity 非负', () => {
    const s = new SkyAtmosphere(12);
    expect(s.sunIntensity).toBeGreaterThanOrEqual(0);
  });
});

describe('SkyAtmosphere — getShaderUniforms', () => {
  it('返回完整字段', () => {
    const s = new SkyAtmosphere(12);
    const u = s.getShaderUniforms();
    expect(u).toHaveProperty('u_sunDirection');
    expect(u).toHaveProperty('u_sunColor');
    expect(u).toHaveProperty('u_sunIntensity');
    expect(u).toHaveProperty('u_betaR');
    expect(u).toHaveProperty('u_betaM');
    expect(u).toHaveProperty('u_betaO');
    expect(u).toHaveProperty('u_g');
    expect(u).toHaveProperty('u_planetRadius');
    expect(u).toHaveProperty('u_atmosphereRadius');
    expect(u).toHaveProperty('u_HR');
    expect(u).toHaveProperty('u_HM');
    expect(u).toHaveProperty('u_multiScatter');
    expect(u).toHaveProperty('u_showSunDisc');
    expect(u).toHaveProperty('u_groundAlbedo');
  });

  it('sunDirection 是归一化的', () => {
    const s = new SkyAtmosphere(12);
    const u = s.getShaderUniforms();
    const len = Math.hypot(...u.u_sunDirection);
    expect(len).toBeCloseTo(1, 5);
  });

  it('showSunDisc 转 float', () => {
    const s = new SkyAtmosphere();
    s.showSunDisc = true;
    expect(s.getShaderUniforms().u_showSunDisc).toBe(1);
    s.showSunDisc = false;
    expect(s.getShaderUniforms().u_showSunDisc).toBe(0);
  });

  it('uniform 与组件字段同步', () => {
    const s = new SkyAtmosphere(9);
    s.multiScatter = 0.8;
    s.sunIntensity = 30;
    const u = s.getShaderUniforms();
    expect(u.u_multiScatter).toBeCloseTo(0.8, 5);
    expect(u.u_sunIntensity).toBeCloseTo(s.sunIntensity, 5);
  });
});

describe('SkyAtmosphere — getStats', () => {
  it('返回时间与太阳位置', () => {
    const s = new SkyAtmosphere(15);
    const st = s.getStats();
    expect(st.timeOfDay).toBe(15);
    expect(st.sunAltitude).toBeDefined();
    expect(st.sunAzimuth).toBeDefined();
    expect(typeof st.isDaytime).toBe('boolean');
    expect(st.sunDirection).toHaveLength(3);
  });
});

describe('SkyAtmosphere — computeSunDirection', () => {
  it('返回归一化向量', () => {
    const s = new SkyAtmosphere(10);
    const dir = s.computeSunDirection();
    expect(dir.length()).toBeCloseTo(1, 5);
  });

  it('上午太阳在东 (X > 0)', () => {
    const s = new SkyAtmosphere(9);
    const dir = s.computeSunDirection();
    // 上午 9 点:太阳应在东侧 (X>0),高于地平线
    expect(dir.x).toBeGreaterThan(0);
    expect(dir.y).toBeGreaterThan(0);
  });

  it('下午太阳在西 (X < 0)', () => {
    const s = new SkyAtmosphere(15);
    const dir = s.computeSunDirection();
    expect(dir.x).toBeLessThan(0);
    expect(dir.y).toBeGreaterThan(0);
  });
});

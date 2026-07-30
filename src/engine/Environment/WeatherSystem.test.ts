// WeatherSystem 测试 — 动态天气系统。
//
// 验证:
//   • 默认状态 / 预设应用 / 立即切换
//   • setWeather 平滑过渡 + update 推进 + 完成
//   • 强度 / 风 / 温湿度 / 雾 / 云量 / 时间 设置器与钳制
//   • 雷电:启用 / 手动触发 / 闪烁衰减 / storm 自动触发
//   • getWeatherParams 克隆 / getShaderUniforms / getWeatherList

import { describe, it, expect } from 'vitest';
import { WeatherSystem, type WeatherType } from './WeatherSystem';
import { Vector3 } from '../Math';

describe('WeatherSystem — 默认状态', () => {
  it('默认天气为 clear', () => {
    const ws = new WeatherSystem();
    expect(ws.currentWeather).toBe('clear');
    expect(ws.targetWeather).toBe('clear');
    expect(ws.intensity).toBe(0);
    expect(ws.transitionProgress).toBe(1);
  });

  it('默认无过渡进行', () => {
    const ws = new WeatherSystem();
    expect(ws.transitionProgress).toBe(1);
    expect(ws.transitionDuration).toBe(0);
  });
});

describe('WeatherSystem — setWeatherImmediate', () => {
  it('立即切换天气并应用预设', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('storm');
    expect(ws.currentWeather).toBe('storm');
    expect(ws.targetWeather).toBe('storm');
    expect(ws.transitionProgress).toBe(1);
    expect(ws.intensity).toBeCloseTo(0.9, 5);
    expect(ws.windStrength).toBe(8);
    expect(ws.temperature).toBe(12);
    expect(ws.fogDensity).toBeGreaterThan(0.05);
  });

  it('各类型预设正确', () => {
    const ws = new WeatherSystem();
    const types: WeatherType[] = [
      'clear', 'cloudy', 'rain', 'heavyRain', 'snow', 'fog', 'storm', 'sandstorm',
    ];
    for (const t of types) {
      ws.setWeatherImmediate(t);
      expect(ws.currentWeather).toBe(t);
    }
  });

  it('sandstorm 温度高于 clear', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    const clearTemp = ws.temperature;
    ws.setWeatherImmediate('sandstorm');
    expect(ws.temperature).toBeGreaterThan(clearTemp);
  });
});

describe('WeatherSystem — setWeather 过渡', () => {
  it('setWeather 启动过渡但 currentWeather 不变', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    ws.setWeather('storm', 10);
    expect(ws.targetWeather).toBe('storm');
    expect(ws.currentWeather).toBe('clear'); // 过渡期间不切换
    expect(ws.transitionProgress).toBe(0);
    expect(ws.transitionDuration).toBe(10);
  });

  it('setWeather duration<=0 立即切换', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    ws.setWeather('storm', 0);
    expect(ws.currentWeather).toBe('storm');
    expect(ws.transitionProgress).toBe(1);
  });

  it('update 推进过渡进度', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    const initialTemp = ws.temperature;
    ws.setWeather('snow', 10); // snow 温度更低
    ws.update(5); // 推进一半
    expect(ws.transitionProgress).toBeCloseTo(0.5, 5);
    // 温度应介于初始与目标之间
    expect(ws.temperature).toBeLessThan(initialTemp);
    expect(ws.temperature).toBeGreaterThan(-3); // snow 目标温度
    expect(ws.currentWeather).toBe('clear'); // 还未完成
  });

  it('update 过渡完成时切换 currentWeather', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    ws.setWeather('rain', 1);
    ws.update(2); // 超过 duration
    expect(ws.currentWeather).toBe('rain');
    expect(ws.targetWeather).toBe('rain');
    expect(ws.transitionProgress).toBe(1);
  });

  it('过渡期间颜色插值', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    const startR = ws.fogColor.r;
    ws.setWeather('storm', 10);
    ws.update(5); // 一半
    // 中间颜色应不等于起点
    expect(ws.fogColor.r).not.toBeCloseTo(startR, 5);
  });

  it('update 无过渡时不改变状态', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('rain');
    const before = ws.getWeatherParams();
    ws.update(1);
    const after = ws.getWeatherParams();
    expect(after.intensity).toBe(before.intensity);
    expect(after.temperature).toBe(before.temperature);
  });
});

describe('WeatherSystem — 设置器', () => {
  it('setIntensity 钳制到 0..1', () => {
    const ws = new WeatherSystem();
    ws.setIntensity(1.5);
    expect(ws.intensity).toBe(1);
    ws.setIntensity(-0.5);
    expect(ws.intensity).toBe(0);
    ws.setIntensity(0.6);
    expect(ws.intensity).toBeCloseTo(0.6, 5);
  });

  it('setWind 归一化方向并设置风强', () => {
    const ws = new WeatherSystem();
    ws.setWind(new Vector3(3, 0, 4), 7);
    expect(ws.windDirection.length()).toBeCloseTo(1, 5);
    expect(ws.windDirection.x).toBeCloseTo(0.6, 5);
    expect(ws.windDirection.z).toBeCloseTo(0.8, 5);
    expect(ws.windStrength).toBe(7);
  });

  it('setWind 风强非负', () => {
    const ws = new WeatherSystem();
    ws.setWind(new Vector3(1, 0, 0), -5);
    expect(ws.windStrength).toBe(0);
  });

  it('setTemperature', () => {
    const ws = new WeatherSystem();
    ws.setTemperature(-10);
    expect(ws.temperature).toBe(-10);
  });

  it('setHumidity 钳制到 0..1', () => {
    const ws = new WeatherSystem();
    ws.setHumidity(2);
    expect(ws.humidity).toBe(1);
    ws.setHumidity(-1);
    expect(ws.humidity).toBe(0);
  });

  it('setFog 设置密度与颜色', () => {
    const ws = new WeatherSystem();
    ws.setFog(0.3, { r: 0.1, g: 0.2, b: 0.3 });
    expect(ws.fogDensity).toBeCloseTo(0.3, 5);
    expect(ws.fogColor.r).toBe(0.1);
    expect(ws.fogColor.g).toBe(0.2);
    expect(ws.fogColor.b).toBe(0.3);
  });

  it('setCloudCoverage 钳制到 0..1', () => {
    const ws = new WeatherSystem();
    ws.setCloudCoverage(1.5);
    expect(ws.cloudCoverage).toBe(1);
    ws.setCloudCoverage(-0.5);
    expect(ws.cloudCoverage).toBe(0);
  });

  it('setTimeOfDay 回绕到 0..24', () => {
    const ws = new WeatherSystem();
    ws.setTimeOfDay(25);
    expect(ws.timeOfDay).toBeCloseTo(1, 5);
    ws.setTimeOfDay(-1);
    expect(ws.timeOfDay).toBeCloseTo(23, 5);
    ws.setTimeOfDay(12);
    expect(ws.timeOfDay).toBe(12);
  });
});

describe('WeatherSystem — 雷电', () => {
  it('enableLightning 设置标志并初始化计时器', () => {
    const ws = new WeatherSystem();
    expect(ws.lightningEnabled).toBe(false);
    ws.enableLightning(true);
    expect(ws.lightningEnabled).toBe(true);
    expect(ws.lightningTimer).toBeGreaterThan(0);
  });

  it('enableLightning(false) 清除闪烁与计时器', () => {
    const ws = new WeatherSystem();
    ws.enableLightning(true);
    ws.triggerLightning();
    expect(ws.getLightningFlash()).toBe(1);
    ws.enableLightning(false);
    expect(ws.getLightningFlash()).toBe(0);
    expect(ws.lightningTimer).toBe(0);
  });

  it('triggerLightning 设置闪烁为 1', () => {
    const ws = new WeatherSystem();
    ws.triggerLightning();
    expect(ws.getLightningFlash()).toBe(1);
  });

  it('update 衰减闪烁强度', () => {
    const ws = new WeatherSystem();
    ws.triggerLightning();
    expect(ws.getLightningFlash()).toBe(1);
    ws.update(0.1); // 衰减 5*0.1 = 0.5
    expect(ws.getLightningFlash()).toBeCloseTo(0.5, 5);
    ws.update(0.2); // 再衰减 1.0 → 归零
    expect(ws.getLightningFlash()).toBe(0);
  });

  it('storm 天气下自动触发闪电', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('storm');
    ws.enableLightning(true);
    // 把计时器设小以快速触发
    ws.lightningTimer = 0.01;
    ws.update(0.02);
    expect(ws.getLightningFlash()).toBe(1);
    // 触发后计时器重置为随机正数
    expect(ws.lightningTimer).toBeGreaterThan(0);
  });

  it('非 storm 天气不自动触发闪电', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    ws.enableLightning(true);
    ws.lightningTimer = 0.01;
    ws.update(0.02);
    expect(ws.getLightningFlash()).toBe(0);
  });

  it('lightningEnabled=false 时 storm 也不触发', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('storm');
    ws.lightningTimer = 0.01;
    ws.update(0.02);
    expect(ws.getLightningFlash()).toBe(0);
  });
});

describe('WeatherSystem — 查询', () => {
  it('getCurrentWeather 返回当前类型', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('snow');
    expect(ws.getCurrentWeather()).toBe('snow');
  });

  it('getWeatherParams 返回克隆(修改不影响原对象)', () => {
    const ws = new WeatherSystem();
    ws.setIntensity(0.5);
    const p = ws.getWeatherParams();
    p.intensity = 999;
    p.windDirection.x = 999;
    p.fogColor.r = 999;
    expect(ws.intensity).not.toBe(999);
    expect(ws.windDirection.x).not.toBe(999);
    expect(ws.fogColor.r).not.toBe(999);
  });

  it('getShaderUniforms 返回扁平 uniform', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('rain');
    ws.setIntensity(0.5);
    const u = ws.getShaderUniforms();
    expect(u.u_weatherIntensity).toBeCloseTo(0.5, 5);
    expect(u.u_weatherType).toBe(2); // rain = 2
    expect(Array.isArray(u.u_windDirection)).toBe(true);
    expect(u.u_windDirection.length).toBe(3);
    expect(Array.isArray(u.u_fogColor)).toBe(true);
    expect(u.u_fogColor.length).toBe(3);
  });

  it('getShaderUniforms weatherType 枚举正确', () => {
    const ws = new WeatherSystem();
    const expected: Record<WeatherType, number> = {
      clear: 0, cloudy: 1, rain: 2, heavyRain: 3, snow: 4, fog: 5, storm: 6, sandstorm: 7,
    };
    for (const t of Object.keys(expected) as WeatherType[]) {
      ws.setWeatherImmediate(t);
      expect(ws.getShaderUniforms().u_weatherType).toBe(expected[t]);
    }
  });

  it('getWeatherList 返回 8 种天气', () => {
    const ws = new WeatherSystem();
    const list = ws.getWeatherList();
    expect(list.length).toBe(8);
    expect(list).toContain('clear');
    expect(list).toContain('sandstorm');
    // 返回副本:修改不影响内部
    list.push('clear' as WeatherType);
    expect(ws.getWeatherList().length).toBe(8);
  });
});

describe('WeatherSystem — 预设关系', () => {
  it('storm 比 clear 雾密度更高', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    const clearFog = ws.fogDensity;
    ws.setWeatherImmediate('storm');
    expect(ws.fogDensity).toBeGreaterThan(clearFog);
  });

  it('snow 比 clear 温度更低', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    const clearTemp = ws.temperature;
    ws.setWeatherImmediate('snow');
    expect(ws.temperature).toBeLessThan(clearTemp);
  });

  it('rain 比 clear 湿度更高', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    const clearHum = ws.humidity;
    ws.setWeatherImmediate('rain');
    expect(ws.humidity).toBeGreaterThan(clearHum);
  });

  it('heavyRain 比 rain 强度更高', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('rain');
    const rainInt = ws.intensity;
    ws.setWeatherImmediate('heavyRain');
    expect(ws.intensity).toBeGreaterThan(rainInt);
  });

  it('cloudy 比 clear 云量更高', () => {
    const ws = new WeatherSystem();
    ws.setWeatherImmediate('clear');
    const clearCloud = ws.cloudCoverage;
    ws.setWeatherImmediate('cloudy');
    expect(ws.cloudCoverage).toBeGreaterThan(clearCloud);
  });
});

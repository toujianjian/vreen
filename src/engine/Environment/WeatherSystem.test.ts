import { describe, it, expect } from 'vitest';
import { WeatherSystem, type WeatherType } from './WeatherSystem';
import { Vector3 } from '../Math';

describe('WeatherSystem', () => {
  it('默认天气为 clear', () => {
    const ws = new WeatherSystem();
    expect(ws.type).toBe('clear');
    expect(ws.intensity).toBe(0);
  });

  it('setWeather 立即应用预设', () => {
    const ws = new WeatherSystem();
    ws.setWeather('storm', 0.8);
    expect(ws.type).toBe('storm');
    expect(ws.intensity).toBe(0.8);
    expect(ws.windStrength).toBe(8);
    expect(ws.temperature).toBe(12);
    expect(ws.fogDensity).toBeGreaterThan(0.05);
  });

  it('setWeather 各类型预设正确', () => {
    const ws = new WeatherSystem();
    const types: WeatherType[] = ['clear', 'rain', 'snow', 'fog', 'storm'];
    for (const t of types) {
      ws.setWeather(t, 0.5);
      expect(ws.type).toBe(t);
      // 风强随天气变化,storm 应大于 clear
      if (t === 'storm') expect(ws.windStrength).toBeGreaterThan(5);
      if (t === 'clear') expect(ws.windStrength).toBeLessThan(2);
    }
  });

  it('setWeather 清除过渡状态', () => {
    const ws = new WeatherSystem();
    ws.transitionTo('rain', 5);
    expect(ws.transition).not.toBeNull();
    ws.setWeather('clear', 0);
    expect(ws.transition).toBeNull();
  });

  it('transitionTo 启动过渡', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    ws.transitionTo('storm', 10);
    expect(ws.transition).not.toBeNull();
    expect(ws.transition?.to).toBe('storm');
    expect(ws.transition?.duration).toBe(10);
  });

  it('update 推进过渡进度', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    const initialTemp = ws.temperature;
    ws.transitionTo('snow', 10); // snow 温度更低
    ws.update(5); // 推进一半
    // 过渡到一半,温度应介于初始与目标之间
    expect(ws.temperature).toBeLessThan(initialTemp);
    expect(ws.temperature).toBeGreaterThan(-3); // snow 目标温度
    expect(ws.transition).not.toBeNull(); // 还在过渡
  });

  it('update 过渡完成时切换 type 并清除 transition', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    ws.transitionTo('rain', 1);
    ws.update(2); // 超过 duration
    expect(ws.type).toBe('rain');
    expect(ws.transition).toBeNull();
  });

  it('update 无过渡时不改变状态', () => {
    const ws = new WeatherSystem();
    ws.setWeather('rain', 0.5);
    const before = ws.getWeatherData();
    ws.update(1);
    const after = ws.getWeatherData();
    expect(after.type).toBe(before.type);
    expect(after.intensity).toBe(before.intensity);
    expect(after.temperature).toBe(before.temperature);
  });

  it('transitionTo duration=0 立即生效', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    ws.transitionTo('storm', 0);
    expect(ws.type).toBe('storm');
    expect(ws.transition).toBeNull();
  });

  it('getWeatherData 返回克隆', () => {
    const ws = new WeatherSystem();
    const d1 = ws.getWeatherData();
    d1.intensity = 999;
    expect(ws.intensity).not.toBe(999);
  });

  it('getWeatherData windDirection 是克隆', () => {
    const ws = new WeatherSystem();
    const d1 = ws.getWeatherData();
    d1.windDirection.x = 999;
    expect(ws.windDirection.x).not.toBe(999);
  });

  it('setWindDirection 自动归一化', () => {
    const ws = new WeatherSystem();
    ws.setWindDirection(new Vector3(3, 0, 4));
    expect(ws.windDirection.length()).toBeCloseTo(1, 5);
    // 风向 (0.6, 0, 0.8)
    expect(ws.windDirection.x).toBeCloseTo(0.6, 5);
    expect(ws.windDirection.z).toBeCloseTo(0.8, 5);
  });

  it('setWindStrength 限制非负', () => {
    const ws = new WeatherSystem();
    ws.setWindStrength(-5);
    expect(ws.windStrength).toBe(0);
    ws.setWindStrength(7);
    expect(ws.windStrength).toBe(7);
  });

  it('过渡期间颜色插值', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    const startColor = ws.fogColor.clone();
    ws.transitionTo('storm', 10);
    ws.update(5); // 一半
    // 中间颜色应不等于起点
    expect(ws.fogColor.equals(startColor)).toBe(false);
  });

  it('storm 比 clear 雾密度更高', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    const clearFog = ws.fogDensity;
    ws.setWeather('storm', 0.9);
    expect(ws.fogDensity).toBeGreaterThan(clearFog);
  });

  it('snow 比 clear 温度更低', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    const clearTemp = ws.temperature;
    ws.setWeather('snow', 0.5);
    expect(ws.temperature).toBeLessThan(clearTemp);
  });

  it('rain 比 clear 湿度更高', () => {
    const ws = new WeatherSystem();
    ws.setWeather('clear', 0);
    const clearHum = ws.humidity;
    ws.setWeather('rain', 0.6);
    expect(ws.humidity).toBeGreaterThan(clearHum);
  });
});

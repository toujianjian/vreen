import { describe, it, expect } from 'vitest';
import { SkySystem } from './SkySystem';

describe('SkySystem', () => {
  it('默认构造 8 点', () => {
    const s = new SkySystem();
    expect(s.timeOfDay).toBe(8);
    expect(s.sunPosition.length()).toBeCloseTo(1, 5);
  });

  it('setTime 设置时间并重算', () => {
    const s = new SkySystem();
    s.setTime(12);
    expect(s.timeOfDay).toBe(12);
    // 正午太阳应在天顶附近(Y 最大)
    expect(s.sunPosition.y).toBeGreaterThan(0.9);
  });

  it('setTime 接受 0-24 范围外的值并取模', () => {
    const s = new SkySystem();
    s.setTime(30);
    expect(s.timeOfDay).toBe(6);
    s.setTime(-2);
    expect(s.timeOfDay).toBe(22);
  });

  it('update 推进时间', () => {
    const s = new SkySystem();
    s.setTime(0);
    s.update(60); // 60 秒 → 1 小时 @ speed=1
    expect(s.timeOfDay).toBeCloseTo(1, 5);
  });

  it('update daySpeed 加速时间', () => {
    const s = new SkySystem();
    s.setTime(0);
    s.daySpeed = 2;
    s.update(60); // 60 * 2 / 60 = 2 小时
    expect(s.timeOfDay).toBeCloseTo(2, 5);
  });

  it('update enabled=false 不推进', () => {
    const s = new SkySystem();
    s.setTime(0);
    s.enabled = false;
    s.update(60);
    expect(s.timeOfDay).toBe(0);
  });

  it('update 跨过 24 小时回到 0', () => {
    const s = new SkySystem();
    s.setTime(23);
    s.update(120); // 2 小时 → 25:00 → 1:00
    expect(s.timeOfDay).toBeCloseTo(1, 5);
  });

  it('isDaytime 正午返回 true', () => {
    const s = new SkySystem();
    s.setTime(12);
    expect(s.isDaytime()).toBe(true);
  });

  it('isDaytime 子夜返回 false', () => {
    const s = new SkySystem();
    s.setTime(0);
    expect(s.isDaytime()).toBe(false);
  });

  it('isDaytime 日出/日落临界点附近为 true', () => {
    const s = new SkySystem();
    s.setTime(8);
    expect(s.isDaytime()).toBe(true);
    s.setTime(20);
    // 18:00 之后太阳已落(角度 = (20-6)/24 * 2π = 7π/6,Y 为负)
    expect(s.isDaytime()).toBe(false);
  });

  it('getSunDirection 返回克隆', () => {
    const s = new SkySystem();
    const d = s.getSunDirection();
    d.x = 999;
    expect(s.sunPosition.x).not.toBe(999);
  });

  it('getMoonDirection 返回克隆', () => {
    const s = new SkySystem();
    const d = s.getMoonDirection();
    d.x = 999;
    expect(s.moonPosition.x).not.toBe(999);
  });

  it('getSkyColor 返回克隆', () => {
    const s = new SkySystem();
    const c = s.getSkyColor();
    c.r = 999;
    expect(s.skyColor.r).not.toBe(999);
  });

  it('月亮位置与太阳相反', () => {
    const s = new SkySystem();
    s.setTime(12);
    const sun = s.sunPosition.clone();
    const moon = s.moonPosition.clone();
    // 月亮 = -太阳
    expect(moon.x).toBeCloseTo(-sun.x, 5);
    expect(moon.y).toBeCloseTo(-sun.y, 5);
    expect(moon.z).toBeCloseTo(-sun.z, 5);
  });

  it('正午太阳光强度最大', () => {
    const s = new SkySystem();
    s.setTime(12);
    const noonIntensity = s.sunIntensity;
    s.setTime(0);
    const midnightIntensity = s.sunIntensity;
    expect(noonIntensity).toBeGreaterThan(midnightIntensity);
  });

  it('子夜星光强度最大', () => {
    const s = new SkySystem();
    s.setTime(0);
    const midnightStars = s.starIntensity;
    s.setTime(12);
    const noonStars = s.starIntensity;
    expect(midnightStars).toBeGreaterThan(noonStars);
  });

  it('颜色在不同时间不同', () => {
    const s = new SkySystem();
    s.setTime(6);
    const dawnColor = s.skyColor.clone();
    s.setTime(12);
    const noonColor = s.skyColor.clone();
    expect(dawnColor.equals(noonColor)).toBe(false);
  });

  it('getPhase 在不同时段返回不同值', () => {
    const s = new SkySystem();
    s.setTime(3);
    expect(s.getPhase()).toBe('night');
    s.setTime(6);
    expect(s.getPhase()).toBe('dawn');
    s.setTime(12);
    expect(s.getPhase()).toBe('day');
    s.setTime(19);
    expect(s.getPhase()).toBe('dusk');
    s.setTime(23);
    expect(s.getPhase()).toBe('night');
  });

  it('太阳位置 X 分量在 12 点接近 0', () => {
    const s = new SkySystem();
    s.setTime(12);
    // 正午太阳在天顶,X 应接近 0(实际因 Z 偏移略有不同)
    expect(Math.abs(s.sunPosition.x)).toBeLessThan(0.1);
  });

  it('6 点太阳从东方升起(X 为正)', () => {
    const s = new SkySystem();
    s.setTime(6);
    expect(s.sunPosition.x).toBeGreaterThan(0);
  });
});

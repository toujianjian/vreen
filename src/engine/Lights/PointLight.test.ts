// PointLight 单元测试：构造、默认值、衰减、power 换算、继承关系。

import { describe, it, expect } from 'vitest';
import { PointLight } from './PointLight';
import { Light } from './Light';
import { Object3D } from '../Core/Object3D';

describe('PointLight', () => {
  it('默认构造：白光、强度 1、distance 0、decay 2（物理正确）', () => {
    const p = new PointLight();
    expect(p.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(p.intensity).toBe(1);
    expect(p.distance).toBe(0);
    expect(p.decay).toBe(2);
    expect(p.type).toBe('PointLight');
    expect(p.isPointLight).toBe(true);
    expect(p.isLight).toBe(true);
  });

  it('接受 (color, intensity, distance, decay) 全参数', () => {
    const p = new PointLight(0xff0000, 2, 100, 1.5);
    expect(p.color.r).toBeCloseTo(1, 5);
    expect(p.color.g).toBeCloseTo(0, 5);
    expect(p.color.b).toBeCloseTo(0, 5);
    expect(p.intensity).toBe(2);
    expect(p.distance).toBe(100);
    expect(p.decay).toBe(1.5);
  });

  it('继承自 Light 与 Object3D', () => {
    const p = new PointLight();
    expect(p).toBeInstanceOf(Light);
    expect(p).toBeInstanceOf(Object3D);
  });

  it('power getter: 光通量(lm) = 4π × 强度(cd)', () => {
    const p = new PointLight(0xffffff, 1);
    expect(p.power).toBeCloseTo(4 * Math.PI, 5);
  });

  it('power setter: 由光通量反推强度', () => {
    const p = new PointLight();
    p.power = 4 * Math.PI;
    expect(p.intensity).toBeCloseTo(1, 5);
  });

  it('power 往返一致', () => {
    const p = new PointLight(0xffffff, 3.5);
    const lm = p.power;
    p.power = lm;
    expect(p.intensity).toBeCloseTo(3.5, 5);
  });
});

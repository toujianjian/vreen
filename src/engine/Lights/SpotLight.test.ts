// SpotLight 单元测试：构造、默认值、锥角/半影/衰减、power 换算、继承关系。

import { describe, it, expect } from 'vitest';
import { SpotLight } from './SpotLight';
import { Light } from './Light';
import { Object3D } from '../Core/Object3D';

describe('SpotLight', () => {
  it('默认构造：白光、强度 1、distance 0、angle π/3、penumbra 0、decay 2', () => {
    const s = new SpotLight();
    expect(s.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(s.intensity).toBe(1);
    expect(s.distance).toBe(0);
    expect(s.angle).toBeCloseTo(Math.PI / 3, 6);
    expect(s.penumbra).toBe(0);
    expect(s.decay).toBe(2);
    expect(s.type).toBe('SpotLight');
    expect(s.isSpotLight).toBe(true);
    expect(s.isLight).toBe(true);
  });

  it('接受 (color, intensity, distance, angle, penumbra, decay) 全参数', () => {
    const s = new SpotLight(0x00ff00, 5, 50, Math.PI / 4, 0.7, 1);
    expect(s.color.g).toBeCloseTo(1, 5);
    expect(s.intensity).toBe(5);
    expect(s.distance).toBe(50);
    expect(s.angle).toBeCloseTo(Math.PI / 4, 6);
    expect(s.penumbra).toBeCloseTo(0.7, 5);
    expect(s.decay).toBe(1);
  });

  it('拥有 target: Object3D', () => {
    const s = new SpotLight();
    expect(s.target).toBeInstanceOf(Object3D);
  });

  it('继承自 Light 与 Object3D', () => {
    const s = new SpotLight();
    expect(s).toBeInstanceOf(Light);
    expect(s).toBeInstanceOf(Object3D);
  });

  it('power getter: 光通量(lm) = π × 强度(cd)', () => {
    const s = new SpotLight(0xffffff, 1);
    expect(s.power).toBeCloseTo(Math.PI, 5);
  });

  it('power setter: 由光通量反推强度', () => {
    const s = new SpotLight();
    s.power = Math.PI;
    expect(s.intensity).toBeCloseTo(1, 5);
  });
});

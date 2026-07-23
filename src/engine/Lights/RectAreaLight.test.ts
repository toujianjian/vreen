// RectAreaLight 单元测试：构造、尺寸默认值、power 换算、继承关系。

import { describe, it, expect } from 'vitest';
import { RectAreaLight } from './RectAreaLight';
import { Light } from './Light';
import { Object3D } from '../Core/Object3D';

describe('RectAreaLight', () => {
  it('默认构造：白光、强度 1、宽高 10×10', () => {
    const r = new RectAreaLight();
    expect(r.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(r.intensity).toBe(1);
    expect(r.width).toBe(10);
    expect(r.height).toBe(10);
    expect(r.type).toBe('RectAreaLight');
    expect(r.isRectAreaLight).toBe(true);
    expect(r.isLight).toBe(true);
  });

  it('接受 (color, intensity, width, height) 全参数', () => {
    const r = new RectAreaLight(0x88aaff, 2, 5, 4);
    expect(r.color.r).toBeCloseTo(0x88 / 255, 4);
    expect(r.color.g).toBeCloseTo(0xaa / 255, 4);
    expect(r.color.b).toBeCloseTo(1, 4);
    expect(r.intensity).toBe(2);
    expect(r.width).toBe(5);
    expect(r.height).toBe(4);
  });

  it('继承自 Light 与 Object3D', () => {
    const r = new RectAreaLight();
    expect(r).toBeInstanceOf(Light);
    expect(r).toBeInstanceOf(Object3D);
  });

  it('power getter: 光通量(lm) = 强度(nit) × 面积 × π', () => {
    const r = new RectAreaLight(0xffffff, 1, 10, 10);
    expect(r.power).toBeCloseTo(1 * 10 * 10 * Math.PI, 4);
  });

  it('power setter: 由光通量反推强度（按当前面积）', () => {
    const r = new RectAreaLight(0xffffff, 1, 10, 10);
    r.power = 100 * Math.PI;
    expect(r.intensity).toBeCloseTo(1, 5);
  });

  it('power setter 受面积影响', () => {
    const a = new RectAreaLight(0xffffff, 1, 10, 10);
    const b = new RectAreaLight(0xffffff, 1, 5, 5);
    a.power = 100 * Math.PI;
    b.power = 100 * Math.PI;
    // 面积小的需要更大强度才能达到相同光通量
    expect(b.intensity).toBeGreaterThan(a.intensity);
  });
});

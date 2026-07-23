// HemisphereLight 单元测试：构造、天空/地面色、默认值、继承关系。

import { describe, it, expect } from 'vitest';
import { HemisphereLight } from './HemisphereLight';
import { Light } from './Light';
import { Object3D } from '../Core/Object3D';

describe('HemisphereLight', () => {
  it('默认构造：天空/地面均白、强度 1', () => {
    const h = new HemisphereLight();
    expect(h.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(h.groundColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(h.intensity).toBe(1);
    expect(h.type).toBe('HemisphereLight');
    expect(h.isHemisphereLight).toBe(true);
    expect(h.isLight).toBe(true);
  });

  it('接受 (skyColor, groundColor, intensity) 参数', () => {
    const h = new HemisphereLight(0xffffbb, 0x080820, 1);
    // skyColor 写入继承自 Light 的 color 字段
    expect(h.color.r).toBeCloseTo(1, 5);
    expect(h.color.g).toBeCloseTo(1, 5);
    expect(h.color.b).toBeCloseTo(0xbb / 255, 5);
    // groundColor 独立字段
    expect(h.groundColor.r).toBeCloseTo(0x08 / 255, 5);
    expect(h.groundColor.g).toBeCloseTo(0x08 / 255, 5);
    expect(h.groundColor.b).toBeCloseTo(0x20 / 255, 5);
    expect(h.intensity).toBe(1);
  });

  it('接受 hex 字符串颜色', () => {
    const h = new HemisphereLight('#abc', '#123456');
    // #abc → #aabbcc
    expect(h.color.r).toBeCloseTo(0xaa / 255, 4);
    expect(h.color.g).toBeCloseTo(0xbb / 255, 4);
    expect(h.color.b).toBeCloseTo(0xcc / 255, 4);
    expect(h.groundColor.r).toBeCloseTo(0x12 / 255, 4);
    expect(h.groundColor.g).toBeCloseTo(0x34 / 255, 4);
    expect(h.groundColor.b).toBeCloseTo(0x56 / 255, 4);
  });

  it('继承自 Light 与 Object3D', () => {
    const h = new HemisphereLight();
    expect(h).toBeInstanceOf(Light);
    expect(h).toBeInstanceOf(Object3D);
  });

  it('天空色与地面色互相独立', () => {
    const h = new HemisphereLight(0xff0000, 0x00ff00);
    expect(h.color.r).toBeCloseTo(1, 5);
    expect(h.color.g).toBeCloseTo(0, 5);
    expect(h.groundColor.g).toBeCloseTo(1, 5);
    expect(h.groundColor.r).toBeCloseTo(0, 5);
  });
});

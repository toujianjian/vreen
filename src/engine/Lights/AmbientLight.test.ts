// AmbientLight 单元测试：构造、默认值、继承关系。

import { describe, it, expect } from 'vitest';
import { AmbientLight } from './AmbientLight';
import { Light } from './Light';
import { Object3D } from '../Core/Object3D';

describe('AmbientLight', () => {
  it('默认构造：白色、强度 1、无方向、无阴影', () => {
    const a = new AmbientLight();
    expect(a.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(a.intensity).toBe(1);
    expect(a.type).toBe('AmbientLight');
    expect(a.isAmbientLight).toBe(true);
    expect(a.isLight).toBe(true);
  });

  it('接受数字颜色与强度参数', () => {
    const a = new AmbientLight(0x404040, 0.5);
    expect(a.color.r).toBeCloseTo(0x40 / 255, 5);
    expect(a.color.g).toBeCloseTo(0x40 / 255, 5);
    expect(a.color.b).toBeCloseTo(0x40 / 255, 5);
    expect(a.intensity).toBe(0.5);
  });

  it('接受 hex 字符串颜色', () => {
    const a = new AmbientLight('#ff8800');
    expect(a.color.r).toBeCloseTo(1, 5);
    expect(a.color.g).toBeCloseTo(0x88 / 255, 5);
    expect(a.color.b).toBeCloseTo(0, 5);
  });

  it('继承自 Light 与 Object3D', () => {
    const a = new AmbientLight();
    expect(a).toBeInstanceOf(Light);
    expect(a).toBeInstanceOf(Object3D);
    // 可作为场景节点 add/remove
    const parent = new Object3D();
    parent.add(a);
    expect(parent.children).toContain(a);
    expect(a.parent).toBe(parent);
  });
});

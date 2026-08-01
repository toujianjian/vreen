// PointsMaterial 单元测试 —— 点云材质属性与复制/克隆。

import { describe, it, expect } from 'vitest';
import { PointsMaterial } from './PointsMaterial';

describe('PointsMaterial', () => {
  describe('构造与默认值', () => {
    it('默认构造:所有属性取默认值', () => {
      const m = new PointsMaterial();
      expect(m.type).toBe('PointsMaterial');
      expect(m.isPointsMaterial).toBe(true);
      expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
      expect(m.map).toBeNull();
      expect(m.alphaMap).toBeNull();
      expect(m.size).toBe(1);
      expect(m.sizeAttenuation).toBe(true);
      expect(m.opacity).toBe(1);
      expect(m.transparent).toBe(true);
      expect(m.alphaTest).toBe(0);
      expect(m.depthTest).toBe(true);
      expect(m.depthWrite).toBe(true);
      expect(m.wireframe).toBe(false);
      expect(m.renderOrder).toBe(0);
      // uuid 由 BasicMaterial 基类生成(8 位十六进制;位 31 置位时可能带负号)。
      expect(typeof m.uuid).toBe('string');
      expect(m.uuid.length).toBeGreaterThanOrEqual(8);
    });

    it('通过 options 覆盖默认值', () => {
      const m = new PointsMaterial({
        color: { r: 0.2, g: 0.4, b: 0.6 },
        size: 2.5,
        sizeAttenuation: false,
        opacity: 0.7,
        transparent: false,
        alphaTest: 0.5,
        depthWrite: false,
        renderOrder: 3,
      });
      expect(m.color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
      expect(m.size).toBe(2.5);
      expect(m.sizeAttenuation).toBe(false);
      expect(m.opacity).toBe(0.7);
      expect(m.transparent).toBe(false);
      expect(m.alphaTest).toBe(0.5);
      expect(m.depthWrite).toBe(false);
      expect(m.renderOrder).toBe(3);
    });

    it('color 是独立对象(修改不影响其他实例)', () => {
      const a = new PointsMaterial({ color: { r: 1, g: 0, b: 0 } });
      const b = new PointsMaterial();
      a.color.r = 0.5;
      expect(b.color.r).toBe(1); // b 不受影响
    });
  });

  describe('fromHex', () => {
    it('#rrggbb 6 位', () => {
      const m = PointsMaterial.fromHex('#ff8800');
      expect(m.color.r).toBeCloseTo(1, 5);
      expect(m.color.g).toBeCloseTo(0x88 / 255, 5);
      expect(m.color.b).toBeCloseTo(0, 5);
    });

    it('#rgb 3 位(简写展开)', () => {
      const m = PointsMaterial.fromHex('#f80');
      expect(m.color.r).toBeCloseTo(1, 5);
      expect(m.color.g).toBeCloseTo(0x88 / 255, 5);
      expect(m.color.b).toBeCloseTo(0, 5);
    });

    it('不带 # 前缀也能解析', () => {
      const m = PointsMaterial.fromHex('ffffff');
      expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
    });
  });

  describe('copy', () => {
    it('复制所有可变字段', () => {
      const src = new PointsMaterial({
        color: { r: 0.1, g: 0.2, b: 0.3 },
        size: 3,
        sizeAttenuation: false,
        opacity: 0.5,
        transparent: false,
        alphaTest: 0.25,
        depthWrite: false,
        depthTest: false,
        wireframe: true,
        renderOrder: 5,
      });
      src.userData = { tag: 'custom' };

      const dst = new PointsMaterial();
      dst.copy(src);

      expect(dst.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
      expect(dst.size).toBe(3);
      expect(dst.sizeAttenuation).toBe(false);
      expect(dst.opacity).toBe(0.5);
      expect(dst.transparent).toBe(false);
      expect(dst.alphaTest).toBe(0.25);
      expect(dst.depthWrite).toBe(false);
      expect(dst.depthTest).toBe(false);
      expect(dst.wireframe).toBe(true);
      expect(dst.renderOrder).toBe(5);
      expect(dst.userData).toEqual({ tag: 'custom' });
    });

    it('copy 后 color 是独立副本', () => {
      const src = new PointsMaterial({ color: { r: 1, g: 0, b: 0 } });
      const dst = new PointsMaterial().copy(src);
      dst.color.r = 0;
      expect(src.color.r).toBe(1);
    });
  });

  describe('clone', () => {
    it('克隆返回独立实例,值与原对象相等', () => {
      const src = new PointsMaterial({
        color: { r: 0.3, g: 0.6, b: 0.9 },
        size: 1.7,
        alphaTest: 0.4,
      });
      const clone = src.clone();
      expect(clone).not.toBe(src);
      expect(clone).toBeInstanceOf(PointsMaterial);
      expect(clone.color).toEqual(src.color);
      expect(clone.size).toBe(src.size);
      expect(clone.alphaTest).toBe(src.alphaTest);
      // 修改克隆不影响原对象
      clone.size = 99;
      expect(src.size).toBe(1.7);
    });
  });

  describe('Material 接口', () => {
    it('onBeforeCompile 是函数且不抛错', () => {
      const m = new PointsMaterial();
      expect(typeof m.onBeforeCompile).toBe('function');
      expect(() => m.onBeforeCompile({ vertexShader: '', fragmentShader: '' })).not.toThrow();
    });

    it('customProgramCacheKey 返回字符串', () => {
      const m = new PointsMaterial();
      expect(typeof m.customProgramCacheKey()).toBe('string');
    });
  });
});

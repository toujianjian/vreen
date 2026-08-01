// LineBasicMaterial 单元测试 —— 属性默认值、options 覆盖、fromHex、copy、clone。

import { describe, it, expect } from 'vitest';
import { LineBasicMaterial } from './LineBasicMaterial';

describe('LineBasicMaterial', () => {
  describe('构造与默认值', () => {
    it('默认构造:所有属性取默认值', () => {
      const m = new LineBasicMaterial();
      expect(m.type).toBe('LineBasicMaterial');
      expect(m.isLineBasicMaterial).toBe(true);
      expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
      expect(m.map).toBeNull();
      expect(m.linewidth).toBe(1);
      expect(m.dashed).toBe(false);
      expect(m.dashSize).toBe(1);
      expect(m.gapSize).toBe(1);
      expect(m.scale).toBe(1);
      expect(m.opacity).toBe(1);
      expect(m.transparent).toBe(false);
      expect(m.alphaTest).toBe(0);
      expect(m.depthTest).toBe(true);
      expect(m.depthWrite).toBe(true);
      expect(m.wireframe).toBe(false);
      expect(m.renderOrder).toBe(0);
      expect(typeof m.uuid).toBe('string');
    });

    it('通过 options 覆盖默认值', () => {
      const m = new LineBasicMaterial({
        color: { r: 0.1, g: 0.2, b: 0.3 },
        linewidth: 2,
        dashed: true,
        dashSize: 0.5,
        gapSize: 0.25,
        scale: 2,
        opacity: 0.8,
        transparent: true,
        alphaTest: 0.1,
        depthWrite: false,
        renderOrder: 2,
      });
      expect(m.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
      expect(m.linewidth).toBe(2);
      expect(m.dashed).toBe(true);
      expect(m.dashSize).toBe(0.5);
      expect(m.gapSize).toBe(0.25);
      expect(m.scale).toBe(2);
      expect(m.opacity).toBe(0.8);
      expect(m.transparent).toBe(true);
      expect(m.alphaTest).toBe(0.1);
      expect(m.depthWrite).toBe(false);
      expect(m.renderOrder).toBe(2);
    });

    it('color 是独立对象', () => {
      const a = new LineBasicMaterial({ color: { r: 1, g: 0, b: 0 } });
      const b = new LineBasicMaterial();
      a.color.r = 0.5;
      expect(b.color.r).toBe(1);
    });
  });

  describe('fromHex', () => {
    it('#rrggbb 6 位', () => {
      const m = LineBasicMaterial.fromHex('#00ff88');
      expect(m.color.r).toBeCloseTo(0, 5);
      expect(m.color.g).toBeCloseTo(1, 5);
      expect(m.color.b).toBeCloseTo(0x88 / 255, 5);
    });

    it('#rgb 3 位简写', () => {
      const m = LineBasicMaterial.fromHex('#0f8');
      expect(m.color.r).toBeCloseTo(0, 5);
      expect(m.color.g).toBeCloseTo(1, 5);
      expect(m.color.b).toBeCloseTo(0x88 / 255, 5);
    });
  });

  describe('copy', () => {
    it('复制所有可变字段', () => {
      const src = new LineBasicMaterial({
        color: { r: 0.1, g: 0.2, b: 0.3 },
        linewidth: 3,
        dashed: true,
        dashSize: 2,
        gapSize: 1,
        scale: 4,
        opacity: 0.5,
        transparent: true,
        alphaTest: 0.2,
        depthWrite: false,
        renderOrder: 7,
      });
      src.userData = { tag: 'edge' };
      const dst = new LineBasicMaterial().copy(src);
      expect(dst.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
      expect(dst.linewidth).toBe(3);
      expect(dst.dashed).toBe(true);
      expect(dst.dashSize).toBe(2);
      expect(dst.gapSize).toBe(1);
      expect(dst.scale).toBe(4);
      expect(dst.opacity).toBe(0.5);
      expect(dst.transparent).toBe(true);
      expect(dst.alphaTest).toBe(0.2);
      expect(dst.depthWrite).toBe(false);
      expect(dst.renderOrder).toBe(7);
      expect(dst.userData).toEqual({ tag: 'edge' });
    });

    it('copy 后 color 独立', () => {
      const src = new LineBasicMaterial({ color: { r: 1, g: 0, b: 0 } });
      const dst = new LineBasicMaterial().copy(src);
      dst.color.r = 0;
      expect(src.color.r).toBe(1);
    });
  });

  describe('clone', () => {
    it('克隆独立且值相等', () => {
      const src = new LineBasicMaterial({
        color: { r: 0.3, g: 0.6, b: 0.9 },
        linewidth: 2,
        dashed: true,
      });
      const c = src.clone();
      expect(c).not.toBe(src);
      expect(c).toBeInstanceOf(LineBasicMaterial);
      expect(c.color).toEqual(src.color);
      expect(c.linewidth).toBe(src.linewidth);
      expect(c.dashed).toBe(src.dashed);
      c.linewidth = 99;
      expect(src.linewidth).toBe(2);
    });
  });
});

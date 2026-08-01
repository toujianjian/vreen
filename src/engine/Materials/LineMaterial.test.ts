// LineMaterial 单元测试 — 属性、uniforms、syncUniforms、fromHex、copy/clone、shader。

import { describe, it, expect } from 'vitest';
import { LineMaterial, LINE_MATERIAL_VERT, LINE_MATERIAL_FRAG } from './LineMaterial';
import { Vector2 } from '../Math/Vector2';
import { BasicMaterial } from '../Core/Material';

describe('LineMaterial', () => {
  describe('构造', () => {
    it('默认值', () => {
      const m = new LineMaterial();
      expect(m.isLineMaterial).toBe(true);
      expect(m.type).toBe('LineMaterial');
      expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
      expect(m.linewidth).toBe(1);
      expect(m.resolution.x).toBe(1);
      expect(m.resolution.y).toBe(1);
      expect(m.dashed).toBe(false);
      expect(m.dashSize).toBe(1);
      expect(m.gapSize).toBe(1);
      expect(m.dashOffset).toBe(0);
      expect(m.scale).toBe(1);
      expect(m.worldUnits).toBe(false);
      expect(m.opacity).toBe(1);
      expect(m.transparent).toBe(false);
      expect(m.alphaTest).toBe(0);
    });

    it('继承 BasicMaterial', () => {
      const m = new LineMaterial();
      expect(m).toBeInstanceOf(BasicMaterial);
    });

    it('自定义选项', () => {
      const m = new LineMaterial({
        color: { r: 0.2, g: 0.8, b: 1 },
        linewidth: 5,
        resolution: new Vector2(1920, 1080),
        dashed: true,
        dashSize: 2,
        gapSize: 1,
        dashOffset: 0.5,
        scale: 3,
        worldUnits: true,
        opacity: 0.7,
        transparent: true,
        alphaTest: 0.1,
      });
      expect(m.color).toEqual({ r: 0.2, g: 0.8, b: 1 });
      expect(m.linewidth).toBe(5);
      expect(m.resolution.x).toBe(1920);
      expect(m.resolution.y).toBe(1080);
      expect(m.dashed).toBe(true);
      expect(m.dashSize).toBe(2);
      expect(m.gapSize).toBe(1);
      expect(m.dashOffset).toBe(0.5);
      expect(m.scale).toBe(3);
      expect(m.worldUnits).toBe(true);
      expect(m.opacity).toBe(0.7);
      expect(m.transparent).toBe(true);
      expect(m.alphaTest).toBe(0.1);
    });

    it('resolution 被 clone(不共享引用)', () => {
      const res = new Vector2(100, 200);
      const m = new LineMaterial({ resolution: res });
      expect(m.resolution).not.toBe(res);
      expect(m.resolution.x).toBe(100);
      res.x = 999;
      expect(m.resolution.x).toBe(100); // 不受外部修改影响
    });
  });

  describe('uniforms', () => {
    it('构造时 uniforms 与属性同步', () => {
      const m = new LineMaterial({ linewidth: 3, color: { r: 0.5, g: 0.5, b: 0.5 } });
      expect(m.uniforms.u_linewidth.value).toBe(3);
      expect(m.uniforms.u_lineColor.value).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
      expect(m.uniforms.u_worldUnits.value).toBe(0);
    });

    it('worldUnits=true → u_worldUnits=1', () => {
      const m = new LineMaterial({ worldUnits: true });
      expect(m.uniforms.u_worldUnits.value).toBe(1);
    });

    it('syncUniforms 刷新 uniforms', () => {
      const m = new LineMaterial();
      m.linewidth = 10;
      m.color = { r: 1, g: 0, b: 0 };
      m.worldUnits = true;
      m.opacity = 0.5;
      // syncUniforms 前 uniforms 还是旧值
      expect(m.uniforms.u_linewidth.value).toBe(1);
      m.syncUniforms();
      expect(m.uniforms.u_linewidth.value).toBe(10);
      expect(m.uniforms.u_lineColor.value).toEqual({ r: 1, g: 0, b: 0 });
      expect(m.uniforms.u_worldUnits.value).toBe(1);
      expect(m.uniforms.u_opacity.value).toBe(0.5);
    });

    it('uniforms 包含所有字段', () => {
      const m = new LineMaterial();
      const keys = Object.keys(m.uniforms);
      expect(keys).toContain('u_lineColor');
      expect(keys).toContain('u_linewidth');
      expect(keys).toContain('u_resolution');
      expect(keys).toContain('u_dashSize');
      expect(keys).toContain('u_gapSize');
      expect(keys).toContain('u_dashOffset');
      expect(keys).toContain('u_scale');
      expect(keys).toContain('u_opacity');
      expect(keys).toContain('u_worldUnits');
    });
  });

  describe('fromHex', () => {
    it('#rrggbb 格式', () => {
      const m = LineMaterial.fromHex('#ff0000');
      expect(m.color.r).toBeCloseTo(1, 5);
      expect(m.color.g).toBeCloseTo(0, 5);
      expect(m.color.b).toBeCloseTo(0, 5);
    });

    it('#rgb 短格式', () => {
      const m = LineMaterial.fromHex('#0f0');
      expect(m.color.r).toBeCloseTo(0, 5);
      expect(m.color.g).toBeCloseTo(1, 5);
      expect(m.color.b).toBeCloseTo(0, 5);
    });

    it('fromHex 后 uniforms 同步', () => {
      const m = LineMaterial.fromHex('#0080ff');
      expect(m.uniforms.u_lineColor.value).toEqual(m.color);
    });
  });

  describe('copy / clone', () => {
    it('copy 复制所有字段', () => {
      const src = new LineMaterial({
        color: { r: 0.1, g: 0.2, b: 0.3 },
        linewidth: 7,
        dashed: true,
        dashSize: 3,
        gapSize: 2,
        worldUnits: true,
        opacity: 0.6,
        transparent: true,
      });
      const dst = new LineMaterial();
      dst.copy(src);
      expect(dst.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
      expect(dst.linewidth).toBe(7);
      expect(dst.dashed).toBe(true);
      expect(dst.dashSize).toBe(3);
      expect(dst.gapSize).toBe(2);
      expect(dst.worldUnits).toBe(true);
      expect(dst.opacity).toBe(0.6);
      expect(dst.transparent).toBe(true);
    });

    it('copy 后 resolution 不共享引用', () => {
      const src = new LineMaterial({ resolution: new Vector2(800, 600) });
      const dst = new LineMaterial();
      dst.copy(src);
      expect(dst.resolution).not.toBe(src.resolution);
      expect(dst.resolution.x).toBe(800);
    });

    it('copy 后 uniforms 同步', () => {
      const src = new LineMaterial({ linewidth: 9 });
      const dst = new LineMaterial();
      dst.copy(src);
      expect(dst.uniforms.u_linewidth.value).toBe(9);
    });

    it('clone 返回独立实例', () => {
      const src = new LineMaterial({ linewidth: 4, color: { r: 0.5, g: 0.5, b: 0.5 } });
      const dst = src.clone();
      expect(dst).not.toBe(src);
      expect(dst.linewidth).toBe(4);
      expect(dst.color).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
      // 修改 dst 不影响 src
      dst.linewidth = 99;
      expect(src.linewidth).toBe(4);
    });
  });

  describe('shader 源码', () => {
    it('LINE_MATERIAL_VERT 非空且包含 GLSL ES 3.0', () => {
      expect(LINE_MATERIAL_VERT.length).toBeGreaterThan(100);
      expect(LINE_MATERIAL_VERT).toContain('#version 300 es');
      expect(LINE_MATERIAL_VERT).toContain('a_instanceStart');
      expect(LINE_MATERIAL_VERT).toContain('a_instanceEnd');
      expect(LINE_MATERIAL_VERT).toContain('u_linewidth');
      expect(LINE_MATERIAL_VERT).toContain('u_resolution');
    });

    it('LINE_MATERIAL_FRAG 非空且包含虚线 discard', () => {
      expect(LINE_MATERIAL_FRAG.length).toBeGreaterThan(50);
      expect(LINE_MATERIAL_FRAG).toContain('#version 300 es');
      expect(LINE_MATERIAL_FRAG).toContain('u_lineColor');
      expect(LINE_MATERIAL_FRAG).toContain('discard');
    });

    it('vertex shader 包含 USE_COLOR / USE_DASH 预处理块', () => {
      expect(LINE_MATERIAL_VERT).toContain('USE_COLOR');
      expect(LINE_MATERIAL_VERT).toContain('USE_DASH');
    });

    it('fragment shader 包含 USE_DASH 预处理块', () => {
      expect(LINE_MATERIAL_FRAG).toContain('USE_DASH');
    });

    it('vertex shader 包含 worldUnits 分支', () => {
      expect(LINE_MATERIAL_VERT).toContain('u_worldUnits');
      expect(LINE_MATERIAL_VERT).toContain('worldUnits');
    });
  });

  describe('深度/渲染顺序', () => {
    it('可设置 depthTest / depthWrite / renderOrder', () => {
      const m = new LineMaterial({
        depthTest: false,
        depthWrite: true,
        renderOrder: 5,
      });
      expect(m.depthTest).toBe(false);
      expect(m.depthWrite).toBe(true);
      expect(m.renderOrder).toBe(5);
    });
  });
});

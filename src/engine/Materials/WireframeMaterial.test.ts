// WireframeMaterial 单元测试。

import { describe, it, expect } from 'vitest';
import { WireframeMaterial, WIREFRAME_VERT, WIREFRAME_FRAG } from './WireframeMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';

describe('WireframeMaterial', () => {
  it('默认构造:黑线、opacity 1、linewidth 1、wireframe=true、不写深度', () => {
    const m = new WireframeMaterial();
    expect(m.type).toBe('Wireframe');
    expect(m.isWireframeMaterial).toBe(true);
    expect(m.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.opacity).toBe(1);
    expect(m.linewidth).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.wireframe).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  it('继承自 BasicMaterial', () => {
    expect(new WireframeMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new WireframeMaterial();
    const b = new WireframeMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('选项覆盖生效', () => {
    const m = new WireframeMaterial({
      color: { r: 0, g: 1, b: 0 },
      opacity: 0.5,
      linewidth: 2,
      transparent: true,
      depthTest: false,
      depthWrite: true,
      renderOrder: 5,
    });
    expect(m.color).toEqual({ r: 0, g: 1, b: 0 });
    expect(m.opacity).toBeCloseTo(0.5, 6);
    expect(m.linewidth).toBe(2);
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(m.renderOrder).toBe(5);
    // wireframe 总是 true(构造时强制设置)
    expect(m.wireframe).toBe(true);
  });

  it('color 对象不跨实例共享', () => {
    const a = new WireframeMaterial();
    const b = new WireframeMaterial();
    a.color.r = 0.5;
    expect(b.color.r).toBe(0);
  });

  it('shader 源码非空且以 #version 300 es 开头', () => {
    expect(typeof WIREFRAME_VERT).toBe('string');
    expect(typeof WIREFRAME_FRAG).toBe('string');
    expect(WIREFRAME_VERT.startsWith('#version 300 es')).toBe(true);
    expect(WIREFRAME_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('fragment shader 输出纯色 + opacity', () => {
    expect(WIREFRAME_FRAG).toContain('u_color');
    expect(WIREFRAME_FRAG).toContain('u_opacity');
  });

  it('onBeforeCompile 默认 no-op 且 customProgramCacheKey 返回字符串', () => {
    const m = new WireframeMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('copy 复制所有字段且独立', () => {
    const src = new WireframeMaterial({
      color: { r: 0.1, g: 0.2, b: 0.3 },
      opacity: 0.7,
      linewidth: 3,
      transparent: true,
      depthTest: false,
      depthWrite: true,
      renderOrder: 2,
    });
    src.userData = { tag: 'src' };

    const dst = new WireframeMaterial();
    dst.copy(src);

    expect(dst.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(dst.opacity).toBeCloseTo(0.7, 6);
    expect(dst.linewidth).toBe(3);
    expect(dst.transparent).toBe(true);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(true);
    expect(dst.renderOrder).toBe(2);
    expect(dst.userData).toEqual({ tag: 'src' });

    // 修改 dst 不影响 src
    dst.color.r = 1;
    expect(src.color.r).toBeCloseTo(0.1, 6);
    dst.linewidth = 9;
    expect(src.linewidth).toBe(3);
  });

  it('clone 产生等价但独立的新实例', () => {
    const src = new WireframeMaterial({
      color: { r: 0.5, g: 0.5, b: 0.5 },
      linewidth: 4,
      opacity: 0.6,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(WireframeMaterial);
    expect(cl).not.toBe(src);
    expect(cl.color).toEqual(src.color);
    expect(cl.linewidth).toBe(src.linewidth);
    expect(cl.opacity).toBeCloseTo(src.opacity, 6);
    // 修改 clone 不影响 src
    cl.linewidth = 1;
    expect(src.linewidth).toBe(4);
  });

  it('clone 分配新 uuid', () => {
    const src = new WireframeMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });
});

// OutlineMaterial 单元测试。
//
// 覆盖:构造默认值、选项覆盖、clone/copy 独立性、shader 源码非空、继承关系。
// 不依赖 WebGL 上下文(纯数据类测试)。

import { describe, it, expect } from 'vitest';
import { OutlineMaterial, OUTLINE_VERT, OUTLINE_FRAG } from './OutlineMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';

describe('OutlineMaterial', () => {
  it('默认构造:黑描边、thickness 0.02、不透明、不写深度', () => {
    const m = new OutlineMaterial();
    expect(m.type).toBe('Outline');
    expect(m.isOutlineMaterial).toBe(true);
    expect(m.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.thickness).toBeCloseTo(0.02, 6);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  it('继承自 BasicMaterial', () => {
    expect(new OutlineMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new OutlineMaterial();
    const b = new OutlineMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('选项覆盖生效', () => {
    const m = new OutlineMaterial({
      color: { r: 0.5, g: 0.5, b: 0.5 },
      thickness: 0.05,
      opacity: 0.6,
      transparent: true,
      depthTest: false,
      depthWrite: true,
      renderOrder: 3,
    });
    expect(m.color).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(m.thickness).toBeCloseTo(0.05, 6);
    expect(m.opacity).toBeCloseTo(0.6, 6);
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(m.renderOrder).toBe(3);
  });

  it('color 对象不跨实例共享', () => {
    const a = new OutlineMaterial();
    const b = new OutlineMaterial();
    a.color.r = 0.5;
    expect(b.color.r).toBe(0);
  });

  it('shader 源码非空且以 #version 300 es 开头', () => {
    expect(typeof OUTLINE_VERT).toBe('string');
    expect(typeof OUTLINE_FRAG).toBe('string');
    expect(OUTLINE_VERT.startsWith('#version 300 es')).toBe(true);
    expect(OUTLINE_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('vertex shader 包含沿法线膨胀逻辑', () => {
    expect(OUTLINE_VERT).toContain('u_thickness');
    expect(OUTLINE_VERT).toContain('u_normalMatrix');
    expect(OUTLINE_VERT).toContain('worldNormal');
  });

  it('fragment shader 输出纯色 + opacity', () => {
    expect(OUTLINE_FRAG).toContain('u_color');
    expect(OUTLINE_FRAG).toContain('u_opacity');
  });

  it('onBeforeCompile 默认 no-op 且 customProgramCacheKey 返回字符串', () => {
    const m = new OutlineMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('copy 复制所有字段且独立', () => {
    const src = new OutlineMaterial({
      color: { r: 0.2, g: 0.3, b: 0.4 },
      thickness: 0.08,
      opacity: 0.5,
      transparent: true,
      depthTest: false,
      depthWrite: true,
      renderOrder: 2,
    });
    src.userData = { tag: 'src' };

    const dst = new OutlineMaterial();
    dst.copy(src);

    expect(dst.color).toEqual({ r: 0.2, g: 0.3, b: 0.4 });
    expect(dst.thickness).toBeCloseTo(0.08, 6);
    expect(dst.opacity).toBeCloseTo(0.5, 6);
    expect(dst.transparent).toBe(true);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(true);
    expect(dst.renderOrder).toBe(2);
    expect(dst.userData).toEqual({ tag: 'src' });

    // 修改 dst 不影响 src
    dst.color.r = 1;
    expect(src.color.r).toBeCloseTo(0.2, 6);
    dst.thickness = 0.99;
    expect(src.thickness).toBeCloseTo(0.08, 6);
  });

  it('clone 产生等价但独立的新实例', () => {
    const src = new OutlineMaterial({
      color: { r: 0.4, g: 0.5, b: 0.6 },
      thickness: 0.04,
      opacity: 0.7,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(OutlineMaterial);
    expect(cl).not.toBe(src);
    expect(cl.color).toEqual(src.color);
    expect(cl.thickness).toBeCloseTo(src.thickness, 6);
    expect(cl.opacity).toBeCloseTo(src.opacity, 6);
    // 修改 clone 不影响 src
    cl.thickness = 0.1;
    expect(src.thickness).toBeCloseTo(0.04, 6);
  });

  it('clone 分配新 uuid', () => {
    const src = new OutlineMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });
});

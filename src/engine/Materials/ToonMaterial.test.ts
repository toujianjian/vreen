// ToonMaterial 单元测试。
//
// 覆盖:构造默认值、选项覆盖、clone/copy 独立性、shader 源码非空、继承关系。
// 不依赖 WebGL 上下文(纯数据类测试)。

import { describe, it, expect } from 'vitest';
import { ToonMaterial, TOON_VERT, TOON_FRAG } from './ToonMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';

describe('ToonMaterial', () => {
  it('默认构造:白颜色、3 阶梯、黑色描边、thickness 0.02', () => {
    const m = new ToonMaterial();
    expect(m.type).toBe('Toon');
    expect(m.isToonMaterial).toBe(true);
    expect(m.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(m.gradientMap).toBeNull();
    expect(m.gradientSteps).toBe(3);
    expect(m.outlineThickness).toBeCloseTo(0.02, 6);
    expect(m.outlineColor).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
  });

  it('继承自 BasicMaterial', () => {
    expect(new ToonMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new ToonMaterial();
    const b = new ToonMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('选项覆盖生效', () => {
    const m = new ToonMaterial({
      color: { r: 0.8, g: 0.6, b: 0.4 },
      gradientSteps: 4,
      outlineThickness: 0.05,
      outlineColor: { r: 0.1, g: 0.1, b: 0.1 },
      opacity: 0.7,
      transparent: true,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
    });
    expect(m.color).toEqual({ r: 0.8, g: 0.6, b: 0.4 });
    expect(m.gradientSteps).toBe(4);
    expect(m.outlineThickness).toBeCloseTo(0.05, 6);
    expect(m.outlineColor).toEqual({ r: 0.1, g: 0.1, b: 0.1 });
    expect(m.opacity).toBe(0.7);
    expect(m.transparent).toBe(true);
    expect(m.wireframe).toBe(true);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
  });

  it('color 对象不跨实例共享', () => {
    const a = new ToonMaterial();
    const b = new ToonMaterial();
    a.color.r = 0.5;
    expect(b.color.r).toBe(1);
  });

  it('shader 源码非空且以 #version 300 es 开头', () => {
    expect(typeof TOON_VERT).toBe('string');
    expect(typeof TOON_FRAG).toBe('string');
    expect(TOON_VERT.startsWith('#version 300 es')).toBe(true);
    expect(TOON_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('fragment shader 包含阶梯量化逻辑', () => {
    // 应有 u_gradientSteps 与 floor 量化
    expect(TOON_FRAG).toContain('u_gradientSteps');
    expect(TOON_FRAG).toContain('floor');
    // 应支持 gradientMap 采样
    expect(TOON_FRAG).toContain('u_gradientMap');
  });

  it('onBeforeCompile 默认 no-op 且 customProgramCacheKey 返回字符串', () => {
    const m = new ToonMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('copy 复制所有字段且独立', () => {
    const src = new ToonMaterial({
      color: { r: 0.2, g: 0.4, b: 0.6 },
      gradientSteps: 5,
      outlineThickness: 0.1,
      outlineColor: { r: 0.3, g: 0.3, b: 0.3 },
      opacity: 0.5,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    src.userData = { tag: 'src' };

    const dst = new ToonMaterial();
    dst.copy(src);

    expect(dst.color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(dst.gradientSteps).toBe(5);
    expect(dst.outlineThickness).toBeCloseTo(0.1, 6);
    expect(dst.outlineColor).toEqual({ r: 0.3, g: 0.3, b: 0.3 });
    expect(dst.opacity).toBe(0.5);
    expect(dst.transparent).toBe(true);
    expect(dst.depthTest).toBe(false);
    expect(dst.depthWrite).toBe(false);
    expect(dst.userData).toEqual({ tag: 'src' });

    // 修改 dst 不影响 src
    dst.color.r = 1;
    expect(src.color.r).toBeCloseTo(0.2, 6);
    dst.outlineThickness = 0.99;
    expect(src.outlineThickness).toBeCloseTo(0.1, 6);
  });

  it('clone 产生等价但独立的新实例', () => {
    const src = new ToonMaterial({
      color: { r: 0.5, g: 0.5, b: 0.5 },
      gradientSteps: 4,
      outlineThickness: 0.03,
    });
    const cl = src.clone();
    expect(cl).toBeInstanceOf(ToonMaterial);
    expect(cl).not.toBe(src);
    expect(cl.color).toEqual(src.color);
    expect(cl.gradientSteps).toBe(src.gradientSteps);
    expect(cl.outlineThickness).toBeCloseTo(src.outlineThickness, 6);
    // 修改 clone 不影响 src
    cl.gradientSteps = 8;
    expect(src.gradientSteps).toBe(4);
  });

  it('clone 分配新 uuid', () => {
    const src = new ToonMaterial();
    const cl = src.clone();
    expect(cl.uuid).not.toBe(src.uuid);
  });
});

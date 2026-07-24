// ShadowMaterial 单元测试。
//
// 覆盖:构造默认值、选项覆盖、属性类型、shader 源码非空、与 BasicMaterial 继承关系。
// 不依赖 WebGL 上下文(纯数据类测试)。

import { describe, it, expect } from 'vitest';
import { ShadowMaterial, SHADOW_MATERIAL_VERT, SHADOW_MATERIAL_FRAG } from './ShadowMaterial';
import { BasicMaterial, type ShaderObject } from '../Core/Material';
import { PBR_VERT } from './shaders';

describe('ShadowMaterial', () => {
  it('默认构造:黑阴影、opacity 0.5、transparent=true、depthWrite=false', () => {
    const m = new ShadowMaterial();
    expect(m.type).toBe('Shadow');
    expect(m.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.opacity).toBe(0.5);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
  });

  it('继承自 BasicMaterial', () => {
    expect(new ShadowMaterial()).toBeInstanceOf(BasicMaterial);
  });

  it('分配唯一 uuid', () => {
    const a = new ShadowMaterial();
    const b = new ShadowMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });

  it('选项覆盖生效', () => {
    const m = new ShadowMaterial({
      color: { r: 0.1, g: 0.2, b: 0.3 },
      opacity: 0.8,
      transparent: false,
      depthWrite: true,
      depthTest: false,
    });
    expect(m.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(m.opacity).toBe(0.8);
    expect(m.transparent).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(m.depthTest).toBe(false);
  });

  it('color 对象不跨实例共享', () => {
    const a = new ShadowMaterial();
    const b = new ShadowMaterial();
    a.color.r = 0.5;
    expect(b.color.r).toBe(0);
  });

  it('显式传 transparent=true 时保持 true(覆盖默认 true)', () => {
    const m = new ShadowMaterial({ transparent: true });
    expect(m.transparent).toBe(true);
  });

  it('显式传 depthWrite=true 时覆盖默认 false', () => {
    const m = new ShadowMaterial({ depthWrite: true });
    expect(m.depthWrite).toBe(true);
  });

  it('shader 源码非空且复用 PBR_VERT', () => {
    expect(SHADOW_MATERIAL_VERT).toBe(PBR_VERT);
    expect(typeof SHADOW_MATERIAL_FRAG).toBe('string');
    expect(SHADOW_MATERIAL_FRAG.startsWith('#version 300 es')).toBe(true);
  });

  it('fragment shader 内联了 PCF 采样函数', () => {
    expect(SHADOW_MATERIAL_FRAG).toContain('sampleShadowPCF');
    expect(SHADOW_MATERIAL_FRAG).toContain('u_shadowMap');
    expect(SHADOW_MATERIAL_FRAG).toContain('u_lightVP');
  });

  it('fragment shader 输出 alpha = opacity * (1 - visibility)', () => {
    expect(SHADOW_MATERIAL_FRAG).toContain('u_opacity * (1.0 - visibility)');
  });

  it('onBeforeCompile 默认 no-op 且 customProgramCacheKey 返回字符串', () => {
    const m = new ShadowMaterial();
    const shader: ShaderObject = { vertexShader: 'a', fragmentShader: 'b' };
    expect(() => m.onBeforeCompile(shader)).not.toThrow();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });

  it('opacity 与 color 可在构造后修改', () => {
    const m = new ShadowMaterial();
    m.opacity = 0.9;
    m.color = { r: 0.5, g: 0.5, b: 0.5 };
    expect(m.opacity).toBe(0.9);
    expect(m.color).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });
});

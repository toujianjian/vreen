// ReflectorMaterial 测试 — 平面镜面反射材质。
//
// 验证:
//   • 构造默认值 + 自定义选项
//   • copy / clone 深拷贝
//   • 类型标志
//   • tint / baseColor 接受数组或 RGB 对象
//   • shader 源码包含关键 uniform/attribute
//   • 透视除法 + 菲涅尔混合逻辑(shader 字符串检查)
//   • 与 Reflector 数学库的集成接口(textureMatrix 字段)

import { describe, it, expect } from 'vitest';
import { ReflectorMaterial, REFLECTOR_VERT, REFLECTOR_FRAG } from './ReflectorMaterial';
import { Matrix4 } from '../Math/Matrix4';
import { BasicMaterial } from '../Core/Material';

// ─────────────────────────────────────────────────────────────────────

describe('ReflectorMaterial construction', () => {
  it('defaults: opacity 1, tint white, no fresnel, dark base', () => {
    const m = new ReflectorMaterial();
    expect(m.opacity).toBe(1);
    expect(m.tint).toEqual([1, 1, 1]);
    expect(m.fresnelScale).toBe(0);
    expect(m.fresnelPower).toBe(3);
    expect(m.baseColor).toEqual([0.02, 0.02, 0.03]);
    expect(m.transparent).toBe(false);
    expect(m.reflectionTexture).toBeNull();
    expect(m.textureMatrix).toBeNull();
  });

  it('accepts custom options', () => {
    const tex = {} as any;
    const mat4 = new Matrix4();
    const m = new ReflectorMaterial({
      reflectionTexture: tex,
      textureMatrix: mat4,
      tint: [0.9, 0.8, 0.7],
      opacity: 0.5,
      fresnelScale: 0.4,
      fresnelPower: 5,
      baseColor: [0.1, 0.2, 0.3],
      transparent: true,
      depthWrite: false,
    });
    expect(m.reflectionTexture).toBe(tex);
    expect(m.textureMatrix).toBe(mat4);
    expect(m.tint).toEqual([0.9, 0.8, 0.7]);
    expect(m.opacity).toBeCloseTo(0.5);
    expect(m.fresnelScale).toBeCloseTo(0.4);
    expect(m.fresnelPower).toBe(5);
    expect(m.baseColor).toEqual([0.1, 0.2, 0.3]);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  it('accepts RGB object for tint', () => {
    const m = new ReflectorMaterial({ tint: { r: 0.1, g: 0.2, b: 0.3 } });
    expect(m.tint).toEqual([0.1, 0.2, 0.3]);
  });

  it('accepts RGB object for baseColor', () => {
    const m = new ReflectorMaterial({ baseColor: { r: 0.4, g: 0.5, b: 0.6 } });
    expect(m.baseColor).toEqual([0.4, 0.5, 0.6]);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('ReflectorMaterial type', () => {
  it('type is "Reflector"', () => {
    const m = new ReflectorMaterial();
    expect(m.type).toBe('Reflector');
  });

  it('isReflectorMaterial flag is true', () => {
    const m = new ReflectorMaterial();
    expect(m.isReflectorMaterial).toBe(true);
  });

  it('extends BasicMaterial', () => {
    const m = new ReflectorMaterial();
    expect(m).toBeInstanceOf(BasicMaterial);
  });

  it('has unique uuid', () => {
    const a = new ReflectorMaterial();
    const b = new ReflectorMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('ReflectorMaterial copy / clone', () => {
  it('copy duplicates all fields', () => {
    const tex = {} as any;
    const mat4 = new Matrix4().makePerspective(-0.1 * Math.tan(0.5), 0.1 * Math.tan(0.5), 0.1 * Math.tan(0.5), -0.1 * Math.tan(0.5), 0.1, 100);
    const src = new ReflectorMaterial({
      reflectionTexture: tex,
      textureMatrix: mat4,
      tint: [0.5, 0.6, 0.7],
      opacity: 0.8,
      fresnelScale: 0.3,
      fresnelPower: 4,
      baseColor: [0.01, 0.02, 0.03],
      transparent: true,
      depthWrite: false,
    });
    const dst = new ReflectorMaterial();
    dst.copy(src);
    expect(dst.reflectionTexture).toBe(tex);
    expect(dst.textureMatrix).toBe(mat4);
    expect(dst.tint).toEqual([0.5, 0.6, 0.7]);
    expect(dst.opacity).toBeCloseTo(0.8);
    expect(dst.fresnelScale).toBeCloseTo(0.3);
    expect(dst.fresnelPower).toBe(4);
    expect(dst.baseColor).toEqual([0.01, 0.02, 0.03]);
    expect(dst.transparent).toBe(true);
    expect(dst.depthWrite).toBe(false);
  });

  it('copy is independent (arrays not shared)', () => {
    const src = new ReflectorMaterial({ tint: [1, 2, 3], baseColor: [4, 5, 6] });
    const dst = new ReflectorMaterial().copy(src);
    dst.tint[0] = 99;
    dst.baseColor[0] = 88;
    expect(src.tint[0]).toBe(1);
    expect(src.baseColor[0]).toBe(4);
  });

  it('clone returns independent copy', () => {
    const src = new ReflectorMaterial({
      tint: [0.1, 0.2, 0.3],
      opacity: 0.5,
      fresnelScale: 0.7,
    });
    const c = src.clone();
    expect(c).not.toBe(src);
    expect(c.tint).toEqual(src.tint);
    expect(c.opacity).toBe(src.opacity);
    expect(c.fresnelScale).toBe(src.fresnelScale);
    // 独立性
    c.tint[0] = 99;
    expect(src.tint[0]).toBeCloseTo(0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('ReflectorMaterial shader source', () => {
  it('REFLECTOR_VERT has #version 300 es', () => {
    expect(REFLECTOR_VERT).toContain('#version 300 es');
  });

  it('REFLECTOR_FRAG has #version 300 es', () => {
    expect(REFLECTOR_FRAG).toContain('#version 300 es');
  });

  it('vertex shader uses textureMatrix uniform', () => {
    expect(REFLECTOR_VERT).toContain('u_textureMatrix');
    expect(REFLECTOR_VERT).toContain('uniform mat4 u_textureMatrix');
  });

  it('vertex shader computes v_reflectionCoord = textureMatrix * worldPos', () => {
    expect(REFLECTOR_VERT).toContain('v_reflectionCoord');
    expect(REFLECTOR_VERT).toContain('u_textureMatrix * worldPos');
  });

  it('vertex shader has standard transform uniforms', () => {
    expect(REFLECTOR_VERT).toContain('u_model');
    expect(REFLECTOR_VERT).toContain('u_view');
    expect(REFLECTOR_VERT).toContain('u_projection');
    expect(REFLECTOR_VERT).toContain('u_normalMatrix');
  });

  it('fragment shader samples reflection texture', () => {
    expect(REFLECTOR_FRAG).toContain('u_reflectionMap');
    expect(REFLECTOR_FRAG).toContain('sampler2D u_reflectionMap');
    expect(REFLECTOR_FRAG).toContain('texture(u_reflectionMap');
  });

  it('fragment shader does perspective divide', () => {
    expect(REFLECTOR_FRAG).toContain('v_reflectionCoord.xy / v_reflectionCoord.w');
  });

  it('fragment shader has tint uniform', () => {
    expect(REFLECTOR_FRAG).toContain('u_tint');
    expect(REFLECTOR_FRAG).toContain('reflColor *= u_tint');
  });

  it('fragment shader has opacity uniform', () => {
    expect(REFLECTOR_FRAG).toContain('u_opacity');
    expect(REFLECTOR_FRAG).toContain('vec4(finalColor, u_opacity)');
  });

  it('fragment shader has Fresnel logic', () => {
    expect(REFLECTOR_FRAG).toContain('u_fresnelScale');
    expect(REFLECTOR_FRAG).toContain('fresnelSchlick');
    expect(REFLECTOR_FRAG).toContain('u_fresnelPower');
  });

  it('fragment shader has baseColor for non-reflective regions', () => {
    expect(REFLECTOR_FRAG).toContain('u_baseColor');
    expect(REFLECTOR_FRAG).toContain('mix(u_baseColor');
  });

  it('fragment shader has reflectionMapEnabled flag', () => {
    expect(REFLECTOR_FRAG).toContain('u_reflectionMapEnabled');
    expect(REFLECTOR_FRAG).toContain('u_reflectionMapEnabled == 1');
  });

  it('fragment shader clamps reflection UV to [0,1]', () => {
    expect(REFLECTOR_FRAG).toContain('clamp(reflUv');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('ReflectorMaterial integration with Reflector math', () => {
  it('textureMatrix field accepts Matrix4 from Reflector.computeTextureMatrix', () => {
    // 模拟 Reflector.computeTextureMatrix 的输出
    const proj = new Matrix4().makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const view = new Matrix4().makeLookAt(
      { x: 0, y: -5, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    // 模拟 Reflector 内部的 textureMatrix 计算(简化版)
    const scaleBias = new Matrix4();
    const sb = scaleBias.elements;
    sb[0] = 0.5; sb[5] = 0.5; sb[10] = 0.5;
    sb[12] = 0.5; sb[13] = 0.5; sb[14] = 0.5;
    const pv = new Matrix4().multiplyMatrices(proj, view);
    const textureMatrix = new Matrix4().multiplyMatrices(scaleBias, pv);

    const m = new ReflectorMaterial({ textureMatrix });
    expect(m.textureMatrix).toBe(textureMatrix);
    expect(m.textureMatrix!.elements.length).toBe(16);
  });

  it('can update textureMatrix at runtime', () => {
    const m = new ReflectorMaterial();
    expect(m.textureMatrix).toBeNull();
    const mat = new Matrix4();
    m.textureMatrix = mat;
    expect(m.textureMatrix).toBe(mat);
  });

  it('can update reflectionTexture at runtime', () => {
    const m = new ReflectorMaterial();
    expect(m.reflectionTexture).toBeNull();
    const tex = { isTexture: true } as any;
    m.reflectionTexture = tex;
    expect(m.reflectionTexture).toBe(tex);
  });
});

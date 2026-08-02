// StandardMaterial.test.ts — PBR 标准材质测试。
//
// 验证:
//   1. 构造与默认值(含新增 normalScale)
//   2. PBR 纹理贴图字段(map / normalMap / metallicRoughnessMap / emissiveMap)
//   3. fromHex 便捷构造
//   4. normalScale 字段
//   5. PBR_FRAG shader 包含所有 4 种贴图 uniform
//   6. PBR_FRAG 包含 derivative-based TBN 法线贴图逻辑
//   7. PBR_FRAG 包含 emissive map 采样
//   8. 序列化相关字段

import { describe, it, expect } from 'vitest';
import { StandardMaterial, STANDARD_FRAGMENT_SRC, STANDARD_VERTEX_SRC } from './StandardMaterial';
import { PBR_FRAG, PBR_VERT } from './shaders';
import { Texture } from '../Core/Texture';

describe('StandardMaterial: construction', () => {
  it('creates with default values', () => {
    const m = new StandardMaterial();
    expect(m.type).toBe('Standard');
    expect(m.baseColor).toEqual({ r: 0.8, g: 0.8, b: 0.8 });
    expect(m.metallic).toBe(0);
    expect(m.roughness).toBeCloseTo(0.5, 5);
    expect(m.emissive).toEqual({ r: 0, g: 0, b: 0 });
    expect(m.emissiveIntensity).toBe(1);
    expect(m.opacity).toBe(1);
    expect(m.receiveShadow).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(true);
    expect(m.wireframe).toBe(false);
  });

  it('assigns unique uuid', () => {
    const a = new StandardMaterial();
    const b = new StandardMaterial();
    expect(a.uuid).not.toBe(b.uuid);
  });
});

describe('StandardMaterial: PBR texture maps', () => {
  it('all map fields default to null', () => {
    const m = new StandardMaterial();
    expect(m.map).toBeNull();
    expect(m.normalMap).toBeNull();
    expect(m.metallicRoughnessMap).toBeNull();
    expect(m.emissiveMap).toBeNull();
  });

  it('normalScale defaults to 1.0', () => {
    const m = new StandardMaterial();
    expect(m.normalScale).toBeCloseTo(1.0, 5);
  });

  it('accepts Texture instances for all maps', () => {
    const m = new StandardMaterial();
    const tex1 = new Texture();
    const tex2 = new Texture();
    const tex3 = new Texture();
    const tex4 = new Texture();
    m.map = tex1;
    m.normalMap = tex2;
    m.metallicRoughnessMap = tex3;
    m.emissiveMap = tex4;
    expect(m.map).toBe(tex1);
    expect(m.normalMap).toBe(tex2);
    expect(m.metallicRoughnessMap).toBe(tex3);
    expect(m.emissiveMap).toBe(tex4);
  });

  it('normalScale can be set to custom values', () => {
    const m = new StandardMaterial();
    m.normalScale = 0.5;
    expect(m.normalScale).toBeCloseTo(0.5, 5);
    m.normalScale = 2.0;
    expect(m.normalScale).toBeCloseTo(2.0, 5);
  });
});

describe('StandardMaterial: fromHex', () => {
  it('parses 6-digit hex', () => {
    const m = StandardMaterial.fromHex('#ff8800');
    expect(m.baseColor.r).toBeCloseTo(1.0, 2);
    expect(m.baseColor.g).toBeCloseTo(0x88 / 255, 2);
    expect(m.baseColor.b).toBeCloseTo(0, 2);
  });

  it('parses 3-digit hex', () => {
    const m = StandardMaterial.fromHex('#f80');
    expect(m.baseColor.r).toBeCloseTo(1.0, 2);
    expect(m.baseColor.g).toBeCloseTo(0x88 / 255, 2);
    expect(m.baseColor.b).toBeCloseTo(0, 2);
  });

  it('parses hex without #', () => {
    const m = StandardMaterial.fromHex('ff8800');
    expect(m.baseColor.r).toBeCloseTo(1.0, 2);
  });
});

describe('StandardMaterial: shader source', () => {
  it('STANDARD_FRAGMENT_SRC equals PBR_FRAG', () => {
    expect(STANDARD_FRAGMENT_SRC).toBe(PBR_FRAG);
  });

  it('STANDARD_VERTEX_SRC equals PBR_VERT', () => {
    expect(STANDARD_VERTEX_SRC).toBe(PBR_VERT);
  });

  it('PBR_FRAG contains baseColorMap uniforms', () => {
    expect(PBR_FRAG).toContain('u_baseColorMap');
    expect(PBR_FRAG).toContain('u_baseColorMapEnabled');
  });

  it('PBR_FRAG contains metallicRoughnessMap uniforms', () => {
    expect(PBR_FRAG).toContain('u_metallicRoughnessMap');
    expect(PBR_FRAG).toContain('u_metallicRoughnessMapEnabled');
  });

  it('PBR_FRAG contains normalMap uniforms', () => {
    expect(PBR_FRAG).toContain('u_normalMap');
    expect(PBR_FRAG).toContain('u_normalMapEnabled');
    expect(PBR_FRAG).toContain('u_normalScale');
  });

  it('PBR_FRAG contains emissiveMap uniforms', () => {
    expect(PBR_FRAG).toContain('u_emissiveMap');
    expect(PBR_FRAG).toContain('u_emissiveMapEnabled');
  });

  it('PBR_FRAG contains derivative-based TBN logic', () => {
    // Christian Schüler "Normal Mapping Without Precomputed Tangents"
    expect(PBR_FRAG).toContain('dFdx(v_worldPos)');
    expect(PBR_FRAG).toContain('dFdy(v_worldPos)');
    expect(PBR_FRAG).toContain('dFdx(v_uv)');
    expect(PBR_FRAG).toContain('dFdy(v_uv)');
    expect(PBR_FRAG).toContain('mat3 TBN');
    expect(PBR_FRAG).toContain('TBN * sampled');
  });

  it('PBR_FRAG normal map decodes [0,1] → [-1,1]', () => {
    expect(PBR_FRAG).toContain('* 2.0 - 1.0');
  });

  it('PBR_FRAG normal map applies normalScale to xy', () => {
    expect(PBR_FRAG).toContain('sampled.xy *= u_normalScale');
  });

  it('PBR_FRAG emissive map multiplies with u_emissive', () => {
    expect(PBR_FRAG).toContain('emissive *= texture(u_emissiveMap');
  });

  it('PBR_FRAG uses GLTF convention for metallicRoughness (G=roughness, B=metallic)', () => {
    expect(PBR_FRAG).toContain('metallic *= mr.b');
    expect(PBR_FRAG).toContain('roughness *= mr.g');
  });

  it('PBR_VERT passes worldPos, worldNormal, uv', () => {
    expect(PBR_VERT).toContain('v_worldPos');
    expect(PBR_VERT).toContain('v_worldNormal');
    expect(PBR_VERT).toContain('v_uv');
  });

  it('PBR_VERT does NOT require a_tangent attribute', () => {
    // Derivative-based TBN means no tangent attribute is needed
    expect(PBR_VERT).not.toContain('a_tangent');
  });
});

describe('StandardMaterial: program key', () => {
  it('has stable programKey', () => {
    const m = new StandardMaterial();
    expect(m.programKey).toBe('standard');
  });

  it('customProgramCacheKey returns a string', () => {
    const m = new StandardMaterial();
    expect(typeof m.customProgramCacheKey()).toBe('string');
  });
});

describe('StandardMaterial: onBeforeCompile', () => {
  it('is a no-op by default', () => {
    const m = new StandardMaterial();
    expect(() => m.onBeforeCompile({} as never, undefined)).not.toThrow();
  });
});

// ShaderChunks 片段内容单元测试。
//
// 验证每个片段是非空字符串,且包含预期的关键标记(函数名/define/struct)。
// 不做完整 GLSL 语法解析(那需要真实编译器),仅做字符串断言。

import { describe, it, expect } from 'vitest';
import { COMMON_CHUNK } from './common.glsl';
import { LIGHTING_CHUNK } from './lighting.glsl';
import { FOG_CHUNK, FOG_EXP2_CHUNK } from './fog.glsl';
import { NORMAL_PACK_CHUNK } from './normal_packing.glsl';
import { SHADOW_CHUNK } from './shadow.glsl';
import { ENVMAP_CHUNK } from './envmap.glsl';
import { TONEMAP_ACES_CHUNK, TONEMAP_REINHARD_CHUNK } from './tonemapping.glsl';
import { NOISE_CHUNK } from './noise.glsl';
import { UV_TRANSFORM_CHUNK } from './uv_transform.glsl';
import { COLOR_SPACE_CHUNK } from './color_space.glsl';
import {
  BUILTIN_SHADER_CHUNKS,
  registerBuiltinChunks,
  shaderChunkRegistry,
} from './index';

// 辅助:断言片段是非空字符串。
function expectNonEmptyString(s: unknown, label: string): void {
  expect(typeof s, `${label} should be string`).toBe('string');
  expect((s as string).length, `${label} should be non-empty`).toBeGreaterThan(0);
  expect((s as string).trim().length, `${label} should have non-whitespace content`).toBeGreaterThan(0);
}

describe('ShaderChunks — 内容完整性', () => {
  describe('common.glsl', () => {
    it('COMMON_CHUNK is non-empty string', () => {
      expectNonEmptyString(COMMON_CHUNK, 'COMMON_CHUNK');
    });

    it('defines PI constants', () => {
      expect(COMMON_CHUNK).toContain('#define PI');
      expect(COMMON_CHUNK).toContain('#define PI2');
      expect(COMMON_CHUNK).toContain('#define RECIPROCAL_PI');
      expect(COMMON_CHUNK).toContain('#define EPSILON');
    });

    it('defines saturate macro', () => {
      expect(COMMON_CHUNK).toContain('#define saturate');
    });

    it('provides pow2/pow3/pow4/max3/average utility functions', () => {
      expect(COMMON_CHUNK).toContain('pow2');
      expect(COMMON_CHUNK).toContain('pow3');
      expect(COMMON_CHUNK).toContain('pow4');
      expect(COMMON_CHUNK).toContain('max3');
      expect(COMMON_CHUNK).toContain('average');
    });

    it('provides rand function', () => {
      expect(COMMON_CHUNK).toMatch(/float\s+rand\s*\(/);
    });

    it('provides transformDirection and IncidentLight struct', () => {
      expect(COMMON_CHUNK).toContain('transformDirection');
      expect(COMMON_CHUNK).toContain('struct IncidentLight');
      expect(COMMON_CHUNK).toContain('struct ReflectedLight');
    });
  });

  describe('lighting.glsl', () => {
    it('LIGHTING_CHUNK is non-empty string', () => {
      expectNonEmptyString(LIGHTING_CHUNK, 'LIGHTING_CHUNK');
    });

    it('provides BRDF_Lambert and BRDF_Burley', () => {
      expect(LIGHTING_CHUNK).toContain('BRDF_Lambert');
      expect(LIGHTING_CHUNK).toContain('BRDF_Burley');
    });

    it('provides GGX distribution D_GGX', () => {
      expect(LIGHTING_CHUNK).toMatch(/float\s+D_GGX\s*\(/);
    });

    it('provides Smith geometry V_SmithGGXCorrelated', () => {
      expect(LIGHTING_CHUNK).toContain('V_SmithGGXCorrelated');
    });

    it('provides Schlick Fresnel', () => {
      expect(LIGHTING_CHUNK).toContain('F_Schlick');
      expect(LIGHTING_CHUNK).toContain('F_Schlick_Rough');
    });

    it('provides evaluateDirectLight helper', () => {
      expect(LIGHTING_CHUNK).toContain('evaluateDirectLight');
    });
  });

  describe('fog.glsl', () => {
    it('FOG_CHUNK is non-empty string', () => {
      expectNonEmptyString(FOG_CHUNK, 'FOG_CHUNK');
    });

    it('declares fog uniforms', () => {
      expect(FOG_CHUNK).toContain('u_fogColor');
      expect(FOG_CHUNK).toContain('u_fogNear');
      expect(FOG_CHUNK).toContain('u_fogFar');
    });

    it('provides applyLinearFog function', () => {
      expect(FOG_CHUNK).toContain('applyLinearFog');
      expect(FOG_CHUNK).toContain('computeLinearFogFactor');
    });

    it('FOG_EXP2_CHUNK is non-empty string', () => {
      expectNonEmptyString(FOG_EXP2_CHUNK, 'FOG_EXP2_CHUNK');
    });

    it('FOG_EXP2_CHUNK declares density uniform', () => {
      expect(FOG_EXP2_CHUNK).toContain('u_fogDensity');
    });

    it('FOG_EXP2_CHUNK provides applyExp2Fog function', () => {
      expect(FOG_EXP2_CHUNK).toContain('applyExp2Fog');
      expect(FOG_EXP2_CHUNK).toContain('computeExp2FogFactor');
    });

    it('FOG and FOG_EXP2 are distinct chunks', () => {
      expect(FOG_CHUNK).not.toBe(FOG_EXP2_CHUNK);
    });
  });

  describe('normal_packing.glsl', () => {
    it('NORMAL_PACK_CHUNK is non-empty string', () => {
      expectNonEmptyString(NORMAL_PACK_CHUNK, 'NORMAL_PACK_CHUNK');
    });

    it('provides packNormalToRGB / unpackRGBToNormal', () => {
      expect(NORMAL_PACK_CHUNK).toContain('packNormalToRGB');
      expect(NORMAL_PACK_CHUNK).toContain('unpackRGBToNormal');
    });

    it('provides packDepthToRGBA / unpackRGBAToDepth', () => {
      expect(NORMAL_PACK_CHUNK).toContain('packDepthToRGBA');
      expect(NORMAL_PACK_CHUNK).toContain('unpackRGBAToDepth');
    });

    it('provides viewZ <-> depth helpers', () => {
      expect(NORMAL_PACK_CHUNK).toContain('viewZToOrthographicDepth');
      expect(NORMAL_PACK_CHUNK).toContain('orthographicDepthToViewZ');
      expect(NORMAL_PACK_CHUNK).toContain('viewZToPerspectiveDepth');
      expect(NORMAL_PACK_CHUNK).toContain('perspectiveDepthToViewZ');
    });
  });

  describe('shadow.glsl', () => {
    it('SHADOW_CHUNK is non-empty string', () => {
      expectNonEmptyString(SHADOW_CHUNK, 'SHADOW_CHUNK');
    });

    it('provides sampleShadowPCF function', () => {
      expect(SHADOW_CHUNK).toContain('sampleShadowPCF');
    });

    it('provides sampleShadowHard function', () => {
      expect(SHADOW_CHUNK).toContain('sampleShadowHard');
    });

    it('provides sampleShadowPCSS function', () => {
      expect(SHADOW_CHUNK).toContain('sampleShadowPCSS');
    });

    it('references required uniforms', () => {
      expect(SHADOW_CHUNK).toContain('u_shadowMap');
      expect(SHADOW_CHUNK).toContain('u_lightVP');
      expect(SHADOW_CHUNK).toContain('u_shadowBias');
      expect(SHADOW_CHUNK).toContain('u_shadowMapSize');
      expect(SHADOW_CHUNK).toContain('u_shadowEnabled');
    });

    it('PCSS references u_lightSize uniform', () => {
      expect(SHADOW_CHUNK).toContain('u_lightSize');
    });

    it('PCSS has 16-sample Poisson disk', () => {
      expect(SHADOW_CHUNK).toContain('POISSON_DISK[16]');
      expect(SHADOW_CHUNK).toContain('vec2[16]');
    });

    it('PCSS implements 3-stage algorithm (blocker search + penumbra + PCF)', () => {
      expect(SHADOW_CHUNK).toContain('Stage 1: Blocker Search');
      expect(SHADOW_CHUNK).toContain('Stage 2: Penumbra Estimation');
      expect(SHADOW_CHUNK).toContain('Stage 3: PCF Filter');
    });

    it('PCSS computes average blocker depth', () => {
      expect(SHADOW_CHUNK).toContain('blockerSum');
      expect(SHADOW_CHUNK).toContain('blockerCount');
      expect(SHADOW_CHUNK).toContain('avgBlockerDepth');
    });

    it('PCSS estimates penumbra width from blocker-receiver distance', () => {
      expect(SHADOW_CHUNK).toContain('penumbra');
      expect(SHADOW_CHUNK).toContain('receiverDepth - avgBlockerDepth');
    });

    it('PCSS clamps penumbra to max radius', () => {
      expect(SHADOW_CHUNK).toContain('clamp(penumbra');
      expect(SHADOW_CHUNK).toContain('maxRadius');
    });

    it('PCSS early-outs when no blockers found', () => {
      expect(SHADOW_CHUNK).toContain('blockerCount < 0.5');
      expect(SHADOW_CHUNK).toContain('return 1.0');
    });
  });

  describe('envmap.glsl', () => {
    it('ENVMAP_CHUNK is non-empty string', () => {
      expectNonEmptyString(ENVMAP_CHUNK, 'ENVMAP_CHUNK');
    });

    it('provides getIBLRadiance and getIBLIrradiance', () => {
      expect(ENVMAP_CHUNK).toContain('getIBLRadiance');
      expect(ENVMAP_CHUNK).toContain('getIBLIrradiance');
    });

    it('provides getIBLContribution helper', () => {
      expect(ENVMAP_CHUNK).toContain('getIBLContribution');
    });

    it('references env map uniforms', () => {
      expect(ENVMAP_CHUNK).toContain('u_envMap');
      expect(ENVMAP_CHUNK).toContain('u_envMapEnabled');
    });

    it('uses textureLod for mip sampling', () => {
      expect(ENVMAP_CHUNK).toContain('textureLod');
    });
  });

  describe('tonemapping.glsl', () => {
    it('TONEMAP_ACES_CHUNK is non-empty string', () => {
      expectNonEmptyString(TONEMAP_ACES_CHUNK, 'TONEMAP_ACES_CHUNK');
    });

    it('TONEMAP_ACES_CHUNK provides acesFilmic function', () => {
      expect(TONEMAP_ACES_CHUNK).toContain('acesFilmic');
      expect(TONEMAP_ACES_CHUNK).toContain('toneMapACES');
    });

    it('TONEMAP_ACES_CHUNK has Narkowicz constants', () => {
      expect(TONEMAP_ACES_CHUNK).toContain('2.51');
      expect(TONEMAP_ACES_CHUNK).toContain('0.03');
    });

    it('TONEMAP_REINHARD_CHUNK is non-empty string', () => {
      expectNonEmptyString(TONEMAP_REINHARD_CHUNK, 'TONEMAP_REINHARD_CHUNK');
    });

    it('TONEMAP_REINHARD_CHUNK provides reinhard function', () => {
      expect(TONEMAP_REINHARD_CHUNK).toContain('reinhard');
      expect(TONEMAP_REINHARD_CHUNK).toContain('toneMapReinhard');
    });

    it('TONEMAP_ACES and TONEMAP_REINHARD are distinct', () => {
      expect(TONEMAP_ACES_CHUNK).not.toBe(TONEMAP_REINHARD_CHUNK);
    });
  });

  describe('noise.glsl', () => {
    it('NOISE_CHUNK is non-empty string', () => {
      expectNonEmptyString(NOISE_CHUNK, 'NOISE_CHUNK');
    });

    it('provides hash functions', () => {
      expect(NOISE_CHUNK).toContain('hash11');
      expect(NOISE_CHUNK).toContain('hash21');
      expect(NOISE_CHUNK).toContain('hash31');
      expect(NOISE_CHUNK).toContain('hash32');
    });

    it('provides valueNoise3', () => {
      expect(NOISE_CHUNK).toContain('valueNoise3');
    });

    it('provides simplex3 (Ashima)', () => {
      expect(NOISE_CHUNK).toContain('simplex3');
      expect(NOISE_CHUNK).toContain('permute');
      expect(NOISE_CHUNK).toContain('taylorInvSqrt');
    });

    it('provides cellular3 (Worley)', () => {
      expect(NOISE_CHUNK).toContain('cellular3');
    });

    it('provides fbm (fractal Brownian motion)', () => {
      expect(NOISE_CHUNK).toContain('fbm');
    });
  });

  describe('uv_transform.glsl', () => {
    it('UV_TRANSFORM_CHUNK is non-empty string', () => {
      expectNonEmptyString(UV_TRANSFORM_CHUNK, 'UV_TRANSFORM_CHUNK');
    });

    it('provides transformUv function', () => {
      expect(UV_TRANSFORM_CHUNK).toContain('transformUv');
    });

    it('provides planarUv and triplanarUv', () => {
      expect(UV_TRANSFORM_CHUNK).toContain('planarUv');
      expect(UV_TRANSFORM_CHUNK).toContain('triplanarUv');
    });

    it('provides triplanarWeights', () => {
      expect(UV_TRANSFORM_CHUNK).toContain('triplanarWeights');
    });
  });

  describe('color_space.glsl', () => {
    it('COLOR_SPACE_CHUNK is non-empty string', () => {
      expectNonEmptyString(COLOR_SPACE_CHUNK, 'COLOR_SPACE_CHUNK');
    });

    it('provides sRGBToLinear / linearToSRGB', () => {
      expect(COLOR_SPACE_CHUNK).toContain('sRGBToLinear');
      expect(COLOR_SPACE_CHUNK).toContain('linearToSRGB');
    });

    it('provides channel-level conversion', () => {
      expect(COLOR_SPACE_CHUNK).toContain('sRGBToLinearChannel');
      expect(COLOR_SPACE_CHUNK).toContain('linearToSRGBChannel');
    });

    it('provides fast pow-2.2 variants', () => {
      expect(COLOR_SPACE_CHUNK).toContain('sRGBToLinearFast');
      expect(COLOR_SPACE_CHUNK).toContain('linearToSRGBFast');
    });

    it('provides luminance functions', () => {
      expect(COLOR_SPACE_CHUNK).toContain('luminance');
      expect(COLOR_SPACE_CHUNK).toContain('luminance601');
    });
  });
});

describe('ShaderChunks — barrel 导出', () => {
  it('BUILTIN_SHADER_CHUNKS contains all 12 chunks', () => {
    const expectedKeys = [
      'COMMON',
      'LIGHTING',
      'FOG',
      'FOG_EXP2',
      'NORMAL_PACK',
      'SHADOW',
      'ENVMAP',
      'TONEMAP_ACES',
      'TONEMAP_REINHARD',
      'NOISE',
      'UV_TRANSFORM',
      'COLOR_SPACE',
    ];
    expect(Object.keys(BUILTIN_SHADER_CHUNKS).sort()).toEqual(expectedKeys.sort());
  });

  it('all built-in chunks are non-empty strings', () => {
    for (const [name, glsl] of Object.entries(BUILTIN_SHADER_CHUNKS)) {
      expectNonEmptyString(glsl, `BUILTIN_SHADER_CHUNKS.${name}`);
    }
  });

  it('FOG and FOG_EXP2 keys map to their respective chunks', () => {
    expect(BUILTIN_SHADER_CHUNKS.FOG).toBe(FOG_CHUNK);
    expect(BUILTIN_SHADER_CHUNKS.FOG_EXP2).toBe(FOG_EXP2_CHUNK);
  });

  it('TONEMAP_ACES and TONEMAP_REINHARD keys map to their respective chunks', () => {
    expect(BUILTIN_SHADER_CHUNKS.TONEMAP_ACES).toBe(TONEMAP_ACES_CHUNK);
    expect(BUILTIN_SHADER_CHUNKS.TONEMAP_REINHARD).toBe(TONEMAP_REINHARD_CHUNK);
  });
});

describe('ShaderChunks — registerBuiltinChunks 集成', () => {
  it('registerBuiltinChunks populates the default registry', () => {
    // 使用一个临时 registry 避免污染全局单例
    const local = new (shaderChunkRegistry.constructor as new () => typeof shaderChunkRegistry)();
    registerBuiltinChunks(local);
    expect(local.size()).toBe(12);
    expect(local.has('COMMON')).toBe(true);
    expect(local.has('SHADOW')).toBe(true);
  });

  it('registerBuiltinChunks is idempotent (does not overwrite if already present)', () => {
    const local = new (shaderChunkRegistry.constructor as new () => typeof shaderChunkRegistry)();
    local.register('COMMON', 'placeholder');
    registerBuiltinChunks(local);
    // 已存在 -> 不覆盖
    expect(local.get('COMMON')).toBe('placeholder');
  });

  it('registerBuiltinChunks default target is the singleton', () => {
    // 仅验证默认参数解析不抛错
    expect(() => registerBuiltinChunks()).not.toThrow();
  });

  it('built-in chunks can be resolved via #include <name>', () => {
    const local = new (shaderChunkRegistry.constructor as new () => typeof shaderChunkRegistry)();
    registerBuiltinChunks(local);
    const src = `#include <COMMON>
void main() {}`;
    const resolved = local.resolve(src);
    expect(resolved).toContain('#define PI');
    expect(resolved).not.toContain('#include <COMMON>');
  });
});

import { describe, it, expect } from 'vitest';
import {
  // 类型
  type MaterialLayer,
  // 常量
  MAX_LAYERS,
  // 工厂
  createDefaultBaseLayer,
  // 工具函数
  lerp, lerpRGB, addRGB, multiplyRGB, scaleRGB, overlayRGB,
  normalizeNormalRGB, sampleMaskBilinear,
  // 类
  LayeredPBRMaterial,
  // GLSL
  LAYERED_PBR_GLSL, LAYERED_PBR_VERTEX_GLSL, LAYERED_PBR_FRAGMENT_GLSL,
} from './LayeredPBRMaterial';

// ── 测试辅助 ─────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function rgbApproxEq(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, eps = 1e-4): boolean {
  return approxEq(a.r, b.r, eps) && approxEq(a.g, b.g, eps) && approxEq(a.b, b.b, eps);
}

/** 创建一个测试层。 */
function makeLayer(overrides: Partial<MaterialLayer> = {}): MaterialLayer {
  return {
    ...createDefaultBaseLayer('test'),
    ...overrides,
  };
}

/** 创建一个 N×N 全 1 遮罩。 */
function makeFullMask(size: number, value = 1): Float32Array {
  const m = new Float32Array(size * size);
  m.fill(value);
  return m;
}

// ── 常量与工厂 ───────────────────────────────────────────────────

describe('constants and factories', () => {
  it('MAX_LAYERS = 8', () => {
    expect(MAX_LAYERS).toBe(8);
  });

  it('createDefaultBaseLayer returns valid layer with defaults', () => {
    const layer = createDefaultBaseLayer();
    expect(layer.name).toBe('base');
    expect(layer.enabled).toBe(true);
    expect(layer.metallic).toBe(0);
    expect(layer.roughness).toBe(0.5);
    expect(layer.ao).toBe(1.0);
    expect(layer.opacity).toBe(1.0);
    expect(layer.blendMode).toBe('normal');
    expect(layer.mask).toBe(null);
  });

  it('createDefaultBaseLayer accepts custom name', () => {
    expect(createDefaultBaseLayer('metal').name).toBe('metal');
  });
});

// ── 工具函数 ─────────────────────────────────────────────────────

describe('utility functions', () => {
  it('lerp interpolates correctly', () => {
    expect(approxEq(lerp(0, 10, 0.5), 5)).toBe(true);
    expect(approxEq(lerp(2, 4, 0), 2)).toBe(true);
    expect(approxEq(lerp(2, 4, 1), 4)).toBe(true);
  });

  it('lerpRGB interpolates each channel', () => {
    const r = lerpRGB({ r: 0, g: 0, b: 0 }, { r: 1, g: 0.5, b: 0.2 }, 0.5);
    expect(approxEq(r.r, 0.5)).toBe(true);
    expect(approxEq(r.g, 0.25)).toBe(true);
    expect(approxEq(r.b, 0.1)).toBe(true);
  });

  it('addRGB adds channels', () => {
    const r = addRGB({ r: 0.1, g: 0.2, b: 0.3 }, { r: 0.4, g: 0.5, b: 0.6 });
    expect(rgbApproxEq(r, { r: 0.5, g: 0.7, b: 0.9 })).toBe(true);
  });

  it('multiplyRGB multiplies channels', () => {
    const r = multiplyRGB({ r: 0.5, g: 0.5, b: 0.5 }, { r: 0.4, g: 0.6, b: 0.8 });
    expect(rgbApproxEq(r, { r: 0.2, g: 0.3, b: 0.4 })).toBe(true);
  });

  it('scaleRGB scales channels', () => {
    const r = scaleRGB({ r: 1, g: 0.5, b: 0.2 }, 2);
    expect(rgbApproxEq(r, { r: 2, g: 1, b: 0.4 })).toBe(true);
  });

  it('overlayRGB blends correctly for dark base', () => {
    // base < 0.5 → result = 2 * base * layer
    const r = overlayRGB({ r: 0.25, g: 0.25, b: 0.25 }, { r: 0.5, g: 0.5, b: 0.5 }, 1);
    expect(approxEq(r.r, 0.25, 1e-3)).toBe(true); // 2 * 0.25 * 0.5 = 0.25
  });

  it('overlayRGB blends correctly for light base', () => {
    // base >= 0.5 → result = 1 - 2 * (1 - base) * (1 - layer)
    const r = overlayRGB({ r: 0.75, g: 0.75, b: 0.75 }, { r: 0.5, g: 0.5, b: 0.5 }, 1);
    expect(approxEq(r.r, 0.75, 1e-3)).toBe(true); // 1 - 2 * 0.25 * 0.5 = 0.75
  });

  it('normalizeNormalRGB normalizes non-unit vector', () => {
    const n = normalizeNormalRGB({ r: 1.0, g: 1.0, b: 1.0 }); // (1,1,1)/sqrt(3)
    const x = n.r * 2 - 1;
    const y = n.g * 2 - 1;
    const z = n.b * 2 - 1;
    const len = Math.sqrt(x * x + y * y + z * z);
    expect(approxEq(len, 1.0, 1e-3)).toBe(true);
  });

  it('normalizeNormalRGB returns default for zero vector', () => {
    const n = normalizeNormalRGB({ r: 0.5, g: 0.5, b: 0.5 }); // (0,0,0)
    expect(approxEq(n.b, 1.0)).toBe(true); // 朝 +Z
  });

  it('sampleMaskBilinear returns 1 for null mask', () => {
    expect(sampleMaskBilinear(null, 0, 0, 0.5, 0.5)).toBe(1.0);
  });

  it('sampleMaskBilinear samples mask value', () => {
    const mask = new Float32Array([0.0, 1.0, 1.0, 0.0]);
    // 2x2 mask,采样中心 (0.5, 0.5) → 双线性 = 0.5
    const v = sampleMaskBilinear(mask, 2, 2, 0.5, 0.5);
    expect(approxEq(v, 0.5, 1e-3)).toBe(true);
  });

  it('sampleMaskBilinear wraps UVs', () => {
    const mask = new Float32Array([1.0, 0.0, 0.0, 0.0]);
    // UV (1.0, 1.0) 应 wrap 到 (0.0, 0.0) 附近,与 UV (0.0, 0.0) 采样结果一致
    const vWrap = sampleMaskBilinear(mask, 2, 2, 1.0, 1.0);
    const vNoWrap = sampleMaskBilinear(mask, 2, 2, 0.0, 0.0);
    expect(approxEq(vWrap, vNoWrap, 1e-4)).toBe(true);
    // wrap 后应采样到 mask[0]=1 的影响,值 > 0
    expect(vWrap).toBeGreaterThan(0);
  });
});

// ── LayeredPBRMaterial 类 ────────────────────────────────────────

describe('LayeredPBRMaterial class', () => {
  it('constructor creates with default base layer', () => {
    const mat = new LayeredPBRMaterial();
    expect(mat.getLayerCount()).toBe(1);
    expect(mat.getLayer(0)?.name).toBe('base');
  });

  it('constructor accepts custom base layer', () => {
    const base = createDefaultBaseLayer('metal');
    base.metallic = 1.0;
    const mat = new LayeredPBRMaterial(base);
    expect(mat.getLayer(0)?.metallic).toBe(1.0);
  });

  it('addLayer appends and returns index', () => {
    const mat = new LayeredPBRMaterial();
    const idx = mat.addLayer(makeLayer({ name: 'paint' }));
    expect(idx).toBe(1);
    expect(mat.getLayerCount()).toBe(2);
  });

  it('addLayer returns -1 when at MAX_LAYERS', () => {
    const mat = new LayeredPBRMaterial();
    for (let i = 1; i < MAX_LAYERS; i++) {
      mat.addLayer(makeLayer({ name: `layer${i}` }));
    }
    expect(mat.getLayerCount()).toBe(MAX_LAYERS);
    expect(mat.addLayer(makeLayer({ name: 'overflow' }))).toBe(-1);
  });

  it('removeLayer removes non-base layer', () => {
    const mat = new LayeredPBRMaterial();
    mat.addLayer(makeLayer({ name: 'paint' }));
    mat.addLayer(makeLayer({ name: 'dirt' }));
    expect(mat.removeLayer(1)).toBe(true);
    expect(mat.getLayerCount()).toBe(2);
    expect(mat.getLayer(1)?.name).toBe('dirt');
  });

  it('removeLayer fails for base layer (index 0)', () => {
    const mat = new LayeredPBRMaterial();
    expect(mat.removeLayer(0)).toBe(false);
  });

  it('removeLayer fails for out-of-bounds index', () => {
    const mat = new LayeredPBRMaterial();
    expect(mat.removeLayer(-1)).toBe(false);
    expect(mat.removeLayer(100)).toBe(false);
  });

  it('getLayer returns null for invalid index', () => {
    const mat = new LayeredPBRMaterial();
    expect(mat.getLayer(-1)).toBe(null);
    expect(mat.getLayer(100)).toBe(null);
  });

  it('setLayer updates layer', () => {
    const mat = new LayeredPBRMaterial();
    const newBase = makeLayer({ name: 'newbase', metallic: 0.8 });
    expect(mat.setLayer(0, newBase)).toBe(true);
    expect(mat.getLayer(0)?.metallic).toBe(0.8);
  });

  it('swapLayers swaps two non-base layers', () => {
    const mat = new LayeredPBRMaterial();
    mat.addLayer(makeLayer({ name: 'paint', metallic: 0.5 }));
    mat.addLayer(makeLayer({ name: 'dirt', metallic: 0.2 }));
    expect(mat.swapLayers(1, 2)).toBe(true);
    expect(mat.getLayer(1)?.name).toBe('dirt');
    expect(mat.getLayer(2)?.name).toBe('paint');
  });

  it('swapLayers fails for base layer', () => {
    const mat = new LayeredPBRMaterial();
    mat.addLayer(makeLayer({ name: 'paint' }));
    expect(mat.swapLayers(0, 1)).toBe(false);
  });
});

// ── evaluate - 基础测试 ──────────────────────────────────────────

describe('evaluate - base layer', () => {
  it('returns base layer properties when only one layer', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({
        baseColor: { r: 0.8, g: 0.2, b: 0.1 },
        metallic: 0.9,
        roughness: 0.3,
      }),
    );
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(rgbApproxEq(result.baseColor, { r: 0.8, g: 0.2, b: 0.1 })).toBe(true);
    expect(approxEq(result.metallic, 0.9)).toBe(true);
    expect(approxEq(result.roughness, 0.3)).toBe(true);
    expect(result.layerWeights[0]).toBe(1.0);
  });

  it('returns base emissive scaled by intensity', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({
        emissive: { r: 0.5, g: 0.3, b: 0.1 },
        emissiveIntensity: 2.0,
      }),
    );
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(approxEq(result.emissive.r, 1.0)).toBe(true); // 0.5 * 2.0
    expect(approxEq(result.emissive.g, 0.6)).toBe(true);
    expect(approxEq(result.emissive.b, 0.2)).toBe(true);
  });
});

// ── evaluate - 层混合 ───────────────────────────────────────────

describe('evaluate - layer blending', () => {
  it('normal blend: layer with full mask overrides base', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0.1, g: 0.1, b: 0.1 }, metallic: 0 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 0.9, g: 0.9, b: 0.9 },
      metallic: 1.0,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
      opacity: 1.0,
      maskStrength: 1.0,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(rgbApproxEq(result.baseColor, { r: 0.9, g: 0.9, b: 0.9 })).toBe(true);
    expect(approxEq(result.metallic, 1.0)).toBe(true);
  });

  it('normal blend: layer with zero mask has no effect', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0.1, g: 0.1, b: 0.1 }, metallic: 0 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 0.9, g: 0.9, b: 0.9 },
      metallic: 1.0,
      mask: makeFullMask(4, 0.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(rgbApproxEq(result.baseColor, { r: 0.1, g: 0.1, b: 0.1 })).toBe(true);
    expect(approxEq(result.metallic, 0)).toBe(true);
  });

  it('normal blend: half mask produces half blend', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1.0,
      mask: makeFullMask(4, 0.5),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(approxEq(result.baseColor.r, 0.5)).toBe(true);
    expect(approxEq(result.metallic, 0.5)).toBe(true);
  });

  it('normal blend: opacity controls blend weight', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1.0,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
      opacity: 0.3,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(approxEq(result.metallic, 0.3)).toBe(true);
  });

  it('add blend: layer adds to base', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0.2, g: 0.2, b: 0.2 }, metallic: 0.1 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 0.5, g: 0.5, b: 0.5 },
      metallic: 0.3,
      blendMode: 'add',
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    // add: 0.2 + 0.5 * 1 = 0.7
    expect(approxEq(result.baseColor.r, 0.7)).toBe(true);
    expect(approxEq(result.metallic, 0.4, 1e-3)).toBe(true); // 0.1 + 0.3 = 0.4
  });

  it('multiply blend: layer multiplies base', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0.5, g: 0.5, b: 0.5 }, metallic: 0.5 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 0.4, g: 0.6, b: 0.8 },
      metallic: 0.8,
      blendMode: 'multiply',
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    // multiply: 0.5 * (0 + 0.4 * 1) = 0.2
    expect(approxEq(result.baseColor.r, 0.2)).toBe(true);
    expect(approxEq(result.metallic, 0.4)).toBe(true); // 0.5 * (0 + 0.8) = 0.4
  });

  it('overlay blend: combines layers with overlay formula', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0.25, g: 0.25, b: 0.25 } }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 0.5, g: 0.5, b: 0.5 },
      blendMode: 'overlay',
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    // overlay: 2 * 0.25 * 0.5 = 0.25
    expect(approxEq(result.baseColor.r, 0.25, 1e-3)).toBe(true);
  });

  it('disabled layer is skipped', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1,
      enabled: false,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(rgbApproxEq(result.baseColor, { r: 0, g: 0, b: 0 })).toBe(true);
    expect(result.layerWeights[1]).toBe(0);
  });

  it('emissive is additive across layers', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({
        emissive: { r: 0.5, g: 0, b: 0 },
        emissiveIntensity: 1,
      }),
    );
    mat.addLayer(makeLayer({
      emissive: { r: 0, g: 0.5, b: 0 },
      emissiveIntensity: 1,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(approxEq(result.emissive.r, 0.5)).toBe(true);
    expect(approxEq(result.emissive.g, 0.5)).toBe(true);
  });
});

// ── evaluate - 法线混合 ─────────────────────────────────────────

describe('evaluate - normal blending', () => {
  it('layer without normal preserves base normal', () => {
    const baseNormal = { r: 0.5, g: 0.5, b: 1.0 };
    const mat = new LayeredPBRMaterial(
      makeLayer({ normal: baseNormal }),
    );
    mat.addLayer(makeLayer({
      normal: null,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(rgbApproxEq(result.normal, baseNormal)).toBe(true);
  });

  it('layer with normal blends with base', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ normal: { r: 0.5, g: 0.5, b: 1.0 } }),
    );
    mat.addLayer(makeLayer({
      normal: { r: 1.0, g: 0.5, b: 0.5 },
      normalBlend: 1.0,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    // 完全覆盖,应等于 layer normal(归一化后)
    expect(approxEq(result.normal.r, 1.0, 1e-3)).toBe(true);
  });

  it('normalBlend 0 keeps base normal', () => {
    const baseNormal = { r: 0.5, g: 0.5, b: 1.0 };
    const mat = new LayeredPBRMaterial(
      makeLayer({ normal: baseNormal }),
    );
    mat.addLayer(makeLayer({
      normal: { r: 1.0, g: 0.5, b: 0.5 },
      normalBlend: 0.0,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(rgbApproxEq(result.normal, baseNormal, 1e-3)).toBe(true);
  });

  it('blended normal is normalized', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ normal: { r: 0.5, g: 0.5, b: 1.0 } }),
    );
    mat.addLayer(makeLayer({
      normal: { r: 0.8, g: 0.7, b: 0.6 },
      normalBlend: 1.0,
      mask: makeFullMask(4, 0.5),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    // 验证归一化:0..1 → -1..1 → len == 1
    const x = result.normal.r * 2 - 1;
    const y = result.normal.g * 2 - 1;
    const z = result.normal.b * 2 - 1;
    const len = Math.sqrt(x * x + y * y + z * z);
    expect(approxEq(len, 1.0, 1e-3)).toBe(true);
  });
});

// ── evaluate - 顶点颜色遮罩 ─────────────────────────────────────

describe('evaluate - vertex color mask', () => {
  it('vertex color modulates mask when strength > 0', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat.vertexColorMaskStrength = 1.0; // 完全使用顶点色
    mat.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1.0,
      mask: makeFullMask(4, 1.0), // 遮罩全 1
      maskWidth: 4,
      maskHeight: 4,
    }));
    // 顶点色 alpha = 0.5 → 最终权重 0.5
    const result = mat.evaluate({ u: 0.5, v: 0.5 }, { r: 1, g: 1, b: 1, a: 0.5 });
    expect(approxEq(result.metallic, 0.5)).toBe(true);
  });

  it('vertex color ignored when strength = 0', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat.vertexColorMaskStrength = 0.0;
    mat.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1.0,
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 }, { r: 1, g: 1, b: 1, a: 0.0 });
    expect(approxEq(result.metallic, 1.0)).toBe(true);
  });
});

// ── evaluate - UV 变换 ──────────────────────────────────────────

describe('evaluate - UV transform', () => {
  it('maskUVScale scales mask coordinates', () => {
    // 创建一个 4x4 mask,只有 (0,0) cell 为 1,其余 0
    const mask = new Float32Array(16);
    mask[0] = 1.0;
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1.0,
      mask,
      maskWidth: 4,
      maskHeight: 4,
      maskUVScale: { u: 2, v: 2 }, // UV × 2
    }));
    // UV (0.1, 0.1) → maskUV (0.2, 0.2) → 仍在 mask[0] 附近
    const r1 = mat.evaluate({ u: 0.1, v: 0.1 });
    // UV (0.5, 0.5) → maskUV (1.0, 1.0) → 远离 mask[0]
    const r2 = mat.evaluate({ u: 0.5, v: 0.5 });
    expect(r1.metallic).toBeGreaterThan(r2.metallic);
  });

  it('maskUVOffset offsets mask coordinates', () => {
    // mask[13] = 1.0 (x=1, y=3 在 4x4),配合 offset (0.5, 0) 让 UV (0,0) 命中
    const mask = new Float32Array(16);
    mask[13] = 1.0; // (x=1, y=3)
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1.0,
      mask,
      maskWidth: 4,
      maskHeight: 4,
      maskUVOffset: { u: 0.5, v: 0.0 },
    }));
    // UV (0,0) + offset (0.5, 0) = maskUV (0.5, 0)
    // fx = 0.5*4 - 0.5 = 1.5, fy = -0.5 → 采样 (1, -1) wrap 到 (1, 3) = mask[13] = 1
    const result = mat.evaluate({ u: 0.0, v: 0.0 });
    expect(result.layerWeights[1]).toBeGreaterThan(0);
    // 对比:无 offset 时,UV (0,0) 不应命中 mask[13]
    const mat2 = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 }, metallic: 0 }),
    );
    mat2.addLayer(makeLayer({
      baseColor: { r: 1, g: 1, b: 1 },
      metallic: 1.0,
      mask,
      maskWidth: 4,
      maskHeight: 4,
      maskUVOffset: { u: 0.0, v: 0.0 },
    }));
    const result2 = mat2.evaluate({ u: 0.0, v: 0.0 });
    expect(result.layerWeights[1]).toBeGreaterThan(result2.layerWeights[1]);
  });
});

// ── 多层混合 ────────────────────────────────────────────────────

describe('evaluate - multi-layer', () => {
  it('three layers blend in order', () => {
    const mat = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0.1, g: 0.1, b: 0.1 }, name: 'metal' }),
    );
    mat.addLayer(makeLayer({
      baseColor: { r: 0.9, g: 0.1, b: 0.1 },
      name: 'paint',
      mask: makeFullMask(4, 1.0),
      maskWidth: 4,
      maskHeight: 4,
    }));
    mat.addLayer(makeLayer({
      baseColor: { r: 0.1, g: 0.9, b: 0.1 },
      name: 'moss',
      mask: makeFullMask(4, 0.5),
      maskWidth: 4,
      maskHeight: 4,
    }));
    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    // 顶层(moss)权重 0.5,paint 层被覆盖
    expect(result.layerWeights[1]).toBe(1.0);
    expect(result.layerWeights[2]).toBe(0.5);
    // paint 完全覆盖 metal(base),然后 moss 覆盖 50%
    // paint 后:red = 0.9
    // moss 50%:red = 0.9 * 0.5 + 0.1 * 0.5 = 0.5
    expect(approxEq(result.baseColor.r, 0.5)).toBe(true);
  });

  it('layer order matters', () => {
    // 同样两层,顺序不同,结果不同
    const mat1 = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 } }),
    );
    mat1.addLayer(makeLayer({
      baseColor: { r: 1, g: 0, b: 0 },
      mask: makeFullMask(4, 0.5),
      maskWidth: 4,
      maskHeight: 4,
    }));
    mat1.addLayer(makeLayer({
      baseColor: { r: 0, g: 1, b: 0 },
      mask: makeFullMask(4, 0.5),
      maskWidth: 4,
      maskHeight: 4,
    }));

    const mat2 = new LayeredPBRMaterial(
      makeLayer({ baseColor: { r: 0, g: 0, b: 0 } }),
    );
    mat2.addLayer(makeLayer({
      baseColor: { r: 0, g: 1, b: 0 },
      mask: makeFullMask(4, 0.5),
      maskWidth: 4,
      maskHeight: 4,
    }));
    mat2.addLayer(makeLayer({
      baseColor: { r: 1, g: 0, b: 0 },
      mask: makeFullMask(4, 0.5),
      maskWidth: 4,
      maskHeight: 4,
    }));

    const r1 = mat1.evaluate({ u: 0.5, v: 0.5 });
    const r2 = mat2.evaluate({ u: 0.5, v: 0.5 });
    // mat1 顶层是绿色,mat2 顶层是红色
    expect(r1.baseColor.g).toBeGreaterThan(r1.baseColor.r);
    expect(r2.baseColor.r).toBeGreaterThan(r2.baseColor.g);
  });
});

// ── 遮罩工厂方法 ────────────────────────────────────────────────

describe('mask factory methods', () => {
  it('createFullMask creates uniform mask', () => {
    const m = LayeredPBRMaterial.createFullMask(4, 4, 0.7);
    expect(m.length).toBe(16);
    for (let i = 0; i < m.length; i++) {
      expect(approxEq(m[i], 0.7)).toBe(true);
    }
  });

  it('createRadialMask creates radial gradient', () => {
    const m = LayeredPBRMaterial.createRadialMask(5, 5, 0.5, 0.5, 0.5);
    expect(m.length).toBe(25);
    // 中心值最高
    const center = m[12]; // (2, 2) 在 5x5
    const corner = m[0];  // (0, 0)
    expect(center).toBeGreaterThan(corner);
    expect(approxEq(center, 1.0, 1e-3)).toBe(true);
  });

  it('createNoiseMask creates binary mask with threshold', () => {
    const m = LayeredPBRMaterial.createNoiseMask(16, 16, 42, 0.5);
    expect(m.length).toBe(256);
    // 应只有 0 和 1
    const unique = new Set(Array.from(m));
    expect(unique.has(0)).toBe(true);
    expect(unique.has(1)).toBe(true);
  });

  it('createNoiseMask is deterministic with same seed', () => {
    const m1 = LayeredPBRMaterial.createNoiseMask(8, 8, 123, 0.5);
    const m2 = LayeredPBRMaterial.createNoiseMask(8, 8, 123, 0.5);
    for (let i = 0; i < m1.length; i++) {
      expect(m1[i]).toBe(m2[i]);
    }
  });
});

// ── GLSL chunks ─────────────────────────────────────────────────

describe('GLSL shader chunks', () => {
  it('LAYERED_PBR_GLSL is non-empty and contains key functions', () => {
    expect(LAYERED_PBR_GLSL.length).toBeGreaterThan(0);
    expect(LAYERED_PBR_GLSL).toContain('evaluateLayeredMaterial');
    expect(LAYERED_PBR_GLSL).toContain('MAX_LAYERS');
    expect(LAYERED_PBR_GLSL).toContain('MaterialLayer');
    expect(LAYERED_PBR_GLSL).toContain('overlayBlend');
  });

  it('LAYERED_PBR_VERTEX_GLSL is non-empty and contains vertex setup', () => {
    expect(LAYERED_PBR_VERTEX_GLSL.length).toBeGreaterThan(0);
    expect(LAYERED_PBR_VERTEX_GLSL).toContain('a_position');
    expect(LAYERED_PBR_VERTEX_GLSL).toContain('a_uv');
    expect(LAYERED_PBR_VERTEX_GLSL).toContain('v_vertColor');
  });

  it('LAYERED_PBR_FRAGMENT_GLSL is non-empty and contains PBR logic', () => {
    expect(LAYERED_PBR_FRAGMENT_GLSL.length).toBeGreaterThan(0);
    expect(LAYERED_PBR_FRAGMENT_GLSL).toContain('evaluateLayeredMaterial');
    expect(LAYERED_PBR_FRAGMENT_GLSL).toContain('fragColor');
  });

  it('GLSL contains all 4 blend modes', () => {
    expect(LAYERED_PBR_GLSL).toContain('blendMode == 0'); // normal
    expect(LAYERED_PBR_GLSL).toContain('blendMode == 1'); // add
    expect(LAYERED_PBR_GLSL).toContain('blendMode == 2'); // multiply
    expect(LAYERED_PBR_GLSL).toContain('blendMode == 3'); // overlay
  });
});

// ── 集成测试 ─────────────────────────────────────────────────────

describe('integration: car paint material', () => {
  it('simulates metal + paint + scratch + dirt layers', () => {
    // base: 金属底材
    const mat = new LayeredPBRMaterial(
      makeLayer({
        name: 'metal',
        baseColor: { r: 0.7, g: 0.7, b: 0.75 },
        metallic: 1.0,
        roughness: 0.6,
      }),
    );

    // layer 1: 油漆(完全覆盖)
    mat.addLayer(makeLayer({
      name: 'paint',
      baseColor: { r: 0.8, g: 0.1, b: 0.05 }, // 红色车漆
      metallic: 0.5,
      roughness: 0.3,
      mask: makeFullMask(8, 1.0),
      maskWidth: 8,
      maskHeight: 8,
    }));

    // layer 2: 划痕(噪声遮罩,低 opacity)
    mat.addLayer(makeLayer({
      name: 'scratches',
      baseColor: { r: 0.4, g: 0.4, b: 0.4 },
      metallic: 0.9,
      roughness: 0.8,
      mask: LayeredPBRMaterial.createNoiseMask(8, 8, 42, 0.7),
      maskWidth: 8,
      maskHeight: 8,
      opacity: 0.5,
    }));

    // layer 3: 污渍(局部)
    mat.addLayer(makeLayer({
      name: 'dirt',
      baseColor: { r: 0.2, g: 0.15, b: 0.05 },
      metallic: 0.0,
      roughness: 0.9,
      mask: LayeredPBRMaterial.createRadialMask(8, 8, 0.3, 0.3, 0.3),
      maskWidth: 8,
      maskHeight: 8,
      opacity: 0.7,
    }));

    const result = mat.evaluate({ u: 0.5, v: 0.5 });
    // 最终属性应在 paint 和其他层之间
    expect(result.metallic).toBeGreaterThan(0.4);
    expect(result.roughness).toBeGreaterThan(0.3);
    expect(result.baseColor.r).toBeGreaterThan(0.3);
    // 应有 4 层权重
    expect(result.layerWeights.length).toBe(4);
    // base 权重始终 1
    expect(result.layerWeights[0]).toBe(1.0);
  });
});

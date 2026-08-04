// FXAAEnhancedPass 单元测试。
//
// 覆盖:
//   A. 纯 CPU 函数(与 GPU shader 1:1 对应)
//      1. fxaaLuma            — Rec601 亮度
//      2. fxaaContrastCheck   — 局部对比检测
//      3. fxaaEdgeDirection   — 边缘方向检测
//      4. fxaaEdgeWalk        — 边缘端点搜索
//      5. fxaaComputeBlendFactor — 混合因子计算
//      6. fxaaPixel           — 完整 FXAA 像素处理
//   B. FXAAEnhancedPass 类
//      7. 构造默认值与选项覆盖
//      8. apply() 返回 finalTexture
//      9. setQuality() 修改质量预设
//     10. enabled 标志

import { describe, it, expect } from 'vitest';
import {
  FXAAEnhancedPass,
  fxaaLuma,
  fxaaContrastCheck,
  fxaaEdgeDirection,
  fxaaEdgeWalk,
  fxaaComputeBlendFactor,
  fxaaPixel,
  DEFAULT_FXAA_PARAMS,
  FXAA_QUALITY_STEPS,
  type FXAAColor,
  type FXAAQuality,
  type PassContext,
} from './FXAAEnhancedPass';

// ── Mock PassContext ──────────────────────────────────────────────

function makeTexture(id: string): WebGLTexture {
  return { id } as unknown as WebGLTexture;
}

function makeMockCtx(): PassContext {
  const noopGL = {
    bindFramebuffer: () => {},
    viewport: () => {},
    clear: () => {},
    clearColor: () => {},
    activeTexture: () => {},
    bindTexture: () => {},
    useProgram: () => {},
    bindVertexArray: () => {},
    drawArrays: () => {},
  };
  return {
    gl: noopGL as unknown as WebGL2RenderingContext,
    width: 800,
    height: 600,
    fullscreenQuad: {} as WebGLVertexArrayObject,
    resources: {
      mainFbo: {} as WebGLFramebuffer,
      mainTexture: makeTexture('main'),
      bloomFbo1: {} as WebGLFramebuffer,
      bloomTexture1: makeTexture('bloom1'),
      bloomFbo2: {} as WebGLFramebuffer,
      bloomTexture2: makeTexture('bloom2'),
      finalFbo: {} as WebGLFramebuffer,
      finalTexture: makeTexture('final'),
      width: 800,
      height: 600,
    },
    getProgram: () => ({
      use: () => {},
      setUniformSampler: () => {},
      setUniform2f: () => {},
      setUniform1f: () => {},
      setUniform1i: () => {},
    }) as never,
  };
}

// ── A. 纯 CPU 函数 ────────────────────────────────────────────────

describe('fxaaLuma', () => {
  it('black → 0', () => {
    expect(fxaaLuma([0, 0, 0])).toBe(0);
  });

  it('white → 1', () => {
    expect(fxaaLuma([1, 1, 1])).toBeCloseTo(1, 5);
  });

  it('uses Rec601 weights (0.299, 0.587, 0.114)', () => {
    expect(fxaaLuma([1, 0, 0])).toBeCloseTo(0.299, 5);
    expect(fxaaLuma([0, 1, 0])).toBeCloseTo(0.587, 5);
    expect(fxaaLuma([0, 0, 1])).toBeCloseTo(0.114, 5);
  });

  it('is linear', () => {
    const a = fxaaLuma([0.5, 0.5, 0.5]);
    expect(a).toBeCloseTo(0.5, 5);
  });
});

describe('fxaaContrastCheck', () => {
  it('uniform area → not an edge', () => {
    const r = fxaaContrastCheck(0.5, 0.5, 0.5, 0.5, 0.5);
    expect(r.isEdge).toBe(false);
    expect(r.range).toBe(0);
  });

  it('high contrast → is an edge', () => {
    const r = fxaaContrastCheck(0.9, 0.1, 0.9, 0.9, 0.9);
    expect(r.isEdge).toBe(true);
    expect(r.range).toBeCloseTo(0.8, 5);
  });

  it('reports correct min/max', () => {
    const r = fxaaContrastCheck(0.5, 0.8, 0.2, 0.6, 0.4);
    expect(r.lMin).toBeCloseTo(0.2, 5);
    expect(r.lMax).toBeCloseTo(0.8, 5);
  });

  it('respects edgeThreshold (higher threshold → fewer edges)', () => {
    // Small contrast with low threshold → edge
    const r1 = fxaaContrastCheck(0.5, 0.55, 0.5, 0.5, 0.5, 0.05, 0.01);
    expect(r1.isEdge).toBe(true);
    // Same contrast with high threshold → not edge
    const r2 = fxaaContrastCheck(0.5, 0.55, 0.5, 0.5, 0.5, 0.5, 0.01);
    expect(r2.isEdge).toBe(false);
  });

  it('respects edgeThresholdMin (dark areas skipped)', () => {
    // Very dark area with tiny contrast → skipped by min threshold
    const r = fxaaContrastCheck(0.01, 0.02, 0.01, 0.01, 0.01, 0.166, 0.05);
    expect(r.isEdge).toBe(false);
  });
});

describe('fxaaEdgeDirection', () => {
  it('detects horizontal edge (N/S gradient > W/E)', () => {
    // North has high contrast, south has high contrast, east/west don't
    const r = fxaaEdgeDirection(0.5, 0.1, 0.9, 0.5, 0.5);
    expect(r.isHorizontal).toBe(true);
  });

  it('detects vertical edge (W/E gradient > N/S)', () => {
    const r = fxaaEdgeDirection(0.5, 0.5, 0.5, 0.1, 0.9);
    expect(r.isHorizontal).toBe(false);
  });

  it('returns correct signDir for north-dominant', () => {
    const r = fxaaEdgeDirection(0.5, 0.1, 0.5, 0.5, 0.5);
    expect(r.signDir).toBe(1.0);
    expect(r.lOpp).toBeCloseTo(0.5, 5);
  });

  it('returns correct signDir for south-dominant', () => {
    const r = fxaaEdgeDirection(0.5, 0.5, 0.1, 0.5, 0.5);
    expect(r.signDir).toBe(-1.0);
  });

  it('returns correct signDir for east-dominant', () => {
    const r = fxaaEdgeDirection(0.5, 0.5, 0.5, 0.5, 0.1);
    expect(r.signDir).toBe(1.0);
  });

  it('returns correct signDir for west-dominant', () => {
    const r = fxaaEdgeDirection(0.5, 0.5, 0.5, 0.1, 0.5);
    expect(r.signDir).toBe(-1.0);
  });

  it('returns gradient magnitude', () => {
    const r = fxaaEdgeDirection(0.5, 0.1, 0.5, 0.5, 0.5);
    expect(r.gradient).toBeCloseTo(0.4, 5);
  });
});

describe('fxaaEdgeWalk', () => {
  it('returns finite distances when edge is found', () => {
    const texel: [number, number] = [1 / 800, 1 / 600];
    // For horizontal edge (isHorizontal=true, signDir=1.0):
    // UV offset = (0, signDir * pDist * texel.y)
    // sampleLuma receives UV = (0.5, 0.5 + pDist * texel.y)
    // First step = 1.5 texels → edge found at 1.5
    const sampleLuma = (uv: [number, number]): number => {
      const dyTexels = (uv[1] - 0.5) / texel[1];  // offset in texels
      const absDy = Math.abs(dyTexels);
      // Edge at distance 1.5 texels
      if (Math.abs(absDy - 1.5) < 0.01) return 0.9;  // edge found
      return 0.5;  // no edge
    };
    const r = fxaaEdgeWalk(
      [0.5, 0.5], true, 1.0, 0.5, 0.05, texel, sampleLuma, 'console',
    );
    // First step (1.5) should find the edge
    expect(r.pDist).toBeLessThan(999);
    expect(r.nDist).toBeLessThan(999);
    expect(r.pDist).toBeCloseTo(1.5, 3);
  });

  it('returns 999 when no edge found (uniform luma)', () => {
    const texel: [number, number] = [1 / 800, 1 / 600];
    const sampleLuma = () => 0.5;  // uniform, no edge
    const r = fxaaEdgeWalk(
      [0.5, 0.5], true, 1.0, 0.5, 0.05, texel, sampleLuma, 'console',
    );
    expect(r.pDist).toBe(999);
    expect(r.nDist).toBe(999);
  });

  it('console quality uses 4 steps', () => {
    expect(FXAA_QUALITY_STEPS.console).toBe(4);
  });

  it('pcHigh quality uses 8 steps', () => {
    expect(FXAA_QUALITY_STEPS.pcHigh).toBe(8);
  });

  it('pcExtreme quality uses 10 steps', () => {
    expect(FXAA_QUALITY_STEPS.pcExtreme).toBe(10);
  });
});

describe('fxaaComputeBlendFactor', () => {
  it('returns 0 when no edge found (both 999)', () => {
    const blend = fxaaComputeBlendFactor(999, 999, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 0.75);
    expect(blend).toBe(0);
  });

  it('returns positive blend when edge found', () => {
    // Asymmetric distances (pDist=2, nDist=6) → edgeBlend = 0.5 - 2/8 = 0.25
    // avg = (0.1+0.9+0.5+0.5)/4 = 0.5, lM=0.5 → subpixel=0
    // blend = max(0, 0.25) = 0.25
    const blend = fxaaComputeBlendFactor(2, 6, 0.5, 0.1, 0.9, 0.5, 0.5, 0.8, 0.75);
    expect(blend).toBeGreaterThan(0);
    expect(blend).toBeLessThanOrEqual(1);
  });

  it('symmetric edges → edgeBlend = 0', () => {
    // pDist = nDist → 0.5 - min/max = 0.5 - 0.5 = 0
    // subpixel = |avg - lM| / range = |0.5 - 0.5| / 0 = 0
    const blend = fxaaComputeBlendFactor(3, 3, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 0.75);
    expect(blend).toBe(0);
  });

  it('higher subpixel → more blending', () => {
    const blendLow = fxaaComputeBlendFactor(999, 999, 0.5, 0.1, 0.9, 0.5, 0.5, 0.8, 0.1);
    const blendHigh = fxaaComputeBlendFactor(999, 999, 0.5, 0.1, 0.9, 0.5, 0.5, 0.8, 1.0);
    expect(blendHigh).toBeGreaterThanOrEqual(blendLow);
  });

  it('blend is clamped to [0, 1]', () => {
    for (let i = 0; i < 10; i++) {
      const blend = fxaaComputeBlendFactor(
        Math.random() * 10, Math.random() * 10,
        Math.random(), Math.random(), Math.random(),
        Math.random(), Math.random(), Math.random(),
        Math.random(),
      );
      expect(blend).toBeGreaterThanOrEqual(0);
      expect(blend).toBeLessThanOrEqual(1);
    }
  });
});

describe('fxaaPixel', () => {
  it('flat area → returns center color unchanged', () => {
    const uniform: FXAAColor = [0.5, 0.5, 0.5];
    const result = fxaaPixel(
      [0.5, 0.5],
      () => uniform,
      [1 / 800, 1 / 600],
    );
    expect(result[0]).toBeCloseTo(0.5, 5);
    expect(result[1]).toBeCloseTo(0.5, 5);
    expect(result[2]).toBeCloseTo(0.5, 5);
  });

  it('edge area → returns finite color', () => {
    // Create a vertical edge: left half dark, right half bright
    const sampleColor = (uv: [number, number]): FXAAColor => {
      if (uv[0] < 0.5) return [0.1, 0.1, 0.1];
      return [0.9, 0.9, 0.9];
    };
    const result = fxaaPixel(
      [0.5, 0.5],
      sampleColor,
      [1 / 800, 1 / 600],
    );
    expect(Number.isFinite(result[0])).toBe(true);
    expect(Number.isFinite(result[1])).toBe(true);
    expect(Number.isFinite(result[2])).toBe(true);
  });

  it('respects quality parameter', () => {
    const qualities: FXAAQuality[] = ['console', 'pcHigh', 'pcExtreme'];
    for (const q of qualities) {
      const result = fxaaPixel(
        [0.5, 0.5],
        (uv) => uv[0] < 0.5 ? [0.1, 0.1, 0.1] : [0.9, 0.9, 0.9],
        [1 / 800, 1 / 600],
        { ...DEFAULT_FXAA_PARAMS, quality: q },
      );
      expect(Number.isFinite(result[0])).toBe(true);
    }
  });

  it('high edgeThreshold → less processing (more early exits)', () => {
    // With very high threshold, even edges are skipped.
    // At UV (0.5, 0.5), center is on bright side (0.55, since 0.5 is not < 0.5).
    const result = fxaaPixel(
      [0.5, 0.5],
      (uv) => uv[0] < 0.5 ? [0.45, 0.45, 0.45] : [0.55, 0.55, 0.55],
      [1 / 800, 1 / 600],
      { ...DEFAULT_FXAA_PARAMS, edgeThreshold: 1.0 },  // very high
    );
    // Should return center color (threshold too high to detect edge)
    expect(result[0]).toBeCloseTo(0.55, 5);
  });
});

// ── B. FXAAEnhancedPass 类 ───────────────────────────────────────

describe('FXAAEnhancedPass construction', () => {
  it('has correct defaults', () => {
    const p = new FXAAEnhancedPass();
    expect(p.name).toBe('fxaa-enhanced');
    expect(p.subpixel).toBe(DEFAULT_FXAA_PARAMS.subpixel);
    expect(p.edgeThreshold).toBe(DEFAULT_FXAA_PARAMS.edgeThreshold);
    expect(p.edgeThresholdMin).toBe(DEFAULT_FXAA_PARAMS.edgeThresholdMin);
    expect(p.quality).toBe(DEFAULT_FXAA_PARAMS.quality);
    expect(p.enabled).toBe(false);
  });

  it('accepts all options', () => {
    const p = new FXAAEnhancedPass({
      subpixel: 0.5,
      edgeThreshold: 0.2,
      edgeThresholdMin: 0.05,
      quality: 'pcExtreme',
      enabled: true,
    });
    expect(p.subpixel).toBe(0.5);
    expect(p.edgeThreshold).toBe(0.2);
    expect(p.edgeThresholdMin).toBe(0.05);
    expect(p.quality).toBe('pcExtreme');
    expect(p.enabled).toBe(true);
  });
});

describe('FXAAEnhancedPass apply', () => {
  it('returns finalTexture from ctx', () => {
    const p = new FXAAEnhancedPass({ enabled: true });
    const ctx = makeMockCtx();
    const out = p.apply(makeTexture('input'), ctx);
    expect(out).toBe(ctx.resources.finalTexture);
  });

  it('does not throw with mock ctx', () => {
    const p = new FXAAEnhancedPass({ enabled: true });
    const ctx = makeMockCtx();
    expect(() => p.apply(makeTexture('input'), ctx)).not.toThrow();
  });
});

describe('FXAAEnhancedPass setQuality', () => {
  it('changes quality preset', () => {
    const p = new FXAAEnhancedPass();
    expect(p.quality).toBe('pcHigh');
    p.setQuality('console');
    expect(p.quality).toBe('console');
    p.setQuality('pcExtreme');
    expect(p.quality).toBe('pcExtreme');
  });
});

describe('FXAAEnhancedPass extends RenderPass', () => {
  it('is a RenderPass subclass', () => {
    const p = new FXAAEnhancedPass();
    expect(p.enabled).toBeDefined();
    expect(p.name).toBeDefined();
    expect(typeof p.apply).toBe('function');
    expect(typeof p.dispose).toBe('function');
  });
});

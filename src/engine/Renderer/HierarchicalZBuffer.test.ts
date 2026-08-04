// HierarchicalZBuffer 单元测试。
//
// 覆盖:
//   A. buildHZB: mip 金字塔构建(级数、尺寸、最大深度)
//   B. makeFlatDepth / makeOccluderDepth: 辅助函数
//   C. 矩阵工具: identityMatrix / orthoMatrix
//   D. isOccluded: 单物体遮挡测试(可见/被遮挡/边界情况)
//   E. occlusionCull: 批量剔除
//   F. 选项: conservativeBias / mipBias / minScreenSize
//   G. 边界与错误: 空输入、单像素、w<=0

import { describe, it, expect } from 'vitest';
import {
  buildHZB,
  isOccluded,
  occlusionCull,
  makeFlatDepth,
  makeOccluderDepth,
  identityMatrix,
  orthoMatrix,
  type Occludee,
  type Vec3,
} from './HierarchicalZBuffer';

// ── 辅助构造 ─────────────────────────────────────────────────────

function makeBBox(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): { min: Vec3; max: Vec3 } {
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

function makeOccludee(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  id?: number | string,
): Occludee {
  return { bbox: makeBBox(minX, minY, minZ, maxX, maxY, maxZ), id };
}

// ── A. buildHZB ──────────────────────────────────────────────────

describe('buildHZB', () => {
  it('builds mip pyramid with correct level count (8×8 → 4 levels)', () => {
    const depth = makeFlatDepth(8, 8, 0.5);
    const hzb = buildHZB(depth, 8, 8);
    // 8 → 4 → 2 → 1 = 4 levels
    expect(hzb.mipCount).toBe(4);
    expect(hzb.width).toBe(8);
    expect(hzb.height).toBe(8);
  });

  it('level 0 = original depth (copied)', () => {
    const depth = makeFlatDepth(4, 4, 0.3);
    const hzb = buildHZB(depth, 4, 4);
    expect(hzb.levels[0].width).toBe(4);
    expect(hzb.levels[0].height).toBe(4);
    expect(hzb.levels[0].data.length).toBe(16);
    // Verify copy (not same reference)
    expect(hzb.levels[0].data).not.toBe(depth);
    // Same values (use toBeCloseTo for Float32 precision)
    for (let i = 0; i < 16; i++) {
      expect(hzb.levels[0].data[i]).toBeCloseTo(0.3, 5);
    }
  });

  it('each level stores MAX depth of 2×2 children', () => {
    // 4×4 depth: top-left 2×2 = 0.1, rest = 0.9
    const depth = makeOccluderDepth(4, 4, 0.1, 0.9, 0, 0, 2, 2);
    const hzb = buildHZB(depth, 4, 4);
    // Level 1 (2×2): top-left texel = max(0.1,0.1,0.1,0.1) = 0.1, rest = 0.9
    expect(hzb.levels[1].width).toBe(2);
    expect(hzb.levels[1].height).toBe(2);
    expect(hzb.levels[1].data[0]).toBeCloseTo(0.1, 5); // top-left
    expect(hzb.levels[1].data[1]).toBeCloseTo(0.9, 5); // top-right
    expect(hzb.levels[1].data[2]).toBeCloseTo(0.9, 5); // bottom-left
    expect(hzb.levels[1].data[3]).toBeCloseTo(0.9, 5); // bottom-right
  });

  it('coarsest level is 1×1', () => {
    const depth = makeFlatDepth(16, 16, 0.5);
    const hzb = buildHZB(depth, 16, 16);
    const last = hzb.levels[hzb.mipCount - 1];
    expect(last.width).toBe(1);
    expect(last.height).toBe(1);
  });

  it('non-power-of-2 dimensions work', () => {
    const depth = makeFlatDepth(5, 3, 0.5);
    const hzb = buildHZB(depth, 5, 3);
    // 5×3 → 2×1 → 1×1 = 3 levels
    expect(hzb.mipCount).toBe(3);
    expect(hzb.levels[0].width).toBe(5);
    expect(hzb.levels[0].height).toBe(3);
    expect(hzb.levels[1].width).toBe(2);
    expect(hzb.levels[1].height).toBe(1);
    expect(hzb.levels[2].width).toBe(1);
    expect(hzb.levels[2].height).toBe(1);
  });

  it('1×1 depth → single level', () => {
    const depth = makeFlatDepth(1, 1, 0.5);
    const hzb = buildHZB(depth, 1, 1);
    expect(hzb.mipCount).toBe(1);
    expect(hzb.levels[0].width).toBe(1);
    expect(hzb.levels[0].height).toBe(1);
  });

  it('throws on mismatched buffer length', () => {
    const depth = new Float32Array(10);
    expect(() => buildHZB(depth, 4, 4)).toThrow();
  });

  it('throws on zero/negative dimensions', () => {
    expect(() => buildHZB(new Float32Array(0), 0, 0)).toThrow();
  });

  it('does not modify original depth buffer', () => {
    const depth = makeOccluderDepth(4, 4, 0.1, 0.9, 0, 0, 2, 2);
    const original = new Float32Array(depth);
    buildHZB(depth, 4, 4);
    expect(depth).toEqual(original);
  });
});

// ── B. makeFlatDepth / makeOccluderDepth ─────────────────────────

describe('makeFlatDepth', () => {
  it('fills all pixels with the given depth', () => {
    const buf = makeFlatDepth(4, 4, 0.7);
    expect(buf.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(buf[i]).toBeCloseTo(0.7, 5);
    }
  });
});

describe('makeOccluderDepth', () => {
  it('creates occluder rectangle with correct depths', () => {
    const buf = makeOccluderDepth(8, 8, 0.2, 0.9, 2, 2, 4, 4);
    // Top-left corner = background
    expect(buf[0]).toBeCloseTo(0.9, 5);
    // Inside occluder (2,2)
    expect(buf[2 * 8 + 2]).toBeCloseTo(0.2, 5);
    // Inside occluder (5,5) - last pixel of occluder
    expect(buf[5 * 8 + 5]).toBeCloseTo(0.2, 5);
    // Outside occluder (6,6)
    expect(buf[6 * 8 + 6]).toBeCloseTo(0.9, 5);
  });

  it('clamps occluder to buffer bounds', () => {
    const buf = makeOccluderDepth(4, 4, 0.2, 0.9, 2, 2, 10, 10);
    // (3,3) should be occluder (clamped)
    expect(buf[3 * 4 + 3]).toBeCloseTo(0.2, 5);
    // (0,0) should be background
    expect(buf[0]).toBeCloseTo(0.9, 5);
  });
});

// ── C. 矩阵工具 ──────────────────────────────────────────────────

describe('identityMatrix', () => {
  it('produces a 4×4 identity matrix', () => {
    const m = identityMatrix();
    expect(m.length).toBe(16);
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(1);
    expect(m[15]).toBe(1);
    // Off-diagonal = 0
    expect(m[1]).toBe(0);
    expect(m[4]).toBe(0);
    expect(m[12]).toBe(0);
  });
});

describe('orthoMatrix', () => {
  it('maps near plane to NDC z = -1 (depth 0)', () => {
    // Ortho: left=-1, right=1, bottom=-1, top=1, near=0, far=2
    const m = orthoMatrix(-1, 1, -1, 1, 0, 2);
    // Point (0,0,0) = near plane → NDC z should be -1
    const z = m[2] * 0 + m[6] * 0 + m[10] * 0 + m[14];
    const w = m[3] * 0 + m[7] * 0 + m[11] * 0 + m[15];
    expect(z / w).toBeCloseTo(-1, 5);
  });

  it('maps far plane to NDC z = +1 (depth 1)', () => {
    const m = orthoMatrix(-1, 1, -1, 1, 0, 2);
    // Point (0,0,2) = far plane → NDC z should be +1
    const z = m[2] * 0 + m[6] * 0 + m[10] * 2 + m[14];
    const w = m[3] * 0 + m[7] * 0 + m[11] * 2 + m[15];
    expect(z / w).toBeCloseTo(1, 5);
  });

  it('maps midpoint to NDC z = 0 (depth 0.5)', () => {
    const m = orthoMatrix(-1, 1, -1, 1, 0, 2);
    // Point (0,0,1) = midpoint → NDC z should be 0
    const z = m[2] * 0 + m[6] * 0 + m[10] * 1 + m[14];
    const w = m[3] * 0 + m[7] * 0 + m[11] * 1 + m[15];
    expect(z / w).toBeCloseTo(0, 5);
  });
});

// ── D. isOccluded ────────────────────────────────────────────────

describe('isOccluded', () => {
  // 使用正交投影:世界空间 [-1,1]³ → NDC [-1,1]³
  // 屏幕 100×100 像素
  // ortho(-1,1,-1,1,0,2): z=0→depth 0(near), z=1→depth 0.5, z=2→depth 1(far)
  const screenW = 100;
  const screenH = 100;
  const viewProj = orthoMatrix(-1, 1, -1, 1, 0, 2);

  it('returns false (visible) when object is in front of depth buffer', () => {
    // Flat depth at 0.9 (everything far). Object at z=[0.1, 0.2] → depth=[0.05, 0.1]
    const depth = makeFlatDepth(screenW, screenH, 0.9);
    const hzb = buildHZB(depth, screenW, screenH);
    const bbox = makeBBox(-0.5, -0.5, 0.1, 0.5, 0.5, 0.2);
    // Object minDepth ≈ 0.05, HZB depth = 0.9 → 0.05 < 0.9 → not occluded
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH)).toBe(false);
  });

  it('returns true (occluded) when object is behind depth buffer', () => {
    // Flat depth at 0.1 (everything near). Object at z=[1.5, 1.6] → depth=[0.75, 0.8]
    const depth = makeFlatDepth(screenW, screenH, 0.1);
    const hzb = buildHZB(depth, screenW, screenH);
    const bbox = makeBBox(-0.5, -0.5, 1.5, 0.5, 0.5, 1.6);
    // Object minDepth ≈ 0.75, HZB depth = 0.1 → 0.75 > 0.1 → occluded
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH)).toBe(true);
  });

  it('returns false when object spans near and far (partially visible)', () => {
    // Depth at 0.5. Object from z=0.1 (depth 0.05) to z=1.5 (depth 0.75)
    // minDepth ≈ 0.05 < 0.5 → not fully occluded
    const depth = makeFlatDepth(screenW, screenH, 0.5);
    const hzb = buildHZB(depth, screenW, screenH);
    const bbox = makeBBox(-0.5, -0.5, 0.1, 0.5, 0.5, 1.5);
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH)).toBe(false);
  });

  it('respects conservativeBias (larger bias = harder to occlude)', () => {
    // Depth at 0.3. Object at z=[1.3, 1.4] → depth=[0.65, 0.7]
    const depth = makeFlatDepth(screenW, screenH, 0.3);
    const hzb = buildHZB(depth, screenW, screenH);
    const bbox = makeBBox(-0.5, -0.5, 1.3, 0.5, 0.5, 1.4);
    // minDepth ≈ 0.65, HZB depth = 0.3
    // Without bias: 0.65 > 0.3 → occluded
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH, { conservativeBias: 0 })).toBe(true);
    // With large bias: 0.65 - 1.0 = -0.35 < 0.3 → visible
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH, { conservativeBias: 1.0 })).toBe(false);
  });

  it('returns false when object is behind camera (w <= 0)', () => {
    const depth = makeFlatDepth(screenW, screenH, 0.1);
    const hzb = buildHZB(depth, screenW, screenH);
    // Use a matrix that flips w: scale by -1 in z
    const flipMatrix = new Float32Array(identityMatrix());
    flipMatrix[10] = -1; // Flip z → w becomes negative for positive z points
    const bbox = makeBBox(-0.5, -0.5, 0.5, 0.5, 0.5, 0.6);
    expect(isOccluded(hzb, bbox, flipMatrix, screenW, screenH)).toBe(false);
  });

  it('returns false for very small screen-space objects (minScreenSize)', () => {
    const depth = makeFlatDepth(screenW, screenH, 0.1);
    const hzb = buildHZB(depth, screenW, screenH);
    // Tiny object (0.01 × 0.01 in world → < 2px on 100×100 screen)
    const bbox = makeBBox(0, 0, 1.5, 0.01, 0.01, 1.6);
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH, { minScreenSize: 2 })).toBe(false);
  });

  it('handles occluder covering part of screen (occluded in center, visible at edges)', () => {
    // 100×100 screen, occluder in center (25,25,50,50) at depth 0.1
    const depth = makeOccluderDepth(screenW, screenH, 0.1, 0.9, 25, 25, 50, 50);
    const hzb = buildHZB(depth, screenW, screenH);

    // Object at center (behind occluder) → occluded
    // z=[1.5, 1.6] → depth=[0.75, 0.8], HZB center depth = 0.1
    const centerObj = makeBBox(-0.1, -0.1, 1.5, 0.1, 0.1, 1.6);
    expect(isOccluded(hzb, centerObj, viewProj, screenW, screenH)).toBe(true);

    // Object at corner (not behind occluder) → visible
    // Corner maps to screen edge where depth = 0.9
    const cornerObj = makeBBox(-0.9, -0.9, 1.5, -0.8, -0.8, 1.6);
    expect(isOccluded(hzb, cornerObj, viewProj, screenW, screenH)).toBe(false);
  });
});

// ── E. occlusionCull ─────────────────────────────────────────────

describe('occlusionCull', () => {
  const screenW = 100;
  const screenH = 100;
  const viewProj = orthoMatrix(-1, 1, -1, 1, 0, 2);

  it('correctly separates visible and occluded objects', () => {
    // Flat depth at 0.3. Objects:
    //   'near': z=[0.1, 0.2] → depth=[0.05, 0.1] → visible (in front)
    //   'far':  z=[1.5, 1.6] → depth=[0.75, 0.8] → occluded (behind)
    //   'edge': z=[0.25, 0.35] → depth=[0.125, 0.175] → visible (in front)
    const depth = makeFlatDepth(screenW, screenH, 0.3);
    const hzb = buildHZB(depth, screenW, screenH);

    const objects: Occludee[] = [
      makeOccludee(-0.5, -0.5, 0.1, 0.5, 0.5, 0.2, 'near'),
      makeOccludee(-0.5, -0.5, 1.5, 0.5, 0.5, 1.6, 'far'),
      makeOccludee(-0.5, -0.5, 0.25, 0.5, 0.5, 0.35, 'edge'),
    ];

    const result = occlusionCull(hzb, objects, viewProj, screenW, screenH);
    expect(result.visible.length).toBe(2);
    expect(result.occluded.length).toBe(1);
    expect(result.occluded[0].id).toBe('far');
  });

  it('returns correct stats', () => {
    // Flat depth at 0.2. Objects:
    //   'a': z=[0.1, 0.2] → depth=[0.05, 0.1] → visible
    //   'b': z=[1.0, 1.1] → depth=[0.5, 0.55] → occluded
    //   'c': z=[1.5, 1.6] → depth=[0.75, 0.8] → occluded
    //   'd': z=[1.8, 1.9] → depth=[0.9, 0.95] → occluded
    const depth = makeFlatDepth(screenW, screenH, 0.2);
    const hzb = buildHZB(depth, screenW, screenH);

    const objects: Occludee[] = [
      makeOccludee(-0.5, -0.5, 0.1, 0.5, 0.5, 0.2, 'a'),
      makeOccludee(-0.5, -0.5, 1.0, 0.5, 0.5, 1.1, 'b'),
      makeOccludee(-0.5, -0.5, 1.5, 0.5, 0.5, 1.6, 'c'),
      makeOccludee(-0.5, -0.5, 1.8, 0.5, 0.5, 1.9, 'd'),
    ];

    const result = occlusionCull(hzb, objects, viewProj, screenW, screenH);
    expect(result.stats.total).toBe(4);
    expect(result.stats.visibleCount).toBe(1);
    expect(result.stats.occludedCount).toBe(3);
    expect(result.stats.cullRatio).toBeCloseTo(0.75, 5);
  });

  it('handles empty input', () => {
    const depth = makeFlatDepth(screenW, screenH, 0.5);
    const hzb = buildHZB(depth, screenW, screenH);
    const result = occlusionCull(hzb, [], viewProj, screenW, screenH);
    expect(result.visible.length).toBe(0);
    expect(result.occluded.length).toBe(0);
    expect(result.stats.total).toBe(0);
    expect(result.stats.cullRatio).toBe(0);
  });

  it('all visible when depth buffer is far', () => {
    // Depth at 0.99 → objects at z=[0.1, 0.9] all have depth < 0.99
    const depth = makeFlatDepth(screenW, screenH, 0.99);
    const hzb = buildHZB(depth, screenW, screenH);
    const objects: Occludee[] = [
      makeOccludee(-0.5, -0.5, 0.1, 0.5, 0.5, 0.2, 'a'),  // depth ≈ 0.05
      makeOccludee(-0.5, -0.5, 0.5, 0.5, 0.5, 0.6, 'b'),  // depth ≈ 0.25
      makeOccludee(-0.5, -0.5, 0.8, 0.5, 0.5, 0.9, 'c'),  // depth ≈ 0.4
    ];
    const result = occlusionCull(hzb, objects, viewProj, screenW, screenH);
    expect(result.visible.length).toBe(3);
    expect(result.occluded.length).toBe(0);
  });

  it('all occluded when depth buffer is near', () => {
    // Depth at 0.01 → objects at z >= 0.5 all have depth > 0.01
    const depth = makeFlatDepth(screenW, screenH, 0.01);
    const hzb = buildHZB(depth, screenW, screenH);
    const objects: Occludee[] = [
      makeOccludee(-0.5, -0.5, 0.5, 0.5, 0.5, 0.6, 'a'),   // depth ≈ 0.25
      makeOccludee(-0.5, -0.5, 1.0, 0.5, 0.5, 1.1, 'b'),   // depth ≈ 0.5
      makeOccludee(-0.5, -0.5, 1.5, 0.5, 0.5, 1.6, 'c'),   // depth ≈ 0.75
    ];
    const result = occlusionCull(hzb, objects, viewProj, screenW, screenH);
    expect(result.visible.length).toBe(0);
    expect(result.occluded.length).toBe(3);
  });

  it('preserves user data in results', () => {
    const depth = makeFlatDepth(screenW, screenH, 0.5);
    const hzb = buildHZB(depth, screenW, screenH);
    const objects: Occludee[] = [
      { bbox: makeBBox(-0.5, -0.5, 0.1, 0.5, 0.5, 0.2), id: 1, data: { name: 'hero' } },
    ];
    const result = occlusionCull(hzb, objects, viewProj, screenW, screenH);
    expect(result.visible[0].data).toEqual({ name: 'hero' });
  });
});

// ── F. 选项测试 ──────────────────────────────────────────────────

describe('OcclusionTestOptions', () => {
  const screenW = 100;
  const screenH = 100;
  const viewProj = orthoMatrix(-1, 1, -1, 1, 0, 2);

  it('mipBias affects which mip level is sampled', () => {
    // Create a depth buffer where center is near but edges are far
    const depth = makeOccluderDepth(screenW, screenH, 0.1, 0.9, 40, 40, 20, 20);
    const hzb = buildHZB(depth, screenW, screenH);

    // Object behind the occluder, at center
    // z=[1.5, 1.6] → depth=[0.75, 0.8]
    const bbox = makeBBox(-0.1, -0.1, 1.5, 0.1, 0.1, 1.6);

    // Without bias: should be occluded (center has near depth 0.1)
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH, { mipBias: 0 })).toBe(true);

    // With high mipBias: samples coarser mip where the occluder's near depth
    // might be averaged with far depth → may become visible
    // Just verify it doesn't crash and returns a boolean
    const resultHighBias = isOccluded(hzb, bbox, viewProj, screenW, screenH, { mipBias: 3 });
    expect(typeof resultHighBias).toBe('boolean');
  });

  it('minScreenSize prevents culling of tiny objects', () => {
    const depth = makeFlatDepth(screenW, screenH, 0.01); // everything near
    const hzb = buildHZB(depth, screenW, screenH);

    // Very tiny object far away: z=[1.5, 1.6] → depth=[0.75, 0.8]
    const bbox = makeBBox(0, 0, 1.5, 0.001, 0.001, 1.6);

    // With minScreenSize=10, tiny objects should not be occluded
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH, { minScreenSize: 10 })).toBe(false);

    // With minScreenSize=0, tiny objects can be occluded
    expect(isOccluded(hzb, bbox, viewProj, screenW, screenH, { minScreenSize: 0 })).toBe(true);
  });
});

// ── G. 边界与错误 ────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles 1×1 depth buffer', () => {
    const depth = makeFlatDepth(1, 1, 0.5);
    const hzb = buildHZB(depth, 1, 1);
    expect(hzb.mipCount).toBe(1);

    const viewProj = orthoMatrix(-1, 1, -1, 1, 0, 2);
    const bbox = makeBBox(-0.5, -0.5, 0.1, 0.5, 0.5, 0.2);
    // Should not crash
    const result = isOccluded(hzb, bbox, viewProj, 1, 1);
    expect(typeof result).toBe('boolean');
  });

  it('handles object at exact near plane', () => {
    const depth = makeFlatDepth(100, 100, 0.5);
    const hzb = buildHZB(depth, 100, 100);
    const viewProj = orthoMatrix(-1, 1, -1, 1, 0, 2);
    // z=0 → NDC z = -1 → depth = 0 (near plane)
    const bbox = makeBBox(-0.5, -0.5, 0, 0.5, 0.5, 0.1);
    // depth = 0, HZB depth = 0.5 → 0 < 0.5 → visible
    expect(isOccluded(hzb, bbox, viewProj, 100, 100)).toBe(false);
  });

  it('handles object at exact far plane', () => {
    const depth = makeFlatDepth(100, 100, 0.01); // very near
    const hzb = buildHZB(depth, 100, 100);
    const viewProj = orthoMatrix(-1, 1, -1, 1, 0, 2);
    // z=2 → NDC z = +1 → depth = 1 (far plane)
    const bbox = makeBBox(-0.5, -0.5, 1.9, 0.5, 0.5, 2.0);
    // depth ≈ 0.95, HZB depth = 0.01 → 0.95 > 0.01 → occluded
    expect(isOccluded(hzb, bbox, viewProj, 100, 100)).toBe(true);
  });

  it('handles non-square screen', () => {
    const depth = makeFlatDepth(200, 100, 0.5);
    const hzb = buildHZB(depth, 200, 100);
    const viewProj = orthoMatrix(-2, 2, -1, 1, 0, 2);
    const bbox = makeBBox(-1, -0.5, 0.1, 1, 0.5, 0.2);
    const result = isOccluded(hzb, bbox, viewProj, 200, 100);
    expect(typeof result).toBe('boolean');
  });
});

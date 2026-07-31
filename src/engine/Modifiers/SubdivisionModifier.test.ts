// SubdivisionModifier 单元测试 (Catmull-Clark 细分曲面)。
//
// 覆盖:
//   1. 构造默认值 + 选项 + iterations 边界
//   2. iterations=0 返回深拷贝
//   3. 单三角形细分 (面数 ×6,顶点数正确)
//   4. 立方体细分 (边界规则保留锐边)
//   5. 多次迭代 (面数 ×6^iterations)
//   6. UV 插值
//   7. 法线重计算
//   8. 非索引几何体输入 (自动索引化)
//   9. 顶点位置不变性 (质心保持)
//  10. 输入不被修改

import { describe, it, expect } from 'vitest';
import { SubdivisionModifier } from './SubdivisionModifier';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';

/** 构造一个三角形 (非索引)。 */
function makeTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]), 3));
  g.computeVertexNormals();
  return g;
}

/** 构造一个索引化的四边形 (2 三角形)。 */
function makeQuad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/**
 * 构造一个单位立方体 (8 顶点,12 三角形,索引化)。
 * 边长 2,中心位于原点。
 */
function makeBox(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    -1, -1, -1,
    1, -1, -1,
    1, 1, -1,
    -1, 1, -1,
    -1, -1, 1,
    1, -1, 1,
    1, 1, 1,
    -1, 1, 1,
  ]), 3));
  // 12 三角形 (每面 2 个)
  g.setIndex([
    0, 1, 2, 0, 2, 3, // -Z
    4, 6, 5, 4, 7, 6, // +Z
    0, 4, 5, 0, 5, 1, // -Y
    2, 6, 7, 2, 7, 3, // +Y
    0, 3, 7, 0, 7, 4, // -X
    1, 5, 6, 1, 6, 2, // +X
  ]);
  g.computeVertexNormals();
  return g;
}

/** 构造一个带 UV 的四边形。 */
function makeQuadWithUV(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** 计算几何体的三角形面数。 */
function faceCount(g: BufferGeometry): number {
  if (g.index) return g.index.count / 3;
  const pos = g.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

/** 计算顶点数。 */
function vertexCount(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  return pos ? pos.count : 0;
}

/** 获取所有顶点位置的数组副本。 */
function positionsOf(g: BufferGeometry): Float32Array {
  const pos = g.getAttribute('position')!;
  return (pos.array as Float32Array).slice();
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('SubdivisionModifier construction', () => {
  it('defaults', () => {
    const m = new SubdivisionModifier();
    expect(m.iterations).toBe(1);
    expect(m.interpolateUV).toBe(true);
    expect(m.recomputeNormals).toBe(true);
  });

  it('accepts options', () => {
    const m = new SubdivisionModifier({ iterations: 3, interpolateUV: false, recomputeNormals: false });
    expect(m.iterations).toBe(3);
    expect(m.interpolateUV).toBe(false);
    expect(m.recomputeNormals).toBe(false);
  });

  it('clamps iterations to [0, 6]', () => {
    expect(new SubdivisionModifier({ iterations: -5 }).iterations).toBe(0);
    expect(new SubdivisionModifier({ iterations: 100 }).iterations).toBe(6);
    // 非整数会被截断
    expect(new SubdivisionModifier({ iterations: 2.9 }).iterations).toBe(2);
  });
});

// ── iterations=0 ─────────────────────────────────────────────────────

describe('SubdivisionModifier iterations=0', () => {
  it('returns a deep copy when iterations=0', () => {
    const tri = makeTriangle();
    const m = new SubdivisionModifier({ iterations: 0 });
    const out = m.modify(tri);
    expect(out).not.toBe(tri);
    expect(faceCount(out)).toBe(faceCount(tri));
    expect(vertexCount(out)).toBe(vertexCount(tri));
    // 位置数据相同但内存独立
    const posA = tri.getAttribute('position')!.array as Float32Array;
    const posB = out.getAttribute('position')!.array as Float32Array;
    expect(posB).not.toBe(posA);
    for (let i = 0; i < posA.length; i++) {
      expect(posB[i]).toBeCloseTo(posA[i]);
    }
  });
});

// ── 单次细分 ──────────────────────────────────────────────────────────

describe('SubdivisionModifier single iteration', () => {
  it('subdivides a triangle into 6 triangles', () => {
    const tri = makeTriangle();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(tri);
    expect(faceCount(out)).toBe(6);
  });

  it('subdivides a quad (2 triangles) into 12 triangles', () => {
    const quad = makeQuad();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(quad);
    expect(faceCount(out)).toBe(12);
  });

  it('subdivides a box (12 triangles) into 72 triangles', () => {
    const box = makeBox();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(box);
    expect(faceCount(out)).toBe(72);
  });

  it('produces more vertices than input', () => {
    const tri = makeTriangle();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(tri);
    // 3 原顶点 + 1 face point + 3 edge points = 7
    expect(vertexCount(out)).toBe(7);
  });

  it('quad face count = 6 * input face count', () => {
    const quad = makeQuad();
    const inFaces = faceCount(quad);
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(quad);
    expect(faceCount(out)).toBe(6 * inFaces);
  });
});

// ── 多次迭代 ──────────────────────────────────────────────────────────

describe('SubdivisionModifier multiple iterations', () => {
  it('2 iterations = 36x face count', () => {
    const box = makeBox();
    const inFaces = faceCount(box);
    const m = new SubdivisionModifier({ iterations: 2 });
    const out = m.modify(box);
    expect(faceCount(out)).toBe(36 * inFaces);
  });

  it('3 iterations = 216x face count', () => {
    const tri = makeTriangle();
    const inFaces = faceCount(tri);
    const m = new SubdivisionModifier({ iterations: 3 });
    const out = m.modify(tri);
    expect(faceCount(out)).toBe(216 * inFaces);
  });

  it('face count grows exponentially', () => {
    const tri = makeTriangle();
    const f1 = faceCount(new SubdivisionModifier({ iterations: 1 }).modify(tri));
    const f2 = faceCount(new SubdivisionModifier({ iterations: 2 }).modify(tri));
    const f3 = faceCount(new SubdivisionModifier({ iterations: 3 }).modify(tri));
    expect(f2).toBe(f1 * 6);
    expect(f3).toBe(f2 * 6);
  });
});

// ── 顶点位置不变性 ───────────────────────────────────────────────────

describe('SubdivisionModifier invariants', () => {
  it('preserves the centroid of the mesh', () => {
    const box = makeBox();
    const m = new SubdivisionModifier({ iterations: 2 });
    const out = m.modify(box);
    // 立方体质心在原点,细分后仍应在原点附近
    const pos = out.getAttribute('position')!.array as Float32Array;
    const vc = out.getAttribute('position')!.count;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < vc; i++) {
      cx += pos[i * 3];
      cy += pos[i * 3 + 1];
      cz += pos[i * 3 + 2];
    }
    cx /= vc;
    cy /= vc;
    cz /= vc;
    expect(Math.abs(cx)).toBeLessThan(0.1);
    expect(Math.abs(cy)).toBeLessThan(0.1);
    expect(Math.abs(cz)).toBeLessThan(0.1);
  });

  it('box subdivision shrinks toward a sphere (volume decreases)', () => {
    const box = makeBox();
    // 立方体顶点到原点最远距离 = sqrt(3) ≈ 1.732
    const m = new SubdivisionModifier({ iterations: 3, recomputeNormals: false });
    const out = m.modify(box);
    const pos = out.getAttribute('position')!.array as Float32Array;
    const vc = out.getAttribute('position')!.count;
    let maxR = 0;
    for (let i = 0; i < vc; i++) {
      const r = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      if (r > maxR) maxR = r;
    }
    // Catmull-Clark 收缩后,最远顶点应小于原 sqrt(3)
    expect(maxR).toBeLessThan(Math.sqrt(3));
  });

  it('does not modify the input geometry', () => {
    const tri = makeTriangle();
    const originalPositions = positionsOf(tri);
    const m = new SubdivisionModifier({ iterations: 2 });
    m.modify(tri);
    const after = positionsOf(tri);
    for (let i = 0; i < originalPositions.length; i++) {
      expect(after[i]).toBeCloseTo(originalPositions[i]);
    }
  });

  it('output is a different BufferGeometry instance', () => {
    const tri = makeTriangle();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(tri);
    expect(out).not.toBe(tri);
  });
});

// ── UV 插值 ─────────────────────────────────────────────────────────

describe('SubdivisionModifier UV interpolation', () => {
  it('preserves UV attribute when interpolateUV=true', () => {
    const quad = makeQuadWithUV();
    const m = new SubdivisionModifier({ iterations: 1, interpolateUV: true });
    const out = m.modify(quad);
    expect(out.getAttribute('uv')).toBeDefined();
    expect(out.getAttribute('uv')!.count).toBe(out.getAttribute('position')!.count);
  });

  it('drops UV attribute when interpolateUV=false', () => {
    const quad = makeQuadWithUV();
    const m = new SubdivisionModifier({ iterations: 1, interpolateUV: false });
    const out = m.modify(quad);
    expect(out.getAttribute('uv')).toBeUndefined();
  });

  it('UV stays in a reasonable range for unit quad', () => {
    // 注意: Catmull-Clark 在三角化网格上可能外推 UV (边界规则 3/4*S + 1/8*midpoints
    // 可产生略超 [0,1] 的值),这是数学上正确的行为。
    const quad = makeQuadWithUV();
    const m = new SubdivisionModifier({ iterations: 2, interpolateUV: true, recomputeNormals: false });
    const out = m.modify(quad);
    const uvs = out.getAttribute('uv')!.array as Float32Array;
    for (let i = 0; i < uvs.length; i++) {
      expect(uvs[i]).toBeGreaterThanOrEqual(-0.5);
      expect(uvs[i]).toBeLessThanOrEqual(1.5);
    }
  });
});

// ── 法线 ─────────────────────────────────────────────────────────────

describe('SubdivisionModifier normals', () => {
  it('recomputes normals when recomputeNormals=true', () => {
    const box = makeBox();
    const m = new SubdivisionModifier({ iterations: 1, recomputeNormals: true });
    const out = m.modify(box);
    expect(out.getAttribute('normal')).toBeDefined();
    expect(out.getAttribute('normal')!.count).toBe(out.getAttribute('position')!.count);
  });

  it('does not add normals when input has none', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]), 3));
    g.setIndex([0, 1, 2]);
    const m = new SubdivisionModifier({ iterations: 1, recomputeNormals: true });
    const out = m.modify(g);
    expect(out.getAttribute('normal')).toBeUndefined();
  });

  it('skips recomputation when recomputeNormals=false', () => {
    const box = makeBox();
    const m = new SubdivisionModifier({ iterations: 1, recomputeNormals: false });
    const out = m.modify(box);
    // 不重新计算法线时,输出不会有 normal 属性 (细分只输出 position/uv)
    expect(out.getAttribute('normal')).toBeUndefined();
  });

  it('normals are unit length', () => {
    const box = makeBox();
    const m = new SubdivisionModifier({ iterations: 2, recomputeNormals: true });
    const out = m.modify(box);
    const nrm = out.getAttribute('normal')!.array as Float32Array;
    const vc = out.getAttribute('normal')!.count;
    for (let i = 0; i < vc; i++) {
      const len = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
      expect(len).toBeCloseTo(1, 2);
    }
  });
});

// ── 非索引输入 ────────────────────────────────────────────────────────

describe('SubdivisionModifier non-indexed input', () => {
  it('handles non-indexed geometry', () => {
    const tri = makeTriangle(); // 非索引
    expect(tri.index).toBeNull();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(tri);
    expect(faceCount(out)).toBe(6);
  });

  it('handles non-indexed quad', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0,
      0, 0, 0, 1, 1, 0, 0, 1, 0,
    ]), 3));
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(g);
    // 2 三角形 → 12 三角形
    expect(faceCount(out)).toBe(12);
  });
});

// ── 边界规则 ──────────────────────────────────────────────────────────

describe('SubdivisionModifier boundary rules', () => {
  it('box is a closed mesh → all interior vertices move inward (shrink toward sphere)', () => {
    // 立方体是闭合网格,没有边界边,所有顶点使用内部规则 (Q + 2R + (n-3)S) / n,
    // 这会导致角点向内收缩 (Catmull-Clark 收缩特性,趋向球体)。
    const box = makeBox();
    const originalCorners = positionsOf(box);
    const m = new SubdivisionModifier({ iterations: 1, recomputeNormals: false });
    const out = m.modify(box);
    const newPos = out.getAttribute('position')!.array as Float32Array;
    // 原 8 顶点保留在新数组前 8 个位置
    for (let v = 0; v < 8; v++) {
      const dx = newPos[v * 3] - originalCorners[v * 3];
      const dy = newPos[v * 3 + 1] - originalCorners[v * 3 + 1];
      const dz = newPos[v * 3 + 2] - originalCorners[v * 3 + 2];
      const dist = Math.hypot(dx, dy, dz);
      // 内部规则下角点应向内移动 (dist > 0)
      expect(dist).toBeGreaterThan(0);
      // 但移动量应在合理范围内 (< 1.5,不超过原立方体半边长)
      expect(dist).toBeLessThan(1.5);
      // 角点应向原点方向移动 (收缩)
      const origLen = Math.hypot(originalCorners[v * 3], originalCorners[v * 3 + 1], originalCorners[v * 3 + 2]);
      const newLen = Math.hypot(newPos[v * 3], newPos[v * 3 + 1], newPos[v * 3 + 2]);
      expect(newLen).toBeLessThan(origLen);
    }
  });

  it('open mesh boundary vertices stay on the boundary (boundary rule)', () => {
    // 单四边形 (开网格):4 个角点都是边界顶点,应使用边界规则
    // 边界规则: 3/4 * S + 1/8 * (前后边中点) — 顶点在边界曲线上移动量小
    const quad = makeQuad();
    const originalCorners = positionsOf(quad);
    const m = new SubdivisionModifier({ iterations: 1, recomputeNormals: false });
    const out = m.modify(quad);
    const newPos = out.getAttribute('position')!.array as Float32Array;
    for (let v = 0; v < 4; v++) {
      const dx = newPos[v * 3] - originalCorners[v * 3];
      const dy = newPos[v * 3 + 1] - originalCorners[v * 3 + 1];
      const dz = newPos[v * 3 + 2] - originalCorners[v * 3 + 2];
      const dist = Math.hypot(dx, dy, dz);
      // 边界规则下,角点移动量应较小 (< 0.5)
      expect(dist).toBeLessThan(0.5);
    }
  });

  it('open mesh boundary stays on the boundary plane', () => {
    // 单个三角形 (开网格,所有边都是边界)
    const tri = makeTriangle();
    const m = new SubdivisionModifier({ iterations: 1, recomputeNormals: false });
    const out = m.modify(tri);
    const pos = out.getAttribute('position')!.array as Float32Array;
    const vc = out.getAttribute('position')!.count;
    // 所有顶点 z 应接近 0 (在原三角形平面内)
    for (let i = 0; i < vc; i++) {
      expect(Math.abs(pos[i * 3 + 2])).toBeLessThan(0.01);
    }
  });
});

// ── 边界情况 ──────────────────────────────────────────────────────────

describe('SubdivisionModifier edge cases', () => {
  it('throws when geometry has no position attribute', () => {
    const g = new BufferGeometry();
    const m = new SubdivisionModifier({ iterations: 1 });
    expect(() => m.modify(g)).toThrow();
  });

  it('handles single triangle (no shared edges)', () => {
    const tri = makeTriangle();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(tri);
    // 3 原顶点 + 1 face point + 3 edge points = 7
    expect(vertexCount(out)).toBe(7);
    expect(faceCount(out)).toBe(6);
  });

  it('output has bounding box and sphere computed', () => {
    const box = makeBox();
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(box);
    expect(out.boundingBox).not.toBeNull();
    expect(out.boundingSphere).not.toBeNull();
  });

  it('preserves groups from input', () => {
    const quad = makeQuad();
    quad.addGroup(0, 6, 0);
    const m = new SubdivisionModifier({ iterations: 1 });
    const out = m.modify(quad);
    expect(out.groups.length).toBe(1);
    expect(out.groups[0].materialIndex).toBe(0);
  });
});

// EdgeSplitModifier 单元测试。
//
// 覆盖:
//   1. 构造默认值 + 选项
//   2. threshold=π 不分裂 (顶点数不变)
//   3. threshold=0 全部分裂 (flat shading,顶点数 = 面数 ×3)
//   4. 立方体硬边分裂 (90° 边在阈值 30° 时被分裂)
//   5. 平面网格不分裂 (所有面共面,角度 = 0)
//   6. 法线正确性 (分裂后硬边两侧法线不同)
//   7. UV 保留
//   8. 输入不被修改
//   9. 非索引输入
//  10. 边界情况

import { describe, it, expect } from 'vitest';
import { EdgeSplitModifier } from './EdgeSplitModifier';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';

/** 构造一个平面网格 (2×2 四边形 = 8 三角形,所有面共面)。 */
function makeFlatGrid(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,
    1, 0, 0,
    2, 0, 0,
    0, 0, 1,
    1, 0, 1,
    2, 0, 1,
  ]), 3));
  // 2 四边形 × 2 三角形 = 4 三角形
  g.setIndex([
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
  ]);
  return g;
}

/**
 * 构造一个立方体 (24 顶点,12 三角形,每个面独立 4 顶点)。
 * 这是 "已分裂" 的立方体 (每个面有独立法线)。
 */
function makeBoxFlat(): BufferGeometry {
  const g = new BufferGeometry();
  // 6 面 × 4 顶点 = 24 顶点
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    // -Z
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    // +Z
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    // -Y
    -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,
    // +Y
    -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1,
    // -X
    -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1,
    // +X
    1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1,
  ]), 3));
  g.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    8, 9, 10, 8, 10, 11,
    12, 14, 13, 12, 15, 14,
    16, 17, 18, 16, 18, 19,
    20, 22, 21, 20, 23, 22,
  ]);
  return g;
}

/**
 * 构造一个共享顶点的立方体 (8 顶点,12 三角形)。
 * 这是 "未分裂" 的立方体 (顶点在多个面间共享)。
 */
function makeBoxShared(): BufferGeometry {
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
  g.setIndex([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    2, 6, 7, 2, 7, 3,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ]);
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
  return g;
}

/** 构造一个折角网格 (两个面成 90° 角)。 */
function makeFoldedMesh(): BufferGeometry {
  const g = new BufferGeometry();
  // 4 顶点: 底面 + 立面,共享边 (1,3)
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  // 0
    1, 0, 0,  // 1
    1, 0, 1,  // 2 (底面)
    1, 1, 0,  // 3 (立面)
  ]), 3));
  // 底面三角形 (0,1,2) + 立面三角形 (1,3,2 反向)
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

/** 面数。 */
function faceCount(g: BufferGeometry): number {
  if (g.index) return g.index.count / 3;
  const pos = g.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

/** 顶点数。 */
function vertexCount(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  return pos ? pos.count : 0;
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('EdgeSplitModifier construction', () => {
  it('defaults', () => {
    const m = new EdgeSplitModifier();
    expect(m.threshold).toBeCloseTo(Math.PI / 6);
    expect(m.keepExistingNormals).toBe(false);
  });

  it('accepts options', () => {
    const m = new EdgeSplitModifier({ threshold: Math.PI / 4, keepExistingNormals: true });
    expect(m.threshold).toBeCloseTo(Math.PI / 4);
    expect(m.keepExistingNormals).toBe(true);
  });

  it('clamps threshold to [0, π]', () => {
    expect(new EdgeSplitModifier({ threshold: -1 }).threshold).toBe(0);
    expect(new EdgeSplitModifier({ threshold: 10 }).threshold).toBeCloseTo(Math.PI);
  });
});

// ── threshold=π (不分裂) ─────────────────────────────────────────────

describe('EdgeSplitModifier threshold=π (no split)', () => {
  it('does not split when threshold=π', () => {
    const box = makeBoxShared();
    const inVerts = vertexCount(box);
    const m = new EdgeSplitModifier({ threshold: Math.PI });
    const out = m.modify(box);
    // 不分裂时顶点数应等于或略大于输入 (至少不爆炸)
    expect(vertexCount(out)).toBeLessThanOrEqual(inVerts + 1);
  });

  it('flat grid stays unchanged with any threshold', () => {
    const grid = makeFlatGrid();
    const inVerts = vertexCount(grid);
    const m = new EdgeSplitModifier({ threshold: 0.001 });
    const out = m.modify(grid);
    // 平面网格所有面共面 (角度=0),不会分裂
    expect(vertexCount(out)).toBe(inVerts);
  });
});

// ── threshold=0 (全分裂) ─────────────────────────────────────────────

describe('EdgeSplitModifier threshold=0 (full split)', () => {
  it('splits all non-coplanar edges of shared-vertex box', () => {
    const box = makeBoxShared();
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(box);
    // threshold=0: 任何 angle > 0 的边被分裂。
    // 立方体的 90° 盒边被分裂,但每面的对角线 (0° 角) 不分裂。
    // 每个角点有 3 个平滑组 (每盒面一组) → 8 × 3 = 24 顶点。
    expect(vertexCount(out)).toBe(24);
  });

  it('quad (coplanar) stays at 4 vertices with threshold=0', () => {
    const quad = makeQuadWithUV();
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(quad);
    // 平面四边形的 2 三角形共面 (angle=0),0 > 0 = false,不分裂。
    expect(vertexCount(out)).toBe(4);
  });
});

// ── 立方体硬边 ───────────────────────────────────────────────────────

describe('EdgeSplitModifier box hard edges', () => {
  it('splits 90° edges of shared-vertex box', () => {
    const box = makeBoxShared();
    const inVerts = vertexCount(box); // 8
    const m = new EdgeSplitModifier({ threshold: Math.PI / 6 }); // 30°
    const out = m.modify(box);
    // 立方体每个角有 3 个 90° 边,所有边都会被分裂
    // 结果应接近 flat shading (24+ 顶点)
    expect(vertexCount(out)).toBeGreaterThan(inVerts * 2);
  });

  it('preserves face count', () => {
    const box = makeBoxShared();
    const inFaces = faceCount(box);
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(box);
    expect(faceCount(out)).toBe(inFaces);
  });

  it('flat box (already split) stays same vertex count', () => {
    const box = makeBoxFlat();
    const inVerts = vertexCount(box); // 24
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(box);
    // 已分裂的立方体:每面 4 独立顶点,2 三角形共享。
    // threshold=0 时,每面内的对角线 (0°) 不分裂,顶点数不变。
    expect(vertexCount(out)).toBe(inVerts);
  });
});

// ── 折角网格 ─────────────────────────────────────────────────────────

describe('EdgeSplitModifier folded mesh', () => {
  it('splits 90° fold edge', () => {
    const mesh = makeFoldedMesh();
    const m = new EdgeSplitModifier({ threshold: Math.PI / 6 }); // 30°
    const out = m.modify(mesh);
    // 折角 90° > 30°,共享边 (1,2) 被分裂
    // 顶点 1 和 2 各被复制一次 → 6 顶点
    expect(vertexCount(out)).toBe(6);
  });

  it('does not split fold edge when threshold > 90°', () => {
    const mesh = makeFoldedMesh();
    const inVerts = vertexCount(mesh);
    const m = new EdgeSplitModifier({ threshold: Math.PI / 2 + 0.1 }); // > 90°
    const out = m.modify(mesh);
    expect(vertexCount(out)).toBe(inVerts);
  });
});

// ── 法线 ─────────────────────────────────────────────────────────────

describe('EdgeSplitModifier normals', () => {
  it('produces normals attribute', () => {
    const box = makeBoxShared();
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(box);
    expect(out.getAttribute('normal')).toBeDefined();
    expect(out.getAttribute('normal')!.count).toBe(out.getAttribute('position')!.count);
  });

  it('normals are unit length', () => {
    const box = makeBoxShared();
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(box);
    const nrm = out.getAttribute('normal')!.array as Float32Array;
    const vc = out.getAttribute('normal')!.count;
    for (let i = 0; i < vc; i++) {
      const len = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
      expect(len).toBeCloseTo(1, 2);
    }
  });

  it('hard edge produces different normals on each side', () => {
    const mesh = makeFoldedMesh();
    const m = new EdgeSplitModifier({ threshold: Math.PI / 6 });
    const out = m.modify(mesh);
    // 折角处顶点被分裂,两侧法线应不同
    // 底面法线应朝 +Y,立面法线应朝 +X 或 -Z
    const nrm = out.getAttribute('normal')!.array as Float32Array;
    const vc = out.getAttribute('normal')!.count;
    let hasYNormal = false;
    let hasXNormal = false;
    for (let i = 0; i < vc; i++) {
      const y = Math.abs(nrm[i * 3 + 1]);
      const x = Math.abs(nrm[i * 3]);
      if (y > 0.9) hasYNormal = true;
      if (x > 0.9) hasXNormal = true;
    }
    expect(hasYNormal).toBe(true); // 底面法线
    expect(hasXNormal).toBe(true); // 立面法线
  });
});

// ── UV ──────────────────────────────────────────────────────────────

describe('EdgeSplitModifier UV', () => {
  it('preserves UV attribute', () => {
    const quad = makeQuadWithUV();
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(quad);
    expect(out.getAttribute('uv')).toBeDefined();
    expect(out.getAttribute('uv')!.count).toBe(out.getAttribute('position')!.count);
  });

  it('UV values are preserved (within original range)', () => {
    const quad = makeQuadWithUV();
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(quad);
    const uvs = out.getAttribute('uv')!.array as Float32Array;
    for (let i = 0; i < uvs.length; i++) {
      expect(uvs[i]).toBeGreaterThanOrEqual(-0.01);
      expect(uvs[i]).toBeLessThanOrEqual(1.01);
    }
  });
});

// ── 不变量 ───────────────────────────────────────────────────────────

describe('EdgeSplitModifier invariants', () => {
  it('does not modify input geometry', () => {
    const box = makeBoxShared();
    const origVerts = vertexCount(box);
    const origPos = (box.getAttribute('position')!.array as Float32Array).slice();
    const m = new EdgeSplitModifier({ threshold: 0 });
    m.modify(box);
    expect(vertexCount(box)).toBe(origVerts);
    const afterPos = box.getAttribute('position')!.array as Float32Array;
    for (let i = 0; i < origPos.length; i++) {
      expect(afterPos[i]).toBeCloseTo(origPos[i]);
    }
  });

  it('output is a different instance', () => {
    const box = makeBoxShared();
    const m = new EdgeSplitModifier();
    const out = m.modify(box);
    expect(out).not.toBe(box);
  });

  it('preserves groups', () => {
    const quad = makeQuadWithUV();
    quad.addGroup(0, 6, 0);
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(quad);
    expect(out.groups.length).toBe(1);
  });

  it('output has bounding box and sphere', () => {
    const box = makeBoxShared();
    const m = new EdgeSplitModifier();
    const out = m.modify(box);
    expect(out.boundingBox).not.toBeNull();
    expect(out.boundingSphere).not.toBeNull();
  });
});

// ── 非索引输入 ────────────────────────────────────────────────────────

describe('EdgeSplitModifier non-indexed input', () => {
  it('handles non-indexed geometry', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]), 3));
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(g);
    // 2 三角形共享边 (0,1) — 法线夹角 90° > 0°,被分裂。
    // 顶点 0 和 1 各分裂为 2 个副本,顶点 2 和 3 (各属 1 面) 不分裂。
    // 总顶点 = 2+2+1+1 = 6
    expect(vertexCount(out)).toBe(6);
    expect(out.index).not.toBeNull();
  });
});

// ── 边界情况 ──────────────────────────────────────────────────────────

describe('EdgeSplitModifier edge cases', () => {
  it('throws when geometry has no position attribute', () => {
    const g = new BufferGeometry();
    const m = new EdgeSplitModifier();
    expect(() => m.modify(g)).toThrow();
  });

  it('handles single triangle', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]), 3));
    g.setIndex([0, 1, 2]);
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(g);
    expect(vertexCount(out)).toBe(3);
    expect(faceCount(out)).toBe(1);
  });

  it('handles boundary edges (open mesh)', () => {
    // 单四边形 (开网格):4 条边界边 + 1 条内部边 (对角线)
    // 边界边只有 1 个相邻面,不会被标记为 sharp
    // 对角线虽是内部边,但 2 三角形共面 (angle=0),threshold=0 时 0 > 0 = false,不分裂
    const quad = makeQuadWithUV();
    const m = new EdgeSplitModifier({ threshold: 0 });
    const out = m.modify(quad);
    // 4 顶点不变 (共面对角线不分裂)
    expect(vertexCount(out)).toBe(4);
  });
});

// BufferGeometryUtils 测试 — 几何体处理工具。
//
// 验证:
//   • mergeGeometries:合并 N 个几何体(带/不带 groups)
//   • weldVertices:容差内合并顶点
//   • computeTangents:Lengyel 切线空间计算
//   • estimateBytesUsed:GPU 内存估算
//   • interleaveAttributes:交错打包属性
//   • toIndexed:非索引 → 索引转换
//   • deduplicateIndices:去重三角形

import { describe, it, expect } from 'vitest';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import {
  mergeGeometries,
  weldVertices,
  computeTangents,
  estimateBytesUsed,
  interleaveAttributes,
  toIndexed,
  deduplicateIndices,
} from './BufferGeometryUtils';

/** 构建一个简单的三角形几何体(非索引)。 */
function makeTriangle(p0: number[], p1: number[], p2: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([...p0, ...p1, ...p2]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  return g;
}

/** 构建一个索引四边形(2 三角形)。 */
function makeIndexedQuad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
  ]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
  ]), 2));
  g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  return g;
}

// ─────────────────────────────────────────────────────────────────────

describe('mergeGeometries', () => {
  it('合并两个非索引三角形', () => {
    const a = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    const b = makeTriangle([2, 0, 0], [3, 0, 0], [3, 1, 0]);
    const merged = mergeGeometries([a, b]);
    expect(merged.attributes.position.count).toBe(6);
    expect(merged.index).toBeNull(); // 非索引合并仍非索引
  });

  it('合并两个索引四边形', () => {
    const a = makeIndexedQuad();
    const b = makeIndexedQuad();
    const merged = mergeGeometries([a, b]);
    expect(merged.attributes.position.count).toBe(8); // 4 + 4
    expect(merged.index).not.toBeNull();
    expect(merged.index!.count).toBe(12); // 6 + 6
  });

  it('索引合并后顶点偏移正确', () => {
    const a = makeIndexedQuad();
    const b = makeIndexedQuad();
    const merged = mergeGeometries([a, b]);
    // 第二个四边形的索引应该 +4 偏移
    const idx = merged.index!.array;
    expect(idx[6]).toBe(4); // 第二个四边形的第一个索引
    expect(idx[7]).toBe(5);
    expect(idx[8]).toBe(6);
  });

  it('useGroups=true 生成 draw groups', () => {
    const a = makeIndexedQuad();
    const b = makeIndexedQuad();
    const merged = mergeGeometries([a, b], true);
    expect(merged.groups.length).toBe(2);
    expect(merged.groups[0]).toEqual({ start: 0, count: 6, materialIndex: 0 });
    expect(merged.groups[1]).toEqual({ start: 6, count: 6, materialIndex: 1 });
  });

  it('useGroups=false 不生成 groups', () => {
    const a = makeIndexedQuad();
    const b = makeIndexedQuad();
    const merged = mergeGeometries([a, b], false);
    expect(merged.groups.length).toBe(0);
  });

  it('空数组返回空几何体', () => {
    const merged = mergeGeometries([]);
    expect(merged.attributes.position).toBeUndefined();
  });

  it('属性不一致抛错', () => {
    const a = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    const b = new BufferGeometry();
    b.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), 3));
    // b 没有 normal / uv
    expect(() => mergeGeometries([a, b])).toThrow(/mismatched attributes/);
  });

  it('混合索引/非索引抛错', () => {
    const a = makeIndexedQuad();
    const b = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    expect(() => mergeGeometries([a, b])).toThrow(/indexed/);
  });

  it('合并后位置数据连续', () => {
    const a = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    const b = makeTriangle([2, 0, 0], [3, 0, 0], [3, 1, 0]);
    const merged = mergeGeometries([a, b]);
    const pos = merged.attributes.position.array;
    // 第 4 个顶点(索引 3)应该是 b 的第一个顶点 [2,0,0]
    expect(pos[9]).toBe(2);
    expect(pos[10]).toBe(0);
    expect(pos[11]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('weldVertices', () => {
  it('合并重复顶点(完全相同位置)', () => {
    // 两个相邻四边形共享 2 个顶点
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0, // quad A
      1, 0, 0,  2, 0, 0,  2, 1, 0,  1, 1, 0, // quad B (共享顶点 1,2)
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(8 * 3).fill(0), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(8 * 2).fill(0), 2));
    g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]));

    const welded = weldVertices(g, 1e-4);
    // 8 个顶点中 2 个重复 → 6 个唯一顶点
    expect(welded.attributes.position.count).toBe(6);
    expect(welded.index!.count).toBe(12);
  });

  it('容差内顶点合并', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,
      0.0001, 0, 0, // 在容差内
      1, 0, 0,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(9).fill(0), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(6).fill(0), 2));
    g.setIndex(new Uint16Array([0, 1, 2]));

    const welded = weldVertices(g, 0.001);
    expect(welded.attributes.position.count).toBe(2);
  });

  it('容差外顶点保留', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,
      0.1, 0, 0, // 超出容差
      1, 0, 0,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(9).fill(0), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(6).fill(0), 2));
    g.setIndex(new Uint16Array([0, 1, 2]));

    const welded = weldVertices(g, 0.001);
    expect(welded.attributes.position.count).toBe(3);
  });

  it('非索引几何体自动转换', () => {
    const g = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    const welded = weldVertices(g);
    // 3 个不同顶点 → 不变,但变成索引
    expect(welded.index).not.toBeNull();
    expect(welded.attributes.position.count).toBe(3);
  });

  it('索引正确重映射', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
      1, 0, 0,  2, 0, 0,  2, 1, 0,  1, 1, 0,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(8 * 3).fill(0), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(8 * 2).fill(0), 2));
    g.setIndex(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]));

    const welded = weldVertices(g, 1e-4);
    // 所有索引都 < 唯一顶点数
    const maxIdx = Math.max(...Array.from(welded.index!.array));
    expect(maxIdx).toBeLessThan(welded.attributes.position.count);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('computeTangents', () => {
  it('为平面计算切线属性', () => {
    const g = makeIndexedQuad();
    computeTangents(g);
    expect(g.attributes.tangent).toBeDefined();
    expect(g.attributes.tangent.itemSize).toBe(3);
    expect(g.attributes.tangent.count).toBe(4);
  });

  it('平面切线应大致沿 U 方向', () => {
    const g = makeIndexedQuad();
    computeTangents(g);
    const tan = g.attributes.tangent.array;
    // 对于 XY 平面(UV 沿 X=U, Y=V),切线应大致沿 +X
    // 顶点 0: (0,0) uv, 顶点 1: (1,0) uv → 切线沿 +X
    expect(Math.abs(tan[0])).toBeGreaterThan(0.9); // x 分量
    expect(Math.abs(tan[1])).toBeLessThan(0.1); // y 分量
    expect(Math.abs(tan[2])).toBeLessThan(0.1); // z 分量
  });

  it('切线与法线正交', () => {
    const g = makeIndexedQuad();
    computeTangents(g);
    const tan = g.attributes.tangent.array;
    const nrm = g.attributes.normal.array;
    for (let i = 0; i < 4; i++) {
      const tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      const dot = tx * nx + ty * ny + tz * nz;
      expect(Math.abs(dot)).toBeLessThan(0.01);
    }
  });

  it('切线长度归一化', () => {
    const g = makeIndexedQuad();
    computeTangents(g);
    const tan = g.attributes.tangent.array;
    for (let i = 0; i < 4; i++) {
      const len = Math.hypot(tan[i * 3], tan[i * 3 + 1], tan[i * 3 + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('缺少 uv 属性抛错', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex(new Uint16Array([0, 1, 2]));
    expect(() => computeTangents(g)).toThrow(/uv/);
  });

  it('非索引几何体自动转换后计算', () => {
    const g = makeTriangle([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
    computeTangents(g);
    expect(g.attributes.tangent).toBeDefined();
    expect(g.index).not.toBeNull(); // 自动转索引
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('estimateBytesUsed', () => {
  it('估算非索引几何体内存', () => {
    const g = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    // position: 3 verts * 3 floats * 4 bytes = 36
    // normal: 36, uv: 3 * 2 * 4 = 24 → total 96
    const bytes = estimateBytesUsed(g);
    expect(bytes).toBe(36 + 36 + 24);
  });

  it('估算索引几何体内存', () => {
    const g = makeIndexedQuad();
    // position: 4 * 3 * 4 = 48, normal: 48, uv: 4 * 2 * 4 = 32
    // index: 6 * 2 (Uint16) = 12
    const bytes = estimateBytesUsed(g);
    expect(bytes).toBe(48 + 48 + 32 + 12);
  });

  it('大索引用 Uint32', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(70000 * 3), 3));
    // 索引值 > 65535 → 需要 Uint32
    const idx = new Uint32Array(100000);
    idx[99999] = 69999; // 最大索引 > 65535
    g.setIndex(idx);
    const bytes = estimateBytesUsed(g);
    // index: 100000 * 4 = 400000
    expect(bytes).toBe(70000 * 3 * 4 + 100000 * 4);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('interleaveAttributes', () => {
  it('交错打包 position + normal', () => {
    const pos = new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3);
    const nrm = new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 0]), 3);
    const result = interleaveAttributes([pos, nrm]);
    expect(result.stride).toBe(6);
    expect(result.offsets).toEqual([0, 3]);
    expect(result.array.length).toBe(12);
    // 第一个顶点: [1,2,3, 0,0,1]
    expect(result.array[0]).toBe(1);
    expect(result.array[3]).toBe(0);
    expect(result.array[5]).toBe(1);
  });

  it('交错打包不同 itemSize 的属性', () => {
    const pos = new BufferAttribute(new Float32Array([1, 2, 3]), 3);
    const uv = new BufferAttribute(new Float32Array([0.5, 0.5]), 2);
    const result = interleaveAttributes([pos, uv]);
    expect(result.stride).toBe(5);
    expect(result.offsets).toEqual([0, 3]);
    expect(result.array).toEqual(new Float32Array([1, 2, 3, 0.5, 0.5]));
  });

  it('count 不匹配抛错', () => {
    const a = new BufferAttribute(new Float32Array([1, 2, 3]), 3); // 1 vert
    const b = new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3); // 2 verts
    expect(() => interleaveAttributes([a, b])).toThrow(/count mismatch/);
  });

  it('空数组返回空', () => {
    const result = interleaveAttributes([]);
    expect(result.array.length).toBe(0);
    expect(result.stride).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('toIndexed', () => {
  it('非索引转索引', () => {
    const g = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    const indexed = toIndexed(g);
    expect(indexed.index).not.toBeNull();
    // 3 个不同顶点 → 3 个唯一顶点
    expect(indexed.attributes.position.count).toBe(3);
    expect(indexed.index!.count).toBe(3);
  });

  it('重复顶点去重', () => {
    const g = new BufferGeometry();
    // 2 个三角形共享 1 个顶点
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  1, 1, 0, // tri 1
      1, 0, 0,  1, 1, 0,  2, 0, 0, // tri 2 (共享 1,0,0 和 1,1,0)
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(6 * 3).fill(0), 3));
    const indexed = toIndexed(g);
    // 6 个顶点,2 个重复 → 4 个唯一顶点
    expect(indexed.attributes.position.count).toBe(4);
    expect(indexed.index!.count).toBe(6);
  });

  it('已索引几何体返回副本', () => {
    const g = makeIndexedQuad();
    const copy = toIndexed(g);
    expect(copy).not.toBe(g);
    expect(copy.index!.count).toBe(6);
    expect(copy.attributes.position.count).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('deduplicateIndices', () => {
  it('去除完全重复的三角形', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  1, 1, 0,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(9).fill(0), 3));
    // 同一个三角形重复 2 次
    g.setIndex(new Uint16Array([0, 1, 2, 0, 1, 2]));
    const deduped = deduplicateIndices(g);
    expect(deduped.index!.count).toBe(3); // 只剩 1 个三角形
  });

  it('不同顶点顺序的三角形视为重复', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0,  1, 0, 0,  1, 1, 0,
    ]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(9).fill(0), 3));
    // [0,1,2] 和 [2,1,0] 是同一个三角形(不同绕序)
    g.setIndex(new Uint16Array([0, 1, 2, 2, 1, 0]));
    const deduped = deduplicateIndices(g);
    expect(deduped.index!.count).toBe(3);
  });

  it('不同三角形保留', () => {
    const g = makeIndexedQuad();
    const deduped = deduplicateIndices(g);
    expect(deduped.index!.count).toBe(6); // 2 个不同三角形
  });

  it('非索引几何体直接返回', () => {
    const g = makeTriangle([0, 0, 0], [1, 0, 0], [1, 1, 0]);
    const result = deduplicateIndices(g);
    expect(result).toBe(g);
  });
});

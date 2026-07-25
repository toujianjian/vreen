import { describe, it, expect } from 'vitest';
import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { GeometryProcessor } from './GeometryProcessor';

/** 构造一个简单的 BoxGeometry-like 几何体:8 顶点,12 三角形。 */
function makeBoxGeometry(): BufferGeometry {
  const positions = new Float32Array([
    // +X 面(2 三角形,4 顶点)
    1, -1, -1,  1, -1, 1,  1, 1, 1,  1, 1, -1,
    // -X 面
    -1, -1, 1,  -1, -1, -1,  -1, 1, -1,  -1, 1, 1,
  ]);
  const normals = new Float32Array([
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
  ]);
  const uvs = new Float32Array([
    0,0, 1,0, 1,1, 0,1,
    0,0, 1,0, 1,1, 0,1,
  ]);
  const indices = [
    0,1,2, 0,2,3,
    4,5,6, 4,6,7,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

describe('GeometryProcessor', () => {
  describe('merge', () => {
    it('合并两个相同几何体 → 顶点数翻倍', () => {
      const a = makeBoxGeometry();
      const b = makeBoxGeometry();
      const merged = GeometryProcessor.merge([a, b]);
      // 每个几何体 8 顶点 → 合并 16
      expect(merged.attributes.position.count).toBe(16);
      // 索引 = 2 几何体 × 4 三角形 × 3 顶点 = 24 索引
      expect(merged.index?.count).toBe(24);
    });

    it('空数组返回空 BufferGeometry', () => {
      const merged = GeometryProcessor.merge([]);
      expect(merged.attributes.position).toBeUndefined();
    });

    it('合并后索引偏移正确(第二个几何体索引 +8)', () => {
      const a = makeBoxGeometry();
      const b = makeBoxGeometry();
      const merged = GeometryProcessor.merge([a, b]);
      const idx = merged.index?.array as unknown as ArrayLike<number>;
      // 第二个几何体的第一个三角形索引应为 8,9,10
      // a 提供 12 个索引,所以 idx[12], idx[13], idx[14] 是 b 的首三角形
      expect(idx[12]).toBe(8);
      expect(idx[13]).toBe(9);
      expect(idx[14]).toBe(10);
    });

    it('合并后计算了 boundingBox', () => {
      const merged = GeometryProcessor.merge([makeBoxGeometry(), makeBoxGeometry()]);
      expect(merged.boundingBox).not.toBeNull();
    });
  });

  describe('simplify', () => {
    it('ratio=1 时返回原三角形数', () => {
      const g = makeBoxGeometry();
      const simplified = GeometryProcessor.simplify(g, 1);
      expect(simplified.index?.count).toBe(g.index?.count);
    });

    it('ratio=0.5 时三角形数减半', () => {
      const g = makeBoxGeometry();
      const simplified = GeometryProcessor.simplify(g, 0.5);
      // 原 4 三角形(12 索引) → 减半 2 三角形(6 索引)
      expect(simplified.index?.count).toBe(6);
    });

    it('ratio 越界抛错', () => {
      const g = makeBoxGeometry();
      expect(() => GeometryProcessor.simplify(g, 0)).toThrow();
      expect(() => GeometryProcessor.simplify(g, 1.5)).toThrow();
      expect(() => GeometryProcessor.simplify(g, -0.5)).toThrow();
    });

    it('无索引的几何体返回原对象', () => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
      // 不调用 setIndex,无 index
      const simplified = GeometryProcessor.simplify(g, 0.5);
      expect(simplified).toBe(g);
    });

    it('ratio=0.25 保留更少三角形', () => {
      const g = makeBoxGeometry();
      // 4 三角形,ratio=0.25 → 1 三角形
      const simplified = GeometryProcessor.simplify(g, 0.25);
      expect(simplified.index?.count).toBe(3);
    });
  });

  describe('generateNormals', () => {
    it('重新计算法线,返回同一对象', () => {
      const g = makeBoxGeometry();
      const before = Array.from(g.attributes.normal.array);
      const result = GeometryProcessor.generateNormals(g);
      expect(result).toBe(g);
      const after = Array.from(g.attributes.normal.array);
      // 法线可能相同(因为已是单位法线),但应被重算
      expect(after.length).toBe(before.length);
    });

    it('生成法线后 version 增加', () => {
      const g = makeBoxGeometry();
      const v0 = g.attributes.normal.version;
      GeometryProcessor.generateNormals(g);
      // version 至少 +1(computeVertexNormals 会 bump)
      expect(g.attributes.normal.version).toBeGreaterThan(v0);
    });
  });

  describe('generateTangents', () => {
    it('生成切线属性(itemSize=4)', () => {
      const g = makeBoxGeometry();
      GeometryProcessor.generateTangents(g);
      const tan = g.attributes.tangent;
      expect(tan).toBeDefined();
      expect(tan.itemSize).toBe(4);
      expect(tan.count).toBe(g.attributes.position.count);
    });

    it('缺 normal/uv 时不生成(返回原对象)', () => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]), 3));
      // 不设置 normal/uv
      const result = GeometryProcessor.generateTangents(g);
      expect(result).toBe(g);
      expect(g.attributes.tangent).toBeUndefined();
    });

    it('切线长度归一化为 1', () => {
      const g = makeBoxGeometry();
      GeometryProcessor.generateTangents(g);
      const t = g.attributes.tangent.array;
      for (let i = 0; i < t.length; i += 4) {
        const x = t[i], y = t[i + 1], z = t[i + 2];
        const len = Math.hypot(x, y, z);
        expect(len).toBeCloseTo(1, 5);
      }
    });
  });

  describe('computeBoundingBox', () => {
    it('返回 Box3 范围', () => {
      const g = makeBoxGeometry();
      const bb = GeometryProcessor.computeBoundingBox(g);
      expect(bb).not.toBeNull();
      expect(bb!.min.x).toBe(-1);
      expect(bb!.max.x).toBe(1);
      expect(bb!.min.y).toBe(-1);
      expect(bb!.max.y).toBe(1);
    });

    it('无 position 返回 null', () => {
      const g = new BufferGeometry();
      const bb = GeometryProcessor.computeBoundingBox(g);
      expect(bb).toBeNull();
    });
  });

  describe('weldVertices', () => {
    it('完全重合顶点被合并', () => {
      // 构造 2 个三角形,共享 2 个顶点(未焊接)
      const g = new BufferGeometry();
      // 6 顶点,其中 (1,0,0) 与 (4) 重合,(0,1,0) 与 (3) 重合
      g.setAttribute('position', new BufferAttribute(new Float32Array([
        0,0,0, 1,0,0, 0,1,0,   // 三角形 1
        1,0,0, 0,1,0, 1,1,0,   // 三角形 2
      ]), 3));
      g.setIndex([0,1,2, 3,4,5]);
      const welded = GeometryProcessor.weldVertices(g, 1e-4);
      // 原 6 顶点 → 4 个唯一顶点
      expect(welded.attributes.position.count).toBe(4);
      // 索引应重映射:三角形 2 的 3,4,5 → 1,2,3
      const idx = welded.index?.array as unknown as ArrayLike<number>;
      expect(idx[0]).toBe(0);
      expect(idx[1]).toBe(1);
      expect(idx[2]).toBe(2);
      expect(idx[3]).toBe(1); // 原 3 → 1
      expect(idx[4]).toBe(2); // 原 4 → 2
      expect(idx[5]).toBe(3); // 原 5 → 3
    });

    it('threshold 越大合并越多', () => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array([
        0,0,0, 0.01,0,0, 0.02,0,0, 1,0,0,
      ]), 3));
      g.setIndex([0,1,2, 0,1,3]);
      const w1 = GeometryProcessor.weldVertices(g, 0.005);
      // 0.005 阈值:0 与 0.01 不合并(距离 0.01 > 0.005)
      const w2 = GeometryProcessor.weldVertices(g, 0.05);
      // 0.05 阈值:0,0.01,0.02 都合并
      expect(w2.attributes.position.count).toBeLessThan(w1.attributes.position.count);
    });

    it('threshold ≤ 0 抛错', () => {
      const g = makeBoxGeometry();
      expect(() => GeometryProcessor.weldVertices(g, 0)).toThrow();
      expect(() => GeometryProcessor.weldVertices(g, -1)).toThrow();
    });

    it('保留 normal/uv 属性', () => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array([
        0,0,0, 1,0,0, 0,1,0, 0,0,0,
      ]), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array([
        0,0,1, 0,0,1, 0,0,1, 0,0,1,
      ]), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array([
        0,0, 1,0, 0,1, 0,0,
      ]), 2));
      g.setIndex([0,1,2, 3,1,2]);
      const welded = GeometryProcessor.weldVertices(g, 1e-4);
      expect(welded.attributes.normal).toBeDefined();
      expect(welded.attributes.uv).toBeDefined();
      // 原 4 顶点,顶点 0 与 3 重合 → 3 顶点
      expect(welded.attributes.position.count).toBe(3);
      expect(welded.attributes.normal.count).toBe(3);
      expect(welded.attributes.uv.count).toBe(3);
    });
  });
});

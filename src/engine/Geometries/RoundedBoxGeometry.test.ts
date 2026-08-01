// RoundedBoxGeometry 单元测试 (圆角盒子几何体)。
//
// 覆盖:
//   1. 构造默认值 + 自定义参数
//   2. 顶点数 = (segments+1)² × 6
//   3. 三角形数 = segments² × 6 × 2
//   4. 包围盒尺寸 ≈ (width, height, depth)
//   5. radius 不超过 min(w,h,d)/2
//   6. radius=0 时退化为普通盒子
//   7. 法线为单位向量
//   8. 面中心顶点法线 = 面法线
//   9. 角顶点被圆角(距角点 < radius)
//  10. UV 范围 [0,1]

import { describe, it, expect } from 'vitest';
import { RoundedBoxGeometry } from './RoundedBoxGeometry';

describe('RoundedBoxGeometry construction', () => {
  it('defaults: 1x1x1, 2 segments, 0.1 radius', () => {
    const g = new RoundedBoxGeometry();
    const pos = g.getAttribute('position')!;
    expect(pos.count).toBe(3 * 3 * 6); // (2+1)² × 6 = 54
    expect(g.boundingBox).toBeDefined();
  });

  it('custom parameters', () => {
    const g = new RoundedBoxGeometry(2, 3, 4, 4, 0.5);
    const pos = g.getAttribute('position')!;
    expect(pos.count).toBe(5 * 5 * 6); // (4+1)² × 6 = 150
  });

  it('radius is clamped to min(w,h,d)/2', () => {
    const g = new RoundedBoxGeometry(1, 2, 3, 2, 10); // radius=10 too big
    const bb = g.boundingBox!;
    // radius should be clamped to 0.5 (min(1,2,3)/2)
    // Box should still be ~1x2x3
    expect(bb.max.x - bb.min.x).toBeCloseTo(1, 1);
    expect(bb.max.y - bb.min.y).toBeCloseTo(2, 1);
    expect(bb.max.z - bb.min.z).toBeCloseTo(3, 1);
  });
});

describe('RoundedBoxGeometry vertex count', () => {
  it('vertex count = (segments+1)² × 6', () => {
    for (const seg of [1, 2, 4, 8]) {
      const g = new RoundedBoxGeometry(1, 1, 1, seg, 0.1);
      const pos = g.getAttribute('position')!;
      expect(pos.count).toBe((seg + 1) * (seg + 1) * 6);
    }
  });

  it('triangle count = segments² × 6 × 2', () => {
    for (const seg of [1, 2, 4]) {
      const g = new RoundedBoxGeometry(1, 1, 1, seg, 0.1);
      const index = g.index!;
      expect(index.count / 3).toBe(seg * seg * 6 * 2);
    }
  });
});

describe('RoundedBoxGeometry bounding box', () => {
  it('bounding box ≈ (width, height, depth)', () => {
    const g = new RoundedBoxGeometry(2, 4, 6, 4, 0.3);
    const bb = g.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(2, 1);
    expect(bb.max.y - bb.min.y).toBeCloseTo(4, 1);
    expect(bb.max.z - bb.min.z).toBeCloseTo(6, 1);
  });

  it('bounding box centered at origin', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 4, 0.2);
    const bb = g.boundingBox!;
    expect(Math.abs(bb.min.x + bb.max.x)).toBeLessThan(0.01);
    expect(Math.abs(bb.min.y + bb.max.y)).toBeLessThan(0.01);
    expect(Math.abs(bb.min.z + bb.max.z)).toBeLessThan(0.01);
  });
});

describe('RoundedBoxGeometry radius=0', () => {
  it('degenerates to sharp box (corners at ±half)', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 4, 0);
    const pos = g.getAttribute('position')!.array as Float32Array;

    // Should have vertices at exact corners (±1, ±1, ±1)
    let hasCorner = false;
    for (let i = 0; i < pos.length; i += 3) {
      if (
        Math.abs(pos[i] - 1) < 0.01 &&
        Math.abs(pos[i + 1] - 1) < 0.01 &&
        Math.abs(pos[i + 2] - 1) < 0.01
      ) {
        hasCorner = true;
        break;
      }
    }
    expect(hasCorner).toBe(true);
  });
});

describe('RoundedBoxGeometry normals', () => {
  it('all normals are unit length', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 4, 0.3);
    const nrm = g.getAttribute('normal')!.array as Float32Array;
    for (let i = 0; i < nrm.length; i += 3) {
      const len = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
      expect(len).toBeCloseTo(1, 3);
    }
  });

  it('face center normal = face normal', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 4, 0.2);
    const pos = g.getAttribute('position')!.array as Float32Array;
    const nrm = g.getAttribute('normal')!.array as Float32Array;

    // Find a vertex near +X face center (x ≈ 1, y ≈ 0, z ≈ 0)
    let found = false;
    for (let i = 0; i < pos.length; i += 3) {
      if (
        Math.abs(pos[i] - 1) < 0.15 &&
        Math.abs(pos[i + 1]) < 0.15 &&
        Math.abs(pos[i + 2]) < 0.15
      ) {
        // Normal should be ≈ (1, 0, 0)
        expect(nrm[i]).toBeCloseTo(1, 1);
        expect(Math.abs(nrm[i + 1])).toBeLessThan(0.2);
        expect(Math.abs(nrm[i + 2])).toBeLessThan(0.2);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe('RoundedBoxGeometry corner rounding', () => {
  it('corner vertices are rounded (no vertex at exact corner)', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 4, 0.3);
    const pos = g.getAttribute('position')!.array as Float32Array;
    const radius = 0.3;

    // No vertex should be at the exact corner (1, 1, 1)
    for (let i = 0; i < pos.length; i += 3) {
      const dist = Math.hypot(
        pos[i] - 1,
        pos[i + 1] - 1,
        pos[i + 2] - 1,
      );
      // If a vertex is near the corner, it should be pushed inward by rounding
      // (distance from corner > 0)
      if (dist < radius * 0.5) {
        // It should have been rounded
        expect(dist).toBeGreaterThan(0.01);
      }
    }
  });

  it('rounded corner stays within bounding box', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 8, 0.4);
    const pos = g.getAttribute('position')!.array as Float32Array;

    for (let i = 0; i < pos.length; i += 3) {
      expect(pos[i]).toBeLessThanOrEqual(1 + 1e-6);
      expect(pos[i]).toBeGreaterThanOrEqual(-1 - 1e-6);
      expect(pos[i + 1]).toBeLessThanOrEqual(1 + 1e-6);
      expect(pos[i + 1]).toBeGreaterThanOrEqual(-1 - 1e-6);
      expect(pos[i + 2]).toBeLessThanOrEqual(1 + 1e-6);
      expect(pos[i + 2]).toBeGreaterThanOrEqual(-1 - 1e-6);
    }
  });
});

describe('RoundedBoxGeometry UVs', () => {
  it('UVs are in [0, 1] range', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 4, 0.2);
    const uvs = g.getAttribute('uv')!.array as Float32Array;
    for (let i = 0; i < uvs.length; i++) {
      expect(uvs[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(uvs[i]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('has correct UV count (2 per vertex)', () => {
    const g = new RoundedBoxGeometry(1, 1, 1, 2, 0.1);
    const uvs = g.getAttribute('uv')!;
    const pos = g.getAttribute('position')!;
    expect(uvs.count).toBe(pos.count);
    expect(uvs.itemSize).toBe(2);
  });
});

describe('RoundedBoxGeometry attributes', () => {
  it('has position, normal, uv attributes', () => {
    const g = new RoundedBoxGeometry();
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('normal')).toBeDefined();
    expect(g.getAttribute('uv')).toBeDefined();
  });

  it('has index buffer', () => {
    const g = new RoundedBoxGeometry();
    expect(g.index).not.toBeNull();
    expect(g.index!.count).toBeGreaterThan(0);
  });

  it('has bounding sphere', () => {
    const g = new RoundedBoxGeometry(2, 2, 2, 4, 0.2);
    expect(g.boundingSphere).toBeDefined();
    expect(g.boundingSphere!.radius).toBeGreaterThan(0);
  });
});

// ImprovedNoise 单元测试 (Ken Perlin 改进噪声)。
//
// 覆盖:
//   1. 确定性: 相同输入 → 相同输出
//   2. 输出范围约 [-1, 1]
//   3. 整数坐标输出为 0(格点中心)
//   4. 平滑性: 相近输入 → 相近输出
//   5. noise2D / noise1D 一致性
//   6. fBm: 更高倍频 → 更多细节
//   7. fBm: 振幅归一化
//   8. 周期性: 整数偏移不改变结果(平铺)

import { describe, it, expect } from 'vitest';
import { ImprovedNoise } from './ImprovedNoise';

describe('ImprovedNoise determinism', () => {
  it('same input → same output', () => {
    const n1 = new ImprovedNoise();
    const n2 = new ImprovedNoise();
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * 10;
      const y = Math.random() * 10;
      const z = Math.random() * 10;
      expect(n1.noise(x, y, z)).toBe(n2.noise(x, y, z));
    }
  });
});

describe('ImprovedNoise range', () => {
  it('output is roughly in [-1, 1]', () => {
    const n = new ImprovedNoise();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 1000; i++) {
      const v = n.noise(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1.5);
    expect(max).toBeLessThanOrEqual(1.5);
  });
});

describe('ImprovedNoise grid points', () => {
  it('integer coordinates produce ~0', () => {
    const n = new ImprovedNoise();
    for (let i = 0; i < 5; i++) {
      const v = n.noise(i, i * 2, i * 3);
      expect(Math.abs(v)).toBeLessThan(0.01);
    }
  });
});

describe('ImprovedNoise smoothness', () => {
  it('close inputs → close outputs', () => {
    const n = new ImprovedNoise();
    const x = 5.0;
    const v0 = n.noise(x, 0, 0);
    const v1 = n.noise(x + 0.001, 0, 0);
    expect(Math.abs(v1 - v0)).toBeLessThan(0.01);
  });

  it('noise is continuous (no discontinuities)', () => {
    const n = new ImprovedNoise();
    let prev = n.noise(0, 0, 0);
    for (let i = 1; i <= 100; i++) {
      const curr = n.noise(i * 0.1, 0, 0);
      expect(Math.abs(curr - prev)).toBeLessThan(0.5);
      prev = curr;
    }
  });
});

describe('ImprovedNoise noise2D / noise1D', () => {
  it('noise2D(x, y) = noise(x, y, 0)', () => {
    const n = new ImprovedNoise();
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * 5;
      const y = Math.random() * 5;
      expect(n.noise2D(x, y)).toBeCloseTo(n.noise(x, y, 0), 10);
    }
  });

  it('noise1D(x) = noise(x, 0, 0)', () => {
    const n = new ImprovedNoise();
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * 5;
      expect(n.noise1D(x)).toBeCloseTo(n.noise(x, 0, 0), 10);
    }
  });
});

describe('ImprovedNoise fbm', () => {
  it('higher octaves → more detail (different values)', () => {
    const n = new ImprovedNoise();
    const x = 3.7, y = 2.1, z = 1.5;
    const low = n.fbm(x, y, z, 1);
    const high = n.fbm(x, y, z, 6);
    expect(low).not.toBeCloseTo(high, 3);
  });

  it('fbm output is normalized (amplitude sum)', () => {
    const n = new ImprovedNoise();
    for (let i = 0; i < 10; i++) {
      const v = n.fbm(Math.random() * 5, Math.random() * 5, Math.random() * 5, 4);
      expect(v).toBeGreaterThanOrEqual(-1.5);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });

  it('fbm2D matches fbm with z=0', () => {
    const n = new ImprovedNoise();
    const x = 2.3, y = 4.1;
    expect(n.fbm2D(x, y, 4, 0.5, 2.0)).toBeCloseTo(n.fbm(x, y, 0, 4, 0.5, 2.0), 10);
  });
});

describe('ImprovedNoise periodicity', () => {
  it('256-unit offset produces same result (permutation table wraps)', () => {
    const n = new ImprovedNoise();
    const x = 3.7, y = 2.1, z = 1.5;
    // 排列表 256 字节循环,所以 +256 应该产生相同结果
    expect(n.noise(x + 256, y, z)).toBeCloseTo(n.noise(x, y, z), 10);
    expect(n.noise(x, y + 256, z)).toBeCloseTo(n.noise(x, y, z), 10);
    expect(n.noise(x, y, z + 256)).toBeCloseTo(n.noise(x, y, z), 10);
  });
});

describe('ImprovedNoise statistical properties', () => {
  it('mean is approximately 0', () => {
    const n = new ImprovedNoise();
    let sum = 0;
    const count = 10000;
    for (let i = 0; i < count; i++) {
      sum += n.noise(Math.random() * 100, Math.random() * 100, Math.random() * 100);
    }
    const mean = sum / count;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });

  it('values are distributed (not all same)', () => {
    const n = new ImprovedNoise();
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(Math.round(n.noise(i * 0.1, 0, 0) * 1000));
    }
    expect(values.size).toBeGreaterThan(10);
  });
});

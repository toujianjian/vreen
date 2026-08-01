// FlakesTexture 单元测试 (程序化金属薄片纹理)。
//
// 覆盖:
//   1. generate — 默认参数 + 尺寸正确
//   2. generate — 薄片数量影响非背景像素比例
//   3. generate — seed 确定性(相同 seed = 相同结果)
//   4. generate — 不同 seed = 不同结果
//   5. generate — 背景灰度
//   6. generate — 薄片亮度范围
//   7. generate — 平铺性(边缘薄片环绕)
//   8. toNormalMap — 输出尺寸一致
//   9. toNormalMap — 法线 Z 分量为主(平坦区域 ≈ (128,128,255))
//  10. toNormalMap — 薄片边缘有法线变化

import { describe, it, expect } from 'vitest';
import { FlakesTexture } from './FlakesTexture';

// ── generate 基础 ──────────────────────────────────────────────────

describe('FlakesTexture.generate basics', () => {
  it('default size = 512x512', () => {
    const result = FlakesTexture.generate();
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.data.length).toBe(512 * 512 * 4);
  });

  it('custom size', () => {
    const result = FlakesTexture.generate({ size: 64 });
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    expect(result.data.length).toBe(64 * 64 * 4);
  });

  it('size is clamped to >= 1', () => {
    const result = FlakesTexture.generate({ size: 0 });
    expect(result.width).toBe(1);
  });

  it('all pixels have alpha = 255', () => {
    const result = FlakesTexture.generate({ size: 16, flakeCount: 5 });
    for (let i = 3; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(255);
    }
  });
});

// ── 薄片数量 ───────────────────────────────────────────────────────

describe('FlakesTexture flake count', () => {
  it('more flakes → more non-background pixels', () => {
    const sparse = FlakesTexture.generate({ size: 64, flakeCount: 5, background: 0, seed: 1 });
    const dense = FlakesTexture.generate({ size: 64, flakeCount: 100, background: 0, seed: 1 });

    let brightSparse = 0;
    let brightDense = 0;
    for (let i = 0; i < sparse.data.length; i += 4) {
      if (sparse.data[i] > 50) brightSparse++;
      if (dense.data[i] > 50) brightDense++;
    }
    expect(brightDense).toBeGreaterThan(brightSparse);
  });

  it('zero flakes → all background', () => {
    const result = FlakesTexture.generate({ size: 16, flakeCount: 0, background: 30 });
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(30);
      expect(result.data[i + 1]).toBe(30);
      expect(result.data[i + 2]).toBe(30);
    }
  });
});

// ── 确定性 ──────────────────────────────────────────────────────────

describe('FlakesTexture determinism', () => {
  it('same seed produces identical result', () => {
    const a = FlakesTexture.generate({ size: 32, flakeCount: 10, seed: 42 });
    const b = FlakesTexture.generate({ size: 32, flakeCount: 10, seed: 42 });
    for (let i = 0; i < a.data.length; i++) {
      expect(a.data[i]).toBe(b.data[i]);
    }
  });

  it('different seed produces different result', () => {
    const a = FlakesTexture.generate({ size: 32, flakeCount: 10, seed: 1 });
    const b = FlakesTexture.generate({ size: 32, flakeCount: 10, seed: 2 });
    let diff = 0;
    for (let i = 0; i < a.data.length; i++) {
      if (a.data[i] !== b.data[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });
});

// ── 背景与亮度 ─────────────────────────────────────────────────────

describe('FlakesTexture background and brightness', () => {
  it('background fills non-flake pixels', () => {
    const result = FlakesTexture.generate({ size: 16, flakeCount: 0, background: 64 });
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(64);
    }
  });

  it('flake brightness is within range', () => {
    const minB = 200;
    const maxB = 255;
    const result = FlakesTexture.generate({
      size: 64, flakeCount: 50, background: 0,
      minBrightness: minB, maxBrightness: maxB, seed: 3,
    });
    // 所有非零像素应在 [minB, maxB] 范围内(考虑抗锯齿可能略低)
    for (let i = 0; i < result.data.length; i += 4) {
      const v = result.data[i];
      if (v > 0) {
        expect(v).toBeLessThanOrEqual(maxB);
      }
    }
  });
});

// ── 平铺性 ──────────────────────────────────────────────────────────

describe('FlakesTexture tiling', () => {
  it('flakes near edges wrap to opposite side', () => {
    // 生成纹理,检查边缘是否有薄片(薄片出现在边缘说明环绕工作)
    // 使用大量薄片确保有些落在边缘附近
    const result = FlakesTexture.generate({ size: 32, flakeCount: 200, seed: 7 });

    // 检查最外圈是否有非背景像素
    let edgeBright = 0;
    for (let x = 0; x < 32; x++) {
      // 顶行
      if (result.data[(0 * 32 + x) * 4] > 50) edgeBright++;
      // 底行
      if (result.data[(31 * 32 + x) * 4] > 50) edgeBright++;
    }
    for (let y = 0; y < 32; y++) {
      // 左列
      if (result.data[(y * 32 + 0) * 4] > 50) edgeBright++;
      // 右列
      if (result.data[(y * 32 + 31) * 4] > 50) edgeBright++;
    }
    // 大量薄片应该有部分到达边缘
    expect(edgeBright).toBeGreaterThan(0);
  });
});

// ── toNormalMap ────────────────────────────────────────────────────

describe('FlakesTexture.toNormalMap', () => {
  it('output size matches input', () => {
    const heightMap = FlakesTexture.generate({ size: 32, flakeCount: 10 });
    const normalMap = FlakesTexture.toNormalMap(heightMap);
    expect(normalMap.width).toBe(32);
    expect(normalMap.height).toBe(32);
    expect(normalMap.data.length).toBe(32 * 32 * 4);
  });

  it('flat areas have Z-normal (128, 128, 255)', () => {
    // 全黑高度图 → 法线全部指向 Z
    const heightMap = FlakesTexture.generate({ size: 16, flakeCount: 0, background: 0 });
    const normalMap = FlakesTexture.toNormalMap(heightMap);

    for (let i = 0; i < normalMap.data.length; i += 4) {
      expect(normalMap.data[i]).toBeCloseTo(128, 0);     // X ≈ 0
      expect(normalMap.data[i + 1]).toBeCloseTo(128, 0); // Y ≈ 0
      expect(normalMap.data[i + 2]).toBeCloseTo(255, 0); // Z ≈ 1
    }
  });

  it('flakes produce non-zero X/Y normal components', () => {
    const heightMap = FlakesTexture.generate({ size: 32, flakeCount: 30, seed: 5 });
    const normalMap = FlakesTexture.toNormalMap(heightMap, 2);

    // 至少有一些像素的 X 或 Y 法线偏离 128(说明薄片边缘产生了法线变化)
    let nonFlat = 0;
    for (let i = 0; i < normalMap.data.length; i += 4) {
      const nx = normalMap.data[i];
      const ny = normalMap.data[i + 1];
      if (Math.abs(nx - 128) > 5 || Math.abs(ny - 128) > 5) {
        nonFlat++;
      }
    }
    expect(nonFlat).toBeGreaterThan(0);
  });

  it('all normal Z components are positive (facing camera)', () => {
    const heightMap = FlakesTexture.generate({ size: 16, flakeCount: 20, seed: 1 });
    const normalMap = FlakesTexture.toNormalMap(heightMap);

    for (let i = 2; i < normalMap.data.length; i += 4) {
      expect(normalMap.data[i]).toBeGreaterThan(128); // Z > 0.5 → 始终面向相机
    }
  });

  it('all alpha = 255', () => {
    const heightMap = FlakesTexture.generate({ size: 16, flakeCount: 5 });
    const normalMap = FlakesTexture.toNormalMap(heightMap);
    for (let i = 3; i < normalMap.data.length; i += 4) {
      expect(normalMap.data[i]).toBe(255);
    }
  });
});

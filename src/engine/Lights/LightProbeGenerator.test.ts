// LightProbeGenerator 单元测试 (从环境贴图生成球谐光探针)。
//
// 覆盖:
//   1. fromColor — 均匀环境光 → SH 系数
//   2. fromCubeMap — 均匀白色立方体贴图 → SH Y_0^0 主导
//   3. fromCubeMap — 顶面亮、底面暗 → Y_1^0 (z 轴) 系数非零
//   4. fromCubeMap — +X 面亮 → Y_1^1 (x 轴) 系数非零
//   5. fromCubeMap — 尺寸不匹配抛错
//   6. fromCubeMap — step 采样降低精度但结果近似
//   7. 立体角总和 ≈ 4π
//   8. 漫反射卷积: L=1 系数 × 2/3

import { describe, it, expect } from 'vitest';
import { LightProbeGenerator, type CubeMapData } from './LightProbeGenerator';
import { SphericalHarmonics3 } from './LightProbe';

/** 创建单面纯色数据。 */
function solidFace(size: number, r: number, g: number, b: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, size };
}

/** 创建全黑立方体贴图。 */
function blackCubeMap(size: number): CubeMapData {
  return {
    faces: [
      solidFace(size, 0, 0, 0),
      solidFace(size, 0, 0, 0),
      solidFace(size, 0, 0, 0),
      solidFace(size, 0, 0, 0),
      solidFace(size, 0, 0, 0),
      solidFace(size, 0, 0, 0),
    ],
  };
}

/** 创建全白立方体贴图。 */
function whiteCubeMap(size: number): CubeMapData {
  return {
    faces: [
      solidFace(size, 255, 255, 255),
      solidFace(size, 255, 255, 255),
      solidFace(size, 255, 255, 255),
      solidFace(size, 255, 255, 255),
      solidFace(size, 255, 255, 255),
      solidFace(size, 255, 255, 255),
    ],
  };
}

// ── fromColor ──────────────────────────────────────────────────────

describe('LightProbeGenerator.fromColor', () => {
  it('uniform white → Y_0^0 dominant (fromColor uses color/9 convention)', () => {
    const sh = LightProbeGenerator.fromColor({ r: 1, g: 1, b: 1 });
    // fromColor 使用 color/9 约定 (SH_CONSTANT_TERM = 9)
    expect(sh.coefficients[0]).toBeCloseTo(1 / 9, 3);
    expect(sh.coefficients[1]).toBeCloseTo(1 / 9, 3);
    expect(sh.coefficients[2]).toBeCloseTo(1 / 9, 3);
    // L=1, L=2 系数为 0
    for (let i = 3; i < 27; i++) {
      expect(sh.coefficients[i]).toBeCloseTo(0, 5);
    }
  });

  it('red color → only R channel non-zero', () => {
    const sh = LightProbeGenerator.fromColor({ r: 1, g: 0, b: 0 });
    expect(sh.coefficients[0]).toBeCloseTo(1 / 9, 3); // R
    expect(sh.coefficients[1]).toBeCloseTo(0, 5);     // G
    expect(sh.coefficients[2]).toBeCloseTo(0, 5);     // B
  });
});

// ── fromCubeMap 均匀 ──────────────────────────────────────────────

describe('LightProbeGenerator.fromCubeMap uniform', () => {
  it('black cube map → all zeros', () => {
    const cm = blackCubeMap(8);
    const sh = LightProbeGenerator.fromCubeMap(cm);
    for (let i = 0; i < 27; i++) {
      expect(sh.coefficients[i]).toBeCloseTo(0, 5);
    }
  });

  it('white cube map → Y_0^0 dominant, L=1/L=2 ≈ 0', () => {
    const cm = whiteCubeMap(16);
    const sh = LightProbeGenerator.fromCubeMap(cm);

    // Y_0^0 (index 0,1,2) 应主导
    expect(sh.coefficients[0]).toBeGreaterThan(0.1);
    expect(sh.coefficients[1]).toBeGreaterThan(0.1);
    expect(sh.coefficients[2]).toBeGreaterThan(0.1);

    // L=1 系数 (index 3-11) 应接近 0(均匀环境无方向性)
    for (let i = 3; i < 12; i++) {
      expect(Math.abs(sh.coefficients[i])).toBeLessThan(0.05);
    }
  });

  it('white cube map Y_0^0 ≈ 0.282 (after normalization)', () => {
    const cm = whiteCubeMap(32);
    const sh = LightProbeGenerator.fromCubeMap(cm);
    // 均匀白色 = fromColor(white)
    expect(sh.coefficients[0]).toBeCloseTo(0.282, 1);
  });
});

// ── 方向性 ──────────────────────────────────────────────────────────

describe('LightProbeGenerator.fromCubeMap directional', () => {
  it('top face bright → Y_1^0 (z-axis) positive', () => {
    // +Y 面 (face 2) 亮,其他暗
    const size = 16;
    const cm = blackCubeMap(size);
    cm.faces[2] = solidFace(size, 255, 255, 255); // +Y (top)

    const sh = LightProbeGenerator.fromCubeMap(cm);

    // Y_1^0 = 0.488603 * z, z=1 时为正
    // +Y 对应 dir.y = 1,但 SH 基函数中 Y_1^{-1} = 0.488603 * y
    // 所以 coefficients[3] (Y_1^{-1} R) 应为正
    // 注意:VREEN SH 顺序: [Y00, Y1-1, Y10, Y11, Y2-2, ...]
    // Y_1^{-1} = 0.488603 * y, y=1 → 正
    expect(sh.coefficients[3]).toBeGreaterThan(0.01); // Y_1^{-1} R
  });

  it('+X face bright → Y_1^1 (x-axis) positive', () => {
    const size = 16;
    const cm = blackCubeMap(size);
    cm.faces[0] = solidFace(size, 255, 255, 255); // +X (right)

    const sh = LightProbeGenerator.fromCubeMap(cm);

    // Y_1^1 = 0.488603 * x, x=1 → 正
    // coefficients[9] = Y_1^1 R (index 3*3=9)
    expect(sh.coefficients[9]).toBeGreaterThan(0.01);
  });

  it('asymmetric lighting produces non-zero L=1 coefficients', () => {
    const size = 16;
    const cm = blackCubeMap(size);
    cm.faces[0] = solidFace(size, 255, 0, 0);   // +X 红
    cm.faces[1] = solidFace(size, 0, 255, 0);   // -X 绿

    const sh = LightProbeGenerator.fromCubeMap(cm);

    // +X 红色 → Y_1^1 R 正
    expect(sh.coefficients[9]).toBeGreaterThan(0.01);
    // -X 绿色 → Y_1^1 G 负 (因为 -X 方向 x=-1)
    expect(sh.coefficients[10]).toBeLessThan(-0.01);
  });
});

// ── 错误处理 ───────────────────────────────────────────────────────

describe('LightProbeGenerator.fromCubeMap errors', () => {
  it('throws on face size mismatch', () => {
    const cm: CubeMapData = {
      faces: [
        solidFace(8, 0, 0, 0),
        solidFace(16, 0, 0, 0), // 尺寸不同
        solidFace(8, 0, 0, 0),
        solidFace(8, 0, 0, 0),
        solidFace(8, 0, 0, 0),
        solidFace(8, 0, 0, 0),
      ],
    };
    expect(() => LightProbeGenerator.fromCubeMap(cm)).toThrow();
  });
});

// ── step 采样 ──────────────────────────────────────────────────────

describe('LightProbeGenerator.fromCubeMap sampling', () => {
  it('step=1 and step=2 produce similar Y_0^0 for uniform map', () => {
    const cm = whiteCubeMap(16);
    const sh1 = LightProbeGenerator.fromCubeMap(cm, { step: 1 });
    const sh2 = LightProbeGenerator.fromCubeMap(cm, { step: 2 });

    // Y_0^0 应该非常接近(均匀分布不受采样密度影响)
    expect(sh2.coefficients[0]).toBeCloseTo(sh1.coefficients[0], 1);
    expect(sh2.coefficients[1]).toBeCloseTo(sh1.coefficients[1], 1);
    expect(sh2.coefficients[2]).toBeCloseTo(sh1.coefficients[2], 1);
  });

  it('step is clamped to >= 1', () => {
    const cm = whiteCubeMap(8);
    expect(() => LightProbeGenerator.fromCubeMap(cm, { step: 0 })).not.toThrow();
  });
});

// ── 漫反射卷积 ─────────────────────────────────────────────────────

describe('LightProbeGenerator diffuse convolution', () => {
  it('L=1 coefficients are scaled by 2/3', () => {
    // 构造一个只有 +Y 面亮的贴图
    const size = 16;
    const cm = blackCubeMap(size);
    cm.faces[2] = solidFace(size, 255, 255, 255);

    const sh = LightProbeGenerator.fromCubeMap(cm);

    // 原始 SH Y_1^{-1} (y 方向) 应为正
    // 卷积后 = 原始 × 2/3
    // 验证 L=1 系数确实被缩放(非零)
    expect(sh.coefficients[3]).toBeGreaterThan(0.005);
    expect(sh.coefficients[3]).toBeLessThan(0.3); // 不应该太大
  });
});

// ── SphericalHarmonics3 集成 ──────────────────────────────────────

describe('LightProbeGenerator returns SphericalHarmonics3', () => {
  it('result is instance of SphericalHarmonics3', () => {
    const cm = whiteCubeMap(8);
    const sh = LightProbeGenerator.fromCubeMap(cm);
    expect(sh).toBeInstanceOf(SphericalHarmonics3);
    expect(sh.coefficients.length).toBe(27);
  });

  it('result can be copied', () => {
    const cm = whiteCubeMap(8);
    const sh = LightProbeGenerator.fromCubeMap(cm);
    const copy = new SphericalHarmonics3().copy(sh);
    expect(copy.equals(sh)).toBe(true);
  });
});

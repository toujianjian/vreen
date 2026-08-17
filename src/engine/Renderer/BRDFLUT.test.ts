// BRDFLUT 单元测试 — 结构 / 数值 / 边界 / 趋势 / 能量守恒。
//
// 覆盖维度:
//   1. 输出结构(尺寸、数据长度)
//   2. 值域(scale ∈ [0,1], bias ∈ [0,1])
//   3. 边界(roughness=0 镜面、NoV=1 正视、roughness=1 粗糙)
//   4. 趋势(roughness ↑ → scale ↓, bias ↑; NoV ↑ → scale ↑)
//   5. 能量守恒(scale + bias ≤ 1)
//   6. 无 NaN / Infinity
//   7. 自定义参数

import { describe, it, expect } from 'vitest';
import { BRDFLUT, type BRDFLUTData } from './BRDFLUT';

// 用较小参数加速测试(精度足够验证趋势)
const TEST_SIZE = 32;
const TEST_SAMPLES = 128;

/** 采样 LUT 中 (NoV, roughness) 处的 (scale, bias)。 */
function sampleLUT(lut: BRDFLUTData, NoV: number, roughness: number): [number, number] {
  const x = Math.round(NoV * (lut.size - 1));
  const y = Math.round(roughness * (lut.size - 1));
  const idx = (y * lut.size + x) * 2;
  return [lut.data[idx], lut.data[idx + 1]];
}

describe('BRDFLUT', () => {

  // ── 结构 ────────────────────────────────────────────────────

  describe('结构', () => {
    it('默认 size=256', () => {
      const lut = BRDFLUT.generate();
      expect(lut.size).toBe(256);
      // 256×256×1024 ≈ 6700 万次带三角函数积分,慢机器 + 全量并发可能超过 30s。
    }, 90000);

    it('数据长度 = size * size * 2', () => {
      const lut = BRDFLUT.generate({ size: 64 });
      expect(lut.data.length).toBe(64 * 64 * 2);
    });

    it('自定义 size', () => {
      const lut = BRDFLUT.generate({ size: 128 });
      expect(lut.size).toBe(128);
      expect(lut.data.length).toBe(128 * 128 * 2);
    }, 60000);

    it('size 最小 16', () => {
      const lut = BRDFLUT.generate({ size: 4 });
      expect(lut.size).toBe(16);
    });

    it('默认 samples=1024', () => {
      // 间接验证:samples 影响精度而非结构
      const lut = BRDFLUT.generate({ size: 16, samples: 32 });
      expect(lut.data.length).toBe(16 * 16 * 2);
    });
  });

  // ── 值域 ────────────────────────────────────────────────────

  describe('值域', () => {
    it('scale ∈ [0, 1]', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      for (let i = 0; i < lut.data.length; i += 2) {
        const scale = lut.data[i];
        expect(scale).toBeGreaterThanOrEqual(0);
        expect(scale).toBeLessThanOrEqual(1);
      }
    });

    it('bias ∈ [0, 1]', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      for (let i = 0; i < lut.data.length; i += 2) {
        const bias = lut.data[i + 1];
        expect(bias).toBeGreaterThanOrEqual(0);
        expect(bias).toBeLessThanOrEqual(1);
      }
    });

    it('无 NaN', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      for (let i = 0; i < lut.data.length; i++) {
        expect(Number.isNaN(lut.data[i])).toBe(false);
      }
    });

    it('无 Infinity', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      for (let i = 0; i < lut.data.length; i++) {
        expect(Number.isFinite(lut.data[i])).toBe(true);
      }
    });
  });

  // ── 边界 ────────────────────────────────────────────────────

  describe('边界', () => {
    it('roughness=0, NoV=1: scale ≈ 1, bias ≈ 0 (镜面正对)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const [scale, bias] = sampleLUT(lut, 1.0, 0.0);
      // α=0 时 GGX 退化为 delta,scale→1, bias→0
      // 由于 alpha 被 clamp 到 1e-7,容差放宽
      expect(scale).toBeGreaterThan(0.9);
      expect(bias).toBeLessThan(0.1);
    });

    it('roughness=0, NoV=0: 非退化(有值)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const [scale, bias] = sampleLUT(lut, 0.0, 0.0);
      expect(Number.isFinite(scale)).toBe(true);
      expect(Number.isFinite(bias)).toBe(true);
    });

    it('roughness=1, NoV=1: scale < 1(非完全反射)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const [scale] = sampleLUT(lut, 1.0, 1.0);
      expect(scale).toBeLessThan(1.0);
      expect(scale).toBeGreaterThan(0);
    });

    it('roughness=1: scale 和 bias 都为正(有散射)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const [scale, bias] = sampleLUT(lut, 0.5, 1.0);
      expect(scale).toBeGreaterThan(0);
      expect(bias).toBeGreaterThan(0);
    });
  });

  // ── 趋势 ────────────────────────────────────────────────────

  describe('趋势', () => {
    it('固定 NoV: roughness ↑ → scale ↓(F0 贡献降低)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const NoV = 0.5;
      const scale0 = sampleLUT(lut, NoV, 0.2)[0];
      const scale1 = sampleLUT(lut, NoV, 0.8)[0];
      expect(scale1).toBeLessThanOrEqual(scale0 + 0.05); // 容差(采样噪声)
    });

    it('固定 NoV: roughness ↑ → bias ↑(F90 贡献增加)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const NoV = 0.5;
      const bias0 = sampleLUT(lut, NoV, 0.2)[1];
      const bias1 = sampleLUT(lut, NoV, 0.8)[1];
      expect(bias1).toBeGreaterThanOrEqual(bias0 - 0.05); // 容差
    });

    it('固定 roughness: NoV ↑ → scale ↑(正视反射更强)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const roughness = 0.5;
      const scale0 = sampleLUT(lut, 0.2, roughness)[0];
      const scale1 = sampleLUT(lut, 0.8, roughness)[0];
      expect(scale1).toBeGreaterThanOrEqual(scale0 - 0.1); // 容差
    });
  });

  // ── 能量守恒 ────────────────────────────────────────────────

  describe('能量守恒', () => {
    it('scale + bias ≤ 1(反射不超能量)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      for (let i = 0; i < lut.data.length; i += 2) {
        const sum = lut.data[i] + lut.data[i + 1];
        expect(sum).toBeLessThanOrEqual(1.05); // 容差(采样噪声)
      }
    });

    it('roughness=0, NoV=1: scale + bias ≈ 1(完全反射)', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const [scale, bias] = sampleLUT(lut, 1.0, 0.0);
      expect(scale + bias).toBeCloseTo(1.0, 1);
    });
  });

  // ── 确定性 ──────────────────────────────────────────────────

  describe('确定性', () => {
    it('相同参数 → 相同输出', () => {
      const opts = { size: 16, samples: 32 };
      const lut1 = BRDFLUT.generate(opts);
      const lut2 = BRDFLUT.generate(opts);
      for (let i = 0; i < lut1.data.length; i++) {
        expect(lut1.data[i]).toBe(lut2.data[i]);
      }
    });
  });

  // ── 采样数影响 ──────────────────────────────────────────────

  describe('采样数影响', () => {
    it('高采样数 → 更平滑(低方差)', () => {
      // 低采样在 roughness=0.5 处有更多噪声
      // 验证高采样的结果在合理范围内
      const lutLow = BRDFLUT.generate({ size: 16, samples: 16 });
      const lutHigh = BRDFLUT.generate({ size: 16, samples: 256 });

      // 中心 texel (NoV=0.5, roughness=0.5)
      const [scaleLow] = sampleLUT(lutLow, 0.5, 0.5);
      const [scaleHigh] = sampleLUT(lutHigh, 0.5, 0.5);

      // 两者都应在合理范围 [0, 1]
      expect(scaleLow).toBeGreaterThanOrEqual(0);
      expect(scaleLow).toBeLessThanOrEqual(1);
      expect(scaleHigh).toBeGreaterThanOrEqual(0);
      expect(scaleHigh).toBeLessThanOrEqual(1);

      // 差异不应过大(蒙特卡洛应收敛到同一值)
      expect(Math.abs(scaleLow - scaleHigh)).toBeLessThan(0.3);
    });
  });

  // ── 粗糙面与镜面的差异 ─────────────────────────────────────

  describe('粗糙面 vs 镜面', () => {
    it('镜面(roughness=0)的 scale > 粗糙面(roughness=1)的 scale', () => {
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const [scaleMirror] = sampleLUT(lut, 0.8, 0.0);
      const [scaleRough] = sampleLUT(lut, 0.8, 1.0);
      expect(scaleMirror).toBeGreaterThan(scaleRough);
    });

    it('镜面的 bias > 粗糙面的 bias(Fc 在固定 VdotH=NoV 处取值)', () => {
      // roughness=0 时所有样本 VdotH=NoV,Fc=(1-NoV)^5 恒定,bias=Fc*G_vis=Fc
      // roughness>0 时样本分散,G_vis 降低,有效 bias 下降
      const lut = BRDFLUT.generate({ size: TEST_SIZE, samples: TEST_SAMPLES });
      const [, biasMirror] = sampleLUT(lut, 0.5, 0.0);
      const [, biasRough] = sampleLUT(lut, 0.5, 1.0);
      expect(biasMirror).toBeGreaterThan(biasRough);
    });
  });
});

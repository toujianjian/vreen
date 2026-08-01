// SubsurfaceScattering 单元测试 — 曲率 / 透射 / 混合 / LUT 集成。
//
// 覆盖维度:
//   1. computeCurvature / computeCurvatureAveraged(法线差分)
//   2. backLightTransmission(背光透射)
//   3. mixSSSDiffuse(混合权重)
//   4. LUT 集成(generatePreIntegratedSkinLUT + samplePreIntegratedSkinLUT)
//   5. skinScatterProfile(d'Eon 高斯剖面)

import { describe, it, expect } from 'vitest';
import {
  generatePreIntegratedSkinLUT,
  samplePreIntegratedSkinLUT,
  skinScatterProfile,
  curvatureFromRadius,
  computeCurvature,
  computeCurvatureAveraged,
  backLightTransmission,
  mixSSSDiffuse,
} from './SubsurfaceScattering';

describe('SubsurfaceScattering', () => {

  // ── skinScatterProfile (d'Eon 2007) ────────────────────────

  describe('skinScatterProfile', () => {
    it('d=0 时各通道有正值', () => {
      const c = skinScatterProfile(0);
      expect(c.r).toBeGreaterThan(0);
      expect(c.g).toBeGreaterThan(0);
      expect(c.b).toBeGreaterThan(0);
    });

    it('红色通道在远距离 > 绿色 > 蓝色(红光散射最远)', () => {
      const c = skinScatterProfile(0.5);
      // 红色长程散射项 (v=0.842) 使其在远距离仍显著
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.g).toBeGreaterThan(c.b);
    });

    it('d→∞ 时趋近 0', () => {
      const c = skinScatterProfile(100);
      expect(c.r).toBeCloseTo(0, 5);
      expect(c.g).toBeCloseTo(0, 5);
      expect(c.b).toBeCloseTo(0, 5);
    });
  });

  // ── curvatureFromRadius ────────────────────────────────────

  describe('curvatureFromRadius', () => {
    it('r=1 → 曲率 1', () => {
      expect(curvatureFromRadius(1)).toBe(1);
    });

    it('r=0.5 → 曲率 2', () => {
      expect(curvatureFromRadius(0.5)).toBe(2);
    });

    it('r→∞ → 曲率 0(平面)', () => {
      expect(curvatureFromRadius(1e6)).toBeCloseTo(0, 5);
    });

    it('r=0 → 曲率 0(避免除零)', () => {
      expect(curvatureFromRadius(0)).toBe(0);
    });
  });

  // ── computeCurvature ───────────────────────────────────────

  describe('computeCurvature', () => {
    it('相同法线 → 曲率 0(平面)', () => {
      const n = { x: 0, y: 0, z: 1 };
      expect(computeCurvature(n, n, 1)).toBe(0);
    });

    it('法线差异大 → 曲率高', () => {
      const n0 = { x: 0, y: 0, z: 1 };
      const n1 = { x: 1, y: 0, z: 0 };
      const c = computeCurvature(n0, n1, 1);
      expect(c).toBeCloseTo(Math.sqrt(2), 4);
    });

    it('edgeLength 大 → 曲率小(相同法线变化)', () => {
      const n0 = { x: 0, y: 0, z: 1 };
      const n1 = { x: 0.5, y: 0, z: 0.866 };
      const c1 = computeCurvature(n0, n1, 1);
      const c2 = computeCurvature(n0, n1, 10);
      expect(c2).toBeLessThan(c1);
      expect(c2).toBeCloseTo(c1 / 10, 4);
    });

    it('edgeLength=0 → 返回 0(避免除零)', () => {
      const n0 = { x: 0, y: 0, z: 1 };
      const n1 = { x: 1, y: 0, z: 0 };
      expect(computeCurvature(n0, n1, 0)).toBe(0);
    });
  });

  // ── computeCurvatureAveraged ───────────────────────────────

  describe('computeCurvatureAveraged', () => {
    it('空邻居 → 0', () => {
      expect(computeCurvatureAveraged({ x: 0, y: 0, z: 1 }, [], [])).toBe(0);
    });

    it('多邻居平均', () => {
      const center = { x: 0, y: 0, z: 1 };
      const n1 = { x: 0.5, y: 0, z: 0.866 };
      const n2 = { x: -0.5, y: 0, z: 0.866 };
      const avg = computeCurvatureAveraged(center, [n1, n2], [1, 1]);
      const c1 = computeCurvature(center, n1, 1);
      const c2 = computeCurvature(center, n2, 1);
      expect(avg).toBeCloseTo((c1 + c2) / 2, 5);
    });
  });

  // ── backLightTransmission ──────────────────────────────────

  describe('backLightTransmission', () => {
    it('前光(NoL > 0)→ 无透射', () => {
      const [r, g, b] = backLightTransmission(0.2, 0.5, 0.5);
      expect(r).toBe(0);
      expect(g).toBe(0);
      expect(b).toBe(0);
    });

    it('背光(NoL < 0)+ 薄组织 → 红色透射', () => {
      const [r, g, b] = backLightTransmission(0.1, -0.8, -0.8);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    });

    it('厚组织 → 透射弱', () => {
      const thin = backLightTransmission(0.1, -0.8, -0.8);
      const thick = backLightTransmission(0.9, -0.8, -0.8);
      expect(thick[0]).toBeLessThan(thin[0]);
    });

    it('正面观察(VoL > 0)→ 无透射', () => {
      const [r] = backLightTransmission(0.2, -0.8, 0.8);
      expect(r).toBe(0);
    });

    it('透射颜色红色 > 绿色 > 蓝色', () => {
      const [r, g, b] = backLightTransmission(0.2, -1, -1);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(b).toBeGreaterThan(0);
    });
  });

  // ── mixSSSDiffuse ──────────────────────────────────────────

  describe('mixSSSDiffuse', () => {
    it('sssAmount=0 → 纯 diffuse', () => {
      const result = mixSSSDiffuse([0.5, 0.5, 0.5], [0.8, 0.2, 0.1], 0);
      expect(result[0]).toBe(0.5);
      expect(result[1]).toBe(0.5);
      expect(result[2]).toBe(0.5);
    });

    it('sssAmount=1 → 纯 SSS', () => {
      const result = mixSSSDiffuse([0.5, 0.5, 0.5], [0.8, 0.2, 0.1], 1);
      expect(result[0]).toBe(0.8);
      expect(result[1]).toBe(0.2);
      expect(result[2]).toBe(0.1);
    });

    it('sssAmount=0.5 → 50/50 混合', () => {
      const result = mixSSSDiffuse([0.4, 0.6, 0.8], [0.8, 0.2, 0.0], 0.5);
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(0.4, 5);
      expect(result[2]).toBeCloseTo(0.4, 5);
    });

    it('sssAmount 超出 [0,1] 被 clamp', () => {
      const r1 = mixSSSDiffuse([0.5, 0, 0], [1, 0, 0], -1);
      expect(r1[0]).toBe(0.5);

      const r2 = mixSSSDiffuse([0.5, 0, 0], [1, 0, 0], 2);
      expect(r2[0]).toBe(1);
    });
  });

  // ── LUT 集成 (generatePreIntegratedSkinLUT + sample) ───────

  describe('LUT 集成', () => {
    const lut = generatePreIntegratedSkinLUT({ width: 32, height: 32, samples: 32 });

    it('LUT 数据长度正确', () => {
      expect(lut.data.length).toBe(32 * 32 * 3);
    });

    it('LUT 值域 [0, 1]', () => {
      for (let i = 0; i < lut.data.length; i++) {
        expect(lut.data[i]).toBeGreaterThanOrEqual(0);
        expect(lut.data[i]).toBeLessThanOrEqual(1);
      }
    });

    it('无 NaN', () => {
      for (let i = 0; i < lut.data.length; i++) {
        expect(Number.isNaN(lut.data[i])).toBe(false);
      }
    });

    it('平面(曲率=0)≈ Lambertian: NoL=1 → R=G=B=1', () => {
      const c = samplePreIntegratedSkinLUT(lut, 1.0, 0);
      expect(c.r).toBeCloseTo(1, 1);
      expect(c.g).toBeCloseTo(1, 1);
      expect(c.b).toBeCloseTo(1, 1);
    });

    it('平面(曲率=0): NoL=0 → R=G=B=0', () => {
      const c = samplePreIntegratedSkinLUT(lut, 0, 0);
      expect(c.r).toBeCloseTo(0, 1);
      expect(c.g).toBeCloseTo(0, 1);
      expect(c.b).toBeCloseTo(0, 1);
    });

    it('高曲率: NoL=0 处有正辐照度(SSS 光泄漏)', () => {
      const cFlat = samplePreIntegratedSkinLUT(lut, 0, 0);
      const cCurved = samplePreIntegratedSkinLUT(lut, 0, lut.maxCurvature);
      // 高曲率 → 光泄漏到阴影侧
      expect(cCurved.r).toBeGreaterThan(cFlat.r);
      expect(cCurved.r).toBeGreaterThan(0);
    });

    it('高曲率: terminator 处红色 > 绿色(红移)', () => {
      const c = samplePreIntegratedSkinLUT(lut, 0.1, lut.maxCurvature);
      // 红色散射最远 → terminator 附近偏红
      expect(c.r).toBeGreaterThanOrEqual(c.g - 0.05);
    });

    it('双线性采样: NoL 超出 [-1,1] 被 clamp', () => {
      const c1 = samplePreIntegratedSkinLUT(lut, 2, 0);
      const c2 = samplePreIntegratedSkinLUT(lut, 1, 0);
      expect(c1.r).toBeCloseTo(c2.r, 3);
    });

    it('确定性: 相同参数相同输出', () => {
      const lut2 = generatePreIntegratedSkinLUT({ width: 32, height: 32, samples: 32 });
      for (let i = 0; i < lut.data.length; i++) {
        expect(lut.data[i]).toBe(lut2.data[i]);
      }
    });
  });

  // ── SSS 管线集成测试 ───────────────────────────────────────

  describe('SSS 管线集成', () => {
    it('完整流程: LUT 生成 → 采样 → 混合', () => {
      // 1. 生成 LUT
      const lut = generatePreIntegratedSkinLUT({ width: 64, height: 64, samples: 64 });

      // 2. 采样(模拟鼻尖: NoL=0.5, 高曲率)
      const sssColor = samplePreIntegratedSkinLUT(lut, 0.5, lut.maxCurvature);

      // 3. 混合(50% SSS + 50% Lambertian)
      const lambert = [0.5 * 0.8, 0.5 * 0.6, 0.5 * 0.4]; // albedo * NoL
      const mixed = mixSSSDiffuse(
        [lambert[0], lambert[1], lambert[2]],
        [sssColor.r, sssColor.g, sssColor.b],
        0.5,
      );

      // 结果应为两者平均
      expect(mixed[0]).toBeCloseTo((lambert[0] + sssColor.r) / 2, 2);
      expect(mixed[1]).toBeCloseTo((lambert[1] + sssColor.g) / 2, 2);
      expect(mixed[2]).toBeCloseTo((lambert[2] + sssColor.b) / 2, 2);
    });

    it('曲率估算 → LUT 采样流程', () => {
      // 模拟:从相邻法线估算曲率,再用曲率采样 LUT
      const center = { x: 0, y: 0, z: 1 };
      const neighbor = { x: 0.3, y: 0, z: 0.954 };
      const curvature = computeCurvature(center, neighbor, 0.5); // 边长 0.5mm

      const lut = generatePreIntegratedSkinLUT({ width: 32, height: 32, samples: 32 });
      const color = samplePreIntegratedSkinLUT(lut, 0.7, curvature);

      expect(color.r).toBeGreaterThanOrEqual(0);
      expect(color.r).toBeLessThanOrEqual(1);
    });

    it('背光透射 + 前向 SSS 可组合', () => {
      // 前向 SSS(从 LUT)
      const lut = generatePreIntegratedSkinLUT({ width: 32, height: 32, samples: 32 });
      const frontSSS = samplePreIntegratedSkinLUT(lut, 0.8, 1.0);

      // 背光透射(耳翼效果)
      const transmission = backLightTransmission(0.2, -0.5, -0.7);

      // 合成:前向 SSS + 背光透射
      const final = [
        frontSSS.r + transmission[0],
        frontSSS.g + transmission[1],
        frontSSS.b + transmission[2],
      ];

      // 透射增加红色分量
      expect(final[0]).toBeGreaterThan(frontSSS.r);
      expect(final[0]).toBeGreaterThan(final[2]); // 红色主导
    });
  });
});

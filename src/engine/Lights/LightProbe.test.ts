// LightProbe + SphericalHarmonics3 单元测试。
// 验证 SH 系数布局、fromColor / evalSH 数学,以及 Ambient/Hemisphere 子类构造。

import { describe, it, expect } from 'vitest';
import { LightProbe, SphericalHarmonics3 } from './LightProbe';
import { AmbientLightProbe } from './AmbientLightProbe';
import { HemisphereLightProbe } from './HemisphereLightProbe';
import { Vector3 } from '../Math/Vector3';

describe('SphericalHarmonics3', () => {
  it('默认构造 coefficients 为 Float32Array(27) 全零', () => {
    const sh = new SphericalHarmonics3();
    expect(sh.coefficients).toBeInstanceOf(Float32Array);
    expect(sh.coefficients.length).toBe(27);
    for (let i = 0; i < 27; i++) {
      expect(sh.coefficients[i]).toBe(0);
    }
  });

  describe('fromColor', () => {
    it('白色 (1,1,1) → 第一阶 = (1/9, 1/9, 1/9), 其余 = 0', () => {
      const sh = SphericalHarmonics3.fromColor({ r: 1, g: 1, b: 1 });
      expect(sh.coefficients[0]).toBeCloseTo(1 / 9, 6);
      expect(sh.coefficients[1]).toBeCloseTo(1 / 9, 6);
      expect(sh.coefficients[2]).toBeCloseTo(1 / 9, 6);
      for (let i = 3; i < 27; i++) {
        expect(sh.coefficients[i]).toBe(0);
      }
    });

    it('红色 (1,0,0) → 第一阶 = (1/9, 0, 0)', () => {
      const sh = SphericalHarmonics3.fromColor({ r: 1, g: 0, b: 0 });
      expect(sh.coefficients[0]).toBeCloseTo(1 / 9, 6);
      expect(sh.coefficients[1]).toBe(0);
      expect(sh.coefficients[2]).toBe(0);
    });

    it('半强度 (0.5, 0.5, 0.5) → 第一阶 = (0.5/9, ...)', () => {
      const sh = SphericalHarmonics3.fromColor({ r: 0.5, g: 0.5, b: 0.5 });
      expect(sh.coefficients[0]).toBeCloseTo(0.5 / 9, 6);
      expect(sh.coefficients[1]).toBeCloseTo(0.5 / 9, 6);
      expect(sh.coefficients[2]).toBeCloseTo(0.5 / 9, 6);
    });
  });

  describe('evalSH', () => {
    it('方向 (0,1,0): Y_0^0 = 0.282095, Y_1^-1 = 0.488603', () => {
      const basis = SphericalHarmonics3.evalSH(new Vector3(0, 1, 0));
      expect(basis).toBeInstanceOf(Float32Array);
      expect(basis.length).toBe(9);
      // 常数项
      expect(basis[0]).toBeCloseTo(0.282095, 5);
      // Y_1^-1 = 0.488603 * y = 0.488603
      expect(basis[1]).toBeCloseTo(0.488603, 5);
      // Y_1^0 = 0.488603 * z = 0
      expect(basis[2]).toBeCloseTo(0, 6);
      // Y_1^1 = 0.488603 * x = 0
      expect(basis[3]).toBeCloseTo(0, 6);
      // band 2: x*y, y*z, 3z²-1, x*z, x²-y²
      expect(basis[4]).toBeCloseTo(0, 6); // x*y = 0
      expect(basis[5]).toBeCloseTo(0, 6); // y*z = 0
      expect(basis[6]).toBeCloseTo(-0.315392, 5); // 0.315392 * (3*0 - 1)
      expect(basis[7]).toBeCloseTo(0, 6); // x*z = 0
      expect(basis[8]).toBeCloseTo(-0.546274, 5); // 0.546274 * (0 - 1)
    });

    it('方向 (0,0,1): Y_1^0 = 0.488603, Y_2^0 = 0.315392 * 2', () => {
      const basis = SphericalHarmonics3.evalSH(new Vector3(0, 0, 1));
      expect(basis[0]).toBeCloseTo(0.282095, 5);
      expect(basis[1]).toBeCloseTo(0, 6); // y = 0
      expect(basis[2]).toBeCloseTo(0.488603, 5); // z = 1
      expect(basis[3]).toBeCloseTo(0, 6); // x = 0
      // Y_2^0 = 0.315392 * (3*1 - 1) = 0.315392 * 2
      expect(basis[6]).toBeCloseTo(0.315392 * 2, 5);
    });
  });

  describe('scale', () => {
    it('缩放所有系数', () => {
      const sh = new SphericalHarmonics3();
      sh.coefficients[0] = 1;
      sh.coefficients[3] = 2;
      sh.scale(2);
      expect(sh.coefficients[0]).toBeCloseTo(2, 6);
      expect(sh.coefficients[3]).toBeCloseTo(4, 6);
    });
  });

  describe('add', () => {
    it('逐元素加法', () => {
      const a = new SphericalHarmonics3();
      const b = new SphericalHarmonics3();
      a.coefficients[0] = 1;
      a.coefficients[5] = 3;
      b.coefficients[0] = 2;
      b.coefficients[5] = 7;
      a.add(b);
      expect(a.coefficients[0]).toBeCloseTo(3, 6);
      expect(a.coefficients[5]).toBeCloseTo(10, 6);
    });
  });

  describe('addScaledSH', () => {
    it('加权加法 a += b * s', () => {
      const a = new SphericalHarmonics3();
      const b = new SphericalHarmonics3();
      a.coefficients[0] = 1;
      b.coefficients[0] = 2;
      a.addScaledSH(b, 3);
      expect(a.coefficients[0]).toBeCloseTo(7, 6); // 1 + 2*3
    });
  });

  describe('lerp', () => {
    it('线性插值 a = a + (b - a) * alpha', () => {
      const a = new SphericalHarmonics3();
      const b = new SphericalHarmonics3();
      a.coefficients[0] = 0;
      b.coefficients[0] = 10;
      a.lerp(b, 0.3);
      expect(a.coefficients[0]).toBeCloseTo(3, 6); // 0 + (10-0)*0.3
    });
  });

  describe('copy / clone / equals', () => {
    it('copy 复制系数', () => {
      const a = new SphericalHarmonics3();
      const b = new SphericalHarmonics3();
      a.coefficients[0] = 5;
      a.coefficients[10] = 7;
      b.copy(a);
      expect(b.coefficients[0]).toBe(5);
      expect(b.coefficients[10]).toBe(7);
      // 修改 b 不影响 a
      b.coefficients[0] = 99;
      expect(a.coefficients[0]).toBe(5);
    });

    it('clone 返回独立副本', () => {
      const a = new SphericalHarmonics3();
      a.coefficients[0] = 3;
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.coefficients).not.toBe(a.coefficients);
      expect(b.coefficients[0]).toBe(3);
    });

    it('equals 比较系数', () => {
      const a = new SphericalHarmonics3();
      const b = new SphericalHarmonics3();
      expect(a.equals(b)).toBe(true);
      a.coefficients[0] = 1;
      expect(a.equals(b)).toBe(false);
      b.coefficients[0] = 1;
      expect(a.equals(b)).toBe(true);
    });
  });
});

describe('LightProbe', () => {
  it('默认构造: color=white, intensity=1, sh=Float32Array(27)', () => {
    const lp = new LightProbe();
    expect(lp.color.r).toBe(1);
    expect(lp.color.g).toBe(1);
    expect(lp.color.b).toBe(1);
    expect(lp.intensity).toBe(1);
    expect(lp.sh).toBeInstanceOf(SphericalHarmonics3);
    expect(lp.sh.coefficients).toBeInstanceOf(Float32Array);
    expect(lp.sh.coefficients.length).toBe(27);
    expect(lp.isLightProbe).toBe(true);
  });

  it('指定颜色与强度', () => {
    const lp = new LightProbe(0xff0000, 2);
    expect(lp.color.r).toBe(1);
    expect(lp.color.g).toBe(0);
    expect(lp.color.b).toBe(0);
    expect(lp.intensity).toBe(2);
  });

  it('copy 复制 sh 与 color', () => {
    const a = new LightProbe(0x00ff00, 1.5);
    a.sh.coefficients[0] = 0.5;
    const b = new LightProbe();
    b.copy(a);
    expect(b.intensity).toBe(1.5);
    expect(b.color.g).toBe(1);
    expect(b.sh.coefficients[0]).toBe(0.5);
  });
});

describe('AmbientLightProbe', () => {
  it('从颜色构造: sh 第一阶 = color/9', () => {
    const lp = new AmbientLightProbe(0xffffff, 1);
    expect(lp.isAmbientLightProbe).toBe(true);
    // 白色 (1,1,1) → (1/9, 1/9, 1/9)
    expect(lp.sh.coefficients[0]).toBeCloseTo(1 / 9, 6);
    expect(lp.sh.coefficients[1]).toBeCloseTo(1 / 9, 6);
    expect(lp.sh.coefficients[2]).toBeCloseTo(1 / 9, 6);
    // 其余为 0
    for (let i = 3; i < 27; i++) {
      expect(lp.sh.coefficients[i]).toBe(0);
    }
  });

  it('红色: sh 第一阶 = (1/9, 0, 0)', () => {
    const lp = new AmbientLightProbe(0xff0000);
    expect(lp.sh.coefficients[0]).toBeCloseTo(1 / 9, 6);
    expect(lp.sh.coefficients[1]).toBe(0);
    expect(lp.sh.coefficients[2]).toBe(0);
  });

  it('toJSON 包含 sh 与 type', () => {
    const lp = new AmbientLightProbe(0xffffff, 1);
    const json = lp.toJSON() as Record<string, unknown>;
    expect(json.type).toBe('AmbientLightProbe');
    expect(Array.isArray(json.sh)).toBe(true);
    expect((json.sh as number[]).length).toBe(27);
  });
});

describe('HemisphereLightProbe', () => {
  it('从 sky + ground 颜色构造: sh 被填充', () => {
    const lp = new HemisphereLightProbe(0xffffff, 0x000000, 1);
    expect(lp.isHemisphereLightProbe).toBe(true);
    const c = lp.sh.coefficients;
    // c0 = sqrt(PI), c1 = c0 * sqrt(0.75)
    const c0 = Math.sqrt(Math.PI);
    const c1 = c0 * Math.sqrt(0.75);
    // sky=(1,1,1), ground=(0,0,0)
    // band 0: (sky+ground)*c0 = (1,1,1)*c0
    expect(c[0]).toBeCloseTo(1 * c0, 5);
    expect(c[1]).toBeCloseTo(1 * c0, 5);
    expect(c[2]).toBeCloseTo(1 * c0, 5);
    // band 1, Y_1^-1: (sky-ground)*c1 = (1,1,1)*c1
    expect(c[3]).toBeCloseTo(1 * c1, 5);
    expect(c[4]).toBeCloseTo(1 * c1, 5);
    expect(c[5]).toBeCloseTo(1 * c1, 5);
    // 其余为 0
    for (let i = 6; i < 27; i++) {
      expect(c[i]).toBe(0);
    }
  });

  it('sky=ground 时,band 1 为 0 (无方向性)', () => {
    const lp = new HemisphereLightProbe(0x808080, 0x808080);
    const c = lp.sh.coefficients;
    // sky - ground = 0,所以 band 1 (Y_1^-1) = 0
    expect(c[3]).toBeCloseTo(0, 6);
    expect(c[4]).toBeCloseTo(0, 6);
    expect(c[5]).toBeCloseTo(0, 6);
    // band 0 仍非零
    const c0 = Math.sqrt(Math.PI);
    const sky = 0x80 / 255; // 灰色
    expect(c[0]).toBeCloseTo((sky + sky) * c0, 4);
  });

  it('toJSON 包含 sh 与 type', () => {
    const lp = new HemisphereLightProbe(0xffffff, 0x000000, 1);
    const json = lp.toJSON() as Record<string, unknown>;
    expect(json.type).toBe('HemisphereLightProbe');
    expect(Array.isArray(json.sh)).toBe(true);
    expect((json.sh as number[]).length).toBe(27);
  });
});

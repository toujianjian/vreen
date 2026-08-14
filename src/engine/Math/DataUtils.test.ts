// DataUtils 单元测试 —— 验证 FP16 ↔ FP32 半精度浮点转换。
//
// 基准:浏览器无原生 Float16Array,故往返精度以 IEEE 754 binary16 语义校验:
//   - toHalfFloat 经查表位移产出 16-bit 值
//   - fromHalfFloat 还原到 FP32
//   - 特殊值:0、-0、±Infinity、NaN、denormal、最大可表示值 ±65504

import { describe, it, expect } from 'vitest';
import { DataUtils, toHalfFloat, fromHalfFloat } from './DataUtils';

describe('toHalfFloat', () => {
  it('0 → 0x0000, 1.0 → 0x3c00, 2.0 → 0x4000, 1.5 → 0x3e00', () => {
    expect(toHalfFloat(0)).toBe(0x0000);
    expect(toHalfFloat(1)).toBe(0x3c00);
    expect(toHalfFloat(2)).toBe(0x4000);
    expect(toHalfFloat(1.5)).toBe(0x3e00);
  });

  it('负数带符号位:-1.0 = 0x3c00 | 0x8000 = 0xbc00', () => {
    expect(toHalfFloat(-1)).toBe(0x3c00 | 0x8000);
    expect(toHalfFloat(-1.5)).toBe(0x3e00 | 0x8000);
  });

  it('最大可表示值 ±65504 → 0x7bff / 0xfbff', () => {
    expect(toHalfFloat(65504)).toBe(0x7bff);
    expect(toHalfFloat(-65504)).toBe(0x7bff | 0x8000);
  });

  it('Infinity 钳位到 ±65504(与 three.js 一致:clamp 先于查表)', () => {
    // Infinity 经 clamp(±65504) → 0x7bff;语义即"超界值钳到最大可表示"。
    expect(toHalfFloat(Infinity)).toBe(0x7bff);
    expect(toHalfFloat(-Infinity)).toBe(0x7bff | 0x8000);
    // 经 fromHalfFloat 还原为 65504(非 Infinity)
    expect(fromHalfFloat(toHalfFloat(Infinity))).toBe(65504);
  });

  it('NaN 经 toHalfFloat 产出一个 16-bit 值(具体编码依赖平台 NaN 位,不固定)', () => {
    const n = toHalfFloat(NaN);
    expect(Number.isInteger(n)).toBe(true);
    expect(n >= 0 && n <= 0xffff).toBe(true);
  });

  it('溢出 ±65504 钳位到边界(不抛错)', () => {
    // 65505 超 max → 钳到 65504 的半精度编码
    expect(toHalfFloat(65505)).toBe(toHalfFloat(65504));
    expect(toHalfFloat(-100000)).toBe(toHalfFloat(-65504));
  });
});

describe('fromHalfFloat', () => {
  it('0x0000 → 0, 0x3c00 → 1.0, 0x3e00 → 1.5', () => {
    expect(fromHalfFloat(0x0000)).toBe(0);
    expect(fromHalfFloat(0x3c00)).toBe(1);
    expect(fromHalfFloat(0x3e00)).toBe(1.5);
  });

  it('负编码还原:0xbc00 → -1.0', () => {
    expect(fromHalfFloat(0x3c00 | 0x8000)).toBe(-1);
    expect(fromHalfFloat(0x3e00 | 0x8000)).toBe(-1.5);
  });

  it('±Infinity 还原:0x7c00 / 0xfc00', () => {
    expect(fromHalfFloat(0x7c00)).toBe(Infinity);
    expect(fromHalfFloat(0xfc00)).toBe(-Infinity);
  });

  it('NaN 编码还原为 NaN', () => {
    expect(Number.isNaN(fromHalfFloat(0x7e00))).toBe(true);
  });

  it('最大值 0x7bff 还原为 65504', () => {
    expect(fromHalfFloat(0x7bff)).toBe(65504);
    expect(fromHalfFloat(0x7bff | 0x8000)).toBe(-65504);
  });

  it('-0 (0x8000) 还原为 -0', () => {
    const v = fromHalfFloat(0x8000);
    expect(Object.is(v, -0)).toBe(true);
  });
});

describe('toHalfFloat ↔ fromHalfFloat 往返', () => {
  it('一组常规值往返误差 ≤ half-float 精度上限(≈2^-10 相对)', () => {
    const samples = [0.5, 1.25, 3.14159, 100, 1000, -42.7, 65504, -65504, 0.1, 99.9];
    for (const s of samples) {
      const r = fromHalfFloat(toHalfFloat(s));
      // half-float 11 位精度,相对误差 ~2^-10 ≈ 0.1%
      const rel = Math.abs((r - s) / (s || 1));
      expect(rel).toBeLessThan(0.002);
    }
  });

  it('全覆盖:8-bit 受量化整数精确往返(0..2048 偶数跳步)', () => {
    // 整数 ≤ 2048 在 half-float 精确表示
    for (let i = -2048; i <= 2048; i += 1) {
      const h = toHalfFloat(i);
      const r = fromHalfFloat(h);
      expect(r).toBe(i);
    }
  });

  it('denormalized 范围(2^-24 ~ 2^-14)往返不丢符号', () => {
    const small = 2 ** -16; // denormalized 范围内
    const h = toHalfFloat(small);
    const r = fromHalfFloat(h);
    expect(Math.sign(r)).toBe(Math.sign(small));
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(small * 1.5); // 量化到最近的 denormal
  });
});

describe('DataUtils 静态类', () => {
  it('与导出的 toHalfFloat/fromHalfFloat 等价', () => {
    expect(DataUtils.toHalfFloat(3.14)).toBe(toHalfFloat(3.14));
    expect(DataUtils.fromHalfFloat(0x4000)).toBe(fromHalfFloat(0x4000));
  });

  it('静态接口可链式传入(无 this 绑定问题)', () => {
    const fn = DataUtils.toHalfFloat;
    expect(fn(1)).toBe(0x3c00);
    const fn2 = DataUtils.fromHalfFloat;
    expect(fn2(0x3c00)).toBe(1);
  });
});

describe('打包到 Uint16Array 常见用法', () => {
  it('HalfFloat 编码可写入 Uint16Array 并逐个 readback', () => {
    // 模拟把 FP32 数组编码成 FP16 packed buffer(G-Buffer half-float readback 场景)
    const floats = new Float32Array([1, 2, 3.5, -7.25, 100, -0.5]);
    const packed = new Uint16Array(floats.length);
    for (let i = 0; i < floats.length; i++) {
      packed[i] = toHalfFloat(floats[i]);
    }
    // readback
    for (let i = 0; i < floats.length; i++) {
      const r = fromHalfFloat(packed[i]);
      const rel = Math.abs((r - floats[i]) / (floats[i] || 1));
      expect(rel).toBeLessThan(0.002);
    }
  });
});

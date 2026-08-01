// AnaglyphEffect 单元测试 (红蓝立体合成)。
//
// 覆盖:
//   1. 构造默认值 + 配置
//   2. redCyan 模式:R=left.R, G=right.G, B=right.B
//   3. redGreen 模式:R=left.R, G=right.G, B=0
//   4. redBlue 模式:R=left.R, G=0, B=right.B
//   5. amberBlue 模式:R=left.R, G=left.G, B=right.B
//   6. grayscale 模式
//   7. 尺寸不匹配抛错
//   8. alpha 通道取平均
//   9. gamma 校正
//  10. 输出尺寸 = 输入尺寸

import { describe, it, expect } from 'vitest';
import { AnaglyphEffect, createSolidImage } from './AnaglyphEffect';

// ── 构造 ────────────────────────────────────────────────────────────

describe('AnaglyphEffect construction', () => {
  it('defaults: redCyan, no grayscale, no gamma', () => {
    const e = new AnaglyphEffect();
    expect(e.colorMode).toBe('redCyan');
    expect(e.grayscale).toBe(false);
  });

  it('accepts custom options', () => {
    const e = new AnaglyphEffect({ colorMode: 'amberBlue', grayscale: true, gamma: 2.2 });
    expect(e.colorMode).toBe('amberBlue');
    expect(e.grayscale).toBe(true);
  });

  it('setColorMode updates mode', () => {
    const e = new AnaglyphEffect();
    e.setColorMode('redGreen');
    expect(e.colorMode).toBe('redGreen');
  });

  it('setGrayscale updates flag', () => {
    const e = new AnaglyphEffect();
    e.setGrayscale(true);
    expect(e.grayscale).toBe(true);
  });
});

// ── redCyan 模式 ───────────────────────────────────────────────────

describe('AnaglyphEffect redCyan', () => {
  it('R from left, G+B from right', () => {
    const e = new AnaglyphEffect({ colorMode: 'redCyan' });
    const left = createSolidImage(2, 2, 100, 50, 25);
    const right = createSolidImage(2, 2, 200, 150, 75);
    const result = e.composite(left, right);

    // R = left.R = 100
    expect(result.data[0]).toBeCloseTo(100, 0);
    // G = right.G = 150
    expect(result.data[1]).toBeCloseTo(150, 0);
    // B = right.B = 75
    expect(result.data[2]).toBeCloseTo(75, 0);
  });

  it('left green and blue channels are ignored (grayscale off)', () => {
    const e = new AnaglyphEffect({ colorMode: 'redCyan' });
    const left = createSolidImage(1, 1, 100, 200, 50);
    const right = createSolidImage(1, 1, 0, 150, 75);
    const result = e.composite(left, right);

    // R = left.R = 100 (left.G=200 被忽略)
    expect(result.data[0]).toBeCloseTo(100, 0);
    // G = right.G = 150
    expect(result.data[1]).toBeCloseTo(150, 0);
  });
});

// ── redGreen 模式 ──────────────────────────────────────────────────

describe('AnaglyphEffect redGreen', () => {
  it('R from left, G from right, B = 0', () => {
    const e = new AnaglyphEffect({ colorMode: 'redGreen' });
    const left = createSolidImage(1, 1, 120, 0, 0);
    const right = createSolidImage(1, 1, 0, 180, 0);
    const result = e.composite(left, right);

    expect(result.data[0]).toBeCloseTo(120, 0); // R from left
    expect(result.data[1]).toBeCloseTo(180, 0); // G from right
    expect(result.data[2]).toBe(0);             // B = 0
  });
});

// ── redBlue 模式 ───────────────────────────────────────────────────

describe('AnaglyphEffect redBlue', () => {
  it('R from left, B from right, G = 0', () => {
    const e = new AnaglyphEffect({ colorMode: 'redBlue' });
    const left = createSolidImage(1, 1, 130, 0, 0);
    const right = createSolidImage(1, 1, 0, 0, 190);
    const result = e.composite(left, right);

    expect(result.data[0]).toBeCloseTo(130, 0); // R from left
    expect(result.data[1]).toBe(0);             // G = 0
    expect(result.data[2]).toBeCloseTo(190, 0); // B from right
  });
});

// ── amberBlue 模式 ─────────────────────────────────────────────────

describe('AnaglyphEffect amberBlue', () => {
  it('R+G from left, B from right', () => {
    const e = new AnaglyphEffect({ colorMode: 'amberBlue' });
    const left = createSolidImage(1, 1, 140, 110, 0);
    const right = createSolidImage(1, 1, 0, 0, 200);
    const result = e.composite(left, right);

    // R from left.R
    expect(result.data[0]).toBeCloseTo(140, 0);
    // G from left.G (amber = red + green)
    expect(result.data[1]).toBeCloseTo(110, 0);
    // B from right.B
    expect(result.data[2]).toBeCloseTo(200, 0);
  });
});

// ── grayscale 模式 ─────────────────────────────────────────────────

describe('AnaglyphEffect grayscale', () => {
  it('converts to grayscale before compositing', () => {
    const e = new AnaglyphEffect({ colorMode: 'redCyan', grayscale: true });
    // 左眼:纯红 (255,0,0) → 灰度 = 0.299*255 = 76.245
    const left = createSolidImage(1, 1, 255, 0, 0);
    // 右眼:纯绿 (0,255,0) → 灰度 = 0.587*255 = 149.685
    const right = createSolidImage(1, 1, 0, 255, 0);
    const result = e.composite(left, right);

    // R = left 灰度 ≈ 76
    expect(result.data[0]).toBeCloseTo(76, 0);
    // G = right 灰度 ≈ 150
    expect(result.data[1]).toBeCloseTo(150, 0);
  });
});

// ── 尺寸 ────────────────────────────────────────────────────────────

describe('AnaglyphEffect dimensions', () => {
  it('output size = input size', () => {
    const e = new AnaglyphEffect();
    const left = createSolidImage(10, 20, 100, 100, 100);
    const right = createSolidImage(10, 20, 200, 200, 200);
    const result = e.composite(left, right);

    expect(result.width).toBe(10);
    expect(result.height).toBe(20);
    expect(result.data.length).toBe(10 * 20 * 4);
  });

  it('throws on size mismatch', () => {
    const e = new AnaglyphEffect();
    const left = createSolidImage(10, 10, 0, 0, 0);
    const right = createSolidImage(20, 10, 0, 0, 0);

    expect(() => e.composite(left, right)).toThrow();
  });
});

// ── alpha ───────────────────────────────────────────────────────────

describe('AnaglyphEffect alpha', () => {
  it('alpha = average of left and right', () => {
    const e = new AnaglyphEffect();
    const left = createSolidImage(1, 1, 100, 100, 100);
    left.data[3] = 200;
    const right = createSolidImage(1, 1, 100, 100, 100);
    right.data[3] = 100;

    const result = e.composite(left, right);
    expect(result.data[3]).toBeCloseTo(150, 0); // (200 + 100) / 2
  });
});

// ── gamma ───────────────────────────────────────────────────────────

describe('AnaglyphEffect gamma', () => {
  it('gamma correction changes output values', () => {
    const e1 = new AnaglyphEffect({ colorMode: 'redCyan' });
    const e2 = new AnaglyphEffect({ colorMode: 'redCyan', gamma: 2.2 });

    const left = createSolidImage(1, 1, 128, 128, 128);
    const right = createSolidImage(1, 1, 128, 128, 128);

    const r1 = e1.composite(left, right);
    const r2 = e2.composite(left, right);

    // gamma 2.2 对 128: 255 * (128/255)^2.2 ≈ 56
    expect(r2.data[0]).toBeLessThan(r1.data[0]);
    expect(r2.data[0]).toBeCloseTo(56, -1); // 宽松精度
  });
});

// ── 多像素 ──────────────────────────────────────────────────────────

describe('AnaglyphEffect multi-pixel', () => {
  it('processes each pixel independently', () => {
    const e = new AnaglyphEffect({ colorMode: 'redCyan' });
    // 2x1 图像:左眼像素0=(100,0,0),像素1=(50,0,0)
    const left = createSolidImage(2, 1, 100, 0, 0);
    left.data[4] = 50; // 像素1 的 R

    const right = createSolidImage(2, 1, 0, 200, 0);
    right.data[5] = 100; // 像素1 的 G (index = pixel*4 + 1)

    const result = e.composite(left, right);

    // 像素0: R=100, G=200
    expect(result.data[0]).toBeCloseTo(100, 0);
    expect(result.data[1]).toBeCloseTo(200, 0);
    // 像素1: R=50, G=100
    expect(result.data[4]).toBeCloseTo(50, 0);
    expect(result.data[5]).toBeCloseTo(100, 0);
  });
});

// ── createSolidImage ───────────────────────────────────────────────

describe('createSolidImage', () => {
  it('creates uniform image', () => {
    const img = createSolidImage(3, 2, 10, 20, 30);
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(img.data.length).toBe(3 * 2 * 4);
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(10);
      expect(img.data[i + 1]).toBe(20);
      expect(img.data[i + 2]).toBe(30);
      expect(img.data[i + 3]).toBe(255);
    }
  });
});

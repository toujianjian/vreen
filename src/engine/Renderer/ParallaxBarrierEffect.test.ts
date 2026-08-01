// ParallaxBarrierEffect 单元测试 (视差屏障立体合成)。
//
// 覆盖:
//   1. 构造默认值 + 配置
//   2. horizontal 模式:偶数行=左眼,奇数行=右眼
//   3. vertical 模式:偶数列=左眼,奇数列=右眼
//   4. checkerboard 模式:棋盘格分布
//   5. swapEyes 反转左右眼
//   6. 尺寸不匹配抛错
//   7. 输出尺寸 = 输入尺寸
//   8. generateMask 掩码图验证
//   9. 每像素严格来自左眼或右眼(无混合)

import { describe, it, expect } from 'vitest';
import { ParallaxBarrierEffect } from './ParallaxBarrierEffect';

/** 创建纯色图像。 */
function solidImage(w: number, h: number, r: number, g: number, b: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

/** 读取像素 (x, y) 的 RGB。 */
function pixel(img: { data: Uint8ClampedArray; width: number }, x: number, y: number): [number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('ParallaxBarrierEffect construction', () => {
  it('defaults: horizontal, no swap', () => {
    const e = new ParallaxBarrierEffect();
    expect(e.mode).toBe('horizontal');
    expect(e.swapEyes).toBe(false);
  });

  it('accepts custom options', () => {
    const e = new ParallaxBarrierEffect({ mode: 'vertical', swapEyes: true });
    expect(e.mode).toBe('vertical');
    expect(e.swapEyes).toBe(true);
  });

  it('setMode updates mode', () => {
    const e = new ParallaxBarrierEffect();
    e.setMode('checkerboard');
    expect(e.mode).toBe('checkerboard');
  });

  it('setSwapEyes updates flag', () => {
    const e = new ParallaxBarrierEffect();
    e.setSwapEyes(true);
    expect(e.swapEyes).toBe(true);
  });
});

// ── horizontal 模式 ────────────────────────────────────────────────

describe('ParallaxBarrierEffect horizontal', () => {
  it('even rows from left, odd rows from right', () => {
    const e = new ParallaxBarrierEffect({ mode: 'horizontal' });
    const left = solidImage(2, 4, 100, 0, 0);   // 红色
    const right = solidImage(2, 4, 0, 200, 0);   // 绿色
    const result = e.composite(left, right);

    // 行 0 (偶数) = 左眼 = 红
    expect(pixel(result, 0, 0)).toEqual([100, 0, 0]);
    expect(pixel(result, 1, 0)).toEqual([100, 0, 0]);
    // 行 1 (奇数) = 右眼 = 绿
    expect(pixel(result, 0, 1)).toEqual([0, 200, 0]);
    expect(pixel(result, 1, 1)).toEqual([0, 200, 0]);
    // 行 2 (偶数) = 左眼
    expect(pixel(result, 0, 2)).toEqual([100, 0, 0]);
    // 行 3 (奇数) = 右眼
    expect(pixel(result, 0, 3)).toEqual([0, 200, 0]);
  });
});

// ── vertical 模式 ──────────────────────────────────────────────────

describe('ParallaxBarrierEffect vertical', () => {
  it('even columns from left, odd columns from right', () => {
    const e = new ParallaxBarrierEffect({ mode: 'vertical' });
    const left = solidImage(4, 2, 100, 0, 0);   // 红色
    const right = solidImage(4, 2, 0, 200, 0);   // 绿色
    const result = e.composite(left, right);

    // 列 0 (偶数) = 左眼
    expect(pixel(result, 0, 0)).toEqual([100, 0, 0]);
    expect(pixel(result, 0, 1)).toEqual([100, 0, 0]);
    // 列 1 (奇数) = 右眼
    expect(pixel(result, 1, 0)).toEqual([0, 200, 0]);
    // 列 2 (偶数) = 左眼
    expect(pixel(result, 2, 0)).toEqual([100, 0, 0]);
    // 列 3 (奇数) = 右眼
    expect(pixel(result, 3, 0)).toEqual([0, 200, 0]);
  });
});

// ── checkerboard 模式 ─────────────────────────────────────────────

describe('ParallaxBarrierEffect checkerboard', () => {
  it('(x+y) even = left, odd = right', () => {
    const e = new ParallaxBarrierEffect({ mode: 'checkerboard' });
    const left = solidImage(4, 4, 100, 0, 0);
    const right = solidImage(4, 4, 0, 200, 0);
    const result = e.composite(left, right);

    // (0,0): 0+0=0 偶 → 左
    expect(pixel(result, 0, 0)).toEqual([100, 0, 0]);
    // (1,0): 1+0=1 奇 → 右
    expect(pixel(result, 1, 0)).toEqual([0, 200, 0]);
    // (0,1): 0+1=1 奇 → 右
    expect(pixel(result, 0, 1)).toEqual([0, 200, 0]);
    // (1,1): 1+1=2 偶 → 左
    expect(pixel(result, 1, 1)).toEqual([100, 0, 0]);
    // (2,2): 2+2=4 偶 → 左
    expect(pixel(result, 2, 2)).toEqual([100, 0, 0]);
    // (3,2): 3+2=5 奇 → 右
    expect(pixel(result, 3, 2)).toEqual([0, 200, 0]);
  });
});

// ── swapEyes ───────────────────────────────────────────────────────

describe('ParallaxBarrierEffect swapEyes', () => {
  it('reverses left/right assignment', () => {
    const e = new ParallaxBarrierEffect({ mode: 'horizontal', swapEyes: true });
    const left = solidImage(2, 2, 100, 0, 0);   // 红
    const right = solidImage(2, 2, 0, 200, 0);   // 绿
    const result = e.composite(left, right);

    // swapEyes: 偶数行 = 右眼 = 绿(不是红)
    expect(pixel(result, 0, 0)).toEqual([0, 200, 0]);
    // 奇数行 = 左眼 = 红
    expect(pixel(result, 0, 1)).toEqual([100, 0, 0]);
  });

  it('swapEyes toggles correctly', () => {
    const e = new ParallaxBarrierEffect({ mode: 'vertical' });
    const left = solidImage(2, 1, 50, 0, 0);
    const right = solidImage(2, 1, 0, 60, 0);

    const normal = e.composite(left, right);
    expect(pixel(normal, 0, 0)).toEqual([50, 0, 0]); // 偶列 = 左

    e.setSwapEyes(true);
    const swapped = e.composite(left, right);
    expect(pixel(swapped, 0, 0)).toEqual([0, 60, 0]); // 偶列 = 右
  });
});

// ── 尺寸 ────────────────────────────────────────────────────────────

describe('ParallaxBarrierEffect dimensions', () => {
  it('output size = input size', () => {
    const e = new ParallaxBarrierEffect();
    const left = solidImage(10, 20, 0, 0, 0);
    const right = solidImage(10, 20, 0, 0, 0);
    const result = e.composite(left, right);

    expect(result.width).toBe(10);
    expect(result.height).toBe(20);
    expect(result.data.length).toBe(10 * 20 * 4);
  });

  it('throws on size mismatch', () => {
    const e = new ParallaxBarrierEffect();
    const left = solidImage(10, 10, 0, 0, 0);
    const right = solidImage(20, 10, 0, 0, 0);
    expect(() => e.composite(left, right)).toThrow();
  });
});

// ── generateMask ───────────────────────────────────────────────────

describe('ParallaxBarrierEffect generateMask', () => {
  it('horizontal mask: even rows white, odd rows black', () => {
    const e = new ParallaxBarrierEffect({ mode: 'horizontal' });
    const mask = e.generateMask(2, 4);

    // 行 0 (偶) = 白
    expect(pixel(mask, 0, 0)).toEqual([255, 255, 255]);
    // 行 1 (奇) = 黑
    expect(pixel(mask, 0, 1)).toEqual([0, 0, 0]);
  });

  it('checkerboard mask alternates', () => {
    const e = new ParallaxBarrierEffect({ mode: 'checkerboard' });
    const mask = e.generateMask(2, 2);

    expect(pixel(mask, 0, 0)).toEqual([255, 255, 255]); // (0,0) 偶 → 白
    expect(pixel(mask, 1, 0)).toEqual([0, 0, 0]);       // (1,0) 奇 → 黑
    expect(pixel(mask, 0, 1)).toEqual([0, 0, 0]);       // (0,1) 奇 → 黑
    expect(pixel(mask, 1, 1)).toEqual([255, 255, 255]); // (1,1) 偶 → 白
  });
});

// ── 无混合验证 ─────────────────────────────────────────────────────

describe('ParallaxBarrierEffect no blending', () => {
  it('each pixel is exactly from left or right (no mix)', () => {
    const e = new ParallaxBarrierEffect({ mode: 'checkerboard' });
    const left = solidImage(3, 3, 10, 20, 30);
    const right = solidImage(3, 3, 40, 50, 60);
    const result = e.composite(left, right);

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const p = pixel(result, x, y);
        const isLeft = (x + y) % 2 === 0;
        if (isLeft) {
          expect(p).toEqual([10, 20, 30]);
        } else {
          expect(p).toEqual([40, 50, 60]);
        }
      }
    }
  });
});

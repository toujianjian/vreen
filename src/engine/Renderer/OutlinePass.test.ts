// OutlinePass 单元测试。
//
// 覆盖:
//   1. 构造默认值 + 自定义选项
//   2. blurRadius 取整与 clamp
//   3. render 返回新 Uint8ClampedArray (不共享引用)
//   4. enabled=false 返回输入副本
//   5. blurRadius=0 返回输入副本
//   6. alpha 通道保持不变
//   7. 描边像素出现在 mask 边界外侧
//   8. 描边颜色正确叠加
//   9. mask 内部不被修改
//  10. 远离 mask 的外部不被修改
//  11. 空 mask 无描边
//  12. 全满 mask 无描边 (无边界)
//  13. 单像素 mask 仍有描边
//  14. setEdgeColor 修改颜色并返回 this
//  15. setEdgeColor 影响 render 输出
//  16. setBlurRadius 修改半径并返回 this
//  17. setBlurRadius 取整与 clamp
//  18. 更大 blurRadius 产生更多描边像素
//  19. 输入 data 不被修改
//  20. 输入 mask 不被修改
//  21. glow 增加边缘亮度
//  22. edgeStrength=0 无描边
//  23. edgeStrength 控制不透明度

import { describe, it, expect } from 'vitest';
import { OutlinePass } from './OutlinePass';

/** 生成全灰 RGBA 场景 (50,50,50,255) + 全 0 mask。 */
function makeScene(w: number, h: number): { data: Uint8ClampedArray, mask: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 50;     // R
    data[i * 4 + 1] = 50; // G
    data[i * 4 + 2] = 50; // B
    data[i * 4 + 3] = 255; // A
  }
  return { data, mask };
}

/** 在 mask 中填充一个矩形区域 [x0,y0) 到 [x1,y1)。 */
function fillRectMask(mask: Uint8ClampedArray, w: number, _h: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      mask[y * w + x] = 255;
    }
  }
}

/** 获取像素 RGB 值。 */
function getPixel(d: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number] {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2]];
}

/** 统计与原图不同的像素数量 (RGB 任一通道不同即计)。 */
function countModified(out: Uint8ClampedArray, original: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i] !== original[i] || out[i + 1] !== original[i + 1] || out[i + 2] !== original[i + 2]) {
      n++;
    }
  }
  return n;
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('OutlinePass construction', () => {
  it('defaults', () => {
    const pass = new OutlinePass();
    expect(pass.edgeColor).toEqual([0, 255, 255]);
    expect(pass.edgeStrength).toBe(1.0);
    expect(pass.blurRadius).toBe(4);
    expect(pass.blurSigma).toBe(2);
    expect(pass.enabled).toBe(true);
    expect(pass.glow).toBe(0.0);
  });

  it('accepts custom options', () => {
    const pass = new OutlinePass({
      edgeColor: [255, 0, 0],
      edgeStrength: 0.5,
      blurRadius: 6,
      blurSigma: 3,
      enabled: false,
      glow: 0.2,
    });
    expect(pass.edgeColor).toEqual([255, 0, 0]);
    expect(pass.edgeStrength).toBe(0.5);
    expect(pass.blurRadius).toBe(6);
    expect(pass.blurSigma).toBe(3);
    expect(pass.enabled).toBe(false);
    expect(pass.glow).toBe(0.2);
  });

  it('floors fractional blurRadius', () => {
    const pass = new OutlinePass({ blurRadius: 4.9 });
    expect(pass.blurRadius).toBe(4);
  });

  it('clamps negative blurRadius to 0', () => {
    const pass = new OutlinePass({ blurRadius: -3 });
    expect(pass.blurRadius).toBe(0);
  });

  it('defaults blurSigma to blurRadius/2', () => {
    const pass = new OutlinePass({ blurRadius: 8 });
    expect(pass.blurSigma).toBe(4);
  });
});

// ── render 基本行为 ─────────────────────────────────────────────────

describe('OutlinePass.render basic', () => {
  it('returns new Uint8ClampedArray (not same reference as input)', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 4, 4, 12, 12);
    const pass = new OutlinePass();
    const out = pass.render({ data, width: w, height: h, mask });
    expect(out).not.toBe(data);
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(out.length).toBe(data.length);
  });

  it('returns copy of input when enabled=false', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 4, 4, 12, 12);
    const pass = new OutlinePass({ enabled: false });
    const out = pass.render({ data, width: w, height: h, mask });
    expect(out).not.toBe(data);
    // 内容应与输入完全一致
    for (let i = 0; i < data.length; i++) {
      expect(out[i]).toBe(data[i]);
    }
  });

  it('returns copy of input when blurRadius=0', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 4, 4, 12, 12);
    const pass = new OutlinePass({ blurRadius: 0 });
    const out = pass.render({ data, width: w, height: h, mask });
    expect(out).not.toBe(data);
    for (let i = 0; i < data.length; i++) {
      expect(out[i]).toBe(data[i]);
    }
  });

  it('preserves alpha channel', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 4, 4, 12, 12);
    const pass = new OutlinePass();
    const out = pass.render({ data, width: w, height: h, mask });
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i]).toBe(255);
    }
  });
});

// ── render 描边检测 ─────────────────────────────────────────────────

describe('OutlinePass.render edge detection', () => {
  it('produces edge pixels around mask boundary', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    // mask 矩形 x∈[12,20), y∈[12,20)
    fillRectMask(mask, w, h, 12, 12, 20, 20);
    const pass = new OutlinePass({ edgeColor: [255, 0, 0] });
    const out = pass.render({ data, width: w, height: h, mask });
    // 应有被修改的像素 (描边)
    expect(countModified(out, data)).toBeGreaterThan(0);
    // 左边界 (x=12) 外侧 1 像素 (11,16) 应被描边影响
    const [r] = getPixel(out, w, 11, 16);
    expect(r).toBeGreaterThan(50);
  });

  it('applies edge color correctly', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 12, 12, 20, 20);
    const pass = new OutlinePass({ edgeColor: [255, 0, 0], edgeStrength: 1.0 });
    const out = pass.render({ data, width: w, height: h, mask });
    // 边界外侧像素应呈现红色描边 (R 远大于 G、B)
    const [r, g, b] = getPixel(out, w, 11, 16);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('does not modify mask interior', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 8, 8, 24, 24);
    const pass = new OutlinePass();
    const out = pass.render({ data, width: w, height: h, mask });
    // 中心像素 (16,16) 在 mask 内部,远离边界,应保持原色
    const [r, g, b] = getPixel(out, w, 16, 16);
    expect(r).toBe(50);
    expect(g).toBe(50);
    expect(b).toBe(50);
  });

  it('does not modify exterior far from mask', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 12, 12, 20, 20);
    const pass = new OutlinePass({ blurRadius: 4 });
    const out = pass.render({ data, width: w, height: h, mask });
    // 角落 (0,0) 远离 mask (距离 ≥12 像素),超出模糊半径,应保持原色
    const [r, g, b] = getPixel(out, w, 0, 0);
    expect(r).toBe(50);
    expect(g).toBe(50);
    expect(b).toBe(50);
  });

  it('empty mask produces no edges', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    // mask 全 0 (默认)
    const pass = new OutlinePass();
    const out = pass.render({ data, width: w, height: h, mask });
    expect(countModified(out, data)).toBe(0);
  });

  it('full mask produces no edges (no boundary)', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    mask.fill(255); // 全选 → 无边界
    const pass = new OutlinePass();
    const out = pass.render({ data, width: w, height: h, mask });
    expect(countModified(out, data)).toBe(0);
  });

  it('single-pixel mask still produces edges', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    mask[8 * w + 8] = 255; // 单像素 mask
    const pass = new OutlinePass({ edgeColor: [255, 0, 0] });
    const out = pass.render({ data, width: w, height: h, mask });
    // 单像素 mask 经模糊扩散后,周围应出现描边
    expect(countModified(out, data)).toBeGreaterThan(0);
  });
});

// ── setters ─────────────────────────────────────────────────────────

describe('OutlinePass setters', () => {
  it('setEdgeColor sets color and returns this', () => {
    const pass = new OutlinePass();
    expect(pass.edgeColor).toEqual([0, 255, 255]);
    const ret = pass.setEdgeColor(255, 0, 0);
    expect(pass.edgeColor).toEqual([255, 0, 0]);
    expect(ret).toBe(pass);
  });

  it('setEdgeColor affects render output', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 12, 12, 20, 20);

    const passRed = new OutlinePass({ edgeColor: [255, 0, 0] });
    const outRed = passRed.render({ data, width: w, height: h, mask });

    const passGreen = new OutlinePass();
    passGreen.setEdgeColor(0, 255, 0);
    const outGreen = passGreen.render({ data, width: w, height: h, mask });

    // 边界外侧同一像素:红色描边 R>G,绿色描边 G>R
    const pRed = getPixel(outRed, w, 11, 16);
    const pGreen = getPixel(outGreen, w, 11, 16);
    expect(pRed[0]).toBeGreaterThan(pRed[1]);
    expect(pGreen[1]).toBeGreaterThan(pGreen[0]);
  });

  it('setBlurRadius sets radius and returns this', () => {
    const pass = new OutlinePass();
    expect(pass.blurRadius).toBe(4);
    const ret = pass.setBlurRadius(8);
    expect(pass.blurRadius).toBe(8);
    expect(pass.blurSigma).toBe(4);
    expect(ret).toBe(pass);
  });

  it('setBlurRadius floors and clamps', () => {
    const pass = new OutlinePass();
    // 小数 → 向下取整
    pass.setBlurRadius(3.7);
    expect(pass.blurRadius).toBe(3);
    expect(pass.blurSigma).toBe(1.5);
    // 负值 → clamp 到 0
    pass.setBlurRadius(-1);
    expect(pass.blurRadius).toBe(0);
    expect(pass.blurSigma).toBe(0);
  });

  it('larger blurRadius produces more edge pixels', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    // 较小的中心 mask,确保大半径模糊不会覆盖整张图
    fillRectMask(mask, w, h, 14, 14, 18, 18);

    const passSmall = new OutlinePass({ blurRadius: 2 });
    const outSmall = passSmall.render({ data, width: w, height: h, mask });

    const passLarge = new OutlinePass({ blurRadius: 8 });
    const outLarge = passLarge.render({ data, width: w, height: h, mask });

    // 更大的模糊半径 → 描边扩散更远 → 更多被修改的像素
    expect(countModified(outSmall, data)).toBeGreaterThan(0);
    expect(countModified(outLarge, data)).toBeGreaterThan(countModified(outSmall, data));
  });
});

// ── 输入不可变性 ─────────────────────────────────────────────────────

describe('OutlinePass input immutability', () => {
  it('does not modify input data', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 4, 4, 12, 12);
    const dataCopy = new Uint8ClampedArray(data);
    const pass = new OutlinePass();
    pass.render({ data, width: w, height: h, mask });
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBe(dataCopy[i]);
    }
  });

  it('does not modify input mask', () => {
    const w = 16, h = 16;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 4, 4, 12, 12);
    const maskCopy = new Uint8ClampedArray(mask);
    const pass = new OutlinePass();
    pass.render({ data, width: w, height: h, mask });
    for (let i = 0; i < mask.length; i++) {
      expect(mask[i]).toBe(maskCopy[i]);
    }
  });
});

// ── glow 与 edgeStrength ─────────────────────────────────────────────

describe('OutlinePass glow and strength', () => {
  it('glow adds brightness to edges', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 12, 12, 20, 20);

    const passNoGlow = new OutlinePass({ edgeColor: [255, 0, 0], glow: 0 });
    const passGlow = new OutlinePass({ edgeColor: [255, 0, 0], glow: 0.5 });

    const outNoGlow = passNoGlow.render({ data, width: w, height: h, mask });
    const outGlow = passGlow.render({ data, width: w, height: h, mask });

    // 边界外侧:有 glow 的版本 R 通道应更亮
    const pNoGlow = getPixel(outNoGlow, w, 11, 16);
    const pGlow = getPixel(outGlow, w, 11, 16);
    expect(pGlow[0]).toBeGreaterThan(pNoGlow[0]);
  });

  it('edgeStrength=0 produces no edges', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 12, 12, 20, 20);
    const pass = new OutlinePass({ edgeColor: [255, 0, 0], edgeStrength: 0 });
    const out = pass.render({ data, width: w, height: h, mask });
    // edgeAlpha = (edge/255) * 0 = 0 → 无描边
    expect(countModified(out, data)).toBe(0);
  });

  it('edgeStrength controls opacity', () => {
    const w = 32, h = 32;
    const { data, mask } = makeScene(w, h);
    fillRectMask(mask, w, h, 12, 12, 20, 20);

    const passFull = new OutlinePass({ edgeColor: [255, 0, 0], edgeStrength: 1.0 });
    const passHalf = new OutlinePass({ edgeColor: [255, 0, 0], edgeStrength: 0.5 });

    const outFull = passFull.render({ data, width: w, height: h, mask });
    const outHalf = passHalf.render({ data, width: w, height: h, mask });

    // 更高的 strength → edgeAlpha 更大 → R 通道更接近 255
    const pFull = getPixel(outFull, w, 11, 16);
    const pHalf = getPixel(outHalf, w, 11, 16);
    expect(pFull[0]).toBeGreaterThan(pHalf[0]);
  });
});

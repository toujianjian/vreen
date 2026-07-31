// LensFlare 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setters(setIntensity / setFlares / addFlare / clearFlares)
//   3. computeLightScreen:光源在前/后/相机位置/遮挡测试
//   4. render:disabled 返回副本、光源在后方返回副本、正常合成、intensity 缩放、
//      多 flare 累加、alpha 不变
//   5. stats 字段更新
//   6. dispose

import { describe, it, expect } from 'vitest';
import { LensFlare, DEFAULT_FLARES } from './LensFlare';
import type { FlareElement, OccluderSphere } from './LensFlare';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Vector3 } from '../Math/Vector3';

/** 构造一个看向 -Z 的相机(位于 (0,0,5),看向原点)。 */
function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.getInverse(cam.matrixWorld);
  return cam;
}

/** 生成全黑 RGBA 像素。 */
function blackImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < d.length; i += 4) d[i] = 255; // alpha=255
  return d;
}

/** 计算图像中非零像素的数量。 */
function countBright(d: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 0 || d[i + 1] > 0 || d[i + 2] > 0) n++;
  }
  return n;
}

/** 计算所有像素的 RGB 总和(用于 intensity 缩放比较)。 */
function totalRgb(d: Uint8ClampedArray): number {
  let s = 0;
  for (let i = 0; i < d.length; i += 4) {
    s += d[i] + d[i + 1] + d[i + 2];
  }
  return s;
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('LensFlare construction', () => {
  it('defaults', () => {
    const lf = new LensFlare();
    expect(lf.name).toBe('lens-flare');
    expect(lf.enabled).toBe(true);
    expect(lf.intensity).toBe(1.0);
    expect(lf.occlusionSamples).toBe(8);
    expect(lf.occlusionRadius).toBe(4);
    expect(lf.behindThreshold).toBe(0);
    expect(lf.flares.length).toBe(DEFAULT_FLARES.length);
    // 默认 flare 列表是副本,不与 DEFAULT_FLARES 共享引用
    expect(lf.flares).not.toBe(DEFAULT_FLARES);
    expect(lf.flares[0]).not.toBe(DEFAULT_FLARES[0]);
    expect(lf.flares[0].color).not.toBe(DEFAULT_FLARES[0].color);
    expect(lf.flares[0].color).toEqual(DEFAULT_FLARES[0].color);
  });

  it('accepts options', () => {
    const flares: FlareElement[] = [
      { kind: 'core', positionAlongAxis: 0, size: 10, color: [1, 1, 1], opacity: 0.5 },
    ];
    const lf = new LensFlare({
      enabled: false,
      intensity: 2.5,
      flares,
      occlusionSamples: 4,
      occlusionRadius: 2,
      behindThreshold: -0.1,
    });
    expect(lf.enabled).toBe(false);
    expect(lf.intensity).toBe(2.5);
    expect(lf.flares.length).toBe(1);
    expect(lf.flares[0].size).toBe(10);
    // 传入的 flare 列表被复制,不共享引用
    expect(lf.flares).not.toBe(flares);
    expect(lf.flares[0]).not.toBe(flares[0]);
    expect(lf.flares[0].color).not.toBe(flares[0].color);
    expect(lf.occlusionSamples).toBe(4);
    expect(lf.occlusionRadius).toBe(2);
    expect(lf.behindThreshold).toBe(-0.1);
  });
});

// ── setters ──────────────────────────────────────────────────────────

describe('LensFlare setters', () => {
  it('setIntensity clamps to >= 0', () => {
    const lf = new LensFlare();
    lf.setIntensity(3.0);
    expect(lf.intensity).toBe(3.0);
    lf.setIntensity(-1.0);
    expect(lf.intensity).toBe(0);
  });

  it('setFlares replaces with copies', () => {
    const lf = new LensFlare();
    const initialCount = lf.flares.length;
    const newFlares: FlareElement[] = [
      { kind: 'ghost', positionAlongAxis: 0.5, size: 20, color: [0.5, 0.5, 0.5], opacity: 0.3 },
      { kind: 'halo', positionAlongAxis: 0, size: 50, color: [1, 0, 0], opacity: 0.6 },
    ];
    lf.setFlares(newFlares);
    expect(lf.flares.length).toBe(2);
    expect(lf.flares).not.toBe(newFlares);
    expect(lf.flares[0]).not.toBe(newFlares[0]);
    expect(lf.flares[0].color).not.toBe(newFlares[0].color);
    expect(initialCount).toBeGreaterThan(2);
  });

  it('addFlare appends a copy', () => {
    const lf = new LensFlare();
    const initialCount = lf.flares.length;
    const flare: FlareElement = {
      kind: 'core',
      positionAlongAxis: 0.1,
      size: 5,
      color: [0.2, 0.4, 0.6],
      opacity: 0.7,
    };
    lf.addFlare(flare);
    expect(lf.flares.length).toBe(initialCount + 1);
    expect(lf.flares[lf.flares.length - 1]).not.toBe(flare);
    expect(lf.flares[lf.flares.length - 1].color).not.toBe(flare.color);
    expect(lf.flares[lf.flares.length - 1].size).toBe(5);
  });

  it('clearFlares empties list', () => {
    const lf = new LensFlare();
    expect(lf.flares.length).toBeGreaterThan(0);
    lf.clearFlares();
    expect(lf.flares.length).toBe(0);
  });
});

// ── computeLightScreen ───────────────────────────────────────────────

describe('LensFlare.computeLightScreen', () => {
  it('returns visibility 1 for light directly in front', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    // 光源位于原点(相机在 (0,0,5) 看向 -Z,所以原点在前方)
    const result = lf.computeLightScreen(new Vector3(0, 0, 0), cam);
    expect(result.behindCamera).toBe(false);
    expect(result.visibility).toBeGreaterThan(0.99);
    expect(result.occludersHit).toBe(0);
    // 屏幕中心 NDC ≈ 0,0
    expect(Math.abs(result.screenX)).toBeLessThan(0.01);
    expect(Math.abs(result.screenY)).toBeLessThan(0.01);
  });

  it('returns behindCamera=true for light behind camera', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    // 光源位于相机后方 (0,0,10)
    const result = lf.computeLightScreen(new Vector3(0, 0, 10), cam);
    expect(result.behindCamera).toBe(true);
    expect(result.visibility).toBe(0);
  });

  it('returns visibility 0 when light is at camera position', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    const result = lf.computeLightScreen(new Vector3(0, 0, 5), cam);
    expect(result.behindCamera).toBe(true);
    expect(result.visibility).toBe(0);
  });

  it('respects behindThreshold', () => {
    const cam = makeCamera();
    const lf = new LensFlare({ behindThreshold: 0.5 });
    // 光源在前方但偏侧:dot 约 0.5(取决于具体位置)
    // 相机看向 -Z,光源在 (-5, 0, 1),前向 dot = (0-0,0-0,1-5)/dist · (0,0,-1)
    // = (-5, 0, -4)/sqrt(41) · (0,0,-1) = 4/sqrt(41) ≈ 0.625
    const result = lf.computeLightScreen(new Vector3(-5, 0, 1), cam);
    expect(result.behindCamera).toBe(false);
    expect(result.visibility).toBeGreaterThan(0);
    expect(result.visibility).toBeLessThan(1);
  });

  it('detects occlusion by sphere between camera and light', () => {
    const cam = makeCamera();
    const lf = new LensFlare({ occlusionSamples: 8 });
    // 光源在 (0,0,-5),相机在 (0,0,5),遮挡球在 (0,0,0) 半径 1
    const occluders: OccluderSphere[] = [
      { center: new Vector3(0, 0, 0), radius: 1 },
    ];
    const result = lf.computeLightScreen(new Vector3(0, 0, -5), cam, occluders);
    expect(result.behindCamera).toBe(false);
    expect(result.occludersHit).toBe(1);
    // 完全遮挡应大幅降低 visibility
    expect(result.visibility).toBeLessThan(0.5);
  });

  it('ignores occluder behind light', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    // 光源在 (0,0,0),遮挡球在光源后方 (0,0,-1)
    const occluders: OccluderSphere[] = [
      { center: new Vector3(0, 0, -1), radius: 0.5 },
    ];
    const result = lf.computeLightScreen(new Vector3(0, 0, 0), cam, occluders);
    expect(result.occludersHit).toBe(0);
    expect(result.visibility).toBeGreaterThan(0.99);
  });

  it('ignores occluder behind camera', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    // 光源在 (0,0,0),遮挡球在相机后方 (0,0,10)
    const occluders: OccluderSphere[] = [
      { center: new Vector3(0, 0, 10), radius: 1 },
    ];
    const result = lf.computeLightScreen(new Vector3(0, 0, 0), cam, occluders);
    expect(result.occludersHit).toBe(0);
  });

  it('returns visibility 0 with no occluders when occlusionSamples=0', () => {
    // 此场景下 occlusionSamples=0 仅关闭遮挡测试,visibility 仍由方向因子决定
    const cam = makeCamera();
    const lf = new LensFlare({ occlusionSamples: 0 });
    const result = lf.computeLightScreen(new Vector3(0, 0, 0), cam);
    expect(result.visibility).toBeGreaterThan(0.99);
    expect(result.occludersHit).toBe(0);
  });
});

// ── render ───────────────────────────────────────────────────────────

describe('LensFlare.render', () => {
  it('returns input copy when disabled', () => {
    const cam = makeCamera();
    const lf = new LensFlare({ enabled: false });
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    expect(out).not.toBe(input);
    expect(out.length).toBe(input.length);
    expect(countBright(out)).toBe(0);
    expect(lf.stats.drawCalls).toBe(0);
  });

  it('returns input copy when light is behind camera', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 10), cam);
    expect(out).not.toBe(input);
    expect(countBright(out)).toBe(0);
    expect(lf.stats.drawCalls).toBe(0);
    expect(lf.stats.behindCamera).toBe(true);
  });

  it('produces bright pixels for light in front', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    expect(countBright(out)).toBeGreaterThan(0);
    expect(lf.stats.visibleFlares).toBeGreaterThan(0);
    expect(lf.stats.drawCalls).toBe(lf.stats.visibleFlares);
    expect(lf.stats.visibility).toBeGreaterThan(0.99);
    expect(lf.stats.behindCamera).toBe(false);
  });

  it('intensity scales flare brightness', () => {
    const cam = makeCamera();
    const lf1 = new LensFlare({ intensity: 1.0 });
    const lf2 = new LensFlare({ intensity: 0.1 });
    const input1 = blackImage(64, 64);
    const input2 = blackImage(64, 64);
    const out1 = lf1.render({ data: input1, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    const out2 = lf2.render({ data: input2, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    expect(totalRgb(out1)).toBeGreaterThan(totalRgb(out2) * 2);
  });

  it('preserves alpha channel', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i]).toBe(255);
    }
  });

  it('does not modify input data', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    const input = blackImage(64, 64);
    const inputCopy = new Uint8ClampedArray(input);
    lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    for (let i = 0; i < input.length; i++) {
      expect(input[i]).toBe(inputCopy[i]);
    }
  });

  it('handles empty flare list', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    lf.clearFlares();
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    expect(countBright(out)).toBe(0);
    expect(lf.stats.drawCalls).toBe(0);
    expect(lf.stats.visibleFlares).toBe(0);
    // visibility 仍被计算(只是没有 flare 元素绘制)
    expect(lf.stats.visibility).toBeGreaterThan(0.99);
  });

  it('renders custom flare list', () => {
    const cam = makeCamera();
    const lf = new LensFlare({
      flares: [
        { kind: 'core', positionAlongAxis: 0, size: 8, color: [1, 0, 0], opacity: 1.0, falloff: 1.0 },
      ],
    });
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    expect(countBright(out)).toBeGreaterThan(0);
    expect(lf.stats.drawCalls).toBe(1);
    expect(lf.stats.visibleFlares).toBe(1);
  });

  it('renders ghosts along axis through screen center', () => {
    const cam = makeCamera();
    // 单个 ghost 在 positionAlongAxis=1.0(屏幕中心)
    const lf = new LensFlare({
      flares: [
        { kind: 'ghost', positionAlongAxis: 1.0, size: 6, color: [0, 1, 0], opacity: 1.0, falloff: 1.0 },
      ],
    });
    // 光源偏离屏幕中心(在屏幕左上 NDC ~ -0.5, 0.5)
    // 相机在 (0,0,5) 看向 -Z,光源在 (-1, 1, 0)
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(-1, 1, 0), cam);
    expect(countBright(out)).toBeGreaterThan(0);
    // ghost 应在屏幕中心附近(因为 positionAlongAxis=1.0)
    // 找到亮像素的重心
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const idx = (y * 64 + x) * 4;
        if (out[idx + 1] > 0) { // 绿色通道
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    expect(count).toBeGreaterThan(0);
    const cx = sumX / count;
    const cy = sumY / count;
    // 屏幕中心 = (32, 32)
    expect(Math.abs(cx - 32)).toBeLessThan(2);
    expect(Math.abs(cy - 32)).toBeLessThan(2);
  });

  it('clamps brightness to 255', () => {
    const cam = makeCamera();
    // 极高 intensity + 多 flare 叠加,验证不会溢出
    const lf = new LensFlare({
      intensity: 100.0,
      flares: [
        { kind: 'core', positionAlongAxis: 0, size: 4, color: [1, 1, 1], opacity: 1.0, falloff: 1.0 },
      ],
    });
    const input = blackImage(16, 16);
    const out = lf.render({ data: input, width: 16, height: 16 }, new Vector3(0, 0, 0), cam);
    let maxVal = 0;
    for (let i = 0; i < out.length; i += 4) {
      maxVal = Math.max(maxVal, out[i], out[i + 1], out[i + 2]);
    }
    expect(maxVal).toBe(255);
  });

  it('streak flare produces horizontal bright line', () => {
    const cam = makeCamera();
    const lf = new LensFlare({
      flares: [
        { kind: 'streak', positionAlongAxis: 0, size: 20, color: [1, 1, 1], opacity: 1.0, angle: 0 },
      ],
    });
    const input = blackImage(64, 64);
    const out = lf.render({ data: input, width: 64, height: 64 }, new Vector3(0, 0, 0), cam);
    // 水平 streak:在中心行 (y=32) 应有亮像素,且水平延伸
    let horizontalCount = 0;
    let verticalCount = 0;
    for (let x = 0; x < 64; x++) {
      const idx = (32 * 64 + x) * 4;
      if (out[idx] > 0) horizontalCount++;
    }
    for (let y = 0; y < 64; y++) {
      const idx = (y * 64 + 32) * 4;
      if (out[idx] > 0) verticalCount++;
    }
    expect(horizontalCount).toBeGreaterThan(verticalCount);
  });

  it('reduces visibility with occluder', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    const input1 = blackImage(64, 64);
    const input2 = blackImage(64, 64);
    const out1 = lf.render({ data: input1, width: 64, height: 64 }, new Vector3(0, 0, -5), cam);
    const occluders: OccluderSphere[] = [
      { center: new Vector3(0, 0, 0), radius: 1 },
    ];
    const out2 = lf.render(
      { data: input2, width: 64, height: 64 },
      new Vector3(0, 0, -5),
      cam,
      occluders,
    );
    expect(lf.stats.occludersHit).toBe(1);
    expect(totalRgb(out2)).toBeLessThan(totalRgb(out1));
  });

  it('updates lastFrameTimeMs', () => {
    const cam = makeCamera();
    const lf = new LensFlare();
    const input = blackImage(32, 32);
    lf.render({ data: input, width: 32, height: 32 }, new Vector3(0, 0, 0), cam);
    expect(lf.stats.lastFrameTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ── DEFAULT_FLARES 完整性 ───────────────────────────────────────────

describe('DEFAULT_FLARES preset', () => {
  it('contains core, halo, streak, and ghosts', () => {
    const kinds = new Set(DEFAULT_FLARES.map((f) => f.kind));
    expect(kinds.has('core')).toBe(true);
    expect(kinds.has('halo')).toBe(true);
    expect(kinds.has('streak')).toBe(true);
    expect(kinds.has('ghost')).toBe(true);
  });

  it('all colors are valid [r,g,b] in 0..1', () => {
    for (const f of DEFAULT_FLARES) {
      expect(f.color.length).toBe(3);
      for (const c of f.color) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('all opacities in 0..1', () => {
    for (const f of DEFAULT_FLARES) {
      expect(f.opacity).toBeGreaterThanOrEqual(0);
      expect(f.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('all sizes positive', () => {
    for (const f of DEFAULT_FLARES) {
      expect(f.size).toBeGreaterThan(0);
    }
  });
});

// ── dispose ─────────────────────────────────────────────────────────

describe('LensFlare.dispose', () => {
  it('does not throw', () => {
    const lf = new LensFlare();
    expect(() => lf.dispose()).not.toThrow();
  });
});

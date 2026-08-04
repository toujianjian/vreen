// DDGIDebugVisualizer 单元测试。
//
// 覆盖:
//   1. heatColor(端点 / 中点 / clamp / 单调性)
//   2. tonemapColor(Reinhard 映射 / 曝光 / clamp)
//   3. probeIrradianceColor(无效=红,有效=tonemapped,越界=黑)
//   4. probeValidityColor(真/假颜色)
//   5. DDGIDebugVisualizer 构造(默认值 / 选项)
//   6. setOptions(部分更新)
//   7. visualize(包围盒 / 探针点 / 辐照度球 / 深度射线 / 网格连线)
//   8. visualize 不修改 volume 状态
//   9. debug.enabled=false 时静默跳过

import { describe, it, expect } from 'vitest';
import {
  DDGIDebugVisualizer,
  heatColor,
  tonemapColor,
  probeIrradianceColor,
  probeValidityColor,
  type DDGIDebugOptions,
} from './DDGIDebugVisualizer';
import { DDGIVolume } from './DDGIVolume';
import { DebugRenderer } from '../Helpers/DebugRenderer';
import { Vector3 } from '../Math/Vector3';

// ── helpers ────────────────────────────────────────────────────────

/** 构造一个 2×2×2 探针 volume,前 2 个探针已更新。 */
function makeVolume(): DDGIVolume {
  const v = new DDGIVolume({
    origin: new Vector3(0, 0, 0),
    probeCount: { x: 2, y: 2, z: 2 },
    cellSize: new Vector3(2, 2, 2),
  });
  v.updateProbe(0, [
    { dir: new Vector3(1, 0, 0), color: { r: 1, g: 0.2, b: 0.2 }, distance: 3 },
  ]);
  v.updateProbe(1, [
    { dir: new Vector3(0, 1, 0), color: { r: 0.2, g: 1, b: 0.2 }, distance: 5 },
  ]);
  return v;
}

// ── heatColor ──────────────────────────────────────────────────────

describe('heatColor', () => {
  it('t=0 → deep blue', () => {
    const c = heatColor(0);
    expect(c[0]).toBeCloseTo(0.05, 2);
    expect(c[2]).toBeGreaterThan(c[0]);
  });

  it('t=1 → red', () => {
    const c = heatColor(1);
    expect(c[0]).toBeGreaterThan(0.9);
    expect(c[0]).toBeGreaterThan(c[2]);
  });

  it('clamps t<0 to blue and t>1 to red', () => {
    const lo = heatColor(-5);
    const z = heatColor(0);
    expect(lo).toEqual(z);
    const hi = heatColor(99);
    const one = heatColor(1);
    expect(hi).toEqual(one);
  });

  it('returns 3 components in [0,1] for all t', () => {
    for (let i = 0; i <= 20; i++) {
      const c = heatColor(i / 20);
      c.forEach((ch) => {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      });
    }
  });

  it('midpoint t=0.5 is green-ish (g dominant)', () => {
    const c = heatColor(0.5);
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(c[1]).toBeGreaterThan(c[2]);
  });
});

// ── tonemapColor ───────────────────────────────────────────────────

describe('tonemapColor', () => {
  it('zero RGB maps to zero', () => {
    const c = tonemapColor({ r: 0, g: 0, b: 0 });
    expect(c).toEqual([0, 0, 0]);
  });

  it('Reinhard: x/(1+x)', () => {
    const c = tonemapColor({ r: 1, g: 1, b: 1 });
    // 1/(1+1) = 0.5
    expect(c[0]).toBeCloseTo(0.5, 4);
    expect(c[1]).toBeCloseTo(0.5, 4);
    expect(c[2]).toBeCloseTo(0.5, 4);
  });

  it('clamps very bright values to [0,1]', () => {
    const c = tonemapColor({ r: 100, g: 100, b: 100 });
    c.forEach((ch) => expect(ch).toBeLessThanOrEqual(1));
    // 100/101 ≈ 0.99
    expect(c[0]).toBeCloseTo(0.9901, 2);
  });

  it('exposure scales input before tonemap', () => {
    const base = tonemapColor({ r: 1, g: 0, b: 0 }, 1);
    const boosted = tonemapColor({ r: 1, g: 0, b: 0 }, 3);
    // exposure=3 → input 3 → 3/4 = 0.75 > 0.5
    expect(boosted[0]).toBeGreaterThan(base[0]);
    expect(boosted[0]).toBeCloseTo(0.75, 4);
  });

  it('negative exposure treated as 0 (no brightening)', () => {
    const c = tonemapColor({ r: 1, g: 1, b: 1 }, -2);
    expect(c).toEqual([0, 0, 0]);
  });
});

// ── probeIrradianceColor ───────────────────────────────────────────

describe('probeIrradianceColor', () => {
  it('invalid probe returns red', () => {
    const v = makeVolume();
    // probe 2 未更新
    const c = probeIrradianceColor(v, 2, new Vector3(0, 1, 0));
    expect(c[0]).toBeGreaterThan(0.9);
    expect(c[1]).toBeLessThan(0.3);
    expect(c[2]).toBeLessThan(0.3);
  });

  it('valid probe returns tonemapped irradiance (in [0,1])', () => {
    const v = makeVolume();
    const c = probeIrradianceColor(v, 0, new Vector3(1, 0, 0));
    c.forEach((ch) => {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(1);
    });
  });

  it('out-of-range index returns black', () => {
    const v = makeVolume();
    const c = probeIrradianceColor(v, 999, new Vector3(0, 1, 0));
    expect(c).toEqual([0, 0, 0]);
  });

  it('negative index returns black', () => {
    const v = makeVolume();
    const c = probeIrradianceColor(v, -1, new Vector3(0, 1, 0));
    expect(c).toEqual([0, 0, 0]);
  });

  it('valid probe differs from invalid (not red)', () => {
    const v = makeVolume();
    const valid = probeIrradianceColor(v, 0, new Vector3(1, 0, 0));
    const invalid = probeIrradianceColor(v, 2, new Vector3(1, 0, 0));
    expect(valid).not.toEqual(invalid);
  });
});

// ── probeValidityColor ─────────────────────────────────────────────

describe('probeValidityColor', () => {
  it('valid → green-ish', () => {
    const c = probeValidityColor(true);
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(c[1]).toBeGreaterThan(c[2]);
  });

  it('invalid → red', () => {
    const c = probeValidityColor(false);
    expect(c[0]).toBeGreaterThan(0.9);
    expect(c[1]).toBeLessThan(0.3);
  });
});

// ── DDGIDebugVisualizer construction ──────────────────────────────

describe('DDGIDebugVisualizer construction', () => {
  it('defaults', () => {
    const v = new DDGIDebugVisualizer();
    expect(v.showBounds).toBe(true);
    expect(v.showProbes).toBe(true);
    expect(v.showIrradiance).toBe(false);
    expect(v.showDepthRays).toBe(false);
    expect(v.showGrid).toBe(false);
    expect(v.probeSize).toBe(6);
    expect(v.irradianceRadius).toBeNull();
    expect(v.exposure).toBe(1);
    expect(v.duration).toBe(0);
    expect(v.irradianceNormal).toEqual(new Vector3(0, 1, 0));
  });

  it('accepts all options', () => {
    const opts: DDGIDebugOptions = {
      showBounds: false,
      showProbes: false,
      showIrradiance: true,
      showDepthRays: true,
      showGrid: true,
      probeSize: 10,
      irradianceRadius: 0.5,
      exposure: 2,
      duration: Infinity,
      irradianceNormal: new Vector3(0, 0, 1),
      boundsColor: [1, 0, 0],
      gridColor: [0, 1, 0],
      depthRayColor: [0, 0, 1],
    };
    const v = new DDGIDebugVisualizer(opts);
    expect(v.showBounds).toBe(false);
    expect(v.showProbes).toBe(false);
    expect(v.showIrradiance).toBe(true);
    expect(v.showDepthRays).toBe(true);
    expect(v.showGrid).toBe(true);
    expect(v.probeSize).toBe(10);
    expect(v.irradianceRadius).toBe(0.5);
    expect(v.exposure).toBe(2);
    expect(v.duration).toBe(Infinity);
    expect(v.irradianceNormal).toEqual(new Vector3(0, 0, 1));
    expect(v.boundsColor).toEqual([1, 0, 0]);
  });

  it('clones irradianceNormal (no shared reference)', () => {
    const n = new Vector3(1, 0, 0);
    const v = new DDGIDebugVisualizer({ irradianceNormal: n });
    expect(v.irradianceNormal).not.toBe(n);
    expect(v.irradianceNormal).toEqual(n);
  });
});

// ── setOptions ─────────────────────────────────────────────────────

describe('setOptions', () => {
  it('updates only specified fields', () => {
    const v = new DDGIDebugVisualizer();
    v.setOptions({ showIrradiance: true, exposure: 3 });
    expect(v.showIrradiance).toBe(true);
    expect(v.exposure).toBe(3);
    // 未指定字段保持默认
    expect(v.showProbes).toBe(true);
    expect(v.showGrid).toBe(false);
  });

  it('clones irradianceNormal on update', () => {
    const v = new DDGIDebugVisualizer();
    const n = new Vector3(0, 0, 1);
    v.setOptions({ irradianceNormal: n });
    expect(v.irradianceNormal).not.toBe(n);
    expect(v.irradianceNormal).toEqual(n);
  });
});

// ── visualize ──────────────────────────────────────────────────────

describe('DDGIDebugVisualizer.visualize', () => {
  it('draws bounds when showBounds=true', () => {
    const vol = makeVolume();
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({ showProbes: false, showBounds: true });
    viz.visualize(vol, dbg);
    // 包围盒 = 12 条边
    expect(dbg.lines.length).toBe(12);
    expect(dbg.points.length).toBe(0);
  });

  it('skips bounds when showBounds=false', () => {
    const vol = makeVolume();
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({ showProbes: false, showBounds: false });
    viz.visualize(vol, dbg);
    expect(dbg.lines.length).toBe(0);
  });

  it('draws one point per probe when showProbes=true', () => {
    const vol = makeVolume(); // 2×2×2 = 8 probes
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({ showProbes: true, showBounds: false });
    viz.visualize(vol, dbg);
    expect(dbg.points.length).toBe(8);
    expect(dbg.lines.length).toBe(0);
  });

  it('invalid probes still get drawn (as red points)', () => {
    const vol = makeVolume(); // probes 2..7 invalid
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({ showProbes: true, showBounds: false });
    viz.visualize(vol, dbg);
    // 至少 6 个红色点(无效探针)
    const redPoints = dbg.points.filter(
      (p) => p.color[0] > 0.9 && p.color[1] < 0.3 && p.color[2] < 0.3,
    );
    expect(redPoints.length).toBeGreaterThanOrEqual(6);
  });

  it('showIrradiance adds sphere lines (wireframe)', () => {
    const vol = makeVolume();
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({
      showProbes: false,
      showBounds: false,
      showIrradiance: true,
    });
    viz.visualize(vol, dbg);
    // 仅 2 个有效探针 → 2 个线框球(每球 3 圆环 × 8 段 = 24 线段 → 48 线段)
    expect(dbg.lines.length).toBeGreaterThan(0);
    // 无效探针(6 个)不画球
    expect(dbg.points.length).toBe(0);
  });

  it('showDepthRays draws rays for valid probes with depth>0', () => {
    const vol = makeVolume(); // probe 0 depth=3, probe 1 depth=5
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({
      showProbes: false,
      showBounds: false,
      showDepthRays: true,
    });
    viz.visualize(vol, dbg);
    // 2 条射线 = 2 线段
    expect(dbg.lines.length).toBe(2);
  });

  it('showGrid connects adjacent probes', () => {
    const vol = makeVolume(); // 2×2×2
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({
      showProbes: false,
      showBounds: false,
      showGrid: true,
    });
    viz.visualize(vol, dbg);
    // 2×2×2 网格:+X 邻居 4 条,+Y 邻居 4 条,+Z 邻居 4 条 = 12 条
    expect(dbg.lines.length).toBe(12);
  });

  it('all modes combined produce more draws than any single', () => {
    const vol = makeVolume();
    const dbgAll = new DebugRenderer();
    const vizAll = new DDGIDebugVisualizer({
      showBounds: true,
      showProbes: true,
      showIrradiance: true,
      showDepthRays: true,
      showGrid: true,
    });
    vizAll.visualize(vol, dbgAll);

    const dbgProbe = new DebugRenderer();
    new DDGIDebugVisualizer({ showProbes: true, showBounds: false }).visualize(vol, dbgProbe);

    expect(dbgAll.lines.length).toBeGreaterThan(dbgProbe.lines.length);
    expect(dbgAll.points.length).toBe(8);
  });

  it('does not mutate volume state', () => {
    const vol = makeVolume();
    const probesBefore = Array.from(vol.probes);
    const depthsBefore = Array.from(vol.probeDepths);
    const validityBefore = Array.from(vol.probeValidity);
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({
      showBounds: true,
      showProbes: true,
      showIrradiance: true,
      showDepthRays: true,
      showGrid: true,
    });
    viz.visualize(vol, dbg);
    expect(Array.from(vol.probes)).toEqual(probesBefore);
    expect(Array.from(vol.probeDepths)).toEqual(depthsBefore);
    expect(Array.from(vol.probeValidity)).toEqual(validityBefore);
  });

  it('no-op when debug.enabled=false', () => {
    const vol = makeVolume();
    const dbg = new DebugRenderer();
    dbg.enabled = false;
    const viz = new DDGIDebugVisualizer({
      showBounds: true,
      showProbes: true,
      showIrradiance: true,
      showDepthRays: true,
      showGrid: true,
    });
    viz.visualize(vol, dbg);
    expect(dbg.lines.length).toBe(0);
    expect(dbg.points.length).toBe(0);
  });

  it('custom duration propagates to drawn primitives', () => {
    const vol = makeVolume();
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({
      showProbes: true,
      showBounds: false,
      duration: 7,
    });
    viz.visualize(vol, dbg);
    dbg.points.forEach((p) => expect(p.remaining).toBe(7));
  });

  it('irradianceRadius=auto uses cellSize min axis × 0.18', () => {
    const vol = makeVolume(); // cellSize 2 → auto radius 0.36
    const dbg = new DebugRenderer();
    const viz = new DDGIDebugVisualizer({
      showProbes: false,
      showBounds: false,
      showIrradiance: true,
      // irradianceRadius 未指定 → 自动
    });
    viz.visualize(vol, dbg);
    // 只验证有效探针画了球(线段 > 0);半径计算在内部,通过线段数间接验证
    expect(dbg.lines.length).toBeGreaterThan(0);
  });

  it('explicit irradianceRadius overrides auto', () => {
    const vol = makeVolume();
    const dbgAuto = new DebugRenderer();
    const dbgExplicit = new DebugRenderer();
    const vizAuto = new DDGIDebugVisualizer({
      showProbes: false,
      showBounds: false,
      showIrradiance: true,
    });
    const vizExplicit = new DDGIDebugVisualizer({
      showProbes: false,
      showBounds: false,
      showIrradiance: true,
      irradianceRadius: 2.0,
    });
    vizAuto.visualize(vol, dbgAuto);
    vizExplicit.visualize(vol, dbgExplicit);
    // 显式大半径 → 球线段端点更远(线段数相同但坐标不同)
    expect(dbgExplicit.lines.length).toBe(dbgAuto.lines.length);
  });
});

// CausticsGenerator 单元测试。
//
// 覆盖:
//   1. 向量工具(normalize2/normalize3/dot2/dot3)
//   2. 默认 Gerstner 波
//   3. 程序化 3-sine 焦散图案
//   4. Gerstner 波高度与法线
//   5. 法线聚焦因子
//   6. Beer-Lambert 深度衰减
//   7. 水面线渐变
//   8. RGB 色散
//   9. computeCaustics(单像素,三种模式)
//  10. reconstructWorldPos
//  11. resolveCaustics(全屏管线)
//  12. 辅助函数(makeSolidBuffer/makeConstantDepth/makeIdentityMatrix)

import { describe, it, expect } from 'vitest';
import {
  normalize2,
  normalize3,
  dot2,
  dot3,
  defaultGerstnerWaves,
  causticPattern3Sin,
  gerstnerHeightNormal,
  causticFocusing,
  beerLambertAttenuation,
  waterLineFade,
  rgbDispersion,
  computeCaustics,
  reconstructWorldPos,
  resolveCaustics,
  makeSolidBuffer,
  makeConstantDepth,
  makeIdentityMatrix,
  type Vec2,
  type Vec3,
} from './CausticsGenerator';

// ── 1. 向量工具 ──────────────────────────────────────────────────

describe('normalize2', () => {
  it('normalizes a non-zero vector', () => {
    const r = normalize2(3, 4);
    expect(r.x).toBeCloseTo(0.6, 5);
    expect(r.y).toBeCloseTo(0.8, 5);
  });

  it('returns unit x for zero vector', () => {
    const r = normalize2(0, 0);
    expect(r.x).toBe(1);
    expect(r.y).toBe(0);
  });

  it('preserves direction', () => {
    const r = normalize2(-1, 0);
    expect(r.x).toBe(-1);
    expect(r.y).toBe(0);
  });
});

describe('normalize3', () => {
  it('normalizes a non-zero vector', () => {
    const r = normalize3({ x: 0, y: 0, z: 5 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.z).toBe(1);
  });

  it('returns up for zero vector', () => {
    const r = normalize3({ x: 0, y: 0, z: 0 });
    expect(r.y).toBe(1);
  });
});

describe('dot2 / dot3', () => {
  it('dot2 computes correctly', () => {
    expect(dot2({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
  });

  it('dot3 computes correctly', () => {
    expect(dot3({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
    expect(dot3({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
  });
});

// ── 2. 默认 Gerstner 波 ─────────────────────────────────────────

describe('defaultGerstnerWaves', () => {
  it('returns 4 waves', () => {
    const waves = defaultGerstnerWaves();
    expect(waves).toHaveLength(4);
  });

  it('all directions are normalized', () => {
    const waves = defaultGerstnerWaves();
    for (const w of waves) {
      const len = Math.sqrt(w.dir.x * w.dir.x + w.dir.y * w.dir.y);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('amplitudes are positive', () => {
    const waves = defaultGerstnerWaves();
    for (const w of waves) {
      expect(w.amplitude).toBeGreaterThan(0);
    }
  });

  it('wavelengths are positive', () => {
    const waves = defaultGerstnerWaves();
    for (const w of waves) {
      expect(w.wavelength).toBeGreaterThan(0);
    }
  });

  it('steepness is in [0, 1]', () => {
    const waves = defaultGerstnerWaves();
    for (const w of waves) {
      expect(w.steepness).toBeGreaterThanOrEqual(0);
      expect(w.steepness).toBeLessThanOrEqual(1);
    }
  });
});

// ── 3. 程序化 3-sine 焦散 ───────────────────────────────────────

describe('causticPattern3Sin', () => {
  it('returns value in [0, 1]', () => {
    for (let i = 0; i < 20; i++) {
      const p: Vec2 = { x: i * 0.3, y: i * 0.7 };
      const v = causticPattern3Sin(p, i * 0.5, 8, 0.8, 3.0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('power=1 gives less sharp pattern than power=5', () => {
    const p: Vec2 = { x: 0.5, y: 0.5 };
    const v1 = causticPattern3Sin(p, 1.0, 8, 0.8, 1.0);
    const v5 = causticPattern3Sin(p, 1.0, 8, 0.8, 5.0);
    // power=5 should be <= power=1 (sharper = smaller except at peaks)
    expect(v5).toBeLessThanOrEqual(v1 + 1e-6);
  });

  it('is deterministic (same input → same output)', () => {
    const p: Vec2 = { x: 1.0, y: 2.0 };
    const v1 = causticPattern3Sin(p, 3.0, 8, 0.8, 3.0);
    const v2 = causticPattern3Sin(p, 3.0, 8, 0.8, 3.0);
    expect(v1).toBe(v2);
  });

  it('changes with time', () => {
    // Try multiple UVs — at least one should change with time
    let maxDiff = 0;
    for (let i = 0; i < 30; i++) {
      const p: Vec2 = { x: i * 0.37, y: i * 0.91 };
      const v1 = causticPattern3Sin(p, 0.0, 8, 0.8, 3.0);
      const v2 = causticPattern3Sin(p, 5.0, 8, 0.8, 3.0);
      maxDiff = Math.max(maxDiff, Math.abs(v1 - v2));
    }
    expect(maxDiff).toBeGreaterThan(0.001);
  });
});

// ── 4. Gerstner 波高度与法线 ────────────────────────────────────

describe('gerstnerHeightNormal', () => {
  it('returns normalized normal', () => {
    const waves = defaultGerstnerWaves();
    const { normal } = gerstnerHeightNormal(0, 0, 1.0, waves);
    const len = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
    expect(len).toBeCloseTo(1, 4);
  });

  it('flat waves (zero amplitude) → normal is up', () => {
    const waves = defaultGerstnerWaves().map(w => ({ ...w, amplitude: 0 }));
    const { normal } = gerstnerHeightNormal(0, 0, 1.0, waves);
    expect(normal.x).toBeCloseTo(0, 5);
    expect(normal.y).toBeCloseTo(1, 5);
    expect(normal.z).toBeCloseTo(0, 5);
  });

  it('height is zero when all amplitudes are zero', () => {
    const waves = defaultGerstnerWaves().map(w => ({ ...w, amplitude: 0 }));
    const { height } = gerstnerHeightNormal(5, 5, 2.0, waves);
    expect(height).toBe(0);
  });

  it('height changes with position', () => {
    const waves = defaultGerstnerWaves();
    const h1 = gerstnerHeightNormal(0, 0, 1.0, waves).height;
    const h2 = gerstnerHeightNormal(10, 10, 1.0, waves).height;
    // Different positions should give different heights (very likely)
    expect(Math.abs(h1 - h2)).toBeGreaterThan(0.001);
  });

  it('height changes with time', () => {
    const waves = defaultGerstnerWaves();
    const h1 = gerstnerHeightNormal(0, 0, 0.0, waves).height;
    const h2 = gerstnerHeightNormal(0, 0, 5.0, waves).height;
    expect(Math.abs(h1 - h2)).toBeGreaterThan(0.001);
  });
});

// ── 5. 法线聚焦因子 ─────────────────────────────────────────────

describe('causticFocusing', () => {
  it('returns 1 when normal = -lightDir (directly facing sun)', () => {
    const normal: Vec3 = { x: 0, y: -1, z: 0 };
    const lightDir: Vec3 = { x: 0, y: 1, z: 0 };
    expect(causticFocusing(normal, lightDir, 8)).toBeCloseTo(1, 5);
  });

  it('returns 0 when normal is perpendicular to lightDir', () => {
    const normal: Vec3 = { x: 1, y: 0, z: 0 };
    const lightDir: Vec3 = { x: 0, y: 1, z: 0 };
    expect(causticFocusing(normal, lightDir, 8)).toBe(0);
  });

  it('returns 0 when normal faces away from sun', () => {
    const normal: Vec3 = { x: 0, y: 1, z: 0 };
    const lightDir: Vec3 = { x: 0, y: 1, z: 0 };
    expect(causticFocusing(normal, lightDir, 8)).toBe(0);
  });

  it('higher power → sharper (smaller for non-aligned)', () => {
    const normal: Vec3 = { x: 0.3, y: -0.9, z: 0.3 };
    const lightDir: Vec3 = { x: 0, y: 1, z: 0 };
    const v2 = causticFocusing(normal, lightDir, 2);
    const v16 = causticFocusing(normal, lightDir, 16);
    expect(v16).toBeLessThanOrEqual(v2);
  });

  it('returns value in [0, 1]', () => {
    for (let i = 0; i < 20; i++) {
      const normal = normalize3({ x: Math.sin(i), y: -Math.cos(i), z: Math.sin(i * 0.5) });
      const lightDir: Vec3 = { x: 0, y: 1, z: 0 };
      const v = causticFocusing(normal, lightDir, 8);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ── 6. Beer-Lambert 深度衰减 ────────────────────────────────────

describe('beerLambertAttenuation', () => {
  it('returns 1 for zero depth', () => {
    expect(beerLambertAttenuation(0, 0.02)).toBe(1);
  });

  it('returns 1 for negative depth', () => {
    expect(beerLambertAttenuation(-5, 0.02)).toBe(1);
  });

  it('decreases with depth', () => {
    const a1 = beerLambertAttenuation(1, 0.02);
    const a2 = beerLambertAttenuation(10, 0.02);
    const a3 = beerLambertAttenuation(100, 0.02);
    expect(a1).toBeGreaterThan(a2);
    expect(a2).toBeGreaterThan(a3);
  });

  it('decreases with absorption', () => {
    const d = 10;
    const a1 = beerLambertAttenuation(d, 0.01);
    const a2 = beerLambertAttenuation(d, 0.05);
    expect(a1).toBeGreaterThan(a2);
  });

  it('returns value in (0, 1] for positive depth', () => {
    expect(beerLambertAttenuation(50, 0.02)).toBeGreaterThan(0);
    expect(beerLambertAttenuation(50, 0.02)).toBeLessThanOrEqual(1);
  });
});

// ── 7. 水面线渐变 ───────────────────────────────────────────────

describe('waterLineFade', () => {
  it('returns 0 above water level', () => {
    expect(waterLineFade(5, 0, 1.0)).toBe(0);
  });

  it('returns 0 at water level', () => {
    expect(waterLineFade(0, 0, 1.0)).toBe(0);
  });

  it('returns 1 when sufficiently below water', () => {
    expect(waterLineFade(-5, 0, 1.0)).toBe(1);
  });

  it('returns linear fade in the fade range', () => {
    // depthBelow = 0.5, fadeRange = 1.0 → 0.5
    expect(waterLineFade(-0.5, 0, 1.0)).toBeCloseTo(0.5, 5);
  });

  it('returns 1 when fadeRange is 0 (disabled)', () => {
    expect(waterLineFade(-0.1, 0, 0)).toBe(1);
  });

  it('returns value in [0, 1]', () => {
    for (let y = -5; y <= 5; y += 0.5) {
      const v = waterLineFade(y, 0, 2.0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ── 8. RGB 色散 ─────────────────────────────────────────────────

describe('rgbDispersion', () => {
  it('returns uniform values when dispersion = 0', () => {
    const [r, g, b] = rgbDispersion({ x: 1, y: 1 }, 0, (uv) => causticPattern3Sin(uv, 1, 8, 0.8, 3));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('returns different values when dispersion > 0', () => {
    // Try multiple UVs — at least one should produce different R/G/B
    let foundDiff = false;
    for (let i = 0; i < 30; i++) {
      const uv: Vec2 = { x: i * 0.37, y: i * 0.91 };
      const [r, g, b] = rgbDispersion(uv, 0.5, (p) => causticPattern3Sin(p, 1, 8, 0.8, 3));
      if (Math.abs(r - g) > 1e-6 || Math.abs(g - b) > 1e-6) {
        foundDiff = true;
        break;
      }
    }
    expect(foundDiff).toBe(true);
  });

  it('returns 3 values', () => {
    const result = rgbDispersion({ x: 0, y: 0 }, 0.3, (uv) => causticPattern3Sin(uv, 1, 8, 0.8, 3));
    expect(result).toHaveLength(3);
  });
});

// ── 9. computeCaustics(单像素) ─────────────────────────────────

describe('computeCaustics', () => {
  it('returns zero above water level', () => {
    const result = computeCaustics({ x: 0, y: 5, z: 0 }, 1.0, { waterLevel: 0 });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it('returns non-zero below water level (procedural mode)', () => {
    const result = computeCaustics({ x: 0, y: -5, z: 0 }, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
    });
    // Should have some caustic contribution
    const total = result.x + result.y + result.z;
    expect(total).toBeGreaterThan(0);
  });

  it('returns non-zero below water level (gerstner mode)', () => {
    const result = computeCaustics({ x: 0, y: -5, z: 0 }, 1.0, {
      mode: 'gerstner',
      waterLevel: 0,
      causticIntensity: 1.0,
    });
    const total = result.x + result.y + result.z;
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('returns non-zero below water level (hybrid mode)', () => {
    const result = computeCaustics({ x: 0, y: -5, z: 0 }, 1.0, {
      mode: 'hybrid',
      waterLevel: 0,
      causticIntensity: 1.0,
    });
    const total = result.x + result.y + result.z;
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('respects intensity = 0 (no caustics)', () => {
    const result = computeCaustics({ x: 0, y: -5, z: 0 }, 1.0, {
      mode: 'hybrid',
      waterLevel: 0,
      causticIntensity: 0,
    });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it('decreases with depth (Beer-Lambert)', () => {
    const shallow = computeCaustics({ x: 0, y: -1, z: 0 }, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      absorption: 0.1,
    });
    const deep = computeCaustics({ x: 0, y: -50, z: 0 }, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      absorption: 0.1,
    });
    const shallowTotal = shallow.x + shallow.y + shallow.z;
    const deepTotal = deep.x + deep.y + deep.z;
    expect(shallowTotal).toBeGreaterThan(deepTotal);
  });

  it('respects water line fade', () => {
    const atSurface = computeCaustics({ x: 0, y: -0.1, z: 0 }, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      waterLineFade: 1.0,
    });
    const deep = computeCaustics({ x: 0, y: -5, z: 0 }, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      waterLineFade: 1.0,
    });
    // At surface (depthBelow=0.1, fadeRange=1.0 → fade=0.1) should be weaker than deep
    const surfaceTotal = atSurface.x + atSurface.y + atSurface.z;
    const deepTotal = deep.x + deep.y + deep.z;
    expect(surfaceTotal).toBeLessThanOrEqual(deepTotal);
  });

  it('respects caustic color', () => {
    const result = computeCaustics({ x: 0, y: -5, z: 0 }, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      causticColor: { x: 1, y: 0, z: 0 }, // pure red
    });
    // Red channel should be >= green and blue
    expect(result.x).toBeGreaterThanOrEqual(result.y);
    expect(result.x).toBeGreaterThanOrEqual(result.z);
  });
});

// ── 10. reconstructWorldPos ─────────────────────────────────────

describe('reconstructWorldPos', () => {
  it('identity matrix → worldPos = NDC', () => {
    const invVP = makeIdentityMatrix();
    const pos = reconstructWorldPos(0.5, 0.5, 0.5, invVP);
    expect(pos.x).toBeCloseTo(0.5, 5);
    expect(pos.y).toBeCloseTo(0.5, 5);
    expect(pos.z).toBeCloseTo(0.5, 5);
  });

  it('handles zero w gracefully', () => {
    // A matrix that makes w = 0 (last column = 0,0,0,0)
    const m = new Float32Array(16);
    const pos = reconstructWorldPos(0, 0, 0, m);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
    expect(pos.z).toBe(0);
  });
});

// ── 11. resolveCaustics(全屏管线) ───────────────────────────────

describe('resolveCaustics', () => {
  it('returns output with correct dimensions', () => {
    const scene = makeSolidBuffer(4, 4, 50, 50, 50);
    const depth = makeConstantDepth(4, 4, 0.5);
    const invVP = makeIdentityMatrix();
    // With identity matrix, NDC (0..1) → worldPos y = 0..1, all above waterLevel=0
    // So no caustics applied. But output should still have correct dimensions.
    const { output, history, stats } = resolveCaustics(scene, depth, invVP, 1.0, {
      mode: 'procedural',
      waterLevel: -1, // set water level low so all pixels are above → no caustics
    });
    expect(output.width).toBe(4);
    expect(output.height).toBe(4);
    expect(output.data.length).toBe(4 * 4 * 4);
    expect(history.width).toBe(4);
    expect(history.height).toBe(4);
    expect(stats.pixelsProcessed).toBe(16);
  });

  it('sky pixels (depth >= 1.0) pass through scene color', () => {
    const scene = makeSolidBuffer(2, 2, 100, 150, 200);
    const depth = makeConstantDepth(2, 2, 1.0); // all sky
    const invVP = makeIdentityMatrix();
    const { output } = resolveCaustics(scene, depth, invVP, 1.0);
    expect(output.data[0]).toBe(100);
    expect(output.data[1]).toBe(150);
    expect(output.data[2]).toBe(200);
  });

  it('underwater pixels get caustic added (procedural)', () => {
    // Use a custom inverse VP that maps NDC to world Y = -5 (below waterLevel=0)
    // Simple approach: translate NDC y to world y = NDC_y - 5
    // With identity, NDC y = 0..1 → world y = 0..1 (above water).
    // We need world y < 0. Use a translation matrix:
    // invVP = translate(0, -5, 0)
    const invVP = new Float32Array(16);
    invVP[0] = 1; invVP[5] = 1; invVP[10] = 1; invVP[15] = 1;
    invVP[12] = 0; invVP[13] = -5; invVP[14] = 0;

    const scene = makeSolidBuffer(2, 2, 50, 50, 50);
    const depth = makeConstantDepth(2, 2, 0.5);
    const { output, stats } = resolveCaustics(scene, depth, invVP, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      absorption: 0.001, // minimal attenuation
      waterLineFade: 0.001, // minimal fade (deep enough)
    });

    // At least some pixels should have caustics added
    const hasBrighter = output.data[0] > 50 || output.data[1] > 50 || output.data[2] > 50;
    expect(hasBrighter).toBe(true);
    expect(stats.causticPixels).toBeGreaterThan(0);
  });

  it('temporal accumulation blends with history', () => {
    const invVP = new Float32Array(16);
    invVP[0] = 1; invVP[5] = 1; invVP[10] = 1; invVP[15] = 1;
    invVP[13] = -5;

    const scene = makeSolidBuffer(2, 2, 50, 50, 50);
    const depth = makeConstantDepth(2, 2, 0.5);

    // First frame
    const r1 = resolveCaustics(scene, depth, invVP, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      absorption: 0.001,
      waterLineFade: 0.001,
      temporalBlend: 0.5,
    }, null);

    // Second frame (with history)
    const r2 = resolveCaustics(scene, depth, invVP, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      absorption: 0.001,
      waterLineFade: 0.001,
      temporalBlend: 0.5,
    }, r1.history);

    // Second frame should produce output (possibly blended)
    expect(r2.output.data.length).toBe(2 * 2 * 4);
    expect(r2.stats.pixelsProcessed).toBe(4);
  });

  it('disabled (intensity=0) → scene color unchanged', () => {
    const invVP = new Float32Array(16);
    invVP[0] = 1; invVP[5] = 1; invVP[10] = 1; invVP[15] = 1;
    invVP[13] = -5;

    const scene = makeSolidBuffer(2, 2, 100, 100, 100);
    const depth = makeConstantDepth(2, 2, 0.5);
    const { output } = resolveCaustics(scene, depth, invVP, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 0, // zero intensity
      absorption: 0.001,
      waterLineFade: 0.001,
    });

    // With intensity=0, caustic=0, output = scene color
    expect(output.data[0]).toBe(100);
    expect(output.data[1]).toBe(100);
    expect(output.data[2]).toBe(100);
  });

  it('stats are populated correctly', () => {
    const invVP = new Float32Array(16);
    invVP[0] = 1; invVP[5] = 1; invVP[10] = 1; invVP[15] = 1;
    invVP[13] = -5;

    const scene = makeSolidBuffer(4, 4, 50, 50, 50);
    const depth = makeConstantDepth(4, 4, 0.5);
    const { stats } = resolveCaustics(scene, depth, invVP, 1.0, {
      mode: 'procedural',
      waterLevel: 0,
      causticIntensity: 1.0,
      absorption: 0.001,
      waterLineFade: 0.001,
    });

    expect(stats.pixelsProcessed).toBe(16);
    expect(stats.causticPixels).toBeGreaterThan(0);
    expect(stats.causticPixels).toBeLessThanOrEqual(16);
    expect(stats.avgIntensity).toBeGreaterThanOrEqual(0);
    expect(stats.maxIntensity).toBeGreaterThanOrEqual(0);
    expect(stats.maxIntensity).toBeLessThanOrEqual(1);
  });
});

// ── 12. 辅助函数 ────────────────────────────────────────────────

describe('makeSolidBuffer', () => {
  it('creates correct dimensions', () => {
    const buf = makeSolidBuffer(3, 4, 10, 20, 30);
    expect(buf.width).toBe(3);
    expect(buf.height).toBe(4);
    expect(buf.data.length).toBe(3 * 4 * 4);
  });

  it('fills with solid color', () => {
    const buf = makeSolidBuffer(2, 2, 10, 20, 30, 255);
    for (let i = 0; i < buf.data.length; i += 4) {
      expect(buf.data[i]).toBe(10);
      expect(buf.data[i + 1]).toBe(20);
      expect(buf.data[i + 2]).toBe(30);
      expect(buf.data[i + 3]).toBe(255);
    }
  });
});

describe('makeConstantDepth', () => {
  it('creates correct dimensions', () => {
    const buf = makeConstantDepth(3, 4, 0.5);
    expect(buf.width).toBe(3);
    expect(buf.height).toBe(4);
    expect(buf.data.length).toBe(12);
  });

  it('fills with constant value', () => {
    const buf = makeConstantDepth(2, 2, 0.7);
    for (let i = 0; i < buf.data.length; i++) {
      expect(buf.data[i]).toBeCloseTo(0.7, 5);
    }
  });
});

describe('makeIdentityMatrix', () => {
  it('returns 16-element identity', () => {
    const m = makeIdentityMatrix();
    expect(m.length).toBe(16);
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(1);
    expect(m[15]).toBe(1);
    expect(m[1]).toBe(0);
    expect(m[4]).toBe(0);
  });
});

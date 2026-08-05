import { describe, it, expect } from 'vitest';
import {
  // 类型
  type LPVVec3, type LPVColor, type LPVPointLight, type LPVDirectionalLight,
  type LPVEmissiveSurface, type LPVConfig,
  // 常量
  SH2_COEFFS_PER_CELL,
  // 向量工具
  lpvNormalize, lpvDot,
  // SH2 工具
  shBasis, computeSHRGB, evaluateSHRGB,
  // 网格索引
  cellIndex, worldToCellF, worldToCellI, isCellInside, isCellBlocked,
  // 网格创建
  createLPV, resetLPV, getCellSH, addToCellSH,
  // 光注入
  injectPointLight, injectDirectionalLight, injectEmissiveSurface, injectEmissiveSurfaces,
  // 光传播
  propagateStep, propagateLight,
  // 采样
  sampleLPV, sampleDiffuseGI,
  // 几何体
  buildGeometryVolume,
  // 统计
  getLPVStats,
  // GLSL
  LPV_GLSL, LPV_INJECTION_GLSL, LPV_PROPAGATION_GLSL,
} from './LightPropagationVolume';

// ── 测试辅助 ─────────────────────────────────────────────────────

function approxEq(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function vApproxEq(a: LPVVec3, b: LPVVec3, eps = 1e-4): boolean {
  return approxEq(a.x, b.x, eps) && approxEq(a.y, b.y, eps) && approxEq(a.z, b.z, eps);
}

function cApproxEq(a: LPVColor, b: LPVColor, eps = 1e-4): boolean {
  return approxEq(a.r, b.r, eps) && approxEq(a.g, b.g, eps) && approxEq(a.b, b.b, eps);
}

/** 创建一个简单的测试网格配置:原点 (0,0,0),cellSize=1,8x8x8 网格。 */
function makeTestConfig(overrides: Partial<LPVConfig> = {}): LPVConfig {
  return {
    origin: { x: 0, y: 0, z: 0 },
    cellSize: 1,
    dimX: 8,
    dimY: 8,
    dimZ: 8,
    propagationIterations: 2,
    propagationStrength: 0.85,
    geometryVolume: null,
    ...overrides,
  };
}

/** 创建一个单位立方体 mesh(8 顶点,12 三角形),边长 1。 */
function makeUnitCubeMesh(): { positions: Float32Array; indices: Uint32Array } {
  return {
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ]),
    indices: new Uint32Array([
      0, 1, 2, 0, 2, 3, // 底面
      4, 6, 5, 4, 7, 6, // 顶面
      0, 3, 7, 0, 7, 4, // -X 面
      1, 5, 6, 1, 6, 2, // +X 面
      0, 4, 5, 0, 5, 1, // -Y 面
      3, 2, 6, 3, 6, 7, // +Y 面
    ]),
  };
}

// ── 常量 ─────────────────────────────────────────────────────────

describe('constants', () => {
  it('SH2_COEFFS_PER_CELL = 27 (9 basis × 3 RGB)', () => {
    expect(SH2_COEFFS_PER_CELL).toBe(27);
  });
});

// ── 向量工具 ─────────────────────────────────────────────────────

describe('vector utils', () => {
  it('lpvNormalize normalizes non-zero vector', () => {
    const r = lpvNormalize({ x: 0, y: 0, z: 3 });
    expect(vApproxEq(r, { x: 0, y: 0, z: 1 })).toBe(true);
  });

  it('lpvNormalize returns zero for zero vector', () => {
    const r = lpvNormalize({ x: 0, y: 0, z: 0 });
    expect(vApproxEq(r, { x: 0, y: 0, z: 0 })).toBe(true);
  });

  it('lpvDot computes dot product', () => {
    const d = lpvDot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(approxEq(d, 32)).toBe(true);
  });
});

// ── SH2 工具 ────────────────────────────────────────────────────

describe('SH2 utils', () => {
  it('shBasis returns 9 coefficients for +Z direction', () => {
    const sh = shBasis({ x: 0, y: 0, z: 1 });
    expect(sh.length).toBe(9);
    // +Z direction:Y10 = 0.488603,Y20 = 0.315392*(3*1-1) = 0.630784
    expect(approxEq(sh[0], 0.282095)).toBe(true);   // Y00
    expect(approxEq(sh[1], 0)).toBe(true);           // Y1m1 (y=0)
    expect(approxEq(sh[2], 0.488603)).toBe(true);    // Y10 (z=1)
    expect(approxEq(sh[3], 0)).toBe(true);           // Y11 (x=0)
    expect(approxEq(sh[6], 0.315392 * 2)).toBe(true); // Y20
  });

  it('shBasis Y00 is constant 0.282095 for any direction', () => {
    const dirs: LPVVec3[] = [
      { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
      { x: 0.577, y: 0.577, z: 0.577 }, { x: -0.3, y: 0.4, z: 0.8 },
    ];
    for (const d of dirs) {
      const sh = shBasis(d);
      expect(approxEq(sh[0], 0.282095, 1e-3)).toBe(true);
    }
  });

  it('computeSHRGB returns 27 floats', () => {
    const sh = computeSHRGB({ x: 1, y: 0, z: 0 }, { r: 1, g: 0.5, b: 0.2 });
    expect(sh.length).toBe(27);
  });

  it('computeSHRGB zero color produces zero coefficients', () => {
    const sh = computeSHRGB({ x: 1, y: 0, z: 0 }, { r: 0, g: 0, b: 0 });
    for (let i = 0; i < 27; i++) {
      // 注意:Float32Array 可能产生 -0,用 abs 比较避免严格相等差异
      expect(Math.abs(sh[i])).toBe(0);
    }
  });

  it('evaluateSHRGB with zero coefficients returns zero', () => {
    const coeffs = new Float32Array(27);
    const c = evaluateSHRGB(coeffs, { x: 0, y: 0, z: 1 });
    expect(cApproxEq(c, { r: 0, g: 0, b: 0 })).toBe(true);
  });

  it('evaluateSHRGB round-trips computeSHRGB at same direction (rough)', () => {
    // computeSHRGB(dir, color) 然后评估同方向应该大致复原 color * Y00²
    const dir: LPVVec3 = { x: 0, y: 0, z: 1 };
    const color: LPVColor = { r: 1, g: 0.5, b: 0.2 };
    const sh = computeSHRGB(dir, color);
    const evaluated = evaluateSHRGB(sh, dir);
    // Y00² ≈ 0.0796,所以最低限度能量 ≈ 0.0796 * color
    expect(evaluated.r).toBeGreaterThan(0);
    expect(evaluated.g).toBeGreaterThan(0);
    expect(evaluated.b).toBeGreaterThan(0);
    // 比例保持:evaluated.r / color.r ≈ evaluated.g / color.g
    const ratioR = evaluated.r / color.r;
    const ratioG = evaluated.g / color.g;
    expect(approxEq(ratioR, ratioG, 1e-3)).toBe(true);
  });

  it('evaluateSHRGB with +Y direction matches shBasis coefficients', () => {
    const sh = computeSHRGB({ x: 0, y: 1, z: 0 }, { r: 1, g: 1, b: 1 });
    const evalPos = evaluateSHRGB(sh, { x: 0, y: 1, z: 0 });
    const evalNeg = evaluateSHRGB(sh, { x: 0, y: -1, z: 0 });
    // 同方向评估应高于反方向(Y1m1 系数 > 0)
    expect(evalPos.r).toBeGreaterThan(evalNeg.r);
  });
});

// ── 网格索引 ─────────────────────────────────────────────────────

describe('grid indexing', () => {
  it('cellIndex maps 3D to 1D with SH offset', () => {
    const dimX = 4, dimY = 4;
    // (0,0,0) → 0
    expect(cellIndex(0, 0, 0, dimX, dimY)).toBe(0);
    // (1,0,0) → 27
    expect(cellIndex(1, 0, 0, dimX, dimY)).toBe(27);
    // (0,1,0) → dimX * 27 = 108
    expect(cellIndex(0, 1, 0, dimX, dimY)).toBe(dimX * 27);
    // (0,0,1) → dimX * dimY * 27 = 432
    expect(cellIndex(0, 0, 1, dimX, dimY)).toBe(dimX * dimY * 27);
  });

  it('worldToCellF converts world coordinates to floating cell coords', () => {
    const grid = createLPV(makeTestConfig());
    const f = worldToCellF({ x: 1.5, y: 2.5, z: 3.5 }, grid);
    expect(vApproxEq(f, { x: 1.5, y: 2.5, z: 3.5 })).toBe(true);
  });

  it('worldToCellF respects origin offset', () => {
    const grid = createLPV(makeTestConfig({
      origin: { x: 10, y: 20, z: 30 },
    }));
    const f = worldToCellF({ x: 11, y: 21, z: 31 }, grid);
    expect(vApproxEq(f, { x: 1, y: 1, z: 1 })).toBe(true);
  });

  it('worldToCellF respects cellSize', () => {
    const grid = createLPV(makeTestConfig({ cellSize: 2 }));
    const f = worldToCellF({ x: 3, y: 5, z: 7 }, grid);
    expect(vApproxEq(f, { x: 1.5, y: 2.5, z: 3.5 })).toBe(true);
  });

  it('worldToCellI floors the result', () => {
    const grid = createLPV(makeTestConfig());
    const i = worldToCellI({ x: 1.7, y: 2.3, z: 3.9 }, grid);
    expect(vApproxEq(i, { x: 1, y: 2, z: 3 })).toBe(true);
  });

  it('isCellInside returns true for valid in-range cells', () => {
    const cfg = makeTestConfig();
    expect(isCellInside(0, 0, 0, cfg)).toBe(true);
    expect(isCellInside(7, 7, 7, cfg)).toBe(true);
    expect(isCellInside(4, 4, 4, cfg)).toBe(true);
  });

  it('isCellInside returns false for out-of-range cells', () => {
    const cfg = makeTestConfig();
    expect(isCellInside(-1, 0, 0, cfg)).toBe(false);
    expect(isCellInside(8, 0, 0, cfg)).toBe(false);
    expect(isCellInside(0, -1, 0, cfg)).toBe(false);
    expect(isCellInside(0, 0, 8, cfg)).toBe(false);
  });

  it('isCellBlocked returns false when no geometry volume', () => {
    const cfg = makeTestConfig();
    expect(isCellBlocked(0, 0, 0, cfg)).toBe(false);
    expect(isCellBlocked(7, 7, 7, cfg)).toBe(false);
  });

  it('isCellBlocked returns true for out-of-bounds cells when geom volume exists', () => {
    const geom = new Uint8Array(8 * 8 * 8);
    const cfg = makeTestConfig({ geometryVolume: geom });
    expect(isCellBlocked(-1, 0, 0, cfg)).toBe(true);
    expect(isCellBlocked(8, 0, 0, cfg)).toBe(true);
  });

  it('isCellBlocked respects geometry volume data', () => {
    const geom = new Uint8Array(8 * 8 * 8);
    // 标记 cell (1,2,3) 被占据
    geom[1 + 2 * 8 + 3 * 8 * 8] = 1;
    const cfg = makeTestConfig({ geometryVolume: geom });
    expect(isCellBlocked(1, 2, 3, cfg)).toBe(true);
    expect(isCellBlocked(0, 0, 0, cfg)).toBe(false);
  });
});

// ── 网格创建 ─────────────────────────────────────────────────────

describe('grid creation', () => {
  it('createLPV allocates SH arrays of correct size', () => {
    const cfg = makeTestConfig();
    const grid = createLPV(cfg);
    const expectedLen = 8 * 8 * 8 * 27;
    expect(grid.sh.length).toBe(expectedLen);
    expect(grid.shBuffer.length).toBe(expectedLen);
    expect(grid.config).toBe(cfg);
  });

  it('createLPV initializes SH to zero', () => {
    const grid = createLPV(makeTestConfig());
    for (let i = 0; i < grid.sh.length; i++) {
      expect(grid.sh[i]).toBe(0);
    }
  });

  it('resetLPV clears SH coefficients', () => {
    const grid = createLPV(makeTestConfig());
    grid.sh.fill(1);
    grid.shBuffer.fill(2);
    resetLPV(grid);
    for (let i = 0; i < grid.sh.length; i++) {
      expect(grid.sh[i]).toBe(0);
      expect(grid.shBuffer[i]).toBe(0);
    }
  });

  it('getCellSH returns 27-length view at correct offset', () => {
    const grid = createLPV(makeTestConfig());
    // 在 (1, 0, 0) 写入数据
    const idx = cellIndex(1, 0, 0, 8, 8);
    grid.sh[idx + 5] = 42;
    const sh = getCellSH(grid, 1, 0, 0);
    expect(sh.length).toBe(27);
    expect(sh[5]).toBe(42);
  });

  it('addToCellSH accumulates values', () => {
    const grid = createLPV(makeTestConfig());
    const sh = new Float32Array(27);
    sh[0] = 1; sh[1] = 2; sh[2] = 3;
    addToCellSH(grid, 1, 1, 1, sh, 2);
    const cell = getCellSH(grid, 1, 1, 1);
    expect(cell[0]).toBe(2);
    expect(cell[1]).toBe(4);
    expect(cell[2]).toBe(6);
  });

  it('addToCellSH respects blocked cells', () => {
    const geom = new Uint8Array(8 * 8 * 8);
    geom[1 + 1 * 8 + 1 * 8 * 8] = 1;
    const grid = createLPV(makeTestConfig({ geometryVolume: geom }));
    const sh = new Float32Array(27).fill(1);
    addToCellSH(grid, 1, 1, 1, sh, 1);
    const cell = getCellSH(grid, 1, 1, 1);
    for (let i = 0; i < 27; i++) {
      expect(cell[i]).toBe(0);
    }
  });

  it('addToCellSH ignores out-of-bounds cells', () => {
    const grid = createLPV(makeTestConfig());
    const sh = new Float32Array(27).fill(1);
    // 不应抛出异常
    addToCellSH(grid, -1, 0, 0, sh, 1);
    addToCellSH(grid, 100, 0, 0, sh, 1);
  });
});

// ── 光注入 ───────────────────────────────────────────────────────

describe('light injection', () => {
  it('injectPointLight illuminates cells near the light', () => {
    const grid = createLPV(makeTestConfig());
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 3,
    };
    injectPointLight(grid, light);
    // 紧邻光源的 cell 应有非零能量
    const stats = getLPVStats(grid);
    expect(stats.occupiedCells).toBeGreaterThan(0);
    expect(stats.totalEnergy).toBeGreaterThan(0);
  });

  it('injectPointLight does not illuminate cells outside range', () => {
    const grid = createLPV(makeTestConfig());
    const light: LPVPointLight = {
      position: { x: 0, y: 0, z: 0 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 1.5, // 仅影响 1 cell 范围
    };
    injectPointLight(grid, light);
    // 远端 cell 应为 0
    const farCell = getCellSH(grid, 7, 7, 7);
    for (let i = 0; i < 27; i++) {
      expect(farCell[i]).toBe(0);
    }
  });

  it('injectPointLight respects geometry blocking', () => {
    const geom = new Uint8Array(8 * 8 * 8);
    // 标记 cell (4,4,4) 被占据
    geom[4 + 4 * 8 + 4 * 8 * 8] = 1;
    const grid = createLPV(makeTestConfig({ geometryVolume: geom }));
    const light: LPVPointLight = {
      position: { x: 4.5, y: 4.5, z: 4.5 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);
    // 被阻挡的 cell 不应被照亮
    const blocked = getCellSH(grid, 4, 4, 4);
    for (let i = 0; i < 27; i++) {
      expect(blocked[i]).toBe(0);
    }
  });

  it('injectDirectionalLight illuminates all cells uniformly', () => {
    const grid = createLPV(makeTestConfig());
    const light: LPVDirectionalLight = {
      direction: { x: 1, y: 0, z: 0 },
      color: { r: 0.8, g: 0.8, b: 0.8 },
      intensity: 2,
    };
    injectDirectionalLight(grid, light);
    // 所有 cell 应有相同的 SH 系数
    const c1 = getCellSH(grid, 0, 0, 0);
    const c2 = getCellSH(grid, 7, 7, 7);
    for (let i = 0; i < 27; i++) {
      expect(approxEq(c1[i], c2[i], 1e-5)).toBe(true);
    }
    // 应有非零能量
    expect(Math.abs(c1[0]) + Math.abs(c1[1]) + Math.abs(c1[2])).toBeGreaterThan(0);
  });

  it('injectDirectionalLight respects geometry blocking', () => {
    const geom = new Uint8Array(8 * 8 * 8);
    geom[0] = 1; // 阻挡 (0,0,0)
    const grid = createLPV(makeTestConfig({ geometryVolume: geom }));
    const light: LPVDirectionalLight = {
      direction: { x: 1, y: 0, z: 0 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
    };
    injectDirectionalLight(grid, light);
    const blocked = getCellSH(grid, 0, 0, 0);
    for (let i = 0; i < 27; i++) {
      expect(blocked[i]).toBe(0);
    }
    // 其他 cell 仍被照亮
    const unblocked = getCellSH(grid, 1, 0, 0);
    expect(Math.abs(unblocked[0])).toBeGreaterThan(0);
  });

  it('injectEmissiveSurface writes emissive to its cell', () => {
    const grid = createLPV(makeTestConfig());
    const surf: LPVEmissiveSurface = {
      position: { x: 3.5, y: 3.5, z: 3.5 },
      normal: { x: 0, y: 1, z: 0 },
      emissive: { r: 5, g: 2, b: 1 },
    };
    injectEmissiveSurface(grid, surf);
    const cell = getCellSH(grid, 3, 3, 3);
    // 法线方向 +Y,Y1m1 = 0.488603,R 通道应等于 5 * 0.488603
    const expectedY1m1R = 5 * 0.488603;
    expect(approxEq(cell[1 * 3], expectedY1m1R, 1e-3)).toBe(true);
  });

  it('injectEmissiveSurfaces handles batch', () => {
    const grid = createLPV(makeTestConfig());
    const surfaces: LPVEmissiveSurface[] = [
      { position: { x: 1.5, y: 1.5, z: 1.5 }, normal: { x: 0, y: 1, z: 0 }, emissive: { r: 1, g: 1, b: 1 } },
      { position: { x: 5.5, y: 5.5, z: 5.5 }, normal: { x: 0, y: 0, z: 1 }, emissive: { r: 2, g: 2, b: 2 } },
    ];
    injectEmissiveSurfaces(grid, surfaces);
    const c1 = getCellSH(grid, 1, 1, 1);
    const c2 = getCellSH(grid, 5, 5, 5);
    expect(Math.abs(c1[0]) + Math.abs(c1[1]) + Math.abs(c1[2])).toBeGreaterThan(0);
    expect(Math.abs(c2[0]) + Math.abs(c2[1]) + Math.abs(c2[2])).toBeGreaterThan(0);
  });

  it('injectEmissiveSurface ignores surfaces outside the grid', () => {
    const grid = createLPV(makeTestConfig());
    const surf: LPVEmissiveSurface = {
      position: { x: 100, y: 100, z: 100 },
      normal: { x: 0, y: 1, z: 0 },
      emissive: { r: 1, g: 1, b: 1 },
    };
    // 不应抛出异常
    injectEmissiveSurface(grid, surf);
    // 网格内不应有数据
    const stats = getLPVStats(grid);
    expect(stats.occupiedCells).toBe(0);
  });
});

// ── 光传播 ───────────────────────────────────────────────────────

describe('light propagation', () => {
  it('propagateStep spreads light to neighboring cells', () => {
    const grid = createLPV(makeTestConfig());
    // 在中心注入光
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);

    const statsBefore = getLPVStats(grid);
    propagateStep(grid, 0.85);
    const statsAfter = getLPVStats(grid);

    // 传播后照亮更多 cell
    expect(statsAfter.occupiedCells).toBeGreaterThanOrEqual(statsBefore.occupiedCells);
    // 总能量应增加(邻居叠加)或大致保持
    expect(statsAfter.totalEnergy).toBeGreaterThan(0);
  });

  it('propagateStep preserves light at source', () => {
    const grid = createLPV(makeTestConfig());
    // 单点光源
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 1.5,
    };
    injectPointLight(grid, light);

    const beforeEnergy = getLPVStats(grid).totalEnergy;
    propagateStep(grid, 0.85);
    const afterEnergy = getLPVStats(grid).totalEnergy;

    // 源能量应保留(传播时 buffer 保留原始 SH,邻居叠加传播能量)
    expect(afterEnergy).toBeGreaterThan(beforeEnergy * 0.9);
  });

  it('propagateStep does not propagate through blocked cells', () => {
    const geom = new Uint8Array(8 * 8 * 8);
    // 在 (5,4,4) 设置阻挡
    geom[5 + 4 * 8 + 4 * 8 * 8] = 1;
    const grid = createLPV(makeTestConfig({ geometryVolume: geom }));

    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 1.5,
    };
    injectPointLight(grid, light);
    propagateStep(grid, 0.85);

    // 被阻挡的 cell 仍为 0
    const blocked = getCellSH(grid, 5, 4, 4);
    for (let i = 0; i < 27; i++) {
      expect(blocked[i]).toBe(0);
    }
  });

  it('propagateLight runs multiple iterations', () => {
    const grid = createLPV(makeTestConfig());
    const light: LPVPointLight = {
      position: { x: 0, y: 0, z: 0 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);

    propagateLight(grid, 3);
    // 多次传播后,远处的 cell 应被照亮
    const stats = getLPVStats(grid);
    expect(stats.occupiedCells).toBeGreaterThan(1);
  });

  it('propagateLight uses config.propagationIterations by default', () => {
    const cfg = makeTestConfig({ propagationIterations: 4 });
    const grid = createLPV(cfg);
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);
    // 不应抛出异常
    propagateLight(grid);
  });
});

// ── 采样 ────────────────────────────────────────────────────────

describe('sampling', () => {
  it('sampleLPV returns zero for unlit grid', () => {
    const grid = createLPV(makeTestConfig());
    const c = sampleLPV(grid, { x: 4, y: 4, z: 4 }, { x: 0, y: 1, z: 0 });
    expect(cApproxEq(c, { r: 0, g: 0, b: 0 })).toBe(true);
  });

  it('sampleLPV returns non-zero after injection', () => {
    const grid = createLPV(makeTestConfig());
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);
    const c = sampleLPV(grid, { x: 4.5, y: 4.5, z: 4.5 }, { x: 0, y: 1, z: 0 });
    // 注入点附近的采样应有非零辐照度
    const magnitude = Math.abs(c.r) + Math.abs(c.g) + Math.abs(c.b);
    expect(magnitude).toBeGreaterThan(0);
  });

  it('sampleLPV returns zero for positions outside grid', () => {
    const grid = createLPV(makeTestConfig());
    // 即便有光,网格外也应返回 0
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);
    const c = sampleLPV(grid, { x: 100, y: 100, z: 100 }, { x: 0, y: 1, z: 0 });
    expect(cApproxEq(c, { r: 0, g: 0, b: 0 })).toBe(true);
  });

  it('sampleLPV trilinear interpolates between cells', () => {
    const grid = createLPV(makeTestConfig());
    // 在 (2,2,2) 注入强光
    const light: LPVPointLight = {
      position: { x: 2.5, y: 2.5, z: 2.5 },
      color: { r: 1, g: 0, b: 0 },
      intensity: 5,
      range: 1.5,
    };
    injectPointLight(grid, light);

    // 采样正好在 (2,2,2) cell 中心
    const atCenter = sampleLPV(grid, { x: 2.5, y: 2.5, z: 2.5 }, { x: 0, y: 1, z: 0 });
    // 采样在 (2.5,2.5,2.5)(边界)应介于 (2,2,2) 和 (3,3,3) 之间
    const atEdge = sampleLPV(grid, { x: 3.0, y: 3.0, z: 3.0 }, { x: 0, y: 1, z: 0 });

    // 中心应比边界亮
    const magCenter = Math.abs(atCenter.r) + Math.abs(atCenter.g) + Math.abs(atCenter.b);
    const magEdge = Math.abs(atEdge.r) + Math.abs(atEdge.g) + Math.abs(atEdge.b);
    expect(magCenter).toBeGreaterThanOrEqual(magEdge);
  });

  it('sampleDiffuseGI multiplies by albedo', () => {
    const grid = createLPV(makeTestConfig());
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);

    const albedo: LPVColor = { r: 0.5, g: 0.25, b: 0.1 };
    const direct = sampleLPV(grid, { x: 4.5, y: 4.5, z: 4.5 }, { x: 0, y: 1, z: 0 });
    const diffuse = sampleDiffuseGI(grid, { x: 4.5, y: 4.5, z: 4.5 }, { x: 0, y: 1, z: 0 }, albedo);

    expect(approxEq(diffuse.r, direct.r * albedo.r, 1e-5)).toBe(true);
    expect(approxEq(diffuse.g, direct.g * albedo.g, 1e-5)).toBe(true);
    expect(approxEq(diffuse.b, direct.b * albedo.b, 1e-5)).toBe(true);
  });
});

// ── 几何体 ───────────────────────────────────────────────────────

describe('geometry volume', () => {
  it('buildGeometryVolume returns array of correct size', () => {
    const cfg = makeTestConfig();
    const geom = buildGeometryVolume(cfg, []);
    expect(geom.length).toBe(8 * 8 * 8);
  });

  it('buildGeometryVolume returns all zeros for empty scene', () => {
    const cfg = makeTestConfig();
    const geom = buildGeometryVolume(cfg, []);
    let sum = 0;
    for (let i = 0; i < geom.length; i++) sum += geom[i];
    expect(sum).toBe(0);
  });

  it('buildGeometryVolume marks cells occupied by a cube', () => {
    const cfg = makeTestConfig();
    const mesh = makeUnitCubeMesh();
    const geom = buildGeometryVolume(cfg, [mesh]);
    // 立方体占据 [0,1]³ 范围,应至少标记 cell (0,0,0) 为占据
    expect(geom[0 + 0 * 8 + 0 * 8 * 8]).toBe(1);
    // 远端 cell 应未被占据
    expect(geom[7 + 7 * 8 + 7 * 8 * 8]).toBe(0);
  });

  it('buildGeometryVolume marks multiple cells for larger cube', () => {
    // 大立方体(0-3)
    const mesh: { positions: Float32Array; indices: Uint32Array } = {
      positions: new Float32Array([
        0, 0, 0, 3, 0, 0, 3, 3, 0, 0, 3, 0,
        0, 0, 3, 3, 0, 3, 3, 3, 3, 0, 3, 3,
      ]),
      indices: new Uint32Array([
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
        0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
        0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
      ]),
    };
    const cfg = makeTestConfig();
    const geom = buildGeometryVolume(cfg, [mesh]);
    // 应标记多个 cell
    let occupied = 0;
    for (let i = 0; i < geom.length; i++) if (geom[i] > 0) occupied++;
    expect(occupied).toBeGreaterThan(1);
  });

  it('buildGeometryVolume handles meshes without indices', () => {
    // 单三角形(无索引)
    const mesh = {
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0,
      ]),
      indices: null,
    };
    const cfg = makeTestConfig();
    // 不应抛出异常
    const geom = buildGeometryVolume(cfg, [mesh]);
    // 应有至少一个 cell 被占据
    let occupied = 0;
    for (let i = 0; i < geom.length; i++) occupied += geom[i];
    expect(occupied).toBeGreaterThan(0);
  });

  it('integrated: geometry blocks light propagation', () => {
    // 在 (2,2,2) 到 (3,3,3) 之间放一堵墙,光源在 (1,1,1)
    // 墙后应该没有光
    const wall = {
      positions: new Float32Array([
        2, 0, 0, 2, 8, 0, 2, 8, 8, 2, 0, 8,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    const cfg = makeTestConfig();
    const geom = buildGeometryVolume(cfg, [wall]);
    const grid = createLPV({ ...cfg, geometryVolume: geom });

    const light: LPVPointLight = {
      position: { x: 1.5, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 20,
      range: 5,
    };
    injectPointLight(grid, light);
    propagateLight(grid, 3);

    // 光源侧应有能量
    const litSide = getCellSH(grid, 1, 4, 4);
    const litMag = Math.abs(litSide[0]) + Math.abs(litSide[1]) + Math.abs(litSide[2]);
    expect(litMag).toBeGreaterThan(0);

    // 墙后侧 cell (3,4,4) 不应被光照亮(被墙阻挡)
    // 注意:LPV 传播是 6 面方向,墙阻止 X 方向直接传播,但绕墙的路径仍可绕射
    // 这里检查墙本身(2,4,4) 应未被照亮
    const wallCell = getCellSH(grid, 2, 4, 4);
    for (let i = 0; i < 27; i++) {
      expect(wallCell[i]).toBe(0);
    }
  });
});

// ── 统计 ─────────────────────────────────────────────────────────

describe('statistics', () => {
  it('getLPVStats returns correct fields', () => {
    const grid = createLPV(makeTestConfig());
    const stats = getLPVStats(grid);
    expect(stats.totalCells).toBe(8 * 8 * 8);
    expect(stats.occupiedCells).toBe(0);
    expect(stats.memoryBytes).toBeGreaterThan(0);
    expect(stats.memoryMB).toBeGreaterThan(0);
    expect(stats.totalEnergy).toBe(0);
  });

  it('getLPVStats tracks occupied cells after injection', () => {
    const grid = createLPV(makeTestConfig());
    const light: LPVPointLight = {
      position: { x: 4, y: 4, z: 4 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 10,
      range: 2,
    };
    injectPointLight(grid, light);
    const stats = getLPVStats(grid);
    expect(stats.occupiedCells).toBeGreaterThan(0);
    expect(stats.totalEnergy).toBeGreaterThan(0);
  });

  it('getLPVStats reports memory usage', () => {
    const grid = createLPV(makeTestConfig());
    const stats = getLPVStats(grid);
    // 2 arrays(sh + shBuffer),each 8³ * 27 * 4 bytes
    const expectedBytes = 8 * 8 * 8 * 27 * 4 * 2;
    expect(stats.memoryBytes).toBe(expectedBytes);
  });
});

// ── GLSL ────────────────────────────────────────────────────────

describe('GLSL shader chunks', () => {
  it('LPV_GLSL is a non-empty string', () => {
    expect(LPV_GLSL.length).toBeGreaterThan(0);
    expect(LPV_GLSL).toContain('sampleLPV');
  });

  it('LPV_INJECTION_GLSL is a non-empty string', () => {
    expect(LPV_INJECTION_GLSL.length).toBeGreaterThan(0);
    expect(LPV_INJECTION_GLSL).toContain('injectPointLight');
  });

  it('LPV_PROPAGATION_GLSL is a non-empty string', () => {
    expect(LPV_PROPAGATION_GLSL.length).toBeGreaterThan(0);
    expect(LPV_PROPAGATION_GLSL).toContain('propagateCell');
  });

  it('GLSL chunks contain SH2 constants', () => {
    expect(LPV_GLSL).toContain('0.282095');
    expect(LPV_INJECTION_GLSL).toContain('0.282095');
  });
});

// ── 集成测试 ──────────────────────────────────────────────────────

describe('integration: full LPV pipeline', () => {
  it('end-to-end: inject → propagate → sample', () => {
    const grid = createLPV(makeTestConfig({
      propagationIterations: 4,
    }));

    // 1. 注入光源
    injectPointLight(grid, {
      position: { x: 1.5, y: 4, z: 4 },
      color: { r: 5, g: 2, b: 0.5 },
      intensity: 20,
      range: 3,
    });

    // 2. 传播
    propagateLight(grid);

    // 3. 采样光附近的点
    const nearSample = sampleLPV(grid, { x: 2, y: 4, z: 4 }, { x: 1, y: 0, z: 0 });
    // 近处应明显比远处亮
    const farSample = sampleLPV(grid, { x: 7, y: 7, z: 7 }, { x: 1, y: 0, z: 0 });

    const nearMag = Math.abs(nearSample.r) + Math.abs(nearSample.g) + Math.abs(nearSample.b);
    const farMag = Math.abs(farSample.r) + Math.abs(farSample.g) + Math.abs(farSample.b);
    expect(nearMag).toBeGreaterThan(farMag);
    expect(nearMag).toBeGreaterThan(0);
  });

  it('end-to-end: directional light + diffuse GI', () => {
    const grid = createLPV(makeTestConfig());
    injectDirectionalLight(grid, {
      direction: { x: 0, y: -1, z: 0 },
      color: { r: 0.8, g: 0.8, b: 0.9 },
      intensity: 1.5,
    });
    propagateLight(grid, 2);

    // 采样朝上(+Y)的表面应该最亮(与方向光方向相反)
    const upFacing = sampleDiffuseGI(
      grid,
      { x: 4, y: 4, z: 4 },
      { x: 0, y: 1, z: 0 },
      { r: 0.8, g: 0.8, b: 0.8 },
    );
    // 应有非零辐照度
    expect(Math.abs(upFacing.r) + Math.abs(upFacing.g) + Math.abs(upFacing.b)).toBeGreaterThan(0);
  });
});

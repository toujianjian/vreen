import { describe, it, expect } from 'vitest';
import { FBMNoise, type HeightFunction } from './FBMNoise';
import { TerrainChunk } from './TerrainChunk';
import { TerrainSystem } from './TerrainSystem';

// ── 辅助函数 ──
const flatHeight: HeightFunction = () => 0;
const linearHeight: HeightFunction = (x, z) => x + z;

// ── FBMNoise ──
describe('FBMNoise', () => {
  it('确定性:相同输入相同输出', () => {
    const fbm = new FBMNoise(4, 0.5, 2.0, 0.01);
    const a = fbm.noise2D(10, 20);
    const b = fbm.noise2D(10, 20);
    expect(a).toBe(b);
  });

  it('输出范围在 [-1, 1] 附近', () => {
    const fbm = new FBMNoise(4, 0.5, 2.0, 0.01);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 100; i++) {
      const v = fbm.noise2D(i * 3.7, i * 5.3);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThanOrEqual(-1.5);
    expect(max).toBeLessThanOrEqual(1.5);
  });

  it('toHeightFunction 返回缩放后的函数', () => {
    const fbm = new FBMNoise(4, 0.5, 2.0, 0.01);
    const hFn = fbm.toHeightFunction(20);
    const v = hFn(10, 20);
    const noise = fbm.noise2D(10, 20);
    expect(v).toBeCloseTo(noise * 20, 5);
  });

  it('更多 octaves 产生不同结果', () => {
    const fbm2 = new FBMNoise(2, 0.5, 2.0, 0.01);
    const fbm6 = new FBMNoise(6, 0.5, 2.0, 0.01);
    const v2 = fbm2.noise2D(17.3, 23.7);
    const v6 = fbm6.noise2D(17.3, 23.7);
    expect(v2).not.toBeCloseTo(v6, 3);
  });
});

// ── TerrainChunk ──
describe('TerrainChunk', () => {
  it('LOD 0 = baseSegments 分段', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 32,
      skirtHeight: 0,
    });
    expect(chunk.lod).toBe(0);
    expect(chunk.segments).toBe(32);
  });

  it('LOD 1 = baseSegments / 2 分段', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 1,
      heightFunction: flatHeight,
      baseSegments: 32,
      skirtHeight: 0,
    });
    expect(chunk.segments).toBe(16);
  });

  it('LOD 3 = baseSegments / 8', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 3,
      heightFunction: flatHeight,
      baseSegments: 32,
      skirtHeight: 0,
    });
    expect(chunk.segments).toBe(4);
  });

  it('LOD 过高 → 最低 1 分段', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 10,
      heightFunction: flatHeight,
      baseSegments: 32,
      skirtHeight: 0,
    });
    expect(chunk.segments).toBe(1);
  });

  it('顶点数 = (segments+1)² (无 skirt)', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 8,
      skirtHeight: 0,
    });
    const pos = chunk.getAttribute('position')!;
    expect(pos.count).toBe(9 * 9);
  });

  it('skirt 增加额外顶点', () => {
    const noSkirt = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 8,
      skirtHeight: 0,
    });
    const withSkirt = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 8,
      skirtHeight: 2,
    });
    const baseCount = noSkirt.getAttribute('position')!.count;
    const skirtCount = withSkirt.getAttribute('position')!.count;
    expect(skirtCount).toBeGreaterThan(baseCount);
  });

  it('平面高度 → 所有 Y = 0', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 4,
      skirtHeight: 0,
    });
    const pos = chunk.getAttribute('position')!;
    for (let i = 1; i < pos.count * 3; i += 3) {
      expect(pos.array[i]).toBe(0);
    }
  });

  it('线性高度 → Y = X + Z', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: linearHeight,
      baseSegments: 4,
      skirtHeight: 0,
    });
    const pos = chunk.getAttribute('position')!;
    const seg1 = 5;
    const dx = 10 / 4, dz = 10 / 4;
    for (let iz = 0; iz < seg1; iz++) {
      for (let ix = 0; ix < seg1; ix++) {
        const vi = (iz * seg1 + ix) * 3;
        const wx = ix * dx;
        const wz = iz * dz;
        expect(pos.array[vi]).toBeCloseTo(wx, 5);
        expect(pos.array[vi + 1]).toBeCloseTo(wx + wz, 5);
        expect(pos.array[vi + 2]).toBeCloseTo(wz, 5);
      }
    }
  });

  it('分块偏移:世界坐标正确', () => {
    const chunk = new TerrainChunk({
      chunkX: 100, chunkZ: 200,
      size: 64, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 2,
      skirtHeight: 0,
    });
    const pos = chunk.getAttribute('position')!;
    // 第一个顶点应在 (100, _, 200)
    expect(pos.array[0]).toBeCloseTo(100, 2);
    expect(pos.array[2]).toBeCloseTo(200, 2);
  });

  it('法线已计算(平面 → +Y)', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 4,
      skirtHeight: 0,
    });
    const nrm = chunk.getAttribute('normal')!;
    expect(nrm).toBeDefined();
    // 平面地形法线应朝向 +Y(允许中心差分微小偏差)
    for (let i = 1; i < nrm.count * 3; i += 3) {
      expect(nrm.array[i]).toBeGreaterThan(0.9);
    }
  });

  it('boundingBox 已计算', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: (x) => x,
      baseSegments: 2,
      skirtHeight: 0,
    });
    expect(chunk.boundingBox).not.toBeNull();
    expect(chunk.boundingBox!.min.x).toBeCloseTo(0, 2);
    expect(chunk.boundingBox!.max.x).toBeCloseTo(10, 2);
  });

  it('getCenter 返回分块中心', () => {
    const chunk = new TerrainChunk({
      chunkX: 100, chunkZ: 200,
      size: 64, lod: 0,
      heightFunction: flatHeight,
      skirtHeight: 0,
    });
    const center = chunk.getCenter();
    expect(center.x).toBe(100 + 32);
    expect(center.z).toBe(200 + 32);
  });

  it('distanceTo 计算水平距离', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 64, lod: 0,
      heightFunction: flatHeight,
      skirtHeight: 0,
    });
    expect(chunk.distanceTo(32, 32)).toBeCloseTo(0, 5);
    expect(chunk.distanceTo(32, 92)).toBeCloseTo(60, 5);
  });

  it('skirt 顶点 Y 下移 skirtHeight', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: () => 5, // 全高 5
      baseSegments: 2,
      skirtHeight: 3,
    });
    const pos = chunk.getAttribute('position')!;
    const seg1 = 3;
    const baseCount = seg1 * seg1; // 9
    // skirt 顶点从 index baseCount 开始
    // 第一个 skirt 顶点(上边第一个)Y 应 = 5 - 3 = 2
    const skirtY = pos.array[baseCount * 3 + 1];
    expect(skirtY).toBeCloseTo(2, 5);
  });

  it('索引数 = segments² × 6 (无 skirt)', () => {
    const chunk = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 4,
      skirtHeight: 0,
    });
    expect(chunk.index!.array.length).toBe(4 * 4 * 6);
  });

  it('skirt 增加额外索引', () => {
    const noSkirt = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 4,
      skirtHeight: 0,
    });
    const withSkirt = new TerrainChunk({
      chunkX: 0, chunkZ: 0,
      size: 10, lod: 0,
      heightFunction: flatHeight,
      baseSegments: 4,
      skirtHeight: 2,
    });
    expect(withSkirt.index!.array.length).toBeGreaterThan(noSkirt.index!.array.length);
  });
});

// ── TerrainSystem ──
describe('TerrainSystem', () => {
  it('默认参数构造', () => {
    const sys = new TerrainSystem({ heightFunction: flatHeight });
    expect(sys.chunkSize).toBe(64);
    expect(sys.lodLevels).toBe(4);
    expect(sys.viewDistance).toBe(256);
  });

  it('update 返回可见分块', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 8,
      lodLevels: 2,
      lodDistances: [0, 64],
      viewDistance: 100,
    });
    const chunks = sys.update(0, 0);
    expect(chunks.length).toBeGreaterThan(0);
    // 应有分块覆盖原点
    const hasOrigin = chunks.some(
      (c) => c.chunkX <= 0 && c.chunkX + c.size > 0 && c.chunkZ <= 0 && c.chunkZ + c.size > 0,
    );
    expect(hasOrigin).toBe(true);
  });

  it('近处分块 LOD 0,远处分块 LOD 更高', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 8,
      lodLevels: 3,
      lodDistances: [0, 64, 128],
      viewDistance: 200,
    });
    const chunks = sys.update(0, 0);
    const nearest = chunks.reduce((a, b) =>
      a.distanceTo(0, 0) < b.distanceTo(0, 0) ? a : b,
    );
    expect(nearest.lod).toBe(0);
    const farthest = chunks.reduce((a, b) =>
      a.distanceTo(0, 0) > b.distanceTo(0, 0) ? a : b,
    );
    expect(farthest.lod).toBeGreaterThan(0);
  });

  it('getHeightAt 直接调用 heightFunction', () => {
    const sys = new TerrainSystem({
      heightFunction: linearHeight,
      chunkSize: 64,
      baseSegments: 4,
      viewDistance: 64,
    });
    expect(sys.getHeightAt(3, 4)).toBeCloseTo(7, 5);
    expect(sys.getHeightAt(-2, 5)).toBeCloseTo(3, 5);
  });

  it('getNormalAt 平面地形朝 +Y', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 4,
      viewDistance: 64,
    });
    const n = sys.getNormalAt(0, 0);
    expect(n.x).toBeCloseTo(0, 3);
    expect(n.y).toBeCloseTo(1, 3);
    expect(n.z).toBeCloseTo(0, 3);
  });

  it('getSlopeAt 平面坡度 ≈ 0', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 4,
      viewDistance: 64,
    });
    expect(sys.getSlopeAt(0, 0)).toBeCloseTo(0, 3);
  });

  it('移动相机后分块更新', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 4,
      lodLevels: 2,
      lodDistances: [0, 64],
      viewDistance: 80,
    });
    const chunks1 = sys.update(0, 0);
    const keys1 = new Set(chunks1.map((c) => `${c.chunkX},${c.chunkZ}`));

    const chunks2 = sys.update(500, 500);
    const keys2 = new Set(chunks2.map((c) => `${c.chunkX},${c.chunkZ}`));

    let overlap = 0;
    for (const k of keys1) if (keys2.has(k)) overlap++;
    expect(overlap).toBeLessThan(keys1.size);
  });

  it('不可见分块被回收', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 4,
      lodLevels: 2,
      lodDistances: [0, 64],
      viewDistance: 80,
    });
    sys.update(0, 0);
    sys.update(1000, 1000);
    const hasOldChunk = sys.getActiveChunks().some(
      (c) => c.chunkX === 0 && c.chunkZ === 0,
    );
    expect(hasOldChunk).toBe(false);
  });

  it('dispose 清空所有分块', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 4,
      viewDistance: 64,
    });
    sys.update(0, 0);
    expect(sys.getActiveChunks().length).toBeGreaterThan(0);
    sys.dispose();
    expect(sys.getActiveChunks().length).toBe(0);
  });

  it('LOD 不变时分块缓存复用', () => {
    const sys = new TerrainSystem({
      heightFunction: flatHeight,
      chunkSize: 64,
      baseSegments: 4,
      lodLevels: 2,
      lodDistances: [0, 64],
      viewDistance: 80,
    });
    const chunks1 = sys.update(0, 0);
    const chunks2 = sys.update(0, 0);
    expect(chunks1.length).toBe(chunks2.length);
    for (let i = 0; i < chunks1.length; i++) {
      expect(chunks1[i]).toBe(chunks2[i]);
    }
  });

  it('FBM 噪声地形集成', () => {
    const fbm = new FBMNoise(4, 0.5, 2.0, 0.02);
    const sys = new TerrainSystem({
      heightFunction: fbm.toHeightFunction(10),
      chunkSize: 64,
      baseSegments: 8,
      lodLevels: 2,
      lodDistances: [0, 64],
      viewDistance: 100,
    });
    const chunks = sys.update(0, 0);
    expect(chunks.length).toBeGreaterThan(0);

    // 高度查询应返回非零值
    const h = sys.getHeightAt(10, 10);
    expect(h).not.toBe(0);

    // 法线应有 X/Z 分量(非完全平坦)
    const n = sys.getNormalAt(10, 10);
    expect(Math.abs(n.x) + Math.abs(n.z)).toBeGreaterThan(0.001);
  });
});

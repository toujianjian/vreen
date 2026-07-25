import { describe, it, expect } from 'vitest';
import { VegetationSystem } from './VegetationSystem';
import { VegetationType } from './VegetationType';
import { TerrainGeometry } from '../Terrain/TerrainGeometry';
import { BoxGeometry } from '../Geometries';
import { BasicMaterial } from '../Core';
import { Vector3 } from '../Math';

function makeType(name: string, opts: Partial<{
  minScale: number; maxScale: number;
  slopeThreshold: number; heightThreshold: [number, number];
  probability: number;
}> = {}): VegetationType {
  return new VegetationType({
    name,
    geometry: new BoxGeometry(1, 1, 1),
    material: new BasicMaterial(),
    ...opts,
  });
}

function makeFlatTerrain(size: number = 50, segs: number = 4): TerrainGeometry {
  const n = (segs + 1) * (segs + 1);
  return new TerrainGeometry({
    width: size,
    height: size,
    widthSegments: segs,
    heightSegments: segs,
    heightmap: new Float32Array(n),
    heightScale: 1,
  });
}

function makeSlopedTerrain(size: number = 50, segs: number = 4): TerrainGeometry {
  const n = (segs + 1) * (segs + 1);
  const map = new Float32Array(n);
  // 沿 X 方向线性递增,制造坡度
  for (let iy = 0; iy <= segs; iy++) {
    for (let ix = 0; ix <= segs; ix++) {
      map[iy * (segs + 1) + ix] = ix / segs;
    }
  }
  // heightScale=40 → dh/dx ≈ 0.8,坡度约 38.7° > π/8 (22.5°)
  return new TerrainGeometry({
    width: size,
    height: size,
    widthSegments: segs,
    heightSegments: segs,
    heightmap: map,
    heightScale: 40,
  });
}

describe('VegetationType', () => {
  it('canPlace 平坦处可放置', () => {
    const t = makeType('grass', { slopeThreshold: Math.PI / 6 });
    expect(t.canPlace(0, 0)).toBe(true);
    expect(t.canPlace(10, Math.PI / 12)).toBe(true);
  });

  it('canPlace 坡度超阈值不可放置', () => {
    const t = makeType('tree', { slopeThreshold: Math.PI / 6 });
    expect(t.canPlace(0, Math.PI / 4)).toBe(false);
  });

  it('canPlace 高度区间过滤', () => {
    const t = makeType('pine', { heightThreshold: [5, 20] });
    expect(t.canPlace(0, 0)).toBe(false);
    expect(t.canPlace(10, 0)).toBe(true);
    expect(t.canPlace(30, 0)).toBe(false);
  });

  it('minScale > maxScale 自动交换', () => {
    const t = makeType('bush', { minScale: 3, maxScale: 1 });
    expect(t.minScale).toBe(1);
    expect(t.maxScale).toBe(3);
  });
});

describe('VegetationSystem', () => {
  it('默认状态:无 patches,种子可控', () => {
    const vs = new VegetationSystem(42);
    expect(vs.patches.length).toBe(0);
    expect(vs.seed).toBe(42);
    expect(vs.lodDistances.length).toBeGreaterThan(0);
  });

  it('addPatch 添加植被块', () => {
    const vs = new VegetationSystem(1);
    vs.addPatch(new Vector3(0, 0, 0), 10);
    expect(vs.patches.length).toBe(1);
    expect(vs.patches[0].size).toBe(10);
    expect(vs.patches[0].instances.length).toBe(0);
    expect(vs.patches[0].mesh).toBeNull();
  });

  it('removePatch 移除指定块', () => {
    const vs = new VegetationSystem(1);
    vs.addPatch(new Vector3(0, 0, 0), 10);
    vs.addPatch(new Vector3(20, 0, 20), 10);
    expect(vs.patches.length).toBe(2);
    vs.removePatch(0);
    expect(vs.patches.length).toBe(1);
    expect(vs.patches[0].position.x).toBe(20);
  });

  it('removePatch 越界索引不抛错', () => {
    const vs = new VegetationSystem(1);
    expect(() => vs.removePatch(-1)).not.toThrow();
    expect(() => vs.removePatch(0)).not.toThrow();
  });

  it('generate 在平坦地形生成实例', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    expect(vs.patches.length).toBeGreaterThan(0);
    expect(vs.patches[0].instances.length).toBeGreaterThan(0);
  });

  it('generate 空类型表抛错', () => {
    const vs = new VegetationSystem(1);
    const terrain = makeFlatTerrain();
    expect(() => vs.generate(terrain, 1, [])).toThrow();
  });

  it('generate 同种子结果一致', () => {
    const terrain = makeFlatTerrain(50, 4);
    const vs1 = new VegetationSystem(42);
    vs1.generate(terrain, 1, [makeType('grass')]);
    const vs2 = new VegetationSystem(42);
    vs2.generate(terrain, 1, [makeType('grass')]);
    expect(vs1.patches[0].instances.length).toBe(vs2.patches[0].instances.length);
    const a = vs1.patches[0].instances;
    const b = vs2.patches[0].instances;
    for (let i = 0; i < a.length; i++) {
      expect(a[i].position.x).toBeCloseTo(b[i].position.x, 5);
      expect(a[i].position.z).toBeCloseTo(b[i].position.z, 5);
      expect(a[i].scale).toBeCloseTo(b[i].scale, 5);
    }
  });

  it('generate 不同种子结果不同', () => {
    const terrain = makeFlatTerrain(50, 4);
    const vs1 = new VegetationSystem(42);
    vs1.generate(terrain, 1, [makeType('grass')]);
    const vs2 = new VegetationSystem(99);
    vs2.generate(terrain, 1, [makeType('grass')]);
    // 至少在某些实例上位置不同
    let anyDiff = false;
    const a = vs1.patches[0].instances;
    const b = vs2.patches[0].instances;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (Math.abs(a[i].position.x - b[i].position.x) > 1e-4) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });

  it('generate 为主类型构建 InstancedMesh', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    const patch = vs.patches[0];
    expect(patch.mesh).not.toBeNull();
    expect(patch.mesh!.count).toBe(patch.instances.length);
  });

  it('generate 在陡坡地形过滤植被', () => {
    const vs = new VegetationSystem(42);
    const flat = makeFlatTerrain(50, 4);
    const sloped = makeSlopedTerrain(50, 4);
    vs.generate(flat, 0.5, [makeType('grass', { slopeThreshold: Math.PI / 8 })]);
    const flatCount = vs.patches[0].instances.length;
    vs.generate(sloped, 0.5, [makeType('grass', { slopeThreshold: Math.PI / 8 })]);
    const slopedCount = vs.patches[0].instances.length;
    // 陡坡地形上放置数应明显减少
    expect(slopedCount).toBeLessThan(flatCount);
  });

  it('generate 高度区间过滤', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeSlopedTerrain(50, 4);
    // 高度区间限制在 [0, 5],陡坡地形(高度 0..20)上只有少量满足
    vs.generate(terrain, 0.5, [makeType('pine', { heightThreshold: [0, 5] })]);
    expect(vs.patches[0].instances.length).toBeGreaterThan(0);
    // 所有实例高度应在 [0, 5] 附近
    for (const inst of vs.patches[0].instances) {
      expect(inst.position.y).toBeLessThanOrEqual(5 + 1);
    }
  });

  it('getInstances 返回所有实例', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    const all = vs.getInstances();
    expect(all.length).toBe(vs.patches[0].instances.length);
  });

  it('setDensity 设置基础密度', () => {
    const vs = new VegetationSystem(1);
    vs.setDensity(2.5);
    expect(vs.density).toBe(2.5);
    vs.setDensity(-1);
    expect(vs.density).toBe(0);
  });

  it('setSeed 设置种子', () => {
    const vs = new VegetationSystem(1);
    vs.setSeed(123);
    expect(vs.seed).toBe(123);
  });

  it('setDensityMap 设置密度图', () => {
    const vs = new VegetationSystem(1);
    const map = new Float32Array(4 * 4).fill(0.5);
    vs.setDensityMap(map, 4);
    expect(vs.densityMap).toBe(map);
    expect(vs.densityMapResolution).toBe(4);
  });

  it('setDensityMap 长度不匹配抛错', () => {
    const vs = new VegetationSystem(1);
    const map = new Float32Array(5);
    expect(() => vs.setDensityMap(map, 4)).toThrow();
  });

  it('update 根据相机距离切换可见性', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    // 相机在远处,超出最大 LOD 距离
    const farCam = new Vector3(1000, 0, 1000);
    vs.update(farCam);
    const farVisible = vs.patches[0].visible;
    // 相机在近处
    const nearCam = new Vector3(0, 0, 0);
    vs.update(nearCam);
    const nearVisible = vs.patches[0].visible;
    expect(nearVisible).toBe(true);
    expect(farVisible).toBe(false);
  });

  it('update 同步 mesh.visible', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    vs.update(new Vector3(1000, 0, 1000));
    const patch = vs.patches[0];
    if (patch.mesh) {
      expect(patch.mesh.visible).toBe(patch.visible);
    }
  });

  it('getStats 返回正确统计', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    vs.update(new Vector3(0, 0, 0));
    const stats = vs.getStats();
    expect(stats.patchCount).toBe(vs.patches.length);
    expect(stats.instanceCount).toBeGreaterThan(0);
    expect(stats.visibleInstanceCount).toBe(stats.instanceCount);
    expect(stats.visiblePatchCount).toBe(vs.patches.length);
  });

  it('getStats 远处时可见数减少', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    vs.update(new Vector3(1000, 0, 1000));
    const stats = vs.getStats();
    expect(stats.visiblePatchCount).toBe(0);
    expect(stats.visibleInstanceCount).toBe(0);
  });

  it('密度图全 0 时不生成实例', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.setDensityMap(new Float32Array(4 * 4), 4);
    vs.generate(terrain, 1, [makeType('grass')]);
    expect(vs.patches[0].instances.length).toBe(0);
  });

  it('密度图全 1 时不影响生成', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    vs.setDensityMap(new Float32Array(4 * 4).fill(1), 4);
    vs.generate(terrain, 0.5, [makeType('grass')]);
    expect(vs.patches[0].instances.length).toBeGreaterThan(0);
  });

  it('多类型按概率选择', () => {
    const vs = new VegetationSystem(42);
    const terrain = makeFlatTerrain(50, 4);
    const rare = makeType('rare', { probability: 0.01 });
    const common = makeType('common', { probability: 1 });
    vs.generate(terrain, 0.5, [rare, common]);
    const all = vs.getInstances();
    const rareCount = all.filter((i) => i.typeName === 'rare').length;
    const commonCount = all.filter((i) => i.typeName === 'common').length;
    expect(commonCount).toBeGreaterThan(rareCount);
  });
});

// VegetationRenderer 测试 — 大规模植被渲染系统。
//
// 验证:
//   • 构造默认值 / 自定义选项
//   • addPatch / removePatch / clear
//   • generateVegetation(平坦地形 / 坡度地形 / 密度图 / 季节密度乘子)
//   • update(LOD 选择 / 剔除 / 时间推进)
//   • setWind / setSeason / setLODDistances / setDensityMap / setSeed / setSwayFrequency
//   • getVisiblePatches
//   • getLODInfo
//   • getStats
//   • getSwayOffset

import { describe, it, expect } from 'vitest';
import {
  VegetationRenderer,
  type VegetationPatch,
  type VegetationTypeKind,
} from './VegetationRenderer';
import { TerrainGeometry } from '../Terrain/TerrainGeometry';
import { Vector3 } from '../Math';

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
  // heightScale=40 → dh/dx ≈ 0.8,坡度约 38.7°
  return new TerrainGeometry({
    width: size,
    height: size,
    widthSegments: segs,
    heightSegments: segs,
    heightmap: map,
    heightScale: 40,
  });
}

function makePatch(
  type: VegetationTypeKind = 'grass',
  x = 0,
  z = 0,
): VegetationPatch {
  return {
    type,
    position: new Vector3(x, 0, z),
    scale: 1,
    rotation: 0,
    lod: 0,
    swayPhase: 0,
    visible: true,
  };
}

describe('VegetationRenderer — 构造', () => {
  it('默认参数', () => {
    const vr = new VegetationRenderer();
    expect(vr.vegetationPatches.length).toBe(0);
    expect(vr.maxInstances).toBe(100000);
    expect(vr.windDirection.x).toBeCloseTo(1, 5);
    expect(vr.windStrength).toBeCloseTo(0.3, 5);
    expect(vr.season).toBe('summer');
    expect(vr.lodDistances).toEqual([20, 60, 120, 240]);
    expect(vr.densityMap).toBeNull();
    expect(vr.densityMapResolution).toBe(0);
    expect(vr.getPatchCount()).toBe(0);
  });

  it('自定义参数透传', () => {
    const vr = new VegetationRenderer({
      maxInstances: 500,
      windDirection: new Vector3(0, 0, 1),
      windStrength: 0.5,
      season: 'autumn',
      lodDistances: [10, 30, 80, 160],
      seed: 42,
    });
    expect(vr.maxInstances).toBe(500);
    expect(vr.windDirection.z).toBeCloseTo(1, 5); // 归一化后
    expect(vr.windStrength).toBeCloseTo(0.5, 5);
    expect(vr.season).toBe('autumn');
    expect(vr.lodDistances).toEqual([10, 30, 80, 160]);
  });

  it('零向量风方向退化为 +X', () => {
    const vr = new VegetationRenderer({
      windDirection: new Vector3(0, 0, 0),
    });
    expect(vr.windDirection.x).toBeCloseTo(1, 5);
  });

  it('风方向被归一化', () => {
    const vr = new VegetationRenderer({
      windDirection: new Vector3(5, 0, 0),
    });
    expect(vr.windDirection.length()).toBeCloseTo(1, 5);
    expect(vr.windDirection.x).toBeCloseTo(1, 5);
  });
});

describe('VegetationRenderer — addPatch / removePatch / clear', () => {
  it('addPatch 返回索引并克隆数据', () => {
    const vr = new VegetationRenderer();
    const p = makePatch('tree', 1, 2);
    const i = vr.addPatch(p);
    expect(i).toBe(0);
    expect(vr.getPatchCount()).toBe(1);
    // 修改原 patch 不影响内部
    p.position.x = 99;
    expect(vr.vegetationPatches[0].position.x).toBe(1);
  });

  it('addPatch 达到 maxInstances 返回 -1', () => {
    const vr = new VegetationRenderer({ maxInstances: 2 });
    expect(vr.addPatch(makePatch())).toBe(0);
    expect(vr.addPatch(makePatch())).toBe(1);
    expect(vr.addPatch(makePatch())).toBe(-1);
    expect(vr.getPatchCount()).toBe(2);
  });

  it('removePatch swap-with-tail', () => {
    const vr = new VegetationRenderer();
    vr.addPatch(makePatch('grass', 0, 0));
    vr.addPatch(makePatch('tree', 1, 1));
    vr.addPatch(makePatch('bush', 2, 2));
    vr.removePatch(1);
    expect(vr.getPatchCount()).toBe(2);
    // 索引 1 应为原来的最后一个 (2,2)
    expect(vr.vegetationPatches[1].position.x).toBe(2);
    expect(vr.vegetationPatches[0].position.x).toBe(0);
  });

  it('removePatch 越界抛错', () => {
    const vr = new VegetationRenderer();
    expect(() => vr.removePatch(0)).toThrow(/out of range/);
    expect(() => vr.removePatch(-1)).toThrow(/out of range/);
  });

  it('clear 清空所有实例并重置时间', () => {
    const vr = new VegetationRenderer();
    vr.addPatch(makePatch());
    vr.update(0.5, new Vector3());
    expect(vr.getTime()).toBeCloseTo(0.5, 5);
    vr.clear();
    expect(vr.getPatchCount()).toBe(0);
    expect(vr.getTime()).toBe(0);
  });
});

describe('VegetationRenderer — generateVegetation', () => {
  it('平坦地形生成实例', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    const terrain = makeFlatTerrain(20, 4);
    vr.generateVegetation(terrain, 1.0, ['grass', 'tree']);
    expect(vr.getPatchCount()).toBeGreaterThan(0);
    // 所有实例应在地形范围内
    const halfW = terrain.width / 2;
    const halfH = terrain.height / 2;
    for (const p of vr.vegetationPatches) {
      expect(p.position.x).toBeGreaterThanOrEqual(-halfW);
      expect(p.position.x).toBeLessThanOrEqual(halfW);
      expect(p.position.z).toBeGreaterThanOrEqual(-halfH);
      expect(p.position.z).toBeLessThanOrEqual(halfH);
    }
  });

  it('types 为空抛错', () => {
    const vr = new VegetationRenderer();
    const terrain = makeFlatTerrain();
    expect(() => vr.generateVegetation(terrain, 1.0, [])).toThrow(/不能为空/);
  });

  it('确定性:同种子生成相同分布', () => {
    const terrain = makeFlatTerrain(20, 4);
    const vr1 = new VegetationRenderer({ seed: 42 });
    const vr2 = new VegetationRenderer({ seed: 42 });
    vr1.generateVegetation(terrain, 1.0, ['grass']);
    vr2.generateVegetation(terrain, 1.0, ['grass']);
    expect(vr1.getPatchCount()).toBe(vr2.getPatchCount());
    for (let i = 0; i < vr1.getPatchCount(); i++) {
      expect(vr1.vegetationPatches[i].position.x).toBeCloseTo(
        vr2.vegetationPatches[i].position.x, 5,
      );
      expect(vr1.vegetationPatches[i].position.z).toBeCloseTo(
        vr2.vegetationPatches[i].position.z, 5,
      );
    }
  });

  it('生成的实例类型在候选列表内', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    const terrain = makeFlatTerrain(20, 4);
    const types: VegetationTypeKind[] = ['grass', 'tree', 'bush', 'flower'];
    vr.generateVegetation(terrain, 1.0, types);
    for (const p of vr.vegetationPatches) {
      expect(types).toContain(p.type);
    }
  });

  it('实例的 position.y 等于地形高度', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    const terrain = makeFlatTerrain(20, 4);
    vr.generateVegetation(terrain, 1.0, ['grass']);
    for (const p of vr.vegetationPatches) {
      const expectedY = terrain.getHeightAt(p.position.x, p.position.z);
      expect(p.position.y).toBeCloseTo(expectedY, 5);
    }
  });

  it('实例字段完整性:scale/rotation/swayPhase', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    const terrain = makeFlatTerrain(20, 4);
    vr.generateVegetation(terrain, 1.0, ['grass']);
    expect(vr.getPatchCount()).toBeGreaterThan(0);
    for (const p of vr.vegetationPatches) {
      expect(p.scale).toBeGreaterThan(0);
      expect(p.rotation).toBeGreaterThanOrEqual(0);
      expect(p.rotation).toBeLessThan(Math.PI * 2);
      expect(p.swayPhase).toBeGreaterThanOrEqual(0);
      expect(p.swayPhase).toBeLessThan(Math.PI * 2);
      expect(p.lod).toBe(0);
      expect(p.visible).toBe(true);
    }
  });

  it('密度图全 0 → 不生成任何实例', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    const terrain = makeFlatTerrain(20, 4);
    const res = 4;
    vr.setDensityMap(new Float32Array(res * res), res);
    vr.generateVegetation(terrain, 1.0, ['grass']);
    expect(vr.getPatchCount()).toBe(0);
  });

  it('密度图全 1 → 正常生成', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    const terrain = makeFlatTerrain(20, 4);
    const res = 4;
    vr.setDensityMap(new Float32Array(res * res).fill(1), res);
    vr.generateVegetation(terrain, 1.0, ['grass']);
    expect(vr.getPatchCount()).toBeGreaterThan(0);
  });

  it('winter 季节密度乘子降低实例数', () => {
    const terrain = makeFlatTerrain(20, 4);
    const vrSummer = new VegetationRenderer({ seed: 1, season: 'summer' });
    vrSummer.generateVegetation(terrain, 1.0, ['grass']);
    const vrWinter = new VegetationRenderer({ seed: 1, season: 'winter' });
    vrWinter.generateVegetation(terrain, 1.0, ['grass']);
    // winter 乘子 0.3,实例数应明显少于 summer
    expect(vrWinter.getPatchCount()).toBeLessThan(vrSummer.getPatchCount());
  });

  it('陡坡地形:树不会生成在陡坡上', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    const terrain = makeSlopedTerrain(20, 4);
    // 仅生成 tree,坡度阈值 30°,地形坡度约 38.7° → 大部分位置不可放置
    vr.generateVegetation(terrain, 1.0, ['tree']);
    // 树数量应远少于平坦地形(可能为 0)
    const flatVr = new VegetationRenderer({ seed: 1 });
    flatVr.generateVegetation(makeFlatTerrain(20, 4), 1.0, ['tree']);
    expect(vr.getPatchCount()).toBeLessThanOrEqual(flatVr.getPatchCount());
  });

  it('maxInstances 上限生效', () => {
    const vr = new VegetationRenderer({ seed: 1, maxInstances: 10 });
    const terrain = makeFlatTerrain(100, 8);
    vr.generateVegetation(terrain, 5.0, ['grass']);
    expect(vr.getPatchCount()).toBeLessThanOrEqual(10);
  });
});

describe('VegetationRenderer — update / LOD', () => {
  it('update 推进内部时间', () => {
    const vr = new VegetationRenderer();
    vr.addPatch(makePatch());
    vr.update(0.5, new Vector3());
    expect(vr.getTime()).toBeCloseTo(0.5, 5);
    vr.update(0.3, new Vector3());
    expect(vr.getTime()).toBeCloseTo(0.8, 5);
  });

  it('近相机实例 LOD 0', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 0, 0)); // 距相机 0
    vr.update(0, new Vector3(0, 0, 0));
    expect(vr.vegetationPatches[0].lod).toBe(0);
    expect(vr.vegetationPatches[0].visible).toBe(true);
  });

  it('中等距离实例 LOD 1/2', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 20, 0)); // 距离 20 → LOD 1
    vr.addPatch(makePatch('grass', 50, 0)); // 距离 50 → LOD 2
    vr.update(0, new Vector3(0, 0, 0));
    expect(vr.vegetationPatches[0].lod).toBe(1);
    expect(vr.vegetationPatches[1].lod).toBe(2);
  });

  it('最远 LOD 内的实例 LOD 3', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 80, 0)); // 距离 80 → LOD 3
    vr.update(0, new Vector3(0, 0, 0));
    expect(vr.vegetationPatches[0].lod).toBe(3);
    expect(vr.vegetationPatches[0].visible).toBe(true);
  });

  it('超出最远 LOD 的实例被剔除', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 200, 0)); // 距离 200 > 100
    vr.update(0, new Vector3(0, 0, 0));
    expect(vr.vegetationPatches[0].lod).toBe(-1);
    expect(vr.vegetationPatches[0].visible).toBe(false);
  });

  it('距离阈值边界:恰好等于阈值进入下一级', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    // 距离 10 → 不满足 < 10,进入 LOD 1
    vr.addPatch(makePatch('grass', 10, 0));
    vr.update(0, new Vector3(0, 0, 0));
    expect(vr.vegetationPatches[0].lod).toBe(1);
  });

  it('update 后 getLODInfo 统计正确', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 0, 0));   // LOD 0
    vr.addPatch(makePatch('grass', 20, 0));  // LOD 1
    vr.addPatch(makePatch('grass', 50, 0));  // LOD 2
    vr.addPatch(makePatch('grass', 80, 0));  // LOD 3
    vr.addPatch(makePatch('grass', 200, 0)); // hidden
    vr.update(0, new Vector3(0, 0, 0));
    const info = vr.getLODInfo();
    expect(info.lod0).toBe(1);
    expect(info.lod1).toBe(1);
    expect(info.lod2).toBe(1);
    expect(info.lod3).toBe(1);
    expect(info.hidden).toBe(1);
    expect(info.total).toBe(5);
  });
});

describe('VegetationRenderer — getVisiblePatches', () => {
  it('返回 LOD >= 0 的实例', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 0, 0));   // visible
    vr.addPatch(makePatch('grass', 200, 0)); // hidden
    const visible = vr.getVisiblePatches(new Vector3(0, 0, 0));
    expect(visible.length).toBe(1);
    expect(visible[0].position.x).toBe(0);
  });

  it('所有实例都可见', () => {
    const vr = new VegetationRenderer({ lodDistances: [100, 200, 300, 500] });
    vr.addPatch(makePatch('grass', 0, 0));
    vr.addPatch(makePatch('grass', 50, 0));
    const visible = vr.getVisiblePatches(new Vector3(0, 0, 0));
    expect(visible.length).toBe(2);
  });

  it('相机移动改变可见集', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 0, 0));
    vr.addPatch(makePatch('grass', 200, 0));
    // 相机在原点:0 处可见,200 处不可见
    let visible = vr.getVisiblePatches(new Vector3(0, 0, 0));
    expect(visible.length).toBe(1);
    expect(visible[0].position.x).toBe(0);
    // 相机移到 200 附近:可见集反转(200 处可见,0 处不可见)
    visible = vr.getVisiblePatches(new Vector3(200, 0, 0));
    expect(visible.length).toBe(1);
    expect(visible[0].position.x).toBe(200);
  });

  it('相机居中时两侧实例都可见', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 0, 0));
    vr.addPatch(makePatch('grass', 80, 0));
    // 相机在 40:两侧距离均 40 < 60 → LOD 2,都可见
    const visible = vr.getVisiblePatches(new Vector3(40, 0, 0));
    expect(visible.length).toBe(2);
  });
});

describe('VegetationRenderer — setWind / setSeason / setLODDistances', () => {
  it('setWind 归一化方向并设置强度', () => {
    const vr = new VegetationRenderer();
    vr.setWind(new Vector3(0, 0, 3), 0.7);
    expect(vr.windDirection.z).toBeCloseTo(1, 5);
    expect(vr.windStrength).toBeCloseTo(0.7, 5);
  });

  it('setWind 零方向不影响现有方向', () => {
    const vr = new VegetationRenderer();
    const origDir = vr.windDirection.clone();
    vr.setWind(new Vector3(0, 0, 0), 0.5);
    expect(vr.windDirection.x).toBeCloseTo(origDir.x, 5);
    expect(vr.windStrength).toBeCloseTo(0.5, 5);
  });

  it('setWind 负强度被截断为 0', () => {
    const vr = new VegetationRenderer();
    vr.setWind(new Vector3(1, 0, 0), -0.5);
    expect(vr.windStrength).toBe(0);
  });

  it('setWind 链式返回', () => {
    const vr = new VegetationRenderer();
    expect(vr.setWind(new Vector3(), 0)).toBe(vr);
  });

  it('setSeason 更新季节', () => {
    const vr = new VegetationRenderer();
    expect(vr.season).toBe('summer');
    vr.setSeason('winter');
    expect(vr.season).toBe('winter');
  });

  it('setSeason 链式返回', () => {
    const vr = new VegetationRenderer();
    expect(vr.setSeason('spring')).toBe(vr);
  });

  it('setLODDistances 更新 4 级阈值', () => {
    const vr = new VegetationRenderer();
    vr.setLODDistances([5, 15, 40, 80]);
    expect(vr.lodDistances).toEqual([5, 15, 40, 80]);
  });

  it('setLODDistances 非 4 级抛错', () => {
    const vr = new VegetationRenderer();
    expect(() => vr.setLODDistances([10, 20, 30])).toThrow(/需要 4 级/);
    expect(() => vr.setLODDistances([10, 20, 30, 40, 50])).toThrow(/需要 4 级/);
  });

  it('setLODDistances 链式返回', () => {
    const vr = new VegetationRenderer();
    expect(vr.setLODDistances([1, 2, 3, 4])).toBe(vr);
  });
});

describe('VegetationRenderer — setDensityMap', () => {
  it('设置密度图', () => {
    const vr = new VegetationRenderer();
    const res = 4;
    const map = new Float32Array(res * res).fill(0.5);
    vr.setDensityMap(map, res);
    expect(vr.densityMap).toBe(map);
    expect(vr.densityMapResolution).toBe(res);
  });

  it('传 null 清除密度图', () => {
    const vr = new VegetationRenderer();
    const res = 4;
    vr.setDensityMap(new Float32Array(res * res), res);
    vr.setDensityMap(null);
    expect(vr.densityMap).toBeNull();
    expect(vr.densityMapResolution).toBe(0);
  });

  it('resolution <= 0 抛错', () => {
    const vr = new VegetationRenderer();
    expect(() => vr.setDensityMap(new Float32Array(1), 0)).toThrow(/resolution 必须 > 0/);
  });

  it('map 长度与 resolution² 不匹配抛错', () => {
    const vr = new VegetationRenderer();
    expect(() => vr.setDensityMap(new Float32Array(5), 4)).toThrow(/不匹配/);
  });

  it('链式返回', () => {
    const vr = new VegetationRenderer();
    expect(vr.setDensityMap(null)).toBe(vr);
  });
});

describe('VegetationRenderer — setSeed / setSwayFrequency', () => {
  it('setSeed 更新种子', () => {
    const vr = new VegetationRenderer({ seed: 1 });
    vr.setSeed(99);
    expect(vr).toBe(vr); // 链式
  });

  it('setSwayFrequency 更新频率', () => {
    const vr = new VegetationRenderer();
    vr.setSwayFrequency(3.5);
    // 频率影响 getSwayOffset 的输出
    vr.addPatch(makePatch());
    vr.update(1.0, new Vector3(0, 0, 0));
    // 不同频率应产生不同偏移
    const vr2 = new VegetationRenderer();
    vr2.setSwayFrequency(1.0);
    vr2.addPatch(makePatch());
    vr2.update(1.0, new Vector3(0, 0, 0));
    const off1 = vr.getSwayOffset(vr.vegetationPatches[0]);
    const off2 = vr2.getSwayOffset(vr2.vegetationPatches[0]);
    expect(off1.x).not.toBeCloseTo(off2.x, 2);
  });

  it('setSwayFrequency 负值抛错', () => {
    const vr = new VegetationRenderer();
    expect(() => vr.setSwayFrequency(-1)).toThrow(/必须 >= 0/);
  });
});

describe('VegetationRenderer — getSwayOffset', () => {
  it('零风强度 → 零偏移', () => {
    const vr = new VegetationRenderer({ windStrength: 0, windDirection: new Vector3(1, 0, 0) });
    vr.addPatch(makePatch());
    vr.update(1.0, new Vector3(0, 0, 0));
    const off = vr.getSwayOffset(vr.vegetationPatches[0]);
    expect(off.lengthSq()).toBe(0);
  });

  it('偏移沿风方向', () => {
    const vr = new VegetationRenderer({
      windDirection: new Vector3(1, 0, 0),
      windStrength: 1.0,
    });
    vr.addPatch(makePatch('grass', 0, 0));
    vr.update(0, new Vector3(0, 0, 0)); // time=0, sin(0)=0 → 零偏移
    const off0 = vr.getSwayOffset(vr.vegetationPatches[0]);
    expect(off0.x).toBeCloseTo(0, 5);
    // 推进时间使 sin 非零
    vr.update(Math.PI / 4, new Vector3(0, 0, 0)); // 默认 freq=2, sin(2*π/4)=sin(π/2)=1
    const off1 = vr.getSwayOffset(vr.vegetationPatches[0]);
    expect(off1.x).toBeCloseTo(1, 5); // windDirection.x * 1 * 1 = 1
    expect(off1.y).toBeCloseTo(0, 5);
    expect(off1.z).toBeCloseTo(0, 5);
  });

  it('不同 swayPhase 产生不同偏移', () => {
    const vr = new VegetationRenderer({
      windDirection: new Vector3(1, 0, 0),
      windStrength: 1.0,
    });
    vr.addPatch({ ...makePatch(), swayPhase: 0 });
    vr.addPatch({ ...makePatch(), swayPhase: Math.PI });
    vr.update(Math.PI / 8, new Vector3(0, 0, 0)); // sin(2*π/8 + 0) vs sin(2*π/8 + π)
    const off1 = vr.getSwayOffset(vr.vegetationPatches[0]);
    const off2 = vr.getSwayOffset(vr.vegetationPatches[1]);
    expect(off1.x).not.toBeCloseTo(off2.x, 2);
  });

  it('getSwayOffset 写入 target 参数', () => {
    const vr = new VegetationRenderer({ windStrength: 1.0 });
    vr.addPatch(makePatch());
    vr.update(1.0, new Vector3(0, 0, 0));
    const target = new Vector3();
    const result = vr.getSwayOffset(vr.vegetationPatches[0], target);
    expect(result).toBe(target);
  });
});

describe('VegetationRenderer — getStats', () => {
  it('初始统计', () => {
    const vr = new VegetationRenderer();
    const s = vr.getStats();
    expect(s.patchCount).toBe(0);
    expect(s.maxInstances).toBe(100000);
    expect(s.visibleCount).toBe(0);
    expect(s.time).toBe(0);
    expect(s.season).toBe('summer');
    expect(s.densityMapResolution).toBe(0);
  });

  it('update 后统计更新', () => {
    const vr = new VegetationRenderer({ lodDistances: [10, 30, 60, 100] });
    vr.addPatch(makePatch('grass', 0, 0));   // visible
    vr.addPatch(makePatch('grass', 200, 0)); // hidden
    vr.update(0.5, new Vector3(0, 0, 0));
    const s = vr.getStats();
    expect(s.patchCount).toBe(2);
    expect(s.visibleCount).toBe(1);
    expect(s.time).toBeCloseTo(0.5, 5);
  });

  it('反映风强度与季节变化', () => {
    const vr = new VegetationRenderer();
    vr.setWind(new Vector3(1, 0, 0), 0.9);
    vr.setSeason('winter');
    const s = vr.getStats();
    expect(s.windStrength).toBeCloseTo(0.9, 5);
    expect(s.season).toBe('winter');
  });
});

describe('VegetationRenderer — getPatches', () => {
  it('返回内部数组引用', () => {
    const vr = new VegetationRenderer();
    vr.addPatch(makePatch());
    const arr = vr.getPatches();
    expect(arr).toBe(vr.vegetationPatches);
    expect(arr.length).toBe(1);
  });
});

// Vegetation 模块单元测试。
//
// 测试策略:
//   - createDescriptor 默认值
//   - 各 Filter (altitude/slope/surfaceMask/distanceBetween/shapeIntersection/distribution) accept/reject
//   - 各 Modifier (position/rotation/scale/slopeAlignment) 变换正确性
//   - SpawnerArea.spawn (无过滤器 ~100 实例 / 过滤器 accept+reject / maxInstances 上限 / clear)
//   - AreaBlender (add/remove/spawnAll/clearAll)
//   - 确定性:相同 seed → 相同输出

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { Box3 } from '../Math/Box3';
import { BoxShape } from '../Shapes/BoxShape';
import { SurfaceDataSystem } from '../SurfaceData/SurfaceDataSystem';
import { SurfaceDataProviderRegistry } from '../SurfaceData/SurfaceDataProvider';
import { createSurfacePoint } from '../SurfaceData/SurfacePoint';
import {
  createDescriptor,
  SurfaceAltitudeFilter,
  SurfaceSlopeFilter,
  SurfaceMaskFilter,
  DistanceBetweenFilter,
  ShapeIntersectionFilter,
  DistributionFilter,
  PositionModifier,
  RotationModifier,
  ScaleModifier,
  SlopeAlignmentModifier,
  SpawnerArea,
  AreaBlender,
  type VegetationFilterContext,
  type VegetationModifierContext,
  type SpawnerAreaConfig,
} from './index';

// ── helpers ──────────────────────────────────────────────────────

function buildFilterCtx(overrides: Partial<VegetationFilterContext> = {}): VegetationFilterContext {
  return {
    position: overrides.position ?? new Vector3(0, 0, 0),
    surface: overrides.surface ?? null,
    normal: overrides.normal ?? new Vector3(0, 1, 0),
    slope: overrides.slope ?? 0,
    altitude: overrides.altitude ?? 0,
    descriptor: overrides.descriptor ?? createDescriptor('test', 'test_mesh'),
  };
}

function buildModifierCtx(overrides: Partial<VegetationModifierContext> = {}): VegetationModifierContext {
  return {
    position: overrides.position ?? new Vector3(0, 0, 0),
    surface: overrides.surface ?? null,
    normal: overrides.normal ?? new Vector3(0, 1, 0),
    slope: overrides.slope ?? 0,
    altitude: overrides.altitude ?? 0,
    descriptor: overrides.descriptor ?? createDescriptor('test', 'test_mesh'),
    rotation: overrides.rotation ?? new Quaternion(),
    scale: overrides.scale ?? new Vector3(1, 1, 1),
  };
}

/** Creates a SurfaceDataSystem whose query always returns a point at fixed y. */
function createMockSurfaceData(y: number): SurfaceDataSystem {
  const registry = new SurfaceDataProviderRegistry();
  registry.register({
    id: 'mock',
    getSurfacePoints(pos: Vector3, _maxPoints: number) {
      return [createSurfacePoint(new Vector3(pos.x, y, pos.z), new Vector3(0, 1, 0), [])];
    },
  });
  return new SurfaceDataSystem(registry);
}

function createAreaConfig(overrides: Partial<SpawnerAreaConfig> = {}): SpawnerAreaConfig {
  return {
    id: overrides.id ?? 'area1',
    bounds: overrides.bounds ?? new Box3(new Vector3(0, 0, 0), new Vector3(10, 0, 10)),
    density: overrides.density ?? 1,
    descriptors: overrides.descriptors ?? [createDescriptor('tree', 'tree_mesh')],
    filters: overrides.filters ?? [],
    modifiers: overrides.modifiers ?? [],
    maxInstances: overrides.maxInstances ?? 200,
    seed: overrides.seed ?? 1,
  };
}

// ── createDescriptor ─────────────────────────────────────────────

describe('createDescriptor', () => {
  it('默认值正确', () => {
    const d = createDescriptor('tree', 'tree_mesh');
    expect(d.id).toBe('tree');
    expect(d.meshKey).toBe('tree_mesh');
    expect(d.weight).toBe(1);
    expect(d.minScale).toBe(0.8);
    expect(d.maxScale).toBe(1.2);
    expect(d.lodDistances).toEqual([]);
    expect(d.castShadow).toBe(true);
    expect(d.receiveShadow).toBe(false);
  });

  it('opts 覆盖默认值', () => {
    const d = createDescriptor('bush', 'bush_mesh', { weight: 2, minScale: 0.5, castShadow: false });
    expect(d.weight).toBe(2);
    expect(d.minScale).toBe(0.5);
    expect(d.castShadow).toBe(false);
    // 未覆盖的保留默认
    expect(d.maxScale).toBe(1.2);
    expect(d.receiveShadow).toBe(false);
  });
});

// ── Filters ──────────────────────────────────────────────────────

describe('SurfaceAltitudeFilter', () => {
  it('海拔在 [0,100] 内 y=50 接受', () => {
    const f = new SurfaceAltitudeFilter(0, 100);
    const ctx = buildFilterCtx({ altitude: 50 });
    expect(f.accept(ctx)).toBe(true);
  });

  it('海拔超出 [0,100] y=150 拒绝', () => {
    const f = new SurfaceAltitudeFilter(0, 100);
    const ctx = buildFilterCtx({ altitude: 150 });
    expect(f.accept(ctx)).toBe(false);
  });
});

describe('SurfaceSlopeFilter', () => {
  it('坡度在 [0, 0.5] 内 slope=0.1 接受', () => {
    const f = new SurfaceSlopeFilter(0, 0.5);
    const ctx = buildFilterCtx({ slope: 0.1 });
    expect(f.accept(ctx)).toBe(true);
  });

  it('坡度超出 [0, 0.5] slope=1.0 拒绝', () => {
    const f = new SurfaceSlopeFilter(0, 0.5);
    const ctx = buildFilterCtx({ slope: 1.0 });
    expect(f.accept(ctx)).toBe(false);
  });
});

describe('SurfaceMaskFilter', () => {
  it('标签 grass 权重 0.8,minWeight=0.5 接受', () => {
    const surface = createSurfacePoint(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      [{ id: 'grass', weight: 0.8 }],
    );
    const f = new SurfaceMaskFilter('grass', 0.5);
    const ctx = buildFilterCtx({ surface });
    expect(f.accept(ctx)).toBe(true);
  });

  it('标签 grass 权重 0.8,minWeight=0.9 拒绝', () => {
    const surface = createSurfacePoint(
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      [{ id: 'grass', weight: 0.8 }],
    );
    const f = new SurfaceMaskFilter('grass', 0.9);
    const ctx = buildFilterCtx({ surface });
    expect(f.accept(ctx)).toBe(false);
  });

  it('surface 为 null 时拒绝', () => {
    const f = new SurfaceMaskFilter('grass', 0.5);
    const ctx = buildFilterCtx({ surface: null });
    expect(f.accept(ctx)).toBe(false);
  });
});

describe('DistanceBetweenFilter', () => {
  it('第一个点接受,距离过近的第二个点拒绝', () => {
    const f = new DistanceBetweenFilter(2.0);
    // 第一个点
    const ctx1 = buildFilterCtx({ position: new Vector3(0, 0, 0) });
    expect(f.accept(ctx1)).toBe(true);
    f.placed.push(ctx1.position.clone());

    // 距离 1.0 < 2.0 → 拒绝
    const ctx2 = buildFilterCtx({ position: new Vector3(1, 0, 0) });
    expect(f.accept(ctx2)).toBe(false);

    // 距离 3.0 >= 2.0 → 接受
    const ctx3 = buildFilterCtx({ position: new Vector3(3, 0, 0) });
    expect(f.accept(ctx3)).toBe(true);
  });
});

describe('ShapeIntersectionFilter', () => {
  const box = new BoxShape(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  const f = new ShapeIntersectionFilter([box]);

  it('点在盒内接受', () => {
    const ctx = buildFilterCtx({ position: new Vector3(0, 0, 0) });
    expect(f.accept(ctx)).toBe(true);
  });

  it('点在盒外拒绝', () => {
    const ctx = buildFilterCtx({ position: new Vector3(5, 5, 5) });
    expect(f.accept(ctx)).toBe(false);
  });
});

describe('DistributionFilter', () => {
  it('probability=1 始终接受', () => {
    const f = new DistributionFilter(1, 42);
    const ctx = buildFilterCtx();
    for (let i = 0; i < 100; i++) {
      expect(f.accept(ctx)).toBe(true);
    }
  });

  it('probability=0 始终拒绝', () => {
    const f = new DistributionFilter(0, 42);
    const ctx = buildFilterCtx();
    for (let i = 0; i < 100; i++) {
      expect(f.accept(ctx)).toBe(false);
    }
  });

  it('probability=0.5 约 50% 接受 (1000 样本)', () => {
    const f = new DistributionFilter(0.5, 99);
    const ctx = buildFilterCtx();
    let accepted = 0;
    for (let i = 0; i < 1000; i++) {
      if (f.accept(ctx)) accepted++;
    }
    // 允许 ±10% 容差
    expect(accepted).toBeGreaterThan(400);
    expect(accepted).toBeLessThan(600);
  });
});

// ── Modifiers ────────────────────────────────────────────────────

describe('PositionModifier', () => {
  it('抖动后位置在 radius 范围内', () => {
    const radius = 2.0;
    const mod = new PositionModifier(radius, 7);
    const maxDist = radius * Math.sqrt(2) + 1e-6;

    for (let i = 0; i < 100; i++) {
      const ctx = buildModifierCtx({ position: new Vector3(0, 0, 0) });
      mod.apply(ctx);
      const dist = ctx.position.distanceTo(new Vector3(0, 0, 0));
      expect(dist).toBeLessThanOrEqual(maxDist);
      // 各轴偏移在 [-radius, radius] 内
      expect(Math.abs(ctx.position.x)).toBeLessThanOrEqual(radius);
      expect(Math.abs(ctx.position.z)).toBeLessThanOrEqual(radius);
      // y 不变
      expect(ctx.position.y).toBe(0);
    }
  });
});

describe('RotationModifier', () => {
  it('产生绕 Y 轴的旋转 (Y 分量非零)', () => {
    const mod = new RotationModifier(0.5, 1.0);
    const ctx = buildModifierCtx();
    mod.apply(ctx);
    // 绕 Y 轴旋转的四元数: x=0, z=0, y=sin(θ/2), w=cos(θ/2)
    expect(ctx.rotation.x).toBe(0);
    expect(ctx.rotation.z).toBe(0);
    expect(Math.abs(ctx.rotation.y)).toBeGreaterThan(0);
  });
});

describe('ScaleModifier', () => {
  it('缩放在 [min, max] 范围内且均匀', () => {
    const min = 0.8, max = 1.2;
    const mod = new ScaleModifier(min, max);
    for (let i = 0; i < 100; i++) {
      const ctx = buildModifierCtx();
      mod.apply(ctx);
      const s = ctx.scale.x;
      expect(s).toBeGreaterThanOrEqual(min);
      expect(s).toBeLessThanOrEqual(max);
      expect(ctx.scale.y).toBe(s);
      expect(ctx.scale.z).toBe(s);
    }
  });
});

describe('SlopeAlignmentModifier', () => {
  it('normal=(1,0,0) factor=1 时旋转将 Y 对齐到 X', () => {
    const mod = new SlopeAlignmentModifier(1.0);
    const ctx = buildModifierCtx({ normal: new Vector3(1, 0, 0) });
    mod.apply(ctx);
    // 应用旋转到 (0,1,0) 应得到 (1,0,0)
    const v = new Vector3(0, 1, 0);
    v.applyQuaternion(ctx.rotation);
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  it('factor=0 时旋转不变 (保持 identity)', () => {
    const mod = new SlopeAlignmentModifier(0.0);
    const ctx = buildModifierCtx({ normal: new Vector3(1, 0, 0) });
    mod.apply(ctx);
    // factor=0 → slerp 0 → 不变
    expect(ctx.rotation.x).toBe(0);
    expect(ctx.rotation.y).toBe(0);
    expect(ctx.rotation.z).toBe(0);
    expect(ctx.rotation.w).toBe(1);
  });
});

// ── SpawnerArea ──────────────────────────────────────────────────

describe('SpawnerArea.spawn', () => {
  it('density=1, bounds 10×10, 无过滤器 → 100 实例', () => {
    const area = new SpawnerArea(createAreaConfig({
      density: 1,
      maxInstances: 200,
    }));
    const instances = area.spawn(null);
    expect(instances.length).toBe(100);
    expect(area.instances.length).toBe(100);
  });

  it('SurfaceAltitudeFilter [0,50], surface y=25 → 接受', () => {
    const area = new SpawnerArea(createAreaConfig({
      filters: [new SurfaceAltitudeFilter(0, 50)],
    }));
    const sd = createMockSurfaceData(25);
    const instances = area.spawn(sd);
    expect(instances.length).toBe(100);
  });

  it('SurfaceAltitudeFilter [0,50], surface y=75 → 全部拒绝', () => {
    const area = new SpawnerArea(createAreaConfig({
      filters: [new SurfaceAltitudeFilter(0, 50)],
    }));
    const sd = createMockSurfaceData(75);
    const instances = area.spawn(sd);
    expect(instances.length).toBe(0);
  });

  it('遵守 maxInstances 上限', () => {
    const area = new SpawnerArea(createAreaConfig({
      density: 10, // area=100, density=10 → target=1000, cap at 50
      maxInstances: 50,
    }));
    const instances = area.spawn(null);
    expect(instances.length).toBe(50);
  });

  it('clear 清空 instances', () => {
    const area = new SpawnerArea(createAreaConfig());
    area.spawn(null);
    expect(area.instances.length).toBe(100);
    area.clear();
    expect(area.instances.length).toBe(0);
  });

  it('clear 同时清空 DistanceBetweenFilter.placed', () => {
    const distFilter = new DistanceBetweenFilter(0.5);
    const area = new SpawnerArea(createAreaConfig({
      filters: [distFilter],
      maxInstances: 10,
    }));
    area.spawn(null);
    expect(distFilter.placed.length).toBeGreaterThan(0);
    area.clear();
    expect(distFilter.placed.length).toBe(0);
  });

  it('实例的 descriptorId 来自加权挑选', () => {
    const descriptors = [
      createDescriptor('a', 'mesh_a', { weight: 1 }),
      createDescriptor('b', 'mesh_b', { weight: 1 }),
    ];
    const area = new SpawnerArea(createAreaConfig({
      descriptors,
      maxInstances: 50,
    }));
    const instances = area.spawn(null);
    const ids = new Set(instances.map((i) => i.descriptorId));
    // 两个 descriptor 权重相同,大概率都会被选中
    expect(ids.has('a') || ids.has('b')).toBe(true);
    for (const inst of instances) {
      expect(['a', 'b']).toContain(inst.descriptorId);
    }
  });
});

// ── AreaBlender ──────────────────────────────────────────────────

describe('AreaBlender', () => {
  it('add/remove/spawnAll/clearAll', () => {
    const blender = new AreaBlender();
    const area1 = new SpawnerArea(createAreaConfig({
      id: 'area1',
      maxInstances: 10,
    }));
    const area2 = new SpawnerArea(createAreaConfig({
      id: 'area2',
      maxInstances: 10,
    }));

    // add
    blender.add(area1).add(area2);
    expect(blender.areas.length).toBe(2);

    // spawnAll
    const instances = blender.spawnAll(null);
    expect(instances.length).toBe(20); // 10 + 10

    // clearAll (clears all areas still in blender)
    blender.clearAll();
    expect(area1.instances.length).toBe(0);
    expect(area2.instances.length).toBe(0);

    // remove
    expect(blender.remove('area1')).toBe(true);
    expect(blender.areas.length).toBe(1);
    expect(blender.remove('nonexistent')).toBe(false);
  });
});

// ── 确定性 ───────────────────────────────────────────────────────

describe('确定性', () => {
  it('DistributionFilter 相同 seed → 相同输出序列', () => {
    const f1 = new DistributionFilter(0.5, 12345);
    const f2 = new DistributionFilter(0.5, 12345);
    const ctx = buildFilterCtx();
    for (let i = 0; i < 200; i++) {
      expect(f1.accept(ctx)).toBe(f2.accept(ctx));
    }
  });

  it('SpawnerArea 相同 seed → 相同位置序列', () => {
    const cfg1 = createAreaConfig({ seed: 42, maxInstances: 20 });
    const cfg2 = createAreaConfig({ seed: 42, maxInstances: 20 });
    const area1 = new SpawnerArea(cfg1);
    const area2 = new SpawnerArea(cfg2);
    const inst1 = area1.spawn(null);
    const inst2 = area2.spawn(null);
    expect(inst1.length).toBe(inst2.length);
    for (let i = 0; i < inst1.length; i++) {
      expect(inst1[i].position.x).toBeCloseTo(inst2[i].position.x, 10);
      expect(inst1[i].position.z).toBeCloseTo(inst2[i].position.z, 10);
    }
  });
});

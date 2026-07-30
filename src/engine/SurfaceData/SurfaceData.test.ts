import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import {
  createSurfacePoint,
  getDominantTag,
  getTagWeight,
  SurfaceDataProviderRegistry,
  SurfaceDataSystem,
  TerrainSurfaceProvider,
  TAG_GRASS,
  TAG_WATER,
  TAG_ROCK,
} from './index';
import type { SurfaceDataProvider, SurfacePoint } from './index';

/** 简单 mock provider:无视位置,固定返回构造时给定的点列表。 */
class MockProvider implements SurfaceDataProvider {
  readonly id: string;
  constructor(id: string, private pts: SurfacePoint[]) {
    this.id = id;
  }
  getSurfacePoints(): SurfacePoint[] {
    return this.pts;
  }
}

describe('SurfacePoint helpers', () => {
  it('createSurfacePoint 克隆 position / normal', () => {
    const pos = new Vector3(1, 2, 3);
    const nrm = new Vector3(0, 1, 0);
    const sp = createSurfacePoint(pos, nrm);
    expect(sp.position).not.toBe(pos);
    expect(sp.position.equals(pos)).toBe(true);
    expect(sp.normal).not.toBe(nrm);
    expect(sp.normal.equals(nrm)).toBe(true);
    pos.x = 99;
    expect(sp.position.x).toBe(1);
  });

  it('getDominantTag 返回最高权重标签', () => {
    const sp = createSurfacePoint(new Vector3(), new Vector3(0, 1, 0), [
      { id: 'a', weight: 0.3 },
      { id: 'b', weight: 0.7 },
      { id: 'c', weight: 0.5 },
    ]);
    expect(getDominantTag(sp)).toBe('b');
  });

  it('getDominantTag 无标签返回 null', () => {
    const sp = createSurfacePoint(new Vector3(), new Vector3(0, 1, 0));
    expect(getDominantTag(sp)).toBeNull();
  });

  it('getTagWeight 缺失标签返回 0', () => {
    const sp = createSurfacePoint(new Vector3(), new Vector3(0, 1, 0), [
      { id: 'a', weight: 0.5 },
    ]);
    expect(getTagWeight(sp, 'a')).toBe(0.5);
    expect(getTagWeight(sp, 'missing')).toBe(0);
  });
});

describe('SurfaceDataProviderRegistry', () => {
  it('register / get / getAll / unregister / clear', () => {
    const reg = new SurfaceDataProviderRegistry();
    const p = new MockProvider('p1', []);
    reg.register(p);
    expect(reg.get('p1')).toBe(p);
    expect(reg.getAll()).toHaveLength(1);

    reg.unregister('p1');
    expect(reg.get('p1')).toBeUndefined();

    reg.register(p);
    reg.clear();
    expect(reg.getAll()).toHaveLength(0);
  });
});

describe('SurfaceDataSystem', () => {
  it('query 合并多 provider,标签权重求和并钳制到 1,保留首个非零法线', () => {
    const reg = new SurfaceDataProviderRegistry();
    reg.register(
      new MockProvider('p1', [
        createSurfacePoint(new Vector3(0, 0, 0), new Vector3(0, 0, 0), [
          { id: TAG_GRASS, weight: 0.6 },
        ]),
      ]),
    );
    reg.register(
      new MockProvider('p2', [
        createSurfacePoint(new Vector3(0, 0, 0), new Vector3(0, 1, 0), [
          { id: TAG_GRASS, weight: 0.6 },
        ]),
      ]),
    );
    const sys = new SurfaceDataSystem(reg);
    const result = sys.query(new Vector3(0, 0, 0));
    expect(result).not.toBeNull();
    expect(getTagWeight(result!, TAG_GRASS)).toBe(1); // 0.6 + 0.6 = 1.2 → 钳制 1
    expect(result!.normal.equals(new Vector3(0, 1, 0))).toBe(true); // 首个非零法线
  });

  it('query 无 provider 返回 null', () => {
    const sys = new SurfaceDataSystem(new SurfaceDataProviderRegistry());
    expect(sys.query(new Vector3())).toBeNull();
  });

  it('queryTag 返回主标签', () => {
    const reg = new SurfaceDataProviderRegistry();
    reg.register(
      new MockProvider('p1', [
        createSurfacePoint(new Vector3(), new Vector3(0, 1, 0), [
          { id: TAG_ROCK, weight: 1 },
        ]),
      ]),
    );
    const sys = new SurfaceDataSystem(reg);
    expect(sys.queryTag(new Vector3())).toBe(TAG_ROCK);
  });

  it('queryBatch 返回等长数组', () => {
    const sys = new SurfaceDataSystem(new SurfaceDataProviderRegistry());
    const results = sys.queryBatch([new Vector3(0, 0, 0), new Vector3(1, 1, 1)]);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });
});

describe('TerrainSurfaceProvider', () => {
  it('高度带:低=water / 中=grass / 高=rock', () => {
    let h = 0;
    const provider = new TerrainSurfaceProvider(
      'terrain',
      () => h,
      () => new Vector3(0, 1, 0),
      {
        altitudeBands: [
          { tag: TAG_WATER, minAltitude: -Infinity, maxAltitude: 10 },
          { tag: TAG_GRASS, minAltitude: 10, maxAltitude: 100 },
          { tag: TAG_ROCK, minAltitude: 100, maxAltitude: Infinity },
        ],
      },
    );

    h = 0;
    let pts = provider.getSurfacePoints(new Vector3(5, 0, 5), 1);
    expect(pts).toHaveLength(1);
    expect(getTagWeight(pts[0], TAG_WATER)).toBe(1);

    h = 50;
    pts = provider.getSurfacePoints(new Vector3(5, 0, 5), 1);
    expect(getTagWeight(pts[0], TAG_GRASS)).toBe(1);

    h = 200;
    pts = provider.getSurfacePoints(new Vector3(5, 0, 5), 1);
    expect(getTagWeight(pts[0], TAG_ROCK)).toBe(1);
  });

  it('maxPoints=0 返回空数组', () => {
    const provider = new TerrainSurfaceProvider(
      'terrain',
      () => 0,
      () => new Vector3(0, 1, 0),
      { altitudeBands: [{ tag: TAG_WATER, minAltitude: -Infinity, maxAltitude: 10 }] },
    );
    expect(provider.getSurfacePoints(new Vector3(0, 0, 0), 0)).toEqual([]);
  });
});

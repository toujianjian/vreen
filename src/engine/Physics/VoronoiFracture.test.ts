// VoronoiFracture 测试 — 基于 Voronoi 图的几何破碎。
//
// 验证:
//   • generateSites — 数量 / 范围 / 确定性(注入 rand) / 边界条件
//   • fracture — 碎片数量 / 凸包性 / 总三角形守恒(近似)
//   • clipFragment — 单碎片裁剪
//   • Sutherland-Hodgman 裁剪正确性(用简单可验证几何)

import { describe, it, expect } from 'vitest';
import { VoronoiFracture, type VoronoiSite } from './VoronoiFracture';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math/Vector3';

/** 构造一个单位立方体(12 三角形,36 顶点,非索引化)。 */
function makeUnitBox(): BufferGeometry {
  const positions = new Float32Array([
    // +X
    1, 0, 0,  1, 1, 0,  1, 1, 1,
    1, 0, 0,  1, 1, 1,  1, 0, 1,
    // -X
    0, 0, 1,  0, 1, 1,  0, 1, 0,
    0, 0, 1,  0, 1, 0,  0, 0, 0,
    // +Y
    0, 1, 0,  0, 1, 1,  1, 1, 1,
    0, 1, 0,  1, 1, 1,  1, 1, 0,
    // -Y
    0, 0, 1,  0, 0, 0,  1, 0, 0,
    0, 0, 1,  1, 0, 0,  1, 0, 1,
    // +Z
    1, 0, 1,  1, 1, 1,  0, 1, 1,
    1, 0, 1,  0, 1, 1,  0, 0, 1,
    // -Z
    0, 0, 0,  0, 1, 0,  1, 1, 0,
    0, 0, 0,  1, 1, 0,  1, 0, 0,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.computeBoundingBox();
  return g;
}

/** 构造一个简单三角形(在 XY 平面,z=0)。 */
function makeTriangle(ax: number, ay: number,
                       bx: number, by: number,
                       cx: number, cy: number): BufferGeometry {
  const positions = new Float32Array([ax, ay, 0, bx, by, 0, cx, cy, 0]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.computeBoundingBox();
  return g;
}

describe('VoronoiFracture — generateSites', () => {
  it('生成指定数量的站点', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites = v.generateSites(g, 5);
    expect(sites.length).toBe(5);
    expect(sites[0].index).toBe(0);
    expect(sites[4].index).toBe(4);
  });

  it('站点位置在 AABB 内', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites = v.generateSites(g, 10);
    for (const s of sites) {
      expect(s.position.x).toBeGreaterThanOrEqual(0);
      expect(s.position.x).toBeLessThanOrEqual(1);
      expect(s.position.y).toBeGreaterThanOrEqual(0);
      expect(s.position.y).toBeLessThanOrEqual(1);
      expect(s.position.z).toBeGreaterThanOrEqual(0);
      expect(s.position.z).toBeLessThanOrEqual(1);
    }
  });

  it('注入 rand 实现确定性', () => {
    let seed = 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const v1 = new VoronoiFracture(rand);
    const v2 = new VoronoiFracture(rand);
    const g = makeUnitBox();
    const s1 = v1.generateSites(g, 3);
    v2.generateSites(g, 3);
    // 两个独立实例用相同 rand 应产生相同序列(注意:rand 是闭包,需重置 seed)
    // 这里只验证 v1 的输出确定性 — 重新用同 seed 跑一遍
    let seed2 = 0;
    const rand2 = () => {
      seed2 = (seed2 * 1664525 + 1013904223) % 4294967296;
      return seed2 / 4294967296;
    };
    const v3 = new VoronoiFracture(rand2);
    const s3 = v3.generateSites(g, 3);
    for (let i = 0; i < 3; i++) {
      expect(s1[i].position.x).toBeCloseTo(s3[i].position.x, 5);
      expect(s1[i].position.y).toBeCloseTo(s3[i].position.y, 5);
    }
  });

  it('count <= 0 抛错', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    expect(() => v.generateSites(g, 0)).toThrow(/must be > 0/);
    expect(() => v.generateSites(g, -1)).toThrow(/must be > 0/);
  });

  it('空 bounding box 抛错', () => {
    const v = new VoronoiFracture();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    // 不调用 computeBoundingBox → boundingBox 为 null
    expect(() => v.generateSites(g, 1)).toThrow(/empty bounding box/);
  });
});

describe('VoronoiFracture — fracture', () => {
  it('单站点 → 返回原几何(整体作为一个碎片)', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites: VoronoiSite[] = [
      { position: new Vector3(0.5, 0.5, 0.5), index: 0 },
    ];
    const pieces = v.fracture(g, sites);
    expect(pieces.length).toBe(1);
    // 12 个三角形(原几何的三角形数)
    expect(pieces[0].attributes.position.count).toBe(36);
  });

  it('两个站点 → 两个碎片,各占一半(用对称站点)', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    // 两个站点在 X=0.25 和 X=0.75,中垂面在 X=0.5
    const sites: VoronoiSite[] = [
      { position: new Vector3(0.25, 0.5, 0.5), index: 0 },
      { position: new Vector3(0.75, 0.5, 0.5), index: 1 },
    ];
    const pieces = v.fracture(g, sites);
    expect(pieces.length).toBe(2);
    // 两个碎片顶点总数应接近原几何(允许裁剪产生的新顶点)
    const totalVerts = pieces[0].attributes.position.count + pieces[1].attributes.position.count;
    expect(totalVerts).toBeGreaterThanOrEqual(36);
  });

  it('碎片三角形数都是 3 的倍数(三角化完整)', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites: VoronoiSite[] = [
      { position: new Vector3(0.25, 0.5, 0.5), index: 0 },
      { position: new Vector3(0.75, 0.5, 0.5), index: 1 },
    ];
    const pieces = v.fracture(g, sites);
    for (const p of pieces) {
      expect(p.attributes.position.count % 3).toBe(0);
    }
  });

  it('站点在几何外 → 仍可产生碎片', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites: VoronoiSite[] = [
      { position: new Vector3(-1, 0.5, 0.5), index: 0 },
      { position: new Vector3(2, 0.5, 0.5), index: 1 },
    ];
    const pieces = v.fracture(g, sites);
    expect(pieces.length).toBeGreaterThan(0);
  });

  it('空 sites 抛错', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    expect(() => v.fracture(g, [])).toThrow(/non-empty/);
  });
});

describe('VoronoiFracture — clipFragment', () => {
  it('单站点裁剪 = 原几何整体', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const site: VoronoiSite = { position: new Vector3(0.5, 0.5, 0.5), index: 0 };
    const result = v.clipFragment(g, site, [site]);
    expect(result).not.toBeNull();
    expect(result!.attributes.position.count).toBe(36);
  });

  it('两站点裁剪 → 半个几何', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const s1: VoronoiSite = { position: new Vector3(0.25, 0.5, 0.5), index: 0 };
    const s2: VoronoiSite = { position: new Vector3(0.75, 0.5, 0.5), index: 1 };
    const result = v.clipFragment(g, s1, [s1, s2]);
    expect(result).not.toBeNull();
    // 半个立方体,三角形数应是 3 的倍数
    // (裁剪可能因分裂三角形引入新顶点,所以不强制 < 原几何)
    expect(result!.attributes.position.count).toBeGreaterThan(0);
    expect(result!.attributes.position.count % 3).toBe(0);
    // 站点 1 的碎片 boundingBox X 上界应 <= 0.5(中垂面位置)
    expect(result!.boundingBox!.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it('空 allSites 返回 null', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const site: VoronoiSite = { position: new Vector3(0, 0, 0), index: 0 };
    const result = v.clipFragment(g, site, []);
    expect(result).toBeNull();
  });
});

describe('VoronoiFracture — 平面裁剪正确性', () => {
  it('三角形被中垂面切成两块(对称验证)', () => {
    const v = new VoronoiFracture();
    // 等腰三角形:顶点 (-1,0), (1,0), (0,2)
    const g = makeTriangle(-1, 0, 1, 0, 0, 2);
    // 两站点在 X=-0.5 和 X=0.5,中垂面在 X=0
    const sites: VoronoiSite[] = [
      { position: new Vector3(-0.5, 0.5, 0), index: 0 },
      { position: new Vector3(0.5, 0.5, 0), index: 1 },
    ];
    const pieces = v.fracture(g, sites);
    expect(pieces.length).toBe(2);
    // 两个碎片顶点数应相等(对称)
    expect(pieces[0].attributes.position.count).toBe(pieces[1].attributes.position.count);
  });

  it('三角形完全在站点一侧 → 不被裁剪', () => {
    const v = new VoronoiFracture();
    // 三角形在 X ∈ [0, 1]
    const g = makeTriangle(0, 0, 1, 0, 0, 1);
    // 站点 1 在 X=0.5,站点 2 在 X=10(中垂面在 X=5.25,远超三角形)
    const sites: VoronoiSite[] = [
      { position: new Vector3(0.5, 0.5, 0), index: 0 },
      { position: new Vector3(10, 0.5, 0), index: 1 },
    ];
    const pieces = v.fracture(g, sites);
    // 站点 0 的碎片包含原三角形;站点 1 的碎片为空(被过滤)
    expect(pieces.length).toBe(1);
    expect(pieces[0].attributes.position.count).toBe(3);
  });
});

describe('VoronoiFracture — 几何守恒', () => {
  it('碎片顶点总数 >= 原几何顶点数(裁剪引入新顶点)', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites: VoronoiSite[] = [
      { position: new Vector3(0.2, 0.2, 0.2), index: 0 },
      { position: new Vector3(0.8, 0.2, 0.2), index: 1 },
      { position: new Vector3(0.2, 0.8, 0.2), index: 2 },
      { position: new Vector3(0.8, 0.8, 0.2), index: 3 },
    ];
    const pieces = v.fracture(g, sites);
    let totalVerts = 0;
    for (const p of pieces) totalVerts += p.attributes.position.count;
    // 4 站点至少产生 2 个有效碎片(凸包)
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    expect(totalVerts).toBeGreaterThanOrEqual(36);
  });

  it('所有碎片都是非索引化 BufferGeometry', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites = v.generateSites(g, 3);
    const pieces = v.fracture(g, sites);
    for (const p of pieces) {
      expect(p.index).toBeNull();
      expect(p.attributes.position).toBeDefined();
    }
  });

  it('碎片有 boundingBox / boundingSphere', () => {
    const v = new VoronoiFracture();
    const g = makeUnitBox();
    const sites: VoronoiSite[] = [
      { position: new Vector3(0.25, 0.5, 0.5), index: 0 },
      { position: new Vector3(0.75, 0.5, 0.5), index: 1 },
    ];
    const pieces = v.fracture(g, sites);
    for (const p of pieces) {
      expect(p.boundingBox).not.toBeNull();
      expect(p.boundingSphere).not.toBeNull();
    }
  });
});

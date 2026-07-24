import { describe, it, expect } from 'vitest';
import { Texture } from '../Core/Texture';
import { TerrainGeometry } from './TerrainGeometry';
import { TerrainLayer } from './TerrainLayer';
import { TerrainSplat } from './TerrainSplat';

describe('TerrainSplat', () => {
  function makeFlatGeometry(heightScale = 1): TerrainGeometry {
    return new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: new Float32Array(4), // 全 0 平坦
      heightScale,
    });
  }

  it('splatmap 长度 = 顶点数 * 4', () => {
    const g = makeFlatGeometry();
    const splat = new TerrainSplat();
    const tex = new Texture('t');
    const out = splat.generateSplatmap(g, [
      new TerrainLayer({ texture: tex, minHeight: -Infinity, maxHeight: Infinity, maxSlope: 90 }),
    ]);
    expect(out.length).toBe(4 * 4); // 4 顶点 * RGBA
  });

  it('单层规则 → 所有顶点 R=255', () => {
    const g = makeFlatGeometry();
    const splat = new TerrainSplat();
    const out = splat.generateSplatmap(g, [
      new TerrainLayer({ texture: new Texture('sand'), minHeight: -Infinity, maxHeight: Infinity, maxSlope: 90 }),
    ]);
    for (let i = 0; i < g.attributes.position.count; i++) {
      expect(out[i * 4 + 0]).toBe(255); // R
      expect(out[i * 4 + 1]).toBe(0); // G
      expect(out[i * 4 + 2]).toBe(0); // B
      expect(out[i * 4 + 3]).toBe(0); // A
    }
  });

  it('每顶点 RGBA 权重和 ≈ 255', () => {
    const g = makeFlatGeometry(10);
    const splat = new TerrainSplat();
    const out = splat.generateSplatmap(g, [
      new TerrainLayer({ texture: new Texture('a'), minHeight: 0, maxHeight: 10, maxSlope: 90 }),
      new TerrainLayer({ texture: new Texture('b'), minHeight: 0, maxHeight: 10, maxSlope: 90 }),
      new TerrainLayer({ texture: new Texture('c'), minHeight: 5, maxHeight: 20, maxSlope: 90 }),
    ]);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const sum = out[i * 4] + out[i * 4 + 1] + out[i * 4 + 2] + out[i * 4 + 3];
      expect(sum).toBeGreaterThan(250);
      expect(sum).toBeLessThanOrEqual(255);
    }
  });

  it('两层均匹配 → 权重近似均分', () => {
    const g = makeFlatGeometry(10);
    const splat = new TerrainSplat();
    const out = splat.generateSplatmap(g, [
      new TerrainLayer({ texture: new Texture('a'), minHeight: -Infinity, maxHeight: Infinity, maxSlope: 90 }),
      new TerrainLayer({ texture: new Texture('b'), minHeight: -Infinity, maxHeight: Infinity, maxSlope: 90 }),
    ]);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const r = out[i * 4];
      const grn = out[i * 4 + 1];
      // 两层权重都为 1,归一化后各 0.5 → 128 附近
      expect(r).toBeGreaterThan(120);
      expect(r).toBeLessThan(136);
      expect(grn).toBeGreaterThan(120);
      expect(grn).toBeLessThan(136);
      expect(r + grn).toBe(255);
    }
  });

  it('高度区分:低处 → 层0,高处 → 层1', () => {
    // 3x3 高度图,中心高,四角低
    const map = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const g = new TerrainGeometry({
      width: 8,
      height: 8,
      widthSegments: 2,
      heightSegments: 2,
      heightmap: map,
      heightScale: 20,
    });
    const splat = new TerrainSplat();
    const out = splat.generateSplatmap(g, [
      // 层 0:低 + 平坦(沙)
      new TerrainLayer({ texture: new Texture('sand'), minHeight: -5, maxHeight: 5, maxSlope: 90 }),
      // 层 1:高 + 平坦(雪),中心顶点高度=20、坡度=0 → 命中
      new TerrainLayer({ texture: new Texture('snow'), minHeight: 15, maxHeight: 30, maxSlope: 90 }),
    ]);
    // 中心顶点 = index 4
    const centerR = out[4 * 4 + 0];
    const centerG = out[4 * 4 + 1];
    // 中心高度 20、坡度 0:层0(heightTent=0)层1(heightTent=1, slopeFit=1) → 层1 主导
    expect(centerG).toBeGreaterThan(centerR);
    expect(centerG).toBe(255);

    // 四角顶点高度 0:层0 命中,层1 不命中
    const cornerR = out[0 * 4 + 0];
    const cornerG = out[0 * 4 + 1];
    expect(cornerR).toBe(255);
    expect(cornerG).toBe(0);
  });

  it('addLayer 限制最多 4 层', () => {
    const splat = new TerrainSplat();
    splat.addLayer(new TerrainLayer({ texture: new Texture('a') }));
    splat.addLayer(new TerrainLayer({ texture: new Texture('b') }));
    splat.addLayer(new TerrainLayer({ texture: new Texture('c') }));
    splat.addLayer(new TerrainLayer({ texture: new Texture('d') }));
    expect(splat.layers.length).toBe(4);
    expect(() => splat.addLayer(new TerrainLayer({ texture: new Texture('e') }))).toThrow();
  });

  it('空规则抛错', () => {
    const g = makeFlatGeometry();
    const splat = new TerrainSplat();
    expect(() => splat.generateSplatmap(g, [])).toThrow();
  });

  it('超过 4 层规则抛错', () => {
    const g = makeFlatGeometry();
    const splat = new TerrainSplat();
    const layers = Array.from({ length: 5 }, () => new TerrainLayer({ texture: new Texture('t') }));
    expect(() => splat.generateSplatmap(g, layers)).toThrow();
  });

  it('getSplatmap 在生成前为 null,生成后返回数据', () => {
    const splat = new TerrainSplat();
    expect(splat.getSplatmap()).toBeNull();
    const g = makeFlatGeometry();
    splat.generateSplatmap(g, [new TerrainLayer({ texture: new Texture('t') })]);
    expect(splat.getSplatmap()).not.toBeNull();
    expect(splat.getSplatmap()?.length).toBe(16);
  });

  it('splatmapWidth/Height 与几何体网格一致', () => {
    const g = new TerrainGeometry({
      width: 10,
      height: 10,
      widthSegments: 3,
      heightSegments: 2,
      heightmap: new Float32Array(4 * 3),
      heightScale: 1,
    });
    const splat = new TerrainSplat();
    splat.generateSplatmap(g, [new TerrainLayer({ texture: new Texture('t') })]);
    expect(splat.splatmapWidth).toBe(4);
    expect(splat.splatmapHeight).toBe(3);
  });
});

import { describe, it, expect } from 'vitest';
import { TerrainGeometry } from './TerrainGeometry';

function hasNaN(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) return true;
  }
  return false;
}

describe('TerrainGeometry', () => {
  it('2x2 高度图生成 4 顶点 / 6 索引', () => {
    const g = new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: new Float32Array([0, 0, 0, 1]),
      heightScale: 10,
    });
    expect(g.attributes.position.count).toBe(4);
    expect(g.index?.count).toBe(6);
  });

  it('属性数组无 NaN', () => {
    const g = new TerrainGeometry({
      width: 10,
      height: 10,
      widthSegments: 4,
      heightSegments: 4,
      heightmap: new Float32Array(5 * 5).map((_, i) => (i % 7) / 7),
      heightScale: 5,
    });
    expect(hasNaN(g.attributes.position.array)).toBe(false);
    expect(hasNaN(g.attributes.normal.array)).toBe(false);
    expect(hasNaN(g.attributes.uv.array)).toBe(false);
    expect(hasNaN(g.index?.array ?? new Float32Array())).toBe(false);
  });

  it('分段数正确放大顶点数', () => {
    const g = new TerrainGeometry({
      width: 10,
      height: 10,
      widthSegments: 3,
      heightSegments: 2,
      heightmap: new Float32Array(4 * 3),
      heightScale: 1,
    });
    // (3+1)*(2+1) = 12 顶点;3*2*6 = 36 索引
    expect(g.attributes.position.count).toBe(12);
    expect(g.index?.count).toBe(36);
  });

  it('position.y = heightmap[i] * heightScale', () => {
    const map = new Float32Array([0, 0.5, 0.25, 1]);
    const g = new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: map,
      heightScale: 20,
    });
    const p = g.attributes.position.array;
    // 顶点顺序:(0,0) (1,0) (0,1) (1,1)
    expect(p[1]).toBeCloseTo(0 * 20, 5);
    expect(p[4]).toBeCloseTo(0.5 * 20, 5);
    expect(p[7]).toBeCloseTo(0.25 * 20, 5);
    expect(p[10]).toBeCloseTo(1 * 20, 5);
  });

  it('Uint8Array 高度图归一化到 0..1', () => {
    const g = new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: new Uint8Array([0, 128, 255, 64]),
      heightScale: 10,
    });
    const p = g.attributes.position.array;
    expect(p[1]).toBeCloseTo(0, 5);
    expect(p[4]).toBeCloseTo((128 / 255) * 10, 4);
    expect(p[7]).toBeCloseTo(1 * 10, 5);
    expect(p[10]).toBeCloseTo((64 / 255) * 10, 4);
  });

  it('法线为归一化单位向量', () => {
    const g = new TerrainGeometry({
      width: 10,
      height: 10,
      widthSegments: 4,
      heightSegments: 4,
      heightmap: new Float32Array(5 * 5).map(() => Math.random()),
      heightScale: 3,
    });
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('平坦高度图法线指向 +Y', () => {
    const g = new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: new Float32Array(4), // 全 0
      heightScale: 10,
    });
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      expect(n[i]).toBeCloseTo(0, 5);
      expect(n[i + 1]).toBeCloseTo(1, 5);
      expect(n[i + 2]).toBeCloseTo(0, 5);
    }
  });

  it('heightmap 长度不匹配时抛错', () => {
    expect(
      () =>
        new TerrainGeometry({
          width: 4,
          height: 4,
          widthSegments: 1,
          heightSegments: 1,
          heightmap: new Float32Array(3), // 应为 4
          heightScale: 1,
        }),
    ).toThrow();
  });

  it('getHeightAt 顶点处返回精确高度', () => {
    const g = new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: new Float32Array([0, 0, 0, 1]),
      heightScale: 10,
    });
    // 四个顶点:(-2,-2) (2,-2) (-2,2) (2,2)
    expect(g.getHeightAt(-2, -2)).toBeCloseTo(0, 5);
    expect(g.getHeightAt(2, -2)).toBeCloseTo(0, 5);
    expect(g.getHeightAt(-2, 2)).toBeCloseTo(0, 5);
    expect(g.getHeightAt(2, 2)).toBeCloseTo(10, 5);
  });

  it('getHeightAt 中心点双线性插值正确', () => {
    // heightmap = [0, 0, 0, 1],heightScale=10
    // 中心 (0,0):tx=0.5, tz=0.5
    // h00=0, h10=0, h01=0, h11=1
    // h = 0 + (0 + (1-0)*0.5 - 0)*0.5 = 0.25 → 0.25*10 = 2.5
    const g = new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: new Float32Array([0, 0, 0, 1]),
      heightScale: 10,
    });
    expect(g.getHeightAt(0, 0)).toBeCloseTo(2.5, 5);
  });

  it('getHeightAt 越界钳制到边界', () => {
    const g = new TerrainGeometry({
      width: 4,
      height: 4,
      widthSegments: 1,
      heightSegments: 1,
      heightmap: new Float32Array([0, 0, 0, 1]),
      heightScale: 10,
    });
    // 远超边界 → 钳制到角点
    expect(g.getHeightAt(-100, -100)).toBeCloseTo(0, 5);
    expect(g.getHeightAt(100, 100)).toBeCloseTo(10, 5);
  });

  it('未指定 segments 时从正方形高度图推断', () => {
    // 长度 16 = 4*4 → gridX1=4 → widthSegments=3
    const g = new TerrainGeometry({
      width: 10,
      height: 10,
      heightmap: new Float32Array(16),
      heightScale: 1,
    });
    expect(g.widthSegments).toBe(3);
    expect(g.heightSegments).toBe(3);
    expect(g.attributes.position.count).toBe(16);
  });

  it('包围盒包含所有顶点', () => {
    const g = new TerrainGeometry({
      width: 10,
      height: 8,
      widthSegments: 2,
      heightSegments: 2,
      heightmap: new Float32Array(9).map((_, i) => i / 8),
      heightScale: 16,
    });
    const bb = g.boundingBox!;
    expect(bb.min.x).toBeCloseTo(-5, 5);
    expect(bb.max.x).toBeCloseTo(5, 5);
    expect(bb.min.z).toBeCloseTo(-4, 5);
    expect(bb.max.z).toBeCloseTo(4, 5);
    // 最高点 = 1 * 16 = 16
    expect(bb.max.y).toBeCloseTo(16, 5);
    expect(bb.min.y).toBeCloseTo(0, 5);
  });
});

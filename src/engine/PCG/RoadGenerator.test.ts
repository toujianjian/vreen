import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import {
  RoadGenerator,
  type TerrainSampler,
  type IntersectionType,
} from './RoadGenerator';

/** 简单平面地形采样器:对所有 (x, z) 返回固定高度。 */
function flatTerrain(height: number): TerrainSampler {
  return { getHeightAt: () => height };
}

/** 斜坡地形:X 方向线性升高。 */
function slopeTerrain(): TerrainSampler {
  return { getHeightAt: (x: number) => x * 0.5 };
}

describe('RoadGenerator', () => {
  describe('构造与默认值', () => {
    it('默认参数:width=8 / segments=32 / smoothness=0.5', () => {
      const r = new RoadGenerator();
      expect(r.getStats().width).toBe(8);
      expect(r.getStats().segmentCount).toBe(0); // 无控制点
      expect(r.getControlPoints().length).toBe(0);
    });

    it('构造选项生效', () => {
      const r = new RoadGenerator({
        width: 10,
        segments: 16,
        smoothness: 0.3,
        controlPoints: [new Vector3(0, 0, 0), new Vector3(1, 0, 0)],
      });
      expect(r.getStats().width).toBe(10);
      expect(r.getControlPoints().length).toBe(2);
      // getControlPoints 返回副本,修改不影响内部
      r.getControlPoints()[0].x = 999;
      expect(r.getControlPoints()[0].x).toBe(0);
    });
  });

  describe('控制点管理', () => {
    it('addControlPoint / getControlPoints', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(1, 0, 0))
        .addControlPoint(new Vector3(2, 0, 0));
      expect(r.getControlPoints().length).toBe(2);
      expect(r.getControlPoints()[0].x).toBe(1);
    });

    it('removeControlPoint 移除指定索引', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(1, 0, 0))
        .addControlPoint(new Vector3(2, 0, 0))
        .addControlPoint(new Vector3(3, 0, 0));
      r.removeControlPoint(1);
      expect(r.getControlPoints().length).toBe(2);
      expect(r.getControlPoints()[1].x).toBe(3);
    });

    it('removeControlPoint 索引越界抛错', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(0, 0, 0));
      expect(() => r.removeControlPoint(1)).toThrow();
      expect(() => r.removeControlPoint(-1)).toThrow();
    });

    it('setControlPoint 修改指定索引', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(1, 0, 0));
      r.setControlPoint(1, new Vector3(5, 5, 5));
      expect(r.getControlPoints()[1].x).toBe(5);
      expect(r.getControlPoints()[1].y).toBe(5);
    });

    it('setControlPoint 索引越界抛错', () => {
      const r = new RoadGenerator();
      expect(() => r.setControlPoint(0, new Vector3(0, 0, 0))).toThrow();
    });
  });

  describe('参数设置与校验', () => {
    it('setWidth / setSegments / setSmoothness 链式返回 this', () => {
      const r = new RoadGenerator();
      expect(r.setWidth(5)).toBe(r);
      expect(r.setSegments(10)).toBe(r);
      expect(r.setSmoothness(0.7)).toBe(r);
      expect(r.getStats().width).toBe(5);
    });

    it('setWidth 非正抛错', () => {
      const r = new RoadGenerator();
      expect(() => r.setWidth(0)).toThrow();
      expect(() => r.setWidth(-1)).toThrow();
    });

    it('setSegments < 1 抛错', () => {
      const r = new RoadGenerator();
      expect(() => r.setSegments(0)).toThrow();
    });

    it('setSmoothness 非正抛错', () => {
      const r = new RoadGenerator();
      expect(() => r.setSmoothness(0)).toThrow();
      expect(() => r.setSmoothness(-1)).toThrow();
    });

    it('setTerrainFollow 设置地形跟随', () => {
      const r = new RoadGenerator();
      r.setTerrainFollow(true, 0.3);
      expect(r.getStats().terrainFollow).toBe(true);
      r.setTerrainFollow(false);
      expect(r.getStats().terrainFollow).toBe(false);
    });
  });

  describe('sampleSpline — Catmull-Rom 采样', () => {
    it('t=0 返回起点,t=1 返回终点', () => {
      const r = new RoadGenerator({ smoothness: 0.5 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0))
        .addControlPoint(new Vector3(20, 0, 5));
      const p0 = r.sampleSpline(0);
      const p1 = r.sampleSpline(1);
      expect(p0.x).toBeCloseTo(0, 5);
      expect(p1.x).toBeCloseTo(20, 5);
      expect(p1.z).toBeCloseTo(5, 5);
    });

    it('smoothness=0 时退化为直线,中点 = (p1+p2)/2', () => {
      const r = new RoadGenerator({ smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const mid = r.sampleSpline(0.5);
      expect(mid.x).toBeCloseTo(5, 5);
      expect(mid.y).toBeCloseTo(0, 5);
      expect(mid.z).toBeCloseTo(0, 5);
    });

    it('smoothness=0.5 标准 CR:2 点时中点 = p1 + 0.5*(p2-p0)*h10(0.5)', () => {
      // 2 控制点:端点钳制 p0=p1, p3=p2
      // point(0.5) = h00*p1 + h01*p2 + 0.5*(h10*(p2-p1) + h11*(p2-p1))
      //   h00(0.5)=0.5, h01(0.5)=0.5, h10(0.5)=0.125, h11(0.5)=-0.125
      //   = 0.5*p1 + 0.5*p2 + 0.5*(0.125*(p2-p1) - 0.125*(p2-p1)) = 0.5*p1 + 0.5*p2
      const r = new RoadGenerator({ smoothness: 0.5 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const mid = r.sampleSpline(0.5);
      // 切线项相互抵消,中点仍为 5
      expect(mid.x).toBeCloseTo(5, 5);
    });

    it('t 超出 [0,1] 被钳制', () => {
      const r = new RoadGenerator({ smoothness: 0.5 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const below = r.sampleSpline(-1);
      const above = r.sampleSpline(2);
      expect(below.x).toBeCloseTo(0, 5);
      expect(above.x).toBeCloseTo(10, 5);
    });

    it('单控制点返回该点', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(3, 4, 5));
      const p = r.sampleSpline(0.5);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
      expect(p.z).toBe(5);
    });

    it('无控制点抛错', () => {
      const r = new RoadGenerator();
      expect(() => r.sampleSpline(0)).toThrow();
    });
  });

  describe('generateSpline / getRoadPoints / getRoadLength', () => {
    it('generateSpline 返回 segments+1 个点', () => {
      const r = new RoadGenerator({ segments: 8, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const pts = r.generateSpline();
      expect(pts.length).toBe(9);
    });

    it('getRoadPoints 与 generateSpline 等价', () => {
      const r = new RoadGenerator({ segments: 4, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(8, 0, 0));
      const a = r.getRoadPoints();
      const b = r.generateSpline();
      expect(a.length).toBe(b.length);
      expect(a[2].x).toBeCloseTo(b[2].x, 5);
    });

    it('getRoadLength 直线长度正确(smoothness=0)', () => {
      const r = new RoadGenerator({ segments: 10, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      // smoothness=0 时样条为直线,长度 = 10
      expect(r.getRoadLength()).toBeCloseTo(10, 1);
    });

    it('getRoadLength 控制点不足时返回 0', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(0, 0, 0));
      expect(r.getRoadLength()).toBe(0);
    });

    it('generateSpline 控制点不足抛错', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(0, 0, 0));
      expect(() => r.generateSpline()).toThrow();
    });
  });

  describe('generate — 几何数据', () => {
    it('顶点数 = (segments+1)*2,三角形数 = segments*2', () => {
      const r = new RoadGenerator({ segments: 4, width: 6, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const data = r.generate();
      expect(data.vertexCount).toBe((4 + 1) * 2); // 10
      expect(data.triangleCount).toBe(4 * 2); // 8
      expect(data.positions.length).toBe(data.vertexCount * 3);
      expect(data.indices.length).toBe(data.triangleCount * 3);
    });

    it('路宽:左右边缘距离 = width', () => {
      const r = new RoadGenerator({ segments: 1, width: 4, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const data = r.generate();
      // 第 0 段左/右顶点:positions[0..2]=left, [3..5]=right
      const lx = data.positions[0], lz = data.positions[2];
      const rx = data.positions[3], rz = data.positions[5];
      const dist = Math.hypot(rx - lx, rz - lz);
      expect(dist).toBeCloseTo(4, 5);
    });

    it('UV:v 方向左右交替 0/1', () => {
      const r = new RoadGenerator({ segments: 2, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const data = r.generate();
      // 顶点 0 (左) v=0, 顶点 1 (右) v=1
      expect(data.uvs[1]).toBe(0);
      expect(data.uvs[3]).toBe(1);
      // 顶点 2 (左) v=0, 顶点 3 (右) v=1
      expect(data.uvs[5]).toBe(0);
      expect(data.uvs[7]).toBe(1);
    });

    it('UV:u 沿长度从 0 到 1 递增', () => {
      const r = new RoadGenerator({ segments: 4, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const data = r.generate();
      const uFirst = data.uvs[0];
      const uLast = data.uvs[(data.vertexCount - 1) * 2];
      expect(uFirst).toBeCloseTo(0, 5);
      expect(uLast).toBeCloseTo(1, 5);
    });

    it('默认法线朝上 (+Y)', () => {
      const r = new RoadGenerator({ segments: 1, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const data = r.generate();
      // 第 0 顶点法线
      expect(data.normals[1]).toBeCloseTo(1, 5);
      expect(data.normals[0]).toBeCloseTo(0, 5);
      expect(data.normals[2]).toBeCloseTo(0, 5);
    });

    it('控制点不足抛错', () => {
      const r = new RoadGenerator();
      r.addControlPoint(new Vector3(0, 0, 0));
      expect(() => r.generate()).toThrow();
    });

    it('大段数使用 Uint32 索引(顶点 > 65535)', () => {
      // segments=40000 → 顶点 = 80002 > 65535
      const r = new RoadGenerator({ segments: 40000, width: 1, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(1, 0, 0));
      const data = r.generate();
      expect(data.indices instanceof Uint32Array).toBe(true);
      expect(data.vertexCount).toBeGreaterThan(65535);
    });

    it('小段数使用 Uint16 索引', () => {
      const r = new RoadGenerator({ segments: 10, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const data = r.generate();
      expect(data.indices instanceof Uint16Array).toBe(true);
    });
  });

  describe('generate — 地形跟随', () => {
    it('启用地形跟随时 Y = 地形高度 + offset', () => {
      const r = new RoadGenerator({ segments: 2, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      r.setTerrainFollow(true, 0.2);
      r.setTerrain(flatTerrain(5));
      const data = r.generate();
      // 所有顶点 Y = 5 + 0.2 = 5.2
      for (let i = 1; i < data.vertexCount * 3; i += 3) {
        expect(data.positions[i]).toBeCloseTo(5.2, 5);
      }
    });

    it('斜坡地形:Y 随 X 线性变化', () => {
      const r = new RoadGenerator({ segments: 1, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      r.setTerrainFollow(true, 0);
      r.setTerrain(slopeTerrain());
      const data = r.generate();
      // 第 0 段中心 X=0 → Y=0
      expect(data.positions[1]).toBeCloseTo(0, 5);
      // 第 1 段中心 X=10 → Y=5
      // 顶点 2/3 是第 1 段,Y = 5
      expect(data.positions[3 * 2 + 1]).toBeCloseTo(5, 5);
    });

    it('未设置地形采样器时,地形跟随不改变 Y', () => {
      const r = new RoadGenerator({ segments: 1, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 2, 0))
        .addControlPoint(new Vector3(10, 2, 0));
      r.setTerrainFollow(true, 0.5);
      // 未 setTerrain → 保持控制点 Y=2
      const data = r.generate();
      expect(data.positions[1]).toBeCloseTo(2, 5);
    });

    it('地形跟随时法线由曲面重算(ny 接近 1)', () => {
      const r = new RoadGenerator({ segments: 2, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      r.setTerrainFollow(true, 0);
      r.setTerrain(flatTerrain(0));
      const data = r.generate();
      // 平地地形 → 法线仍接近 +Y
      expect(data.normals[1]).toBeGreaterThan(0.99);
    });
  });

  describe('generateMesh — BufferGeometry', () => {
    it('返回带 position/normal/uv/index 的 BufferGeometry', () => {
      const r = new RoadGenerator({ segments: 4, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const geo = r.generateMesh();
      expect(geo.attributes.position).toBeDefined();
      expect(geo.attributes.normal).toBeDefined();
      expect(geo.attributes.uv).toBeDefined();
      expect(geo.index).not.toBeNull();
      expect(geo.boundingBox).not.toBeNull();
    });

    it('包围盒包含道路范围', () => {
      const r = new RoadGenerator({ segments: 4, width: 4, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0));
      const geo = r.generateMesh();
      const bb = geo.boundingBox!;
      expect(bb.min.x).toBeLessThanOrEqual(0);
      expect(bb.max.x).toBeGreaterThanOrEqual(10);
    });
  });

  describe('交叉路口', () => {
    it('addIntersection / getIntersections', () => {
      const r = new RoadGenerator();
      r.addIntersection(new Vector3(5, 0, 5), 'cross')
        .addIntersection(new Vector3(10, 0, 10), 'tjunction');
      const its = r.getIntersections();
      expect(its.length).toBe(2);
      expect(its[0].type).toBe('cross');
      expect(its[1].type).toBe('tjunction');
      expect(its[0].position.x).toBe(5);
    });

    it('getIntersections 返回副本,修改不影响内部', () => {
      const r = new RoadGenerator();
      r.addIntersection(new Vector3(1, 2, 3), 'corner');
      const its = r.getIntersections();
      its[0].position.x = 999;
      expect(r.getIntersections()[0].position.x).toBe(1);
    });

    it('removeIntersection 移除指定索引', () => {
      const r = new RoadGenerator();
      r.addIntersection(new Vector3(0, 0, 0), 'cross')
        .addIntersection(new Vector3(1, 0, 0), 'corner');
      r.removeIntersection(0);
      expect(r.getIntersections().length).toBe(1);
      expect(r.getIntersections()[0].type).toBe('corner');
    });

    it('removeIntersection 索引越界抛错', () => {
      const r = new RoadGenerator();
      expect(() => r.removeIntersection(0)).toThrow();
    });

    it('全部 IntersectionType 值可接受', () => {
      const types: IntersectionType[] = ['cross', 'tjunction', 'corner'];
      const r = new RoadGenerator();
      for (const ty of types) {
        r.addIntersection(new Vector3(0, 0, 0), ty);
      }
      expect(r.getIntersections().length).toBe(3);
    });

    it('默认类型为 cross', () => {
      const r = new RoadGenerator();
      r.addIntersection(new Vector3(0, 0, 0));
      expect(r.getIntersections()[0].type).toBe('cross');
    });
  });

  describe('getStats', () => {
    it('无控制点时统计归零', () => {
      const r = new RoadGenerator();
      const s = r.getStats();
      expect(s.controlPointCount).toBe(0);
      expect(s.segmentCount).toBe(0);
      expect(s.vertexCount).toBe(0);
      expect(s.triangleCount).toBe(0);
      expect(s.roadLength).toBe(0);
    });

    it('有控制点时统计正确', () => {
      const r = new RoadGenerator({ segments: 8, width: 6, smoothness: 0 });
      r.addControlPoint(new Vector3(0, 0, 0))
        .addControlPoint(new Vector3(10, 0, 0))
        .addControlPoint(new Vector3(20, 0, 0));
      r.addIntersection(new Vector3(10, 0, 0), 'cross');
      r.setTerrainFollow(true, 0.1);
      const s = r.getStats();
      expect(s.controlPointCount).toBe(3);
      expect(s.segmentCount).toBe(8);
      expect(s.vertexCount).toBe((8 + 1) * 2);
      expect(s.triangleCount).toBe(8 * 2);
      expect(s.intersectionCount).toBe(1);
      expect(s.terrainFollow).toBe(true);
      expect(s.width).toBe(6);
    });
  });
});

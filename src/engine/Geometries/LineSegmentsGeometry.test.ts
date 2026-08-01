// LineSegmentsGeometry 单元测试 — 模板几何、setPositions/setColors、
// applyMatrix4、computeBoundingBox/computeBoundingSphere。

import { describe, it, expect } from 'vitest';
import { LineSegmentsGeometry } from './LineSegmentsGeometry';
import { Matrix4 } from '../Math/Matrix4';

describe('LineSegmentsGeometry', () => {
  describe('构造', () => {
    it('默认构造设置类型标志', () => {
      const geo = new LineSegmentsGeometry();
      expect(geo.isLineSegmentsGeometry).toBe(true);
      expect(geo.type).toBe('LineSegmentsGeometry');
      expect(geo.isInstancedGeometry).toBe(true);
    });

    it('模板几何:8 顶点 position + 8 uv + 18 索引', () => {
      const geo = new LineSegmentsGeometry();
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      const idx = geo.index;
      expect(pos.count).toBe(8);
      expect(pos.itemSize).toBe(3);
      expect(uv.count).toBe(8);
      expect(uv.itemSize).toBe(2);
      expect(idx).not.toBeNull();
      expect(idx!.count).toBe(18);
    });

    it('模板 position 包含正确的 three.js 原值', () => {
      const geo = new LineSegmentsGeometry();
      const arr = geo.attributes.position.array as Float32Array;
      // 第一个顶点 [-1, 2, 0]
      expect(arr[0]).toBe(-1);
      expect(arr[1]).toBe(2);
      expect(arr[2]).toBe(0);
      // 最后一个顶点 [1, -1, 0]
      expect(arr[21]).toBe(1);
      expect(arr[22]).toBe(-1);
      expect(arr[23]).toBe(0);
    });

    it('初始 instanceCount=0', () => {
      const geo = new LineSegmentsGeometry();
      expect(geo.instanceCount).toBe(0);
    });
  });

  describe('setPositions', () => {
    it('单段线段:[0,0,0, 1,0,0] → instanceStart/End', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      expect(geo.instanceCount).toBe(1);

      const start = geo.customAttributes.get('instanceStart')!;
      const end = geo.customAttributes.get('instanceEnd')!;
      expect(start.length).toBe(3);
      expect(end.length).toBe(3);
      expect(start[0]).toBe(0);
      expect(start[1]).toBe(0);
      expect(start[2]).toBe(0);
      expect(end[0]).toBe(1);
      expect(end[1]).toBe(0);
      expect(end[2]).toBe(0);
    });

    it('多段线段:3 段', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([
        0, 0, 0, 1, 0, 0,
        1, 0, 0, 1, 1, 0,
        1, 1, 0, 0, 1, 0,
      ]);
      expect(geo.instanceCount).toBe(3);

      const start = geo.customAttributes.get('instanceStart')!;
      const end = geo.customAttributes.get('instanceEnd')!;
      // 段2 起点 = (1,1,0),终点 = (0,1,0)
      expect(start[6]).toBe(1);
      expect(start[7]).toBe(1);
      expect(end[6]).toBe(0);
      expect(end[7]).toBe(1);
    });

    it('itemSize=3', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      expect(geo.customAttributeSizes.get('instanceStart')).toBe(3);
      expect(geo.customAttributeSizes.get('instanceEnd')).toBe(3);
    });

    it('版本号递增', () => {
      const geo = new LineSegmentsGeometry();
      const v0 = geo.customAttributeVersions.get('instanceStart') ?? 0;
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      const v1 = geo.customAttributeVersions.get('instanceStart') ?? 0;
      expect(v1).toBeGreaterThan(v0);
    });

    it('长度不是 6 的倍数 → 抛错', () => {
      const geo = new LineSegmentsGeometry();
      expect(() => geo.setPositions([0, 0, 0, 1, 0])).toThrow(/multiple of 6/);
    });

    it('Float32Array 输入', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(new Float32Array([0, 0, 0, 1, 0, 0]));
      expect(geo.instanceCount).toBe(1);
    });

    it('空数组 → instanceCount=0', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([]);
      expect(geo.instanceCount).toBe(0);
    });

    it('setPositions 后自动计算 boundingBox/boundingSphere', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 4, 6]);
      expect(geo.boundingBox).not.toBeNull();
      expect(geo.boundingSphere).not.toBeNull();
    });
  });

  describe('setColors', () => {
    it('逐段顶点颜色', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]);
      geo.setColors([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0]);

      const cs = geo.customAttributes.get('instanceColorStart')!;
      const ce = geo.customAttributes.get('instanceColorEnd')!;
      expect(cs.length).toBe(6); // 2 段 × 3
      // 段0: start=(1,0,0) red, end=(0,1,0) green
      expect(cs[0]).toBe(1);
      expect(cs[1]).toBe(0);
      expect(ce[0]).toBe(0);
      expect(ce[1]).toBe(1);
    });

    it('颜色段数与位置段数不匹配 → 抛错', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]); // 1 段
      expect(() => geo.setColors([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0])).toThrow(/does not match/);
    });

    it('颜色长度不是 6 的倍数 → 抛错', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      expect(() => geo.setColors([1, 0, 0, 0, 1])).toThrow(/multiple of 6/);
    });
  });

  describe('fromWireframeGeometry / fromLineSegments', () => {
    it('fromWireframeGeometry 等价于 setPositions', () => {
      const geo = new LineSegmentsGeometry();
      geo.fromWireframeGeometry([0, 0, 0, 1, 0, 0]);
      expect(geo.instanceCount).toBe(1);
    });

    it('fromLineSegments 等价于 setPositions', () => {
      const geo = new LineSegmentsGeometry();
      geo.fromLineSegments([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
      expect(geo.instanceCount).toBe(2);
    });
  });

  describe('applyMatrix4', () => {
    it('平移矩阵变换 instanceStart/End', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);

      const m = new Matrix4();
      m.makeTranslation(10, 20, 30);
      geo.applyMatrix4(m);

      const start = geo.customAttributes.get('instanceStart')!;
      const end = geo.customAttributes.get('instanceEnd')!;
      expect(start[0]).toBe(10);
      expect(start[1]).toBe(20);
      expect(start[2]).toBe(30);
      expect(end[0]).toBe(11);
      expect(end[1]).toBe(20);
      expect(end[2]).toBe(30);
    });

    it('无 instanceStart/End 时不抛错', () => {
      const geo = new LineSegmentsGeometry();
      const m = new Matrix4();
      expect(() => geo.applyMatrix4(m)).not.toThrow();
    });

    it('变换后版本号递增', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      const v0 = geo.customAttributeVersions.get('instanceStart') ?? 0;
      const m = new Matrix4().makeTranslation(1, 0, 0);
      geo.applyMatrix4(m);
      const v1 = geo.customAttributeVersions.get('instanceStart') ?? 0;
      expect(v1).toBeGreaterThan(v0);
    });
  });

  describe('computeBoundingBox', () => {
    it('单段 boundingBox', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([1, 2, 3, 4, 6, 8]);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      expect(bb.min.x).toBe(1);
      expect(bb.min.y).toBe(2);
      expect(bb.min.z).toBe(3);
      expect(bb.max.x).toBe(4);
      expect(bb.max.y).toBe(6);
      expect(bb.max.z).toBe(8);
    });

    it('多段 boundingBox 包含所有端点', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([
        0, 0, 0, 2, 0, 0,
        -1, 5, 0, 3, -2, 4,
      ]);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      expect(bb.min.x).toBe(-1);
      expect(bb.min.y).toBe(-2);
      expect(bb.min.z).toBe(0);
      expect(bb.max.x).toBe(3);
      expect(bb.max.y).toBe(5);
      expect(bb.max.z).toBe(4);
    });

    it('无 instanceStart/End → boundingBox=null', () => {
      const geo = new LineSegmentsGeometry();
      geo.computeBoundingBox();
      expect(geo.boundingBox).toBeNull();
    });
  });

  describe('computeBoundingSphere', () => {
    it('中心 = boundingBox 中心', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 4, 0, 0]);
      geo.computeBoundingSphere();
      const bs = geo.boundingSphere!;
      expect(bs.center.x).toBe(2);
      expect(bs.center.y).toBe(0);
      expect(bs.center.z).toBe(0);
    });

    it('半径 = 最远端点到中心的距离', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 4, 0, 0]);
      geo.computeBoundingSphere();
      const bs = geo.boundingSphere!;
      // 中心 (2,0,0),最远端点 (0,0,0) 或 (4,0,0),距离=2
      expect(bs.radius).toBeCloseTo(2, 5);
    });

    it('3D 线段半径', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 3, 4, 12]);
      geo.computeBoundingSphere();
      const bs = geo.boundingSphere!;
      // 中心 (1.5, 2, 6),端点 (0,0,0) 距离 = √(1.5²+2²+6²) = √(2.25+4+36)=√42.25=6.5
      // 端点 (3,4,12) 距离 = √(1.5²+2²+6²) = 6.5
      expect(bs.radius).toBeCloseTo(6.5, 4);
    });

    it('无 instanceStart/End → boundingSphere=null', () => {
      const geo = new LineSegmentsGeometry();
      geo.computeBoundingSphere();
      expect(geo.boundingSphere).toBeNull();
    });
  });
});

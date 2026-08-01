// Line2 / LineSegments2 单元测试 —— 构造、类型、computeLineDistances、raycast。

import { describe, it, expect } from 'vitest';
import { LineSegments2, Line2 } from './Line2';
import { LineSegmentsGeometry } from '../Geometries/LineSegmentsGeometry';
import { LineGeometry } from '../Geometries/LineGeometry';
import { LineMaterial } from '../Materials/LineMaterial';
import { Vector3 } from '../Math/Vector3';
import { Vector2 } from '../Math/Vector2';
import { Raycaster, type Intersection } from './Raycaster';
import { Object3D } from './Object3D';
import { Group } from './Group';

describe('LineSegments2 / Line2', () => {
  describe('构造与类型', () => {
    it('LineSegments2 默认构造', () => {
      const line = new LineSegments2();
      expect(line).toBeInstanceOf(Object3D);
      expect(line.isLineSegments2).toBe(true);
      expect(line.isLine2).toBe(false);
      expect(line.type).toBe('LineSegments2');
      expect(line.geometry).toBeInstanceOf(LineSegmentsGeometry);
      expect(line.material).toBeInstanceOf(LineMaterial);
    });

    it('Line2 默认构造', () => {
      const line = new Line2();
      expect(line).toBeInstanceOf(LineSegments2);
      expect(line.isLineSegments2).toBe(true);
      expect(line.isLine2).toBe(true);
      expect(line.type).toBe('Line2');
      expect(line.geometry).toBeInstanceOf(LineGeometry);
      expect(line.material).toBeInstanceOf(LineMaterial);
    });

    it('自定义 geometry + material', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      const mat = new LineMaterial({ color: { r: 0, g: 1, b: 0 }, linewidth: 2 });
      const line = new LineSegments2(geo, mat);
      expect(line.geometry).toBe(geo);
      expect(line.material).toBe(mat);
    });

    it('Line2 接受 LineGeometry', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0, 2, 0, 0]);
      const mat = new LineMaterial();
      const line = new Line2(geo, mat);
      expect(line.geometry).toBe(geo);
      expect(line.geometry).toBeInstanceOf(LineGeometry);
    });

    it('支持材质数组', () => {
      const geo = new LineSegmentsGeometry();
      const mats = [new LineMaterial(), new LineMaterial()];
      const line = new LineSegments2(geo, mats);
      expect(Array.isArray(line.material)).toBe(true);
    });
  });

  describe('computeLineDistances — LineSegments2(每段独立)', () => {
    it('两段独立线段:每段起点=0,终点=段长', () => {
      const geo = new LineSegmentsGeometry();
      // 段0: (0,0,0)→(3,0,0) 长度=3
      // 段1: (0,0,0)→(0,4,0) 长度=4
      geo.setPositions([0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 4, 0]);
      const line = new LineSegments2(geo);
      line.computeLineDistances();

      const distStart = geo.customAttributes.get('instanceDistanceStart')!;
      const distEnd = geo.customAttributes.get('instanceDistanceEnd')!;

      expect(distStart.length).toBe(2);
      expect(distEnd.length).toBe(2);
      // 段0: start=0, end=3
      expect(distStart[0]).toBe(0);
      expect(distEnd[0]).toBeCloseTo(3, 5);
      // 段1: start=0, end=4
      expect(distStart[1]).toBe(0);
      expect(distEnd[1]).toBeCloseTo(4, 5);
    });

    it('空几何体 → 无操作(不抛错)', () => {
      const geo = new LineSegmentsGeometry();
      const line = new LineSegments2(geo);
      expect(() => line.computeLineDistances()).not.toThrow();
      expect(geo.customAttributes.get('instanceDistanceStart')).toBeUndefined();
    });

    it('设置 itemSize=1', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      const line = new LineSegments2(geo);
      line.computeLineDistances();
      expect(geo.customAttributeSizes.get('instanceDistanceStart')).toBe(1);
      expect(geo.customAttributeSizes.get('instanceDistanceEnd')).toBe(1);
    });
  });

  describe('computeLineDistances — Line2(累计)', () => {
    it('三段折线:累计线长', () => {
      const geo = new LineGeometry();
      // 顶点链: (0,0,0) → (3,0,0) → (3,4,0) → (3,4,12)
      // 段0: 长3,段1: 长4,段2: 长12
      geo.setPositions([0, 0, 0, 3, 0, 0, 3, 4, 0, 3, 4, 12]);
      const line = new Line2(geo);
      line.computeLineDistances();

      const distStart = geo.customAttributes.get('instanceDistanceStart')!;
      const distEnd = geo.customAttributes.get('instanceDistanceEnd')!;

      expect(distStart.length).toBe(3);
      expect(distEnd.length).toBe(3);
      // 段0: start=0, end=3
      expect(distStart[0]).toBe(0);
      expect(distEnd[0]).toBeCloseTo(3, 5);
      // 段1: start=3, end=7
      expect(distStart[1]).toBeCloseTo(3, 5);
      expect(distEnd[1]).toBeCloseTo(7, 5);
      // 段2: start=7, end=19
      expect(distStart[2]).toBeCloseTo(7, 5);
      expect(distEnd[2]).toBeCloseTo(19, 5);
    });

    it('单段折线退化为独立段', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 5, 0, 0]);
      const line = new Line2(geo);
      line.computeLineDistances();

      const distStart = geo.customAttributes.get('instanceDistanceStart')!;
      const distEnd = geo.customAttributes.get('instanceDistanceEnd')!;

      expect(distStart[0]).toBe(0);
      expect(distEnd[0]).toBeCloseTo(5, 5);
    });

    it('空几何体 → 无操作', () => {
      const geo = new LineGeometry();
      const line = new Line2(geo);
      expect(() => line.computeLineDistances()).not.toThrow();
    });
  });

  describe('raycast — LineSegments2', () => {
    it('射线穿过线段中点 → 命中', () => {
      // 线段 (0,0,0)→(2,0,0),射线从 (1, 0, 5) 沿 -Z
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 0, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 1 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(0);
      expect(hits[0].distance).toBeCloseTo(5, 4);
      expect(hits[0].object).toBe(line);
    });

    it('射线偏离线段超过阈值 → 不命中', () => {
      // 线段 (0,0,0)→(2,0,0),射线从 (1, 5, 5) 沿 -Z → 距离 5 > threshold 1
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 5, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 1 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('多段独立线段:命中正确的段索引', () => {
      // 段0: (0,0,0)→(2,0,0)
      // 段1: (0,2,0)→(2,2,0)
      // 射线从 (1, 2, 5) 沿 -Z → 命中段1
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0]);
      const line = new LineSegments2(geo);
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 2, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 0.5 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(1);
    });

    it('near/far 过滤:超出 far → 不命中', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 0, 5), new Vector3(0, 0, -1), 0, 3);
      ray.params.Line2 = { threshold: 1 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('包围球剔除:射线远离线段 → 快速不命中', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.updateMatrixWorld(true);

      // 射线从 (100, 100, 100) 沿 +X,远离线段
      const ray = new Raycaster(new Vector3(100, 100, 100), new Vector3(1, 0, 0), 0, 1000);
      ray.params.Line2 = { threshold: 1 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('未设置 params.Line2 → 回退到 params.Line.threshold', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 0, 5), new Vector3(0, 0, -1), 0, 100);
      // 删除 Line2 配置,回退到 Line.threshold=1
      delete ray.params.Line2;
      ray.params.Line.threshold = 1;
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
    });

    it('物体平移后射线命中', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.position.set(10, 0, 0); // 线段平移到 (10,0,0)→(12,0,0)
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(11, 0, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 1 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].point.x).toBeCloseTo(11, 4);
    });

    it('命中点在线段上(世界坐标)', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.updateMatrixWorld(true);

      // 射线从 (1, 0.3, 5) 沿 -Z,最近点应在线段 (1, 0, 0) 附近
      const ray = new Raycaster(new Vector3(1, 0.3, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 1 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].point.x).toBeCloseTo(1, 2);
      expect(hits[0].point.y).toBeCloseTo(0, 1);
      expect(hits[0].point.z).toBeCloseTo(0, 1);
    });
  });

  describe('raycast — Line2(折线)', () => {
    it('折线多段命中', () => {
      // 折线: (0,0,0)→(2,0,0)→(2,2,0)
      // 段0: (0,0,0)→(2,0,0)
      // 段1: (2,0,0)→(2,2,0)
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0, 2, 2, 0]);
      const line = new Line2(geo);
      line.updateMatrixWorld(true);

      // 射线从 (2, 1, 5) 沿 -Z → 命中段1
      const ray = new Raycaster(new Vector3(2, 1, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 0.5 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(1);
    });

    it('折线顶点处两段同时命中(阈值足够大)', () => {
      // 折线: (0,0,0)→(2,0,0)→(4,0,0)
      // 射线从 (2, 0, 5) 沿 -Z → 命中段0的终点和段1的起点
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0, 4, 0, 0]);
      const line = new Line2(geo);
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(2, 0, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 0.5 };
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(2); // 两段都命中
      expect(hits[0].index).toBe(0);
      expect(hits[1].index).toBe(1);
    });
  });

  describe('Raycaster.params.Line2 默认值', () => {
    it('Raycaster 构造时包含 Line2 默认 threshold=1', () => {
      const ray = new Raycaster();
      expect(ray.params.Line2).toBeDefined();
      expect(ray.params.Line2!.threshold).toBe(1);
    });

    it('可通过 intersectObjects 拾取 Line2', () => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new Line2(geo);
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 0, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 1 };
      const hits = ray.intersectObject(line, false);
      expect(hits.length).toBe(1);
      expect(hits[0].object).toBe(line);
    });

    it('recursive 拾取子节点中的 LineSegments2', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 2, 0, 0]);
      const line = new LineSegments2(geo);
      line.position.set(0, 5, 0);
      line.updateMatrixWorld(true);

      const group = new Group();
      group.add(line);
      group.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 5, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line2 = { threshold: 1 };
      const hits = ray.intersectObject(group, true);
      expect(hits.length).toBe(1);
      expect(hits[0].object).toBe(line);
    });
  });

  describe('LineMaterial 集成', () => {
    it('material 属性正确传递', () => {
      const mat = new LineMaterial({
        color: { r: 0.2, g: 0.8, b: 1 },
        linewidth: 5,
        resolution: new Vector2(1920, 1080),
        dashed: true,
        dashSize: 2,
        gapSize: 1,
      });
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 1, 0, 0]);
      const line = new LineSegments2(geo, mat);

      expect((line.material as LineMaterial).linewidth).toBe(5);
      expect((line.material as LineMaterial).dashed).toBe(true);
      expect((line.material as LineMaterial).dashSize).toBe(2);
    });

    it('computeLineDistances 后自定义属性版本递增', () => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 3, 0, 0]);
      const line = new LineSegments2(geo);

      const v0 = geo.customAttributeVersions.get('instanceDistanceStart') ?? 0;
      line.computeLineDistances();
      const v1 = geo.customAttributeVersions.get('instanceDistanceStart') ?? 0;
      expect(v1).toBeGreaterThan(v0);
    });
  });
});

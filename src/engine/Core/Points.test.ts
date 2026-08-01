// Points 单元测试 —— 点云物体 + raycast 行为验证。

import { describe, it, expect } from 'vitest';
import { Points } from './Points';
import { PointsMaterial } from '../Materials/PointsMaterial';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { Vector3 } from '../Math/Vector3';
import { Raycaster, type Intersection } from './Raycaster';
import { Object3D } from './Object3D';

function makePoints(positions: number[]): Points {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return new Points(geo, new PointsMaterial({ size: 0.5 }));
}

describe('Points', () => {
  describe('构造与类型', () => {
    it('默认构造:空 geometry + 默认 PointsMaterial', () => {
      const p = new Points();
      expect(p).toBeInstanceOf(Object3D);
      expect(p.isPoints).toBe(true);
      expect(p.type).toBe('Points');
      expect(p.geometry).toBeInstanceOf(BufferGeometry);
      expect(p.material).toBeInstanceOf(PointsMaterial);
    });

    it('自定义 geometry + material', () => {
      const geo = new BufferGeometry();
      const mat = new PointsMaterial({ size: 2 });
      const p = new Points(geo, mat);
      expect(p.geometry).toBe(geo);
      expect(p.material).toBe(mat);
    });

    it('支持材质数组', () => {
      const geo = new BufferGeometry();
      const mats = [new PointsMaterial(), new PointsMaterial()];
      const p = new Points(geo, mats);
      expect(Array.isArray(p.material)).toBe(true);
      expect((p.material as PointsMaterial[]).length).toBe(2);
    });

    it('castShadow / receiveShadow 默认 false(不投射阴影)', () => {
      const p = new Points();
      expect(p.castShadow).toBe(false);
      expect(p.receiveShadow).toBe(false);
    });
  });

  describe('raycast — 基本命中', () => {
    it('射线穿过单个点 → 命中', () => {
      // 点在原点,射线从 (0,0,5) 沿 -Z 方向射向原点
      const points = makePoints([0, 0, 0]);
      points.updateMatrixWorld(true);

      const ray = new Raycaster(
        new Vector3(0, 0, 5),
        new Vector3(0, 0, -1),
        0,
        100,
      );
      // 默认 threshold=1,点 scale=1 → localThreshold=1,射线正好穿过点
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(1);
      const h = hits[0];
      expect(h.index).toBe(0);
      expect(h.distance).toBeCloseTo(5, 5); // 从 (0,0,5) 到 (0,0,0) = 5
      expect(h.distanceToRay).toBeCloseTo(0, 5); // 射线穿过点 → 距离 0
      expect(h.object).toBe(points);
    });

    it('射线偏离点超过 threshold → 不命中', () => {
      const points = makePoints([0, 0, 0]);
      points.updateMatrixWorld(true);

      // 射线从 (5, 0, 5) 沿 -Z,与点的距离 = 5 > threshold 1
      const ray = new Raycaster(
        new Vector3(5, 0, 5),
        new Vector3(0, 0, -1),
        0,
        100,
      );
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('调大 threshold → 偏离点也能命中', () => {
      const points = makePoints([0, 0, 0]);
      points.updateMatrixWorld(true);

      const ray = new Raycaster(
        new Vector3(0.5, 0, 5),
        new Vector3(0, 0, -1),
        0,
        100,
      );
      ray.params.Points.threshold = 1.0; // localThreshold=1,距离 0.5 < 1 → 命中
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].distanceToRay).toBeCloseTo(0.5, 5);
    });
  });

  describe('raycast — 多点云', () => {
    it('射线穿过多个点 → 命中所有在阈值内的点', () => {
      // 三个点沿 X 轴排列:(0,0,0) (1,0,0) (2,0,0)
      const points = makePoints([0, 0, 0, 1, 0, 0, 2, 0, 0]);
      points.updateMatrixWorld(true);

      // 射线从 (1, 0.3, 5) 沿 -Z,到各点的世界距离:
      //   (0,0,0) → sqrt(1² + 0.3²) ≈ 1.04
      //   (1,0,0) → 0.3
      //   (2,0,0) → sqrt(1² + 0.3²) ≈ 1.04
      // threshold=1.5 → 三个点都 < 1.5,全部命中
      const ray = new Raycaster(
        new Vector3(1, 0.3, 5),
        new Vector3(0, 0, -1),
        0,
        100,
      );
      ray.params.Points.threshold = 1.5;
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(3);
      const indices = hits.map((h) => h.index!).sort((a, b) => a - b);
      expect(indices).toEqual([0, 1, 2]);
    });

    it('index 对应原始顶点顺序', () => {
      const points = makePoints([10, 0, 0, 0, 0, 0, -10, 0, 0]);
      points.updateMatrixWorld(true);

      // 射线穿过中间点 (0,0,0)
      const ray = new Raycaster(
        new Vector3(0, 0, 5),
        new Vector3(0, 0, -1),
        0,
        100,
      );
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(1); // 第二个点
    });
  });

  describe('raycast — near/far 过滤', () => {
    it('点在 near 之前 → 不命中', () => {
      const points = makePoints([0, 0, 0]);
      points.updateMatrixWorld(true);
      const ray = new Raycaster(
        new Vector3(0, 0, 5),
        new Vector3(0, 0, -1),
        10, // near=10,但点到 origin 距离=5 < 10
        100,
      );
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('点在 far 之外 → 不命中', () => {
      const points = makePoints([0, 0, 0]);
      points.updateMatrixWorld(true);
      const ray = new Raycaster(
        new Vector3(0, 0, 5),
        new Vector3(0, 0, -1),
        0,
        3, // far=3,但点到 origin 距离=5 > 3
      );
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });
  });

  describe('raycast — 缩放影响 threshold', () => {
    it('放大 2 倍 → localThreshold 减半,原本命中的点可能不再命中', () => {
      const points = makePoints([0, 0, 0]);
      points.scale.set(2, 2, 2); // meanScale=2 → localThreshold = 1/2 = 0.5
      points.updateMatrixWorld(true);

      // 射线从 (0.4, 0, 5) 沿 -Z,到点(本地 0,0,0)距离 0.4
      // world threshold=1,但 localThreshold=0.5 → 0.4 < 0.5 命中
      const ray = new Raycaster(
        new Vector3(0.4, 0, 5),
        new Vector3(0, 0, -1),
        0,
        100,
      );
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(1);
    });

    it('放大 2 倍,世界偏离 1.2 → 本地 0.6 > localThreshold 0.5 → 不命中', () => {
      const points = makePoints([0, 0, 0]);
      points.scale.set(2, 2, 2); // meanScale=2 → localThreshold=0.5
      points.updateMatrixWorld(true);

      // 世界 x=1.2 → 本地 x=0.6(除以 scale 2),> localThreshold 0.5 → 不命中
      const ray = new Raycaster(
        new Vector3(1.2, 0, 5),
        new Vector3(0, 0, -1),
        0,
        100,
      );
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });
  });

  describe('raycast — 边界情况', () => {
    it('geometry 无 position 属性 → 不命中(不抛错)', () => {
      const points = new Points(new BufferGeometry(), new PointsMaterial());
      points.updateMatrixWorld(true);
      const ray = new Raycaster(
        new Vector3(0, 0, 5),
        new Vector3(0, 0, -1),
      );
      const hits: Intersection[] = [];
      expect(() => points.raycast(ray, hits)).not.toThrow();
      expect(hits.length).toBe(0);
    });

    it('空点云(0 顶点) → 不命中', () => {
      const points = makePoints([]);
      points.updateMatrixWorld(true);
      const ray = new Raycaster(
        new Vector3(0, 0, 5),
        new Vector3(0, 0, -1),
      );
      const hits: Intersection[] = [];
      points.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('updateMatrixWorld 后 boundingSphere 已计算', () => {
      const points = makePoints([1, 0, 0, -1, 0, 0]);
      points.updateMatrixWorld(true);
      expect(points.geometry.boundingSphere).not.toBeNull();
      expect(points.geometry.boundingSphere!.radius).toBeGreaterThan(0);
    });
  });

  describe('场景图集成', () => {
    it('可加入父节点', () => {
      const parent = new Object3D();
      const points = makePoints([0, 0, 0]);
      parent.add(points);
      expect(points.parent).toBe(parent);
      expect(parent.children).toContain(points);
    });

    it('traverse 可遍历到 Points', () => {
      const root = new Object3D();
      const points = makePoints([0, 0, 0]);
      root.add(points);
      const visited: Object3D[] = [];
      root.traverse((o) => visited.push(o));
      expect(visited).toContain(points);
    });
  });
});

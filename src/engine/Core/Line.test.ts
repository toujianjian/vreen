// Line / LineSegments / LineLoop 单元测试 —— 构造、类型、raycast、computeLineDistances。

import { describe, it, expect, vi } from 'vitest';
import { Line, LineSegments, LineLoop } from './Line';
import { LineBasicMaterial } from '../Materials/LineBasicMaterial';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { Vector3 } from '../Math/Vector3';
import { Raycaster, type Intersection } from './Raycaster';
import { Object3D } from './Object3D';

function makeGeometry(positions: number[], indexed = false): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  if (indexed) {
    const idx: number[] = [];
    for (let i = 0; i < positions.length / 3; i++) idx.push(i);
    geo.setIndex(idx);
  }
  return geo;
}

describe('Line / LineSegments / LineLoop', () => {
  describe('构造与类型', () => {
    it('Line 默认构造', () => {
      const line = new Line();
      expect(line).toBeInstanceOf(Object3D);
      expect(line.isLine).toBe(true);
      expect(line.isLineSegments).toBe(false);
      expect(line.isLineLoop).toBe(false);
      expect(line.type).toBe('Line');
      expect(line.material).toBeInstanceOf(LineBasicMaterial);
    });

    it('LineSegments 类型标志正确', () => {
      const ls = new LineSegments();
      expect(ls.isLine).toBe(true);
      expect(ls.isLineSegments).toBe(true);
      expect(ls.isLineLoop).toBe(false);
      expect(ls.type).toBe('LineSegments');
    });

    it('LineLoop 类型标志正确', () => {
      const ll = new LineLoop();
      expect(ll.isLine).toBe(true);
      expect(ll.isLineSegments).toBe(false);
      expect(ll.isLineLoop).toBe(true);
      expect(ll.type).toBe('LineLoop');
    });

    it('自定义 geometry + material', () => {
      const geo = makeGeometry([0, 0, 0, 1, 0, 0]);
      const mat = new LineBasicMaterial({ color: { r: 1, g: 0, b: 0 } });
      const line = new Line(geo, mat);
      expect(line.geometry).toBe(geo);
      expect(line.material).toBe(mat);
    });

    it('支持材质数组', () => {
      const geo = makeGeometry([0, 0, 0, 1, 0, 0]);
      const mats = [new LineBasicMaterial(), new LineBasicMaterial()];
      const line = new Line(geo, mats);
      expect(Array.isArray(line.material)).toBe(true);
    });
  });

  describe('raycast — Line (LINE_STRIP)', () => {
    it('射线穿过单条线段 → 命中', () => {
      // 线段从 (0,0,0) 到 (2,0,0),射线从 (1, 0.5, 5) 沿 -Z
      // 到线段中点 (1,0,0) 的距离 = 0.5
      const line = new Line(makeGeometry([0, 0, 0, 2, 0, 0]));
      line.updateMatrixWorld(true);

      const ray = new Raycaster(new Vector3(1, 0.5, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line.threshold = 1; // localThreshold=1,距离 0.5 < 1 → 命中
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(0); // 边起点
      expect(hits[0].distance).toBeCloseTo(5, 4);
    });

    it('射线偏离线段超过 threshold → 不命中', () => {
      const line = new Line(makeGeometry([0, 0, 0, 2, 0, 0]));
      line.updateMatrixWorld(true);

      // 射线从 (1, 5, 5) 沿 -Z,到线段距离 = 5 > threshold 1
      const ray = new Raycaster(new Vector3(1, 5, 5), new Vector3(0, 0, -1), 0, 100);
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('折线 step=1:两条相邻边各命中一次', () => {
      // 折线 (0,0,0)-(2,0,0)-(4,0,0):两条边 0-1 和 1-2
      const line = new Line(makeGeometry([0, 0, 0, 2, 0, 0, 4, 0, 0]));
      line.updateMatrixWorld(true);

      // 射线从 (1, 0.2, 5) 沿 -Z:到边 0-1(中点 1,0,0)距离 0.2;到边 1-2(中点 3,0,0)距离 sqrt(4+0.04)≈2.01
      const ray1 = new Raycaster(new Vector3(1, 0.2, 5), new Vector3(0, 0, -1), 0, 100);
      ray1.params.Line.threshold = 0.5;
      const hits1: Intersection[] = [];
      line.raycast(ray1, hits1);
      expect(hits1.length).toBe(1);
      expect(hits1[0].index).toBe(0);

      // 射线从 (3, 0.2, 5):到边 1-2 距离 0.2,到边 0-1 距离 ≈2.01
      const ray2 = new Raycaster(new Vector3(3, 0.2, 5), new Vector3(0, 0, -1), 0, 100);
      ray2.params.Line.threshold = 0.5;
      const hits2: Intersection[] = [];
      line.raycast(ray2, hits2);
      expect(hits2.length).toBe(1);
      expect(hits2[0].index).toBe(1);
    });
  });

  describe('raycast — LineSegments (step=2)', () => {
    it('两两成段:0-1 和 2-3 是独立段,1-2 不是边', () => {
      // 顶点:(0,0,0)(2,0,0)(2,0,0)(4,0,0) → 段 0-1 和 段 2-3
      const ls = new LineSegments(
        makeGeometry([0, 0, 0, 2, 0, 0, 2, 0, 0, 4, 0, 0]),
      );
      ls.updateMatrixWorld(true);

      // 射线从 (3, 0.2, 5):段 2-3 中点 (3,0,0) 距离 0.2 < threshold 0.5 → 命中 index=2
      const ray = new Raycaster(new Vector3(3, 0.2, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line.threshold = 0.5;
      const hits: Intersection[] = [];
      ls.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(2);
    });

    it('step=2 时中间顶点(1)不作为边起点参与', () => {
      // 4 顶点 → 段 0-1、2-3;不会检测 1-2
      const ls = new LineSegments(makeGeometry([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]));
      ls.updateMatrixWorld(true);

      // 射线穿过 (1.5, 0, 0) — 这是 step=1 时的边 1-2 中点,但 LineSegments 不检测
      const ray = new Raycaster(new Vector3(1.5, 0.1, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line.threshold = 0.3; // 0.1 < 0.3,若检测 1-2 会命中
      const hits: Intersection[] = [];
      ls.raycast(ray, hits);
      // 段 0-1 中点 (0.5,0,0):距离 sqrt(1+0.01)≈1.005 > 0.3
      // 段 2-3 中点 (2.5,0,0):距离 sqrt(1+0.01)≈1.005 > 0.3
      // 边 1-2 不检测 → 0 命中
      expect(hits.length).toBe(0);
    });
  });

  describe('raycast — LineLoop (闭合)', () => {
    it('额外检测末→首闭合边', () => {
      // 三角形顶点 (0,0,0)(2,0,0)(1,2,0),LineLoop 有 3 条边:0-1,1-2,2-0
      const ll = new LineLoop(makeGeometry([0, 0, 0, 2, 0, 0, 1, 2, 0]));
      ll.updateMatrixWorld(true);

      // 闭合边 2-0 的中点 (0.5, 1, 0);射线从 (0.5, 1, 5) 沿 -Z 命中该边
      const ray = new Raycaster(new Vector3(0.5, 1, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line.threshold = 0.3;
      const hits: Intersection[] = [];
      ll.raycast(ray, hits);
      // 应命中闭合边(index=2,即末顶点)
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(2);
    });
  });

  describe('raycast — 索引几何体', () => {
    it('indexed Line 也能命中', () => {
      const line = new Line(makeGeometry([0, 0, 0, 2, 0, 0], true));
      line.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(1, 0.3, 5), new Vector3(0, 0, -1), 0, 100);
      ray.params.Line.threshold = 0.5;
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(1);
      expect(hits[0].index).toBe(0);
    });
  });

  describe('raycast — near/far 与边界', () => {
    it('near 过远 → 不命中', () => {
      const line = new Line(makeGeometry([0, 0, 0, 2, 0, 0]));
      line.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(1, 0.3, 5), new Vector3(0, 0, -1), 10, 100);
      ray.params.Line.threshold = 0.5;
      const hits: Intersection[] = [];
      line.raycast(ray, hits);
      expect(hits.length).toBe(0);
    });

    it('geometry 无 position → 不命中(不抛错)', () => {
      const line = new Line(new BufferGeometry());
      line.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const hits: Intersection[] = [];
      expect(() => line.raycast(ray, hits)).not.toThrow();
      expect(hits.length).toBe(0);
    });
  });

  describe('computeLineDistances', () => {
    it('Line 累计线长:0, 2, 5', () => {
      // (0,0,0)-(2,0,0)-(5,0,0):累计 0, 2, 5
      const line = new Line(makeGeometry([0, 0, 0, 2, 0, 0, 5, 0, 0]));
      line.computeLineDistances();
      const ld = line.geometry.attributes.lineDistance;
      expect(ld).toBeDefined();
      expect(ld.array[0]).toBeCloseTo(0, 5);
      expect(ld.array[1]).toBeCloseTo(2, 5);
      expect(ld.array[2]).toBeCloseTo(5, 5);
    });

    it('LineSegments 每段独立:0,2,0,3', () => {
      // 段 0-1 长度 2,段 2-3 长度 3
      const ls = new LineSegments(makeGeometry([0, 0, 0, 2, 0, 0, 5, 0, 0, 8, 0, 0]));
      ls.computeLineDistances();
      const ld = ls.geometry.attributes.lineDistance;
      expect(ld.array[0]).toBeCloseTo(0, 5);
      expect(ld.array[1]).toBeCloseTo(2, 5);
      expect(ld.array[2]).toBeCloseTo(0, 5);
      expect(ld.array[3]).toBeCloseTo(3, 5);
    });

    it('索引几何体跳过并打印 warning(不抛错)', () => {
      const line = new Line(makeGeometry([0, 0, 0, 1, 0, 0], true));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(() => line.computeLineDistances()).not.toThrow();
      expect(warn).toHaveBeenCalled();
      expect(line.geometry.attributes.lineDistance).toBeUndefined();
      warn.mockRestore();
    });
  });

  describe('场景图集成', () => {
    it('可加入父节点并遍历', () => {
      const root = new Object3D();
      const line = new Line(makeGeometry([0, 0, 0, 1, 0, 0]));
      root.add(line);
      const visited: Object3D[] = [];
      root.traverse((o) => visited.push(o));
      expect(visited).toContain(line);
    });
  });
});

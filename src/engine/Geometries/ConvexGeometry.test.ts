// ConvexGeometry 单元测试 —— 验证凸包构造、三角形数与属性类型。
//
// 非索引几何体:每个三角面 3 个独立顶点(平面着色)。

import { describe, it, expect } from 'vitest';
import { ConvexGeometry } from './ConvexGeometry';
import { Vector3 } from '../Math/Vector3';

describe('ConvexGeometry', () => {
  it('4 个不共面点(四面体)→ 4 个三角面 / 12 顶点', () => {
    const points = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ];
    const g = new ConvexGeometry(points);

    expect(g.attributes.position).toBeDefined();
    expect(g.attributes.normal).toBeDefined();
    // 4 面 × 3 顶点 = 12 顶点(非索引)
    expect(g.attributes.position.count).toBe(12);
    // 4 个三角形
    expect(g.attributes.position.count / 3).toBe(4);
  });

  it('8 个立方体角点 → 12 个三角形(36 顶点),覆盖 8 个唯一顶点', () => {
    const corners: Vector3[] = [];
    for (let x = -1; x <= 1; x += 2) {
      for (let y = -1; y <= 1; y += 2) {
        for (let z = -1; z <= 1; z += 2) {
          corners.push(new Vector3(x, y, z));
        }
      }
    }
    expect(corners.length).toBe(8);

    const g = new ConvexGeometry(corners);
    // 12 个三角形
    expect(g.attributes.position.count / 3).toBe(12);
    expect(g.attributes.position.count).toBe(36);

    // 验证 8 个唯一角点位置都被覆盖。
    const pos = g.attributes.position.array;
    const unique = new Set<string>();
    for (let i = 0; i < pos.length; i += 3) {
      unique.add(`${pos[i]},${pos[i + 1]},${pos[i + 2]}`);
    }
    expect(unique.size).toBe(8);
  });

  it('3 个共线点 → 不崩溃,返回空几何体', () => {
    const points = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(2, 0, 0),
    ];
    expect(() => new ConvexGeometry(points)).not.toThrow();
    const g = new ConvexGeometry(points);
    expect(g.attributes.position).toBeDefined();
    expect(g.attributes.position.count).toBe(0);
  });

  it('position 属性为 Float32Array', () => {
    const points = [
      new Vector3(0, 0, 0),
      new Vector3(2, 0, 0),
      new Vector3(0, 2, 0),
      new Vector3(0, 0, 2),
    ];
    const g = new ConvexGeometry(points);
    expect(g.attributes.position.array).toBeInstanceOf(Float32Array);
    expect(g.attributes.normal.array).toBeInstanceOf(Float32Array);
  });

  it('法线为单位长度', () => {
    const g = new ConvexGeometry([
      new Vector3(-1, -1, -1),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
    ]);
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});

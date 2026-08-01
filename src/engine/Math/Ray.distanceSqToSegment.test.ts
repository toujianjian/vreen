// Ray.distanceSqToSegment 单元测试 —— 几何正确性 + 与已知情形对照。

import { describe, it, expect } from 'vitest';
import { Ray } from './Ray';
import { Vector3 } from './Vector3';

describe('Ray.distanceSqToSegment', () => {
  it('射线穿过线段中点 → 距离 0', () => {
    // 射线 origin (1,0,5) dir (0,0,-1);线段 (0,0,0)-(2,0,0)
    const ray = new Ray(new Vector3(1, 0, 5), new Vector3(0, 0, -1));
    const d2 = ray.distanceSqToSegment(new Vector3(0, 0, 0), new Vector3(2, 0, 0));
    expect(d2).toBeCloseTo(0, 5);
  });

  it('射线平行偏移 0.5 → 距离平方 0.25', () => {
    // 射线 origin (1, 0.5, 5) dir (0,0,-1);线段 (0,0,0)-(2,0,0)
    // 射线在 z 上方无限延伸,最近距离 = 0.5
    const ray = new Ray(new Vector3(1, 0.5, 5), new Vector3(0, 0, -1));
    const d2 = ray.distanceSqToSegment(new Vector3(0, 0, 0), new Vector3(2, 0, 0));
    expect(d2).toBeCloseTo(0.25, 5);
  });

  it('optionalPointOnRay 落在射线上', () => {
    const ray = new Ray(new Vector3(1, 0.5, 5), new Vector3(0, 0, -1));
    const onRay = new Vector3();
    const onSeg = new Vector3();
    ray.distanceSqToSegment(new Vector3(0, 0, 0), new Vector3(2, 0, 0), onRay, onSeg);
    // onRay = origin + dir·s0,dir 是 (0,0,-1),故 onRay.x=1, onRay.y=0.5
    expect(onRay.x).toBeCloseTo(1, 5);
    expect(onRay.y).toBeCloseTo(0.5, 5);
    // onSeg 在线段上:y=0,z=0
    expect(onSeg.y).toBeCloseTo(0, 5);
    expect(onSeg.z).toBeCloseTo(0, 5);
  });

  it('射线在线段侧方且不平行 → 最近点在线段端点(region 边界)', () => {
    // 射线 origin (10, 0, 5) dir (0,0,-1);线段 (0,0,0)-(2,0,0)
    // 射线投影到线段所在 xy 平面为 (10,0),在线段外(>2)
    // 最近点应为线段端点 (2,0,0);距离 = |(10,0,5)-(2,0,0)|... 但射线方向 -Z
    // 射线上最近点 = (10,0,0)(s0=5),线段上最近点 = (2,0,0)
    // 距离² = (10-2)² + 0 + 0 = 64
    const ray = new Ray(new Vector3(10, 0, 5), new Vector3(0, 0, -1));
    const d2 = ray.distanceSqToSegment(new Vector3(0, 0, 0), new Vector3(2, 0, 0));
    expect(d2).toBeCloseTo(64, 4);
  });

  it('退化线段(两端点重合)→ 等价于到点的距离', () => {
    // 线段退化为点 (1,0,0);射线 origin (1, 0.3, 5) dir (0,0,-1)
    // 到点的最近距离 = 0.3(射线穿过 (1,0,0) 上方 0.3)
    const ray = new Ray(new Vector3(1, 0.3, 5), new Vector3(0, 0, -1));
    const d2 = ray.distanceSqToSegment(new Vector3(1, 0, 0), new Vector3(1, 0, 0));
    expect(d2).toBeCloseTo(0.09, 5);
  });

  it('射线与线段平行 → 距离为垂直偏移', () => {
    // 射线 origin (0, 1, 0) dir (1,0,0);线段 (0,0,0)-(2,0,0),方向也是 (1,0,0)
    // 平行,垂直距离 = 1
    const ray = new Ray(new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    const d2 = ray.distanceSqToSegment(new Vector3(0, 0, 0), new Vector3(2, 0, 0));
    expect(d2).toBeCloseTo(1, 5);
  });

  it('射线背向线段(s0<0 region 3)→ 取射线起点', () => {
    // 射线 origin (5, 0, 0) dir (1,0,0)(向 +X 远离线段);
    // 线段 (0,0,0)-(2,0,0)。射线起点在 x=5,线段在 x∈[0,2]。
    // 射线方向 +X 远离线段 → s0 钳为 0,最近点 = origin (5,0,0)
    // 线段最近点 = (2,0,0),距离² = 9
    const ray = new Ray(new Vector3(5, 0, 0), new Vector3(1, 0, 0));
    const d2 = ray.distanceSqToSegment(new Vector3(0, 0, 0), new Vector3(2, 0, 0));
    expect(d2).toBeCloseTo(9, 4);
  });

  it('对称性:交换 v0/v1 结果不变', () => {
    const ray = new Ray(new Vector3(1, 0.5, 5), new Vector3(0, 0, -1));
    const a = ray.distanceSqToSegment(new Vector3(0, 0, 0), new Vector3(2, 0, 0));
    const b = ray.distanceSqToSegment(new Vector3(2, 0, 0), new Vector3(0, 0, 0));
    expect(a).toBeCloseTo(b, 5);
  });
});

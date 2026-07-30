import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Ray } from '../Math/Ray';
import {
  BoxShape,
  SphereShape,
  CapsuleShape,
  CylinderShape,
  DiskShape,
  QuadShape,
  TubeShape,
  CompoundShape,
} from './index';

describe('BoxShape', () => {
  const box = new BoxShape(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));

  it('getAabb 匹配 min/max', () => {
    const aabb = box.getAabb();
    expect(aabb.min.equals(new Vector3(-1, -1, -1))).toBe(true);
    expect(aabb.max.equals(new Vector3(1, 1, 1))).toBe(true);
  });

  it('containsPoint 内部 true / 外部 false', () => {
    expect(box.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    expect(box.containsPoint(new Vector3(0.9, 0.9, 0.9))).toBe(true);
    expect(box.containsPoint(new Vector3(2, 0, 0))).toBe(false);
    expect(box.containsPoint(new Vector3(0, -2, 0))).toBe(false);
  });

  it('intersectRay 命中预期 t', () => {
    const ray = new Ray(new Vector3(-5, 0, 0), new Vector3(1, 0, 0));
    expect(box.intersectRay(ray)).toBeCloseTo(4);
  });

  it('intersectRay 未命中返回 null', () => {
    const ray = new Ray(new Vector3(-5, 5, 0), new Vector3(1, 0, 0));
    expect(box.intersectRay(ray)).toBeNull();
  });

  it('distanceToPoint 内部 0 / 外部正确', () => {
    expect(box.distanceToPoint(new Vector3(0, 0, 0))).toBe(0);
    expect(box.distanceToPoint(new Vector3(2, 0, 0))).toBeCloseTo(1);
  });

  it('clone 返回独立副本', () => {
    const c = box.clone();
    expect(c).not.toBe(box);
    expect(c.min.equals(box.min)).toBe(true);
    c.min.x = 99;
    expect(box.min.x).toBe(-1);
  });
});

describe('SphereShape', () => {
  const sph = new SphereShape(new Vector3(0, 0, 0), 1);

  it('getAabb 匹配', () => {
    const aabb = sph.getAabb();
    expect(aabb.min.equals(new Vector3(-1, -1, -1))).toBe(true);
    expect(aabb.max.equals(new Vector3(1, 1, 1))).toBe(true);
  });

  it('containsPoint 内部 true / 外部 false', () => {
    expect(sph.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    expect(sph.containsPoint(new Vector3(0, 1, 0))).toBe(true);
    expect(sph.containsPoint(new Vector3(0, 0, 2))).toBe(false);
  });

  it('intersectRay 命中预期 t', () => {
    const ray = new Ray(new Vector3(-5, 0, 0), new Vector3(1, 0, 0));
    expect(sph.intersectRay(ray)).toBeCloseTo(4);
  });

  it('distanceToPoint 内部 0 / 外部正确', () => {
    expect(sph.distanceToPoint(new Vector3(0, 0, 0))).toBe(0);
    expect(sph.distanceToPoint(new Vector3(2, 0, 0))).toBeCloseTo(1);
  });

  it('clone 返回独立副本', () => {
    const c = sph.clone();
    expect(c).not.toBe(sph);
    c.radius = 99;
    expect(sph.radius).toBe(1);
  });
});

describe('CapsuleShape', () => {
  const cap = new CapsuleShape(new Vector3(0, 0, 0), 0.5, 1.0);

  it('containsPoint 中心 true', () => {
    expect(cap.containsPoint(new Vector3(0, 0, 0))).toBe(true);
  });

  it('containsPoint 顶半球区域 true', () => {
    expect(cap.containsPoint(new Vector3(0, 1.0, 0))).toBe(true); // 圆柱顶端面内
    expect(cap.containsPoint(new Vector3(0, 1.4, 0))).toBe(true); // 顶半球内 (1.0+0.5-eps)
    expect(cap.containsPoint(new Vector3(0, 1.6, 0))).toBe(false); // 顶半球外
  });

  it('containsPoint 远处 false', () => {
    expect(cap.containsPoint(new Vector3(5, 5, 5))).toBe(false);
  });

  it('distanceToPoint 正确', () => {
    expect(cap.distanceToPoint(new Vector3(0, 0, 0))).toBe(0);
    expect(cap.distanceToPoint(new Vector3(0, 0, 2))).toBeCloseTo(1.5);
  });

  it('clone 返回独立副本', () => {
    const c = cap.clone();
    expect(c).not.toBe(cap);
    c.radius = 99;
    expect(cap.radius).toBe(0.5);
  });
});

describe('CylinderShape', () => {
  const cyl = new CylinderShape(new Vector3(0, 0, 0), 1, 1);

  it('containsPoint 轴内 true', () => {
    expect(cyl.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    expect(cyl.containsPoint(new Vector3(0.8, 0.5, 0))).toBe(true);
  });

  it('containsPoint 半径外 / 端面外 false', () => {
    expect(cyl.containsPoint(new Vector3(2, 0, 0))).toBe(false);
    expect(cyl.containsPoint(new Vector3(0, 2, 0))).toBe(false);
  });

  it('clone 返回独立副本', () => {
    const c = cyl.clone();
    expect(c).not.toBe(cyl);
    c.radius = 99;
    expect(cyl.radius).toBe(1);
  });
});

describe('DiskShape', () => {
  const disk = new DiskShape(new Vector3(0, 0, 0), 1, new Vector3(0, 1, 0));

  it('containsPoint 盘平面内 true', () => {
    expect(disk.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    expect(disk.containsPoint(new Vector3(0.8, 0, 0))).toBe(true);
  });

  it('containsPoint 离开平面 / 超出半径 false', () => {
    expect(disk.containsPoint(new Vector3(0, 1, 0))).toBe(false);
    expect(disk.containsPoint(new Vector3(2, 0, 0))).toBe(false);
  });

  it('clone 返回独立副本', () => {
    const c = disk.clone();
    expect(c).not.toBe(disk);
    c.radius = 99;
    expect(disk.radius).toBe(1);
  });
});

describe('QuadShape', () => {
  const quad = new QuadShape(new Vector3(0, 0, 0), 1, 1, new Vector3(0, 1, 0));

  it('containsPoint 矩形内 true', () => {
    expect(quad.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    expect(quad.containsPoint(new Vector3(0.9, 0, 0.9))).toBe(true);
  });

  it('containsPoint 矩形外 / 离开平面 false', () => {
    expect(quad.containsPoint(new Vector3(2, 0, 0))).toBe(false);
    expect(quad.containsPoint(new Vector3(0, 1, 0))).toBe(false);
  });

  it('clone 返回独立副本', () => {
    const c = quad.clone();
    expect(c).not.toBe(quad);
    c.halfWidth = 99;
    expect(quad.halfWidth).toBe(1);
  });
});

describe('TubeShape', () => {
  const tube = new TubeShape(new Vector3(0, 0, 0), 1, 0.5, 1);

  it('containsPoint 壁内 true', () => {
    expect(tube.containsPoint(new Vector3(0.75, 0, 0))).toBe(true); // 径向 0.75 ∈ [0.5,1]
  });

  it('containsPoint 中空内腔 false', () => {
    expect(tube.containsPoint(new Vector3(0, 0, 0))).toBe(false); // 径向 0 < 0.5
    expect(tube.containsPoint(new Vector3(0.25, 0, 0))).toBe(false); // 径向 0.25 < 0.5
  });

  it('containsPoint 外圆柱外 false', () => {
    expect(tube.containsPoint(new Vector3(2, 0, 0))).toBe(false);
  });

  it('clone 返回独立副本', () => {
    const c = tube.clone();
    expect(c).not.toBe(tube);
    c.outerRadius = 99;
    expect(tube.outerRadius).toBe(1);
  });
});

describe('CompoundShape', () => {
  const box = new BoxShape(new Vector3(-2, -1, -1), new Vector3(0, 1, 1));
  const sph = new SphereShape(new Vector3(2, 0, 0), 1);
  const compound = new CompoundShape([box, sph]);

  it('containsPoint 任一子形状命中即 true', () => {
    expect(compound.containsPoint(new Vector3(-1, 0, 0))).toBe(true); // box 内
    expect(compound.containsPoint(new Vector3(2, 0, 0))).toBe(true); // sphere 内
    expect(compound.containsPoint(new Vector3(0.5, 0, 0))).toBe(false); // 两者之间
  });

  it('intersectRay 返回最近命中距离', () => {
    const ray = new Ray(new Vector3(-5, 0, 0), new Vector3(1, 0, 0));
    const t = compound.intersectRay(ray);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(3); // box.min.x=-2, 起点x=-5 → t=3
  });

  it('getAabb 为各子形状并集', () => {
    const aabb = compound.getAabb();
    expect(aabb.min.equals(new Vector3(-2, -1, -1))).toBe(true);
    expect(aabb.max.equals(new Vector3(3, 1, 1))).toBe(true);
  });

  it('clone 返回独立副本 (深拷贝子形状)', () => {
    const c = compound.clone();
    expect(c).not.toBe(compound);
    expect(c.shapes).not.toBe(compound.shapes);
    expect(c.shapes).toHaveLength(2);
  });
});

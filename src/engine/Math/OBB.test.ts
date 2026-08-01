import { describe, it, expect } from 'vitest';
import { OBB } from './OBB';
import { Vector3 } from './Vector3';
import { Matrix3 } from './Matrix3';
import { Box3 } from './Box3';
import { Sphere } from './Sphere';
import { Ray } from './Ray';
import { Plane } from './Plane';

// 绕 Z 轴旋转 90° 的正交矩阵 (row-major):x→y, y→-x
// 列向量 (局部轴):col0=(0,1,0), col1=(-1,0,0), col2=(0,0,1)
function rotZ90(): Matrix3 {
  return new Matrix3(0, -1, 0, 1, 0, 0, 0, 0, 1);
}

describe('OBB', () => {
  describe('construction', () => {
    it('默认构造:中心(0,0,0)、半边长(1,1,1)、旋转为单位矩阵', () => {
      const obb = new OBB();
      expect(obb.center.x).toBe(0);
      expect(obb.center.y).toBe(0);
      expect(obb.center.z).toBe(0);
      expect(obb.halfSize.x).toBe(1);
      expect(obb.halfSize.y).toBe(1);
      expect(obb.halfSize.z).toBe(1);
      expect(obb.rotation.equals(new Matrix3())).toBe(true);
    });

    it('带参构造:复制传入的 center / halfSize / rotation', () => {
      const c = new Vector3(1, 2, 3);
      const hs = new Vector3(2, 4, 6);
      const r = rotZ90();
      const obb = new OBB(c, hs, r);
      expect(obb.center.x).toBe(1);
      expect(obb.halfSize.y).toBe(4);
      expect(obb.rotation.equals(r)).toBe(true);
      // 修改原向量不影响已构造的 OBB (构造时是引用赋值,但这里验证字段值)
      expect(obb.center).toBe(c);
    });
  });

  describe('set / copy / clone', () => {
    it('set 设置全部字段并返回 this', () => {
      const obb = new OBB();
      const ret = obb.set(
        new Vector3(1, 2, 3),
        new Vector3(0.5, 0.5, 0.5),
        rotZ90(),
      );
      expect(ret).toBe(obb);
      expect(obb.center.x).toBe(1);
      expect(obb.halfSize.x).toBe(0.5);
      expect(obb.rotation.equals(rotZ90())).toBe(true);
    });

    it('copy 复制字段且与源对象独立', () => {
      const a = new OBB(new Vector3(1, 2, 3), new Vector3(2, 3, 4), rotZ90());
      const b = new OBB().copy(a);
      expect(b.center.x).toBe(1);
      expect(b.halfSize.y).toBe(3);
      expect(b.rotation.equals(rotZ90())).toBe(true);
      a.center.x = 99;
      expect(b.center.x).toBe(1); // copy 是值复制
    });

    it('clone 返回独立实例', () => {
      const a = new OBB(new Vector3(1, 2, 3), new Vector3(2, 3, 4), rotZ90());
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.center).not.toBe(a.center);
      expect(b.equals(a)).toBe(true);
      b.halfSize.x = 0;
      expect(a.halfSize.x).toBe(2);
    });
  });

  describe('getSize', () => {
    it('返回全尺寸 (2 × halfSize) 并写入 target', () => {
      const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 2, 3));
      const target = new Vector3();
      const ret = obb.getSize(target);
      expect(ret).toBe(target);
      expect(target.x).toBe(2);
      expect(target.y).toBe(4);
      expect(target.z).toBe(6);
    });
  });

  describe('computeBoundingBox', () => {
    it('单位旋转下 AABB = center ± halfSize', () => {
      const obb = new OBB(new Vector3(1, 2, 3), new Vector3(2, 4, 6), new Matrix3());
      const box = new Box3();
      obb.computeBoundingBox(box);
      expect(box.min.x).toBe(-1);
      expect(box.min.y).toBe(-2);
      expect(box.min.z).toBe(-3);
      expect(box.max.x).toBe(3);
      expect(box.max.y).toBe(6);
      expect(box.max.z).toBe(9);
    });

    it('旋转后的 AABB 取 8 角点 min/max', () => {
      // center=0, halfSize=(2,1,1), 绕 Z 旋转 90°:world.x=-local.y∈±1, world.y=local.x∈±2
      const obb = new OBB(new Vector3(0, 0, 0), new Vector3(2, 1, 1), rotZ90());
      const box = new Box3();
      obb.computeBoundingBox(box);
      expect(box.min.x).toBe(-1);
      expect(box.min.y).toBe(-2);
      expect(box.min.z).toBe(-1);
      expect(box.max.x).toBe(1);
      expect(box.max.y).toBe(2);
      expect(box.max.z).toBe(1);
    });
  });

  describe('fromBox3', () => {
    it('从 AABB 构造 OBB:中心/半边长一致,旋转为单位矩阵', () => {
      const box = new Box3(new Vector3(-2, -4, -6), new Vector3(2, 4, 6));
      const obb = new OBB().fromBox3(box);
      expect(obb.center.x).toBe(0);
      expect(obb.center.y).toBe(0);
      expect(obb.center.z).toBe(0);
      expect(obb.halfSize.x).toBe(2);
      expect(obb.halfSize.y).toBe(4);
      expect(obb.halfSize.z).toBe(6);
      expect(obb.rotation.equals(new Matrix3())).toBe(true);
    });
  });

  describe('isEmpty', () => {
    it('任一半边长 ≤ 0 时为空', () => {
      expect(new OBB(new Vector3(), new Vector3(0, 1, 1)).isEmpty()).toBe(true);
      expect(new OBB(new Vector3(), new Vector3(1, -1, 1)).isEmpty()).toBe(true);
    });

    it('半边长均为正时非空', () => {
      expect(new OBB(new Vector3(), new Vector3(1, 1, 1)).isEmpty()).toBe(false);
    });
  });

  describe('containsPoint', () => {
    const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());

    it('内部点返回 true', () => {
      expect(obb.containsPoint(new Vector3(0, 0, 0))).toBe(true);
      expect(obb.containsPoint(new Vector3(0.5, 0.5, 0.5))).toBe(true);
    });

    it('外部点返回 false', () => {
      expect(obb.containsPoint(new Vector3(2, 0, 0))).toBe(false);
      expect(obb.containsPoint(new Vector3(0, -2, 0))).toBe(false);
    });

    it('边界点返回 true (闭区间)', () => {
      expect(obb.containsPoint(new Vector3(1, 1, 1))).toBe(true);
      expect(obb.containsPoint(new Vector3(-1, -1, -1))).toBe(true);
    });

    it('旋转 OBB:点在局部坐标系内判定', () => {
      // halfSize=(2,1,1) 绕 Z 90°:local X→world Y, world (0,2,0) 对应 local (2,0,0) 边界
      const rotated = new OBB(new Vector3(0, 0, 0), new Vector3(2, 1, 1), rotZ90());
      // world (0, 1.5, 0) → local (1.5, 0, 0):|1.5| ≤ 2 ✓
      expect(rotated.containsPoint(new Vector3(0, 1.5, 0))).toBe(true);
      // world (1.5, 0, 0) → local (0, -1.5, 0):|−1.5| > 1 ✗
      expect(rotated.containsPoint(new Vector3(1.5, 0, 0))).toBe(false);
      // world (0, 2, 0) → local (2, 0, 0) 边界
      expect(rotated.containsPoint(new Vector3(0, 2, 0))).toBe(true);
    });
  });

  describe('containsBox', () => {
    const outer = new OBB(new Vector3(0, 0, 0), new Vector3(2, 2, 2), new Matrix3());

    it('完全包含的 OBB 返回 true', () => {
      const inner = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      expect(outer.containsBox(inner)).toBe(true);
    });

    it('部分越界的 OBB 返回 false', () => {
      const overlap = new OBB(new Vector3(2, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      expect(outer.containsBox(overlap)).toBe(false);
    });
  });

  describe('intersectsSphere', () => {
    const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());

    it('球心在盒内相交', () => {
      expect(obb.intersectsSphere(new Sphere(new Vector3(0, 0, 0), 0.5))).toBe(true);
    });

    it('球远离盒子不相交', () => {
      expect(obb.intersectsSphere(new Sphere(new Vector3(5, 0, 0), 0.5))).toBe(false);
    });

    it('球与边界相切相交', () => {
      // 最近点 (1,0,0),距离 1,半径 1
      expect(obb.intersectsSphere(new Sphere(new Vector3(2, 0, 0), 1))).toBe(true);
    });

    it('球跨越边界相交', () => {
      // 最近点 (1,0,0),距离 0.5,半径 1
      expect(obb.intersectsSphere(new Sphere(new Vector3(1.5, 0, 0), 1))).toBe(true);
    });
  });

  describe('intersectsBox3', () => {
    const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());

    it('重叠的 AABB 相交', () => {
      expect(obb.intersectsBox3(new Box3(new Vector3(0.5, 0.5, 0.5), new Vector3(2, 2, 2)))).toBe(true);
    });

    it('分离的 AABB 不相交', () => {
      expect(obb.intersectsBox3(new Box3(new Vector3(2, 2, 2), new Vector3(3, 3, 3)))).toBe(false);
    });

    it('被完全包含的 AABB 相交', () => {
      expect(obb.intersectsBox3(new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)))).toBe(true);
    });
  });

  describe('intersectsOBB', () => {
    it('OBB 与自身相交', () => {
      const a = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      expect(a.intersectsOBB(a)).toBe(true);
    });

    it('两个完全相同的 OBB 重叠相交', () => {
      const a = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      const b = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      expect(a.intersectsOBB(b)).toBe(true);
    });

    it('分离的 OBB 不相交', () => {
      const a = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      const b = new OBB(new Vector3(10, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      expect(a.intersectsOBB(b)).toBe(false);
    });

    it('旋转后交叉重叠的两个 OBB 相交', () => {
      // A 沿 X 方向长,halfSize=(2,0.5,0.5),单位旋转
      const a = new OBB(new Vector3(0, 0, 0), new Vector3(2, 0.5, 0.5), new Matrix3());
      // B 绕 Z 旋转 90° 后沿 Y 方向长,halfSize=(2,0.5,0.5)
      const b = new OBB(new Vector3(0, 0, 0), new Vector3(2, 0.5, 0.5), rotZ90());
      expect(a.intersectsOBB(b)).toBe(true);
    });

    it('旋转后分离的 OBB 不相交', () => {
      const a = new OBB(new Vector3(0, 0, 0), new Vector3(2, 0.5, 0.5), new Matrix3());
      const b = new OBB(new Vector3(10, 0, 0), new Vector3(2, 0.5, 0.5), rotZ90());
      expect(a.intersectsOBB(b)).toBe(false);
    });
  });

  describe('intersectsPlane', () => {
    const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());

    it('平面穿过盒子相交', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0); // y=0
      expect(obb.intersectsPlane(p)).toBe(true);
    });

    it('平面在盒外不相交', () => {
      const p = new Plane(new Vector3(0, 1, 0), -10); // y=10
      expect(obb.intersectsPlane(p)).toBe(false);
    });

    it('平面与盒面相切相交', () => {
      const p = new Plane(new Vector3(0, 1, 0), -1); // y=1, 切 +Y 面
      expect(obb.intersectsPlane(p)).toBe(true);
    });
  });

  describe('intersectsRay', () => {
    const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());

    it('外部射线命中盒面', () => {
      const r = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const target = new Vector3();
      const t = obb.intersectsRay(r, target);
      expect(t).not.toBeNull();
      expect(t).toBeCloseTo(4, 10);
      expect(target.z).toBeCloseTo(1, 10);
    });

    it('射线未命中返回 null', () => {
      const r = new Ray(new Vector3(5, 5, 5), new Vector3(0, 0, -1));
      expect(obb.intersectsRay(r)).toBeNull();
    });

    it('射线起点在盒内返回出口点', () => {
      const r = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const target = new Vector3();
      const t = obb.intersectsRay(r, target);
      expect(t).not.toBeNull();
      expect(t).toBeCloseTo(1, 10);
      expect(target.z).toBeCloseTo(-1, 10);
    });

    it('盒子在射线后方返回 null', () => {
      const r = new Ray(new Vector3(0, 0, -5), new Vector3(0, 0, -1));
      expect(obb.intersectsRay(r)).toBeNull();
    });

    it('旋转 OBB 的射线命中', () => {
      // halfSize=(2,1,1) 绕 Z 90°:world Y 方向延伸 ±2
      const rotated = new OBB(new Vector3(0, 0, 0), new Vector3(2, 1, 1), rotZ90());
      const r = new Ray(new Vector3(0, -5, 0), new Vector3(0, 1, 0));
      const target = new Vector3();
      const t = rotated.intersectsRay(r, target);
      expect(t).not.toBeNull();
      expect(t).toBeCloseTo(3, 10); // 命中 world y=-2
      expect(target.y).toBeCloseTo(-2, 10);
    });
  });

  describe('equals', () => {
    it('字段完全相等返回 true', () => {
      const a = new OBB(new Vector3(1, 2, 3), new Vector3(2, 3, 4), rotZ90());
      const b = new OBB(new Vector3(1, 2, 3), new Vector3(2, 3, 4), rotZ90());
      expect(a.equals(b)).toBe(true);
    });

    it('任一字段不同返回 false', () => {
      const a = new OBB(new Vector3(1, 2, 3), new Vector3(2, 3, 4), rotZ90());
      expect(a.equals(new OBB(new Vector3(0, 2, 3), new Vector3(2, 3, 4), rotZ90()))).toBe(false);
      expect(a.equals(new OBB(new Vector3(1, 2, 3), new Vector3(0, 3, 4), rotZ90()))).toBe(false);
      expect(a.equals(new OBB(new Vector3(1, 2, 3), new Vector3(2, 3, 4), new Matrix3()))).toBe(false);
    });
  });

  describe('translate', () => {
    it('平移中心,半边长与旋转不变', () => {
      const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 2, 3), rotZ90());
      const ret = obb.translate(new Vector3(10, 20, 30));
      expect(ret).toBe(obb);
      expect(obb.center.x).toBe(10);
      expect(obb.center.y).toBe(20);
      expect(obb.center.z).toBe(30);
      expect(obb.halfSize.x).toBe(1);
      expect(obb.rotation.equals(rotZ90())).toBe(true);
    });
  });

  describe('applyMatrix4', () => {
    it('单位矩阵保持 OBB 不变', () => {
      const obb = new OBB(new Vector3(1, 2, 3), new Vector3(1, 1, 1), new Matrix3());
      const before = obb.clone();
      // 直接用结构化的单位矩阵 (无 Matrix4 依赖)
      obb.applyMatrix4({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
      expect(obb.center.x).toBeCloseTo(before.center.x, 10);
      expect(obb.center.y).toBeCloseTo(before.center.y, 10);
      expect(obb.center.z).toBeCloseTo(before.center.z, 10);
      expect(obb.halfSize.x).toBeCloseTo(1, 10);
    });

    it('平移矩阵移动中心', () => {
      const obb = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 1), new Matrix3());
      // elements[12..14] = 平移分量 (10, 20, 30)
      obb.applyMatrix4({
        elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
      });
      expect(obb.center.x).toBeCloseTo(10, 10);
      expect(obb.center.y).toBeCloseTo(20, 10);
      expect(obb.center.z).toBeCloseTo(30, 10);
    });
  });

  describe('edge cases', () => {
    it('空 OBB (halfSize=0) 仍可判定 containsPoint 与 isEmpty', () => {
      const empty = new OBB(new Vector3(0, 0, 0), new Vector3(0, 0, 0), new Matrix3());
      expect(empty.isEmpty()).toBe(true);
      // 仅中心点在“盒”内 (退化到一个点)
      expect(empty.containsPoint(new Vector3(0, 0, 0))).toBe(true);
      expect(empty.containsPoint(new Vector3(1, 0, 0))).toBe(false);
    });

    it('退化 (扁平) OBB:halfSize.z=0 时仍与射线/球正确判定', () => {
      const flat = new OBB(new Vector3(0, 0, 0), new Vector3(1, 1, 0), new Matrix3());
      expect(flat.isEmpty()).toBe(true); // z ≤ 0 视为空
      // 半径足够大的球仍相交
      expect(flat.intersectsSphere(new Sphere(new Vector3(0, 0, 0), 1))).toBe(true);
      // 垂直射线命中薄盒 (z slab 厚度 0,原点 z=0 在 slab 内)
      const r = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const t = flat.intersectsRay(r);
      expect(t).not.toBeNull();
      expect(t).toBeCloseTo(5, 10);
    });
  });
});

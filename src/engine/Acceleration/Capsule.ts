// Capsule — 胶囊(两端半球帽的圆柱,可视为「沿线段扫掠的球体」)。
//
// 适配 three.js r169 `examples/jsm/math/Capsule.js`,是 VREEN 自研引擎的角色
// 体碰撞器:在游戏物理中常用作玩家 capsules 检测体(代替盒,避免角点卡墙)。
// 与 Math/ 中的几何胶囊 CapsuleGeometry(渲染网格)与 Shapes/CapsuleShape
// (SDF 逻辑形状)区别:本类是**碰撞几何体**(start + end + radius),
// 专供 Acceleration/Octree 的胶囊-三角形碰撞与空间宽相查询。
//
// 设计:三字段 `start`/`end`/`radius` 均为可变字段,支持就地 `translate`/
// `copy`/`set`;`getCenter` 写入传入 target 以零分配;`intersectsBox` 用 AABB
// 的 3 个轴对投影区间判定,与原版 `checkAABBAxis` 一致。

import { Vector3 } from '../Math/Vector3';
import type { Box3 } from '../Math/Box3';

export class Capsule {
  /** 胶囊轴线起点(半球帽中心 1)。 */
  start: Vector3;
  /** 胶囊轴线终点(半球帽中心 2)。 */
  end: Vector3;
  /** 胶囊半径(两半球帽与圆柱的半径)。 */
  radius: number;

  /**
   * @param start 线段起点,默认 (0,0,0)。
   * @param end 线段终点,默认 (0,1,0)。
   * @param radius 半径,默认 1。
   */
  constructor(
    start: Vector3 = new Vector3(0, 0, 0),
    end: Vector3 = new Vector3(0, 1, 0),
    radius: number = 1,
  ) {
    this.start = start;
    this.end = end;
    this.radius = radius;
  }

  /** 浅拷贝:共享 start/end 的 Vector3 引用,匹配 three.js `set` 语义。 */
  set(start: Vector3, end: Vector3, radius: number): this {
    this.start.copy(start);
    this.end.copy(end);
    this.radius = radius;
    return this;
  }

  /** 从另一胶囊拷贝(值复制 start/end)。 */
  copy(capsule: Capsule): this {
    this.start.copy(capsule.start);
    this.end.copy(capsule.end);
    this.radius = capsule.radius;
    return this;
  }

  /** 深拷贝。 */
  clone(): Capsule {
    return new Capsule().copy(this);
  }

  /** 胶囊轴线中点(写入 target 返回)。 */
  getCenter(target: Vector3): Vector3 {
    return target.copy(this.end).add(this.start).multiplyScalar(0.5);
  }

  /** 沿 v 整体平移 start/end(就地)。用于碰撞解算时把胶囊推离表面。 */
  translate(v: Vector3): this {
    this.start.add(v);
    this.end.add(v);
    return this;
  }

  /**
   * 与 AABB 是否相交。采用 AABB 三轴投影区间逐轴判定
   * (适配 three.js 内部 `checkAABBAxis`):把胶囊两端投影到每个轴对 (x,y)/(x,z)/(y,z)
   * 二维平面上,结合 radius 与盒的 min/max 检验是否存在分离。
   *
   * 这是保守的相分离测试,用于 Octree 的宽相预剪(getCapsuleTriangles),精确碰撞
   * 兜底由 triangleCapsuleIntersect 完成。
   */
  intersectsBox(box: Box3): boolean {
    return (
      checkAabBAxis(
        this.start.x, this.start.y, this.end.x, this.end.y,
        box.min.x, box.max.x, box.min.y, box.max.y,
        this.radius,
      ) &&
      checkAabBAxis(
        this.start.x, this.start.z, this.end.x, this.end.z,
        box.min.x, box.max.x, box.min.z, box.max.z,
        this.radius,
      ) &&
      checkAabBAxis(
        this.start.y, this.start.z, this.end.y, this.end.z,
        box.min.y, box.max.y, box.min.z, box.max.z,
        this.radius,
      )
    );
  }
}

/**
 * AABB 在二轴平面上的投影区间分离测试。
 * 返回 true 表示两轴上胶囊端点扩张 radius 后的区间与盒区间**可能重叠**(非分离),
 * false 表示在某个轴对上明确分离(不相交)。
 * 与 three.js `checkAABBAxis` 同算法(仅命名调整)。
 */
function checkAabBAxis(
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  minx: number, maxx: number,
  miny: number, maxy: number,
  radius: number,
): boolean {
  return (
    (minx - p1x < radius || minx - p2x < radius) &&
    (p1x - maxx < radius || p2x - maxx < radius) &&
    (miny - p1y < radius || miny - p2y < radius) &&
    (p1y - maxy < radius || p2y - maxy < radius)
  );
}

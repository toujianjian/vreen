// Octree — 八叉树空间分割结构,用于精确**体碰撞**(胶囊/球/盒 vs 三角形网格)。
//
// 适配 three.js r169 `examples/jsm/math/Octree.js`(官方角色碰撞方案)与
// o3de Atom 的体素/网格加速结构理念。与同目录 BVH/MeshBVH 互补:
//   - **BVH/MeshBVRaycaster 的射线-三角形查询优化(单次射线)。
//   - **Octree对象**的高频体碰撞(每帧胶囊采样脚踏地形)。
//
// 实现:把场景三角形递归八分到子盒,叶子最多 `trianglesPerLeaf`(默认 8)个三角形,
// 深度上限 `maxLevel`(默认 16)。查询时按 collider 的 AABB 预剪子盒,命中叶子后
// 对叶子三角形做精确(SAT/swept-sphere)相交,逐三角形把物体推离表面,汇总位移
// 作为最终碰撞 normal/depth。这是 three.js 官方 `OctreeGame` 例子(角色行走)的核心。
//
// 纯数据层:不依赖 WebGL,所有方法可在 Node 直接单测;`fromGraphNode` 虽读取
// 场景图,Object3D/BufferGeometry 均为纯数据结构(无 GL 句柄)。

import { Box3 } from '../Math/Box3';
import { Line3 } from '../Math/Line3';
import { Plane } from '../Math/Plane';
import { Sphere } from '../Math/Sphere';
import { Triangle } from '../Math/Triangle';
import { Vector3 } from '../Math/Vector3';
import { Ray } from '../Math/Ray';
import { Capsule } from './Capsule';

// ---- 模块级复用临时变量(避免每次查询分配) ----
const _v1 = new Vector3();
const _v2 = new Vector3();
const _point1 = new Vector3();
const _point2 = new Vector3();
const _plane = new Plane();
const _line1 = new Line3();
const _line2 = new Line3();
const _box = new Box3();
const _sphere = new Sphere();
const _capsule = new Capsule();
const _center = new Vector3();
const _temp1 = new Vector3();
const _temp2 = new Vector3();
const _temp3 = new Vector3();
const EPS = 1e-10;

/** 体碰撞结果(命中时返回)。 */
export interface OctreeCollision {
  /** 碰撞法线(解算方向,物体应沿此方向被推开)。 */
  normal: Vector3;
  /** 穿透深度(>0)。 */
  depth: number;
}

/** 射线命中结果。 */
export interface OctreeRayHit {
  /** 命中点到射线原点的距离。 */
  distance: number;
  /** 命中三角形。 */
  triangle: Triangle;
  /** 命中点(世界坐标)。 */
  position: Vector3;
}

/**
 * 求两条线段各自到对方最近点的参数对(线段-线段最近点)。
 * 用于胶囊轴与三角形边的最近距离判定(SAT),适配 three.js `lineToLineClosestPoints`。
 * 目标 1/2 接收最近点(分别写在 line1 / line2 上),不传则不算。
 */
function lineToLineClosestPoints(
  line1: Line3,
  line2: Line3,
  target1: Vector3 | null = null,
  target2: Vector3 | null = null,
): void {
  const r = _temp1.copy(line1.end).sub(line1.start);
  const s = _temp2.copy(line2.end).sub(line2.start);
  const w = _temp3.copy(line2.start).sub(line1.start);

  const a = r.dot(s);
  const b = r.dot(r);
  const c = s.dot(s);
  const d = s.dot(w);
  const e = r.dot(w);

  let t1: number, t2: number;
  const divisor = b * c - a * a;

  if (Math.abs(divisor) < EPS) {
    // 线段近似平行:在端点之间取较优参数
    const d1 = -d / c;
    const d2 = (a - d) / c;
    if (Math.abs(d1 - 0.5) < Math.abs(d2 - 0.5)) {
      t1 = 0;
      t2 = d1;
    } else {
      t1 = 1;
      t2 = d2;
    }
  } else {
    t1 = (d * a + e * c) / divisor;
    t2 = (t1 * a - d) / c;
  }

  t2 = Math.max(0, Math.min(1, t2));
  t1 = Math.max(0, Math.min(1, t1));

  if (target1) {
    target1.copy(r).multiplyScalar(t1).add(line1.start);
  }
  if (target2) {
    target2.copy(s).multiplyScalar(t2).add(line2.start);
  }
}

/**
 * 八叉树。从场景或三角形集合构建,对胶囊/球/盒/射线查询碰撞。
 *
 * 用法:
 * ```ts
 * const octree = new Octree();
 * scene.traverse((o) => { /* 为每个 mesh 插入世界三角形 *\/ });
 * octree.build();
 * const hit = octree.capsuleIntersect(playerCollider);
 * if (hit) playerCollider.translate(hit.normal.multiplyScalar(hit.depth));
 * ```
 */
export class Octree {
  /** 当前节点包围盒(根节点 = 全场景盒;子节点 = 八分之一)。 */
  box: Box3 | null;
  /** 边界(建树前累积所有三角形 AABB 的并,不含 box 的 0.01 放宽)。 */
  bounds: Box3;
  /** 每叶子最多三角形数,超出则继续分割(除非到 maxLevel)。 */
  trianglesPerLeaf = 8;
  /** 树最大深度。 */
  maxLevel = 16;

  // 子树八分;叶子时为空。
  subTrees: Octree[] = [];
  // 本节点持有的三角形;中间节点为空(全部下放到子树),叶子节点非空。
  triangles: Triangle[] = [];

  constructor(box?: Box3) {
    this.box = box ?? new Box3();
    this.bounds = new Box3();
  }

  /** 累加一个三角形并扩展 bounds。 */
  addTriangle(triangle: Triangle): this {
    const b = this.bounds;
    b.min.x = Math.min(b.min.x, triangle.a.x, triangle.b.x, triangle.c.x);
    b.min.y = Math.min(b.min.y, triangle.a.y, triangle.b.y, triangle.c.y);
    b.min.z = Math.min(b.min.z, triangle.a.z, triangle.b.z, triangle.c.z);
    b.max.x = Math.max(b.max.x, triangle.a.x, triangle.b.x, triangle.c.x);
    b.max.y = Math.max(b.max.y, triangle.a.y, triangle.b.y, triangle.c.y);
    b.max.z = Math.max(b.max.z, triangle.a.z, triangle.b.z, triangle.c.z);
    this.triangles.push(triangle);
    return this;
  }

  /** 用 bounds 设置 box,并沿负方向放宽 0.01 以应对规则网格边界。 */
  calcBox(): this {
    this.box = this.bounds.clone();
    this.box.min.x -= 0.01;
    this.box.min.y -= 0.01;
    this.box.min.z -= 0.01;
    return this;
  }

  /**
   * 递归八分:把本节点的三角形分配到与其相交的 8 个子盒中,过聚的子树继续分割。
   * @param level 当前深度(根为 0)。
   */
  split(level: number): this {
    if (!this.box) return this;

    const subTrees: Octree[] = [];
    const halfsize = _v2.copy(this.box.max).sub(this.box.min).multiplyScalar(0.5);

    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          const subBox = new Box3();
          const v = _v1.set(x, y, z);
          subBox.min.copy(this.box.min).add(v.multiply(halfsize));
          subBox.max.copy(subBox.min).add(halfsize);
          subTrees.push(new Octree(subBox));
        }
      }
    }

    // 把本节点三角形按 `box.intersectsTriangle` 分配到子盒
    let triangle: Triangle | undefined;
    while ((triangle = this.triangles.pop()) !== undefined) {
      for (let i = 0; i < subTrees.length; i++) {
        if (subTrees[i].box!.intersectsTriangle(triangle)) {
          subTrees[i].triangles.push(triangle);
        }
      }
    }

    for (let i = 0; i < subTrees.length; i++) {
      const len = subTrees[i].triangles.length;
      if (len > this.trianglesPerLeaf && level < this.maxLevel) {
        subTrees[i].split(level + 1);
      }
      if (len !== 0) {
        this.subTrees.push(subTrees[i]);
      }
    }
    return this;
  }

  /** 建树:计算根盒后从根开始分割。 */
  build(): this {
    this.calcBox();
    this.split(0);
    return this;
  }

  /** 收集可能与 ray 相交的叶子三角形到 triangles(去重)。 */
  getRayTriangles(ray: Ray, triangles: Triangle[]): void {
    for (let i = 0; i < this.subTrees.length; i++) {
      const subTree = this.subTrees[i];
      if (!ray.intersectsBox(subTree.box!)) continue;
      if (subTree.triangles.length > 0) {
        for (let j = 0; j < subTree.triangles.length; j++) {
          if (triangles.indexOf(subTree.triangles[j]) === -1) {
            triangles.push(subTree.triangles[j]);
          }
        }
      } else {
        subTree.getRayTriangles(ray, triangles);
      }
    }
  }

  /** 收集可能与球相交的叶子三角形(去重)。 */
  getSphereTriangles(sphere: Sphere, triangles: Triangle[]): void {
    for (let i = 0; i < this.subTrees.length; i++) {
      const subTree = this.subTrees[i];
      if (!sphere.intersectsBox(subTree.box!)) continue;
      if (subTree.triangles.length > 0) {
        for (let j = 0; j < subTree.triangles.length; j++) {
          if (triangles.indexOf(subTree.triangles[j]) === -1) {
            triangles.push(subTree.triangles[j]);
          }
        }
      } else {
        subTree.getSphereTriangles(sphere, triangles);
      }
    }
  }

  /** 收集可能与盒相交的叶子三角形(去重)。 */
  getBoxTriangles(box: Box3, triangles: Triangle[]): void {
    for (let i = 0; i < this.subTrees.length; i++) {
      const subTree = this.subTrees[i];
      if (!box.intersectsBox(subTree.box!)) continue;
      if (subTree.triangles.length > 0) {
        for (let j = 0; j < subTree.triangles.length; j++) {
          if (triangles.indexOf(subTree.triangles[j]) === -1) {
            triangles.push(subTree.triangles[j]);
          }
        }
      } else {
        subTree.getBoxTriangles(box, triangles);
      }
    }
  }

  /** 收集可能与胶囊相交的叶子三角形(去重)。 */
  getCapsuleTriangles(capsule: Capsule, triangles: Triangle[]): void {
    for (let i = 0; i < this.subTrees.length; i++) {
      const subTree = this.subTrees[i];
      if (!capsule.intersectsBox(subTree.box!)) continue;
      if (subTree.triangles.length > 0) {
        for (let j = 0; j < subTree.triangles.length; j++) {
          if (triangles.indexOf(subTree.triangles[j]) === -1) {
            triangles.push(subTree.triangles[j]);
          }
        }
      } else {
        subTree.getCapsuleTriangles(capsule, triangles);
      }
    }
  }

  /** 胶囊与单三角形的精确相交(平面距离 + containsPoint + 线-线最近点)。 */
  triangleCapsuleIntersect(
    capsule: Capsule,
    triangle: Triangle,
  ): { normal: Vector3; point: Vector3; depth: number } | false {
    triangle.getPlane(_plane);

    const d1 = _plane.distanceToPoint(capsule.start) - capsule.radius;
    const d2 = _plane.distanceToPoint(capsule.end) - capsule.radius;

    // 两端都在平面同侧且足够远 → 不相交
    if ((d1 > 0 && d2 > 0) || (d1 < -capsule.radius && d2 < -capsule.radius)) {
      return false;
    }

    // 沿胶囊轴内插到平面交点
    const delta = Math.abs(d1 / (Math.abs(d1) + Math.abs(d2)));
    const intersectPoint = _v1.copy(capsule.start).lerp(capsule.end, delta);

    if (triangle.containsPoint(intersectPoint)) {
      return {
        normal: _plane.normal.clone(),
        point: intersectPoint.clone(),
        depth: Math.abs(Math.min(d1, d2)),
      };
    }

    // 否则检测胶囊轴与三角形三边的最近距离是否 < radius
    const r2 = capsule.radius * capsule.radius;
    const line1 = _line1.set(capsule.start, capsule.end);
    const lines: [Vector3, Vector3][] = [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ];

    for (let i = 0; i < lines.length; i++) {
      const line2 = _line2.set(lines[i][0], lines[i][1]);
      lineToLineClosestPoints(line1, line2, _point1, _point2);
      if (_point1.distanceToSquared(_point2) < r2) {
        return {
          normal: _point1.clone().sub(_point2).normalize(),
          point: _point2.clone(),
          depth: capsule.radius - _point1.distanceTo(_point2),
        };
      }
    }
    return false;
  }

  /** 盒与单三角形的精确相交(选取盒最深入平面的角点投影回三角形面)。 */
  triangleBoxIntersect(
    box: Box3,
    triangle: Triangle,
  ): { normal: Vector3; point: Vector3; depth: number } | false {
    // 便宜的 AABB 区间预检
    if (
      Math.max(triangle.a.x, triangle.b.x, triangle.c.x) < box.min.x ||
      Math.min(triangle.a.x, triangle.b.x, triangle.c.x) > box.max.x ||
      Math.max(triangle.a.y, triangle.b.y, triangle.c.y) < box.min.y ||
      Math.min(triangle.a.y, triangle.b.y, triangle.c.y) > box.max.y ||
      Math.max(triangle.a.z, triangle.b.z, triangle.c.z) < box.min.z ||
      Math.min(triangle.a.z, triangle.b.z, triangle.c.z) > box.max.z
    ) {
      return false;
    }
    if (!box.intersectsTriangle(triangle)) return false;

    triangle.getPlane(_plane);

    // 选取盒上「最深入平面」的角(沿法线分量符号方向)
    _v1.x = _plane.normal.x > 0 ? box.min.x : box.max.x;
    _v1.y = _plane.normal.y > 0 ? box.min.y : box.max.y;
    _v1.z = _plane.normal.z > 0 ? box.min.z : box.max.z;

    const distance = _plane.distanceToPoint(_v1);
    const intersection = {
      depth: -distance, // 翻号使 depth 为正
      normal: _plane.normal.clone(),
      point: _v1.clone(),
    };
    intersection.point.addScaledVector(intersection.normal, distance);
    return intersection;
  }

  /** 球与单三角形的精确相交。 */
  triangleSphereIntersect(
    sphere: Sphere,
    triangle: Triangle,
  ): { normal: Vector3; point: Vector3; depth: number } | false {
    triangle.getPlane(_plane);
    if (!sphere.intersectsPlane(_plane)) return false;

    const depth = Math.abs(_plane.distanceToSphere(sphere));
    const r2 = sphere.radius * sphere.radius - depth * depth;
    const plainPoint = _plane.projectPoint(sphere.center, _v1);

    if (triangle.containsPoint(sphere.center)) {
      return {
        normal: _plane.normal.clone(),
        point: plainPoint.clone(),
        depth: Math.abs(_plane.distanceToSphere(sphere)),
      };
    }

    const lines: [Vector3, Vector3][] = [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ];
    for (let i = 0; i < lines.length; i++) {
      _line1.set(lines[i][0], lines[i][1]);
      _line1.closestPointToPoint(plainPoint, true, _v2);
      const d = _v2.distanceToSquared(sphere.center);
      if (d < r2) {
        return {
          normal: sphere.center.clone().sub(_v2).normalize(),
          point: _v2.clone(),
          depth: sphere.radius - Math.sqrt(d),
        };
      }
    }
    return false;
  }

  /** 盒-树碰撞:累计位移后取总推开方向/深度。 */
  boxIntersect(box: Box3): OctreeCollision | false {
    _box.copy(box);
    const triangles: Triangle[] = [];
    let result: { normal: Vector3; point: Vector3; depth: number } | false;
    let hit = false;

    this.getBoxTriangles(box, triangles);
    for (let i = 0; i < triangles.length; i++) {
      if ((result = this.triangleBoxIntersect(_box, triangles[i]))) {
        hit = true;
        _box.translate(result.normal.clone().multiplyScalar(result.depth));
      }
    }

    if (hit) {
      const collisionVector = _box.getCenter(_center).sub(box.getCenter(_v1));
      const depth = collisionVector.length();
      return { normal: collisionVector.normalize(), depth };
    }
    return false;
  }

  /** 球-树碰撞。 */
  sphereIntersect(sphere: Sphere): OctreeCollision | false {
    _sphere.copy(sphere);
    const triangles: Triangle[] = [];
    let result: { normal: Vector3; point: Vector3; depth: number } | false;
    let hit = false;

    this.getSphereTriangles(sphere, triangles);
    for (let i = 0; i < triangles.length; i++) {
      if ((result = this.triangleSphereIntersect(_sphere, triangles[i]))) {
        hit = true;
        _sphere.center.add(result.normal.clone().multiplyScalar(result.depth));
      }
    }

    if (hit) {
      const collisionVector = _sphere.center.clone().sub(sphere.center);
      const depth = collisionVector.length();
      return { normal: collisionVector.normalize(), depth };
    }
    return false;
  }

  /**
   * 胶囊-树碰撞(角色防穿透主用)。算法:逐三角形把胶囊推离表面,最终位移
   * 作为整体碰撞方向/深度。
   */
  capsuleIntersect(capsule: Capsule): OctreeCollision | false {
    _capsule.copy(capsule);
    const triangles: Triangle[] = [];
    let result: { normal: Vector3; point: Vector3; depth: number } | false;
    let hit = false;

    this.getCapsuleTriangles(_capsule, triangles);
    for (let i = 0; i < triangles.length; i++) {
      if ((result = this.triangleCapsuleIntersect(_capsule, triangles[i]))) {
        hit = true;
        _capsule.translate(result.normal.clone().multiplyScalar(result.depth));
      }
    }

    if (hit) {
      const collisionVector = _capsule.getCenter(_center).sub(capsule.getCenter(_v1));
      const depth = collisionVector.length();
      return { normal: collisionVector.normalize(), depth };
    }
    return false;
  }

  /** 射线-树:命中最近三角形(返回距离/三角形/三维命中点)。 */
  rayIntersect(ray: Ray): OctreeRayHit | false {
    const triangles: Triangle[] = [];
    let triangle: Triangle | undefined;
    let position: Vector3 | undefined;
    let distance = 1e100;

    this.getRayTriangles(ray, triangles);
    for (let i = 0; i < triangles.length; i++) {
      const result = ray.intersectTriangle(
        triangles[i].a, triangles[i].b, triangles[i].c, true, _v1,
      );
      if (result) {
        const newdistance = result.sub(ray.origin).length();
        if (distance > newdistance) {
          position = result.clone().add(ray.origin);
          distance = newdistance;
          triangle = triangles[i];
        }
      }
    }
    return distance < 1e100
      ? { distance, triangle: triangle as Triangle, position: position as Vector3 }
      : false;
  }

  /**
   * 从场景图节点构建:遍历子树中所有 mesh,把其世界坐标三角形插入并建树。
   *
   * 高层入口——依赖 Object3D / BufferGeometry 纯数据结构(无 WebGL)。索引化几何
   * 按 index 取顶点;非索引化几何按连续 3 顶点取。三角形顶点经 `matrixWorld`
   * 变换到世界空间。
   */
  fromGraphNode(group: import('../Core/Object3D').Object3D): this {
    group.updateWorldMatrix(true, true);
    group.traverse((obj: import('../Core/Object3D').Object3D) => {
      const mesh = obj as unknown as {
        isMesh?: boolean;
        geometry?: import('../Core/BufferGeometry').BufferGeometry;
        matrixWorld: typeof group.matrixWorld;
      };
      if (mesh.isMesh !== true || !mesh.geometry) return;

      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      if (!position) return;

      const matrix = mesh.matrixWorld;
      const v1 = new Vector3();
      const v2 = new Vector3();
      const v3 = new Vector3();

      if (geometry.index !== null && geometry.index !== undefined) {
        const idx = geometry.index;
        const count = idx.count;
        for (let i = 0; i < count; i += 3) {
          v1.fromBufferAttribute(position, idx.getX(i)).applyMatrix4(matrix);
          v2.fromBufferAttribute(position, idx.getX(i + 1)).applyMatrix4(matrix);
          v3.fromBufferAttribute(position, idx.getX(i + 2)).applyMatrix4(matrix);
          this.addTriangle(new Triangle(v1.clone(), v2.clone(), v3.clone()));
        }
      } else {
        const count = position.count;
        for (let i = 0; i < count; i += 3) {
          v1.fromBufferAttribute(position, i).applyMatrix4(matrix);
          v2.fromBufferAttribute(position, i + 1).applyMatrix4(matrix);
          v3.fromBufferAttribute(position, i + 2).applyMatrix4(matrix);
          this.addTriangle(new Triangle(v1.clone(), v2.clone(), v3.clone()));
        }
      }
    });

    this.build();
    return this;
  }

  /** 清空。box 置空、bounds 置空盒(回到构造后状态)。 */
  clear(): this {
    this.box = null;
    this.bounds.makeEmpty();
    this.subTrees.length = 0;
    this.triangles.length = 0;
    return this;
  }
}

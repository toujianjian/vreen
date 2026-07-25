// PathFinder — A* 寻路 + 漏斗算法路径平滑。
//
// 与 NavMesh 的分工:
//   * NavMesh 持有网格数据(三角形/顶点/邻接关系)
//   * PathFinder 实现寻路算法,不持有网格状态
//
// 算法:
//   * findPathTriangle: 三角形级别 A*,以三角形中心欧氏距离为启发
//   * findPath: 顶点级别寻路,先做三角形 A*,再用字符串拉直把路径点
//     收敛为转折点序列(去掉中间共线点)
//
// 注:漏斗算法的完整版需保留左右通道边界,这里采用简化版字符串拉直 —
// 仅在三角形链路上做线段可见性测试,逐步删除中间冗余点。

import { Vector3 } from '../Math';
import type { NavMesh, NavTriangle } from './NavMesh';

/** A* 节点。 */
interface AStarNode {
  /** 三角形索引。 */
  tri: number;
  /** 已知最优 g 值(起点到此三角形的代价)。 */
  g: number;
  /** f = g + h,h 为到终点的启发式估计。 */
  f: number;
  /** 父节点三角形索引(-1 表示起点)。 */
  parent: number;
}

/** 二叉堆(最小堆),按 f 值排序。 */
class MinHeap {
  private items: AStarNode[] = [];
  private indexMap = new Map<number, number>(); // tri -> heapIndex

  get size(): number { return this.items.length; }

  has(tri: number): boolean { return this.indexMap.has(tri); }

  push(node: AStarNode): void {
    this.items.push(node);
    this.indexMap.set(node.tri, this.items.length - 1);
    this.siftUp(this.items.length - 1);
  }

  pop(): AStarNode | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    this.indexMap.delete(top.tri);
    if (this.items.length > 0) {
      this.items[0] = last;
      this.indexMap.set(last.tri, 0);
      this.siftDown(0);
    }
    return top;
  }

  update(node: AStarNode): void {
    const idx = this.indexMap.get(node.tri);
    if (idx === undefined) {
      this.push(node);
      return;
    }
    if (node.f < this.items[idx].f) {
      this.items[idx] = node;
      this.siftUp(idx);
    }
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.items[idx].f < this.items[parent].f) {
        this.swap(idx, parent);
        idx = parent;
      } else break;
    }
  }

  private siftDown(idx: number): void {
    const n = this.items.length;
    while (true) {
      const l = idx * 2 + 1;
      const r = idx * 2 + 2;
      let smallest = idx;
      if (l < n && this.items[l].f < this.items[smallest].f) smallest = l;
      if (r < n && this.items[r].f < this.items[smallest].f) smallest = r;
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const tmp = this.items[i];
    this.items[i] = this.items[j];
    this.items[j] = tmp;
    this.indexMap.set(this.items[i].tri, i);
    this.indexMap.set(this.items[j].tri, j);
  }
}

/**
 * A* 寻路器 — 在 NavMesh 上寻路并平滑路径。
 */
export class PathFinder {
  /** 关联的导航网格。 */
  navmesh: NavMesh;
  /** 开放集(待扩展节点)。 */
  openSet: MinHeap = new MinHeap();
  /** 关闭集(已扩展三角形索引)。 */
  closedSet: Set<number> = new Set();

  constructor(navmesh: NavMesh) {
    this.navmesh = navmesh;
  }

  /** 启发式距离:三角形中心间的欧氏距离。 */
  getDistance(a: NavTriangle, b: NavTriangle): number {
    return a.center.distanceTo(b.center);
  }

  /** 三角形级别 A* 寻路,返回三角形索引链(从 startTri 到 endTri)。
   *  不可达返回空数组。 */
  findPathTriangle(startTri: number, endTri: number): number[] {
    if (startTri < 0 || endTri < 0) return [];
    if (startTri === endTri) return [startTri];

    this.openSet = new MinHeap();
    this.closedSet.clear();

    const tris = this.navmesh.triangles;
    if (startTri >= tris.length || endTri >= tris.length) return [];

    const goal = tris[endTri];
    this.openSet.push({
      tri: startTri,
      g: 0,
      f: this.getDistance(tris[startTri], goal),
      parent: -1,
    });

    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    gScore.set(startTri, 0);

    while (this.openSet.size > 0) {
      const current = this.openSet.pop()!;
      if (current.tri === endTri) {
        // 重建路径
        const path: number[] = [current.tri];
        let p: number | undefined = current.parent;
        while (p !== undefined && p !== -1) {
          path.unshift(p);
          p = cameFrom.get(p);
        }
        return path;
      }
      this.closedSet.add(current.tri);

      const cur = tris[current.tri];
      for (const neighborIdx of cur.neighbors) {
        if (this.closedSet.has(neighborIdx)) continue;
        const neighbor = tris[neighborIdx];
        if (!neighbor) continue;
        const tentativeG = current.g + this.getDistance(cur, neighbor);
        const existingG = gScore.get(neighborIdx);
        if (existingG === undefined || tentativeG < existingG) {
          gScore.set(neighborIdx, tentativeG);
          cameFrom.set(neighborIdx, current.tri);
          this.openSet.update({
            tri: neighborIdx,
            g: tentativeG,
            f: tentativeG + this.getDistance(neighbor, goal),
            parent: current.tri,
          });
        }
      }
    }
    return [];
  }

  /** 完整寻路:start→end,返回世界坐标路径点(已平滑)。
   *  无路径返回空数组。 */
  findPath(start: Vector3, end: Vector3): Vector3[] {
    // 1. 找到起终点所在三角形(或最近三角形)
    let startTri = this.navmesh.findTriangle(start);
    let endTri = this.navmesh.findTriangle(end);

    // 起终点不在网格上时,吸附到最近三角形
    if (startTri === -1) {
      const clamped = this.navmesh.getClosestPoint(start);
      // 检查 clamped 是否与某个三角形中心匹配
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.navmesh.triangles.length; i++) {
        const d = this.navmesh.triangles[i].center.distanceToSquared(clamped);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      startTri = best;
    }
    if (endTri === -1) {
      const clamped = this.navmesh.getClosestPoint(end);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.navmesh.triangles.length; i++) {
        const d = this.navmesh.triangles[i].center.distanceToSquared(clamped);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      endTri = best;
    }
    if (startTri === -1 || endTri === -1) return [];

    // 2. 三角形级别 A*
    const triPath = this.findPathTriangle(startTri, endTri);
    if (triPath.length === 0) return [];

    // 3. 构造初始路径点:起 → 各三角形中心 → 终
    const rawPath: Vector3[] = [start.clone()];
    for (let i = 1; i < triPath.length - 1; i++) {
      rawPath.push(this.navmesh.triangles[triPath[i]].center.clone());
    }
    rawPath.push(end.clone());

    // 4. 字符串拉直平滑
    return this.smoothPath(rawPath);
  }

  /** 路径平滑(字符串拉直):保留起点终点,删除冗余中间点。
   *  算法:从 i=0 开始,贪心地把 j 推到尽量远,只要 [i, j] 直线
   *  仍能被路径上每个中间点所在三角形"可见"。
   *  可见性近似:线段中点必须落在某个三角形内。 */
  smoothPath(path: Vector3[]): Vector3[] {
    if (path.length <= 2) return path.slice();

    const result: Vector3[] = [path[0].clone()];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      // 从终点倒退找最远的可见点
      while (j > i + 1) {
        if (this.isSegmentWalkable(path[i], path[j])) break;
        j--;
      }
      result.push(path[j].clone());
      i = j;
    }
    return result;
  }

  /** 线段是否可行走(每段中点在网格上)。简化版可见性测试。 */
  private isSegmentWalkable(a: Vector3, b: Vector3): boolean {
    const steps = Math.max(1, Math.floor(a.distanceTo(b) / 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const py = a.y + (b.y - a.y) * t;
      // 在 XZ 平面判定是否在网格上
      if (this.navmesh.findTriangle(new Vector3(px, py, pz)) === -1) {
        return false;
      }
    }
    return true;
  }
}

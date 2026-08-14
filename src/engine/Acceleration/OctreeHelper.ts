// OctreeHelper — Octree 可视化数据产出器。
//
// 适配 three.js r169 `examples/jsm/helpers/OctreeHelper.js`。与渲染解耦:不持有
// WebGL 资源,只**递归遍历 Octree 树收集叶子/全部子节点的 Box3**,返回数组供
// 调用方(GridHelper3D / Box3Helper / 自研渲染器)绘制。这样在无头测试里可单测
// 「建树后叶子数量与层次符合预期」,不依赖任何 GL 上下文。

import { Box3 } from '../Math/Box3';
import { Octree } from './Octree';

export class OctreeHelper {
  /** 关联的 Octree。 */
  octree: Octree;

  constructor(octree: Octree) {
    this.octree = octree;
  }

  /**
   * 递归收集 Octree 所有子节点的盒。
   * @param maxDepth 可选:最多下钻深度(根=0)。不传则下钻到底。
   * @returns Box3 数组(每个引用为节点 box,调用方可只读或克隆)。
   */
  getBoxes(maxDepth?: number): Box3[] {
    const boxes: Box3[] = [];
    this._collect(this.octree, 0, maxDepth, boxes);
    return boxes;
  }

  /** 仅收集叶子的盒(含三角形的节点)。 */
  getLeafBoxes(): Box3[] {
    const boxes: Box3[] = [];
    this._collectLeaves(this.octree, boxes);
    return boxes;
  }

  /** 收集节点总数(用于断言深度/分割行为)。 */
  getNodeCount(): number {
    let n = 0;
    const visit = (node: Octree): void => {
      n++;
      for (const c of node.subTrees) visit(c);
    };
    visit(this.octree);
    return n;
  }

  /** 估算叶子三角形总数(每个三角形可能被多个叶子共享——Octree 推下时按 box
   *  相交多归属分发,故叶子计数 > 实际三角形数,可作树指标)。 */
  getLeafTriangleCount(): number {
    let n = 0;
    const visit = (node: Octree): void => {
      if (node.triangles.length > 0 || node.subTrees.length === 0) {
        n += node.triangles.length;
      }
      for (const c of node.subTrees) visit(c);
    };
    visit(this.octree);
    return n;
  }

  private _collect(
    node: Octree,
    depth: number,
    maxDepth: number | undefined,
    out: Box3[],
  ): void {
    if (maxDepth !== undefined && depth > maxDepth) return;
    if (node.box) out.push(node.box);
    for (const c of node.subTrees) this._collect(c, depth + 1, maxDepth, out);
  }

  private _collectLeaves(node: Octree, out: Box3[]): void {
    if (node.subTrees.length === 0) {
      if (node.box) out.push(node.box);
    } else {
      for (const c of node.subTrees) this._collectLeaves(c, out);
    }
  }
}

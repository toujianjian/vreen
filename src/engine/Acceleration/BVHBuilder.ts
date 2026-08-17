// BVHBuilder — 从 BufferGeometry 构建 BVH 的工具集。
//
// 构建流程:
//   1. 从 position + (可选)index 缓冲提取扁平三角形列表(每个三角形 3 个
//      顶点索引,指向 position 缓冲)。
//   2. 递归二分:每个内部节点选定一条分裂轴,按指定策略(MIDDLE /
//      MEDIAN_AXIS / SAH)把当前三角形集合分成左右两组。
//   3. 当三角形数 ≤ maxLeafSize 或达到 maxDepth 时落叶子。
//
// 三种策略:
//   * MIDDLE      按最长轴的"质心包围盒中点"做空间划分(质心 < midpoint 入左,
//                 ≥ midpoint 入右);若一侧为空则退化为中位数分割。
//   * MEDIAN_AXIS 按最长轴对质心排序后取中位数索引分割(保证两侧数量平衡)。
//   * SAH         Surface Area Heuristic:对每条轴做 K 个 bin 的分箱,
//                 遍历所有 bin 分裂点取代价最小者(MacDonald & Booth 1990)。
//
// 节点 bounds 取"子树所有三角形 AABB 的并集"(而非质心包围盒),
// 这样射线 - AABB 测试更紧致,降低误检率。

import { Box3 } from '../Math/Box3';
import { Vector3 } from '../Math/Vector3';
import type { BufferGeometry } from '../Core/BufferGeometry';
import { BVHNode } from './BVHNode';

/** 构建策略。 */
export enum BVHBuildStrategy {
  /** 中位数空间分割(默认):按最长轴质心包围盒中点划分。 */
  MIDDLE = 0,
  /** Surface Area Heuristic:K-bin 分箱,取 SAH 代价最小的分裂。 */
  SAH = 1,
  /** 按最长轴对质心排序后取中位数索引分割(数量平衡)。 */
  MEDIAN_AXIS = 2,
}

/** 构建选项。 */
export interface BVHBuildOptions {
  /** 叶子节点最大三角形数,默认 8。 */
  maxLeafSize?: number;
  /** 树的最大深度(防止退化几何导致栈溢出),默认 32。 */
  maxDepth?: number;
  /** 构建策略,默认 MIDDLE。 */
  strategy?: BVHBuildStrategy;
  /** SAH 使用的分箱数,默认 12。 */
  sahBinCount?: number;
}

/** 构建产物:BVH 根节点 + 三角形顶点索引扁平数组。 */
export interface BVHBuildResult {
  root: BVHNode | null;
  /** 每个三角形的 3 个顶点索引,长度 = triCount * 3。 */
  triangles: Uint32Array;
  /** position 缓冲(供后续射线/视锥查询复用)。 */
  positions: Float32Array;
  /** 三角形总数。 */
  triangleCount: number;
}

// 模块内复用的临时向量,避免递归中频繁分配。
const _centroid = new Vector3();
const _centroidBounds = new Box3();
const _triBounds = new Box3();

/** 从 BufferGeometry 提取扁平三角形顶点索引数组。
 *  - 有 index: 直接复制索引缓冲(每 3 个索引一组)。
 *  - 无 index: triangle t 的顶点为 (3t, 3t+1, 3t+2)。 */
export function extractTriangles(geometry: BufferGeometry): {
  triangles: Uint32Array;
  positions: Float32Array;
  triangleCount: number;
} {
  const posAttr = geometry.attributes.position;
  if (!posAttr) {
    return { triangles: new Uint32Array(0), positions: new Float32Array(0), triangleCount: 0 };
  }
  // BVH 当前仅消费 compact Float32Array position(下游 getCentroid/AABB 按紧凑下标读);
  // interleaved 路径(buffer getter 返回共享整型 array)留待后续渲染器侧 interleaved 绑定时扩展。
  const positions = posAttr.array as Float32Array;
  const indexAttr = geometry.index;
  let triangles: Uint32Array;
  let triangleCount: number;
  if (indexAttr) {
    const ia = indexAttr.array as unknown as ArrayLike<number>;
    triangleCount = Math.floor(ia.length / 3);
    triangles = new Uint32Array(triangleCount * 3);
    for (let t = 0; t < triangleCount; t++) {
      triangles[t * 3] = ia[t * 3] | 0;
      triangles[t * 3 + 1] = ia[t * 3 + 1] | 0;
      triangles[t * 3 + 2] = ia[t * 3 + 2] | 0;
    }
  } else {
    triangleCount = Math.floor(posAttr.count / 3);
    triangles = new Uint32Array(triangleCount * 3);
    for (let t = 0; t < triangleCount; t++) {
      triangles[t * 3] = t * 3;
      triangles[t * 3 + 1] = t * 3 + 1;
      triangles[t * 3 + 2] = t * 3 + 2;
    }
  }
  return { triangles, positions, triangleCount };
}

/** 计算三角形 t 的质心,写入 target。 */
function computeCentroid(
  triangles: Uint32Array,
  positions: Float32Array,
  t: number,
  target: Vector3,
): Vector3 {
  const i0 = triangles[t * 3] * 3;
  const i1 = triangles[t * 3 + 1] * 3;
  const i2 = triangles[t * 3 + 2] * 3;
  target.set(
    (positions[i0] + positions[i1] + positions[i2]) / 3,
    (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3,
    (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3,
  );
  return target;
}

/** 计算三角形 t 的 AABB,写入 target。 */
function computeTriangleBounds(
  triangles: Uint32Array,
  positions: Float32Array,
  t: number,
  target: Box3,
): Box3 {
  const i0 = triangles[t * 3] * 3;
  const i1 = triangles[t * 3 + 1] * 3;
  const i2 = triangles[t * 3 + 2] * 3;
  target.makeEmpty();
  target.min.x = Math.min(positions[i0], positions[i1], positions[i2]);
  target.min.y = Math.min(positions[i0 + 1], positions[i1 + 1], positions[i2 + 1]);
  target.min.z = Math.min(positions[i0 + 2], positions[i1 + 2], positions[i2 + 2]);
  target.max.x = Math.max(positions[i0], positions[i1], positions[i2]);
  target.max.y = Math.max(positions[i0 + 1], positions[i1 + 1], positions[i2 + 1]);
  target.max.z = Math.max(positions[i0 + 2], positions[i1 + 2], positions[i2 + 2]);
  return target;
}

/** 选取质心包围盒最长的轴(0=x, 1=y, 2=z)。质心包围盒为空时返回 0。 */
function longestAxis(centroidBounds: Box3): number {
  const dx = centroidBounds.max.x - centroidBounds.min.x;
  const dy = centroidBounds.max.y - centroidBounds.min.y;
  const dz = centroidBounds.max.z - centroidBounds.min.z;
  if (dx >= dy && dx >= dz) return 0;
  if (dy >= dz) return 1;
  return 2;
}

/** 质心在某轴上的分量。axis: 0/1/2。 */
function centroidAxis(c: Vector3, axis: number): number {
  return axis === 0 ? c.x : axis === 1 ? c.y : c.z;
}

/** 取包围盒在指定轴上的分量。axis: 0/1/2。 */
function boundsAxis(b: Box3, axis: number, isMin: boolean): number {
  if (axis === 0) return isMin ? b.min.x : b.max.x;
  if (axis === 1) return isMin ? b.min.y : b.max.y;
  return isMin ? b.min.z : b.max.z;
}

/** 中位数分割(MIDDLE 策略):按最长轴质心包围盒中点划分。
 *  返回分割点索引(left 在此之前);若一侧为空则返回 null 触发退化回退。 */
function splitMiddle(
  triIndices: number[],
  start: number,
  end: number,
  triangles: Uint32Array,
  positions: Float32Array,
  centroidBounds: Box3,
  axis: number,
): number | null {
  const lo = boundsAxis(centroidBounds, axis, true);
  const hi = boundsAxis(centroidBounds, axis, false);
  const midpoint = (lo + hi) * 0.5;
  // 三指针分区:把质心 < midpoint 的挪到左侧,≥ midpoint 的挪到右侧。
  let left = start;
  for (let i = start; i < end; i++) {
    computeCentroid(triangles, positions, triIndices[i], _centroid);
    if (centroidAxis(_centroid, axis) < midpoint) {
      const tmp = triIndices[left];
      triIndices[left] = triIndices[i];
      triIndices[i] = tmp;
      left++;
    }
  }
  if (left === start || left === end) return null; // 退化:全部落在中点同侧
  return left;
}

/** 中位数索引分割(MEDIAN_AXIS 策略):按最长轴对质心排序后取中间索引。 */
function splitMedianAxis(
  triIndices: number[],
  start: number,
  end: number,
  triangles: Uint32Array,
  positions: Float32Array,
  axis: number,
): number {
  const sub = triIndices.slice(start, end);
  sub.sort((a, b) => {
    computeCentroid(triangles, positions, a, _centroid);
    const ca = centroidAxis(_centroid, axis);
    computeCentroid(triangles, positions, b, _centroid);
    const cb = centroidAxis(_centroid, axis);
    return ca - cb;
  });
  for (let i = 0; i < sub.length; i++) triIndices[start + i] = sub[i];
  const mid = start + (sub.length >> 1);
  return mid;
}

/** SAH 分箱分割:对当前 axis 计算 K 个 bin,取 SAH 代价最小的分裂点。
 *  返回 [leftCount, rightCount),若无有效分裂返回 null。 */
function splitSAH(
  triIndices: number[],
  start: number,
  end: number,
  triangles: Uint32Array,
  positions: Float32Array,
  centroidBounds: Box3,
  axis: number,
  binCount: number,
): number | null {
  const lo = boundsAxis(centroidBounds, axis, true);
  const hi = boundsAxis(centroidBounds, axis, false);
  const extent = hi - lo;
  if (extent <= 0) return null;
  const invExtent = binCount / extent;

  // 每 bin 维护:计数、AABB。
  const binMin = new Float32Array(binCount * 3);
  const binMax = new Float32Array(binCount * 3);
  const binCountArr = new Int32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    binMin[i * 3] = binMin[i * 3 + 1] = binMin[i * 3 + 2] = Infinity;
    binMax[i * 3] = binMax[i * 3 + 1] = binMax[i * 3 + 2] = -Infinity;
    binCountArr[i] = 0;
  }
  for (let i = start; i < end; i++) {
    computeCentroid(triangles, positions, triIndices[i], _centroid);
    const c = centroidAxis(_centroid, axis);
    let b = Math.floor((c - lo) * invExtent);
    if (b < 0) b = 0;
    if (b >= binCount) b = binCount - 1;
    binCountArr[b]++;
    computeTriangleBounds(triangles, positions, triIndices[i], _triBounds);
    const mn = _triBounds.min, mx = _triBounds.max;
    if (mn.x < binMin[b * 3]) binMin[b * 3] = mn.x;
    if (mn.y < binMin[b * 3 + 1]) binMin[b * 3 + 1] = mn.y;
    if (mn.z < binMin[b * 3 + 2]) binMin[b * 3 + 2] = mn.z;
    if (mx.x > binMax[b * 3]) binMax[b * 3] = mx.x;
    if (mx.y > binMax[b * 3 + 1]) binMax[b * 3 + 1] = mx.y;
    if (mx.z > binMax[b * 3 + 2]) binMax[b * 3 + 2] = mx.z;
  }

  // 从左到右扫描累积左半 AABB;从右到左扫描累积右半 AABB。
  const leftCount = new Int32Array(binCount);
  const leftArea = new Float32Array(binCount);
  const rightCount = new Int32Array(binCount);
  const rightArea = new Float32Array(binCount);
  let accCount = 0;
  const accMin = new Float32Array(3);
  const accMax = new Float32Array(3);
  accMin[0] = accMin[1] = accMin[2] = Infinity;
  accMax[0] = accMax[1] = accMax[2] = -Infinity;
  for (let i = 0; i < binCount - 1; i++) {
    accCount += binCountArr[i];
    if (binCountArr[i] > 0) {
      for (let k = 0; k < 3; k++) {
        if (binMin[i * 3 + k] < accMin[k]) accMin[k] = binMin[i * 3 + k];
        if (binMax[i * 3 + k] > accMax[k]) accMax[k] = binMax[i * 3 + k];
      }
    }
    leftCount[i] = accCount;
    leftArea[i] = accCount > 0
      ? 2 * ((accMax[0] - accMin[0]) * (accMax[1] - accMin[1])
        + (accMax[1] - accMin[1]) * (accMax[2] - accMin[2])
        + (accMax[2] - accMin[2]) * (accMax[0] - accMin[0]))
      : 0;
  }
  accCount = 0;
  accMin[0] = accMin[1] = accMin[2] = Infinity;
  accMax[0] = accMax[1] = accMax[2] = -Infinity;
  for (let i = binCount - 1; i > 0; i--) {
    accCount += binCountArr[i];
    if (binCountArr[i] > 0) {
      for (let k = 0; k < 3; k++) {
        if (binMin[i * 3 + k] < accMin[k]) accMin[k] = binMin[i * 3 + k];
        if (binMax[i * 3 + k] > accMax[k]) accMax[k] = binMax[i * 3 + k];
      }
    }
    rightCount[i] = accCount;
    rightArea[i] = accCount > 0
      ? 2 * ((accMax[0] - accMin[0]) * (accMax[1] - accMin[1])
        + (accMax[1] - accMin[1]) * (accMax[2] - accMin[2])
        + (accMax[2] - accMin[2]) * (accMax[0] - accMin[0]))
      : 0;
  }

  // 找到 SAH 代价最小的 bin 分裂点(splitAt 表示落入 bin < splitAt 的归左子树)。
  let bestCost = Infinity;
  let bestSplit = -1;
  for (let i = 1; i < binCount; i++) {
    if (leftCount[i - 1] === 0 || rightCount[i] === 0) continue;
    const cost = leftCount[i - 1] * leftArea[i - 1] + rightCount[i] * rightArea[i];
    if (cost < bestCost) {
      bestCost = cost;
      bestSplit = i;
    }
  }
  if (bestSplit < 0) return null;

  // 三指针分区:质心 axis 分量 < binSplitAt 归左,否则归右。
  const splitCentroid = lo + (bestSplit / binCount) * extent;
  let left = start;
  for (let i = start; i < end; i++) {
    computeCentroid(triangles, positions, triIndices[i], _centroid);
    if (centroidAxis(_centroid, axis) < splitCentroid) {
      const tmp = triIndices[left];
      triIndices[left] = triIndices[i];
      triIndices[i] = tmp;
      left++;
    }
  }
  if (left === start || left === end) return null;
  return left;
}

/** 递归构建 BVH 子树。triIndices[start..end) 为当前节点持有三角形索引集合。 */
function buildRecursive(
  triIndices: number[],
  start: number,
  end: number,
  triangles: Uint32Array,
  positions: Float32Array,
  depth: number,
  maxDepth: number,
  maxLeafSize: number,
  strategy: BVHBuildStrategy,
  sahBinCount: number,
): BVHNode {
  const node = new BVHNode(depth);
  const count = end - start;

  // 节点 bounds = 子树所有三角形 AABB 的并集。
  node.bounds.makeEmpty();
  _centroidBounds.makeEmpty();
  for (let i = start; i < end; i++) {
    computeTriangleBounds(triangles, positions, triIndices[i], _triBounds);
    node.bounds.union(_triBounds);
    computeCentroid(triangles, positions, triIndices[i], _centroid);
    _centroidBounds.expandByPoint(_centroid);
  }

  // 叶子判定:数量 ≤ maxLeafSize、已达最大深度、或质心重合无法继续分割。
  if (count <= maxLeafSize || depth >= maxDepth) {
    node.triangles = triIndices.slice(start, end);
    return node;
  }

  const axis = longestAxis(_centroidBounds);
  let splitAt: number | null = null;

  if (strategy === BVHBuildStrategy.MIDDLE) {
    splitAt = splitMiddle(triIndices, start, end, triangles, positions, _centroidBounds, axis);
    if (splitAt === null) {
      // MIDDLE 退化时回退到 MEDIAN_AXIS
      splitAt = splitMedianAxis(triIndices, start, end, triangles, positions, axis);
    }
  } else if (strategy === BVHBuildStrategy.MEDIAN_AXIS) {
    splitAt = splitMedianAxis(triIndices, start, end, triangles, positions, axis);
  } else {
    // SAH:对所有 3 个轴尝试,取代价最小者
    let bestAxis = axis;
    let bestSplit: number | null = null;
    for (let a = 0; a < 3; a++) {
      // 重新计算当前轴的质心包围盒(每轮 union 后保持不变,但保险起见每轴都试)
      _centroidBounds.makeEmpty();
      for (let i = start; i < end; i++) {
        computeCentroid(triangles, positions, triIndices[i], _centroid);
        _centroidBounds.expandByPoint(_centroid);
      }
      const s = splitSAH(triIndices, start, end, triangles, positions, _centroidBounds, a, sahBinCount);
      if (s !== null) {
        bestSplit = s;
        bestAxis = a;
        break; // 第一个有效轴即用;更彻底的实现会比较所有轴的 cost
      }
    }
    if (bestSplit === null) {
      // SAH 全部退化时回退到 MEDIAN_AXIS
      splitAt = splitMedianAxis(triIndices, start, end, triangles, positions, bestAxis);
    } else {
      splitAt = bestSplit;
    }
  }

  node.left = buildRecursive(
    triIndices, start, splitAt, triangles, positions,
    depth + 1, maxDepth, maxLeafSize, strategy, sahBinCount,
  );
  node.right = buildRecursive(
    triIndices, splitAt, end, triangles, positions,
    depth + 1, maxDepth, maxLeafSize, strategy, sahBinCount,
  );
  return node;
}

/** 从 BufferGeometry 构建 BVH。返回根节点与三角形数据。 */
export function buildBVH(geometry: BufferGeometry, options: BVHBuildOptions = {}): BVHBuildResult {
  const maxLeafSize = options.maxLeafSize ?? 8;
  const maxDepth = options.maxDepth ?? 32;
  const strategy = options.strategy ?? BVHBuildStrategy.MIDDLE;
  const sahBinCount = options.sahBinCount ?? 12;

  const { triangles, positions, triangleCount } = extractTriangles(geometry);
  if (triangleCount === 0) {
    return { root: null, triangles, positions, triangleCount };
  }

  const triIndices: number[] = new Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) triIndices[i] = i;

  const root = buildRecursive(
    triIndices, 0, triangleCount, triangles, positions,
    0, maxDepth, maxLeafSize, strategy, sahBinCount,
  );
  return { root, triangles, positions, triangleCount };
}

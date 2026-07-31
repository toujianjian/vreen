// SimplifyModifier — 简化修饰器,从 three.js SimplifyModifier 移植并适配 VREEN 引擎。
// 通过边折叠 (edge collapse) 减少几何体顶点数。
//
// 这是简化版实现 (非完整 QEM/quadric error metric):
//   1. 收集所有唯一边并按长度升序排序。
//   2. 依次折叠最短边 (用并查集合并顶点),直到顶点数降至目标比例。
//   3. 跳过受保护顶点 (边界 / UV 接缝)。
//   4. 重映射索引,剔除退化面 (折叠后两顶点相同),压缩顶点缓冲。
//
// 参考: three.js/examples/jsm/modifiers/SimplifyModifier.js (Melax 渐进网格算法的简化版)

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 简化选项。 */
export interface SimplifyOptions {
  /** 保留顶点的目标比例 (0..1,默认 0.5 = 保留一半顶点)。 */
  ratio?: number;
  /** 若为 true,保留边界顶点 (默认 true)。 */
  preserveBoundaries?: boolean;
  /** 若为 true,保留 UV 接缝顶点 (默认 true)。 */
  preserveUVSeams?: boolean;
}

/**
 * 通过最短边折叠简化几何体。返回一个新的 BufferGeometry,原几何体不变。
 *
 * 简化算法:
 *   1. 提取顶点 + 索引。
 *   2. 目标顶点数 = floor(总顶点数 * ratio)。
 *   3. 收集唯一边并按长度升序排序,依次折叠 (并查集合并)。
 *   4. 跳过边界顶点 (preserveBoundaries) / UV 不同的边 (preserveUVSeams)。
 *   5. 重映射索引,剔除退化面,压缩顶点。
 */
export class SimplifyModifier {
  readonly ratio: number;
  readonly preserveBoundaries: boolean;
  readonly preserveUVSeams: boolean;

  constructor(options: SimplifyOptions = {}) {
    this.ratio = Math.max(0, Math.min(1, options.ratio ?? 0.5));
    this.preserveBoundaries = options.preserveBoundaries ?? true;
    this.preserveUVSeams = options.preserveUVSeams ?? true;
  }

  /** 对 geometry 应用简化。返回一个新的 BufferGeometry,原几何体不变。 */
  modify(geometry: BufferGeometry): BufferGeometry {
    const posAttr = geometry.getAttribute('position');
    const result = new BufferGeometry();
    if (!posAttr) return result;

    const pa = posAttr.array;
    const vc = posAttr.count;
    const uvAttr = geometry.getAttribute('uv');
    const ua = uvAttr ? uvAttr.array : null;

    // 构建索引数组 (三角形)
    let indices: number[];
    const idx = geometry.index;
    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      indices = Array.from(ia);
    } else {
      indices = [];
      for (let i = 0; i < vc; i++) indices.push(i);
    }

    const targetCount = Math.floor(vc * this.ratio);

    // 无需简化 → 返回数据相同的副本
    if (targetCount >= vc) {
      return cloneGeometry(geometry);
    }

    // 收集唯一边。键 = min*vc + max (vc 合理大小时安全)
    const edgeSet = new Set<number>();
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      addUniqueEdge(edgeSet, edges, a, b, vc);
      addUniqueEdge(edgeSet, edges, b, c, vc);
      addUniqueEdge(edgeSet, edges, a, c, vc);
    }

    // 边界顶点:被恰好 1 个面共享的边的端点
    let isBoundary: Uint8Array | null = null;
    if (this.preserveBoundaries) {
      isBoundary = computeBoundaries(indices, vc);
    }

    // 按边长升序排序
    edges.sort((e1, e2) => edgeLengthSq(e1, pa) - edgeLengthSq(e2, pa));

    // 并查集
    const parent = new Int32Array(vc);
    for (let i = 0; i < vc; i++) parent[i] = i;
    const find = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      while (parent[x] !== r) {
        const next = parent[x];
        parent[x] = r;
        x = next;
      }
      return r;
    };

    let currentCount = vc;
    const uvEps = 1e-6;
    for (const [aRaw, bRaw] of edges) {
      if (currentCount <= targetCount) break;
      const ra = find(aRaw);
      const rb = find(bRaw);
      if (ra === rb) continue;

      // 边界保护
      if (isBoundary && (isBoundary[ra] === 1 || isBoundary[rb] === 1)) continue;

      // UV 接缝保护:两端点 UV 不同则不折叠
      if (this.preserveUVSeams && ua) {
        if (!uvEqual(ua, ra, rb, uvEps)) continue;
      }

      // 合并 ra → rb (保留 rb 位置)
      parent[ra] = rb;
      currentCount--;
    }

    // 重映射索引,剔除退化面
    const newIndices: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const ra = find(indices[i]);
      const rb = find(indices[i + 1]);
      const rc = find(indices[i + 2]);
      if (ra === rb || rb === rc || ra === rc) continue;
      newIndices.push(ra, rb, rc);
    }

    // 压缩:仅保留仍在使用的根顶点
    const used = new Set<number>();
    for (const i of newIndices) used.add(i);
    const sortedUsed = Array.from(used).sort((a, b) => a - b);
    const remap = new Map<number, number>();
    sortedUsed.forEach((v, i) => remap.set(v, i));

    const finalPositions: number[] = [];
    const finalUvs: number[] = [];
    for (const v of sortedUsed) {
      finalPositions.push(pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]);
      if (ua) finalUvs.push(ua[v * 2], ua[v * 2 + 1]);
    }
    const finalIndices = newIndices.map((i) => remap.get(i)!);

    result.setAttribute('position', new BufferAttribute(new Float32Array(finalPositions), 3));
    if (ua) {
      result.setAttribute('uv', new BufferAttribute(new Float32Array(finalUvs), 2));
    }
    result.setIndex(finalIndices);
    result.computeVertexNormals();
    result.computeBoundingBox();
    return result;
  }
}

/** 添加唯一边 (小端在前)。 */
function addUniqueEdge(
  edgeSet: Set<number>,
  edges: Array<[number, number]>,
  a: number,
  b: number,
  vc: number,
): void {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  const key = lo * vc + hi;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push([lo, hi]);
}

/** 边长度平方。 */
function edgeLengthSq(edge: [number, number], pa: ArrayLike<number>): number {
  const a = edge[0], b = edge[1];
  const dx = pa[a * 3] - pa[b * 3];
  const dy = pa[a * 3 + 1] - pa[b * 3 + 1];
  const dz = pa[a * 3 + 2] - pa[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/** 计算边界顶点:被恰好 1 个面共享的边的端点标记为边界。 */
function computeBoundaries(indices: number[], vc: number): Uint8Array {
  const edgeCount = new Map<number, number>();
  const count = (a: number, b: number): void => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * vc + hi;
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  };
  for (let i = 0; i < indices.length; i += 3) {
    count(indices[i], indices[i + 1]);
    count(indices[i + 1], indices[i + 2]);
    count(indices[i], indices[i + 2]);
  }
  const isBoundary = new Uint8Array(vc);
  for (const [key, c] of edgeCount) {
    if (c === 1) {
      const lo = Math.floor(key / vc);
      const hi = key - lo * vc;
      isBoundary[lo] = 1;
      isBoundary[hi] = 1;
    }
  }
  return isBoundary;
}

/** 两顶点 UV 是否相同 (在容差内)。 */
function uvEqual(ua: ArrayLike<number>, a: number, b: number, eps: number): boolean {
  const dx = ua[a * 2] - ua[b * 2];
  const dy = ua[a * 2 + 1] - ua[b * 2 + 1];
  return Math.abs(dx) <= eps && Math.abs(dy) <= eps;
}

/** 复制几何体 (position / normal / uv / index),不共享数组。 */
function cloneGeometry(geometry: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attr = geometry.getAttribute(name);
    if (attr) {
      out.setAttribute(name, new BufferAttribute(new Float32Array(attr.array), attr.itemSize));
    }
  }
  const idx = geometry.index;
  if (idx) {
    const src = idx.array as unknown as ArrayLike<number>;
    const copy: number[] = [];
    for (let i = 0; i < src.length; i++) copy.push(src[i]);
    out.setIndex(copy);
  }
  if (geometry.boundingBox) {
    out.computeBoundingBox();
  }
  return out;
}

// EdgeSplitModifier — 边分裂修饰器,在硬边处分裂顶点以产生锐利法线。
//
// 适配 three.js EdgeSplitModifier。
// 用途: 网格中相邻面的法线夹角超过阈值时,在共享边上分裂顶点 (复制顶点),
//   使每个面拥有独立的法线,从而渲染出硬边 (hard edge)。
//   常用于:
//     - 低多边形模型的硬表面渲染 (机械 / 建筑)
//     - 修复平滑法线导致的棱角丢失
//     - 为 SubdivisionModifier 输出添加硬边
//
// 算法:
//   1. 计算每个面的法线。
//   2. 构建边邻接: edge (a,b) → 相邻面列表。
//   3. 对每条共享边,计算两相邻面法线的夹角;
//      若 > threshold (弧度),标记为 "sharp edge"。
//   4. 对每个顶点 v:
//      a. 收集 v 的所有相邻面。
//      b. 在这些面之间构建图: 两面共享 v 上的一条非 sharp 边 → 连通。
//      c. 找连通分量 (groups)。
//      d. 若 > 1 个 group,为每个额外 group 复制顶点 v (位置 / UV 相同)。
//   5. 重映射面索引:每个面使用其所属 group 对应的顶点副本。
//   6. 重新计算法线:每个 group 内的面法线平均 (平滑组法线)。
//
// 不变量:
//   - modify 不修改输入 geometry,返回新 BufferGeometry;
//   - threshold=0 → 所有边都分裂 (类似 flat shading);
//   - threshold=π → 不分裂 (类似 smooth shading);
//   - 输出始终为索引化 (即使输入非索引);
//   - UV 属性被保留并复制到对应顶点副本。
//
// 参考:
//   - three.js examples/jsm/modifiers/EdgeSplitModifier.js
//   - Blender "Edge Split" modifier
//   - o3de Mesh Edge Smoothing

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math/Vector3';

/** 边分裂选项。 */
export interface EdgeSplitOptions {
  /** 面法线夹角阈值 (弧度,默认 π/6 ≈ 30°)。超过此值的边将被分裂。 */
  threshold?: number;
  /** 是否保留原有法线 (默认 false,即重新计算分组平滑法线)。 */
  keepExistingNormals?: boolean;
}

/** 边的键: `${min},${max}`。 */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

// 临时向量
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

/**
 * 边分裂修饰器。
 *
 * 用法:
 * ```ts
 * const es = new EdgeSplitModifier({ threshold: Math.PI / 6 });
 * const hard = es.modify(smoothGeometry);
 * // 阈值 30° 以上的边变为硬边
 * ```
 */
export class EdgeSplitModifier {
  readonly threshold: number;
  readonly keepExistingNormals: boolean;

  constructor(opts: EdgeSplitOptions = {}) {
    this.threshold = Math.max(0, Math.min(Math.PI, opts.threshold ?? Math.PI / 6));
    this.keepExistingNormals = opts.keepExistingNormals ?? false;
  }

  /** 对 geometry 应用边分裂。返回新 BufferGeometry,原几何体不变。 */
  modify(geometry: BufferGeometry): BufferGeometry {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) throw new Error('EdgeSplitModifier: geometry missing position attribute');

    // 强制索引化
    const indexed = ensureIndexed(geometry);
    const positions = indexed.getAttribute('position')!.array as ArrayLike<number>;
    const uvAttr = indexed.getAttribute('uv');
    const uvs = uvAttr ? (uvAttr.array as ArrayLike<number>) : null;
    const itemSize = posAttr.itemSize;
    const uvItemSize = uvAttr ? uvAttr.itemSize : 0;
    const indices = indexed.index!.array as ArrayLike<number>;
    const faceCount = indices.length / 3;
    const vertexCount = posAttr.count;

    // ── 1. 计算面法线 ───────────────────────────────────────────────
    const faceNormals = new Float32Array(faceCount * 3);
    for (let f = 0; f < faceCount; f++) {
      const i0 = indices[f * 3] as number;
      const i1 = indices[f * 3 + 1] as number;
      const i2 = indices[f * 3 + 2] as number;
      _v1.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
      _v2.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
      _v3.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
      _v2.sub(_v1); // edge1
      _v3.sub(_v1); // edge2
      _v2.cross(_v3).normalize();
      faceNormals[f * 3] = _v2.x;
      faceNormals[f * 3 + 1] = _v2.y;
      faceNormals[f * 3 + 2] = _v2.z;
    }

    // ── 2. 构建边邻接 + 标记 sharp 边 ───────────────────────────────
    const edgeFaces = new Map<string, number[]>(); // edgeKey → [face indices]
    for (let f = 0; f < faceCount; f++) {
      const i0 = indices[f * 3] as number;
      const i1 = indices[f * 3 + 1] as number;
      const i2 = indices[f * 3 + 2] as number;
      for (const [a, b] of [
        [i0, i1],
        [i1, i2],
        [i2, i0],
      ] as const) {
        const key = edgeKey(a, b);
        let list = edgeFaces.get(key);
        if (!list) {
          list = [];
          edgeFaces.set(key, list);
        }
        list.push(f);
      }
    }

    // 标记 sharp 边 (存入 Set)
    const sharpEdges = new Set<string>();
    for (const [key, faces] of edgeFaces) {
      if (faces.length !== 2) continue; // 边界边或非流形,跳过
      const f0 = faces[0];
      const f1 = faces[1];
      // 计算两面法线的夹角
      _v1.set(faceNormals[f0 * 3], faceNormals[f0 * 3 + 1], faceNormals[f0 * 3 + 2]);
      _v2.set(faceNormals[f1 * 3], faceNormals[f1 * 3 + 1], faceNormals[f1 * 3 + 2]);
      const dot = Math.max(-1, Math.min(1, _v1.dot(_v2)));
      const angle = Math.acos(dot);
      if (angle > this.threshold) {
        sharpEdges.add(key);
      }
    }

    // ── 3. 为每个顶点找相邻面 + 构建面邻接图 (基于非 sharp 边) ──────
    const vertexFaces = new Map<number, number[]>();
    for (let f = 0; f < faceCount; f++) {
      for (let i = 0; i < 3; i++) {
        const v = indices[f * 3 + i] as number;
        let list = vertexFaces.get(v);
        if (!list) {
          list = [];
          vertexFaces.set(v, list);
        }
        if (!list.includes(f)) list.push(f);
      }
    }

    // 对每个顶点,在其相邻面之间构建连通分量
    // 两面连通 = 共享该顶点上的一条非 sharp 边
    // 返回: vertexFaceGroup[v] = Map<faceIndex, groupIndex>
    const vertexFaceGroup = new Map<number, Map<number, number>>();
    for (let v = 0; v < vertexCount; v++) {
      const faces = vertexFaces.get(v);
      if (!faces || faces.length <= 1) {
        // 单面或无面,不需要分裂
        const groupMap = new Map<number, number>();
        if (faces && faces.length === 1) groupMap.set(faces[0], 0);
        vertexFaceGroup.set(v, groupMap);
        continue;
      }

      // 构建面之间的邻接图 (在该顶点处共享非 sharp 边)
      // facePairs: 对于每对面,如果它们共享该顶点上的一条非 sharp 边,则连通
      const faceSet = new Set(faces);
      const adj = new Map<number, number[]>();
      for (const f of faces) adj.set(f, []);

      // 遍历该顶点的所有边 (从面中提取)
      // 对于每条包含 v 的边,检查是否为非 sharp 边
      const vEdges = new Map<string, number[]>(); // edgeKey → [faces containing v on this edge]
      for (const f of faces) {
        const i0 = indices[f * 3] as number;
        const i1 = indices[f * 3 + 1] as number;
        const i2 = indices[f * 3 + 2] as number;
        // 找到该面中 v 的位置,提取两条包含 v 的边
        const verts = [i0, i1, i2];
        for (let i = 0; i < 3; i++) {
          if (verts[i] === v) {
            const next = verts[(i + 1) % 3];
            const prev = verts[(i + 2) % 3];
            const k1 = edgeKey(v, next);
            const k2 = edgeKey(v, prev);
            let l1 = vEdges.get(k1);
            if (!l1) {
              l1 = [];
              vEdges.set(k1, l1);
            }
            if (!l1.includes(f)) l1.push(f);
            let l2 = vEdges.get(k2);
            if (!l2) {
              l2 = [];
              vEdges.set(k2, l2);
            }
            if (!l2.includes(f)) l2.push(f);
          }
        }
      }

      // 对每条非 sharp 边,连通其相邻面
      for (const [key, fs] of vEdges) {
        if (sharpEdges.has(key)) continue; // sharp 边不连通
        if (fs.length < 2) continue;
        for (let i = 0; i < fs.length; i++) {
          for (let j = i + 1; j < fs.length; j++) {
            adj.get(fs[i])!.push(fs[j]);
            adj.get(fs[j])!.push(fs[i]);
          }
        }
      }

      // BFS 找连通分量
      const groupMap = new Map<number, number>();
      let groupIdx = 0;
      const visited = new Set<number>();
      for (const f of faces) {
        if (visited.has(f)) continue;
        // BFS
        const queue = [f];
        visited.add(f);
        while (queue.length > 0) {
          const cur = queue.shift()!;
          groupMap.set(cur, groupIdx);
          for (const neighbor of adj.get(cur) ?? []) {
            if (!visited.has(neighbor) && faceSet.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        groupIdx++;
      }
      vertexFaceGroup.set(v, groupMap);
    }

    // ── 4. 构建新顶点数组 (为每个 group 分配顶点副本) ────────────────
    // 顶点副本索引: 对原顶点 v 的 group g,新索引 = vertexRemap[v][g]
    const vertexRemap = new Map<number, Map<number, number>>();
    const newPositions: number[] = [];
    const newUvs: number[] = [];
    let newVertexCount = 0;

    for (let v = 0; v < vertexCount; v++) {
      const groupMap = vertexFaceGroup.get(v)!;
      const groups = new Set(groupMap.values());
      const remap = new Map<number, number>();
      for (const g of groups) {
        // 复制顶点位置
        for (let c = 0; c < itemSize; c++) {
          newPositions.push(positions[v * itemSize + c]);
        }
        if (uvs) {
          for (let c = 0; c < uvItemSize; c++) {
            newUvs.push(uvs[v * uvItemSize + c]);
          }
        }
        remap.set(g, newVertexCount);
        newVertexCount++;
      }
      vertexRemap.set(v, remap);
    }

    // ── 5. 重映射面索引 ─────────────────────────────────────────────
    const newIndices: number[] = [];
    for (let f = 0; f < faceCount; f++) {
      const i0 = indices[f * 3] as number;
      const i1 = indices[f * 3 + 1] as number;
      const i2 = indices[f * 3 + 2] as number;
      const g0 = vertexFaceGroup.get(i0)!.get(f)!;
      const g1 = vertexFaceGroup.get(i1)!.get(f)!;
      const g2 = vertexFaceGroup.get(i2)!.get(f)!;
      newIndices.push(
        vertexRemap.get(i0)!.get(g0)!,
        vertexRemap.get(i1)!.get(g1)!,
        vertexRemap.get(i2)!.get(g2)!,
      );
    }

    // ── 6. 计算每个新顶点的法线 (其所属 group 内面法线的平均) ────────
    const newNormals = new Float32Array(newVertexCount * 3);
    const groupFaceCounts = new Map<number, number>(); // newVertexIdx → face count

    for (let f = 0; f < faceCount; f++) {
      const i0 = indices[f * 3] as number;
      const i1 = indices[f * 3 + 1] as number;
      const i2 = indices[f * 3 + 2] as number;
      const g0 = vertexFaceGroup.get(i0)!.get(f)!;
      const g1 = vertexFaceGroup.get(i1)!.get(f)!;
      const g2 = vertexFaceGroup.get(i2)!.get(f)!;
      const nv0 = vertexRemap.get(i0)!.get(g0)!;
      const nv1 = vertexRemap.get(i1)!.get(g1)!;
      const nv2 = vertexRemap.get(i2)!.get(g2)!;

      const fn0 = faceNormals[f * 3];
      const fn1 = faceNormals[f * 3 + 1];
      const fn2 = faceNormals[f * 3 + 2];

      newNormals[nv0 * 3] += fn0;
      newNormals[nv0 * 3 + 1] += fn1;
      newNormals[nv0 * 3 + 2] += fn2;
      newNormals[nv1 * 3] += fn0;
      newNormals[nv1 * 3 + 1] += fn1;
      newNormals[nv1 * 3 + 2] += fn2;
      newNormals[nv2 * 3] += fn0;
      newNormals[nv2 * 3 + 1] += fn1;
      newNormals[nv2 * 3 + 2] += fn2;

      groupFaceCounts.set(nv0, (groupFaceCounts.get(nv0) ?? 0) + 1);
      groupFaceCounts.set(nv1, (groupFaceCounts.get(nv1) ?? 0) + 1);
      groupFaceCounts.set(nv2, (groupFaceCounts.get(nv2) ?? 0) + 1);
    }

    // 归一化
    for (let v = 0; v < newVertexCount; v++) {
      const x = newNormals[v * 3];
      const y = newNormals[v * 3 + 1];
      const z = newNormals[v * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      newNormals[v * 3] = x / len;
      newNormals[v * 3 + 1] = y / len;
      newNormals[v * 3 + 2] = z / len;
    }

    // ── 7. 构建 BufferGeometry ──────────────────────────────────────
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(new Float32Array(newPositions), itemSize));
    result.setAttribute('normal', new BufferAttribute(newNormals, 3));
    if (newUvs.length > 0) {
      result.setAttribute('uv', new BufferAttribute(new Float32Array(newUvs), uvItemSize));
    }
    result.setIndex(newIndices);
    result.groups = geometry.groups.map((g) => ({ ...g }));
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────────

/** 确保几何体为索引化 (非索引则构建连续索引)。返回新几何体或原几何体。 */
function ensureIndexed(geometry: BufferGeometry): BufferGeometry {
  if (geometry.index) return geometry;
  const pos = geometry.getAttribute('position');
  if (!pos) return geometry;
  const indices = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) indices[i] = i;
  const cloned = geometry.clone();
  cloned.setIndex(new BufferAttribute(indices, 1));
  return cloned;
}

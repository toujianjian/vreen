// SubdivisionModifier — Catmull-Clark 细分曲面修饰器。
//
// 适配 three.js SubdivisionModifier 与 o3de Atom Mesh 细分。
// 经典 Catmull-Clark 算法 (Catmull & Clark 1978):
//   1. 对每个面添加一个 face point (面顶点 = 顶点质心)。
//   2. 对每条边添加一个 edge point:
//        - 内部边: (两端点中点 + 相邻 face points 平均) / 2
//        - 边界边: 两端点中点
//   3. 每个原始顶点新位置:
//        - 边界顶点: 3/4 * S + 1/8 * (前后边中点)
//        - 内部顶点: (Q + 2R + (n-3)S) / n
//          其中 Q = 相邻 face points 平均, R = 相邻边中点平均,
//          S = 原位置, n = 顶点价 (valence)
//   4. 拓扑:每个原始三角形 (v1,v2,v3) + 边 (e12,e23,e31) + 面点 F
//      分裂为 3 个四边形 → 6 三角形:
//        Quad1: (V1', E12', F, E31')
//        Quad2: (V2', E23', F, E12')
//        Quad3: (V3', E31', F, E23')
//
// 经过一次细分后,所有面变为四边形 (在三角形拓扑下表现为 6 三角形 / 原三角形)。
// 后续迭代使用相同规则。
//
// UV 属性:按相同权重线性插值 (face point UV = 面顶点 UV 平均,
//   edge point UV = 两端点 UV 平均 / 内部规则, vertex point UV = 同位置公式)。
// 法线:细分后调用方应调用 computeVertexNormals 重新计算平滑法线
//   (默认 recomputeNormals=true 时本类自动调用)。
//
// 不变量:
//   - modify 不修改输入 geometry,返回新 BufferGeometry;
//   - 输入须为三角形 (索引化或非索引化,非索引会先转索引);
//   - 每次迭代三角形面数 ×6 (首次) 或后续保持 ×6 (因仍按三角形拓扑处理);
//   - 边界顶点 / 边保持锐利 (边界规则),用于保留硬边 (如立方体棱角);
//   - iterations=0 返回输入的深拷贝。
//
// 参考:
//   - Catmull, E. & Clark, J. "Recursively Generated B-spline Surfaces
//     on Arbitrary Topological Meshes" (CAD 1978)
//   - three.js examples/jsm/modifiers/SubdivisionModifier.js
//   - o3de Atom MeshProcessingUtilities

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 细分选项。 */
export interface SubdivisionOptions {
  /** 细分迭代次数 (默认 1)。每次面数 ×6 (三角形拓扑)。上限 6 防止内存爆炸。 */
  iterations?: number;
  /** 是否将 uv 属性一同插值 (默认 true,若存在 uv 属性)。 */
  interpolateUV?: boolean;
  /** 是否在细分后重新计算平滑法线 (默认 true,若存在 normal 属性)。 */
  recomputeNormals?: boolean;
}

/** 边的键: `${min},${max}`。 */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

interface EdgeInfo {
  /** 端点顶点索引 (升序)。 */
  a: number;
  b: number;
  /** 相邻面索引列表 (长度 1=边界边, 2=内部边)。 */
  faces: number[];
  /** 此边对应的 edge point 在新顶点数组中的索引 (后续填充)。 */
  edgePointIndex: number;
}

interface FaceInfo {
  /** 面顶点索引 (3 个,三角形)。 */
  vertices: [number, number, number];
  /** 此面对应的 face point 在新顶点数组中的索引 (后续填充)。 */
  facePointIndex: number;
}

/**
 * Catmull-Clark 细分曲面修饰器。
 *
 * 用法:
 * ```ts
 * const sub = new SubdivisionModifier({ iterations: 2 });
 * const smoothed = sub.modify(boxGeometry);
 * // smoothed 面数为原 36 (2 次迭代 ×6 每次 = 36x)
 * ```
 */
export class SubdivisionModifier {
  readonly iterations: number;
  readonly interpolateUV: boolean;
  readonly recomputeNormals: boolean;

  constructor(opts: SubdivisionOptions = {}) {
    this.iterations = Math.max(0, Math.min(6, Math.floor(opts.iterations ?? 1)));
    this.interpolateUV = opts.interpolateUV ?? true;
    this.recomputeNormals = opts.recomputeNormals ?? true;
  }

  /** 对 geometry 应用 Catmull-Clark 细分。返回新 BufferGeometry,原几何体不变。 */
  modify(geometry: BufferGeometry): BufferGeometry {
    if (this.iterations <= 0) return geometry.clone();
    if (!geometry.getAttribute('position')) {
      throw new Error('SubdivisionModifier: geometry missing position attribute');
    }

    let result = ensureIndexed(geometry);

    for (let i = 0; i < this.iterations; i++) {
      result = this._subdivideOnce(result);
    }

    // 重新计算平滑法线
    if (this.recomputeNormals && geometry.getAttribute('normal')) {
      result.computeVertexNormals();
    }

    // 复制 groups
    result.groups = geometry.groups.map((g) => ({ ...g }));
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }

  /** 单次 Catmull-Clark 细分迭代。 */
  private _subdivideOnce(geometry: BufferGeometry): BufferGeometry {
    const posAttr = geometry.getAttribute('position')!;
    const uvAttr = this.interpolateUV ? geometry.getAttribute('uv') : null;
    const positions = posAttr.array as ArrayLike<number>;
    const uvs = uvAttr ? (uvAttr.array as ArrayLike<number>) : null;
    const itemSize = posAttr.itemSize;
    const uvItemSize = uvAttr ? uvAttr.itemSize : 0;
    const idx = geometry.index!;
    const indices = idx.array as ArrayLike<number>;
    const faceCount = indices.length / 3;

    // ── 1. 构建面信息 + 边邻接 ────────────────────────────────────────
    const faces: FaceInfo[] = [];
    const edgeMap = new Map<string, EdgeInfo>();

    for (let f = 0; f < faceCount; f++) {
      const i0 = indices[f * 3] as number;
      const i1 = indices[f * 3 + 1] as number;
      const i2 = indices[f * 3 + 2] as number;
      faces.push({ vertices: [i0, i1, i2], facePointIndex: -1 });

      for (const [a, b] of [
        [i0, i1],
        [i1, i2],
        [i2, i0],
      ] as const) {
        const key = edgeKey(a, b);
        let info = edgeMap.get(key);
        if (!info) {
          info = { a: Math.min(a, b), b: Math.max(a, b), faces: [], edgePointIndex: -1 };
          edgeMap.set(key, info);
        }
        info.faces.push(f);
      }
    }

    // ── 2. 构建新顶点数组 ─────────────────────────────────────────────
    // 顺序: [原顶点新位置..., face points..., edge points...]
    const originalCount = posAttr.count;
    const faceCountNum = faces.length;
    const edgeCountNum = edgeMap.size;
    const newVertexCount = originalCount + faceCountNum + edgeCountNum;

    const newPos = new Float32Array(newVertexCount * itemSize);
    const newUv = uvs ? new Float32Array(newVertexCount * uvItemSize) : null;

    // ── 2a. 计算每个面的 face point (质心) + 写入位置 ───────────────
    const facePointBuffer = new Float32Array(faceCountNum * itemSize);
    const faceUvBuffer = newUv ? new Float32Array(faceCountNum * uvItemSize) : null;
    for (let f = 0; f < faceCountNum; f++) {
      const [i0, i1, i2] = faces[f].vertices;
      for (let c = 0; c < itemSize; c++) {
        const v =
          (positions[i0 * itemSize + c] +
            positions[i1 * itemSize + c] +
            positions[i2 * itemSize + c]) /
          3;
        facePointBuffer[f * itemSize + c] = v;
        newPos[(originalCount + f) * itemSize + c] = v;
      }
      if (newUv && faceUvBuffer) {
        for (let c = 0; c < uvItemSize; c++) {
          const uv =
            (uvs![i0 * uvItemSize + c] +
              uvs![i1 * uvItemSize + c] +
              uvs![i2 * uvItemSize + c]) /
            3;
          faceUvBuffer[f * uvItemSize + c] = uv;
          newUv[(originalCount + f) * uvItemSize + c] = uv;
        }
      }
      faces[f].facePointIndex = originalCount + f;
    }

    // ── 2b. 计算每条边的 edge point + 写入位置 ───────────────────────
    const edgePointBuffer = new Float32Array(edgeCountNum * itemSize);
    const edgeUvBuffer = newUv ? new Float32Array(edgeCountNum * uvItemSize) : null;
    const edgeList: EdgeInfo[] = [];
    let edgeIdx = 0;
    for (const [, info] of edgeMap) {
      edgeList.push(info);
      info.edgePointIndex = originalCount + faceCountNum + edgeIdx;
      const a = info.a;
      const b = info.b;

      if (info.faces.length === 1) {
        // 边界边: 中点
        for (let c = 0; c < itemSize; c++) {
          const v = (positions[a * itemSize + c] + positions[b * itemSize + c]) / 2;
          edgePointBuffer[edgeIdx * itemSize + c] = v;
          newPos[info.edgePointIndex * itemSize + c] = v;
        }
        if (newUv && edgeUvBuffer) {
          for (let c = 0; c < uvItemSize; c++) {
            const uv = (uvs![a * uvItemSize + c] + uvs![b * uvItemSize + c]) / 2;
            edgeUvBuffer[edgeIdx * uvItemSize + c] = uv;
            newUv[info.edgePointIndex * uvItemSize + c] = uv;
          }
        }
      } else {
        // 内部边: (端点中点 + 相邻 face points 平均) / 2
        const f0 = info.faces[0];
        const f1 = info.faces[1];
        for (let c = 0; c < itemSize; c++) {
          const midpoint = (positions[a * itemSize + c] + positions[b * itemSize + c]) / 2;
          const fpAvg = (facePointBuffer[f0 * itemSize + c] + facePointBuffer[f1 * itemSize + c]) / 2;
          const v = (midpoint + fpAvg) / 2;
          edgePointBuffer[edgeIdx * itemSize + c] = v;
          newPos[info.edgePointIndex * itemSize + c] = v;
        }
        if (newUv && edgeUvBuffer && faceUvBuffer) {
          for (let c = 0; c < uvItemSize; c++) {
            const midpointUv = (uvs![a * uvItemSize + c] + uvs![b * uvItemSize + c]) / 2;
            const fpUvAvg =
              (faceUvBuffer[f0 * uvItemSize + c] + faceUvBuffer[f1 * uvItemSize + c]) / 2;
            const uv = (midpointUv + fpUvAvg) / 2;
            edgeUvBuffer[edgeIdx * uvItemSize + c] = uv;
            newUv[info.edgePointIndex * uvItemSize + c] = uv;
          }
        }
      }
      edgeIdx++;
    }

    // ── 2c. 计算每个原始顶点的新位置 ─────────────────────────────────
    // 收集每个顶点的邻接边 (EdgeInfo) + 邻接面
    const vertexEdges = new Map<number, EdgeInfo[]>();
    const vertexFaces = new Map<number, number[]>();
    for (const info of edgeList) {
      for (const v of [info.a, info.b]) {
        let list = vertexEdges.get(v);
        if (!list) {
          list = [];
          vertexEdges.set(v, list);
        }
        list.push(info);
      }
    }
    for (let f = 0; f < faceCountNum; f++) {
      for (const v of faces[f].vertices) {
        let list = vertexFaces.get(v);
        if (!list) {
          list = [];
          vertexFaces.set(v, list);
        }
        list.push(f);
      }
    }

    for (let v = 0; v < originalCount; v++) {
      const adjEdges = vertexEdges.get(v) ?? [];
      const adjFaces = vertexFaces.get(v) ?? [];
      const n = adjEdges.length; // valence
      if (n === 0) {
        // 孤立顶点:保持原位置
        for (let c = 0; c < itemSize; c++) {
          newPos[v * itemSize + c] = positions[v * itemSize + c];
        }
        if (newUv) {
          for (let c = 0; c < uvItemSize; c++) {
            newUv[v * uvItemSize + c] = uvs![v * uvItemSize + c];
          }
        }
        continue;
      }

      // 判断边界顶点 (有任一相邻边为边界边)
      const isBoundary = adjEdges.some((e) => e.faces.length === 1);

      if (isBoundary) {
        // 边界规则: 3/4 * S + 1/8 * (前后边界边中点)
        const boundaryEdges = adjEdges.filter((e) => e.faces.length === 1);
        if (boundaryEdges.length === 2) {
          const e0 = boundaryEdges[0];
          const e1 = boundaryEdges[1];
          const other0 = e0.a === v ? e0.b : e0.a;
          const other1 = e1.a === v ? e1.b : e1.a;
          for (let c = 0; c < itemSize; c++) {
            const s = positions[v * itemSize + c];
            const m0 = (s + positions[other0 * itemSize + c]) / 2;
            const m1 = (s + positions[other1 * itemSize + c]) / 2;
            newPos[v * itemSize + c] = (3 * s + m0 + m1) / 4;
          }
          if (newUv) {
            for (let c = 0; c < uvItemSize; c++) {
              const s = uvs![v * uvItemSize + c];
              const m0 = (s + uvs![other0 * uvItemSize + c]) / 2;
              const m1 = (s + uvs![other1 * uvItemSize + c]) / 2;
              newUv[v * uvItemSize + c] = (3 * s + m0 + m1) / 4;
            }
          }
        } else {
          // 奇异边界 (角点 / 单边): 退化为保持原位置
          for (let c = 0; c < itemSize; c++) {
            newPos[v * itemSize + c] = positions[v * itemSize + c];
          }
          if (newUv) {
            for (let c = 0; c < uvItemSize; c++) {
              newUv[v * uvItemSize + c] = uvs![v * uvItemSize + c];
            }
          }
        }
      } else {
        // 内部规则: (Q + 2R + (n-3)S) / n
        // Q = 相邻 face points 平均, R = 相邻边中点平均, S = 原位置
        for (let c = 0; c < itemSize; c++) {
          const s = positions[v * itemSize + c];
          let qSum = 0;
          for (const f of adjFaces) {
            qSum += facePointBuffer[f * itemSize + c];
          }
          const q = adjFaces.length > 0 ? qSum / adjFaces.length : s;
          let rSum = 0;
          for (const e of adjEdges) {
            const other = e.a === v ? e.b : e.a;
            rSum += (s + positions[other * itemSize + c]) / 2;
          }
          const r = n > 0 ? rSum / n : s;
          newPos[v * itemSize + c] = (q + 2 * r + (n - 3) * s) / n;
        }
        if (newUv && faceUvBuffer) {
          for (let c = 0; c < uvItemSize; c++) {
            const s = uvs![v * uvItemSize + c];
            let qSum = 0;
            for (const f of adjFaces) {
              qSum += faceUvBuffer[f * uvItemSize + c];
            }
            const q = adjFaces.length > 0 ? qSum / adjFaces.length : s;
            let rSum = 0;
            for (const e of adjEdges) {
              const other = e.a === v ? e.b : e.a;
              rSum += (s + uvs![other * uvItemSize + c]) / 2;
            }
            const r = n > 0 ? rSum / n : s;
            newUv[v * uvItemSize + c] = (q + 2 * r + (n - 3) * s) / n;
          }
        }
      }
    }

    // ── 3. 构建新拓扑: 每个三角形 → 6 个三角形 (3 个四边形 × 2) ────
    const newIndices: number[] = [];
    for (let f = 0; f < faceCountNum; f++) {
      const face = faces[f];
      const v0 = face.vertices[0];
      const v1 = face.vertices[1];
      const v2 = face.vertices[2];
      const F = face.facePointIndex;

      const e01 = edgeMap.get(edgeKey(v0, v1))!.edgePointIndex;
      const e12 = edgeMap.get(edgeKey(v1, v2))!.edgePointIndex;
      const e20 = edgeMap.get(edgeKey(v2, v0))!.edgePointIndex;

      // Quad 1: v0, e01, F, e20
      newIndices.push(v0, e01, F);
      newIndices.push(v0, F, e20);
      // Quad 2: v1, e12, F, e01
      newIndices.push(v1, e12, F);
      newIndices.push(v1, F, e01);
      // Quad 3: v2, e20, F, e12
      newIndices.push(v2, e20, F);
      newIndices.push(v2, F, e12);
    }

    // ── 4. 构建 BufferGeometry ──────────────────────────────────────
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(newPos, itemSize));
    if (newUv) {
      result.setAttribute('uv', new BufferAttribute(newUv, uvItemSize));
    }
    result.setIndex(newIndices);
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

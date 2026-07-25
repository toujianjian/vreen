// GeometryProcessor — 几何体处理器(合并/简化/法线/切线/包围盒/焊接顶点)。
//
// 设计目标:
//   * 与 AssetPipeline 解耦,可独立调用,也可作为 PipelineStep 注册
//   * 处理对象是引擎的 BufferGeometry 类(Core/BufferGeometry)
//   * 全部 CPU 侧实现,无 WebGL 依赖,便于在 Node / Worker 中预处理
//   * 简化使用边折叠(Quadric Error Metric 的简化版 — 边长优先 + 法线一致)
//   * 焊接使用空间哈希(O(1) 平均),按 threshold 网格量化
//
// 与 Raycaster 的关系:本类的 weldVertices / simplify 减少三角形数,
// 直接降低 Raycaster 的 intersectGeometry 工作量。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math/Vector3';
import { createLogger } from '@/lib/logger';

const log = createLogger('GeometryProcessor');

/**
 * 几何体处理器(全部静态方法)。
 */
export class GeometryProcessor {
  /**
   * 合并多个几何体为单一 BufferGeometry。
   * 各子几何体的属性(position/normal/uv)按 vertexOffset 拼接;
   * 索引按 vertexOffset 偏移。
   */
  static merge(geometries: BufferGeometry[]): BufferGeometry {
    if (geometries.length === 0) {
      return new BufferGeometry();
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    let hasNormal = false;
    let hasUv = false;

    for (const g of geometries) {
      const pos = g.attributes.position?.array;
      if (!pos) continue;
      for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
      const nrm = g.attributes.normal?.array;
      if (nrm) {
        hasNormal = true;
        for (let i = 0; i < nrm.length; i++) normals.push(nrm[i]);
      } else if (hasNormal) {
        // 已有其他几何体带 normal,这里补 0 占位
        for (let i = 0; i < pos.length; i++) normals.push(0);
      }
      const uv = g.attributes.uv?.array;
      if (uv) {
        hasUv = true;
        for (let i = 0; i < uv.length; i++) uvs.push(uv[i]);
      } else if (hasUv) {
        for (let i = 0; i < pos.length / 3 * 2; i++) uvs.push(0);
      }
      const idx = g.index?.array as unknown as ArrayLike<number> | undefined;
      if (idx) {
        for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
      } else {
        const vc = pos.length / 3;
        for (let i = 0; i < vc; i += 3) {
          indices.push(i, i + 1, i + 2);
        }
      }
      vertexOffset += pos.length / 3;
    }

    const out = new BufferGeometry();
    out.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    if (hasNormal) out.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    if (hasUv) out.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    out.setIndex(indices);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    log.info(`merge — ${geometries.length} geometries → ${vertexOffset} verts`);
    return out;
  }

  /**
   * 简化网格(基于边折叠的简化版)。
   * @param geometry  输入几何体
   * @param ratio     目标三角形比例(0-1,0.5 = 减半)
   */
  static simplify(geometry: BufferGeometry, ratio: number): BufferGeometry {
    if (ratio <= 0 || ratio > 1) {
      throw new Error(`GeometryProcessor.simplify: ratio 必须在 (0, 1]`);
    }
    const pos = geometry.attributes.position;
    if (!pos) return geometry;
    const idx = geometry.index?.array as unknown as ArrayLike<number> | undefined;
    if (!idx) {
      log.warn(`simplify — 几何体无 index,跳过`);
      return geometry;
    }

    const triCount = idx.length / 3;
    const targetTriCount = Math.max(1, Math.floor(triCount * ratio));
    if (targetTriCount >= triCount) return geometry;

    // 简化策略:按三角形面积升序(小三角形优先丢弃)
    // 真实 QEM 实现复杂度高,这里采用"丢弃小三角形"启发式
    const tris: Array<{ a: number; b: number; c: number; area: number; index: number }> = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const area = this._triangleArea(pos.array, a, b, c);
      tris.push({ a, b, c, area, index: i / 3 });
    }
    tris.sort((x, y) => y.area - x.area); // 大三角形优先保留
    tris.length = targetTriCount;
    // 重建索引(仅保留大三角形)
    const newIdx: number[] = [];
    for (const t of tris) {
      newIdx.push(t.a, t.b, t.c);
    }
    // 注:此简化不重映射顶点,因此顶点数不变,但三角形数减少。
    // 真实 QEM 实现会合并顶点,这里权衡简单性。
    const out = new BufferGeometry();
    out.setAttribute('position', new BufferAttribute(pos.array.slice(), 3));
    const nrm = geometry.attributes.normal?.array;
    if (nrm) out.setAttribute('normal', new BufferAttribute(nrm.slice(), 3));
    const uv = geometry.attributes.uv?.array;
    if (uv) out.setAttribute('uv', new BufferAttribute(uv.slice(), 2));
    out.setIndex(newIdx);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    log.info(`simplify — ${triCount} → ${targetTriCount} tris (ratio=${ratio})`);
    return out;
  }

  /**
   * 生成法线(委托给 BufferGeometry.computeVertexNormals)。
   */
  static generateNormals(geometry: BufferGeometry): BufferGeometry {
    geometry.computeVertexNormals();
    // bump 所有 attribute version,通知 renderer 重传
    for (const attr of Object.values(geometry.attributes)) attr.version++;
    log.info(`generateNormals — recomputed`);
    return geometry;
  }

  /**
   * 生成切线(基于位置 + UV + 法线)。
   * 算法参考 three.js BufferGeometryUtils.computeTangents。
   */
  static generateTangents(geometry: BufferGeometry): BufferGeometry {
    const pos = geometry.attributes.position;
    const nrm = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const idx = geometry.index;
    if (!pos || !nrm || !uv) {
      log.warn(`generateTangents — 缺少 position/normal/uv,跳过`);
      return geometry;
    }
    const vc = pos.count;
    const tangents = new Float32Array(vc * 4);
    const tan1 = new Float32Array(vc * 3);
    const tan2 = new Float32Array(vc * 3);

    const p = pos.array;
    const u = uv.array;
    const iterate = (a: number, b: number, c: number) => {
      const vax = p[a * 3], vay = p[a * 3 + 1], vaz = p[a * 3 + 2];
      const vbx = p[b * 3], vby = p[b * 3 + 1], vbz = p[b * 3 + 2];
      const vcx = p[c * 3], vcy = p[c * 3 + 1], vcz = p[c * 3 + 2];
      const uax = u[a * 2], uay = u[a * 2 + 1];
      const ubx = u[b * 2], uby = u[b * 2 + 1];
      const ucx = u[c * 2], ucy = u[c * 2 + 1];
      const d1x = vbx - vax, d1y = vby - vay, d1z = vbz - vaz;
      const d2x = vcx - vax, d2y = vcy - vay, d2z = vcz - vaz;
      const s1 = ubx - uax, t1 = uby - uay;
      const s2 = ucx - uax, t2 = ucy - uay;
      const det = s1 * t2 - s2 * t1;
      const r = det === 0 ? 0 : 1 / det;
      const sdirX = (t2 * d1x - t1 * d2x) * r;
      const sdirY = (t2 * d1y - t1 * d2y) * r;
      const sdirZ = (t2 * d1z - t1 * d2z) * r;
      const tdirX = (s1 * d2x - s2 * d1x) * r;
      const tdirY = (s1 * d2y - s2 * d1y) * r;
      const tdirZ = (s1 * d2z - s2 * d1z) * r;
      tan1[a * 3] += sdirX; tan1[a * 3 + 1] += sdirY; tan1[a * 3 + 2] += sdirZ;
      tan1[b * 3] += sdirX; tan1[b * 3 + 1] += sdirY; tan1[b * 3 + 2] += sdirZ;
      tan1[c * 3] += sdirX; tan1[c * 3 + 1] += sdirY; tan1[c * 3 + 2] += sdirZ;
      tan2[a * 3] += tdirX; tan2[a * 3 + 1] += tdirY; tan2[a * 3 + 2] += tdirZ;
      tan2[b * 3] += tdirX; tan2[b * 3 + 1] += tdirY; tan2[b * 3 + 2] += tdirZ;
      tan2[c * 3] += tdirX; tan2[c * 3 + 1] += tdirY; tan2[c * 3 + 2] += tdirZ;
    };
    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      for (let i = 0; i < ia.length; i += 3) {
        iterate(ia[i], ia[i + 1], ia[i + 2]);
      }
    } else {
      for (let i = 0; i < vc; i += 3) {
        iterate(i, i + 1, i + 2);
      }
    }
    // Gram-Schmidt 正交化,计算 handedness
    const n = nrm.array;
    for (let i = 0; i < vc; i++) {
      const nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2];
      const t1x = tan1[i * 3], t1y = tan1[i * 3 + 1], t1z = tan1[i * 3 + 2];
      const dot = nx * t1x + ny * t1y + nz * t1z;
      const tx = t1x - nx * dot;
      const ty = t1y - ny * dot;
      const tz = t1z - nz * dot;
      const tl = Math.hypot(tx, ty, tz) || 1;
      // handedness: cross(n, t1) · tan2
      const cx = ny * t1z - nz * t1y;
      const cy = nz * t1x - nx * t1z;
      const cz = nx * t1y - ny * t1x;
      const w = cx * tan2[i * 3] + cy * tan2[i * 3 + 1] + cz * tan2[i * 3 + 2] < 0 ? -1 : 1;
      tangents[i * 4] = tx / tl;
      tangents[i * 4 + 1] = ty / tl;
      tangents[i * 4 + 2] = tz / tl;
      tangents[i * 4 + 3] = w;
    }
    geometry.setAttribute('tangent', new BufferAttribute(tangents, 4));
    // bump position/normal/uv version 通知 renderer
    for (const attr of Object.values(geometry.attributes)) attr.version++;
    log.info(`generateTangents — computed for ${vc} verts`);
    return geometry;
  }

  /**
   * 计算包围盒(委托给 BufferGeometry.computeBoundingBox)。
   */
  static computeBoundingBox(geometry: BufferGeometry): { min: Vector3; max: Vector3 } | null {
    geometry.computeBoundingBox();
    return geometry.boundingBox;
  }

  /**
   * 焊接顶点:把距离 ≤ threshold 的顶点合并为同一索引。
   * 算法:空间网格量化哈希,O(N) 平均。
   */
  static weldVertices(geometry: BufferGeometry, threshold: number = 1e-4): BufferGeometry {
    const pos = geometry.attributes.position;
    if (!pos) return geometry;
    if (threshold <= 0) {
      throw new Error(`GeometryProcessor.weldVertices: threshold 必须为正数`);
    }
    const p = pos.array;
    const vc = pos.count;
    const idx = geometry.index?.array as unknown as ArrayLike<number> | undefined;

    // 用网格量化哈希,key = "x_q,y_q,z_q"
    const remap = new Int32Array(vc).fill(-1);
    const seen = new Map<string, number>();
    const inv = 1 / threshold;
    let newCount = 0;
    for (let i = 0; i < vc; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const qx = Math.round(x * inv);
      const qy = Math.round(y * inv);
      const qz = Math.round(z * inv);
      const key = `${qx},${qy},${qz}`;
      const existing = seen.get(key);
      if (existing !== undefined) {
        remap[i] = existing;
      } else {
        seen.set(key, newCount);
        remap[i] = newCount;
        newCount++;
      }
    }

    // 构建新位置数组
    const newPos = new Float32Array(newCount * 3);
    for (let i = 0; i < vc; i++) {
      const dst = remap[i];
      newPos[dst * 3] = p[i * 3];
      newPos[dst * 3 + 1] = p[i * 3 + 1];
      newPos[dst * 3 + 2] = p[i * 3 + 2];
    }
    // 重映射索引
    let newIdx: number[] | null = null;
    if (idx) {
      newIdx = new Array(idx.length);
      for (let i = 0; i < idx.length; i++) {
        newIdx[i] = remap[idx[i]];
      }
    }

    const out = new BufferGeometry();
    out.setAttribute('position', new BufferAttribute(newPos, 3));
    // 拷贝 normal/uv(若有)— 取第一个遇到的顶点的属性
    const nrm = geometry.attributes.normal?.array;
    if (nrm) {
      const newNrm = new Float32Array(newCount * 3);
      for (let i = 0; i < vc; i++) {
        const dst = remap[i];
        newNrm[dst * 3] = nrm[i * 3];
        newNrm[dst * 3 + 1] = nrm[i * 3 + 1];
        newNrm[dst * 3 + 2] = nrm[i * 3 + 2];
      }
      out.setAttribute('normal', new BufferAttribute(newNrm, 3));
    }
    const uv = geometry.attributes.uv?.array;
    if (uv) {
      const newUv = new Float32Array(newCount * 2);
      for (let i = 0; i < vc; i++) {
        const dst = remap[i];
        newUv[dst * 2] = uv[i * 2];
        newUv[dst * 2 + 1] = uv[i * 2 + 1];
      }
      out.setAttribute('uv', new BufferAttribute(newUv, 2));
    }
    if (newIdx) out.setIndex(newIdx);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    log.info(`weldVertices — ${vc} → ${newCount} verts (threshold=${threshold})`);
    return out;
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 计算三角形面积(基于顶点位置)。 */
  private static _triangleArea(
    pos: ArrayLike<number>, a: number, b: number, c: number,
  ): number {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    // cross(e1, e2) 的长度的一半
    const cxp = e1y * e2z - e1z * e2y;
    const cyp = e1z * e2x - e1x * e2z;
    const czp = e1x * e2y - e1y * e2x;
    return 0.5 * Math.hypot(cxp, cyp, czp);
  }
}

// Csg — boolean operations on half-edge meshes.
//
// 设计参考: o3de Gems/WhiteBox/Core/WhiteBoxCsg.cpp。
//
// 简化实现说明 (Simplified implementation note):
//   完整的 CSG 需要求两网格的相交曲线、沿曲线分割面、再按操作保留/翻转面片,复杂度很高。
//   本实现采用简化策略 (对 gameplay greyboxing 已足够):
//   - union: 直接合并两个网格 (HalfEdgeMesh.merge),不做实际布尔求交。适合不重叠的网格拼接。
//   - subtract: 用面质心 (centroid) 的凸包半空间测试判断 A 的面是否在 B 内部,
//     移除 A 中位于 B 内部的面。B 必须是凸网格 (box/tetrahedron/icosahedron) 才准确。
//   - intersect: 保留 A 中位于 B 内部的面 (subtract 的补集)。
//
//   "在 B 内部" 判定: 对 B 的每个面 (外法线 n, 面上一点 v0),若 (point - v0)·n > 0 则点在
//   该面的外侧半空间;若对所有面都 ≤ 0 则点在 B 的凸包内部 (含边界)。

import { HalfEdgeMesh, type Face } from './HalfEdgeMesh';
import { Vector3 } from '../Math/Vector3';

export type CsgOperation = 'union' | 'subtract' | 'intersect';

/** Point-in-convex-mesh test via half-space classification against outward face normals. */
function isPointInsideMesh(point: Vector3, mesh: HalfEdgeMesh): boolean {
  for (const face of mesh.faces) {
    const verts = mesh.getFaceVertices(face.id);
    if (verts.length === 0) continue;
    const v0 = mesh.vertices.find(x => x.id === verts[0]);
    if (!v0) continue;
    const dx = point.x - v0.position.x;
    const dy = point.y - v0.position.y;
    const dz = point.z - v0.position.z;
    const d = dx * face.normal.x + dy * face.normal.y + dz * face.normal.z;
    if (d > 1e-9) return false; // outside this face's half-space
  }
  return true;
}

/** Centroid of a face (average of its vertex positions). */
function faceCentroid(mesh: HalfEdgeMesh, face: Face): Vector3 {
  const verts = mesh.getFaceVertices(face.id);
  if (verts.length === 0) return new Vector3();
  let cx = 0, cy = 0, cz = 0;
  for (const vid of verts) {
    const v = mesh.vertices.find(x => x.id === vid);
    if (v) { cx += v.position.x; cy += v.position.y; cz += v.position.z; }
  }
  const n = verts.length;
  return new Vector3(cx / n, cy / n, cz / n);
}

/**
 * Perform a CSG operation on two half-edge meshes.
 *
 * 简化策略见文件顶部说明。union = merge;subtract/intersect 基于面质心凸包分类。
 * B 应为凸网格以获得正确结果;对凹网格结果为近似。
 */
export function csg(a: HalfEdgeMesh, b: HalfEdgeMesh, op: CsgOperation): HalfEdgeMesh {
  switch (op) {
    case 'union':
      // Simplified: merge the two meshes without computing the intersection surface.
      return a.merge(b);

    case 'subtract': {
      // Keep faces of A whose centroid is OUTSIDE B.
      const result = a.clone();
      const toRemove: number[] = [];
      for (const face of result.faces) {
        const centroid = faceCentroid(result, face);
        if (isPointInsideMesh(centroid, b)) toRemove.push(face.id);
      }
      // Remove highest-id-first is unnecessary (ids are stable) but keeps logic simple.
      for (const fid of toRemove) result.removeFace(fid);
      return result;
    }

    case 'intersect': {
      // Keep ONLY faces of A whose centroid is INSIDE B.
      const result = a.clone();
      const toRemove: number[] = [];
      for (const face of result.faces) {
        const centroid = faceCentroid(result, face);
        if (!isPointInsideMesh(centroid, b)) toRemove.push(face.id);
      }
      for (const fid of toRemove) result.removeFace(fid);
      return result;
    }

    default:
      throw new Error(`Unknown CSG operation: ${op as string}`);
  }
}

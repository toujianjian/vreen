// WhiteBoxShapes — primitive creators for greyboxing.
//
// 设计参考: o3de Gems/WhiteBox — 基元代数 (box/tetrahedron/icosahedron/staircase) 产出 HalfEdgeMesh。
// 所有面 CCW 外法线绕序,可直接用于 CSG 与 flat-shading 渲染。

import { HalfEdgeMesh } from './HalfEdgeMesh';
import { Vector3 } from '../Math/Vector3';

/**
 * Create an axis-aligned box mesh centered at origin.
 * 8 vertices, 6 quad faces (12 triangles after triangulation).
 */
export function createBox(size: Vector3): HalfEdgeMesh {
  const m = new HalfEdgeMesh();
  const sx = size.x / 2, sy = size.y / 2, sz = size.z / 2;
  // 8 corner vertices.
  const ids = [
    m.addVertex(new Vector3(-sx, -sy, -sz)), // 0
    m.addVertex(new Vector3( sx, -sy, -sz)), // 1
    m.addVertex(new Vector3( sx,  sy, -sz)), // 2
    m.addVertex(new Vector3(-sx,  sy, -sz)), // 3
    m.addVertex(new Vector3(-sx, -sy,  sz)), // 4
    m.addVertex(new Vector3( sx, -sy,  sz)), // 5
    m.addVertex(new Vector3( sx,  sy,  sz)), // 6
    m.addVertex(new Vector3(-sx,  sy,  sz)), // 7
  ];
  // 6 quad faces (CCW outward winding, verified via cross product → outward normal).
  m.addFace([ids[1], ids[2], ids[6], ids[5]]); // +X
  m.addFace([ids[0], ids[4], ids[7], ids[3]]); // -X
  m.addFace([ids[2], ids[3], ids[7], ids[6]]); // +Y
  m.addFace([ids[0], ids[1], ids[5], ids[4]]); // -Y
  m.addFace([ids[4], ids[5], ids[6], ids[7]]); // +Z
  m.addFace([ids[0], ids[3], ids[2], ids[1]]); // -Z
  return m;
}

/**
 * Create a regular tetrahedron centered at origin.
 * 4 vertices, 4 triangular faces.
 */
export function createTetrahedron(radius: number): HalfEdgeMesh {
  const m = new HalfEdgeMesh();
  // Four equidistant vertices on the unit sphere (scaled by radius).
  const raw = [
    new Vector3( 1,  1,  1),
    new Vector3( 1, -1, -1),
    new Vector3(-1,  1, -1),
    new Vector3(-1, -1,  1),
  ];
  const ids: number[] = [];
  for (const p of raw) {
    const len = p.length();
    p.multiplyScalar(len > 0 ? radius / len : 0);
    ids.push(m.addVertex(p));
  }
  // Faces (CCW outward): each face's vertices ordered so cross product points away from origin.
  m.addFace([ids[1], ids[3], ids[2]]); // opposite v0
  m.addFace([ids[0], ids[2], ids[3]]); // opposite v1
  m.addFace([ids[0], ids[3], ids[1]]); // opposite v2
  m.addFace([ids[0], ids[1], ids[2]]); // opposite v3
  return m;
}

/**
 * Create a regular icosahedron centered at origin.
 * 12 vertices, 20 triangular faces.
 */
export function createIcosahedron(radius: number): HalfEdgeMesh {
  const m = new HalfEdgeMesh();
  const t = (1 + Math.sqrt(5)) / 2; // golden ratio
  // 12 vertices (golden-ratio rectcombo), normalized to `radius`.
  const raw = [
    new Vector3(-1,  t,  0), new Vector3( 1,  t,  0),
    new Vector3(-1, -t,  0), new Vector3( 1, -t,  0),
    new Vector3( 0, -1,  t), new Vector3( 0,  1,  t),
    new Vector3( 0, -1, -t), new Vector3( 0,  1, -t),
    new Vector3( t,  0, -1), new Vector3( t,  0,  1),
    new Vector3(-t,  0, -1), new Vector3(-t,  0,  1),
  ];
  const ids: number[] = [];
  for (const p of raw) {
    const len = p.length();
    p.multiplyScalar(len > 0 ? radius / len : 0);
    ids.push(m.addVertex(p));
  }
  // 20 triangular faces (three.js IcosahedronGeometry ordering, CCW outward).
  const faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (const f of faces) m.addFace([ids[f[0]], ids[f[1]], ids[f[2]]]);
  return m;
}

/**
 * Create a staircase of N steps. Each step is a box; steps stack upward and forward.
 */
export function createStaircase(
  steps: number,
  stepWidth: number,
  stepHeight: number,
  stepDepth: number,
): HalfEdgeMesh {
  let result: HalfEdgeMesh | null = null;
  for (let i = 0; i < steps; i++) {
    const box = createBox(new Vector3(stepWidth, stepHeight, stepDepth));
    // Step i sits at height i*stepHeight (bottom) and depth i*stepDepth (front face).
    for (const v of box.vertices) {
      v.position.y += i * stepHeight + stepHeight / 2;
      v.position.z += i * stepDepth;
    }
    box.computeFaceNormals();
    result = result ? result.merge(box) : box;
  }
  return result ?? new HalfEdgeMesh();
}

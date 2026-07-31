// HalfEdgeMesh — half-edge mesh data structure for in-editor greyboxing.
//
// 设计参考: o3de Gems/WhiteBox/Core/WhiteBoxMesh — 半边网格支持拓扑查询与 CSG。
//   - Vertex 持 outgoing halfEdge;HalfEdge 持 from/to/face/twin/next/prev;Face 持 halfEdge + normal。
//   - id 由 nextId 分配 (稳定,不随数组删除变化);数组为稠密 (splice 删除,查找用 id)。
//   - addFace 创建半边环 + 链接 twin (双向) + 计算法线 (cross product, CCW 外法线)。
//   - toBufferGeometry 输出 BufferGeometry (per-face 顶点复制实现 flat shading + fan 三角剖分)。
//
// 与 Core/BufferGeometry 的关系:
//   - BufferGeometry 是渲染用的扁平顶点缓冲;HalfEdgeMesh 是拓扑感知的编辑用网格。
//   - toBufferGeometry 把 HalfEdgeMesh 转换为可渲染的 BufferGeometry。

import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';

export interface Vertex { id: number; position: Vector3; halfEdge: number; } // halfEdge = outgoing
export interface HalfEdge { id: number; from: number; to: number; face: number; twin: number; next: number; prev: number; }
export interface Face { id: number; halfEdge: number; normal: Vector3; }

export class HalfEdgeMesh {
  vertices: Vertex[] = [];
  halfEdges: HalfEdge[] = [];
  faces: Face[] = [];
  private nextId = 0;

  /** O(1) when index===id (common: freshly built mesh), O(n) fallback after removals. */
  private _vertex(id: number): Vertex | undefined {
    const v = this.vertices[id];
    return v !== undefined && v.id === id ? v : this.vertices.find(x => x.id === id);
  }
  private _he(id: number): HalfEdge | undefined {
    const h = this.halfEdges[id];
    return h !== undefined && h.id === id ? h : this.halfEdges.find(x => x.id === id);
  }
  private _face(id: number): Face | undefined {
    const f = this.faces[id];
    return f !== undefined && f.id === id ? f : this.faces.find(x => x.id === id);
  }

  addVertex(position: Vector3): number {
    const id = this.nextId++;
    this.vertices.push({ id, position: position.clone(), halfEdge: -1 });
    return id;
  }

  /** Create a face from a CCW-ordered vertex id ring. Returns the new face id. */
  addFace(vertexIds: number[]): number {
    if (vertexIds.length < 3) throw new Error('addFace requires at least 3 vertices');
    const faceId = this.nextId++;
    const n = vertexIds.length;
    const newHEs: HalfEdge[] = [];
    for (let i = 0; i < n; i++) {
      const from = vertexIds[i];
      const to = vertexIds[(i + 1) % n];
      const heId = this.nextId++;
      const he: HalfEdge = { id: heId, from, to, face: faceId, twin: -1, next: -1, prev: -1 };
      this.halfEdges.push(he);
      newHEs.push(he);
    }
    // Link next/prev around the ring.
    for (let i = 0; i < n; i++) {
      newHEs[i].next = newHEs[(i + 1) % n].id;
      newHEs[i].prev = newHEs[(i - 1 + n) % n].id;
    }
    // Assign vertex.halfEdge (outgoing) if unset.
    for (let i = 0; i < n; i++) {
      const v = this._vertex(vertexIds[i]);
      if (v && v.halfEdge === -1) v.halfEdge = newHEs[i].id;
    }
    // Link twins: find existing reverse half-edge.
    for (let i = 0; i < n; i++) {
      const he = newHEs[i];
      if (he.twin !== -1) continue;
      const twinId = this.findEdge(he.to, he.from);
      if (twinId !== -1 && twinId !== he.id) {
        const twin = this._he(twinId);
        if (twin && twin.twin === -1) {
          he.twin = twinId;
          twin.twin = he.id;
        }
      }
    }
    // Compute face normal (CCW outward): (v1-v0) × (v2-v0).
    const v0 = this._vertex(vertexIds[0])?.position;
    const v1 = this._vertex(vertexIds[1])?.position;
    const v2 = this._vertex(vertexIds[2])?.position;
    let normal: Vector3;
    if (v0 && v1 && v2) {
      const e1 = new Vector3().subVectors(v1, v0);
      const e2 = new Vector3().subVectors(v2, v0);
      normal = new Vector3().copy(e1).cross(e2);
      if (normal.lengthSq() > 0) normal.normalize();
      else normal.set(0, 1, 0);
    } else {
      normal = new Vector3(0, 1, 0);
    }
    this.faces.push({ id: faceId, halfEdge: newHEs[0].id, normal });
    return faceId;
  }

  /** Remove a vertex + all incident faces (which removes their half-edges). */
  removeVertex(id: number): void {
    // Collect incident faces (any half-edge touching this vertex).
    const incidentFaces = new Set<number>();
    for (const he of this.halfEdges) {
      if (he.from === id || he.to === id) incidentFaces.add(he.face);
    }
    for (const fid of Array.from(incidentFaces)) this.removeFace(fid);
    const idx = this.vertices.findIndex(v => v.id === id);
    if (idx !== -1) this.vertices.splice(idx, 1);
  }

  /** Remove a face + its half-edges + detach twins. */
  removeFace(id: number): void {
    const faceIdx = this.faces.findIndex(f => f.id === id);
    if (faceIdx === -1) return;
    const face = this.faces[faceIdx];
    // Collect the face's half-edge ring.
    const heIds = new Set<number>();
    let heId = face.halfEdge;
    const start = heId;
    let guard = 0;
    do {
      const he = this._he(heId);
      if (!he) break;
      heIds.add(heId);
      if (he.twin !== -1) {
        const twin = this._he(he.twin);
        if (twin) twin.twin = -1;
      }
      heId = he.next;
      if (++guard > 100000) break;
    } while (heId !== start && heId !== -1);
    // Remove the half-edges.
    this.halfEdges = this.halfEdges.filter(h => !heIds.has(h.id));
    // Remove the face.
    this.faces.splice(faceIdx, 1);
    // Reassign vertex.halfEdge pointers that pointed to removed half-edges.
    for (const v of this.vertices) {
      if (v.halfEdge !== -1 && heIds.has(v.halfEdge)) {
        const repl = this.halfEdges.find(h => h.from === v.id);
        v.halfEdge = repl ? repl.id : -1;
      }
    }
  }

  /** Find a half-edge by its endpoints. Returns -1 if not found. */
  findEdge(from: number, to: number): number {
    for (const he of this.halfEdges) {
      if (he.from === from && he.to === to) return he.id;
    }
    return -1;
  }

  /** All outgoing half-edge ids from a vertex. */
  getVertexEdges(vid: number): number[] {
    const result: number[] = [];
    for (const he of this.halfEdges) {
      if (he.from === vid) result.push(he.id);
    }
    return result;
  }

  /** Vertex ids of a face (in CCW order). */
  getFaceVertices(fid: number): number[] {
    const face = this._face(fid);
    if (!face) return [];
    const result: number[] = [];
    let heId = face.halfEdge;
    const start = heId;
    let guard = 0;
    do {
      const he = this._he(heId);
      if (!he) break;
      result.push(he.from);
      heId = he.next;
      if (++guard > 100000) break;
    } while (heId !== start && heId !== -1);
    return result;
  }

  /** Recompute all face normals from positions. */
  computeFaceNormals(): void {
    for (const face of this.faces) {
      const verts = this.getFaceVertices(face.id);
      if (verts.length < 3) continue;
      const v0 = this._vertex(verts[0])?.position;
      const v1 = this._vertex(verts[1])?.position;
      const v2 = this._vertex(verts[2])?.position;
      if (!v0 || !v1 || !v2) continue;
      const e1 = new Vector3().subVectors(v1, v0);
      const e2 = new Vector3().subVectors(v2, v0);
      face.normal.copy(e1).cross(e2);
      if (face.normal.lengthSq() > 0) face.normal.normalize();
    }
  }

  /** AABB of all vertex positions. */
  getBoundingBox(): Box3 {
    const box = new Box3();
    for (const v of this.vertices) box.expandByPoint(v.position);
    return box;
  }

  /** Convert to renderable BufferGeometry (per-face vertices for flat shading, fan triangulated). */
  toBufferGeometry(): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let vidx = 0;
    for (const face of this.faces) {
      const verts = this.getFaceVertices(face.id);
      if (verts.length < 3) continue;
      for (const vid of verts) {
        const v = this._vertex(vid);
        if (!v) continue;
        positions.push(v.position.x, v.position.y, v.position.z);
        normals.push(face.normal.x, face.normal.y, face.normal.z);
      }
      // Fan triangulation: (0, i, i+1) for i in [1, n-2].
      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(vidx, vidx + i, vidx + i + 1);
      }
      vidx += verts.length;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setIndex(indices);
    return geo;
  }

  /** Deep copy (independent positions/normals; ids preserved). */
  clone(): HalfEdgeMesh {
    const m = new HalfEdgeMesh();
    m.vertices = this.vertices.map(v => ({ ...v, position: v.position.clone() }));
    m.halfEdges = this.halfEdges.map(he => ({ ...he }));
    m.faces = this.faces.map(f => ({ ...f, normal: f.normal.clone() }));
    m.nextId = this.nextId;
    return m;
  }

  /** Union: append other's vertices/faces with remapped ids. */
  merge(other: HalfEdgeMesh): HalfEdgeMesh {
    const result = this.clone();
    const vMap = new Map<number, number>();
    const heMap = new Map<number, number>();
    const fMap = new Map<number, number>();

    const vStart = result.vertices.length;
    for (let i = 0; i < other.vertices.length; i++) {
      const v = other.vertices[i];
      const newId = result.nextId++;
      result.vertices.push({ id: newId, position: v.position.clone(), halfEdge: -1 });
      vMap.set(v.id, newId);
    }
    const heStart = result.halfEdges.length;
    for (let i = 0; i < other.halfEdges.length; i++) {
      const he = other.halfEdges[i];
      const newId = result.nextId++;
      result.halfEdges.push({
        id: newId,
        from: vMap.get(he.from) ?? -1,
        to: vMap.get(he.to) ?? -1,
        face: -1, twin: -1, next: -1, prev: -1,
      });
      heMap.set(he.id, newId);
    }
    // Remap half-edge internal references.
    for (let i = 0; i < other.halfEdges.length; i++) {
      const he = other.halfEdges[i];
      const nh = result.halfEdges[heStart + i];
      nh.twin = he.twin === -1 ? -1 : (heMap.get(he.twin) ?? -1);
      nh.next = he.next === -1 ? -1 : (heMap.get(he.next) ?? -1);
      nh.prev = he.prev === -1 ? -1 : (heMap.get(he.prev) ?? -1);
    }
    for (let i = 0; i < other.faces.length; i++) {
      const f = other.faces[i];
      const newId = result.nextId++;
      result.faces.push({ id: newId, halfEdge: heMap.get(f.halfEdge) ?? -1, normal: f.normal.clone() });
      fMap.set(f.id, newId);
    }
    // Set face references on the new half-edges.
    for (let i = 0; i < other.halfEdges.length; i++) {
      const he = other.halfEdges[i];
      const nh = result.halfEdges[heStart + i];
      nh.face = fMap.get(he.face) ?? -1;
    }
    // Set vertex.halfEdge for the new vertices.
    for (let i = 0; i < other.vertices.length; i++) {
      const v = other.vertices[i];
      const nv = result.vertices[vStart + i];
      nv.halfEdge = v.halfEdge === -1 ? -1 : (heMap.get(v.halfEdge) ?? -1);
    }
    return result;
  }
}

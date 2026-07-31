import { describe, it, expect } from 'vitest';
import {
  HalfEdgeMesh,
  createBox,
  createTetrahedron,
  createIcosahedron,
  createStaircase,
  csg,
} from './index';
import { Vector3 } from '../Math/Vector3';

// ── Primitive shapes ───────────────────────────────────────────────

describe('WhiteBox shapes', () => {
  it('createBox(size=(2,2,2)): 8 vertices, 6 faces, bbox (-1,-1,-1)..(1,1,1)', () => {
    const m = createBox(new Vector3(2, 2, 2));
    expect(m.vertices).toHaveLength(8);
    expect(m.faces).toHaveLength(6);
    const bb = m.getBoundingBox();
    expect(bb.min.x).toBeCloseTo(-1);
    expect(bb.min.y).toBeCloseTo(-1);
    expect(bb.min.z).toBeCloseTo(-1);
    expect(bb.max.x).toBeCloseTo(1);
    expect(bb.max.y).toBeCloseTo(1);
    expect(bb.max.z).toBeCloseTo(1);
  });

  it('createTetrahedron(radius=1): 4 vertices, 4 faces', () => {
    const m = createTetrahedron(1);
    expect(m.vertices).toHaveLength(4);
    expect(m.faces).toHaveLength(4);
  });

  it('createIcosahedron(radius=1): 12 vertices, 20 faces', () => {
    const m = createIcosahedron(1);
    expect(m.vertices).toHaveLength(12);
    expect(m.faces).toHaveLength(20);
  });

  it('createStaircase(steps=3): vertex count > 0, faces > 0', () => {
    const m = createStaircase(3, 2, 0.5, 1);
    expect(m.vertices.length).toBeGreaterThan(0);
    expect(m.faces.length).toBeGreaterThan(0);
    // 3 boxes merged → 3*8 = 24 vertices, 3*6 = 18 faces (no CSG, just merge).
    expect(m.vertices).toHaveLength(24);
    expect(m.faces).toHaveLength(18);
  });

  it('createBox face normals point outward (unit length + correct axis)', () => {
    const m = createBox(new Vector3(2, 2, 2));
    m.computeFaceNormals();
    const axisDirs = new Set<string>();
    for (const f of m.faces) {
      expect(f.normal.length()).toBeCloseTo(1, 5);
      // Each normal should align to ±X/±Y/±Z.
      const ax = Math.abs(f.normal.x), ay = Math.abs(f.normal.y), az = Math.abs(f.normal.z);
      const max = Math.max(ax, ay, az);
      expect(max).toBeCloseTo(1, 5);
      if (ax === max) axisDirs.add(f.normal.x > 0 ? '+X' : '-X');
      else if (ay === max) axisDirs.add(f.normal.y > 0 ? '+Y' : '-Y');
      else axisDirs.add(f.normal.z > 0 ? '+Z' : '-Z');
    }
    expect(axisDirs.size).toBe(6); // all 6 axis directions present
  });
});

// ── HalfEdgeMesh ───────────────────────────────────────────────────

describe('HalfEdgeMesh', () => {
  it('addVertex / addFace: round-trip', () => {
    const m = new HalfEdgeMesh();
    const a = m.addVertex(new Vector3(0, 0, 0));
    const b = m.addVertex(new Vector3(1, 0, 0));
    const c = m.addVertex(new Vector3(0, 1, 0));
    expect(m.vertices).toHaveLength(3);
    const f = m.addFace([a, b, c]);
    expect(m.faces).toHaveLength(1);
    expect(m.halfEdges.length).toBe(3); // triangle → 3 half-edges
    expect(m.getFaceVertices(f)).toEqual([a, b, c]);
  });

  it('findEdge: finds existing, returns -1 for missing', () => {
    const m = new HalfEdgeMesh();
    const a = m.addVertex(new Vector3(0, 0, 0));
    const b = m.addVertex(new Vector3(1, 0, 0));
    const c = m.addVertex(new Vector3(0, 1, 0));
    m.addFace([a, b, c]);
    expect(m.findEdge(a, b)).not.toBe(-1);
    expect(m.findEdge(b, c)).not.toBe(-1);
    expect(m.findEdge(c, a)).not.toBe(-1);
    // The reverse directions exist as twins of adjacent faces only if added;
    // here no twin face so reverse edges don't exist.
    expect(m.findEdge(b, a)).toBe(-1);
    expect(m.findEdge(a, c)).toBe(-1);
  });

  it('getVertexEdges / getFaceVertices', () => {
    const m = createBox(new Vector3(2, 2, 2));
    // Vertex 0 (-1,-1,-1) is the `from` of two outgoing half-edges (−X face ring + −Y face ring + −Z face ring).
    const edges = m.getVertexEdges(0);
    expect(edges.length).toBeGreaterThan(0);
    // Each face has 4 vertices (quad).
    for (const f of m.faces) {
      const verts = m.getFaceVertices(f.id);
      expect(verts).toHaveLength(4);
    }
  });

  it('computeFaceNormals: normals are unit length', () => {
    const m = createIcosahedron(2);
    m.computeFaceNormals();
    for (const f of m.faces) {
      expect(f.normal.length()).toBeCloseTo(1, 5);
    }
  });

  it('toBufferGeometry: returns BufferGeometry with position + normal + index attributes', () => {
    const m = createBox(new Vector3(2, 2, 2));
    const geo = m.toBufferGeometry();
    expect(geo.attributes.position).toBeDefined();
    expect(geo.attributes.normal).toBeDefined();
    expect(geo.index).not.toBeNull();
    // 6 quads × 4 verts = 24 position entries (×3 floats = 72).
    expect(geo.attributes.position.count).toBe(24);
    // 6 quads × 2 triangles × 3 indices = 36.
    expect(geo.index!.count).toBe(36);
  });

  it('clone: independent copy', () => {
    const m = createBox(new Vector3(2, 2, 2));
    const c = m.clone();
    expect(c.vertices).toHaveLength(m.vertices.length);
    expect(c.faces).toHaveLength(m.faces.length);
    // Mutate original positions; clone must be unaffected.
    m.vertices[0].position.x = 999;
    expect(c.vertices[0].position.x).toBeCloseTo(-1);
    // Mutate original face normal; clone unaffected.
    m.faces[0].normal.set(0, 0, 0);
    expect(c.faces[0].normal.length()).toBeCloseTo(1, 5);
  });

  it('merge: combines two meshes', () => {
    const a = createBox(new Vector3(2, 2, 2));
    const b = createBox(new Vector3(2, 2, 2));
    // Offset b so the two don't overlap (union = merge).
    for (const v of b.vertices) v.position.x += 10;
    b.computeFaceNormals();
    const merged = a.merge(b);
    expect(merged.vertices).toHaveLength(16);
    expect(merged.faces).toHaveLength(12);
    // Originals untouched.
    expect(a.vertices).toHaveLength(8);
  });

  it('removeFace: removes a face and keeps the mesh valid', () => {
    const m = createBox(new Vector3(2, 2, 2));
    const before = m.faces.length;
    const firstFaceId = m.faces[0].id;
    m.removeFace(firstFaceId);
    expect(m.faces).toHaveLength(before - 1);
    // Remaining faces still report their vertices correctly.
    for (const f of m.faces) {
      expect(m.getFaceVertices(f.id)).toHaveLength(4);
    }
    // toBufferGeometry still works with one fewer face.
    const geo = m.toBufferGeometry();
    expect(geo.attributes.position.count).toBe((before - 1) * 4);
  });
});

// ── CSG ────────────────────────────────────────────────────────────

describe('Csg', () => {
  // Helper: translate all vertices of a mesh by a delta.
  function translate(m: HalfEdgeMesh, dx: number, dy: number, dz: number): void {
    for (const v of m.vertices) {
      v.position.x += dx;
      v.position.y += dy;
      v.position.z += dz;
    }
    m.computeFaceNormals();
  }

  it("csg(a, b, 'union'): returns a merged mesh", () => {
    const a = createBox(new Vector3(2, 2, 2));
    const b = createBox(new Vector3(2, 2, 2));
    translate(b, 10, 0, 0); // disjoint → merge is the correct union
    const result = csg(a, b, 'union');
    expect(result.vertices).toHaveLength(16);
    expect(result.faces).toHaveLength(12);
  });

  it("csg(a, b, 'subtract'): returns a mesh with some faces removed", () => {
    const a = createBox(new Vector3(2, 2, 2)); // faces at ±1
    const b = createBox(new Vector3(2, 2, 2));
    translate(b, 1, 0, 0); // B occupies x∈[0,2]; A's +X face centroid (1,0,0) is inside B.
    const result = csg(a, b, 'subtract');
    expect(result.faces.length).toBeGreaterThan(0);
    expect(result.faces.length).toBeLessThan(a.faces.length);
  });

  it("csg(a, b, 'intersect'): returns a mesh with only inside faces", () => {
    const a = createBox(new Vector3(2, 2, 2));
    const b = createBox(new Vector3(2, 2, 2));
    translate(b, 1, 0, 0); // A's +X face (centroid (1,0,0)) is inside B.
    const result = csg(a, b, 'intersect');
    expect(result.faces.length).toBeGreaterThan(0);
    expect(result.faces.length).toBeLessThan(a.faces.length);
    // Every remaining face centroid should be inside B.
    for (const f of result.faces) {
      const verts = result.getFaceVertices(f.id);
      let cx = 0, cy = 0, cz = 0;
      for (const vid of verts) {
        const v = result.vertices.find(x => x.id === vid);
        if (v) { cx += v.position.x; cy += v.position.y; cz += v.position.z; }
      }
      // x of centroid should be ≥ 0 (inside B's x∈[0,2] range).
      expect(cx / verts.length).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("csg with non-overlapping boxes: subtract removes nothing, intersect removes all", () => {
    const a = createBox(new Vector3(2, 2, 2));
    const b = createBox(new Vector3(2, 2, 2));
    translate(b, 100, 0, 0); // far away, no overlap
    expect(csg(a, b, 'subtract').faces).toHaveLength(a.faces.length);
    expect(csg(a, b, 'intersect').faces).toHaveLength(0);
  });
});

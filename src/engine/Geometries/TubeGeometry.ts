// TubeGeometry — tube surface swept along a 3D curve.
//
// Adapts three.js src/geometries/TubeGeometry.js (MIT), using VREEN's
// Curve.computeFrenetFrames() for the tangent/normal/binormal frame
// computation. Builds a tube by sampling the curve, generating a ring of
// `radialSegments` vertices around each sampled point along the Frenet
// frame, and stitching adjacent rings into triangles.
//
// Differences from three.js:
//   • Takes a VREEN Curve<Vector3> + TubeGeometryOptions (named fields).
//   • Uses VREEN BufferGeometry / BufferAttribute setAttribute pattern.
//   • Normal attribute is the outward radial direction (N·cos + B·sin),
//     matching three.js — no computeVertexNormals() needed.

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Vector3 } from '../Math/Vector3';
import { Curve } from '../Curves/Curve';
import { createLogger } from '@/lib/logger';

const log = createLogger('TubeGeometry');

export interface TubeGeometryOptions {
  /** Number of segments along the tube length (default 64). */
  tubularSegments?: number;
  /** Number of segments around the tube radius (default 8). */
  radialSegments?: number;
  /** Tube radius (default 0.4). */
  radius?: number;
  /** If true, the tube is closed (connects end to start). Default false. */
  closed?: boolean;
}

/**
 * Tube geometry built from a Curve. Adapts three.js TubeGeometry.
 *
 * Builds a tube by:
 *   1. Sampling `tubularSegments+1` points along the curve (via getPointAt).
 *   2. Computing Frenet frames (tangent/normal/binormal) at each point.
 *   3. For each point, generating `radialSegments+1` vertices in a circle
 *      around the tangent (the +1 closes the UV seam; the last vertex
 *      duplicates the first position with v=1).
 *   4. Building two triangles per grid cell.
 *
 * Uses VREEN's Curve.computeFrenetFrames() for the frame computation.
 */
export class TubeGeometry extends BufferGeometry {
  readonly curve: Curve<Vector3>;
  readonly tubularSegments: number;
  readonly radialSegments: number;
  readonly radius: number;
  readonly closed: boolean;

  constructor(curve: Curve<Vector3>, options: TubeGeometryOptions = {}) {
    super();
    this.curve = curve;
    this.tubularSegments = Math.max(1, Math.floor(options.tubularSegments ?? 64));
    this.radialSegments = Math.max(3, Math.floor(options.radialSegments ?? 8));
    this.radius = Math.max(0, options.radius ?? 0.4);
    this.closed = options.closed ?? false;
    this.build();
  }

  private build(): void {
    const { tubularSegments, radialSegments, radius, closed, curve } = this;

    // 1. Frenet frames (segments+1 entries each).
    const frames = curve.computeFrenetFrames(tubularSegments, closed);
    const { normals, binormals } = frames;

    const vertices: number[] = [];
    const normalsArr: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Scratch vectors.
    const P = new Vector3();
    const normal = new Vector3();
    const vertex = new Vector3();

    // 2. Generate rings of vertices.
    for (let i = 0; i <= tubularSegments; i++) {
      const u = i / tubularSegments;
      curve.getPointAt(u, P);

      const N = normals[i];
      const B = binormals[i];

      for (let j = 0; j <= radialSegments; j++) {
        const v = (j / radialSegments) * Math.PI * 2;
        const cos = Math.cos(v);
        const sin = Math.sin(v);

        // Outward radial direction = N·cos + B·sin.
        normal.set(
          N.x * cos + B.x * sin,
          N.y * cos + B.y * sin,
          N.z * cos + B.z * sin,
        );

        vertex.set(
          P.x + normal.x * radius,
          P.y + normal.y * radius,
          P.z + normal.z * radius,
        );

        vertices.push(vertex.x, vertex.y, vertex.z);
        normalsArr.push(normal.x, normal.y, normal.z);
        uvs.push(u, j / radialSegments);
      }
    }

    // 3. Build indices: two triangles per grid cell. Vertex layout is
    //    ring-major: vertex(t, r) = t * (radialSegments + 1) + r.
    //    For a closed tube, ring `tubularSegments` coincides geometrically
    //    with ring 0 (the curve closes), so the existing cell topology
    //    already closes the surface — no extra wrap quads needed.
    for (let t = 0; t < tubularSegments; t++) {
      for (let r = 0; r < radialSegments; r++) {
        const a = t * (radialSegments + 1) + r;
        const b = (t + 1) * (radialSegments + 1) + r;
        const c = (t + 1) * (radialSegments + 1) + (r + 1);
        const d = t * (radialSegments + 1) + (r + 1);

        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(normalsArr), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.computeBoundingBox();
    log.debug('built', {
      verts: vertices.length / 3,
      tris: indices.length / 3,
      tubularSegments,
      radialSegments,
      radius,
      closed,
    });
  }
}

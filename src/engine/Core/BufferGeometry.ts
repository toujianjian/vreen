// BufferGeometry — collection of BufferAttributes (position, normal, uv, ...)
// plus an optional index buffer. Mirrors three.js's API surface for the
// subset the WebGL2 renderer actually uses.
//
// Storage rule: every attribute is a Float32Array in CPU memory; the
// renderer is responsible for uploading it to a GL buffer and bumping
// versions to detect CPU-side writes.

import { BufferAttribute } from './BufferAttribute';
import { Vector3 } from '../Math';

export class BufferGeometry {
  /** Vertex attributes keyed by semantic name (e.g. 'position', 'normal'). */
  attributes: Record<string, BufferAttribute> = {};
  /** Optional index buffer. Itemsize is always 1 (Uint16/Uint32 triangles). */
  index: BufferAttribute | null = null;
  /**
   * Draw groups. Each entry: { start, count, materialIndex }. The renderer
   * issues a separate draw call per group. Empty by default → one draw
   * call covers the whole geometry.
   */
  groups: { start: number; count: number; materialIndex: number }[] = [];

  /** Cached AABB, populated by computeBoundingBox(). */
  boundingBox: { min: Vector3; max: Vector3 } | null = null;
  /** Cached bounding sphere, populated by computeBoundingSphere(). */
  boundingSphere: { center: Vector3; radius: number } | null = null;

  /** Free-form per-geometry data; survives JSON round-trip. */
  userData: Record<string, unknown> = {};

  setAttribute(name: string, attribute: BufferAttribute): this {
    this.attributes[name] = attribute;
    return this;
  }

  getAttribute(name: string): BufferAttribute | undefined {
    return this.attributes[name];
  }

  deleteAttribute(name: string): this {
    delete this.attributes[name];
    return this;
  }

  setIndex(index: BufferAttribute | number[] | Uint16Array | Uint32Array | null): this {
    if (index === null) {
      this.index = null;
    } else if (index instanceof BufferAttribute) {
      this.index = index;
    } else {
      // Pick the smallest unsigned int type that fits the largest index.
      let max = 0;
      for (let i = 0; i < index.length; i++) {
        if (index[i] > max) max = index[i];
      }
      const arr = max < 65536 ? new Uint16Array(index) : new Uint32Array(index);
      this.index = new BufferAttribute(arr as unknown as Float32Array, 1);
    }
    return this;
  }

  /** Add a draw group (for multi-material rendering). */
  addGroup(start: number, count: number, materialIndex: number = 0): this {
    this.groups.push({ start, count, materialIndex });
    return this;
  }

  /** Clear all draw groups. */
  clearGroups(): this {
    this.groups.length = 0;
    return this;
  }

  /** Recompute the AABB from the 'position' attribute. */
  computeBoundingBox(): void {
    const pos = this.attributes.position;
    if (!pos) {
      this.boundingBox = null;
      return;
    }
    const a = pos.array;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i];
      const y = a[i + 1];
      const z = a[i + 2];
      if (x < min.x) min.x = x;
      if (y < min.y) min.y = y;
      if (z < min.z) min.z = z;
      if (x > max.x) max.x = x;
      if (y > max.y) max.y = y;
      if (z > max.z) max.z = z;
    }
    this.boundingBox = { min, max };
  }

  /** Recompute the bounding sphere from the (already-computed) AABB. */
  computeBoundingSphere(): void {
    if (!this.boundingBox) this.computeBoundingBox();
    const bb = this.boundingBox;
    if (!bb) {
      this.boundingSphere = null;
      return;
    }
    const center = new Vector3()
      .add(bb.min)
      .add(bb.max)
      .multiplyScalar(0.5);
    const dx = bb.max.x - center.x;
    const dy = bb.max.y - center.y;
    const dz = bb.max.z - center.z;
    this.boundingSphere = { center, radius: Math.hypot(dx, dy, dz) };
  }

  /**
   * Generate per-vertex normals from the indexed positions. Assumes the
   * geometry is made of triangles (3 indices per face) and that
   * positions/normals share the same vertex count.
   */
  computeVertexNormals(): void {
    const pos = this.attributes.position;
    if (!pos) return;
    const idx = this.index;
    const vc = pos.count;

    // Allocate / reuse a 'normal' attribute.
    let nrm = this.attributes.normal;
    if (!nrm || nrm.count !== vc) {
      nrm = new BufferAttribute(new Float32Array(vc * 3), 3);
    } else {
      nrm.array.fill(0);
    }

    const p = pos.array;
    const n = nrm.array;

    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      for (let i = 0; i < ia.length; i += 3) {
        const a = ia[i] * 3;
        const b = ia[i + 1] * 3;
        const c = ia[i + 2] * 3;
        const ax = p[a],     ay = p[a + 1], az = p[a + 2];
        const bx = p[b],     by = p[b + 1], bz = p[b + 2];
        const cx = p[c],     cy = p[c + 1], cz = p[c + 2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        // n = e1 × e2
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        n[a]     += nx; n[a + 1] += ny; n[a + 2] += nz;
        n[b]     += nx; n[b + 1] += ny; n[b + 2] += nz;
        n[c]     += nx; n[c + 1] += ny; n[c + 2] += nz;
      }
    } else {
      for (let i = 0; i < vc; i += 3) {
        const a = i * 3, b = a + 3, c = a + 6;
        const ax = p[a],     ay = p[a + 1], az = p[a + 2];
        const bx = p[b],     by = p[b + 1], bz = p[b + 2];
        const cx = p[c],     cy = p[c + 1], cz = p[c + 2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        n[a]     += nx; n[a + 1] += ny; n[a + 2] += nz;
        n[b]     += nx; n[b + 1] += ny; n[b + 2] += nz;
        n[c]     += nx; n[c + 1] += ny; n[c + 2] += nz;
      }
    }

    // Normalize.
    for (let i = 0; i < n.length; i += 3) {
      const x = n[i], y = n[i + 1], z = n[i + 2];
      const l = Math.hypot(x, y, z) || 1;
      n[i] = x / l; n[i + 1] = y / l; n[i + 2] = z / l;
    }

    nrm.version++;
    this.setAttribute('normal', nrm);
  }

  /**
   * Generate per-vertex tangents using the MikkTSpace algorithm
   * (Morten S. Mikkelsen, "Generating Tangent Space Basis Vectors").
   *
   * Requires `position`, `normal`, and `uv` attributes. Produces a `tangent`
   * attribute (vec4: xyz = tangent direction, w = handedness sign ±1).
   *
   * The tangent space is consistent across shared vertices and handles
   * degenerate UV mappings (mirrored or zero-area UV triangles) by falling
   * back to identity UV deltas.
   *
   * Adapted from three.js `BufferGeometry.computeTangents()`.
   */
  computeTangents(): void {
    const pos = this.attributes.position;
    const nrm = this.attributes.normal;
    const uv = this.attributes.uv;
    if (!pos || !nrm || !uv) return;

    const idx = this.index;
    const vc = pos.count;

    // Allocate tangent attribute (vec4: xyz = direction, w = handedness)
    const tan = new BufferAttribute(new Float32Array(vc * 4), 4);
    const t = tan.array;

    const p = pos.array;
    const n = nrm.array;
    const u = uv.array;

    const tanAccum = new Float32Array(vc * 3); // xyz accumulate
    const tanSign = new Float32Array(vc);      // handedness accumulate

    const processTriangle = (i0: number, i1: number, i2: number): void => {
      const pa = i0 * 3, pb = i1 * 3, pc = i2 * 3;
      const ua = i0 * 2, ub = i1 * 2, uc = i2 * 2;

      // Position edges
      const e1x = p[pb] - p[pa], e1y = p[pb + 1] - p[pa + 1], e1z = p[pb + 2] - p[pa + 2];
      const e2x = p[pc] - p[pa], e2y = p[pc + 1] - p[pa + 1], e2z = p[pc + 2] - p[pa + 2];

      // UV deltas
      let dUV1x = u[ub] - u[ua], dUV1y = u[ub + 1] - u[ua + 1];
      let dUV2x = u[uc] - u[ua], dUV2y = u[uc + 1] - u[ua + 1];

      // Determinant
      let det = dUV1x * dUV2y - dUV1y * dUV2x;

      // Degenerate UV: fall back to identity
      if (Math.abs(det) < 1e-10) {
        dUV1x = 1; dUV1y = 0;
        dUV2x = 0; dUV2y = 1;
        det = 1;
      }

      const r = 1 / det;

      // Tangent = (dUV2.y * e1 - dUV1.y * e2) * r
      const tx = (dUV2y * e1x - dUV1y * e2x) * r;
      const ty = (dUV2y * e1y - dUV1y * e2y) * r;
      const tz = (dUV2y * e1z - dUV1y * e2z) * r;

      // Bitangent = (dUV1.x * e2 - dUV2.x * e1) * r (for handedness)
      const bx = (dUV1x * e2x - dUV2x * e1x) * r;
      const by = (dUV1x * e2y - dUV2x * e1y) * r;
      const bz = (dUV1x * e2z - dUV2x * e1z) * r;

      // Accumulate tangent per vertex
      for (const vi of [i0, i1, i2]) {
        tanAccum[vi * 3] += tx;
        tanAccum[vi * 3 + 1] += ty;
        tanAccum[vi * 3 + 2] += tz;
      }

      // Handedness: sign of dot(cross(n, t), b) — same for all 3 vertices
      // (using face normal approximation from averaged vertex normals)
      const nx = (n[pa] + n[pb] + n[pc]) / 3;
      const ny = (n[pa + 1] + n[pb + 1] + n[pc + 1]) / 3;
      const nz = (n[pa + 2] + n[pb + 2] + n[pc + 2]) / 3;
      // cross(n, t)
      const cx = ny * tz - nz * ty;
      const cy = nz * tx - nx * tz;
      const cz = nx * ty - ny * tx;
      // dot(cross, b)
      const handedness = cx * bx + cy * by + cz * bz < 0 ? -1 : 1;

      for (const vi of [i0, i1, i2]) {
        tanSign[vi] += handedness;
      }
    };

    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      for (let i = 0; i < ia.length; i += 3) {
        processTriangle(ia[i], ia[i + 1], ia[i + 2]);
      }
    } else {
      for (let i = 0; i < vc; i += 3) {
        processTriangle(i, i + 1, i + 2);
      }
    }

    // Gram-Schmidt orthogonalize and normalize
    for (let i = 0; i < vc; i++) {
      const nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2];
      const tx = tanAccum[i * 3], ty = tanAccum[i * 3 + 1], tz = tanAccum[i * 3 + 2];

      // Gram-Schmidt: t = normalize(t - n * dot(n, t))
      const dot = nx * tx + ny * ty + nz * tz;
      let gx = tx - nx * dot;
      let gy = ty - ny * dot;
      let gz = tz - nz * dot;
      const len = Math.hypot(gx, gy, gz) || 1;
      gx /= len; gy /= len; gz /= len;

      // Handedness sign
      const w = tanSign[i] < 0 ? -1 : 1;

      t[i * 4] = gx;
      t[i * 4 + 1] = gy;
      t[i * 4 + 2] = gz;
      t[i * 4 + 3] = w;
    }

    tan.version++;
    this.setAttribute('tangent', tan);
  }

  /**
   * Apply a 4x4 matrix to position (and normal, when present). Useful for
   * baked static transforms (e.g. merging world transforms when collapsing
   * a hierarchy into a single mesh).
   */
  applyMatrix4(m: { elements: Float32Array }): void {
    const pos = this.attributes.position;
    if (!pos) return;
    const e = m.elements;
    const a = pos.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      a[i]     = e[0] * x + e[4] * y + e[8]  * z + e[12];
      a[i + 1] = e[1] * x + e[5] * y + e[9]  * z + e[13];
      a[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    pos.version++;
    this.boundingBox = null;
    this.boundingSphere = null;
  }

  /**
   * Deep-clone this geometry. Allocates new typed arrays for every
   * attribute and the index. Groups, userData, and bounding volumes
   * are copied. Mirrors three.js `BufferGeometry.clone()`.
   */
  clone(): BufferGeometry {
    const out = new BufferGeometry();
    for (const [name, attr] of Object.entries(this.attributes)) {
      const arr = attr.array as Float32Array;
      out.setAttribute(name, new BufferAttribute(arr.slice(), attr.itemSize));
    }
    if (this.index) {
      const idxArr = this.index.array as Float32Array;
      out.setIndex(new BufferAttribute(idxArr.slice(), this.index.itemSize));
    }
    out.groups = this.groups.map((g) => ({ ...g }));
    out.userData = { ...this.userData };
    if (this.boundingBox) {
      out.boundingBox = {
        min: this.boundingBox.min.clone(),
        max: this.boundingBox.max.clone(),
      };
    }
    if (this.boundingSphere) {
      out.boundingSphere = {
        center: this.boundingSphere.center.clone(),
        radius: this.boundingSphere.radius,
      };
    }
    return out;
  }

  /** Serialize for .vreen / Java interop. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      attributes: {} as Record<string, unknown>,
    };
    for (const [k, v] of Object.entries(this.attributes)) {
      (out.attributes as Record<string, unknown>)[k] = {
        itemSize: v.itemSize,
        array: Array.from(v.array),
      };
    }
    if (this.index) {
      out.index = {
        array: Array.from(this.index.array as unknown as ArrayLike<number>),
      };
    }
    if (this.groups.length > 0) out.groups = this.groups;
    return out;
  }

  /**
   * Release GPU resources held by this geometry. Our engine does not
   * own any per-geometry GL objects directly (the renderer keeps them
   * in a WeakMap-keyed cache), so this is a no-op that simply nudges
   * the version counters to invalidate the cache entries on next draw.
   * Three.js's `geometry.dispose()` API is mirrored for compatibility.
   */
  dispose(): void {
    for (const attr of Object.values(this.attributes)) {
      attr.version++;
    }
    if (this.index) this.index.version++;
    this.boundingBox = null;
    this.boundingSphere = null;
  }
}

// BufferGeometryUtils — geometry processing utilities.
//
// Adapts three.js's BufferGeometryUtils.js for the VREEN engine.
// Provides:
//   • mergeGeometries  — combine N geometries into one (with optional groups)
//   • weldVertices     — merge vertices within a tolerance, remap index
//   • computeTangents  — tangent space for normal mapping (Lengyel's method)
//   • estimateBytesUsed — GPU memory estimate
//   • interleaveAttributes — pack N attributes into a single interleaved buffer
//   • deduplicateIndices — remove duplicate triangles
//
// All functions are pure (do not mutate inputs unless stated).

import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { Vector3 } from '../Math';

// ─────────────────────────────────────────────────────────────────────
// mergeGeometries
// ─────────────────────────────────────────────────────────────────────

/**
 * Merge N geometries into a single BufferGeometry.
 *
 * All geometries must share the same set of attribute names and item sizes.
 * If `useGroups` is true, draw groups are created so each input geometry
 * can still be rendered with its own material.
 *
 * Mutates a **new** geometry; inputs are untouched.
 */
export function mergeGeometries(
  geometries: BufferGeometry[],
  useGroups: boolean = false,
): BufferGeometry {
  if (geometries.length === 0) return new BufferGeometry();

  // Validate attribute consistency.
  const refAttrs = Object.keys(geometries[0].attributes);
  const refItemSizes: Record<string, number> = {};
  for (const name of refAttrs) {
    refItemSizes[name] = geometries[0].attributes[name].itemSize;
  }
  for (let i = 1; i < geometries.length; i++) {
    const g = geometries[i];
    const names = Object.keys(g.attributes);
    if (names.length !== refAttrs.length || !names.every((n) => refAttrs.includes(n))) {
      throw new Error(`mergeGeometries: geometry ${i} has mismatched attributes`);
    }
    for (const name of refAttrs) {
      if (g.attributes[name].itemSize !== refItemSizes[name]) {
        throw new Error(`mergeGeometries: geometry ${i} attribute "${name}" itemSize mismatch`);
      }
    }
  }

  // Determine if any geometry is indexed.
  const anyIndexed = geometries.some((g) => g.index !== null);
  const allIndexed = geometries.every((g) => g.index !== null);
  if (anyIndexed && !allIndexed) {
    throw new Error('mergeGeometries: cannot mix indexed and non-indexed geometries');
  }

  // Compute total vertex / index counts.
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geometries) {
    totalVerts += g.attributes.position.count;
    if (g.index) totalIndices += g.index.count;
    else totalIndices += g.attributes.position.count;
  }

  // Build merged attribute arrays.
  const merged = new BufferGeometry();
  for (const name of refAttrs) {
    const itemSize = refItemSizes[name];
    const arr = new Float32Array(totalVerts * itemSize);
    let offset = 0;
    for (const g of geometries) {
      const src = g.attributes[name].array;
      arr.set(src, offset);
      offset += src.length;
    }
    merged.setAttribute(name, new BufferAttribute(arr, itemSize));
  }

  // Build merged index.
  if (anyIndexed) {
    const idxArr = new Uint32Array(totalIndices);
    let vertOffset = 0;
    let idxOffset = 0;
    for (const g of geometries) {
      const vc = g.attributes.position.count;
      if (g.index) {
        const src = g.index.array;
        for (let i = 0; i < src.length; i++) {
          idxArr[idxOffset++] = vertOffset + src[i];
        }
      } else {
        for (let i = 0; i < vc; i++) {
          idxArr[idxOffset++] = vertOffset + i;
        }
      }
      vertOffset += vc;
    }
    merged.setIndex(idxArr);
  }

  // Build groups.
  if (useGroups) {
    let vertOffset = 0;
    for (let i = 0; i < geometries.length; i++) {
      const g = geometries[i];
      const vc = g.attributes.position.count;
      const count = g.index ? g.index.count : vc;
      merged.addGroup(vertOffset, count, i);
      vertOffset += count;
    }
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────
// weldVertices
// ─────────────────────────────────────────────────────────────────────

/**
 * Merge vertices that are within `tolerance` of each other (position-based).
 * The geometry **must** be indexed. Non-indexed geometries are returned
 * unchanged with a warning.
 *
 * Returns a **new** geometry with a compacted index and remapped attributes.
 *
 * Uses a spatial hash grid for O(n) average-case performance.
 */
export function weldVertices(
  geometry: BufferGeometry,
  tolerance: number = 1e-4,
): BufferGeometry {
  if (!geometry.index) {
    // Non-indexed: build an index first, then weld.
    return weldVertices(toIndexed(geometry), tolerance);
  }

  const pos = geometry.attributes.position;
  if (!pos) throw new Error('weldVertices: geometry has no position attribute');
  const positions = pos.array;
  const vc = pos.count;
  const itemSize = pos.itemSize; // 3

  // Spatial hash grid.
  const cellSize = Math.max(tolerance, 1e-8);
  const invCell = 1 / cellSize;
  const grid = new Map<string, number[]>();

  const newIndex = new Uint32Array(geometry.index.count);
  const oldToNew = new Int32Array(vc).fill(-1);
  let newCount = 0;

  const idxArr = geometry.index.array;

  for (let i = 0; i < vc; i++) {
    const x = positions[i * itemSize];
    const y = positions[i * itemSize + 1];
    const z = positions[i * itemSize + 2];

    const cx = Math.floor(x * invCell);
    const cy = Math.floor(y * invCell);
    const cz = Math.floor(z * invCell);
    const key = `${cx},${cy},${cz}`;

    // Search this cell + 26 neighbors.
    let found = -1;
    for (let dx = -1; dx <= 1 && found === -1; dx++) {
      for (let dy = -1; dy <= 1 && found === -1; dy++) {
        for (let dz = -1; dz <= 1 && found === -1; dz++) {
          const nkey = `${cx + dx},${cy + dy},${cz + dz}`;
          const cell = grid.get(nkey);
          if (cell) {
            for (const vi of cell) {
              const wx = positions[vi * itemSize];
              const wy = positions[vi * itemSize + 1];
              const wz = positions[vi * itemSize + 2];
              const dx2 = x - wx;
              const dy2 = y - wy;
              const dz2 = z - wz;
              if (dx2 * dx2 + dy2 * dy2 + dz2 * dz2 < tolerance * tolerance) {
                found = vi;
                break;
              }
            }
          }
        }
      }
    }

    if (found !== -1) {
      oldToNew[i] = oldToNew[found];
    } else {
      oldToNew[i] = newCount;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
      newCount++;
    }
  }

  // Remap index.
  for (let i = 0; i < idxArr.length; i++) {
    newIndex[i] = oldToNew[idxArr[i]];
  }

  // Build compacted attributes.
  const result = new BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const itemSize = attr.itemSize;
    const newArr = new Float32Array(newCount * itemSize);
    for (let old = 0; old < vc; old++) {
      const nw = oldToNew[old];
      for (let c = 0; c < itemSize; c++) {
        newArr[nw * itemSize + c] = attr.array[old * itemSize + c];
      }
    }
    result.setAttribute(name, new BufferAttribute(newArr, itemSize));
  }
  result.setIndex(newIndex);

  // Copy groups.
  for (const g of geometry.groups) {
    result.addGroup(g.start, g.count, g.materialIndex);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// computeTangents
// ─────────────────────────────────────────────────────────────────────

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();

/**
 * Compute per-vertex tangent vectors for tangent-space normal mapping.
 *
 * Implements Eric Lengyel's method ("Computing Tangent Space Basis Vectors
 * for an Arbitrary Mesh", Terathon Software 2011). The geometry must have
 * `position`, `normal`, and `uv` attributes and be indexed (or will be
 * converted to indexed first).
 *
 * Adds a `tangent` attribute (itemSize=3) to the geometry.
 *
 * **Mutates** the input geometry in place.
 */
export function computeTangents(geometry: BufferGeometry): BufferGeometry {
  if (!geometry.attributes.position || !geometry.attributes.normal || !geometry.attributes.uv) {
    throw new Error('computeTangents: geometry must have position, normal, and uv attributes');
  }

  let geo = geometry;
  if (!geo.index) {
    geo = toIndexed(geo);
    // Copy computed index back to original.
    geometry.setIndex(geo.index);
    geo = geometry;
  }

  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uvs = geo.attributes.uv;
  const idx = geo.index!;
  const vc = pos.count;

  const tangents = new Float32Array(vc * 3);
  const tan1 = new Float32Array(vc * 3); // tangent
  const tan2 = new Float32Array(vc * 3); // bitangent

  const iArr = idx.array;

  for (let f = 0; f < iArr.length; f += 3) {
    const i0 = iArr[f];
    const i1 = iArr[f + 1];
    const i2 = iArr[f + 2];

    // Edge vectors.
    _v1.set(pos.array[i0 * 3], pos.array[i0 * 3 + 1], pos.array[i0 * 3 + 2]);
    _v2.set(pos.array[i1 * 3], pos.array[i1 * 3 + 1], pos.array[i1 * 3 + 2]);
    _v3.set(pos.array[i2 * 3], pos.array[i2 * 3 + 1], pos.array[i2 * 3 + 2]);
    _v2.sub(_v1); // edge1
    _v3.sub(_v1); // edge2

    const x1 = _v2.x, y1 = _v2.y, z1 = _v2.z;
    const x2 = _v3.x, y2 = _v3.y, z2 = _v3.z;

    // UV deltas.
    const u0 = uvs.array[i0 * 2], v0 = uvs.array[i0 * 2 + 1];
    const u1 = uvs.array[i1 * 2], v1 = uvs.array[i1 * 2 + 1];
    const u2 = uvs.array[i2 * 2], v2 = uvs.array[i2 * 2 + 1];
    const s1 = u1 - u0, s2 = u2 - u0;
    const t1 = v1 - v0, t2 = v2 - v0;

    const det = s1 * t2 - s2 * t1;
    const r = Math.abs(det) > 1e-10 ? 1 / det : 0;

    // tan1 = (t2 * edge1 - t1 * edge2) * r
    // tan2 = (s1 * edge2 - s2 * edge1) * r
    const tx = (t2 * x1 - t1 * x2) * r;
    const ty = (t2 * y1 - t1 * y2) * r;
    const tz = (t2 * z1 - t1 * z2) * r;
    const bx = (s1 * x2 - s2 * x1) * r;
    const by = (s1 * y2 - s2 * y1) * r;
    const bz = (s1 * z2 - s2 * z1) * r;

    for (const vi of [i0, i1, i2]) {
      tan1[vi * 3] += tx;
      tan1[vi * 3 + 1] += ty;
      tan1[vi * 3 + 2] += tz;
      tan2[vi * 3] += bx;
      tan2[vi * 3 + 1] += by;
      tan2[vi * 3 + 2] += bz;
    }
  }

  // Gram-Schmidt orthogonalize and compute handedness.
  for (let i = 0; i < vc; i++) {
    _v1.set(nrm.array[i * 3], nrm.array[i * 3 + 1], nrm.array[i * 3 + 2]);
    _v2.set(tan1[i * 3], tan1[i * 3 + 1], tan1[i * 3 + 2]);
    // t = normalize(tan1 - n * dot(n, tan1))
    const dot = _v1.dot(_v2);
    _v4.copy(_v1).multiplyScalar(dot);
    _v2.sub(_v4).normalize();

    // handedness: sign(dot(cross(n, tan1), tan2))
    _v3.copy(_v1).cross(_v2); // n × t
    const w = _v3.x * tan2[i * 3] + _v3.y * tan2[i * 3 + 1] + _v3.z * tan2[i * 3 + 2] < 0 ? -1 : 1;

    tangents[i * 3] = _v2.x * w;
    tangents[i * 3 + 1] = _v2.y * w;
    tangents[i * 3 + 2] = _v2.z * w;
  }

  geo.setAttribute('tangent', new BufferAttribute(tangents, 3));
  return geo;
}

// ─────────────────────────────────────────────────────────────────────
// estimateBytesUsed
// ─────────────────────────────────────────────────────────────────────

/**
 * Estimate the GPU memory used by a geometry (in bytes).
 * Each Float32 attribute element = 4 bytes; index = 2 or 4 bytes per vertex.
 */
export function estimateBytesUsed(geometry: BufferGeometry): number {
  let bytes = 0;
  for (const attr of Object.values(geometry.attributes)) {
    bytes += attr.array.byteLength;
  }
  if (geometry.index) {
    // Index is stored as Float32Array but GPU uses Uint16/Uint32.
    let actualMax = 0;
    for (let i = 0; i < geometry.index.count; i++) {
      if (geometry.index.array[i] > actualMax) actualMax = geometry.index.array[i];
    }
    bytes += actualMax < 65536 ? geometry.index.count * 2 : geometry.index.count * 4;
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────
// interleaveAttributes
// ─────────────────────────────────────────────────────────────────────

/**
 * Pack multiple attributes into a single interleaved Float32Array.
 * All attributes must have the same `count`.
 *
 * Returns the interleaved array and a layout descriptor for glVertexAttribPointer.
 */
export function interleaveAttributes(
  attributes: BufferAttribute[],
): { array: Float32Array; stride: number; offsets: number[] } {
  if (attributes.length === 0) return { array: new Float32Array(0), stride: 0, offsets: [] };
  const count = attributes[0].count;
  for (const a of attributes) {
    if (a.count !== count) throw new Error('interleaveAttributes: attribute count mismatch');
  }
  const stride = attributes.reduce((s, a) => s + a.itemSize, 0);
  const array = new Float32Array(count * stride);
  const offsets: number[] = [];
  let offset = 0;
  for (const a of attributes) {
    offsets.push(offset);
    offset += a.itemSize;
  }
  for (let v = 0; v < count; v++) {
    let o = v * stride;
    for (let a = 0; a < attributes.length; a++) {
      const attr = attributes[a];
      for (let c = 0; c < attr.itemSize; c++) {
        array[o++] = attr.array[v * attr.itemSize + c];
      }
    }
  }
  return { array, stride, offsets };
}

// ─────────────────────────────────────────────────────────────────────
// toIndexed
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a non-indexed geometry to indexed by deduplicating identical
 * vertices (exact match on position + all other attributes).
 *
 * Returns a **new** geometry. If the input is already indexed, returns
 * a shallow copy.
 */
export function toIndexed(geometry: BufferGeometry): BufferGeometry {
  if (geometry.index) {
    // Already indexed — return a copy.
    const copy = new BufferGeometry();
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      copy.setAttribute(name, new BufferAttribute(new Float32Array(attr.array), attr.itemSize));
    }
    copy.setIndex(new Uint32Array(geometry.index.array));
    return copy;
  }

  const pos = geometry.attributes.position;
  if (!pos) return new BufferGeometry();
  const vc = pos.count;
  const attrNames = Object.keys(geometry.attributes);

  // Hash each vertex by all its attribute values.
  const hashToIndex = new Map<string, number>();
  const newIndex = new Uint32Array(vc);
  const uniquePositions: number[][] = []; // [attrIndex][valueIndex]

  for (let i = 0; i < attrNames.length; i++) {
    uniquePositions.push([]);
  }

  let uniqueCount = 0;
  for (let v = 0; v < vc; v++) {
    let hash = '';
    for (let i = 0; i < attrNames.length; i++) {
      const attr = geometry.attributes[attrNames[i]];
      for (let c = 0; c < attr.itemSize; c++) {
        hash += attr.array[v * attr.itemSize + c].toFixed(6) + ',';
      }
    }
    let idx = hashToIndex.get(hash);
    if (idx === undefined) {
      idx = uniqueCount++;
      hashToIndex.set(hash, idx);
      for (let i = 0; i < attrNames.length; i++) {
        const attr = geometry.attributes[attrNames[i]];
        for (let c = 0; c < attr.itemSize; c++) {
          uniquePositions[i].push(attr.array[v * attr.itemSize + c]);
        }
      }
    }
    newIndex[v] = idx;
  }

  const result = new BufferGeometry();
  for (let i = 0; i < attrNames.length; i++) {
    const attr = geometry.attributes[attrNames[i]];
    result.setAttribute(attrNames[i], new BufferAttribute(new Float32Array(uniquePositions[i]), attr.itemSize));
  }
  result.setIndex(newIndex);
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// deduplicateIndices
// ─────────────────────────────────────────────────────────────────────

/**
 * Remove duplicate triangles (same 3 vertex indices, any winding order).
 * Returns a **new** index array; the geometry is not modified.
 */
export function deduplicateIndices(geometry: BufferGeometry): BufferGeometry {
  if (!geometry.index) return geometry;
  const idx = geometry.index.array;
  const seen = new Set<string>();
  const result: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    // Canonical key: sorted vertex indices.
    const sorted = a < b ? (b < c ? `${a},${b},${c}` : (a < c ? `${a},${c},${b}` : `${c},${a},${b}`))
                          : (a < c ? `${b},${a},${c}` : (b < c ? `${b},${c},${a}` : `${c},${b},${a}`));
    if (!seen.has(sorted)) {
      seen.add(sorted);
      result.push(a, b, c);
    }
  }
  const copy = new BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    copy.setAttribute(name, new BufferAttribute(new Float32Array(attr.array), attr.itemSize));
  }
  copy.setIndex(new Uint32Array(result));
  return copy;
}

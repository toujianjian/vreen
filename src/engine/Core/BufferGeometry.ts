// BufferGeometry — collection of BufferAttributes (position, normal, uv, ...)
// plus an optional index buffer. Mirrors three.js's API surface for the
// subset the WebGL2 renderer actually uses.
//
// Storage rule: every attribute is one of two vertex-attribute carriers —
//   • BufferAttribute            — owns a (usually Float32Array) array, compact
//                                   layout `index * itemSize + component`.
//   • InterleavedBufferAttribute — references a shared InterleavedBuffer slice,
//                                   layout `index * data.stride + offset + comp`.
// Both carriers expose the same getX/Y/Z/W + setX/Y/Z/W + count API, so every
// traversal below reads/writes through those methods and is transparent to the
// packing. The BufferAttribute "compact" path stays byte-identical to before
// (getX etc. just index `array[i * itemSize + c]`); interleaved support is the
// new capability, mirroring three.js `BufferGeometry` duck-typing on
// `isInterleavedBufferAttribute`.
//
// The renderer is responsible for uploading each carrier to a GL buffer and
// bumping versions to detect CPU-side writes.

import { BufferAttribute } from './BufferAttribute';
import { InterleavedBufferAttribute } from './InterleavedBufferAttribute';
import type { InterleavedBuffer } from './InterleavedBuffer';
import { Vector3 } from '../Math';

/** Either carrier accepted as a vertex attribute on BufferGeometry. */
export type BufferAttributeLike = BufferAttribute | InterleavedBufferAttribute;

export class BufferGeometry {
  /** Vertex attributes keyed by semantic name (e.g. 'position', 'normal'). */
  attributes: Record<string, BufferAttributeLike> = {};
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

  setAttribute(name: string, attribute: BufferAttributeLike): this {
    this.attributes[name] = attribute;
    return this;
  }

  getAttribute(name: string): BufferAttributeLike | undefined {
    return this.attributes[name];
  }

  /** True iff `name` is set on this geometry. */
  hasAttribute(name: string): boolean {
    return this.attributes[name] !== undefined;
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
    // 通用读取:对 compact BufferAttribute 走 array[i*3],对 interleaved 走
    // stride+offset。getX/Y/Z 两者签名一致,透明支持交错布局。
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
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

  // ───────────────────────────────────────────────────────────────────
  // 交错感知读取辅助。
  // 两种承载类都实现 getX/Y/Z/W + setX/Y/Z/W + count;但 computeVertexNormals /
  // computeTangents 的内层 tight loop 需要按顶点顺序读连续 itemSize 个分量。
  // 对 compact 属性,最快的方式仍是裸 array 下标;对 interleaved 属性,分量在
  // stride 内连续,但起点是 index*stride+offset。
  // 为兼顾性能与正确性,这里按 isInterleavedBufferAttribute 标志(唯一分流位,
  // 与 three.js 一致)分派:compact 走 fast path(原裸下标,字节级不变),
  // interleaved 走 getX/Y/Z 通用路径。
  // ───────────────────────────────────────────────────────────────────

  /** 读取一个 itemSize=3 属性第 index 顶点的 xyz,写入给定向量。 */
  private static _readXYZ(
    attr: BufferAttributeLike, index: number, out: { x: number; y: number; z: number },
  ): void {
    if ((attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      out.x = attr.getX(index);
      out.y = attr.getY(index);
      out.z = attr.getZ(index);
    } else {
      const a = (attr as BufferAttribute).array;
      const o = index * attr.itemSize;
      out.x = a[o];
      out.y = a[o + 1];
      out.z = a[o + 2];
    }
  }

  /** 读取一个 itemSize=2 属性第 index 顶点的 xy,写入给定向量。 */
  private static _readXY(
    attr: BufferAttributeLike, index: number, out: { x: number; y: number },
  ): void {
    if ((attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      out.x = attr.getX(index);
      out.y = attr.getY(index);
    } else {
      const a = (attr as BufferAttribute).array;
      const o = index * attr.itemSize;
      out.x = a[o];
      out.y = a[o + 1];
    }
  }

  /**
   * Generate per-vertex normals from the indexed positions. Assumes the
   * geometry is made of triangles (3 indices per face) and that
   * positions/normals share the same vertex count.
   *
   * 对交错属性透明:position 可为 InterleavedBufferAttribute(经 getX/Y/Z 寻址);
   * 产物 normal 永远写进新建的独立 BufferAttribute(three.js 语义——计算产物脱离
   * 共享 buffer,避免改写交错布局影响同 buffer 的其它属性切片)。
   */
  computeVertexNormals(): void {
    const pos = this.attributes.position;
    if (!pos) return;
    const idx = this.index;
    const vc = pos.count;

    // Allocate / reuse a 'normal' attribute (always a compact BufferAttribute).
    let nrm = this.attributes.normal;
    if (!nrm || nrm instanceof InterleavedBufferAttribute || nrm.count !== vc) {
      nrm = new BufferAttribute(new Float32Array(vc * 3), 3);
    } else {
      nrm.array.fill(0);
    }

    const n = nrm.array;
    const v0 = { x: 0, y: 0, z: 0 };
    const v1 = { x: 0, y: 0, z: 0 };
    const v2 = { x: 0, y: 0, z: 0 };

    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      for (let i = 0; i < ia.length; i += 3) {
        const a = ia[i], b = ia[i + 1], c = ia[i + 2];
        BufferGeometry._readXYZ(pos, a, v0);
        BufferGeometry._readXYZ(pos, b, v1);
        BufferGeometry._readXYZ(pos, c, v2);
        const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
        const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
        // n = e1 × e2
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        n[a * 3]     += nx; n[a * 3 + 1] += ny; n[a * 3 + 2] += nz;
        n[b * 3]     += nx; n[b * 3 + 1] += ny; n[b * 3 + 2] += nz;
        n[c * 3]     += nx; n[c * 3 + 1] += ny; n[c * 3 + 2] += nz;
      }
    } else {
      for (let i = 0; i < vc; i += 3) {
        BufferGeometry._readXYZ(pos, i, v0);
        BufferGeometry._readXYZ(pos, i + 1, v1);
        BufferGeometry._readXYZ(pos, i + 2, v2);
        const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
        const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        n[i * 3]     += nx; n[i * 3 + 1] += ny; n[i * 3 + 2] += nz;
        n[(i + 1) * 3]     += nx; n[(i + 1) * 3 + 1] += ny; n[(i + 1) * 3 + 2] += nz;
        n[(i + 2) * 3]     += nx; n[(i + 2) * 3 + 1] += ny; n[(i + 2) * 3 + 2] += nz;
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
   * 对交错属性透明:position/normal/uv 可为 InterleavedBufferAttribute(经
   * getX/Y/Z 寻址);产物 tangent 永远写进新建的独立 BufferAttribute(与
   * computeVertexNormals 一致——计算产物脱离共享 buffer)。
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

    // Allocate tangent attribute (vec4: xyz = direction, w = handedness);
    // always compact — computation product, independent of interleaved layout.
    const tan = new BufferAttribute(new Float32Array(vc * 4), 4);
    const t = tan.array;

    const pv = { x: 0, y: 0, z: 0 };
    const nv = { x: 0, y: 0, z: 0 };
    // 复用槽位:三个顶点的 UV(各一组 xy),避免 processTriangle 内反复分配。
    const uv0 = { x: 0, y: 0 };
    const uv1 = { x: 0, y: 0 };
    const uv2 = { x: 0, y: 0 };

    const tanAccum = new Float32Array(vc * 3); // xyz accumulate
    const tanSign = new Float32Array(vc);      // handedness accumulate

    const processTriangle = (i0: number, i1: number, i2: number): void => {
      BufferGeometry._readXYZ(pos, i0, pv);
      const ax = pv.x, ay = pv.y, az = pv.z;
      BufferGeometry._readXYZ(pos, i1, pv);
      const bx = pv.x, by = pv.y, bz = pv.z;
      BufferGeometry._readXYZ(pos, i2, pv);
      const cx = pv.x, cy = pv.y, cz = pv.z;

      BufferGeometry._readXY(uv, i0, uv0);
      BufferGeometry._readXY(uv, i1, uv1);
      BufferGeometry._readXY(uv, i2, uv2);

      // Position edges
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

      // UV deltas(dUV1 = uv1 - uv0, dUV2 = uv2 - uv0,与原版裸下标数值一致)
      let dUV1x = uv1.x - uv0.x, dUV1y = uv1.y - uv0.y;
      let dUV2x = uv2.x - uv0.x, dUV2y = uv2.y - uv0.y;

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
      const btx = (dUV1x * e2x - dUV2x * e1x) * r;
      const bty = (dUV1x * e2y - dUV2x * e1y) * r;
      const btz = (dUV1x * e2z - dUV2x * e1z) * r;

      // Accumulate tangent per vertex
      for (const vi of [i0, i1, i2]) {
        tanAccum[vi * 3] += tx;
        tanAccum[vi * 3 + 1] += ty;
        tanAccum[vi * 3 + 2] += tz;
      }

      // Handedness: sign of dot(cross(n, t), b) — same for all 3 vertices
      // (using face normal approximation from averaged vertex normals).
      // 读取三个顶点法线取平均作面法线近似。
      BufferGeometry._readXYZ(nrm, i0, pv);
      const n0x = pv.x, n0y = pv.y, n0z = pv.z;
      BufferGeometry._readXYZ(nrm, i1, pv);
      const n1x = pv.x, n1y = pv.y, n1z = pv.z;
      BufferGeometry._readXYZ(nrm, i2, pv);
      const n2x = pv.x, n2y = pv.y, n2z = pv.z;
      const nx = (n0x + n1x + n2x) / 3;
      const ny = (n0y + n1y + n2y) / 3;
      const nz = (n0z + n1z + n2z) / 3;
      // cross(n, t)
      const cxn = ny * tz - nz * ty;
      const cyn = nz * tx - nx * tz;
      const czn = nx * ty - ny * tx;
      // dot(cross, b)
      const handedness = cxn * btx + cyn * bty + czn * btz < 0 ? -1 : 1;

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

    // Gram-Schmidt orthogonalize and normalize. normal 读取走通用路径以支持交错。
    for (let i = 0; i < vc; i++) {
      BufferGeometry._readXYZ(nrm, i, nv);
      const nx = nv.x, ny = nv.y, nz = nv.z;
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
   *
   * 对交错属性透明:position/normal/tangent 若为 InterleavedBufferAttribute,
   * 委托其自带的 applyMatrix4/applyNormalMatrix/transformDirection(三者已按
   * stride+offset 寻址实现);compact 属性走内联 fast path(原裸 array 下标)。
   */
  applyMatrix4(m: { elements: Float32Array }): void {
    const pos = this.attributes.position;
    if (!pos) return;
    const e = m.elements;
    if ((pos as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      // 委托:InterleavedBufferAttribute.applyMatrix4 内部走 getX/Y/Z + setXYZ。
      (pos as InterleavedBufferAttribute).applyMatrix4(
        m as unknown as import('../Math/Matrix4').Matrix4,
      );
    } else {
      const a = (pos as BufferAttribute).array;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], y = a[i + 1], z = a[i + 2];
        a[i]     = e[0] * x + e[4] * y + e[8]  * z + e[12];
        a[i + 1] = e[1] * x + e[5] * y + e[9]  * z + e[13];
        a[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      (pos as BufferAttribute).version++;
    }
    this.boundingBox = null;
    this.boundingSphere = null;
  }

  /**
   * Deep-clone this geometry. Allocates new typed arrays for every
   * attribute and the index. Groups, userData, and bounding volumes
   * are copied. Mirrors three.js `BufferGeometry.clone()`.
   *
   * 对交错属性:传共享 `data` 上下文给 InterleavedBufferAttribute.clone,使同
   * 一底层 InterleavedBuffer 被多条属性复用一次克隆(而非每条属性各拷一份)。
   */
  clone(): BufferGeometry {
    const out = new BufferGeometry();
    // 共享 data 容器:让多条 interleaved 属性复用同一克隆出的底层 buffer。
    const cloneData: { interleavedBuffers?: Record<string, import('./InterleavedBuffer').InterleavedBuffer> } = {};
    for (const [name, attr] of Object.entries(this.attributes)) {
      if ((attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        // 保留交错语义:按 ib uuid 去重复用底层 buffer。
        out.setAttribute(name, (attr as InterleavedBufferAttribute).clone(cloneData));
      } else {
        const arr = (attr as BufferAttribute).array as Float32Array;
        out.setAttribute(name, new BufferAttribute(arr.slice(), attr.itemSize));
      }
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

  /**
   * Convert an indexed geometry to a non-indexed one by duplicating vertices
   * per triangle (展开索引). Mirrors three.js `BufferGeometry.toNonIndexed()`.
   *
   * 对交错属性透明(three.js `convertBufferAttribute` 语义):按 `index*stride+offset`
   * 取每个被引用顶点的 itemSize 个连续分量,展开到新的紧凑 array;产物永远是
   * 独立 BufferAttribute(交错布局被拍平)。
   *
   * 非 indexed 几何体已是非索引,直接返回 this(three.js 行为:warn + return this)。
   */
  toNonIndexed(): BufferGeometry {
    if (this.index === null) {
      return this;
    }

    const geometry2 = new BufferGeometry();
    const indices = this.index.array as unknown as ArrayLike<number>;
    const attributes = this.attributes;

    // 对单个属性(可能 compact 或 interleaved)按索引展开为紧凑 BufferAttribute。
    const convertBufferAttribute = (
      attribute: BufferAttributeLike,
      idxArr: ArrayLike<number>,
    ): BufferAttribute => {
      const itemSize = attribute.itemSize;
      const sourceArr = (attribute as BufferAttribute).array as ArrayLike<number>;
      // interleaved 起点偏移(index*stride+offset),compact 起点为 index*itemSize。
      const isInterleaved = (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
      const stride = isInterleaved ? (attribute as InterleavedBufferAttribute).data.stride : itemSize;
      const offset = isInterleaved ? (attribute as InterleavedBufferAttribute).offset : 0;

      // Ctor 与源同种(Float32Array/Uint16 等),产出可写目标 array;BufferAttribute 构造
      // 会在内部统一转 Float32Array,以此从任意量化整型 de-interleave 出来的属性恢复为浮点。
      const Ctor = (sourceArr as unknown as Float32Array).constructor as new (length: number) => ArrayLike<number>;
      const array2 = new Ctor(idxArr.length * itemSize) as unknown as number[];

      let index = 0;
      let index2 = 0;
      for (let i = 0, l = idxArr.length; i < l; i++) {
        const vi = idxArr[i];
        index = isInterleaved ? vi * stride + offset : vi * itemSize;
        for (let j = 0; j < itemSize; j++) {
          array2[index2++] = (sourceArr as unknown as ArrayLike<number>)[index++];
        }
      }
      return new BufferAttribute(array2 as unknown as Float32Array, itemSize);
    };

    for (const name in attributes) {
      geometry2.setAttribute(name, convertBufferAttribute(attributes[name], indices));
    }

    // groups 直接复制(start/count 基于 indices,与三层一致)。
    for (let i = 0, l = this.groups.length; i < l; i++) {
      const group = this.groups[i];
      geometry2.addGroup(group.start, group.count, group.materialIndex);
    }

    return geometry2;
  }

  /**
   * Serialize for .vreen / Java interop.
   *
   * 对交错属性(three.js `toJSON` 的 interleaved 路径):用共享 `data` 容器(含
   * `interleavedBuffers` / `arrayBuffers` 两层去重字典)传给各 InterleavedBufferAttribute
   * .toJSON,使共享同一 InterleavedBuffer / 同一底层 ArrayBuffer 的多条属性只输出一份
   * 二进制。产出的 JSON 形如:
   *   { attributes: { position: { isInterleavedBufferAttribute, itemSize, data: <ib uuid>, offset, normalized } } }
   * 并附带顶层 `interleavedBuffers`(ib 元数据)与 `arrayBuffers`(UInt32 视图字节)。
   *
   * compact 属性仍走原路径(独立 array),保持既有 .vreen 格式向后兼容。
   */
  toJSON(): Record<string, unknown> {
    const hasInterleaved = Object.values(this.attributes).some(
      (a) => (a as InterleavedBufferAttribute).isInterleavedBufferAttribute === true,
    );

    const out: Record<string, unknown> = {
      attributes: {} as Record<string, unknown>,
    };

    if (hasInterleaved) {
      // 交错属性走引用式序列化:
      // ① 对每条交错属性调 InterleavedBufferAttribute.toJSON(meta) 拿 attr JSON
      //   (只含 {isInterleavedBufferAttribute,itemSize,data:ib.uuid,offset,normalized}),
      //   该方法顺带把 ib 实例按 uuid 去重登记进 meta.interleavedBuffers(实例引用,
      //   InterleavedBuffer.test.ts 的既有契约,这里我们不消费它,只取返回的 attr JSON)。
      // ② 再遍历所有唯一 ib,逐一调 ib.toJSON(meta) 填充 meta.arrayBuffers(纯数据
      //   Uint32 视图,供反序列化重建字节),并把 ib 的 JSON 纯数据(含 buffer/type/stride)
      //   组装进顶层 interleavedBuffers 字典。共享同一 ib / 同一底层 ArrayBuffer 的
      //   多条属性经这两层 uuid 去重后只输出一份二进制。
      // meta 兼容两类去重协议:InterleavedBufferAttribute.toJSON 读 meta.interleavedBuffers,
      // InterleavedBuffer.toJSON 读 meta.arrayBuffers;本方法只用 arrayBuffers(填字节),
      // interleavedBuffers 顶层字典由本方法自己组织纯数据(ib.toJSON 结果)。
      const meta: {
        interleavedBuffers?: Record<string, InterleavedBuffer>;
        arrayBuffers?: Record<string, number[]>;
      } = {};
      const ibJson: Record<string, unknown> = {};

      for (const [k, v] of Object.entries(this.attributes)) {
        if ((v as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
          const ib = (v as InterleavedBufferAttribute).data;
          (out.attributes as Record<string, unknown>)[k] = (v as InterleavedBufferAttribute).toJSON(meta);
          if (ibJson[ib.uuid] === undefined) {
            ibJson[ib.uuid] = ib.toJSON(meta);
          }
        } else {
          (out.attributes as Record<string, unknown>)[k] = {
            itemSize: v.itemSize,
            array: Array.from((v as BufferAttribute).array),
          };
        }
      }

      (out as Record<string, unknown>).interleavedBuffers = ibJson;
      if (meta.arrayBuffers) {
        (out as Record<string, unknown>).arrayBuffers = meta.arrayBuffers;
      }
    } else {
      // compact 路径:独立 array,保持既有 .vreen 格式向后兼容。
      for (const [k, v] of Object.entries(this.attributes)) {
        (out.attributes as Record<string, unknown>)[k] = {
          itemSize: v.itemSize,
          array: Array.from((v as BufferAttribute).array),
        };
      }
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
      if ((attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        // 交错属性没有自己的 version,转标脏到底层 buffer(驱动重传)。
        (attr as InterleavedBufferAttribute).needsUpdate = true;
      } else {
        (attr as BufferAttribute).version++;
      }
    }
    if (this.index) this.index.version++;
    this.boundingBox = null;
    this.boundingSphere = null;
  }
}

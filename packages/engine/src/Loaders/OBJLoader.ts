// OBJLoader — minimal Wavefront OBJ parser. Produces a `Group` whose
// children are `Mesh` objects (one per `o` / `g` block) with our engine's
// `BufferGeometry` and a `StandardMaterial` per `usemtl` reference.
//
// Scope: the subset the VREEN toolchain actually needs:
//   - v / vn / vt
//   - f with `v/vt/vn` triples, `v//vn` doubles, or `v` bare integers
//   - triangle and quad faces
//   - 1-based positive indices AND negative (relative-to-end) indices
//   - `o`, `g`, `usemtl` group breaks
// Not supported: smoothing groups (`s`), NURBS, free-form surfaces, MTL
// file parsing. (We just record the material name on the mesh and let
// the caller assign a real material.)
//
// Usage:
//   const objText = await (await fetch(url)).text();
//   const { root, materials } = parseOBJ(objText);

import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';

export interface OBJMaterialRef {
  name: string;
  material: StandardMaterial;
}

export interface ParsedOBJ {
  root: Group;
  /** Material refs encountered, keyed by name. */
  materials: Record<string, OBJMaterialRef>;
}

export function parseOBJ(text: string): ParsedOBJ {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv:  number[] = [];

  const root = new Group();
  root.name = 'OBJ_ROOT';
  const mats: Record<string, OBJMaterialRef> = {};

  let cur: ActiveMesh | null = null;

  function ensureCurrent(name: string): ActiveMesh {
    if (cur) return cur;
    cur = new ActiveMesh(name);
    return cur;
  }

  function flush() {
    if (!cur) return;
    if (cur.positions.length === 0) { cur = null; return; }
    const geom = buildGeometry(cur);
    const mat = cur.materialRef
      ? mats[cur.materialRef]?.material ?? defaultMaterial()
      : defaultMaterial();
    const mesh = new Mesh(geom, mat);
    mesh.name = cur.name;
    root.add(mesh);
    cur = null;
  }

  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const hash = raw.indexOf('#');
    if (hash !== -1) raw = raw.slice(0, hash);
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];

    switch (tag) {
      case 'v': {
        pos.push(+parts[1], +parts[2], +parts[3]);
        break;
      }
      case 'vn': {
        nor.push(+parts[1], +parts[2], +parts[3]);
        break;
      }
      case 'vt': {
        uv.push(+parts[1], +(parts[2] ?? 0));
        break;
      }
      case 'f': {
        const m = ensureCurrent('OBJ');
        const faceVerts: number[] = [];
        for (let i = 1; i < parts.length; i++) {
          const tok = parts[i];
          if (!tok) continue;
          const seg = tok.split('/');
          const pi = resolveIndex(+seg[0], pos.length / 3);
          const ti = seg[1] ? resolveIndex(+seg[1], uv.length / 2) : -1;
          const ni = seg[2] ? resolveIndex(+seg[2], nor.length / 3) : -1;
          const out = m.pushVertex(pi, ti, ni, pos, uv, nor);
          faceVerts.push(out);
        }
        for (let i = 1; i < faceVerts.length - 1; i++) {
          m.indices.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
        }
        break;
      }
      case 'o':
      case 'g': {
        flush();
        cur = new ActiveMesh(parts.slice(1).join('_') || 'OBJ');
        break;
      }
      case 'usemtl': {
        const m = ensureCurrent('OBJ');
        const name = parts[1];
        if (!mats[name]) {
          mats[name] = { name, material: defaultMaterial(name) };
        }
        m.materialRef = name;
        break;
      }
      case 'mtllib':
      case 's':
        // Ignored.
        break;
      default:
        break;
    }
  }
  flush();
  return { root, materials: mats };
}

class ActiveMesh {
  name: string;
  positions: number[] = [];
  normals:   number[] = [];
  uvs:       number[] = [];
  indices:   number[] = [];
  materialRef: string | null = null;
  /** Dedup map: "pi/ti/ni" -> output index. */
  private dedup = new Map<string, number>();

  constructor(name: string) {
    this.name = name;
  }

  pushVertex(pi: number, ti: number, ni: number, pos: number[], uv: number[], nor: number[]): number {
    const key = `${pi}/${ti}/${ni}`;
    const existing = this.dedup.get(key);
    if (existing !== undefined) {
      this.indices.push(existing);
      return existing;
    }
    const out = this.positions.length / 3;
    const p = readTri(pos, pi);
    this.positions.push(p[0], p[1], p[2]);
    if (ni >= 0) {
      const n = readTri(nor, ni);
      this.normals.push(n[0], n[1], n[2]);
    }
    if (ti >= 0) {
      const t = readVec2(uv, ti);
      this.uvs.push(t[0], t[1]);
    }
    this.dedup.set(key, out);
    this.indices.push(out);
    return out;
  }
}

function resolveIndex(idx: number, max: number): number {
  if (idx > 0) return idx - 1;
  if (idx < 0) return max + idx;
  return 0;
}

function readTri(pool: number[], i: number): [number, number, number] {
  const o = i * 3;
  if (o < 0 || o + 2 >= pool.length) return [0, 0, 0];
  return [pool[o], pool[o + 1], pool[o + 2]];
}
function readVec2(pool: number[], i: number): [number, number] {
  const o = i * 2;
  if (o < 0 || o + 1 >= pool.length) return [0, 0];
  return [pool[o], pool[o + 1]];
}

function buildGeometry(m: ActiveMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from(m.positions), 3));
  if (m.normals.length === m.positions.length) {
    g.setAttribute('normal', new BufferAttribute(Float32Array.from(m.normals), 3));
  }
  if (m.uvs.length === (m.positions.length / 3) * 2) {
    g.setAttribute('uv', new BufferAttribute(Float32Array.from(m.uvs), 2));
  }
  if (m.normals.length !== m.positions.length) g.computeVertexNormals();
  g.setIndex(m.indices.length < 65536 ? Uint16Array.from(m.indices) : Uint32Array.from(m.indices));
  g.computeBoundingBox();
  return g;
}

function defaultMaterial(name?: string): StandardMaterial {
  const m = new StandardMaterial();
  if (name) m.userData['__mtlName'] = name;
  return m;
}

// ColladaLoader — simplified Collada (.dae) parser. Adapted from three.js
// `src/loaders/ColladaLoader.js` (MIT). Collada is an XML-based 3D asset
// format; the full spec is very large (animations, skinning, physics,
// cameras, lights), so this implementation covers only the subset the
// VREEN toolchain needs:
//   - <library_geometries> <geometry> with <mesh>:
//       <source> (positions / normals / UVs as <float_array>)
//       <vertices> (maps POSITION semantic to a source)
//       <triangles> or <polylist> (indices + material reference)
//   - <library_materials> + <library_effects>:
//       <phong> / <lambert> <diffuse><color>R G B A</color></diffuse>
//   - <library_visual_scenes> <node> hierarchy:
//       <translate> / <rotate> / <scale> + <instance_geometry>
// Not supported: animations, controllers (skinning), physics, lights,
// cameras, multiple UV sets, textures.
//
// Node/test compatibility: DOMParser is not available in Node, so we ship
// a minimal recursive-descent XML parser (see `parseXML` below). It handles
// well-formed XML with elements, attributes, self-closing tags, text
// content, comments, and the XML declaration. It does NOT handle DTDs,
// CDATA sections, or namespaces (Collada uses a no-namespace default).

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Mesh } from '../Core/Mesh';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Group } from '../Core/Group';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { createLogger } from '@/lib/logger';

const log = createLogger('ColladaLoader');

/** Parse result: a scene graph plus lookup tables for assets. */
export interface ColladaParseResult {
  /** Root group containing the node hierarchy with attached meshes. */
  scene: Group;
  /** All parsed geometries keyed by geometry id (without '#'). */
  geometries: Map<string, BufferGeometry>;
  /** All parsed materials keyed by material id (without '#'). */
  materials: Map<string, StandardMaterial>;
}

// ── Minimal XML DOM ──────────────────────────────────────────────

/** A single XML element: tag, attributes, child elements, and text. */
interface XMLElement {
  tag: string;
  attrs: Record<string, string>;
  children: XMLElement[];
  text: string;
}

/**
 * Parse a well-formed XML string into a tree of XMLElement nodes.
 * Handles: XML declaration, comments, attributes (single/double quotes),
 * self-closing tags, nested elements, and text content.
 * Does NOT handle: DTDs, CDATA, entity references beyond named entities.
 */
function parseXML(xml: string): XMLElement | null {
  // Strip XML declaration and comments.
  xml = xml.replace(/<\?[^>]*\?>/g, '');
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  let pos = 0;

  function skipWS(): void {
    while (pos < xml.length && /\s/.test(xml[pos])) pos++;
  }

  function parseElement(): XMLElement | null {
    if (pos >= xml.length || xml[pos] !== '<') return null;
    pos++; // skip '<'

    // Tag name
    let tag = '';
    while (pos < xml.length && !/\s/.test(xml[pos]) && xml[pos] !== '>' && xml[pos] !== '/') {
      tag += xml[pos++];
    }

    // Attributes
    const attrs: Record<string, string> = {};
    while (pos < xml.length && xml[pos] !== '>' && xml[pos] !== '/') {
      skipWS();
      if (xml[pos] === '>' || xml[pos] === '/') break;
      let name = '';
      while (pos < xml.length && xml[pos] !== '=' && !/\s/.test(xml[pos]) && xml[pos] !== '>' && xml[pos] !== '/') {
        name += xml[pos++];
      }
      skipWS();
      if (xml[pos] === '=') {
        pos++; // '='
        skipWS();
        const quote = xml[pos];
        pos++; // opening quote
        let val = '';
        while (pos < xml.length && xml[pos] !== quote) val += xml[pos++];
        pos++; // closing quote
        attrs[name] = val;
      } else {
        attrs[name] = '';
      }
    }

    if (xml[pos] === '/') {
      pos++; // '/'
      pos++; // '>'
      return { tag, attrs, children: [], text: '' };
    }

    pos++; // '>'

    const children: XMLElement[] = [];
    let text = '';
    while (pos < xml.length) {
      if (xml[pos] === '<') {
        if (xml[pos + 1] === '/') {
          // closing tag
          pos += 2;
          while (pos < xml.length && xml[pos] !== '>') pos++;
          pos++; // '>'
          break;
        }
        const child = parseElement();
        if (child) children.push(child);
      } else {
        text += xml[pos++];
      }
    }

    return { tag, attrs, children, text };
  }

  skipWS();
  return parseElement();
}

// ── XML helpers ──────────────────────────────────────────────────

/** Find the first direct child with the given tag. */
function child(el: XMLElement | null, tag: string): XMLElement | null {
  if (!el) return null;
  for (const c of el.children) if (c.tag === tag) return c;
  return null;
}

/** Find all direct children with the given tag. */
function children(el: XMLElement | null, tag: string): XMLElement[] {
  if (!el) return [];
  return el.children.filter((c) => c.tag === tag);
}

/** Find all descendants (any depth) with the given tag. */
function descendants(el: XMLElement | null, tag: string): XMLElement[] {
  if (!el) return [];
  const out: XMLElement[] = [];
  function walk(e: XMLElement): void {
    for (const c of e.children) {
      if (c.tag === tag) out.push(c);
      walk(c);
    }
  }
  walk(el);
  return out;
}

/** Parse a whitespace-separated list of floats. */
function parseFloats(text: string): number[] {
  return text.trim().split(/\s+/).filter((s) => s.length > 0).map(Number);
}

/** Parse a whitespace-separated list of integers. */
function parseInts(text: string): number[] {
  return text.trim().split(/\s+/).filter((s) => s.length > 0).map((s) => parseInt(s, 10));
}

/** Strip a leading '#' from a URL reference. */
function refId(url: string): string {
  return url.startsWith('#') ? url.slice(1) : url;
}

const DEG2RAD = Math.PI / 180;

// ── Source / input parsing ───────────────────────────────────────

interface SourceData {
  id: string;
  data: number[];
  stride: number;
}

/** Parse a <source> element into { id, data, stride }. */
function parseSource(src: XMLElement): SourceData {
  const id = src.attrs['id'] ?? '';
  const floatArr = child(src, 'float_array');
  const data = floatArr ? parseFloats(floatArr.text) : [];
  let stride = 3;
  const tech = child(src, 'technique_common');
  if (tech) {
    const accessor = child(tech, 'accessor');
    if (accessor) {
      const s = accessor.attrs['stride'];
      if (s) stride = parseInt(s, 10);
    }
  }
  return { id, data, stride };
}

interface Input {
  semantic: string;
  source: string; // source id (without '#')
  offset: number;
  set?: string;
}

/** Parse <input> elements under a <triangles>/<polylist>. */
function parseInputs(parent: XMLElement): Input[] {
  return children(parent, 'input').map((inp) => ({
    semantic: inp.attrs['semantic'] ?? '',
    source: refId(inp.attrs['source'] ?? ''),
    offset: inp.attrs['offset'] !== undefined ? parseInt(inp.attrs['offset'], 10) : 0,
    set: inp.attrs['set'],
  }));
}

// ── Geometry parsing ─────────────────────────────────────────────

/**
 * Parse a <geometry><mesh> into a BufferGeometry.
 * Handles <triangles> and <polylist> (triangulating quads/n-gons via fan).
 */
function parseGeometry(geomEl: XMLElement): BufferGeometry {
  const mesh = child(geomEl, 'mesh');
  if (!mesh) return new BufferGeometry();

  // Collect all <source> by id.
  const sources = new Map<string, SourceData>();
  for (const src of children(mesh, 'source')) {
    const sd = parseSource(src);
    sources.set(sd.id, sd);
  }

  // <vertices> maps the POSITION semantic to a source.
  const verticesEl = child(mesh, 'vertices');
  const vertInputs = verticesEl ? parseInputs(verticesEl) : [];

  // Determine which primitive to use.
  let tris = children(mesh, 'triangles');
  let polys = children(mesh, 'polylist');
  // Some meshes nest under <triangles> with material; pick the first non-empty.
  if (tris.length === 0 && polys.length === 0) {
    // Try descendants (in case of extra nesting).
    tris = descendants(mesh, 'triangles');
    polys = descendants(mesh, 'polylist');
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function appendVertex(input: Input, vidx: number): void {
    // VERTEX semantic points to a <vertices> element (not a <source>);
    // resolve its sub-inputs (POSITION, and optionally NORMAL/TEXCOORD
    // declared under <vertices>).
    if (input.semantic === 'VERTEX') {
      for (const vi of vertInputs) {
        const vsrc = sources.get(vi.source);
        if (!vsrc) continue;
        const stride = vsrc.stride || 3;
        const base = vidx * stride;
        if (vi.semantic === 'POSITION') {
          positions.push(vsrc.data[base] ?? 0, vsrc.data[base + 1] ?? 0, vsrc.data[base + 2] ?? 0);
        } else if (vi.semantic === 'NORMAL') {
          normals.push(vsrc.data[base] ?? 0, vsrc.data[base + 1] ?? 0, vsrc.data[base + 2] ?? 0);
        } else if (vi.semantic === 'TEXCOORD' || vi.semantic === 'UV') {
          uvs.push(vsrc.data[base] ?? 0, vsrc.data[base + 1] ?? 0);
        }
      }
      return;
    }

    // NON-VERTEX inputs (NORMAL/TEXCOORD) point directly to a <source>.
    const src = sources.get(input.source);
    if (!src) return;
    const stride = src.stride || 3;
    const base = vidx * stride;
    if (input.semantic === 'POSITION') {
      positions.push(src.data[base] ?? 0, src.data[base + 1] ?? 0, src.data[base + 2] ?? 0);
    } else if (input.semantic === 'NORMAL') {
      normals.push(src.data[base] ?? 0, src.data[base + 1] ?? 0, src.data[base + 2] ?? 0);
    } else if (input.semantic === 'TEXCOORD' || input.semantic === 'UV') {
      uvs.push(src.data[base] ?? 0, src.data[base + 1] ?? 0);
    }
  }

  let vcount = 0;

  for (const tri of tris) {
    const inputs = parseInputs(tri);
    const maxOffset = inputs.reduce((m, i) => Math.max(m, i.offset), 0);
    const stride = maxOffset + 1;
    const p = child(tri, 'p');
    const idx = p ? parseInts(p.text) : [];
    for (let i = 0; i < idx.length; i += stride) {
      const vertStart = positions.length / 3;
      for (const inp of inputs) {
        appendVertex(inp, idx[i + inp.offset]);
      }
      // triangles: every 3 vertices form a triangle.
      if ((i / stride) % 3 === 0) {
        indices.push(vertStart, vertStart + 1, vertStart + 2);
      }
      vcount++;
    }
  }

  for (const poly of polys) {
    const inputs = parseInputs(poly);
    const maxOffset = inputs.reduce((m, i) => Math.max(m, i.offset), 0);
    const stride = maxOffset + 1;
    const vcEl = child(poly, 'vcount');
    const vcountArr = vcEl ? parseInts(vcEl.text) : [];
    const p = child(poly, 'p');
    const idx = p ? parseInts(p.text) : [];

    let cursor = 0;
    for (const n of vcountArr) {
      // Collect n vertices for this polygon.
      const verts: number[] = [];
      for (let k = 0; k < n; k++) {
        for (const inp of inputs) {
          appendVertex(inp, idx[cursor + inp.offset]);
        }
        verts.push(positions.length / 3 - 1);
        cursor += stride;
      }
      // Fan triangulation.
      for (let k = 1; k < verts.length - 1; k++) {
        indices.push(verts[0], verts[k], verts[k + 1]);
      }
      vcount += n;
    }
  }

  const geometry = new BufferGeometry();
  if (positions.length > 0) {
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  }
  if (normals.length > 0) {
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  }
  if (uvs.length > 0) {
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  }
  if (indices.length > 0) {
    geometry.setIndex(indices);
  }
  return geometry;
}

// ── Material parsing ─────────────────────────────────────────────

/** Parse <library_effects> + <library_materials> into StandardMaterials. */
function parseMaterials(
  root: XMLElement,
): Map<string, StandardMaterial> {
  const out = new Map<string, StandardMaterial>();
  // effect id → color {r,g,b}
  const effectColor = new Map<string, { r: number; g: number; b: number }>();

  for (const eff of descendants(root, 'effect')) {
    const eid = eff.attrs['id'] ?? '';
    // Find first <phong> or <lambert> under any profile.
    let shader: XMLElement | null = child(eff, 'profile_COMMON');
    let phong: XMLElement | null = null;
    if (shader) {
      phong = child(shader, 'phong') ?? child(shader, 'lambert');
    }
    if (!phong) {
      // search descendants
      phong = descendants(eff, 'phong')[0] ?? descendants(eff, 'lambert')[0] ?? null;
    }
    if (!phong) continue;
    const diffuse = child(phong, 'diffuse');
    let color = { r: 0.8, g: 0.8, b: 0.8 };
    if (diffuse) {
      const c = child(diffuse, 'color');
      if (c) {
        const parts = parseFloats(c.text);
        if (parts.length >= 3) {
          color = { r: parts[0], g: parts[1], b: parts[2] };
        }
      }
    }
    effectColor.set(eid, color);
  }

  for (const mat of descendants(root, 'material')) {
    const mid = mat.attrs['id'] ?? '';
    const inst = child(mat, 'instance_effect');
    const m = new StandardMaterial();
    if (inst) {
      const eid = refId(inst.attrs['url'] ?? '');
      const col = effectColor.get(eid);
      if (col) m.baseColor = { ...col };
    }
    out.set(mid, m);
  }

  return out;
}

// ── Node hierarchy parsing ───────────────────────────────────────

/**
 * Parse a <node> element into an Object3D, recursing into child nodes and
 * attaching instanced geometries as Mesh children.
 */
function parseNode(
  nodeEl: XMLElement,
  geometries: Map<string, BufferGeometry>,
  materials: Map<string, StandardMaterial>,
  bindMaterial: Map<string, string>,
): Object3D {
  const obj: Object3D = nodeEl.attrs['type'] === 'NODE' ? new Group() : new Group();
  obj.name = nodeEl.attrs['name'] ?? nodeEl.attrs['id'] ?? '';
  if (nodeEl.attrs['id']) obj.userData['id'] = nodeEl.attrs['id'];

  // Apply transforms in document order (Collada transforms are cumulative).
  for (const c of nodeEl.children) {
    if (c.tag === 'translate') {
      const v = parseFloats(c.text);
      if (v.length >= 3) obj.position.set(v[0], v[1], v[2]);
    } else if (c.tag === 'scale') {
      const v = parseFloats(c.text);
      if (v.length >= 3) obj.scale.set(v[0], v[1], v[2]);
    } else if (c.tag === 'rotate') {
      const v = parseFloats(c.text);
      if (v.length >= 4) {
        const axis = new Vector3(v[0], v[1], v[2]);
        const angle = v[3] * DEG2RAD;
        const q = new Quaternion();
        q.setFromAxisAngle(axis, angle);
        // Collada applies rotations in order; multiply onto current.
        obj.rotation.multiply(q);
      }
    } else if (c.tag === 'instance_geometry') {
      const url = refId(c.attrs['url'] ?? '');
      const geom = geometries.get(url);
      if (geom) {
        // Resolve bound material via <bind_material>.
        const bm = child(c, 'bind_material');
        let mat: StandardMaterial | undefined;
        if (bm) {
          const ti = descendants(bm, 'technique_common')[0];
          if (ti) {
            const im = child(ti, 'instance_material');
            if (im) {
              const target = refId(im.attrs['target'] ?? '');
              mat = materials.get(target);
            }
          }
        }
        const material = mat ?? new StandardMaterial();
        const mesh = new Mesh(geom, material);
        mesh.name = url;
        obj.add(mesh);
      }
    } else if (c.tag === 'node') {
      const childObj = parseNode(c, geometries, materials, bindMaterial);
      obj.add(childObj);
    } else if (c.tag === 'instance_node') {
      // Basic instance_node reference — skip resolution for now (simplified).
    }
  }

  return obj;
}

// ── Loader class ─────────────────────────────────────────────────

/**
 * Simplified Collada (.dae) loader. Parses an XML string and returns a
 * scene Group plus lookup tables for geometries and materials.
 *
 * Adapted from three.js ColladaLoader (MIT). Skips: animations,
 * controllers/skinning, physics, lights, cameras, textures.
 */
export class ColladaLoader {
  /** Parse a Collada .dae XML string. */
  parse(text: string): ColladaParseResult {
    const scene = new Group();
    scene.name = 'ColladaScene';
    const geometries = new Map<string, BufferGeometry>();
    const materials = new Map<string, StandardMaterial>();

    const root = parseXML(text);
    if (!root) {
      log.warn('parse: failed to parse XML (empty or malformed)');
      return { scene, geometries, materials };
    }

    // 1. Geometries.
    for (const g of descendants(root, 'geometry')) {
      const id = g.attrs['id'] ?? '';
      if (!id) continue;
      const geom = parseGeometry(g);
      if (geom.attributes.position) geometries.set(id, geom);
    }

    // 2. Materials (effects + materials).
    const mats = parseMaterials(root);
    for (const [k, v] of mats) materials.set(k, v);

    // 3. Node hierarchy from <library_visual_scenes>.
    const bindMaterial = new Map<string, string>();
    const sceneNodes: XMLElement[] = [];
    for (const vs of descendants(root, 'visual_scene')) {
      for (const n of children(vs, 'node')) sceneNodes.push(n);
    }
    // Fallback: <library_nodes> top-level nodes (some exporters).
    if (sceneNodes.length === 0) {
      for (const ln of descendants(root, 'library_nodes')) {
        for (const n of children(ln, 'node')) sceneNodes.push(n);
      }
    }
    // Fallback: any top-level <node> descendants.
    if (sceneNodes.length === 0) {
      const allNodes = descendants(root, 'node');
      for (const n of allNodes) sceneNodes.push(n);
    }

    for (const n of sceneNodes) {
      const obj = parseNode(n, geometries, materials, bindMaterial);
      scene.add(obj);
    }

    log.info('parsed Collada', {
      geometries: geometries.size,
      materials: materials.size,
      nodes: scene.children.length,
    });

    return { scene, geometries, materials };
  }
}

// ── Convenience function form ────────────────────────────────────

/** Parse a Collada .dae XML string (function shorthand). */
export function parseCollada(text: string): ColladaParseResult {
  return new ColladaLoader().parse(text);
}

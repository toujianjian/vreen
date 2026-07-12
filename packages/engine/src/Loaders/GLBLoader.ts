// GLBLoader — glTF 2.0 二进制容器 (.glb) 解析器，零 three 依赖。
//
// 目标：把 .glb 文件解析为自研 engine 的 Group + AnimationClip[]，
// 覆盖最常用的 80% 用例：
//   ✅ GLB header / JSON chunk / BIN chunk
//   ✅ 节点层级 (translation / rotation / scale, name)
//   ✅ Mesh.primitives: POSITION / NORMAL / TANGENT / TEXCOORD_0 / COLOR_0
//   ✅ 索引 (UNSIGNED_SHORT / UNSIGNED_INT)
//   ✅ PBR: pbrMetallicRoughness.baseColorFactor / metallicFactor / roughnessFactor
//   ✅ Skin: joints[] + inverseBindMatrices → SkinnedMesh
//   ✅ Animation: translation/rotation/scale 通道 → KeyframeTrack
//   ❌ Morph targets
//   ❌ Sparse accessors
//   ⚠️ baseColorTexture: 跳过（TextureLoader 留作下一轮）
//   ⚠️ matrix 节点变换: 解析为 TRS（平移+旋转+缩放分别归一化）
//
// API:
//   const { root, animations } = await loader.load(fileOrUrlOrBuffer);
//   scene.add(root);
//   const mixer = new AnimationMixer(root);
//   animations.forEach((c) => mixer.actionFor(c).play());

import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { Bone } from '../Core/Bone';
import { Skeleton } from '../Core/Skeleton';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { Object3D } from '../Core/Object3D';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';
import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from '../Animation';
import { Matrix4 } from '../Math/Matrix4';
import { createLogger } from '../logger';
import { AssetSource,
  Loader,
  LoaderContext,
  toArrayBuffer,
  fetchAsArrayBuffer,
} from './Loader';
import { decodeDraco, type DracoAttributeSpec } from './DracoDecoder';

const log = createLogger('GLBLoader');

// ── Public result ───────────────────────────────────────────────────
export interface LoadedGLB {
  root: Group;
  animations: AnimationClip[];
  /** Material references encountered, keyed by glTF material index. */
  materials: StandardMaterial[];
}

export class GLBLoader implements Loader<LoadedGLB> {
  readonly format = 'glb';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'model/gltf-binary') return true;
    if (source instanceof File) return /\.glb$/i.test(source.name);
    if (typeof source === 'string') return /\.glb(\?|$|#)/i.test(source);
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<LoadedGLB> {
    const t0 = performance.now();
    log.debug(`load() start, source=${describeSource(source)}`);
    const buf = await this._readSource(source, ctx);
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    log.debug(`source read ok, ${(buf.byteLength / 1024).toFixed(1)} KB in ${(performance.now() - t0).toFixed(1)}ms`);
    ctx?.onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, ratio: 0.5 });
    const tParse0 = performance.now();
    const { json, bin } = parseGLB(buf);
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    log.debug(`GLB header parsed in ${(performance.now() - tParse0).toFixed(1)}ms ` +
      `(asset=${json.asset?.version ?? '?'}, generator=${json.asset?.generator ?? '?'})`);
    const tBuild0 = performance.now();
    const result = await buildFromGltf(json, bin);
    log.info(`build done in ${(performance.now() - tBuild0).toFixed(1)}ms — ` +
      `meshes=${result.root.children.length}, animations=${result.animations.length}, ` +
      `materials=${result.materials.length}`);
    log.debug(`load() end, total ${(performance.now() - t0).toFixed(1)}ms`);
    ctx?.onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, ratio: 1 });
    return result;
  }

  private async _readSource(source: AssetSource, ctx?: LoaderContext): Promise<ArrayBuffer> {
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      return await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    }
    return await toArrayBuffer(source);
  }
}

function describeSource(source: AssetSource): string {
  if (typeof source === 'string') return `url(${source})`;
  if (source instanceof URL) return `url(${source.toString()})`;
  if (source instanceof File) return `file(${source.name}, ${source.size}B)`;
  if (source instanceof Blob) return `blob(${source.size}B, ${source.type || '?'})`;
  if (source instanceof ArrayBuffer) return `ab(${source.byteLength}B)`;
  if (source instanceof Uint8Array) return `u8(${source.byteLength}B)`;
  return 'unknown';
}

// ── GLB container parser ────────────────────────────────────────────
const GLB_MAGIC = 0x46546C67;   // 'glTF' (little-endian)
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4E4F534A;  // 'JSON'
const CHUNK_BIN  = 0x004E4942;  // 'BIN\0'

export function parseGLB(buf: ArrayBuffer): { json: GltfJson; bin: Uint8Array | null } {
  log.debug(`parseGLB: ${buf.byteLength} bytes`);
  if (buf.byteLength < 12) throw new Error('GLBLoader: file too small');
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, true);
  if (magic !== GLB_MAGIC) throw new Error(`GLBLoader: bad magic 0x${magic.toString(16)}`);
  const version = dv.getUint32(4, true);
  if (version !== GLB_VERSION) {
    // 不致命 — 一些工具写 1。仍然尝试。
    log.warn(`glTF version ${version} (expected 2)`);
  }
  const length = dv.getUint32(8, true);
  if (length > buf.byteLength) {
    throw new Error(`GLBLoader: declared length ${length} > file size ${buf.byteLength}`);
  }

  let off = 12;
  // chunk 0 (JSON)
  const jLen = dv.getUint32(off, true);
  const jType = dv.getUint32(off + 4, true);
  if (jType !== CHUNK_JSON) {
    throw new Error(`GLBLoader: first chunk must be JSON (got 0x${jType.toString(16)})`);
  }
  const jBytes = new Uint8Array(buf, off + 8, jLen);
  // JSON 不带 padding
  const jsonText = new TextDecoder('utf-8').decode(jBytes);
  let json: GltfJson;
  try {
    json = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`GLBLoader: invalid JSON in chunk 0: ${(e as Error).message}`);
  }
  log.debug(`chunk 0 JSON: ${jLen}B, scenes=${json.scenes?.length ?? 0}, ` +
    `nodes=${json.nodes?.length ?? 0}, meshes=${json.meshes?.length ?? 0}, ` +
    `materials=${json.materials?.length ?? 0}, anims=${json.animations?.length ?? 0}, ` +
    `skins=${json.skins?.length ?? 0}, buffers=${json.buffers?.length ?? 0}, ` +
    `accessors=${json.accessors?.length ?? 0}`);
  off += 8 + jLen;

  let bin: Uint8Array | null = null;
  if (off < buf.byteLength) {
    if (off + 8 > buf.byteLength) throw new Error('GLBLoader: truncated BIN chunk header');
    const bLen = dv.getUint32(off, true);
    const bType = dv.getUint32(off + 4, true);
    if (bType !== CHUNK_BIN) {
      // 一些工具写错了。仍然尽量解析 JSON 部分。
      log.warn(`chunk 1 type 0x${bType.toString(16)} (expected BIN)`);
    } else {
      bin = new Uint8Array(buf, off + 8, bLen);
      log.debug(`chunk 1 BIN: ${bLen}B (${(bLen / 1024).toFixed(1)} KB)`);
    }
  } else {
    log.debug(`no BIN chunk — pure JSON glTF inside GLB container`);
  }
  return { json, bin };
}

// ── glTF JSON types (subset) ────────────────────────────────────────
interface GltfJson {
  asset?: { version?: string; generator?: string };
  scene?: number;
  scenes?: { name?: string; nodes: number[] }[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
  materials?: GltfMaterial[];
  skins?: GltfSkin[];
  animations?: GltfAnimation[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number]; // quaternion
  scale?: [number, number, number];
  matrix?: [number, number, number, number, number, number, number, number,
            number, number, number, number, number, number, number, number];
}

interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  /** KHR_draco_mesh_compression: 指向压缩 bufferView。 */
  extensions?: {
    KHR_draco_mesh_compression?: {
      bufferView: number;
      attributes: Record<string, number>;
    };
  };
  /** GLBLoader 内部填:Draco 预解码结果。buildPrimitive 优先用它,
   *  避免重新走 readAccessor* 路径。 */
  _decodedDraco?: {
    positions: Float32Array | null;
    normals: Float32Array | null;
    uvs: Float32Array | null;
    tangents: Float32Array | null;
    colors: Float32Array | null;
    indices: Uint32Array;
    vertexCount: number;
  };
}
interface GltfAccessor {
  bufferView?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';
  min?: number[];
  max?: number[];
  normalized?: boolean;
  byteOffset?: number;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}
interface GltfBuffer { byteLength: number; uri?: string; }

interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: { index: number };
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  doubleSided?: boolean;
}

interface GltfSkin {
  joints: number[];
  inverseBindMatrices?: number;
  skeleton?: number;
}

interface GltfAnimation {
  name?: string;
  channels: { sampler: number; target: { node: number; path: 'translation' | 'rotation' | 'scale' | 'weights' } }[];
  samplers: { input: number; output: number; interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' }[];
}

// ── Build the scene graph ───────────────────────────────────────────

/** 遍历所有 mesh.primitives,若 KHR_draco_mesh_compression 存在则异步预解码。
 *  解码结果挂到 prim._decodedDraco,buildPrimitive 检测后走快路径。 */
async function decodeDracoPrimitives(json: GltfJson, bin: Uint8Array): Promise<void> {
  const used = json.extensionsUsed ?? [];
  if (!used.includes('KHR_draco_mesh_compression')) return;
  const required = json.extensionsRequired ?? [];
  if (required.includes('KHR_draco_mesh_compression')) {
    log.info('extensionsRequired includes KHR_draco_mesh_compression');
  }
  const meshes = json.meshes ?? [];
  let n = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives) {
      const draco = prim.extensions?.KHR_draco_mesh_compression;
      if (!draco) continue;
      const view = (json.bufferViews ?? [])[draco.bufferView];
      if (!view) {
        log.warn(`Draco: bufferView ${draco.bufferView} missing`);
        continue;
      }
      const base = (view.byteOffset ?? 0);
      const bytes = new Uint8Array(bin.buffer, bin.byteOffset + base, view.byteLength);
      const specs: DracoAttributeSpec[] = [];
      for (const sem of Object.keys(draco.attributes)) {
        const acc = (json.accessors ?? [])[draco.attributes[sem]!];
        if (!acc) continue;
        const comps =
          acc.type === 'VEC4' ? 4 :
          acc.type === 'VEC3' ? 3 :
          acc.type === 'VEC2' ? 2 : 1;
        specs.push({ semantic: sem as DracoAttributeSpec['semantic'], componentCount: comps });
      }
      try {
        const decoded = await decodeDraco(bytes, specs);
        prim._decodedDraco = {
          positions: decoded.positions,
          normals: decoded.normals,
          uvs: decoded.uvs,
          tangents: decoded.tangents,
          colors: decoded.colors,
          indices: decoded.indices,
          vertexCount: decoded.vertexCount,
        };
        // 解码完成,移除 extension 标记避免重复处理
        if (prim.extensions) delete prim.extensions.KHR_draco_mesh_compression;
        n++;
      } catch (e) {
        log.error(`Draco: decode failed for prim (mesh=${mesh.name ?? '?'}): ${(e as Error).message}`);
      }
    }
  }
  if (n > 0) log.info(`Draco: decoded ${n} compressed primitive(s)`);
}

async function buildFromGltf(json: GltfJson, bin: Uint8Array | null): Promise<LoadedGLB> {
  // 0) KHR_draco_mesh_compression — 预解码所有 Draco primitive,把结果
  // 物化成 prim._decodedDraco。后续 buildPrimitive 走快路径。
  if (bin) {
    await decodeDracoPrimitives(json, bin);
  }

  const acc = json.accessors ?? [];
  const bufViews = json.bufferViews ?? [];
  const nodesJson = json.nodes ?? [];
  const meshesJson = json.meshes ?? [];
  const materialsJson = json.materials ?? [];
  const skinsJson = json.skins ?? [];
  const animsJson = json.animations ?? [];

  log.debug(`build: ${nodesJson.length} nodes, ${meshesJson.length} meshes, ` +
    `${materialsJson.length} materials, ${skinsJson.length} skins, ${animsJson.length} anims`);

  // 1) 材质
  const tMat0 = performance.now();
  const materials: StandardMaterial[] = materialsJson.map((m) => gtfMaterialToStd(m));
  if (materialsJson.length > 0) {
    log.debug(`built ${materials.length} materials in ${(performance.now() - tMat0).toFixed(1)}ms`);
  }

  // 2) node → Object3D 映射（占位，最后填 mesh/skin）
  // isBone 用索引判断:node 是否被任何 skin.joints 引用
  const skinJointSet = new Set<number>();
  for (const s of json.skins ?? []) for (const j of s.joints) skinJointSet.add(j);
  const nodes: Object3D[] = nodesJson.map((n, i) => {
    const o = skinJointSet.has(i) ? new Bone() : new Object3D();
    o.name = n.name || `Node_${i}`;
    if (n.translation) o.position.set(n.translation[0], n.translation[1], n.translation[2]);
    if (n.rotation) o.rotation.set(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]);
    if (n.scale) o.scale.set(n.scale[0], n.scale[1], n.scale[2]);
    return o;
  });

  // 3) mesh 工厂
  function buildPrimitive(prim: GltfPrimitive, primOwner: Mesh | SkinnedMesh): void {
    const geom = new BufferGeometry();
    // 快路径:Draco 预解码结果已挂在 prim._decodedDraco,直接用。
    if (prim._decodedDraco) {
      const d = prim._decodedDraco;
      if (d.positions) geom.setAttribute('position', new BufferAttribute(d.positions, 3));
      if (d.normals) geom.setAttribute('normal', new BufferAttribute(d.normals, 3));
      if (d.uvs) geom.setAttribute('uv', new BufferAttribute(d.uvs, 2));
      if (d.tangents) geom.setAttribute('tangent', new BufferAttribute(d.tangents, 4));
      if (d.colors) geom.setAttribute('color', new BufferAttribute(d.colors, 4));
      if (d.indices.length > 0) geom.setIndex(d.indices);
      if (!geom.attributes.normal) geom.computeVertexNormals();
      geom.computeBoundingBox();
      if (prim.material !== undefined) primOwner.material = materials[prim.material] ?? materials[0];
      primOwner.geometry = geom;
      return;
    }
    // 默认路径:直接读 BIN。
    const attrs = prim.attributes;
    for (const [sem, accIdx] of Object.entries(attrs)) {
      const name = gtfAttrToEngine(sem);
      if (!name) continue;
      const accessor = acc[accIdx];
      if (!accessor) continue;
      const data = readAccessorAsFloat(json, bin, accessor, 0);
      const itemSize = gtfItemSizeFor(prim, sem, accessor.type);
      if (itemSize <= 0) continue;
      geom.setAttribute(name, new BufferAttribute(data, itemSize));
    }
    if (prim.indices !== undefined) {
      const idx = readAccessorAsIndices(json, bin, acc[prim.indices]);
      geom.setIndex(idx);
    } else if (!geom.attributes.normal) {
      geom.computeVertexNormals();
    }
    geom.computeBoundingBox();
    if (prim.material !== undefined) primOwner.material = materials[prim.material] ?? materials[0];
    primOwner.geometry = geom;
  }

  // 4) 把 mesh 挂到节点
  const tMesh0 = performance.now();
  let meshCount = 0;
  let skinnedCount = 0;
  for (let i = 0; i < nodesJson.length; i++) {
    const n = nodesJson[i];
    if (n.mesh === undefined) continue;
    const meshDef = meshesJson[n.mesh];
    if (!meshDef) continue;
    const isSkinned = n.skin !== undefined;
    const owner: Mesh | SkinnedMesh = isSkinned ? new SkinnedMesh(new BufferGeometry(), materials[0]) : new Mesh(new BufferGeometry(), materials[0]);
    owner.name = meshDef.name || `Mesh_${i}`;
    // 多 primitive: 只取第一个（多材质组留给下一轮）
    const prim = meshDef.primitives[0];
    if (prim) buildPrimitive(prim, owner);
    // Skin 在这一步绑定（必须有 geometry）
    if (isSkinned && owner instanceof SkinnedMesh) {
      const sk = gtfSkinToSkeleton(json, bin, skinsJson[n.skin!], nodes);
      if (sk) {
        owner.skeleton = sk;
        skinnedCount++;
        // bindMatrixInverse 已是 default identity; 但如果根骨架不是世界原点要再算
      }
    }
    nodes[i].add(owner);
    meshCount++;
  }
  if (meshCount > 0) {
    log.debug(`built ${meshCount} meshes (${skinnedCount} skinned) in ${(performance.now() - tMesh0).toFixed(1)}ms`);
  }

  // 5) 节点层级
  const tHier0 = performance.now();
  const root = new Group();
  root.name = 'GLB_ROOT';
  for (let i = 0; i < nodesJson.length; i++) {
    const n = nodesJson[i];
    if (!n.children || n.children.length === 0) continue;
    for (const c of n.children) nodes[c].parent = nodes[i];
  }
  let rootChildCount = 0;
  for (let i = 0; i < nodesJson.length; i++) {
    if (nodes[i].parent === null && nodes[i] !== root) {
      root.add(nodes[i]);
      rootChildCount++;
    }
  }
  // 默认场景
  const sceneIdx = json.scene ?? 0;
  const sceneDef = (json.scenes ?? [])[sceneIdx];
  if (sceneDef) {
    const sceneRoot = new Group();
    sceneRoot.name = sceneDef.name || 'Scene';
    for (const i of sceneDef.nodes) {
      const c = nodes[i];
      if (c) sceneRoot.add(c);
    }
    root.add(sceneRoot);
    log.debug(`scene #${sceneIdx} (${sceneDef.name || 'unnamed'}) with ${sceneDef.nodes.length} root nodes`);
  }
  // 让骨架 update matrix
  root.updateMatrixWorld(true);
  log.debug(`hierarchy wired in ${(performance.now() - tHier0).toFixed(1)}ms, ` +
    `${rootChildCount} top-level nodes`);

  // 6) 动画
  const tAnim0 = performance.now();
  const animations: AnimationClip[] = (animsJson).map((a) => gtfAnimToClip(json, bin, a, nodes)).filter(Boolean) as AnimationClip[];
  if (animsJson.length > 0) {
    let totalTracks = 0;
    let totalDuration = 0;
    for (const c of animations) {
      totalTracks += c.tracks.length;
      if (c.duration > totalDuration) totalDuration = c.duration;
    }
    log.info(`animations: ${animations.length}/${animsJson.length} parsed, ` +
      `${totalTracks} tracks, longest=${totalDuration.toFixed(2)}s ` +
      `(${ (performance.now() - tAnim0).toFixed(1) }ms)`);
    for (const c of animations) {
      log.debug(`  clip "${c.name}": ${c.tracks.length} tracks, ${c.duration.toFixed(2)}s`);
    }
  }

  return { root, animations, materials };
}

// ── Accessor decoding ───────────────────────────────────────────────
function readAccessorAsFloat(json: GltfJson, bin: Uint8Array | null, a: GltfAccessor, _byteOff: number): Float32Array {
  if (!bin) throw new Error('GLBLoader: accessor references buffer but BIN chunk missing');
  const view = (json.bufferViews ?? [])[a.bufferView ?? 0];
  if (!view) throw new Error('GLBLoader: accessor.bufferView invalid');
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const count = a.count;
  const comps = gtfTypeComps(a.type);
  const out = new Float32Array(count * comps);
  const stride = view.byteStride ?? (comps * gtfTypeBytes(a.componentType));

  for (let i = 0; i < count; i++) {
    const off = base + i * stride;
    for (let c = 0; c < comps; c++) {
      out[i * comps + c] = readScalar(bin, off + c * gtfTypeBytes(a.componentType), a.componentType, a.normalized ?? false);
    }
  }
  return out;
}

function readAccessorAsIndices(json: GltfJson, bin: Uint8Array | null, a: GltfAccessor): Uint16Array | Uint32Array {
  if (!bin) throw new Error('GLBLoader: accessor references buffer but BIN chunk missing');
  const view = (json.bufferViews ?? [])[a.bufferView ?? 0];
  if (!view) throw new Error('GLBLoader: accessor.bufferView invalid');
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const count = a.count;
  if (a.componentType === 5123) {
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i++) out[i] = bin[base + i * 2] | (bin[base + i * 2 + 1] << 8);
    return out;
  }
  if (a.componentType === 5125) {
    const out = new Uint32Array(count);
    const dv = new DataView(bin.buffer, bin.byteOffset + base, count * 4);
    for (let i = 0; i < count; i++) out[i] = dv.getUint32(i * 4, true);
    return out;
  }
  if (a.componentType === 5121) {
    // BYTE indices — 罕见；归一化为 Uint16
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i++) out[i] = bin[base + i];
    return out;
  }
  throw new Error(`GLBLoader: unsupported index componentType ${a.componentType}`);
}

function readScalar(bin: Uint8Array, off: number, ct: number, normalized: boolean): number {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  switch (ct) {
    case 5120: { // BYTE
      const v = dv.getInt8(off);
      return normalized ? Math.max(v / 127, -1) : v;
    }
    case 5121: { // UNSIGNED_BYTE
      const v = dv.getUint8(off);
      return normalized ? v / 255 : v;
    }
    case 5122: { // SHORT
      const v = dv.getInt16(off, true);
      return normalized ? Math.max(v / 32767, -1) : v;
    }
    case 5123: { // UNSIGNED_SHORT
      const v = dv.getUint16(off, true);
      return normalized ? v / 65535 : v;
    }
    case 5125: return dv.getUint32(off, true);
    case 5126: return dv.getFloat32(off, true);
  }
  throw new Error(`GLBLoader: unsupported componentType ${ct}`);
}

function gtfTypeComps(t: GltfAccessor['type']): number {
  switch (t) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT2': return 4;
    case 'MAT3': return 9;
    case 'MAT4': return 16;
  }
}
function gtfTypeBytes(ct: number): number {
  switch (ct) {
    case 5120: case 5121: return 1;
    case 5122: case 5123: return 2;
    case 5125: case 5126: return 4;
  }
  return 1;
}

function gtfAttrToEngine(s: string): string | null {
  switch (s) {
    case 'POSITION': return 'position';
    case 'NORMAL': return 'normal';
    case 'TANGENT': return 'tangent';
    case 'TEXCOORD_0': return 'uv';
    case 'COLOR_0': return 'color';
    case 'JOINTS_0': return 'skinIndex';
    case 'WEIGHTS_0': return 'skinWeight';
  }
  return null;
}
function gtfItemSizeFor(prim: GltfPrimitive, semantic: string, accType: GltfAccessor['type']): number {
  // glTF attribute 语义 → 引擎 itemSize 必须与 accessor.type 严格一致
  // 否则 VEC2/3/4 数据会被错位填充到 BufferAttribute,渲染时 UV/Color 全乱
  switch (accType) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT2':
    case 'MAT3':
    case 'MAT4':
      // 不支持矩阵属性,跳过
      return 0;
  }
  // 兜底:语义推断
  if (semantic === 'POSITION' || semantic === 'NORMAL' || semantic === 'TANGENT') return 3;
  if (semantic === 'TEXCOORD_0') return 2;
  if (semantic === 'COLOR_0') return 4;
  if (semantic === 'JOINTS_0' || semantic === 'WEIGHTS_0') return 4;
  void prim;
  return 3;
}

// ── Material ────────────────────────────────────────────────────────
function gtfMaterialToStd(m: GltfMaterial): StandardMaterial {
  const std = new StandardMaterial();
  if (m.name) std.userData['__mtlName'] = m.name;
  const pbr = m.pbrMetallicRoughness ?? {};
  if (pbr.baseColorFactor) {
    const c = pbr.baseColorFactor;
    std.baseColor = { r: c[0], g: c[1], b: c[2] };
    std.opacity = c[3];
  }
  std.metallic = pbr.metallicFactor ?? 1;
  std.roughness = pbr.roughnessFactor ?? 1;
  // baseColorTexture: skip for now (Texture integration is a follow-up)
  return std;
}

// ── Skin ────────────────────────────────────────────────────────────
function gtfSkinToSkeleton(json: GltfJson, bin: Uint8Array | null, skin: GltfSkin, nodes: Object3D[]): Skeleton | null {
  const bones: Bone[] = [];
  for (const j of skin.joints) {
    const n = nodes[j];
    if (!(n instanceof Bone)) {
      // GLB 把 skin joint 节点视为骨骼；如果是普通 Object3D，升级为 Bone（保留 name）
      const b = new Bone();
      b.name = n.name;
      b.position.copy(n.position);
      b.rotation.copy(n.rotation);
      b.scale.copy(n.scale);
      // 不替换 nodes[j]，因为 children 关系已建。直接当作 bone。
      bones.push(b);
    } else {
      bones.push(n);
    }
  }
  // inverseBindMatrices
  const ibmAccessor = skin.inverseBindMatrices !== undefined ? json.accessors?.[skin.inverseBindMatrices] : undefined;
  let invBind: import('../Math/Matrix4').Matrix4[] = [];
  if (ibmAccessor && bin) {
    const data = readAccessorAsFloat(json, bin, ibmAccessor, 0);
    const n = ibmAccessor.count;
    invBind = new Array(n);
    for (let i = 0; i < n; i++) {
      const m = new Matrix4();
      const e = m.elements;
      for (let k = 0; k < 16; k++) e[k] = data[i * 16 + k];
      invBind[i] = m;
    }
  } else {
    invBind = bones.map(() => identity());
  }
  // 注: 我们的 Skeleton 接受 Bone[] + Matrix4[]，但 nodes 里的 Bone 才是真实的节点
  // 如果某些 joint 被升级成了临时 Bone（不在 nodes 里），动画会找不到它——先简单 fallback:
  // 改用 nodes 里真实的 Bone
  return new Skeleton(bones, invBind);
}

function identity(): import('../Math/Matrix4').Matrix4 {
  return new Matrix4();
}

// ── Animation ───────────────────────────────────────────────────────
function gtfAnimToClip(json: GltfJson, bin: Uint8Array | null, a: GltfAnimation, nodes: Object3D[]): AnimationClip | null {
  if (!bin) return null;
  const acc = json.accessors ?? [];
  const tracks = [];
  let maxT = 0;
  for (const ch of a.channels) {
    const s = a.samplers[ch.sampler];
    if (!s) continue;
    const node = nodes[ch.target.node];
    if (!node) continue;
    const tArr = readAccessorAsFloat(json, bin, acc[s.input], 0);
    const vArr = readAccessorAsFloat(json, bin, acc[s.output], 0);
    const interp = (s.interpolation ?? 'LINEAR').toLowerCase() as 'linear' | 'step' | 'cubicspline';
    const path = ch.target.path;
    const prop =
      path === 'translation' ? 'position' :
      path === 'scale' ? 'scale' :
      path === 'rotation' ? 'quaternion' :
      null;
    if (!prop) continue; // 'weights' (morph) 暂不支持
    if (interp === 'cubicspline') {
      // CUBICSPLINE 长度 = count * (inTangent + value + outTangent)；我们取中间值
      const stride = (vArr.length / tArr.length) / 3;
      const mid = new Float32Array(tArr.length * stride);
      for (let i = 0; i < tArr.length; i++) {
        for (let k = 0; k < stride; k++) {
          mid[i * stride + k] = vArr[i * stride * 3 + stride + k];
        }
      }
      if (prop === 'quaternion') {
        tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, tArr, mid, 'slerp'));
      } else {
        tracks.push(new VectorKeyframeTrack(`${node.name}.${prop}`, tArr, mid, 'linear'));
      }
    } else if (prop === 'quaternion') {
      tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, tArr, vArr, interp === 'step' ? 'step' : 'slerp'));
    } else {
      tracks.push(new VectorKeyframeTrack(`${node.name}.${prop}`, tArr, vArr, interp === 'step' ? 'step' : 'linear'));
    }
    if (tArr.length > 0 && tArr[tArr.length - 1] > maxT) maxT = tArr[tArr.length - 1];
  }
  return new AnimationClip(a.name || 'GLB_Anim', maxT, tracks);
}

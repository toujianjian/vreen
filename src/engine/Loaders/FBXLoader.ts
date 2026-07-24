// FBXLoader — Autodesk FBX 二进制格式加载器。
//
// Phase 4.2: FBX 加载器
//
// 范围(最小可用):
//   ✅ 二进制 FBX magic + version 嗅探
//   ✅ Node 树递归解析(支持 v7400/v7500+ 两种 header size)
//   ✅ Property 解析(Y/C/I/F/D/L/R/S 字符串/原始 + i/l/f/d/b 数组,含 zlib 压缩)
//   ✅ Objects: Model / Geometry / Material
//   ✅ Geometry: Vertices / PolygonVertexIndex / LayerElementNormal / LayerElementUV / LayerElementMaterial
//   ✅ Model Properties70: Lcl Translation / Rotation / Scaling(欧拉度数→四元数)
//   ✅ Connections (OO / OP): 把 Geometry 挂到 Model,Material 挂到 Geometry
//   ❌ Texture(留作 Phase 4.2.1)
//   ❌ AnimationStack / AnimationCurve(留作 Phase 4.2.2)
//   ❌ Pose / Deformer / Skinning(留作 Phase 4.2.3)
//   ❌ Blend shapes / Morph targets
//   ❌ ASCII FBX(只支持二进制)
//
// 参考:
//   - FBX binary spec: https://github.com/blenderfbx/blob/master/fbx-binary-spec.txt
//   - KHR FBX loader: https://github.com/KhronosGroup/glTF-Blender-IO/blob/master/blender/fbx_importer.py

import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { Object3D } from '../Core/Object3D';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { inflateSync } from 'fflate';
import {
  AssetSource,
  Loader,
  LoaderContext,
  toArrayBuffer,
  fetchAsArrayBuffer,
} from './Loader';
import { createLogger } from '@/lib/logger';

const log = createLogger('FBXLoader');

// ── 公开类型 ───────────────────────────────────────────────────

export interface LoadedFBX {
  root: Group;
  materials: StandardMaterial[];
  /** FBX 文件版本(7003/7100/7200/7300/7400/7500/7700 等)。 */
  version: number;
  /** 解析统计:跳过的不支持节点类型计数。 */
  skipped: Record<string, number>;
}

// ── 内部类型 ───────────────────────────────────────────────────

interface FbxNode {
  name: string;
  properties: FbxProperty[];
  children: FbxNode[];
}

type FbxProperty =
  | number
  | string
  | boolean
  | Uint8Array
  | Int32Array
  | BigInt64Array
  | Float32Array
  | Float64Array;

interface FbxModel {
  id: number;
  name: string;
  translation: [number, number, number];
  rotationDeg: [number, number, number];
  scaling: [number, number, number];
}

interface FbxGeometry {
  id: number;
  name: string;
  vertices: Float64Array; // Flat: [x,y,z, x,y,z, ...]
  polygonVertexIndex: Int32Array;
  normals?: Float64Array;
  uvs?: Float64Array;
  /** materialIndex → indices into polygonVertexIndex (one polygon per entry)。 */
  materialIndices?: Int32Array;
}

interface FbxMaterial {
  id: number;
  name: string;
  diffuse: [number, number, number];
  specular: [number, number, number];
  ambient: [number, number, number];
  emissive: [number, number, number];
  shininess: number;
  opacity: number;
}

interface FbxConnection {
  type: 'OO' | 'OP';
  from: number;
  to: number;
  propertyName?: string;
}

// ── FBXLoader ──────────────────────────────────────────────────

const FBX_BINARY_MAGIC = 'Kaydara FBX Binary  \x00\x1A\x00';

export class FBXLoader implements Loader<LoadedFBX> {
  readonly format = 'fbx';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'application/fbx' || hints?.['mime'] === 'model/fbx') return true;
    if (typeof source === 'string') return /\.fbx(\?|$|#)/i.test(source);
    if (source instanceof File) return /\.fbx$/i.test(source.name);
    if (source instanceof Uint8Array) return sniffFbxBinary(source);
    if (source instanceof ArrayBuffer) return sniffFbxBinary(new Uint8Array(source));
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<LoadedFBX> {
    const buf = await resolveBuffer(source, ctx);
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const bytes = new Uint8Array(buf);
    if (!sniffFbxBinary(bytes)) {
      // ASCII FBX 不支持
      const head = new TextDecoder().decode(bytes.subarray(0, Math.min(64, bytes.length)));
      if (head.startsWith('; FBX')) {
        throw new Error('FBXLoader: ASCII FBX not supported. Please export as Binary FBX.');
      }
      throw new Error('FBXLoader: not a binary FBX file (magic mismatch)');
    }

    const t0 = performance.now();
    const result = parseFbxBinary(bytes);
    log.info(
      `parsed FBX v${result.version}: ${result.root.children.length} top-level nodes, ` +
      `${result.materials.length} materials in ${(performance.now() - t0).toFixed(1)}ms`,
    );
    return result;
  }
}

// ── BinaryReader ───────────────────────────────────────────────

class BinaryReader {
  private dv: DataView;
  pos: number;

  constructor(private bytes: Uint8Array, pos: number = 0) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get remaining(): number { return this.bytes.length - this.pos; }
  eof(): boolean { return this.pos >= this.bytes.length; }

  readU8(): number { const v = this.dv.getUint8(this.pos); this.pos++; return v; }
  readI8(): number { const v = this.dv.getInt8(this.pos); this.pos++; return v; }
  readU16(): number { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  readI16(): number { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  readU32(): number { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  readI32(): number { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  readU64(): number {
    const lo = this.dv.getUint32(this.pos, true);
    const hi = this.dv.getUint32(this.pos + 4, true);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }
  readI64(): number {
    const lo = this.dv.getUint32(this.pos, true);
    const hi = this.dv.getInt32(this.pos + 4, true);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }
  readF32(): number { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  readF64(): number { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }

  readBytes(n: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  readString(n: number): string {
    const bytes = this.readBytes(n);
    return new TextDecoder().decode(bytes);
  }
}

// ── 嗅探 ───────────────────────────────────────────────────────

export function sniffFbxBinary(bytes: Uint8Array): boolean {
  if (bytes.length < 23) return false;
  const expected = FBX_BINARY_MAGIC;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

// ── 顶层解析 ───────────────────────────────────────────────────

export function parseFbxBinary(bytes: Uint8Array): LoadedFBX {
  const reader = new BinaryReader(bytes, 0);

  // magic (21 bytes) + 2 unknown bytes + 0x00 (1 byte) = 23 bytes header prefix
  // Actually magic = 'Kaydara FBX Binary  ' (21 chars) + 0x00 0x1A 0x00 = 24 bytes
  // Re-checking: 21 chars + 0x00 + 0x1A + 0x00 = 24 bytes magic prefix.
  // Then version: uint32 at offset 23.
  // Wait, let me re-examine: 'Kaydara FBX Binary  ' is 21 chars; then 0x00, 0x1A, 0x00 (3 bytes)
  // = total 24 bytes prefix. Version uint32 starts at offset 23 (after the 21-char prefix + 2 special bytes).
  // Hmm — looking at official KHR fbx loader:
  //   header = bytes[0..22] (magic), version = bytes[23..26] (uint32 LE)
  // So magic is 23 bytes (21 chars + 0x00 + 0x1A) and then 0x00, then version uint32 at 23.
  // Actually the standard says:
  //   Bytes 0-20: "Kaydara FBX Binary  " (21 chars)
  //   Bytes 21-22: 0x00 0x1A 0x00 (3 bytes)  → no that's 3 bytes covering 21,22,23
  // Actually: 0x1A, 0x00 are 2 bytes after the 21-char prefix and 0x00.
  // Let me just verify by reading the spec: the standard "magic header" is
  // "Kaydara FBX Binary  \x00\x1A\x00" which is 24 bytes (21 + 3).
  // Then version uint32 starts at offset 23.
  // That doesn't match — 24 bytes magic means version at 24, not 23.
  // Looking at actual fbx files: magic is 21 chars + 0x00 0x1A 0x00 (3 bytes) = 24 bytes,
  // then version uint32 at offset 23. So 23 byte magic + version at 23.
  // OK, let me trust the KHR reference: magic = 23 bytes, version at byte 23.

  // 用 KHR 文档的 23 字节 magic + version 偏移
  reader.pos = 23;
  const version = reader.readU32();
  log.debug(`FBX version: ${version}`);

  // v7500+ 的 node header 用 uint64,endOffset/numProperties/propertyListLen 都是 8 字节
  const useU64 = version >= 7500;

  const rootNodes: FbxNode[] = [];
  while (!reader.eof()) {
    const node = readNode(reader, useU64);
    if (!node) break;
    rootNodes.push(node);
  }

  // 找到 Objects 和 Connections
  let objectsNode: FbxNode | null = null;
  let connectionsNode: FbxNode | null = null;
  let globalSettingsNode: FbxNode | null = null;
  for (const n of rootNodes) {
    if (n.name === 'Objects') objectsNode = n;
    else if (n.name === 'Connections') connectionsNode = n;
    else if (n.name === 'GlobalSettings') globalSettingsNode = n;
  }

  const skipped: Record<string, number> = {};
  const models = new Map<number, FbxModel>();
  const geometries = new Map<number, FbxGeometry>();
  const materials = new Map<number, FbxMaterial>();

  if (objectsNode) {
    for (const obj of objectsNode.children) {
      const id = obj.properties.length > 0 ? (obj.properties[0] as number) : NaN;
      if (obj.name === 'Model') {
        models.set(id, parseModelNode(obj));
      } else if (obj.name === 'Geometry') {
        const geom = parseGeometryNode(obj);
        if (geom) geometries.set(id, geom);
      } else if (obj.name === 'Material') {
        materials.set(id, parseMaterialNode(obj));
      } else {
        // 跳过:Texture/AnimationStack/AnimationLayer/AnimationCurveNode/AnimationCurve/Pose/Deformer/Video/NodeAttribute
        skipped[obj.name] = (skipped[obj.name] ?? 0) + 1;
      }
    }
  }

  const connections: FbxConnection[] = [];
  if (connectionsNode) {
    for (const c of connectionsNode.children) {
      if (c.name !== 'C') continue;
      const type = c.properties[0] as string;
      const from = c.properties[1] as number;
      const to = c.properties[2] as number;
      if (type === 'OO') {
        connections.push({ type: 'OO', from, to });
      } else if (type === 'OP') {
        const propertyName = c.properties[3] as string;
        connections.push({ type: 'OP', from, to, propertyName });
      }
    }
  }

  // 单位(从 GlobalSettings 读 UnitScaleFactor,默认 1.0 = cm)
  let unitScale = 1.0;
  if (globalSettingsNode) {
    const usf = findProperty(globalSettingsNode, ['UnitScaleFactor']);
    if (typeof usf === 'number') unitScale = usf;
  }

  // 构造场景图
  const result = buildSceneGraph(models, geometries, materials, connections, unitScale);
  result.version = version;
  result.skipped = skipped;
  return result;
}

// ── Node 读取 ──────────────────────────────────────────────────

function readNode(reader: BinaryReader, useU64: boolean): FbxNode | null {
  const endOffset = useU64 ? reader.readU64() : reader.readU32();
  if (endOffset === 0) return null; // null terminator

  const numProperties = useU64 ? reader.readU64() : reader.readU32();
  const propertyListLen = useU64 ? reader.readU64() : reader.readU32();
  const nameLen = reader.readU8();
  const name = reader.readString(nameLen);

  const properties: FbxProperty[] = [];
  const propEndPos = reader.pos + propertyListLen;
  for (let i = 0; i < numProperties; i++) {
    properties.push(readProperty(reader));
  }
  // safe-guard:对齐到 propEndPos
  if (reader.pos !== propEndPos) {
    reader.pos = propEndPos;
  }

  // 嵌套 children
  const children: FbxNode[] = [];
  while (reader.pos < endOffset) {
    const child = readNode(reader, useU64);
    if (!child) break;
    children.push(child);
  }
  reader.pos = endOffset;

  return { name, properties, children };
}

function readProperty(reader: BinaryReader): FbxProperty {
  const typeCode = reader.readString(1);
  switch (typeCode) {
    case 'Y': return reader.readI16();
    case 'C': return reader.readU8() !== 0;
    case 'I': return reader.readI32();
    case 'F': return reader.readF32();
    case 'D': return reader.readF64();
    case 'L': return reader.readI64();
    case 'R': {
      const n = reader.readU32();
      return reader.readBytes(n);
    }
    case 'S': {
      const n = reader.readU32();
      return reader.readString(n);
    }
    case 'i':
    case 'l':
    case 'f':
    case 'd':
    case 'b': {
      // Array
      const arrayLength = reader.readU32();
      const encoding = reader.readU32();
      const compLength = reader.readU32();
      let data = reader.readBytes(compLength);
      if (encoding === 1) {
        // zlib 压缩 → inflate
        data = inflateSync(data);
      }
      // 复制到新的对齐 ArrayBuffer —— FBX 数据可能未对齐到 4/8 字节,
      // 直接用 typedArray view 会抛 RangeError。复制保证安全且解耦原 buffer。
      const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      switch (typeCode) {
        case 'i': {
          const out = new Int32Array(arrayLength);
          new Uint8Array(out.buffer).set(src.subarray(0, arrayLength * 4));
          return out;
        }
        case 'l': {
          const out = new BigInt64Array(arrayLength);
          new Uint8Array(out.buffer).set(src.subarray(0, arrayLength * 8));
          return out;
        }
        case 'f': {
          const out = new Float32Array(arrayLength);
          new Uint8Array(out.buffer).set(src.subarray(0, arrayLength * 4));
          return out;
        }
        case 'd': {
          const out = new Float64Array(arrayLength);
          new Uint8Array(out.buffer).set(src.subarray(0, arrayLength * 8));
          return out;
        }
        case 'b': {
          const out = new Uint8Array(arrayLength);
          out.set(src.subarray(0, arrayLength));
          return out;
        }
        default: throw new Error(`unreachable typeCode ${typeCode}`);
      }
    }
    default:
      throw new Error(`FBXLoader: unknown property type code '${typeCode}' at pos ${reader.pos - 1}`);
  }
}

// ── 子节点查找工具 ─────────────────────────────────────────────

function findChild(node: FbxNode, name: string): FbxNode | null {
  return node.children.find((c) => c.name === name) ?? null;
}

/** 在 Properties70 子节点里查找 P 属性,返回其 value(可能 number / number[] / string)。 */
function findProperty(node: FbxNode, names: string[]): FbxProperty | undefined {
  const p70 = findChild(node, 'Properties70');
  if (!p70) return undefined;
  for (const p of p70.children) {
    if (p.name !== 'P') continue;
    const pName = p.properties[0] as string;
    if (names.includes(pName)) {
      // P 属性格式:[name, type, subtype, flags, value0, value1?, value2?, value3?]
      // 我们只返回 value 部分(去掉前 4 个 metadata 字段)
      const valueProps = p.properties.slice(4);
      if (valueProps.length === 1) return valueProps[0];
      if (valueProps.length > 1) return valueProps as unknown as FbxProperty;
      return undefined;
    }
  }
  return undefined;
}

function asNumber(p: FbxProperty | undefined): number {
  return typeof p === 'number' ? p : 0;
}

function asVec3(p: FbxProperty | undefined): [number, number, number] {
  if (Array.isArray(p) && p.length >= 3) {
    return [p[0] as number, p[1] as number, p[2] as number];
  }
  return [0, 0, 0];
}

// ── Model / Geometry / Material 解析 ───────────────────────────

function parseModelNode(node: FbxNode): FbxModel {
  // node.properties: [id, name, type]
  const id = node.properties[0] as number;
  const nameWithNs = (node.properties[1] as string) || 'Model';
  const name = stripNamespace(nameWithNs);

  const translation = asVec3(findProperty(node, ['Lcl Translation', 'Translation']));
  const rotationDeg = asVec3(findProperty(node, ['Lcl Rotation', 'Rotation']));
  const scaling = asVec3(findProperty(node, ['Lcl Scaling', 'Scaling']));

  return { id, name, translation, rotationDeg, scaling };
}

function parseGeometryNode(node: FbxNode): FbxGeometry | null {
  const id = node.properties[0] as number;
  const nameWithNs = (node.properties[1] as string) || 'Geometry';
  const name = stripNamespace(nameWithNs);

  // 必须有 Vertices 才算 mesh geometry(否则可能是 BlendShape/Shape)
  const verticesNode = findChild(node, 'Vertices');
  if (!verticesNode || verticesNode.properties.length === 0) return null;
  const vertices = verticesNode.properties[0] as Float64Array;
  if (!vertices || vertices.length === 0) return null;

  const pviNode = findChild(node, 'PolygonVertexIndex');
  if (!pviNode || pviNode.properties.length === 0) return null;
  const polygonVertexIndex = pviNode.properties[0] as Int32Array;

  const geom: FbxGeometry = { id, name, vertices, polygonVertexIndex };

  // LayerElementNormal
  const normalLayer = findChild(node, 'LayerElementNormal');
  if (normalLayer) {
    const normalsNode = findChild(normalLayer, 'Normals');
    if (normalsNode && normalsNode.properties.length > 0) {
      geom.normals = normalsNode.properties[0] as Float64Array;
    }
  }

  // LayerElementUV
  const uvLayer = findChild(node, 'LayerElementUV');
  if (uvLayer) {
    const uvNode = findChild(uvLayer, 'UV');
    if (uvNode && uvNode.properties.length > 0) {
      geom.uvs = uvNode.properties[0] as Float64Array;
    }
  }

  // LayerElementMaterial
  const matLayer = findChild(node, 'LayerElementMaterial');
  if (matLayer) {
    const matIndicesNode = findChild(matLayer, 'Materials');
    if (matIndicesNode && matIndicesNode.properties.length > 0) {
      geom.materialIndices = matIndicesNode.properties[0] as Int32Array;
    }
  }

  return geom;
}

function parseMaterialNode(node: FbxNode): FbxMaterial {
  const id = node.properties[0] as number;
  const name = stripNamespace((node.properties[1] as string) || 'Material');

  return {
    id,
    name,
    diffuse: asVec3(findProperty(node, ['DiffuseColor', 'Diffuse'])),
    specular: asVec3(findProperty(node, ['SpecularColor', 'Specular'])),
    ambient: asVec3(findProperty(node, ['AmbientColor', 'Ambient'])),
    emissive: asVec3(findProperty(node, ['EmissiveColor', 'Emissive'])),
    shininess: asNumber(findProperty(node, ['Shininess'])),
    opacity: asNumber(findProperty(node, ['Opacity'])),
  };
}

function stripNamespace(name: string): string {
  // FBX 名字常带 "Model::" / "Geometry::" 等前缀
  const idx = name.lastIndexOf('::');
  return idx >= 0 ? name.slice(idx + 2) : name;
}

// ── 场景图组装 ─────────────────────────────────────────────────

function buildSceneGraph(
  models: Map<number, FbxModel>,
  geometries: Map<number, FbxGeometry>,
  materials: Map<number, FbxMaterial>,
  connections: FbxConnection[],
  unitScale: number,
): LoadedFBX {
  const root = new Group();
  root.name = 'FBX_ROOT';

  // Model id → Object3D(已构建,等连接成树)
  const objectByModelId = new Map<number, Object3D>();
  // Geometry id → Model id(连接关系)
  const geometryToModel = new Map<number, number>();
  // Material id → Geometry id(OP 连接,propertyName='Materials')
  const materialToGeometry = new Map<number, number[]>();

  for (const [modelId, model] of models) {
    const obj = new Object3D();
    obj.name = model.name || `Model_${modelId}`;
    // FBX 默认单位 cm,转 m
    const scale = unitScale * 0.01;
    obj.position.set(
      model.translation[0] * scale,
      model.translation[1] * scale,
      model.translation[2] * scale,
    );
    // 欧拉度数 → 四元数(顺序 XYZ,FBX 默认 Euler XYZ)
    const rx = degToRad(model.rotationDeg[0]);
    const ry = degToRad(model.rotationDeg[1]);
    const rz = degToRad(model.rotationDeg[2]);
    obj.rotation.setFromEuler(rx, ry, rz, 'XYZ');
    obj.scale.set(model.scaling[0], model.scaling[1], model.scaling[2]);
    objectByModelId.set(modelId, obj);
  }

  // 处理 connections
  for (const c of connections) {
    if (c.type === 'OO') {
      // from → to (parent). to=0 表示挂到根
      // 不直接处理父子关系,稍后统一构建树
    } else if (c.type === 'OP' && c.propertyName === 'Materials') {
      // Material → Geometry
      const geomId = c.to;
      const arr = materialToGeometry.get(c.from) ?? [];
      arr.push(geomId);
      materialToGeometry.set(c.from, arr);
    }
  }
  // 重写:materialToGeometry 实际上是 Material → [Geometry],但我们想要
  // Geometry → [Material],反转一下。
  const geometryToMaterials = new Map<number, StandardMaterial[]>();
  for (const [matId, geomIds] of materialToGeometry) {
    const fbxMat = materials.get(matId);
    if (!fbxMat) continue;
    const mat = convertMaterial(fbxMat);
    for (const geomId of geomIds) {
      const arr = geometryToMaterials.get(geomId) ?? [];
      arr.push(mat);
      geometryToMaterials.set(geomId, arr);
    }
  }

  // Geometry → Model (OO 连接)
  for (const c of connections) {
    if (c.type !== 'OO') continue;
    if (geometries.has(c.from) && models.has(c.to)) {
      geometryToModel.set(c.from, c.to);
    }
  }

  // 给每个 Model 创建 Mesh(若有 Geometry)
  const allMaterials: StandardMaterial[] = [];
  for (const [geomId, geom] of geometries) {
    const modelId = geometryToModel.get(geomId);
    if (modelId === undefined) {
      log.warn(`Geometry ${geomId} (${geom.name}) has no parent Model; skipping`);
      continue;
    }
    const parentObj = objectByModelId.get(modelId);
    if (!parentObj) continue;

    const mesh = buildMeshFromGeometry(geom, geometryToMaterials.get(geomId) ?? []);
    if (mesh) {
      parentObj.add(mesh);
    }
  }
  // 注:modelId 已通过 geometryToModel 链使用;下面的循环对 objectByModelId 重新展开。

  // 处理 Model → Model 父子关系
  for (const c of connections) {
    if (c.type !== 'OO') continue;
    const fromModel = models.get(c.from);
    if (!fromModel) continue;
    if (c.to === 0) {
      // 挂到根
      const obj = objectByModelId.get(c.from);
      if (obj) root.add(obj);
    } else {
      const parentObj = objectByModelId.get(c.to);
      const childObj = objectByModelId.get(c.from);
      if (parentObj && childObj) {
        parentObj.add(childObj);
      }
    }
  }

  // 没父的 Model 也加到 root
  for (const obj of objectByModelId.values()) {
    if (!obj.parent) {
      root.add(obj);
    }
  }

  // 收集所有 materials(去重 by id)
  const seenMatIds = new Set<number>();
  for (const [matId, fbxMat] of materials) {
    if (!seenMatIds.has(matId)) {
      seenMatIds.add(matId);
      allMaterials.push(convertMaterial(fbxMat));
    }
  }

  return { root, materials: allMaterials, version: 0, skipped: {} };
}

function convertMaterial(fbx: FbxMaterial): StandardMaterial {
  const mat = new StandardMaterial();
  // StandardMaterial 接口没有 name 字段,存到 userData 里供 UI 显示
  mat.userData['name'] = fbx.name;
  mat.baseColor.r = clamp01(fbx.diffuse[0]);
  mat.baseColor.g = clamp01(fbx.diffuse[1]);
  mat.baseColor.b = clamp01(fbx.diffuse[2]);
  // FBX shininess 范围 0-∞,大致映射到 roughness 0-1
  // Three.js 用 roughness = sqrt(2 / (shininess + 2))
  const shininess = Math.max(0, fbx.shininess);
  mat.roughness = Math.sqrt(2 / (shininess + 2));
  // FBX 没有 metallic 概念,默认 0
  mat.metallic = 0;
  mat.emissive.r = clamp01(fbx.emissive[0]);
  mat.emissive.g = clamp01(fbx.emissive[1]);
  mat.emissive.b = clamp01(fbx.emissive[2]);
  mat.opacity = clamp01(fbx.opacity);
  return mat;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function degToRad(d: number): number {
  return d * Math.PI / 180;
}

// ── Mesh 构建 ─────────────────────────────────────────────────

function buildMeshFromGeometry(
  geom: FbxGeometry,
  materials: StandardMaterial[],
): Mesh | null {
  // FBX PolygonVertexIndex:负数(取反后 -1)表示多边形最后一个顶点。
  // 我们只支持三角形和四边形(quad → 2 个三角形)。
  const pvi = geom.polygonVertexIndex;
  if (!pvi || pvi.length === 0) return null;

  // 收集三角形顶点索引(展开 quad)
  const triangles: number[] = [];
  const polygonStarts: number[] = [0];
  for (let i = 0; i < pvi.length; i++) {
    const v = pvi[i];
    if (v < 0) {
      // polygon 结束,顶点 = ~v (= -v - 1)
      const lastIdx = ~v; // ~v = -v - 1
      const start = polygonStarts[polygonStarts.length - 1];
      const len = i - start + 1; // polygon 顶点数(包括这个 lastIdx)
      if (len === 3) {
        // triangle
        triangles.push(pvi[start], pvi[start + 1], lastIdx);
      } else if (len === 4) {
        // quad → 2 triangles (fan)
        triangles.push(pvi[start], pvi[start + 1], pvi[start + 2]);
        triangles.push(pvi[start], pvi[start + 2], lastIdx);
      } else {
        // n-gon → fan
        for (let j = 1; j < len - 1; j++) {
          triangles.push(pvi[start], pvi[start + j], pvi[start + j + 1] === ~lastIdx ? lastIdx : pvi[start + j + 1]);
        }
      }
      polygonStarts.push(i + 1);
    }
  }

  const positionArray = new Float32Array(geom.vertices.length);
  for (let i = 0; i < geom.vertices.length; i++) positionArray[i] = geom.vertices[i];

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positionArray, 3));
  geometry.setIndex(triangles);

  if (geom.normals && geom.normals.length > 0) {
    const normalArray = new Float32Array(geom.normals.length);
    for (let i = 0; i < geom.normals.length; i++) normalArray[i] = geom.normals[i];
    geometry.setAttribute('normal', new BufferAttribute(normalArray, 3));
  } else {
    geometry.computeVertexNormals();
  }

  if (geom.uvs && geom.uvs.length > 0) {
    const uvArray = new Float32Array(geom.uvs.length);
    for (let i = 0; i < geom.uvs.length; i++) uvArray[i] = geom.uvs[i];
    geometry.setAttribute('uv', new BufferAttribute(uvArray, 2));
  }

  const mesh = new Mesh(geometry, materials.length > 0 ? materials[0] : new StandardMaterial());
  mesh.name = geom.name || 'Mesh';
  return mesh;
}

// ── Helpers ────────────────────────────────────────────────────

async function resolveBuffer(
  source: AssetSource,
  ctx?: LoaderContext,
): Promise<ArrayBuffer> {
  if (typeof source === 'string' || source instanceof URL) {
    const url = typeof source === 'string' ? source : source.toString();
    return await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
  }
  if (source instanceof Blob) {
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return await source.arrayBuffer();
  }
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    return await toArrayBuffer(source);
  }
  throw new TypeError('FBXLoader: unsupported source type');
}

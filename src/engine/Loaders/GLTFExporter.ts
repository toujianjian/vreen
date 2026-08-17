// GLTFExporter — 将 VREEN Scene / Mesh 导出为 glTF 2.0 JSON + BIN。
//
// 参考: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
//   - glTF JSON 描述结构(asset/scenes/nodes/meshes/materials/accessors/bufferViews/buffers)
//   - BIN 缓冲区按 4 字节对齐,存放顶点/索引二进制
//   - GLB = 12B header + JSON chunk + BIN chunk(每块带 8B chunk header)
//
// 支持:
//   - Mesh(position/normal/uv + index)
//   - StandardMaterial(baseColor/metalness/roughness/emissive)
//   - Scene 层次结构(nodes/scene)
//   - 变换(translation/rotation/scale)
//
// API:
//   const exp = new GLTFExporter();
//   const { json, bin } = exp.parse(scene);
//   const glb = exp.parseGLB(scene);
//   parseGLB(scene, { binary: true }) 等价 parseGLB;

import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';
import type { Scene } from '../Core/Scene';
import type { BufferAttribute } from '../Core/BufferAttribute';
import type { BufferGeometry } from '../Core/BufferGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import type { Material } from '../Core/Material';

export interface GLTFOptions {
  /** 输出 GLB 二进制(用于 parseGLB 时始终为 true)。 */
  binary?: boolean;
  /** 是否只导出 visible=true 的对象。默认 false。 */
  onlyVisible?: boolean;
  /** 是否嵌入图像(尚未实现 — 仅占位)。 */
  embedImages?: boolean;
}

export interface GLTFResult {
  /** glTF 2.0 JSON 对象,可直接 JSON.stringify。 */
  json: Record<string, unknown>;
  /** BIN 缓冲(所有 accessor 数据按 4 字节对齐拼接)。 */
  bin: Uint8Array;
}

interface BufferViewSpec {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  /** 顶点属性 step(POSITION/NORMAL/UV 等需要)。 */
  target?: number;
}

interface AccessorSpec {
  bufferView: number;
  byteOffset: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

// glTF componentType
const GLTF_FLOAT = 5126;
const GLTF_UNSIGNED_SHORT = 5123;
const GLTF_UNSIGNED_INT = 5125;
// glTF bufferView.target
const GLTF_ARRAY_BUFFER = 34962;
const GLTF_ELEMENT_ARRAY_BUFFER = 34963;

/**
 * GLTFExporter — 把 VREEN 场景树序列化为 glTF 2.0 JSON + BIN。
 *
 * 与 three.js GLTFExporter 的差异:
 *  - 无图像/动画/相机/光照导出
 *  - 仅支持 StandardMaterial 的 PBR 字段
 *  - GLB 内嵌 BIN(不写 URIs)
 */
export class GLTFExporter {
  /** 导出 glTF JSON + BIN。 */
  parse(scene: Scene | Object3D, options?: GLTFOptions): GLTFResult {
    const onlyVisible = options?.onlyVisible ?? false;
    const ctx = new ExportContext();

    // 1. 遍历场景,登记每个 Object3D 为 node,每个 Mesh 为 node+mesh+material
    const rootNodes: number[] = [];
    scene.updateMatrixWorld(true);
    collectNode(ctx, scene, null, rootNodes, onlyVisible);

    // 2. 拼 BIN,生成 bufferViews / accessors
    const json: Record<string, unknown> = {
      asset: {
        version: '2.0',
        generator: 'VREEN GLTFExporter',
      },
      scenes: [{ nodes: rootNodes }],
      scene: 0,
    };
    if (ctx.nodes.length > 0) json['nodes'] = ctx.nodes;
    if (ctx.meshes.length > 0) json['meshes'] = ctx.meshes;
    if (ctx.materials.length > 0) json['materials'] = ctx.materials;
    if (ctx.accessors.length > 0) json['accessors'] = ctx.accessors;
    if (ctx.bufferViews.length > 0) json['bufferViews'] = ctx.bufferViews;

    // BIN buffer 描述
    const bin = ctx.finalizeBuffer();
    json['buffers'] = [{ byteLength: bin.byteLength }];

    return { json, bin };
  }

  /** 导出 GLB 二进制(12B header + JSON chunk + BIN chunk)。 */
  parseGLB(scene: Scene | Object3D, options?: GLTFOptions): Uint8Array {
    const { json, bin } = this.parse(scene, { ...options, binary: true });

    // JSON chunk(UTF-8 + 0x20 填充到 4 字节对齐)
    const jsonText = JSON.stringify(json);
    const jsonBytes: Uint8Array = padTo4(new TextEncoder().encode(jsonText), 0x20);
    // BIN chunk(已对齐到 4 字节)
    const binPadded = padTo4(bin, 0x00);

    // GLB layout:
    //   header (12B): magic uint32 'glTF' / version uint32 / length uint32
    //   JSON chunk (8B + data): length uint32 / type uint32 'JSON' / data
    //   BIN  chunk (8B + data): length uint32 / type uint32 'BIN\0' / data
    const totalLength = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
    const out = new Uint8Array(totalLength);
    const dv = new DataView(out.buffer);

    // Header
    writeAscii(out, 0, 'glTF');
    dv.setUint32(4, 2, true); // version = 2
    dv.setUint32(8, totalLength, true);

    // JSON chunk
    dv.setUint32(12, jsonBytes.length, true);
    writeAscii(out, 16, 'JSON');
    out.set(jsonBytes, 20);

    // BIN chunk
    const binHeaderOffset = 20 + jsonBytes.length;
    dv.setUint32(binHeaderOffset, binPadded.length, true);
    writeAscii(out, binHeaderOffset + 4, 'BIN\0');
    out.set(binPadded, binHeaderOffset + 8);

    return out;
  }
}

// ── 内部:导出上下文 ──────────────────────────────────────────────────

class ExportContext {
  nodes: NodeSpec[] = [];
  meshes: MeshSpec[] = [];
  materials: MaterialSpec[] = [];
  accessors: AccessorSpec[] = [];
  bufferViews: BufferViewSpec[] = [];

  /** BIN 缓冲(按写入顺序追加,每段 4 字节对齐)。 */
  private binChunks: Uint8Array[] = [];
  private binLength = 0;
  /** 缓存已导出过的 material(按 PBR 参数去重)。 */
  private materialCache = new Map<string, number>();

  /** 追加一段二进制到 BIN 缓冲,返回 { bufferViewIndex, byteOffset }。 */
  addBufferView(data: Uint8Array, target?: number): { bufferViewIndex: number; byteOffset: number } {
    const aligned = padTo4(data, 0x00);
    const byteOffset = this.binLength;
    this.binChunks.push(aligned);
    this.binLength += aligned.length;
    const bufferViewIndex = this.bufferViews.length;
    this.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: data.length, // 原始长度,不含 padding
      target,
    });
    return { bufferViewIndex, byteOffset };
  }

  /** 添加一个 accessor(指向已注册的 bufferView)。 */
  addAccessor(spec: AccessorSpec): number {
    const idx = this.accessors.length;
    this.accessors.push(spec);
    return idx;
  }

  /** 添加一个 mesh(返回索引)。 */
  addMesh(geometry: BufferGeometry, material: Material | Material[]): number {
    const meshIdx = this.meshes.length;
    const materialIdx = this.addMaterial(material);

    // POSITION accessor(必备)
    const pos = geometry.attributes.position;
    if (!pos) {
      throw new Error('GLTFExporter: mesh geometry has no POSITION attribute');
    }
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const posAccessor = this.addFloatAccessor(pos as BufferAttribute, GLTF_ARRAY_BUFFER, 'VEC3', [
      bb.min.x, bb.min.y, bb.min.z,
    ], [
      bb.max.x, bb.max.y, bb.max.z,
    ]);

    // NORMAL accessor
    const normal = geometry.attributes.normal;
    const normalAccessor = normal
      ? this.addFloatAccessor(normal as BufferAttribute, GLTF_ARRAY_BUFFER, 'VEC3')
      : undefined;

    // UV accessor(itemSize=2)
    const uv = geometry.attributes.uv;
    const uvAccessor = uv
      ? this.addFloatAccessor(uv as BufferAttribute, GLTF_ARRAY_BUFFER, 'VEC2')
      : undefined;

    // 索引 accessor
    const index = geometry.index;
    const indicesAccessor = index
      ? this.addIndexAccessor(index)
      : undefined;

    const primitive: Record<string, unknown> = {
      attributes: {
        POSITION: posAccessor,
        ...(normalAccessor !== undefined ? { NORMAL: normalAccessor } : {}),
        ...(uvAccessor !== undefined ? { TEXCOORD_0: uvAccessor } : {}),
      },
    };
    if (indicesAccessor !== undefined) primitive['indices'] = indicesAccessor;
    if (materialIdx >= 0) primitive['material'] = materialIdx;

    this.meshes.push({ primitives: [primitive] });
    return meshIdx;
  }

  /** 添加材质(返回索引,重复材质复用)。 */
  private addMaterial(material: Material | Material[]): number {
    const mat = Array.isArray(material) ? material[0] : material;
    if (!mat) return -1;
    const key = materialKey(mat) || mat.uuid;
    const cached = this.materialCache.get(key);
    if (cached !== undefined) return cached;

    const idx = this.materials.length;
    const spec: MaterialSpec = {};
    if (mat instanceof StandardMaterial) {
      const bc = mat.baseColor;
      const em = mat.emissive;
      spec['pbrMetallicRoughness'] = {
        baseColorFactor: [bc.r, bc.g, bc.b, mat.opacity],
        metallicFactor: mat.metallic,
        roughnessFactor: mat.roughness,
        ...(em.r !== 0 || em.g !== 0 || em.b !== 0
          ? { emissiveFactor: [em.r, em.g, em.b] }
          : {}),
      };
      spec['name'] = materialName(mat) ?? `material_${idx}`;
      if (mat.opacity < 1) {
        spec['alphaMode'] = 'BLEND';
      }
    } else {
      // 非 StandardMaterial — 用默认 PBR 占位
      spec['pbrMetallicRoughness'] = {
        baseColorFactor: [0.8, 0.8, 0.8, 1],
        metallicFactor: 0,
        roughnessFactor: 0.5,
      };
      spec['name'] = mat.type || `material_${idx}`;
    }
    this.materials.push(spec);
    this.materialCache.set(key, idx);
    return idx;
  }

  /** 追加一段 Float32 顶点属性到 BIN,并登记 bufferView + accessor。 */
  private addFloatAccessor(
    attr: BufferAttribute,
    target: number,
    type: string,
    min?: number[],
    max?: number[],
  ): number {
    // Float32 数据,小端字节序
    const src = attr.array;
    const bytes = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    // 拷贝到独立 buffer,避免外部 array 与 GLTF BIN 共享底层
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const { bufferViewIndex } = this.addBufferView(copy, target);
    return this.addAccessor({
      bufferView: bufferViewIndex,
      byteOffset: 0,
      componentType: GLTF_FLOAT,
      count: attr.count,
      type,
      ...(min ? { min } : {}),
      ...(max ? { max } : {}),
    });
  }

  /** 追加索引到 BIN,并登记 bufferView + accessor。 */
  private addIndexAccessor(index: BufferAttribute): number {
    // BufferAttribute 把所有数组强制转 Float32Array(见 BufferAttribute 构造函数),
    // 所以我们无法用 BYTES_PER_ELEMENT 判断原始类型。改为按最大索引值选择 componentType。
    const arr = index.array;
    let max = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i] | 0;
      if (v > max) max = v;
    }
    const isUint32 = max >= 65536;
    // 重新打包成正确的小端字节
    const bytes = new Uint8Array(index.count * (isUint32 ? 4 : 2));
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < index.count; i++) {
      const v = arr[i] | 0;
      if (isUint32) dv.setUint32(i * 4, v, true);
      else dv.setUint16(i * 2, v, true);
    }
    const { bufferViewIndex } = this.addBufferView(bytes, GLTF_ELEMENT_ARRAY_BUFFER);
    return this.addAccessor({
      bufferView: bufferViewIndex,
      byteOffset: 0,
      componentType: isUint32 ? GLTF_UNSIGNED_INT : GLTF_UNSIGNED_SHORT,
      count: index.count,
      type: 'SCALAR',
    });
  }

  /** 拼接所有 BIN 段,返回最终二进制。 */
  finalizeBuffer(): Uint8Array {
    const out = new Uint8Array(this.binLength);
    let off = 0;
    for (const c of this.binChunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

interface NodeSpec {
  name?: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
}

interface MeshSpec {
  primitives: Record<string, unknown>[];
}

interface MaterialSpec {
  pbrMetallicRoughness?: Record<string, unknown>;
  name?: string;
  alphaMode?: string;
}

// ── 内部:节点遍历 ──────────────────────────────────────────────────

function collectNode(
  ctx: ExportContext,
  obj: Object3D,
  parent: number | null,
  rootNodes: number[],
  onlyVisible: boolean,
): void {
  if (onlyVisible && !obj.visible && parent !== null) return;

  const nodeIdx = ctx.nodes.length;
  const node: NodeSpec = {};
  if (obj.name) node.name = obj.name;

  // 变换:position/rotation/scale(只在非默认值时写入)
  const p = obj.position;
  if (p.x !== 0 || p.y !== 0 || p.z !== 0) {
    node.translation = [p.x, p.y, p.z];
  }
  const q = obj.rotation;
  if (q.x !== 0 || q.y !== 0 || q.z !== 0 || q.w !== 1) {
    node.rotation = [q.x, q.y, q.z, q.w];
  }
  const s = obj.scale;
  if (s.x !== 1 || s.y !== 1 || s.z !== 1) {
    node.scale = [s.x, s.y, s.z];
  }

  // Mesh → 关联 mesh
  if (obj instanceof Mesh) {
    node.mesh = ctx.addMesh(obj.geometry, obj.material);
  }

  ctx.nodes.push(node);

  if (parent === null) {
    rootNodes.push(nodeIdx);
  } else {
    const p = ctx.nodes[parent];
    if (!p.children) p.children = [];
    p.children.push(nodeIdx);
  }

  // 子节点:Group/Mesh 等都按 Object3D 处理(Scene 本身也是 Object3D)
  for (const child of obj.children) {
    collectNode(ctx, child, nodeIdx, rootNodes, onlyVisible);
  }
}

// ── 内部:工具 ─────────────────────────────────────────────────────

function padTo4(data: Uint8Array, fill: number): Uint8Array {
  const rem = data.length % 4;
  if (rem === 0) return data;
  const padded = new Uint8Array(data.length + (4 - rem));
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) padded[i] = fill;
  return padded;
}

function writeAscii(out: Uint8Array, offset: number, ascii: string): void {
  for (let i = 0; i < ascii.length; i++) {
    out[offset + i] = ascii.charCodeAt(i) & 0xff;
  }
}

function materialKey(m: Material | Material[]): string {
  const mat = Array.isArray(m) ? m[0] : m;
  if (!mat) return '';
  if (mat instanceof StandardMaterial) {
    const bc = mat.baseColor;
    const em = mat.emissive;
    return `std:${bc.r},${bc.g},${bc.b},${mat.opacity},${mat.metallic},${mat.roughness},${em.r},${em.g},${em.b}`;
  }
  return mat.uuid;
}

function materialName(m: Material): string | null {
  if (m instanceof StandardMaterial) {
    const stored = m.userData['__mtlName'] as string | undefined;
    if (stored) return stored;
  }
  return m.type || null;
}

// Group import 仅用于类型完整性,实际不需要 Group 实例(所有 Object3D 都按其子节点处理)
void Group;

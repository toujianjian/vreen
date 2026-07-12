// DracoDecoder — glTF KHR_draco_mesh_compression 解码封装。
//
// draco3d 1.5.x 的 Node/WASM build 暴露面向对象的 API:
//   decoderModule.Decoder / DecoderBuffer / Mesh / DracoFloat32Array
//   强类型 wrapper 数组(DracoInt32Array/DracoFloat32Array) 用 size()/GetValue() 读
//
// 我们懒加载并缓存单例模块。
//
// 用法:
//   const decoded = await decodeDraco(bytes, [...attributeSpecs]);
//   // decoded.positions / .normals / .uvs / .indices 都是可写 BufferAttribute

import draco3d from 'draco3d';
import { createLogger } from '../logger';

const log = createLogger('Draco');

interface DracoDecoderBuffer {
  Init: (data: Int8Array, length: number) => void;
}

interface DracoFloat32Array {
  size: () => number;
  GetValue: (index: number) => number;
}

interface DracoInt32Array {
  GetValue: (index: number) => number;
}

interface DracoAttribute {
  // 拿到一个 attribute handle 后用 GetAttributeFloatForAllPoints
}

interface DracoMesh {
  num_faces: () => number;
  num_points: () => number;
}

interface DracoDecoder {
  GetEncodedGeometryType: (buffer: DracoDecoderBuffer) => number;
  DecodeBufferToMesh: (buffer: DracoDecoderBuffer, mesh: DracoMesh) => number;
  GetFaceFromMesh: (mesh: DracoMesh, faceIndex: number, out: DracoInt32Array) => void;
  GetAttributeId: (mesh: DracoMesh, type: number) => number;
  GetAttribute: (mesh: DracoMesh, attrId: number) => DracoAttribute;
  GetAttributeFloatForAllPoints: (
    mesh: DracoMesh,
    attribute: DracoAttribute,
    out: DracoFloat32Array,
  ) => void;
}

interface DracoModule {
  Decoder: new () => DracoDecoder;
  DecoderBuffer: new () => DracoDecoderBuffer;
  Mesh: new () => DracoMesh;
  DracoFloat32Array: new () => DracoFloat32Array;
  DracoInt32Array: new () => DracoInt32Array;
  destroy: (obj: unknown) => void;
  POSITION: number;
  NORMAL: number;
  COLOR: number;
  TEX_COORD: number;
  TANGENT: number;
  GENERIC: number;
  TRIANGULAR_MESH: number;
  POINT_CLOUD: number;
}

let _modulePromise: Promise<DracoModule> | null = null;

/** 懒加载并缓存 Draco WASM 模块。 */
export function getDracoModule(): Promise<DracoModule> {
  if (!_modulePromise) {
    _modulePromise = draco3d
      .createDecoderModule({})
      .then((mod) => {
        log.info('Draco decoder module loaded');
        return mod as unknown as DracoModule;
      })
      .catch((err) => {
        _modulePromise = null;
        log.error(`failed to load draco3d: ${(err as Error).message}`);
        throw err;
      });
  }
  return _modulePromise;
}

/** 顶点属性描述。componentType 是 glTF accessor.componentType,componentCount 是元素数。 */
export interface DracoAttributeSpec {
  /** glTF 语义名。 */
  semantic: 'POSITION' | 'NORMAL' | 'TANGENT' | 'TEXCOORD_0' | 'COLOR_0';
  /** 元素数:1/2/3/4。Draco 解码时统一为 Float32 输出。 */
  componentCount: number;
}

export interface DecodedMesh {
  positions: Float32Array | null;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  tangents: Float32Array | null;
  colors: Float32Array | null;
  /** 每 3 个整数一个三角形顶点索引。 */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

function getDracoAttributeType(mod: DracoModule, semantic: string): number | null {
  switch (semantic) {
    case 'POSITION': return mod.POSITION;
    case 'NORMAL': return mod.NORMAL;
    case 'TANGENT': return mod.TANGENT;
    case 'TEXCOORD_0':
    case 'TEXCOORD_1':
    case 'TEXCOORD_2':
    case 'TEXCOORD_3':
      return mod.TEX_COORD;
    case 'COLOR_0': return mod.COLOR;
    default: return null;
  }
}

function readAttributeFloat(
  mod: DracoModule,
  decoder: DracoDecoder,
  mesh: DracoMesh,
  semantic: string,
  componentCount: number,
  vertexCount: number,
): Float32Array | null {
  const attrType = getDracoAttributeType(mod, semantic);
  if (attrType == null) return null;

  const attrId = decoder.GetAttributeId(mesh, attrType);
  if (attrId < 0) return null;

  const attr = decoder.GetAttribute(mesh, attrId);
  const tmp = new mod.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attr, tmp);

  const expected = vertexCount * componentCount;
  const got = tmp.size();
  if (got !== expected) {
    log.warn(
      `Draco ${semantic}: expected ${expected} floats (${vertexCount} × ${componentCount}), ` +
      `got ${got}`,
    );
  }
  const out = new Float32Array(expected);
  for (let i = 0; i < expected; i++) out[i] = tmp.GetValue(i);
  mod.destroy(tmp);
  return out;
}

/** 解码一段 Draco 压缩的 bufferView 字节。 */
export async function decodeDraco(
  compressed: Uint8Array,
  attributes: DracoAttributeSpec[],
): Promise<DecodedMesh> {
  const mod = await getDracoModule();
  const decoder = new mod.Decoder();
  const buffer = new mod.DecoderBuffer();
  const mesh = new mod.Mesh();

  try {
    // draco3d 接受 Int8Array view (内部按字节解码)
    const bytes = new Int8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    buffer.Init(bytes, bytes.length);

    const geomType = decoder.GetEncodedGeometryType(buffer);
    if (geomType === mod.POINT_CLOUD) {
      throw new Error('Draco: point cloud geometry is not supported in GLBLoader');
    }
    if (geomType !== mod.TRIANGULAR_MESH) {
      throw new Error(`Draco: unknown geometry type ${geomType}`);
    }

    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (status !== 0) {
      throw new Error(`Draco: DecodeBufferToMesh failed with status ${status}`);
    }

    const vertexCount = mesh.num_points();
    const triangleCount = mesh.num_faces();

    const result: DecodedMesh = {
      positions: null,
      normals: null,
      uvs: null,
      tangents: null,
      colors: null,
      indices: new Uint32Array(0),
      vertexCount,
      triangleCount,
    };

    for (const spec of attributes) {
      const data = readAttributeFloat(mod, decoder, mesh, spec.semantic, spec.componentCount, vertexCount);
      switch (spec.semantic) {
        case 'POSITION': result.positions = data; break;
        case 'NORMAL': result.normals = data; break;
        case 'TANGENT': result.tangents = data; break;
        case 'TEXCOORD_0': result.uvs = data; break;
        case 'COLOR_0': result.colors = data; break;
      }
    }

    // Indices — 三角形 index 三元组
    const indices = new Uint32Array(triangleCount * 3);
    const tri = new mod.DracoInt32Array();
    for (let f = 0; f < triangleCount; f++) {
      decoder.GetFaceFromMesh(mesh, f, tri);
      indices[f * 3] = tri.GetValue(0);
      indices[f * 3 + 1] = tri.GetValue(1);
      indices[f * 3 + 2] = tri.GetValue(2);
    }
    result.indices = indices;

    return result;
  } finally {
    mod.destroy(buffer);
    mod.destroy(mesh);
    // decoder 自身没有显式 destroy 路径,忽略(Emscripten heap 在 GC 时回收)
  }
}

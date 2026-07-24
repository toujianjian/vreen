// STLLoader — 解析 STL (STereoLithography) 模型格式。
//
// 参考: https://en.wikipedia.org/wiki/STL_(file_format)
//   - 二进制 STL: 80 字节头 + uint32 面数 + 每面 50 字节
//     (12B 法线 + 3*12B 顶点 + 2B 属性,可选 "COLOR=rgba" 默认色 + 每面 16 位色)
//   - ASCII STL: "solid ... endsolid" 块,内含 "facet normal ... endfacet"
//     每个 facet 三个 "vertex x y z"
//
// 输出: BufferGeometry,非索引(position + normal 逐顶点展开);
//       二进制含颜色时附 'color' 属性(itemSize=3)。
//
// API:
//   const geom = parseSTL(buf);            // 直接解析
//   const loader = new STLLoader();
//   const g = await loader.load(fileOrUrl);

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
  toArrayBuffer,
} from './Loader';

export interface STLParseResult {
  /** 解析得到的几何体 (非索引,position + normal,可能带 color)。 */
  geometry: BufferGeometry;
  /** 是否检测到二进制颜色扩展。 */
  hasColors: boolean;
  /** 默认颜色 alpha 通道 (二进制颜色扩展时有效)。 */
  alpha: number;
}

/**
 * 解析 STL 数据 (二进制或 ASCII)。自动判定格式。
 * @param data 二进制 (ArrayBuffer) 或 ASCII 字符串。
 */
export function parseSTL(data: ArrayBuffer | string): BufferGeometry {
  const bin = ensureBinary(data);
  if (isBinary(bin)) {
    return parseBinary(bin);
  }
  return parseASCII(typeof data === 'string' ? data : ensureString(data));
}

/** STLLoader 类,实现 Loader<BufferGeometry> 接口。 */
export class STLLoader implements Loader<BufferGeometry> {
  readonly format = 'stl';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'model/stl') return true;
    if (source instanceof File) return /\.stl$/i.test(source.name);
    if (typeof source === 'string') return /\.stl(\?|$|#)/i.test(source);
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<BufferGeometry> {
    let buf: ArrayBuffer;
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      buf = await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    } else {
      buf = await toArrayBuffer(source);
    }
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return parseSTL(buf);
  }
}

// ── 内部:格式判定 ────────────────────────────────────────────────────

function isBinary(data: ArrayBuffer): boolean {
  const reader = new DataView(data);
  if (data.byteLength < 84) return false;
  // face_size = 12B normal + 3*12B vertices + 2B attr = 50
  const faceSize = (32 / 8) * 3 + ((32 / 8) * 3) * 3 + (16 / 8);
  const nFaces = reader.getUint32(80, true);
  const expected = 80 + 4 + nFaces * faceSize;
  if (expected === reader.byteLength) return true;

  // ASCII STL 必须以 'solid' 开头 (前 5 字节匹配 "solid")
  const solid = [115, 111, 108, 105, 100]; // 's','o','l','i','d'
  for (let off = 0; off < 5; off++) {
    if (matchAt(solid, reader, off)) return false;
  }
  return true;
}

function matchAt(query: number[], reader: DataView, offset: number): boolean {
  for (let i = 0; i < query.length; i++) {
    if (offset + i >= reader.byteLength) return false;
    if (query[i] !== reader.getUint8(offset + i)) return false;
  }
  return true;
}

// ── 内部:二进制解析 ─────────────────────────────────────────────────

function parseBinary(data: ArrayBuffer): BufferGeometry {
  const reader = new DataView(data);
  const faces = reader.getUint32(80, true);

  // 扫描头 80 字节中是否含有 "COLOR=rgba" 默认色标记。
  let hasColors = false;
  let defaultR = 0, defaultG = 0, defaultB = 0, alpha = 1;
  for (let i = 0; i < 80 - 10; i++) {
    if (
      reader.getUint32(i, false) === 0x434f4c4f /* 'COLO' */ &&
      reader.getUint8(i + 4) === 0x52 /* 'R' */ &&
      reader.getUint8(i + 5) === 0x3d /* '=' */
    ) {
      hasColors = true;
      defaultR = reader.getUint8(i + 6) / 255;
      defaultG = reader.getUint8(i + 7) / 255;
      defaultB = reader.getUint8(i + 8) / 255;
      alpha = reader.getUint8(i + 9) / 255;
      break;
    }
  }

  const dataOffset = 84;
  const faceLength = 50;

  const vertices = new Float32Array(faces * 3 * 3);
  const normals = new Float32Array(faces * 3 * 3);
  const colors = hasColors ? new Float32Array(faces * 3 * 3) : null;

  for (let face = 0; face < faces; face++) {
    const start = dataOffset + face * faceLength;
    const nx = reader.getFloat32(start, true);
    const ny = reader.getFloat32(start + 4, true);
    const nz = reader.getFloat32(start + 8, true);

    let r = defaultR, g = defaultG, b = defaultB;
    if (hasColors) {
      const packed = reader.getUint16(start + 48, true);
      if ((packed & 0x8000) === 0) {
        // 面自有颜色 (5-5-5 RGB)
        r = (packed & 0x1f) / 31;
        g = ((packed >> 5) & 0x1f) / 31;
        b = ((packed >> 10) & 0x1f) / 31;
      }
    }

    for (let i = 1; i <= 3; i++) {
      const vStart = start + i * 12;
      const ci = face * 9 + (i - 1) * 3;
      vertices[ci] = reader.getFloat32(vStart, true);
      vertices[ci + 1] = reader.getFloat32(vStart + 4, true);
      vertices[ci + 2] = reader.getFloat32(vStart + 8, true);
      normals[ci] = nx;
      normals[ci + 1] = ny;
      normals[ci + 2] = nz;
      if (colors) {
        colors[ci] = r;
        colors[ci + 1] = g;
        colors[ci + 2] = b;
      }
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(vertices, 3));
  geom.setAttribute('normal', new BufferAttribute(normals, 3));
  if (colors) {
    geom.setAttribute('color', new BufferAttribute(colors, 3));
    geom.userData['hasColors'] = true;
    geom.userData['alpha'] = alpha;
  }
  geom.computeBoundingBox();
  return geom;
}

// ── 内部:ASCII 解析 ─────────────────────────────────────────────────

function parseASCII(data: string): BufferGeometry {
  // 多个 "solid ... endsolid" 块,每个块作为一个 group。
  const patternSolid = /solid([\s\S]*?)endsolid/g;
  const patternFace = /facet([\s\S]*?)endfacet/g;
  const patternName = /solid\s(.+)/;
  const floatRe = /[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source;
  const patternVertex = new RegExp('vertex' + floatRe + floatRe + floatRe, 'g');
  const patternNormal = new RegExp('normal' + floatRe + floatRe + floatRe, 'g');

  const vertices: number[] = [];
  const normals: number[] = [];
  const groupNames: string[] = [];
  const groups: { start: number; count: number }[] = [];

  let endVertex = 0;
  let result: RegExpExecArray | null;
  let groupIdx = 0;

  while ((result = patternSolid.exec(data)) !== null) {
    const startVertex = endVertex;
    const solid = result[0];
    const nameMatch = patternName.exec(solid);
    groupNames.push(nameMatch ? nameMatch[1].trim() : '');

    let faceResult: RegExpExecArray | null;
    while ((faceResult = patternFace.exec(solid)) !== null) {
      const text = faceResult[0];
      let nx = 0, ny = 0, nz = 0;
      let nr: RegExpExecArray | null;
      while ((nr = patternNormal.exec(text)) !== null) {
        nx = parseFloat(nr[1]);
        ny = parseFloat(nr[2]);
        nz = parseFloat(nr[3]);
      }
      let vCount = 0;
      let vr: RegExpExecArray | null;
      while ((vr = patternVertex.exec(text)) !== null) {
        vertices.push(parseFloat(vr[1]), parseFloat(vr[2]), parseFloat(vr[3]));
        normals.push(nx, ny, nz);
        vCount++;
        endVertex++;
      }
      if (vCount !== 3) {
        // 跳过非三角面 (与 three.js 行为一致,仅记录不抛错)
      }
      // 重置 regex lastIndex,避免循环
      patternNormal.lastIndex = 0;
      patternVertex.lastIndex = 0;
    }
    groups.push({ start: startVertex, count: endVertex - startVertex });
    groupIdx++;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
  geom.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  for (const g of groups) {
    geom.groups.push({ start: g.start, count: g.count, materialIndex: 0 });
  }
  geom.userData['groupNames'] = groupNames;
  void groupIdx;
  geom.computeBoundingBox();
  return geom;
}

// ── 内部:类型归一 ────────────────────────────────────────────────────

function ensureString(buffer: ArrayBuffer | string): string {
  if (typeof buffer === 'string') return buffer;
  return new TextDecoder().decode(buffer);
}

function ensureBinary(buffer: ArrayBuffer | string): ArrayBuffer {
  if (typeof buffer === 'string') {
    // 字符串场景:按字节拷贝到 Uint8Array (与 three.js 行为一致)
    const arr = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) arr[i] = buffer.charCodeAt(i) & 0xff;
    return arr.buffer;
  }
  return buffer;
}

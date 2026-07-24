// PLYLoader — 解析 PLY (Polygon File Format / Stanford Triangle Format)。
//
// 参考: http://paulbourke.net/dataformats/ply/
//   - ASCII: "ply\nformat ascii 1.0\n...end_header\n<数据>"
//   - 二进制小端: "format binary_little_endian 1.0"
//   - 二进制大端: "format binary_big_endian 1.0" (本 loader 支持)
//
// 识别的 vertex 属性名 (与 three.js 兼容):
//   position: x/px/posx, y/py/posy, z/pz/posz
//   normal:   nx/normalx, ny/normaly, nz/normalz
//   uv:       s/u/texture_u/tx, t/v/texture_v/ty
//   color:    red/diffuse_red/r, green/..., blue/...
// face 元素: list <countType> <itemType> vertex_indices (三角形)
//
// 输出: BufferGeometry (position 必备;normal/uv/color 可选),索引化。
//
// API:
//   const geom = parsePLY(buf);

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
  toArrayBuffer,
} from './Loader';

// PLY 标量类型 → 字节数
const TYPE_BYTES: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

interface PlyProperty {
  type: string;
  name: string;
  /** list 属性: 计数类型 */
  countType?: string;
  /** list 属性: 元素类型 */
  itemType?: string;
}

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

interface PlyHeader {
  format: 'ascii' | 'binary_little_endian' | 'binary_big_endian';
  version: string;
  comments: string[];
  elements: PlyElement[];
  /** 头部结束位置 (相对 buffer 起点的字节偏移)。 */
  headerLength: number;
}

export class PLYLoader implements Loader<BufferGeometry> {
  readonly format = 'ply';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'application/ply' || hints?.['mime'] === 'model/ply') return true;
    if (source instanceof File) return /\.ply$/i.test(source.name);
    if (typeof source === 'string') return /\.ply(\?|$|#)/i.test(source);
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
    return parsePLY(buf);
  }
}

/**
 * 解析 PLY 数据 (ASCII 或二进制,自动判定)。
 */
export function parsePLY(data: ArrayBuffer): BufferGeometry {
  const header = parseHeader(data);
  if (header.format === 'ascii') {
    return parseASCII(data, header);
  }
  return parseBinary(data, header);
}

// ── 头部解析 ──────────────────────────────────────────────────────────

function parseHeader(data: ArrayBuffer): PlyHeader {
  const u8 = new Uint8Array(data);
  // 找到 "end_header\n" 的位置
  const endMarker = [101, 110, 100, 95, 104, 101, 97, 100, 101, 114]; // 'end_header'
  let headerLen = -1;
  for (let i = 0; i < u8.length - 10; i++) {
    let ok = true;
    for (let k = 0; k < 10; k++) {
      if (u8[i + k] !== endMarker[k]) { ok = false; break; }
    }
    if (ok) {
      // 跳过 "end_header" + 换行
      let j = i + 10;
      if (u8[j] === 0x0d) j++; // \r
      if (u8[j] === 0x0a) j++; // \n
      headerLen = j;
      break;
    }
  }
  if (headerLen < 0) {
    throw new Error('PLYLoader: end_header not found');
  }
  const headerText = new TextDecoder('utf-8').decode(u8.slice(0, headerLen));

  const header: PlyHeader = {
    format: 'ascii',
    version: '1.0',
    comments: [],
    elements: [],
    headerLength: headerLen,
  };

  const lines = headerText.split(/\r\n|\r|\n/);
  let current: PlyElement | null = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const kw = parts[0];
    switch (kw) {
      case 'ply':
        break;
      case 'format': {
        const fmt = parts[1] ?? 'ascii';
        header.version = parts[2] ?? '1.0';
        if (fmt === 'ascii') header.format = 'ascii';
        else if (fmt === 'binary_little_endian') header.format = 'binary_little_endian';
        else if (fmt === 'binary_big_endian') header.format = 'binary_big_endian';
        else throw new Error(`PLYLoader: unknown format '${fmt}'`);
        break;
      }
      case 'comment':
        header.comments.push(parts.slice(1).join(' '));
        break;
      case 'element': {
        if (current) header.elements.push(current);
        current = { name: parts[1] ?? '', count: parseInt(parts[2] ?? '0', 10), properties: [] };
        break;
      }
      case 'property': {
        if (!current) break;
        if (parts[1] === 'list') {
          current.properties.push({
            type: 'list',
            countType: parts[2],
            itemType: parts[3],
            name: parts[4] ?? '',
          });
        } else {
          current.properties.push({ type: parts[1] ?? 'float', name: parts[2] ?? '' });
        }
        break;
      }
      case 'end_header':
        break;
      default:
        // obj_info 等忽略
        break;
    }
  }
  if (current) header.elements.push(current);
  return header;
}

// ── 属性名解析 ────────────────────────────────────────────────────────

interface AttrDescriptor {
  position: { names: string[]; usage: boolean };
  normal: { names: string[]; usage: boolean };
  uv: { names: string[]; usage: boolean };
  color: { names: string[]; usage: boolean; type: string };
}

function findProp(props: PlyProperty[], names: string[]): PlyProperty | null {
  for (const n of names) {
    const p = props.find((p) => p.name === n);
    if (p) return p;
  }
  return null;
}

function describe(props: PlyProperty[]): AttrDescriptor {
  const x = findProp(props, ['x', 'px', 'posx']);
  const y = findProp(props, ['y', 'py', 'posy']);
  const z = findProp(props, ['z', 'pz', 'posz']);
  const nx = findProp(props, ['nx', 'normalx']);
  const ny = findProp(props, ['ny', 'normaly']);
  const nz = findProp(props, ['nz', 'normalz']);
  const s = findProp(props, ['s', 'u', 'texture_u', 'tx']);
  const t = findProp(props, ['t', 'v', 'texture_v', 'ty']);
  const r = findProp(props, ['red', 'diffuse_red', 'r', 'diffuse_r']);
  const g = findProp(props, ['green', 'diffuse_green', 'g', 'diffuse_g']);
  const b = findProp(props, ['blue', 'diffuse_blue', 'b', 'diffuse_b']);
  return {
    position: { names: [x?.name ?? 'x', y?.name ?? 'y', z?.name ?? 'z'], usage: !!(x && y && z) },
    normal: { names: [nx?.name ?? 'nx', ny?.name ?? 'ny', nz?.name ?? 'nz'], usage: !!(nx && ny && nz) },
    uv: { names: [s?.name ?? 's', t?.name ?? 't'], usage: !!(s && t) },
    color: {
      names: [r?.name ?? 'red', g?.name ?? 'green', b?.name ?? 'blue'],
      usage: !!(r && g && b),
      type: r?.type ?? 'uchar',
    },
  };
}

// ── ASCII 解析 ────────────────────────────────────────────────────────

function parseASCII(data: ArrayBuffer, header: PlyHeader): BufferGeometry {
  const text = new TextDecoder('utf-8').decode(new Uint8Array(data));
  // 取 end_header 之后的内容
  const endIdx = text.indexOf('end_header');
  const afterHeader = endIdx >= 0
    ? text.slice(endIdx + 'end_header'.length).replace(/^\s+/, '')
    : '';
  const tokens = afterHeader.split(/\s+/).filter((t) => t.length > 0);

  let pos = 0;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let colorScale = 1 / 255;
  let colorIsFloat = false;

  for (const el of header.elements) {
    const desc = describe(el.properties);
    if (el.name === 'vertex') {
      colorScale = colorScaleFor(desc.color.type);
      colorIsFloat = isFloatType(desc.color.type);
      for (let i = 0; i < el.count; i++) {
        const obj: Record<string, number> = {};
        for (const p of el.properties) {
          if (p.type === 'list') {
            const n = parseInt(tokens[pos++] ?? '0', 10);
            for (let k = 0; k < n; k++) tokens[pos++];
          } else {
            obj[p.name] = parseScalar(tokens[pos++], p.type);
          }
        }
        if (desc.position.usage) {
          positions.push(obj[desc.position.names[0]] ?? 0, obj[desc.position.names[1]] ?? 0, obj[desc.position.names[2]] ?? 0);
        }
        if (desc.normal.usage) {
          normals.push(obj[desc.normal.names[0]] ?? 0, obj[desc.normal.names[1]] ?? 0, obj[desc.normal.names[2]] ?? 0);
        }
        if (desc.uv.usage) {
          uvs.push(obj[desc.uv.names[0]] ?? 0, obj[desc.uv.names[1]] ?? 0);
        }
        if (desc.color.usage) {
          const r = obj[desc.color.names[0]] ?? 0;
          const g = obj[desc.color.names[1]] ?? 0;
          const b = obj[desc.color.names[2]] ?? 0;
          colors.push(r * colorScale, g * colorScale, b * colorScale);
        }
      }
    } else if (el.name === 'face') {
      // face 元素一般含一个 list 属性 (vertex_indices)
      for (let i = 0; i < el.count; i++) {
        // 找 list 属性
        let listProp: PlyProperty | null = null;
        for (const p of el.properties) {
          if (p.type === 'list') { listProp = p; break; }
        }
        if (!listProp) {
          // 无 list,跳过该 face 的所有属性
          for (let j = 0; j < el.properties.length; j++) tokens[pos++] = '';
          continue;
        }
        const n = parseInt(tokens[pos++] ?? '0', 10);
        const faceIdx: number[] = [];
        for (let k = 0; k < n; k++) {
          faceIdx.push(parseScalar(tokens[pos++], listProp.itemType ?? 'int'));
        }
        // 三角扇形展开
        for (let k = 1; k < faceIdx.length - 1; k++) {
          indices.push(faceIdx[0], faceIdx[k], faceIdx[k + 1]);
        }
      }
    } else {
      // 未知元素:跳过其所有属性
      for (let i = 0; i < el.count; i++) {
        for (const p of el.properties) {
          if (p.type === 'list') {
            const n = parseInt(tokens[pos++] ?? '0', 10);
            for (let k = 0; k < n; k++) tokens[pos++];
          } else {
            tokens[pos++] = '';
          }
        }
      }
    }
  }

  return buildGeometry(positions, normals, uvs, colors, indices, colorIsFloat);
}

// ── 二进制解析 ────────────────────────────────────────────────────────

function parseBinary(data: ArrayBuffer, header: PlyHeader): BufferGeometry {
  const little = header.format === 'binary_little_endian';
  const dv = new DataView(data);
  let pos = header.headerLength;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let colorScale = 1 / 255;
  let colorIsFloat = false;

  function readScalar(type: string): number {
    const bytes = TYPE_BYTES[type] ?? 4;
    let v = 0;
    switch (type) {
      case 'char': case 'int8': v = dv.getInt8(pos); break;
      case 'uchar': case 'uint8': v = dv.getUint8(pos); break;
      case 'short': case 'int16': v = dv.getInt16(pos, little); break;
      case 'ushort': case 'uint16': v = dv.getUint16(pos, little); break;
      case 'int': case 'int32': v = dv.getInt32(pos, little); break;
      case 'uint': case 'uint32': v = dv.getUint32(pos, little); break;
      case 'float': case 'float32': v = dv.getFloat32(pos, little); break;
      case 'double': case 'float64': v = dv.getFloat64(pos, little); break;
      default: v = dv.getFloat32(pos, little);
    }
    pos += bytes;
    return v;
  }

  for (const el of header.elements) {
    const desc = describe(el.properties);
    if (el.name === 'vertex') {
      colorScale = colorScaleFor(desc.color.type);
      colorIsFloat = isFloatType(desc.color.type);
      for (let i = 0; i < el.count; i++) {
        const obj: Record<string, number> = {};
        for (const p of el.properties) {
          if (p.type === 'list') {
            const n = readScalar(p.countType ?? 'uchar');
            for (let k = 0; k < n; k++) readScalar(p.itemType ?? 'int');
          } else {
            obj[p.name] = readScalar(p.type);
          }
        }
        if (desc.position.usage) {
          positions.push(obj[desc.position.names[0]] ?? 0, obj[desc.position.names[1]] ?? 0, obj[desc.position.names[2]] ?? 0);
        }
        if (desc.normal.usage) {
          normals.push(obj[desc.normal.names[0]] ?? 0, obj[desc.normal.names[1]] ?? 0, obj[desc.normal.names[2]] ?? 0);
        }
        if (desc.uv.usage) {
          uvs.push(obj[desc.uv.names[0]] ?? 0, obj[desc.uv.names[1]] ?? 0);
        }
        if (desc.color.usage) {
          const r = obj[desc.color.names[0]] ?? 0;
          const g = obj[desc.color.names[1]] ?? 0;
          const b = obj[desc.color.names[2]] ?? 0;
          colors.push(r * colorScale, g * colorScale, b * colorScale);
        }
      }
    } else if (el.name === 'face') {
      for (let i = 0; i < el.count; i++) {
        let listProp: PlyProperty | null = null;
        for (const p of el.properties) {
          if (p.type === 'list') { listProp = p; break; }
        }
        if (!listProp) {
          for (const p of el.properties) {
            if (p.type === 'list') {
              const n = readScalar(p.countType ?? 'uchar');
              for (let k = 0; k < n; k++) readScalar(p.itemType ?? 'int');
            } else {
              readScalar(p.type);
            }
          }
          continue;
        }
        const n = readScalar(listProp.countType ?? 'uchar');
        const faceIdx: number[] = [];
        for (let k = 0; k < n; k++) faceIdx.push(readScalar(listProp.itemType ?? 'int'));
        for (let k = 1; k < faceIdx.length - 1; k++) {
          indices.push(faceIdx[0], faceIdx[k], faceIdx[k + 1]);
        }
      }
    } else {
      for (let i = 0; i < el.count; i++) {
        for (const p of el.properties) {
          if (p.type === 'list') {
            const n = readScalar(p.countType ?? 'uchar');
            for (let k = 0; k < n; k++) readScalar(p.itemType ?? 'int');
          } else {
            readScalar(p.type);
          }
        }
      }
    }
  }

  return buildGeometry(positions, normals, uvs, colors, indices, colorIsFloat);
}

// ── 共用工具 ──────────────────────────────────────────────────────────

function buildGeometry(
  positions: number[],
  normals: number[],
  uvs: number[],
  colors: number[],
  indices: number[],
  colorIsFloat: boolean,
): BufferGeometry {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  if (normals.length > 0) {
    geom.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  }
  if (uvs.length > 0) {
    geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  }
  if (colors.length > 0) {
    // 颜色已按 colorScale 归一化到 0..1,作为 Float32 存储。
    geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  }
  if (indices.length > 0) {
    geom.setIndex(indices);
  }
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  void colorIsFloat;
  return geom;
}

function parseScalar(token: string, type: string): number {
  if (isFloatType(type)) return parseFloat(token);
  return parseInt(token, 10);
}

function isFloatType(type: string): boolean {
  return type === 'float' || type === 'float32' || type === 'double' || type === 'float64';
}

function colorScaleFor(type: string): number {
  switch (type) {
    case 'uchar': case 'uint8': return 1 / 255;
    case 'ushort': case 'uint16': return 1 / 65535;
    case 'float': case 'float32':
    case 'double': case 'float64': return 1;
    default: return 1 / 255;
  }
}

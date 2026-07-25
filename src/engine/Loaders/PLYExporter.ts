// PLYExporter — 将 VREEN Mesh 导出为 PLY(Polygon File Format)格式。
//
// 参考: http://paulbourke.net/dataformats/ply/
//   - ASCII:        "ply\nformat ascii 1.0\n...end_header\n<data>"
//   - 二进制小端:   "format binary_little_endian 1.0"
//
// 输出:
//   - ASCII → string
//   - 二进制 → Uint8Array
//
// 顶点属性:position(必备) + normal/uv(如 geometry 中存在)。
// 面:list uchar int vertex_indices(三角形扇形展开)。
//
// API:
//   const exp = new PLYExporter();
//   const text = exp.parse(mesh);                    // ASCII
//   const buf  = exp.parse(mesh, { binary: true });  // 二进制

import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import type { BufferGeometry } from '../Core/BufferGeometry';

export interface PLYExportOptions {
  /** 输出二进制 PLY(默认 ASCII)。 */
  binary?: boolean;
}

/**
 * PLYExporter — 遍历 Object3D 子树,合并所有 Mesh 的几何体后输出 PLY。
 *
 * 与 three.js PLYExporter 的差异:
 *  - 不支持 color 属性
 *  - 不支持多边形(只输出三角形)
 *  - 所有 mesh 合并为单一 vertex/face 表
 */
export class PLYExporter {
  /** 导出 ASCII 字符串或二进制 Uint8Array。 */
  parse(root: Object3D, options?: PLYExportOptions): string | Uint8Array {
    const binary = options?.binary ?? false;
    const data = collectGeometry(root);
    if (binary) return buildBinary(data);
    return buildASCII(data);
  }
}

interface PLYData {
  positions: number[];   // [x0,y0,z0, x1,y1,z1, ...]
  normals: number[];     // 同上,长度 0 表示无
  uvs: number[];         // [u0,v0, u1,v1, ...]
  indices: number[];     // 三角形索引
  hasNormal: boolean;
  hasUV: boolean;
}

// ── 内部:几何收集 ──────────────────────────────────────────────

function collectGeometry(root: Object3D): PLYData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let hasNormal = false;
  let hasUV = false;

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (!obj.visible) return;
    const geom: BufferGeometry = obj.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;
    const nrm = geom.attributes.normal;
    const uv = geom.attributes.uv;
    const idx = geom.index;

    const baseVertex = positions.length / 3;
    const matWorld = obj.matrixWorld.elements;

    const pushPos = (i: number): void => {
      const a = pos.array;
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      positions.push(
        matWorld[0] * x + matWorld[4] * y + matWorld[8]  * z + matWorld[12],
        matWorld[1] * x + matWorld[5] * y + matWorld[9]  * z + matWorld[13],
        matWorld[2] * x + matWorld[6] * y + matWorld[10] * z + matWorld[14],
      );
    };
    const pushNrm = (i: number): void => {
      const a = nrm!.array;
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      normals.push(
        matWorld[0] * x + matWorld[4] * y + matWorld[8]  * z,
        matWorld[1] * x + matWorld[5] * y + matWorld[9]  * z,
        matWorld[2] * x + matWorld[6] * y + matWorld[10] * z,
      );
    };
    const pushUV = (i: number): void => {
      const a = uv!.array;
      uvs.push(a[i * 2], a[i * 2 + 1]);
    };

    const wantNrm = !!nrm;
    const wantUV = !!uv;
    hasNormal = hasNormal || wantNrm;
    hasUV = hasUV || wantUV;

    if (idx) {
      const a = idx.array as unknown as ArrayLike<number>;
      const vc = pos.count;
      // 注意:索引化 mesh 中,顶点需按 index 引用展开后追加
      // 但若 hasNormal/hasUV 但当前 mesh 无对应属性,需补 0
      // 为简化:对每个 mesh 都按其自身属性输出,缺位补 0
      // 但这样会导致全表 normal/uv 列对不齐 —— 这里要求所有 mesh 同质
      // 实际:统一行为 — 若全局 hasNormal 则每 vertex 都写 normal(若本 mesh 无,写 0)
      for (let i = 0; i < vc; i++) {
        pushPos(i);
        if (hasNormal) {
          if (wantNrm) pushNrm(i);
          else normals.push(0, 0, 0);
        }
        if (hasUV) {
          if (wantUV) pushUV(i);
          else uvs.push(0, 0);
        }
      }
      for (let i = 0; i + 2 < a.length; i += 3) {
        indices.push(baseVertex + a[i], baseVertex + a[i + 1], baseVertex + a[i + 2]);
      }
    } else {
      const vc = pos.count;
      for (let i = 0; i < vc; i++) {
        pushPos(i);
        if (hasNormal) {
          if (wantNrm) pushNrm(i);
          else normals.push(0, 0, 0);
        }
        if (hasUV) {
          if (wantUV) pushUV(i);
          else uvs.push(0, 0);
        }
      }
      for (let i = 0; i + 2 < vc; i += 3) {
        indices.push(baseVertex + i, baseVertex + i + 1, baseVertex + i + 2);
      }
    }
  });

  return { positions, normals, uvs, indices, hasNormal, hasUV };
}

// ── 内部:ASCII 输出 ────────────────────────────────────────────

function buildASCII(data: PLYData): string {
  const vCount = data.positions.length / 3;
  const fCount = data.indices.length / 3;
  const lines: string[] = [
    'ply',
    'format ascii 1.0',
    'comment Exported by VREEN PLYExporter',
    `element vertex ${vCount}`,
    'property float x',
    'property float y',
    'property float z',
  ];
  if (data.hasNormal) {
    lines.push(
      'property float nx',
      'property float ny',
      'property float nz',
    );
  }
  if (data.hasUV) {
    lines.push(
      'property float s',
      'property float t',
    );
  }
  lines.push(
    `element face ${fCount}`,
    'property list uchar int vertex_indices',
    'end_header',
  );

  for (let i = 0; i < vCount; i++) {
    let line = `${fmt(data.positions[i * 3])} ${fmt(data.positions[i * 3 + 1])} ${fmt(data.positions[i * 3 + 2])}`;
    if (data.hasNormal) {
      line += ` ${fmt(data.normals[i * 3])} ${fmt(data.normals[i * 3 + 1])} ${fmt(data.normals[i * 3 + 2])}`;
    }
    if (data.hasUV) {
      line += ` ${fmt(data.uvs[i * 2])} ${fmt(data.uvs[i * 2 + 1])}`;
    }
    lines.push(line);
  }
  for (let i = 0; i < fCount; i++) {
    lines.push(`3 ${data.indices[i * 3]} ${data.indices[i * 3 + 1]} ${data.indices[i * 3 + 2]}`);
  }
  return lines.join('\n') + '\n';
}

function fmt(n: number): string {
  return n.toString();
}

// ── 内部:二进制输出 ───────────────────────────────────────────

function buildBinary(data: PLYData): Uint8Array {
  const vCount = data.positions.length / 3;
  const fCount = data.indices.length / 3;

  // 每顶点字节数:position(3*float32=12) + normal(12) + uv(8)
  let vertexStride = 12;
  if (data.hasNormal) vertexStride += 12;
  if (data.hasUV) vertexStride += 8;
  // 每面字节数:uchar(1) + 3*int32(12) = 13,需 4 字节对齐到 16(标准做法不对齐面内字段,但 face 起始需对齐 — 实际 PLY 不要求 face 对齐)
  // 标准 PLY 二进制:face = 1B count + N*itemB
  const faceStride = 1 + 3 * 4; // 13

  // 头部文本
  const headerLines: string[] = [
    'ply',
    'format binary_little_endian 1.0',
    'comment Exported by VREEN PLYExporter',
    `element vertex ${vCount}`,
    'property float x',
    'property float y',
    'property float z',
  ];
  if (data.hasNormal) {
    headerLines.push('property float nx', 'property float ny', 'property float nz');
  }
  if (data.hasUV) {
    headerLines.push('property float s', 'property float t');
  }
  headerLines.push(
    `element face ${fCount}`,
    'property list uchar int vertex_indices',
    'end_header',
  );
  const headerText = headerLines.join('\n') + '\n';
  const headerBytes = new TextEncoder().encode(headerText);

  const totalBytes = headerBytes.length + vCount * vertexStride + fCount * faceStride;
  const out = new Uint8Array(totalBytes);
  const dv = new DataView(out.buffer);
  let off = 0;
  out.set(headerBytes, off);
  off += headerBytes.length;

  for (let i = 0; i < vCount; i++) {
    dv.setFloat32(off + 0, data.positions[i * 3], true);
    dv.setFloat32(off + 4, data.positions[i * 3 + 1], true);
    dv.setFloat32(off + 8, data.positions[i * 3 + 2], true);
    off += 12;
    if (data.hasNormal) {
      dv.setFloat32(off + 0, data.normals[i * 3], true);
      dv.setFloat32(off + 4, data.normals[i * 3 + 1], true);
      dv.setFloat32(off + 8, data.normals[i * 3 + 2], true);
      off += 12;
    }
    if (data.hasUV) {
      dv.setFloat32(off + 0, data.uvs[i * 2], true);
      dv.setFloat32(off + 4, data.uvs[i * 2 + 1], true);
      off += 8;
    }
  }
  for (let i = 0; i < fCount; i++) {
    dv.setUint8(off + 0, 3);
    dv.setInt32(off + 1, data.indices[i * 3], true);
    dv.setInt32(off + 5, data.indices[i * 3 + 1], true);
    dv.setInt32(off + 9, data.indices[i * 3 + 2], true);
    off += 13;
  }
  return out;
}

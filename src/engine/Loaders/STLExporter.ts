// STLExporter — 将 VREEN Mesh 导出为 STL(StereoLithography)格式。
//
// 参考: https://en.wikipedia.org/wiki/STL_(file_format)
//   - ASCII:  "solid <name>\nfacet normal nx ny nz\n  outer loop\n    vertex x y z\n..." 末尾 "endsolid <name>"
//   - Binary: 80B 头 + uint32 面数 + 每面 50B (12B 法线 + 3*12B 顶点 + 2B 属性)
//
// 输出:
//   - ASCII → string
//   - Binary → Uint8Array
//
// API:
//   const exp = new STLExporter();
//   const text = exp.parse(mesh);                    // ASCII
//   const buf  = exp.parse(mesh, { binary: true });  // 二进制

import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';

export interface STLExportOptions {
  /** 输出二进制 STL(默认 ASCII)。 */
  binary?: boolean;
}

/**
 * STLExporter — 遍历 Object3D 子树,把每个 Mesh 的几何体展开为三角形列表后输出 STL。
 *
 * 与 three.js STLExporter 的差异:
 *  - 不支持颜色(二进制 COLOR=rgba 扩展)
 *  - 不写自定义 header 文本(80B 全 0)
 */
export class STLExporter {
  /** 导出 ASCII 字符串或二进制 Uint8Array。 */
  parse(root: Object3D, options?: STLExportOptions): string | Uint8Array {
    const binary = options?.binary ?? false;
    const tris = collectTriangles(root);
    if (binary) return buildBinary(tris);
    return buildASCII(tris);
  }
}

interface Triangle {
  normal: [number, number, number];
  v0: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
}

// ── 内部:三角形收集 ──────────────────────────────────────────────────

function collectTriangles(root: Object3D): Triangle[] {
  const out: Triangle[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (!obj.visible) return;
    const geom = obj.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;
    const nrm = geom.attributes.normal;
    const idx = geom.index;

    // 取顶点数据(本地空间);转世界空间
    const matWorld = obj.matrixWorld.elements;
    const worldPos = (i: number, out: [number, number, number]): void => {
      const a = pos.array;
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      out[0] = matWorld[0] * x + matWorld[4] * y + matWorld[8]  * z + matWorld[12];
      out[1] = matWorld[1] * x + matWorld[5] * y + matWorld[9]  * z + matWorld[13];
      out[2] = matWorld[2] * x + matWorld[6] * y + matWorld[10] * z + matWorld[14];
    };
    const worldNormal = (i: number, out: [number, number, number]): void => {
      if (!nrm) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
      const a = nrm.array;
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      // 法线用上 3x3 逆转置变换;对于正交旋转(均匀 scale)直接用 mat3 变换即可。
      // 简化:用 mat3 * n(normal 矩阵)
      out[0] = matWorld[0] * x + matWorld[4] * y + matWorld[8]  * z;
      out[1] = matWorld[1] * x + matWorld[5] * y + matWorld[9]  * z;
      out[2] = matWorld[2] * x + matWorld[6] * y + matWorld[10] * z;
    };

    const emitTri = (ia: number, ib: number, ic: number): void => {
      const v0: [number, number, number] = [0, 0, 0];
      const v1: [number, number, number] = [0, 0, 0];
      const v2: [number, number, number] = [0, 0, 0];
      worldPos(ia, v0);
      worldPos(ib, v1);
      worldPos(ic, v2);
      let normal: [number, number, number];
      if (nrm) {
        // 取面法线(三个顶点法线平均);STL 期望每面一个法线
        const n0: [number, number, number] = [0, 0, 0];
        const n1: [number, number, number] = [0, 0, 0];
        const n2: [number, number, number] = [0, 0, 0];
        worldNormal(ia, n0);
        worldNormal(ib, n1);
        worldNormal(ic, n2);
        const nx = n0[0] + n1[0] + n2[0];
        const ny = n0[1] + n1[1] + n2[1];
        const nz = n0[2] + n1[2] + n2[2];
        const len = Math.hypot(nx, ny, nz) || 1;
        normal = [nx / len, ny / len, nz / len];
      } else {
        // 从位置叉积求法线
        const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
        const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz) || 1;
        normal = [nx / len, ny / len, nz / len];
      }
      out.push({ normal, v0, v1, v2 });
    };

    if (idx) {
      const a = idx.array as unknown as ArrayLike<number>;
      for (let i = 0; i + 2 < a.length; i += 3) {
        emitTri(a[i], a[i + 1], a[i + 2]);
      }
    } else {
      const vc = pos.count;
      for (let i = 0; i + 2 < vc; i += 3) {
        emitTri(i, i + 1, i + 2);
      }
    }
  });
  return out;
}

// ── 内部:ASCII 输出 ──────────────────────────────────────────────

function buildASCII(tris: Triangle[]): string {
  const lines: string[] = ['solid VREEN'];
  for (const t of tris) {
    lines.push(`  facet normal ${fmt(t.normal[0])} ${fmt(t.normal[1])} ${fmt(t.normal[2])}`);
    lines.push('    outer loop');
    lines.push(`      vertex ${fmt(t.v0[0])} ${fmt(t.v0[1])} ${fmt(t.v0[2])}`);
    lines.push(`      vertex ${fmt(t.v1[0])} ${fmt(t.v1[1])} ${fmt(t.v1[2])}`);
    lines.push(`      vertex ${fmt(t.v2[0])} ${fmt(t.v2[1])} ${fmt(t.v2[2])}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push('endsolid VREEN');
  return lines.join('\n') + '\n';
}

function fmt(n: number): string {
  // 与 STLLoader 解析兼容的精度
  return n.toFixed(6);
}

// ── 内部:二进制输出 ─────────────────────────────────────────────

function buildBinary(tris: Triangle[]): Uint8Array {
  const totalBytes = 80 + 4 + tris.length * 50;
  const out = new Uint8Array(totalBytes);
  const dv = new DataView(out.buffer);
  // 80 字节头:全 0(不写描述文本)
  // 面数
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    dv.setFloat32(off + 0,  t.normal[0], true);
    dv.setFloat32(off + 4,  t.normal[1], true);
    dv.setFloat32(off + 8,  t.normal[2], true);
    dv.setFloat32(off + 12, t.v0[0], true);
    dv.setFloat32(off + 16, t.v0[1], true);
    dv.setFloat32(off + 20, t.v0[2], true);
    dv.setFloat32(off + 24, t.v1[0], true);
    dv.setFloat32(off + 28, t.v1[1], true);
    dv.setFloat32(off + 32, t.v1[2], true);
    dv.setFloat32(off + 36, t.v2[0], true);
    dv.setFloat32(off + 40, t.v2[1], true);
    dv.setFloat32(off + 44, t.v2[2], true);
    dv.setUint16(off + 48, 0, true); // attribute
    off += 50;
  }
  return out;
}

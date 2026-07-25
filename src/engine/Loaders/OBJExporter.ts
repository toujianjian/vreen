// OBJExporter — walks a Group/Mesh tree and emits a Wavefront OBJ text.
// Used to give the Java build tool a plain-text representation of the
// scene so it can produce native engine assets without going through
// the .vreen JSON layer.
//
// 输出:
//   - 每个_MESH 一个 `o <name>` 块
//   - v/vn/vt 全局递增(跨 mesh 共享索引空间,与 OBJ 习惯一致)
//   - `usemtl <name>` 引用材质
//   - `f v/vt/vn` 三角形(若 vt/vn 不存在则降级为 `f v` 或 `f v//vn`)
//
// API:
//   const text = exportOBJ(root);            // 函数式
//   const text = new OBJExporter().parse(root);  // 类式(three.js 风格)

import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';
import type { Material } from '../Core/Material';
import { StandardMaterial } from '../Materials/StandardMaterial';

/** 函数式入口(等价于 `new OBJExporter().parse(root)`)。 */
export function exportOBJ(root: Object3D): string {
  return new OBJExporter().parse(root);
}

/**
 * OBJExporter — three.js 兼容风格的类入口。
 * `parse(object)` 返回 OBJ 文本。
 */
export class OBJExporter {
  parse(root: Object3D): string {
    const lines: string[] = ['# Exported by VREEN engine', ''];

    // 全局索引偏移(OBJ 1-based,跨 mesh 连续)
    let vOffset = 0;
    let vtOffset = 0;
    let vnOffset = 0;
    let mIndex = 0;

    root.updateMatrixWorld(true);
    root.traverse((obj) => {
      if (obj instanceof Group) return; // groups 不输出,其子节点的 `o` 来描述
      if (!(obj instanceof Mesh)) return;
      if (!obj.visible) return;
      const mesh = obj as Mesh;
      const geom = mesh.geometry;
      const pos = geom.attributes.position;
      if (!pos) return;

      const nrm = geom.attributes.normal;
      const uv = geom.attributes.uv;
      const idx = geom.index;

      const matWorld = obj.matrixWorld.elements;

      lines.push(`o ${sanitizeName(mesh.name || `mesh_${mIndex++}`)}`);

      // 材质引用(取第一个材质)
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat) {
        const name = materialName(mat) ?? `mat_${mIndex}`;
        lines.push(`usemtl ${name}`);
      }

      // 顶点位置(转世界空间)
      for (let i = 0; i < pos.count; i++) {
        const a = pos.array;
        const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        const wx = matWorld[0] * x + matWorld[4] * y + matWorld[8]  * z + matWorld[12];
        const wy = matWorld[1] * x + matWorld[5] * y + matWorld[9]  * z + matWorld[13];
        const wz = matWorld[2] * x + matWorld[6] * y + matWorld[10] * z + matWorld[14];
        lines.push(`v ${fmt(wx)} ${fmt(wy)} ${fmt(wz)}`);
      }

      // 纹理坐标
      if (uv) {
        for (let i = 0; i < uv.count; i++) {
          const a = uv.array;
          lines.push(`vt ${fmt(a[i * 2])} ${fmt(a[i * 2 + 1])}`);
        }
      }

      // 法线(转世界空间,用 mat3 变换)
      if (nrm) {
        for (let i = 0; i < nrm.count; i++) {
          const a = nrm.array;
          const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
          const wx = matWorld[0] * x + matWorld[4] * y + matWorld[8]  * z;
          const wy = matWorld[1] * x + matWorld[5] * y + matWorld[9]  * z;
          const wz = matWorld[2] * x + matWorld[6] * y + matWorld[10] * z;
          const len = Math.hypot(wx, wy, wz) || 1;
          lines.push(`vn ${fmt(wx / len)} ${fmt(wy / len)} ${fmt(wz / len)}`);
        }
      }

      // 面(三角形)。索引或非索引
      const emitFace = (a: number, b: number, c: number): void => {
        // 1-based + offset,需要分别给 v/vt/vn 加偏移
        const va = a + 1 + vOffset;
        const vb = b + 1 + vOffset;
        const vc = c + 1 + vOffset;
        if (uv && nrm) {
          lines.push(`f ${va}/${a + 1 + vtOffset}/${a + 1 + vnOffset} ${vb}/${b + 1 + vtOffset}/${b + 1 + vnOffset} ${vc}/${c + 1 + vtOffset}/${c + 1 + vnOffset}`);
        } else if (nrm) {
          lines.push(`f ${va}//${a + 1 + vnOffset} ${vb}//${b + 1 + vnOffset} ${vc}//${c + 1 + vnOffset}`);
        } else if (uv) {
          lines.push(`f ${va}/${a + 1 + vtOffset} ${vb}/${b + 1 + vtOffset} ${vc}/${c + 1 + vtOffset}`);
        } else {
          lines.push(`f ${va} ${vb} ${vc}`);
        }
      };

      if (idx) {
        const a = idx.array as unknown as ArrayLike<number>;
        for (let i = 0; i + 2 < a.length; i += 3) {
          emitFace(a[i], a[i + 1], a[i + 2]);
        }
      } else {
        const vc = pos.count;
        for (let i = 0; i + 2 < vc; i += 3) {
          emitFace(i, i + 1, i + 2);
        }
      }

      // 更新偏移(下一个 mesh 的索引基础)
      vOffset += pos.count;
      if (uv) vtOffset += uv.count;
      if (nrm) vnOffset += nrm.count;
      lines.push('');
    });

    return lines.join('\n');
  }
}

function fmt(n: number): string {
  return n.toFixed(6);
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_\-.]/g, '_');
}

function materialName(m: Material): string | null {
  if (m instanceof StandardMaterial) {
    const stored = m.userData['__mtlName'] as string | undefined;
    if (stored) return stored;
  }
  return m.type || null;
}

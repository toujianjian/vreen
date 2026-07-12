// OBJExporter — walks a Group/Mesh tree and emits a Wavefront OBJ text.
// Used to give the Java build tool a plain-text representation of the
// scene so it can produce native engine assets without going through
// the .vreen JSON layer.
//
// Limitations: positions only, single `o` per mesh, no material split
// beyond `usemtl <name>`. We do not write normals or UVs unless the
// geometry already has them and we know they are flat-equal across the
// mesh (we keep things simple here).

import { Object3D } from '../Core/Object3D';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';
import type { Material } from '../Core/Material';
import { StandardMaterial } from '../Materials/StandardMaterial';

export function exportOBJ(root: Object3D): string {
  const lines: string[] = ['# Exported by VREEN engine', ''];
  let vOffset = 0;
  let mIndex = 0;

  root.traverse((obj) => {
    if (obj instanceof Group) return; // groups don't emit; their children's `o` does
    if (!(obj instanceof Mesh)) return;
    const mesh = obj as Mesh;
    const geom = mesh.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;

    lines.push(`o ${sanitizeName(mesh.name || `mesh_${mIndex++}`)}`);

    // Material reference (one per mesh, picks the first material).
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (mat) {
      const name = materialName(mat) ?? `mat_${mIndex}`;
      lines.push(`usemtl ${name}`);
    }

    // Positions
    for (let i = 0; i < pos.array.length; i += 3) {
      lines.push(`v ${fmt(pos.array[i])} ${fmt(pos.array[i + 1])} ${fmt(pos.array[i + 2])}`);
    }
    // Indices — use the OBJ 1-based offset.
    const idx = geom.index;
    if (idx) {
      const a = idx.array as unknown as ArrayLike<number>;
      for (let i = 0; i < a.length; i += 3) {
        lines.push(`f ${a[i] + 1 + vOffset} ${a[i + 1] + 1 + vOffset} ${a[i + 2] + 1 + vOffset}`);
      }
    } else {
      // No index: emit sequential triangles.
      for (let i = 0; i < pos.count; i += 3) {
        lines.push(`f ${vOffset + i + 1} ${vOffset + i + 2} ${vOffset + i + 3}`);
      }
    }
    vOffset += pos.count;
    lines.push('');
  });

  return lines.join('\n');
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

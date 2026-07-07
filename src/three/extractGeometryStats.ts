// extractGeometryStats.ts — given a THREE.Object3D, pull out the metrics a
// game developer typically needs to inspect (vertex/face counts, attribute
// presence, AABB, material textures). Kept separate from Inspector so it
// can be unit-tested or reused by the export pipeline.

import * as THREE from 'three';
import type { GeometryStats } from '@/stores/inspectorStore';

const TEXTURE_SLOTS: (keyof THREE.MeshStandardMaterial)[] = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'envMap',
];

export function extractGeometryStats(obj: THREE.Object3D | null): GeometryStats | null {
  if (!obj) return null;
  if (!(obj instanceof THREE.Mesh)) return null;

  const geom = obj.geometry as THREE.BufferGeometry | undefined;
  if (!geom) return null;

  // Vertex count: prefer index.length, else position.count.
  let vertexCount = 0;
  if (geom.index) {
    vertexCount = geom.index.count;
  } else {
    const pos = geom.attributes['position'] as THREE.BufferAttribute | undefined;
    vertexCount = pos ? pos.count : 0;
  }

  // Face count: every 3 indices = 1 face.
  const faceCount = Math.floor(vertexCount / 3);

  // Compute (or use cached) bounding box.
  let bbox: GeometryStats['bbox'] = null;
  if (geom.boundingBox === null) geom.computeBoundingBox();
  if (geom.boundingBox) {
    const min = geom.boundingBox.min;
    const max = geom.boundingBox.max;
    bbox = {
      min: [min.x, min.y, min.z],
      max: [max.x, max.y, max.z],
      size: [max.x - min.x, max.y - min.y, max.z - min.z],
    };
  }

  // Material texture list.
  const textures: string[] = [];
  const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.Material | undefined;
  if (mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const m = mat as THREE.MeshStandardMaterial;
    for (const slot of TEXTURE_SLOTS) {
      const tex = (m as unknown as Record<string, THREE.Texture | null>)[slot];
      if (tex && (tex as THREE.Texture).image) {
        const img = (tex as THREE.Texture).image as { name?: string; src?: string; width?: number; height?: number };
        const tag = slot.replace('Map', '').toUpperCase() || 'MAP';
        const ref = img.name || img.src || `${(tex as THREE.Texture).uuid.slice(0, 6)}`;
        const w = img.width ? `${img.width}x${img.height}` : '';
        textures.push(`${tag} · ${ref} ${w}`.trim());
      }
    }
  } else if (Array.isArray(mat)) {
    mat.forEach((m, i) => {
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        textures.push(`[${i}] ${(m as THREE.MeshStandardMaterial).name || (m as THREE.MeshStandardMaterial).type}`);
      }
    });
  }

  return {
    vertexCount,
    faceCount,
    hasPosition: !!geom.attributes['position'],
    hasNormal: !!geom.attributes['normal'],
    hasUV: !!geom.attributes['uv'] || !!geom.attributes['uv1'] || !!geom.attributes['uv2'],
    hasColor: !!geom.attributes['color'],
    hasTangent: !!geom.attributes['tangent'],
    bbox,
    indexed: !!geom.index,
    groupCount: geom.groups.length,
    textures,
  };
}

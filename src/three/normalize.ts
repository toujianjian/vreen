// Helpers to normalize a loaded model — center, scale, enable shadows, traverse materials.

import * as THREE from 'three';
import type { SceneNode, NodeKind } from '@/types';

export interface NormalizeOptions {
  /** Target diameter in world units after normalization */
  targetSize?: number;
  /** Lift the model so the bottom of its bounding box sits at y=0 */
  sitOnGround?: boolean;
}

/**
 * Center a model at the origin, scale it to the target size, and ensure
 * shadow flags are set on all meshes. Returns the original root unchanged
 * in identity but mutated in transform.
 */
export function normalizeObject(root: THREE.Object3D, opts: NormalizeOptions = {}): THREE.Object3D {
  const targetSize = opts.targetSize ?? 2.4;
  const sitOnGround = opts.sitOnGround ?? true;

  // Compute bounding box
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Move children so root effectively centers at origin
  root.position.x -= center.x;
  root.position.y -= center.y;
  root.position.z -= center.z;

  // Update world matrices
  root.updateMatrixWorld(true);

  // Compute new bounds after translation
  const box2 = new THREE.Box3().setFromObject(root);
  const size2 = new THREE.Vector3();
  box2.getSize(size2);

  // Scale uniformly
  const maxDim = Math.max(size2.x, size2.y, size2.z);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;
  root.scale.multiplyScalar(scale);

  // If sitting on ground, shift up so y=0 is the lowest point
  if (sitOnGround) {
    root.updateMatrixWorld(true);
    const box3 = new THREE.Box3().setFromObject(root);
    const minY = box3.min.y;
    root.position.y -= minY;
  }

  // Recursively enable shadow flags and frustum culling
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = true;
    }
  });

  return root;
}

export interface TraverseCounts {
  meshes: number;
  triangles: number;
  materials: number;
  lights: number;
}

export function countScene(root: THREE.Object3D): TraverseCounts {
  let meshes = 0;
  let triangles = 0;
  let materials = 0;
  let lights = 0;
  const seenMats = new Set<THREE.Material>();
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      meshes++;
      const mesh = obj as THREE.Mesh;
      const geo = mesh.geometry;
      if (geo && geo.index) {
        triangles += geo.index.count / 3;
      } else if (geo && geo.attributes.position) {
        triangles += geo.attributes.position.count / 3;
      }
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        for (const m of mat) seenMats.add(m);
      } else if (mat) {
        seenMats.add(mat);
      }
    } else if ((obj as THREE.Light).isLight) {
      lights++;
    }
  });
  materials = seenMats.size;
  return { meshes, triangles: Math.round(triangles), materials, lights };
}

/** Convert a THREE material into a serializable state object */
export function snapshotMaterial(material: THREE.Material, id: string) {
  const std = material as THREE.MeshStandardMaterial;
  const color = std.color ? '#' + std.color.getHexString() : '#cccccc';
  const emissive = std.emissive ? '#' + std.emissive.getHexString() : '#000000';
  return {
    id,
    name: std.name || id,
    baseColor: color,
    metalness: std.metalness ?? 0,
    roughness: std.roughness ?? 0.5,
    emissive,
    emissiveIntensity: std.emissiveIntensity ?? 1,
    normalScale: std.normalScale ? std.normalScale.x : 1,
    opacity: std.opacity ?? 1,
    wireframe: !!std.wireframe,
  };
}

/**
 * Build a serializable scene tree from a THREE.Object3D hierarchy.
 * Each node maps to a real three.js object with its uuid as the key.
 */
export function buildSceneTree(root: THREE.Object3D): SceneNode[] {
  const nodes: SceneNode[] = [];
  for (const child of root.children) {
    nodes.push(buildNode(child, null, 0));
  }
  return nodes;
}

function buildNode(obj: THREE.Object3D, parentId: string | null, depth: number): SceneNode {
  let type: NodeKind = 'Other';
  if ((obj as THREE.Mesh).isMesh) type = 'Mesh';
  else if ((obj as THREE.Group).isGroup) type = 'Group';
  else if ((obj as THREE.Bone).isBone) type = 'Bone';
  else if ((obj as THREE.Light).isLight) type = 'Light';
  else if ((obj as THREE.Camera).isCamera) type = 'Camera';

  let triCount = 0;
  if ((obj as THREE.Mesh).isMesh) {
    const geo = (obj as THREE.Mesh).geometry;
    if (geo) {
      if (geo.index) triCount = geo.index.count / 3;
      else if (geo.attributes.position) triCount = geo.attributes.position.count / 3;
    }
  }

  const children: SceneNode[] = [];
  for (const child of obj.children) {
    children.push(buildNode(child, obj.uuid, depth + 1));
  }

  return {
    id: obj.uuid,
    uuid: obj.uuid,
    name: obj.name || 'Unnamed',
    type,
    visible: obj.visible,
    triCount: Math.round(triCount),
    materialIds: [],
    parentId,
    depth,
    children,
  };
}

/** Apply a state patch back to a real material */
export function applyMaterialPatch(material: THREE.Material, patch: Record<string, unknown>) {
  const std = material as THREE.MeshStandardMaterial;
  if ('baseColor' in patch && std.color) {
    std.color.set(patch.baseColor as string);
  }
  if ('metalness' in patch) std.metalness = patch.metalness as number;
  if ('roughness' in patch) std.roughness = patch.roughness as number;
  if ('emissive' in patch && std.emissive) {
    std.emissive.set(patch.emissive as string);
  }
  if ('emissiveIntensity' in patch) std.emissiveIntensity = patch.emissiveIntensity as number;
  if ('normalScale' in patch && std.normalScale) {
    const v = patch.normalScale as number;
    std.normalScale.set(v, v);
  }
  if ('opacity' in patch) {
    std.opacity = patch.opacity as number;
    std.transparent = (patch.opacity as number) < 1;
  }
  if ('wireframe' in patch) std.wireframe = patch.wireframe as boolean;
  std.needsUpdate = true;
}

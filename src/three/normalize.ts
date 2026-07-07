// Helpers to normalize a loaded model — center, scale, enable shadows, traverse materials.

import * as THREE from 'three';
import type { SceneNode, NodeKind } from '@/types';
import { extractGeometryStats } from '@/three/extractGeometryStats';

/** Lift the model this much above the ground plane to avoid Z-fighting with
 *  the Grid / ContactShadows plane sitting at y=0. */
const GROUND_LIFT = 0.002;

export interface NormalizeOptions {
  /** Target diameter in world units after normalization */
  targetSize?: number;
  /** Lift the model so the bottom of its bounding box sits just above y=0 */
  sitOnGround?: boolean;
}

/**
 * Center a model at the origin, scale it to the target size, and ensure
 * shadow flags are set on all meshes. The result is a clean, well-behaved
 * model that doesn't z-fight with the ground.
 *
 * Robustness notes:
 *  - We always recompute `updateMatrixWorld(true)` between operations so that
 *    Box3.setFromObject returns true world-space bounds.
 *  - We translate BEFORE we scale (cheaper and gives an exact result) but
 *    re-measure AFTER scaling to compute the sit-on-ground lift.
 *  - We use GROUND_LIFT > 0 so the lowest vertex sits 2 mm above the ground
 *    plane, which prevents Z-fighting against the Grid / ContactShadows.
 *  - We always reset the root's local rotation/position to the *post-*
 *    transform values, but we DO NOT touch the root's rotation, so any
 *    authored orientation is preserved.
 */
export function normalizeObject(root: THREE.Object3D, opts: NormalizeOptions = {}): THREE.Object3D {
  const targetSize = opts.targetSize ?? 2.4;
  const sitOnGround = opts.sitOnGround ?? true;

  // 0. Make sure world matrices are up to date before measuring.
  root.updateMatrixWorld(true);

  // 1. Measure original world bounds.
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Guard against pathological empty / zero-size models.
  if (!isFinite(box.min.x) || !isFinite(box.max.x)) {
    console.warn('[VREEN] normalize: invalid bounding box, skipping centering');
  } else {
    // 2. Translate root so the model is centered around the origin.
    //    We rely on the root having no parent transform — which is true in
    //    our pipeline (groupRef is the root and is parented directly to the
    //    scene). If a caller uses this in a different context, they should
    //    wrap the input in a fresh Group first.
    root.position.x -= center.x;
    root.position.y -= center.y;
    root.position.z -= center.z;
    root.updateMatrixWorld(true);
  }

  // 3. Measure again (post-translation) and compute uniform scale.
  const box2 = new THREE.Box3().setFromObject(root);
  const size2 = new THREE.Vector3();
  box2.getSize(size2);
  const maxDim = Math.max(size2.x, size2.y, size2.z);
  if (maxDim > 0) {
    const scale = targetSize / maxDim;
    root.scale.multiplyScalar(scale);
    root.updateMatrixWorld(true);
  }

  // 4. Sit on the ground: shift up so the lowest point is GROUND_LIFT above y=0.
  if (sitOnGround) {
    const box3 = new THREE.Box3().setFromObject(root);
    const minY = box3.min.y;
    if (isFinite(minY)) {
      root.position.y += -minY + GROUND_LIFT;
      root.updateMatrixWorld(true);
    }
  }

  // 5. Enable shadow flags and frustum culling on every mesh.
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

/** Convert a material (three.js OR our new engine) into a serializable
 *  state object the Inspector can edit. */
export function snapshotMaterial(material: THREE.Material | unknown, id: string) {
  const std = material as {
    color?: { getHexString(): string };
    emissive?: { getHexString(): string };
    baseColor?: { r: number; g: number; b: number };
    emissiveCol?: { r: number; g: number; b: number };
    metalness?: number;
    roughness?: number;
    emissiveIntensity?: number;
    normalScale?: { x: number; y: number };
    opacity?: number;
    wireframe?: boolean;
    name?: string;
  };
  const color = std.color
    ? '#' + std.color.getHexString()
    : std.baseColor
    ? rgbToHex(std.baseColor)
    : '#cccccc';
  const emissive = std.emissive
    ? '#' + std.emissive.getHexString()
    : std.emissiveCol
    ? rgbToHex(std.emissiveCol)
    : '#000000';
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

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return '#' + r + g + b;
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
  let stats: SceneNode['stats'] = null;
  if ((obj as THREE.Mesh).isMesh) {
    const geo = (obj as THREE.Mesh).geometry;
    if (geo) {
      if (geo.index) triCount = geo.index.count / 3;
      else if (geo.attributes.position) triCount = geo.attributes.position.count / 3;
    }
    // Pre-compute inspector stats while we still have the live three.js
    // object. The result is cached on the SceneNode so the Outliner can
    // synchronously surface vertex / face / texture counts on click
    // without re-traversing the scene.
    stats = extractGeometryStats(obj);
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
    stats,
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

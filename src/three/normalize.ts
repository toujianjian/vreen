// Helpers to normalize a loaded model — center, scale, enable shadows, traverse materials.

import { createLogger } from '@/lib/logger';
import * as THREE from 'three';
import type { SceneNode, NodeKind } from '@/types';
import { extractGeometryStats } from '@/three/extractGeometryStats';

const log = createLogger('Asset');

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
 * Detect whether `root` is a three.js Object3D (vs our custom engine's Object3D).
 * The two share field names but not method signatures (e.g. three.js calls
 * `updateWorldMatrix`, the custom engine only has `updateMatrixWorld`), and
 * their `geometry.boundingBox` is also structurally different (three.js Box3
 * vs plain `{min, max}` Vector3 pair). We must use the matching API on each
 * branch — calling three.js's `Box3.setFromObject` on a custom engine tree
 * crashes the entire WebGL context and bricks the page.
 */
function isThreeObject3D(root: unknown): root is THREE.Object3D {
  return (
    root instanceof THREE.Object3D ||
    (typeof root === 'object' &&
      root !== null &&
      // three.js's Object3D has a `matrixWorld` of type Matrix4 with .isMatrix4=true
      // (the custom engine uses a custom Matrix4 without that flag)
      (root as { matrixWorld?: { isMatrix4?: boolean } }).matrixWorld?.isMatrix4 === true)
  );
}

/** Compute the world-space AABB of a three.js Object3D subtree.
 *  Pre-condition: world matrices must be up to date. */
function computeWorldBoxThree(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

/** Compute the world-space AABB of a *custom engine* Object3D subtree by
 *  walking the tree ourselves. We can't use three.js's Box3 because:
 *    - its `expandByObject` calls `object.updateWorldMatrix()` (we have an
 *      alias now, but the geometry's `boundingBox` is a plain `{min,max}`,
 *      not a three.js Box3, so `box.applyMatrix4()` would still fail);
 *    - the `Mesh` from `@/engine` doesn't carry a three.js `material`,
 *      so we treat it as a leaf and expand by its `boundingBox`. */
function computeWorldBoxCustom(root: { updateMatrixWorld(force?: boolean): void; children: unknown[]; matrixWorld: unknown; type?: string; geometry?: { boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox?: () => void } }): { min: THREE.Vector3; max: THREE.Vector3; valid: boolean } {
  root.updateMatrixWorld(true);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let valid = false;

  const applyMat4 = (m: { elements: ArrayLike<number> }, v: THREE.Vector3): THREE.Vector3 => {
    // Column-major 4x4 (THREE.Matrix4.elements layout).
    const e = m.elements;
    const x = v.x, y = v.y, z = v.z;
    return new THREE.Vector3(
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    );
  };

  const expandByMesh = (mesh: { type?: string; geometry?: { boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox?: () => void }; matrixWorld: { elements: ArrayLike<number> } }) => {
    if (mesh.type !== 'Mesh' || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox && mesh.geometry.computeBoundingBox) {
      mesh.geometry.computeBoundingBox();
    }
    const bb = mesh.geometry.boundingBox;
    if (!bb) return;
    const corners: { x: number; y: number; z: number }[] = [
      { x: bb.min.x, y: bb.min.y, z: bb.min.z },
      { x: bb.max.x, y: bb.min.y, z: bb.min.z },
      { x: bb.min.x, y: bb.max.y, z: bb.min.z },
      { x: bb.max.x, y: bb.max.y, z: bb.min.z },
      { x: bb.min.x, y: bb.min.y, z: bb.max.z },
      { x: bb.max.x, y: bb.min.y, z: bb.max.z },
      { x: bb.min.x, y: bb.max.y, z: bb.max.z },
      { x: bb.max.x, y: bb.max.y, z: bb.max.z },
    ];
    for (const c of corners) {
      const w = applyMat4(mesh.matrixWorld, c as THREE.Vector3);
      if (w.x < min.x) min.x = w.x;
      if (w.y < min.y) min.y = w.y;
      if (w.z < min.z) min.z = w.z;
      if (w.x > max.x) max.x = w.x;
      if (w.y > max.y) max.y = w.y;
      if (w.z > max.z) max.z = w.z;
      valid = true;
    }
  };

  const stack = [root as unknown as { traverse: (cb: (n: { type?: string; children: unknown[]; geometry?: unknown; matrixWorld: { elements: ArrayLike<number> } }) => void) => void }];
  while (stack.length > 0) {
    const n = stack.pop()!;
    n.traverse((child) => {
      expandByMesh(child as { type?: string; geometry?: { boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox?: () => void }; matrixWorld: { elements: ArrayLike<number> } });
      // recurse into the child explicitly (engine has `children` array; traverse already
      // walked it, but we want stack-based BFS to stay memory-friendly for deep trees)
      for (const c of (child as { children: unknown[] }).children) {
        stack.push(c as unknown as { traverse: (cb: (n: { type?: string; children: unknown[]; geometry?: unknown; matrixWorld: { elements: ArrayLike<number> } }) => void) => void });
      }
    });
  }
  return { min, max, valid };
}

/**
 * Center a model at the origin, scale it to the target size, and ensure
 * shadow flags are set on all meshes. The result is a clean, well-behaved
 * model that doesn't z-fight with the ground.
 *
 * Supports BOTH three.js Object3D and our custom engine Object3D — the
 * gallery previews pass custom engine Groups (from `GENERATORS`), so we
 * can't blindly call three.js's `Box3.setFromObject` on them.
 */
export function normalizeObject(root: unknown, opts: NormalizeOptions = {}): unknown {
  const targetSize = opts.targetSize ?? 2.4;
  const sitOnGround = opts.sitOnGround ?? true;

  const isThree = isThreeObject3D(root);
  const typedRoot = root as THREE.Object3D & {
    updateMatrixWorld(force?: boolean): void;
    position: { x: number; y: number; z: number; set?(x: number, y: number, z: number): void };
    scale: { x: number; y: number; z: number; set?(x: number, y: number, z: number): void; multiplyScalar?(s: number): void };
    traverse: (cb: (obj: unknown) => void) => void;
  };

  if (!isThree) {
    // Custom engine path: compute bounds ourselves, then apply translate+scale
    // using the same arithmetic so the caller doesn't see a difference.
    typedRoot.updateMatrixWorld(true);
    let box = computeWorldBoxCustom(typedRoot as unknown as { updateMatrixWorld(force?: boolean): void; children: unknown[]; matrixWorld: unknown; type?: string; geometry?: { boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox?: () => void } });
    let center = new THREE.Vector3();
    if (box.valid) {
      center = new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        (box.min.y + box.max.y) / 2,
        (box.min.z + box.max.z) / 2,
      );
      typedRoot.position.x -= center.x;
      typedRoot.position.y -= center.y;
      typedRoot.position.z -= center.z;
      typedRoot.updateMatrixWorld(true);
    } else {
      log.warn('normalize: invalid bounding box, skipping centering');
    }

    box = computeWorldBoxCustom(typedRoot as unknown as { updateMatrixWorld(force?: boolean): void; children: unknown[]; matrixWorld: unknown; type?: string; geometry?: { boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox?: () => void } });
    const sx = box.max.x - box.min.x;
    const sy = box.max.y - box.min.y;
    const sz = box.max.z - box.min.z;
    const maxDim = Math.max(sx, sy, sz);
    if (box.valid && maxDim > 0) {
      const scale = targetSize / maxDim;
      typedRoot.scale.x *= scale;
      typedRoot.scale.y *= scale;
      typedRoot.scale.z *= scale;
      typedRoot.updateMatrixWorld(true);
    }

    if (sitOnGround) {
      const box3 = computeWorldBoxCustom(typedRoot as unknown as { updateMatrixWorld(force?: boolean): void; children: unknown[]; matrixWorld: unknown; type?: string; geometry?: { boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox?: () => void } });
      if (box3.valid && Number.isFinite(box3.min.y)) {
        typedRoot.position.y += -box3.min.y + GROUND_LIFT;
        typedRoot.updateMatrixWorld(true);
      }
    }

    typedRoot.traverse((obj) => {
      const m = obj as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean; frustumCulled?: boolean };
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = true;
      }
    });
    return root;
  }

  // ── three.js path (original behavior) ─────────────────────────────────
  // 0. Make sure world matrices are up to date before measuring.
  typedRoot.updateMatrixWorld(true);

  // 1. Measure original world bounds.
  const box = computeWorldBoxThree(typedRoot);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Guard against pathological empty / zero-size models.
  if (!isFinite(box.min.x) || !isFinite(box.max.x)) {
    log.warn('normalize: invalid bounding box, skipping centering');
  } else {
    // 2. Translate root so the model is centered around the origin.
    //    We rely on the root having no parent transform — which is true in
    //    our pipeline (groupRef is the root and is parented directly to the
    //    scene). If a caller uses this in a different context, they should
    //    wrap the input in a fresh Group first.
    typedRoot.position.x -= center.x;
    typedRoot.position.y -= center.y;
    typedRoot.position.z -= center.z;
    typedRoot.updateMatrixWorld(true);
  }

  // 3. Measure again (post-translation) and compute uniform scale.
  const box2 = computeWorldBoxThree(typedRoot);
  const size2 = new THREE.Vector3();
  box2.getSize(size2);
  const maxDim = Math.max(size2.x, size2.y, size2.z);
  if (maxDim > 0) {
    const scale = targetSize / maxDim;
    typedRoot.scale.x *= scale;
    typedRoot.scale.y *= scale;
    typedRoot.scale.z *= scale;
    typedRoot.updateMatrixWorld(true);
  }

  // 4. Sit on the ground: shift up so the lowest point is GROUND_LIFT above y=0.
  if (sitOnGround) {
    const box3 = computeWorldBoxThree(typedRoot);
    const minY = box3.min.y;
    if (isFinite(minY)) {
      typedRoot.position.y += -minY + GROUND_LIFT;
      typedRoot.updateMatrixWorld(true);
    }
  }

  // 5. Enable shadow flags and frustum culling on every mesh.
  typedRoot.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = true;
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

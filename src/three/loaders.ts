// Multi-format 3D model loader using three.js example loaders.
// Supports: GLB, GLTF, OBJ, FBX, STL, PLY.
// All parsing happens client-side; no server required.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { ModelFormat } from '@/types';
import { detectFormat } from '@/lib/format';

export interface LoadProgress {
  (ratio: number): void;
}

export interface LoadResult {
  root: THREE.Object3D;
  format: ModelFormat;
  animations: THREE.AnimationClip[];
}

async function loadFromUrl(
  url: string,
  format: ModelFormat,
  onProgress?: LoadProgress,
): Promise<LoadResult> {
  return new Promise((resolve, reject) => {
    const progressHandler = (xhr: ProgressEvent) => {
      if (onProgress && xhr.lengthComputable) {
        onProgress(xhr.loaded / xhr.total);
      }
    };
    try {
      if (format === 'glb' || format === 'gltf') {
        const loader = new GLTFLoader();
        loader.load(
          url,
          (gltf) => {
            onProgress?.(1);
            resolve({
              root: gltf.scene,
              format,
              animations: gltf.animations ?? [],
            });
          },
          (xhr) => progressHandler(xhr as unknown as ProgressEvent),
          reject,
        );
      } else if (format === 'obj') {
        const loader = new OBJLoader();
        loader.load(
          url,
          (obj) => {
            onProgress?.(1);
            resolve({ root: obj, format, animations: [] });
          },
          (xhr) => progressHandler(xhr as unknown as ProgressEvent),
          reject,
        );
      } else if (format === 'fbx') {
        const loader = new FBXLoader();
        loader.load(
          url,
          (obj) => {
            onProgress?.(1);
            resolve({ root: obj, format, animations: obj.animations ?? [] });
          },
          (xhr) => progressHandler(xhr as unknown as ProgressEvent),
          reject,
        );
      } else if (format === 'stl') {
        const loader = new STLLoader();
        loader.load(
          url,
          (geometry) => {
            onProgress?.(1);
            const mesh = new THREE.Mesh(
              geometry,
              new THREE.MeshStandardMaterial({ color: 0x99aabb, metalness: 0.4, roughness: 0.5 }),
            );
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            resolve({ root: mesh, format, animations: [] });
          },
          (xhr) => progressHandler(xhr as unknown as ProgressEvent),
          reject,
        );
      } else if (format === 'ply') {
        const loader = new PLYLoader();
        loader.load(
          url,
          (geometry) => {
            onProgress?.(1);
            geometry.computeVertexNormals();
            const mesh = new THREE.Mesh(
              geometry,
              new THREE.MeshStandardMaterial({ color: 0x88aaff, metalness: 0.3, roughness: 0.6 }),
            );
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            resolve({ root: mesh, format, animations: [] });
          },
          (xhr) => progressHandler(xhr as unknown as ProgressEvent),
          reject,
        );
      } else {
        reject(new Error(`Unsupported format: ${format}`));
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Public entry: load a model from URL string (e.g. blob: URL).
 * Returns the loaded THREE root with animations attached.
 */
export async function loadModel(
  source: string,
  formatHint?: ModelFormat,
  onProgress?: LoadProgress,
): Promise<LoadResult> {
  const fmt = formatHint ?? detectFormat(source) ?? 'glb';
  return loadFromUrl(source, fmt, onProgress);
}

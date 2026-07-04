// SceneContents: loads the active asset (preset generator or uploaded model),
// normalizes it, applies material updates, and feeds the inspector store.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { GENERATORS } from '@/three/generators';
import { loadModel } from '@/three/loaders';
import {
  applyMaterialPatch,
  countScene,
  normalizeObject,
  snapshotMaterial,
} from '@/three/normalize';
import { useViewerStore } from '@/stores/viewerStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { getPresetById } from '@/lib/presets';
import { uploadBridge } from '@/lib/uploadBridge';
import { detectFormat } from '@/lib/format';

export function SceneContents() {
  const { t } = useTranslation();
  const assetSource = useViewerStore((s) => s.assetSource);
  const setStats = useViewerStore((s) => s.setStats);
  const setAssetName = useViewerStore((s) => s.setAssetName);
  const setIsLoading = useViewerStore((s) => s.setLoading);
  const setLoadProgress = useViewerStore((s) => s.setLoadProgress);
  const setError = useViewerStore((s) => s.setError);
  const autoRotate = useViewerStore((s) => s.autoRotate);

  const setMaterials = useInspectorStore((s) => s.setMaterials);
  const materials = useInspectorStore((s) => s.materials);

  const groupRef = useRef<THREE.Group>(null);
  const fpsAcc = useRef({ frames: 0, t: performance.now() });

  // Build or load current asset
  useEffect(() => {
    if (!assetSource) return;
    let cancelled = false;
    setIsLoading(true);
    setLoadProgress(0.05);

    (async () => {
      try {
        let root: THREE.Object3D;
        let assetName: string;
        if (assetSource.kind === 'preset') {
          const preset = getPresetById(assetSource.presetId);
          if (!preset) {
            throw new Error(`Unknown preset: ${assetSource.presetId}`);
          }
          setLoadProgress(0.4);
          await new Promise((r) => setTimeout(r, 60));
          root = GENERATORS[preset.generator]();
          assetName = preset.name;
          setLoadProgress(0.9);
        } else {
          // Uploaded asset — read the file from the bridge and parse it
          const file = uploadBridge.consume();
          if (!file) {
            // No file was handed off (e.g. page reload). Show a friendly placeholder.
            const label = t('scene.placeholderLabel', { name: assetSource.uploadId });
            root = buildPlaceholder(label);
            assetName = assetSource.uploadId;
            await new Promise((r) => setTimeout(r, 200));
            setLoadProgress(0.95);
          } else {
            setLoadProgress(0.3);
            const fmt = detectFormat(file.name) ?? 'glb';
            const url = URL.createObjectURL(file);
            try {
              const result = await loadModel(url, fmt, (p) => setLoadProgress(0.3 + p * 0.6));
              // The three.js loaders fetch & parse synchronously into geometry/materials;
              // the blob URL is no longer needed once the load resolves.
              URL.revokeObjectURL(url);
              if (cancelled) return;
              root = result.root;
              assetName = file.name;
              setLoadProgress(0.95);
            } catch (err) {
              URL.revokeObjectURL(url);
              throw err;
            }
          }
        }

        if (cancelled) return;

        // Normalize
        normalizeObject(root, { targetSize: 2.4, sitOnGround: true });

        // Mount into scene
        if (groupRef.current) {
          // Clear previous
          while (groupRef.current.children.length > 0) {
            const c = groupRef.current.children[0];
            groupRef.current.remove(c);
            disposeObject(c);
          }
          groupRef.current.add(root);
        }

        // Collect material snapshot
        const matStates: Record<string, ReturnType<typeof snapshotMaterial>> = {};
        root.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            const m = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of m) {
              if (!mat) continue;
              const id = (mat as THREE.Material).uuid;
              matStates[id] = snapshotMaterial(mat, id);
            }
          }
        });
        setMaterials(matStates);

        // Stats
        const counts = countScene(root);
        setStats({
          triangles: counts.triangles,
          geometries: counts.meshes,
          textures: counts.materials,
        });

        setAssetName(assetName);
        setIsLoading(false);
        setLoadProgress(1);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetSource]);

  // Apply material patches from inspector to real materials
  useEffect(() => {
    if (!groupRef.current) return;
    const matMap: Record<string, THREE.Material> = {};
    groupRef.current.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const m = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of m) {
          if (mat) matMap[mat.uuid] = mat;
        }
      }
    });
    Object.values(materials).forEach((state) => {
      const mat = matMap[state.id];
      if (mat) applyMaterialPatch(mat, state as unknown as Record<string, unknown>);
    });
  }, [materials]);

  // FPS counter
  useFrame((_, delta) => {
    const a = fpsAcc.current;
    a.frames++;
    const elapsed = performance.now() - a.t;
    if (elapsed >= 500) {
      const fps = Math.round((a.frames * 1000) / elapsed);
      setStats({ fps });
      a.frames = 0;
      a.t = performance.now();
    }

    // Auto-rotate root
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y += delta * 0.18;
    }
  });

  return (
    <group ref={groupRef}>
      {!assetSource && <WelcomeModel />}
    </group>
  );
}

function WelcomeModel() {
  // Procedural welcome logo when nothing is loaded
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.25;
  });
  const meshes = useMemo(() => {
    const arr: { pos: [number, number, number]; color: string; size: number }[] = [];
    // V shape
    const vColor = '#00f0ff';
    arr.push({ pos: [-0.5, 0.2, 0], color: vColor, size: 0.18 });
    arr.push({ pos: [0.5, 0.2, 0], color: vColor, size: 0.18 });
    arr.push({ pos: [0, 0.6, 0], color: vColor, size: 0.18 });
    // R
    arr.push({ pos: [1.0, 0.2, 0], color: '#ff2bd6', size: 0.18 });
    arr.push({ pos: [1.4, 0.2, 0], color: '#ff2bd6', size: 0.18 });
    arr.push({ pos: [1.0, 0.6, 0], color: '#ff2bd6', size: 0.18 });
    arr.push({ pos: [1.4, 0.6, 0], color: '#ff2bd6', size: 0.18 });
    arr.push({ pos: [1.0, 1.0, 0], color: '#ff2bd6', size: 0.18 });
    arr.push({ pos: [1.4, 0.8, 0], color: '#ff2bd6', size: 0.18 });
    return arr;
  }, []);

  return (
    <group ref={ref} position={[0, 0.7, 0]}>
      {meshes.map((m, i) => (
        <mesh key={i} position={m.pos}>
          <boxGeometry args={[m.size, m.size, m.size]} />
          <meshStandardMaterial
            color={m.color}
            emissive={m.color}
            emissiveIntensity={1.2}
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
      ))}
    </group>
  );
}

function buildPlaceholder(label: string): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'uploaded_placeholder';
  // Hexagonal pedestal
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.9, 0.15, 6),
    new THREE.MeshStandardMaterial({ color: '#1a2235', metalness: 0.5, roughness: 0.4 }),
  );
  g.add(pedestal);
  // Wireframe icosahedron as placeholder
  const ico = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 1),
    new THREE.MeshStandardMaterial({
      color: '#00f0ff',
      emissive: '#00f0ff',
      emissiveIntensity: 0.6,
      wireframe: true,
    }),
  );
  ico.position.y = 0.85;
  g.add(ico);
  // Inner solid
  const inner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.4, 0),
    new THREE.MeshStandardMaterial({
      color: '#ff2bd6',
      emissive: '#ff2bd6',
      emissiveIntensity: 0.4,
    }),
  );
  inner.position.y = 0.85;
  g.add(inner);
  // Console log label
  // eslint-disable-next-line no-console
  console.info(`[VREEN] placeholder rendered for: ${label.replace(/\n/g, ' / ')}`);
  return g;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.();
      const m = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      m.forEach((mm) => mm?.dispose?.());
    }
  });
}

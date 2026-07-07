// SceneContents: loads the active asset (preset generator or uploaded model),
// normalizes it, applies material updates, and feeds the inspector store.
import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { GENERATORS } from '@/three/generators';
import { loadModel } from '@/three/loaders';
import {
  applyMaterialPatch,
  buildSceneTree,
  countScene,
  normalizeObject,
  snapshotMaterial,
} from '@/three/normalize';
import { useViewerStore } from '@/stores/viewerStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { useWorldStore } from '@/stores/worldStore';
import { getPresetById } from '@/lib/presets';
import { uploadBridge } from '@/lib/uploadBridge';
import { detectFormat } from '@/lib/format';
import { extractGeometryStats } from '@/three/extractGeometryStats';
import { AnimationMixer as CustomAnimationMixer } from '@/engine/Animation';
import { convertThreeClips } from '@/three/threeToCustomAnim';
import type { Object3D as CustomObject3D } from '@/engine/Core/Object3D';
import { Velocity, VelocityC } from '@/engine/ECS';

export function SceneContents() {
  const { t } = useTranslation();
  const assetSource = useViewerStore((s) => s.assetSource);
  const setStats = useViewerStore((s) => s.setStats);
  const setAssetName = useViewerStore((s) => s.setAssetName);
  const setIsLoading = useViewerStore((s) => s.setLoading);
  const setLoadProgress = useViewerStore((s) => s.setLoadProgress);
  const setError = useViewerStore((s) => s.setError);
  const setSceneTree = useViewerStore((s) => s.setSceneTree);
  const autoRotate = useViewerStore((s) => s.autoRotate);
  const setCurrentModelFile = useViewerStore((s) => s.setCurrentModelFile);

  const setAnimation = useViewerStore((s) => s.setAnimation);
  const setMaterials = useInspectorStore((s) => s.setMaterials);
  const setSelection = useInspectorStore((s) => s.setSelection);
  const materials = useInspectorStore((s) => s.materials);

  const groupRef = useRef<THREE.Group>(null);
  // 自研 AnimationMixer：Phase 2 接入,SkinnedMeshRef / AnimState 都靠它。
  // 之所以能驱动 three.js 节点:自研 track.apply 写的是
  //   node.position.set / node.scale.set / node.rotation.set
  // 这三个 setter three.js 也有,所以一套 mixer 同时服务渲染和 ECS。
  const customMixerRef = useRef<CustomAnimationMixer | null>(null);
  // three.js mixer 保留为 fallback (OBJ/FBX/STL/PLY 等没走自研 GLBLoader 的格式)。
  const legacyMixerRef = useRef<THREE.AnimationMixer | null>(null);
  // Phase 2 演示:MovementSystem 改 root entity 的 Transform,这个 ref 让我们
  // 在 useFrame 之后把 entity.sceneNode 的 TRS 同步回 three.js group。
  // null = 当前没有 root entity (asset 未加载)。
  const rootEntityIdRef = useRef<number | null>(null);
  const fpsAcc = useRef({ frames: 0, t: performance.now() });

  // Mesh picking — click an object in the 3D view to select it in the outliner
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const obj = e.object;
    let type: string = 'Other';
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
    // Pull rich geometry stats for the Inspector's Geometry panel.
    const stats = extractGeometryStats(obj);
    setSelection(obj.uuid, obj.name || 'Unnamed', type, Math.round(triCount), stats);
  };

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
          root = GENERATORS[preset.generator]() as unknown as THREE.Object3D;
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
            setCurrentModelFile(null);
            await new Promise((r) => setTimeout(r, 200));
            setLoadProgress(0.95);
          } else {
            setLoadProgress(0.3);
            // Keep a reference to the original file so the Inspector can
            // re-export a self-contained `.vreen` (state + model) bundle.
            setCurrentModelFile(file);
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
          // Stop & clear previous mixer(s)
          if (customMixerRef.current) {
            customMixerRef.current.stopAll();
            customMixerRef.current = null;
          }
          if (legacyMixerRef.current) {
            legacyMixerRef.current.stopAllAction();
            legacyMixerRef.current = null;
          }
          // Clear previous children
          while (groupRef.current.children.length > 0) {
            const c = groupRef.current.children[0];
            groupRef.current.remove(c);
            disposeObject(c);
          }
          groupRef.current.add(root);

          // Detect animation clips and initialise mixer
          const threeClips = (root as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [];
          // 转成自研 clips 后构造自研 mixer,即使 root 是 three.js 的也能驱动
          // (apply 写的是 .position.set / .scale.set / .rotation.set, three.js 节点都有)。
          const customClips = convertThreeClips(threeClips);
          let activeMixerForEcs: CustomAnimationMixer | null = null;

          if (customClips.length > 0) {
            const mixer = new CustomAnimationMixer(root as unknown as CustomObject3D);
            customMixerRef.current = mixer;
            activeMixerForEcs = mixer;
            const first = mixer.play(customClips[0]);
            void first;
            setAnimation({
              clipName: customClips[0].name || 'animation',
              isPlaying: true,
              speed: 1,
              currentTime: 0,
              duration: customClips[0].duration,
            });
          } else if (threeClips.length > 0) {
            // Fallback: 自研 converter 没拿到 clip(可能含 Color/Bool track 等),
            // 用 three.js mixer 顶一下,保证动画还在跑。
            const mixer = new THREE.AnimationMixer(root);
            legacyMixerRef.current = mixer;
            const action = mixer.clipAction(threeClips[0]);
            action.play();
            setAnimation({
              clipName: threeClips[0].name || 'animation',
              isPlaying: true,
              speed: 1,
              currentTime: 0,
              duration: threeClips[0].duration,
            });
          } else {
            setAnimation({
              clipName: '',
              isPlaying: false,
              currentTime: 0,
              duration: 0,
            });
          }

          // Phase 2: 把 scene graph 同步成 ECS entities。
          // 自研 mixer 已经在 customClips > 0 时构造好,这里直接传过去,
          // 让 SkinnedMeshRef 真正持 mixer 引用(不再传 null)。
          // 桥接说明:worldStore.syncFromSceneGraph 类型是 engine.Object3D,
          // runtime 用 duck typing 写入,three.js 节点有同名 setter,安全。
          const syncResult = useWorldStore.getState().syncFromSceneGraph(
            root as unknown as CustomObject3D,
            activeMixerForEcs,
            customClips,
          );
          rootEntityIdRef.current = syncResult.rootEntityId;

          // Phase 2 演示：给 root entity 加 Velocity 组件,但不主动开。
          // 用户在 Inspector / 后续 UI 打开 ecsMovementEnabled 后,
          // MovementSystem 会按这个 velocity 推进。
          if (syncResult.rootEntityId != null) {
            const w = useWorldStore.getState().world;
            if (w) {
              const v = new Velocity();
              v.linear = [0, 0.4, 0]; // 默认每帧上浮 0.4 m/s
              v.angularY = 0.5; // 0.5 rad/s 绕 Y 轴自转
              w.setComponent(syncResult.rootEntityId, VelocityC, v);
            }
          }
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

        // Build scene tree for the outliner
        const tree = buildSceneTree(root);
        setSceneTree(tree);

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

  // Animation mixer update + FPS counter
  useFrame((_, delta) => {
    const anim = useViewerStore.getState().animation;
    // 1) 把 UI 层的 isPlaying / timeScale 同步到自研 mixer 的 action 上。
    //    自研 AnimationAction.update() 内部已经检查 isPlaying,
    //    没播放时 mixer.update() 是 no-op,所以 ECS 接管后也不会乱跑。
    if (customMixerRef.current) {
      const mixer = customMixerRef.current as unknown as {
        actions: Map<string, { timeScale: number; isPlaying: boolean; time: number }>;
        update(dt: number): void;
      };
      for (const action of mixer.actions.values()) {
        action.timeScale = anim.speed;
        action.isPlaying = anim.isPlaying;
      }

      // Scrub: 用户拖动 scrubber,isPlaying=false,需要直接跳到 anim.currentTime。
      if (!anim.isPlaying) {
        const firstAction = mixer.actions.values().next().value;
        if (firstAction) {
          if (Math.abs(firstAction.time - anim.currentTime) > 0.005) {
            firstAction.time = anim.currentTime;
            // update(0) 不推进时间,但会把当前 frame 的 track 应用一次。
            mixer.update(0);
          }
        }
      }
    } else if (legacyMixerRef.current) {
      // Fallback: 自研 converter 失败的格式 (含 Color/Bool track) 用 three.js mixer
      legacyMixerRef.current.timeScale = anim.speed;
      if (anim.isPlaying) {
        legacyMixerRef.current.update(delta);
        setAnimation({ currentTime: legacyMixerRef.current.time });
      } else {
        const mixerTime = legacyMixerRef.current.time;
        if (Math.abs(mixerTime - anim.currentTime) > 0.005) {
          legacyMixerRef.current.setTime(anim.currentTime);
        }
      }
    }

    // 2) 让 ECS World 推进一帧。AnimationTickSystem 会扫描所有
    //    SkinnedMeshRef 并 mixer.update(dt)。这是 Phase 2 的关键点:
    //    SceneContents 不再亲自 mixer.update(),改由 system 推进。
    const world = useWorldStore.getState().world;
    if (world) world.update(delta);

    // 3) Phase 2 演示:MovementSystem 改 root entity 的 Transform,这里把
    //    root sceneNode 的 TRS 桥回 three.js group。关掉时不影响原行为。
    const ecsMovementEnabled = useWorldStore.getState().ecsMovementEnabled;
    if (ecsMovementEnabled && groupRef.current && world && rootEntityIdRef.current != null) {
      const rootNode = world.getSceneNode(rootEntityIdRef.current);
      if (rootNode) {
        groupRef.current.position.set(
          rootNode.position.x,
          rootNode.position.y,
          rootNode.position.z,
        );
        groupRef.current.quaternion.set(
          rootNode.rotation.x,
          rootNode.rotation.y,
          rootNode.rotation.z,
          rootNode.rotation.w,
        );
        groupRef.current.scale.set(
          rootNode.scale.x,
          rootNode.scale.y,
          rootNode.scale.z,
        );
      }
    }

    // 3) 读回第一个 action 的 time 给 UI 时间轴显示。
    if (customMixerRef.current) {
      const firstAction = (customMixerRef.current as unknown as {
        actions: Map<string, { time: number }>;
      }).actions.values().next().value;
      setAnimation({ currentTime: firstAction ? firstAction.time : 0 });
    }

    // FPS counter
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
    <group ref={groupRef} onPointerDown={handlePointerDown}>
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

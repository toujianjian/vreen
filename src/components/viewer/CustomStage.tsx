// CustomStage — 在 /viewer 中启用自研 WebGL2 引擎渲染模型。
// 支持:upload(.glb) 与 preset(6 个程序化模型)。
// 其他来源(obj/fbx 等)自动 fallback 到 three.js 路径。

import { useEffect, useRef, useState } from 'react';
import { useViewerStore } from '@/stores/viewerStore';
import { useWorldStore } from '@/stores/worldStore';
import { useUIStore } from '@/stores/uiStore';
import { uploadBridge } from '@/lib/uploadBridge';
import { GENERATORS, GeneratorName } from '@/three/generators';
import { Mesh as EngineMesh } from '@/engine/Core/Mesh';
import { PhysicsDebugRenderer } from '@/engine/Helpers/PhysicsDebugRenderer';
import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  OrbitControls,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  StandardMaterial,
  Vector3,
  WebGL2Renderer,
  GLBLoader,
  AnimationMixer,
  Profiler,
  HDRLoader,
} from '@/engine';
import { createGridMesh } from '@/engine/Helpers/GridHelper';
import { Velocity, VelocityC, PlayerInput, PlayerInputC, World as ECSWorld } from '@/engine/ECS';
import { createPhysicsDemo, syncMeshesFromTransforms } from '@/engine/Physics/PhysicsDemo';
import { createLogger } from '@/lib/logger';
import { animateCameraToPreset } from '@/three/camera';
import * as THREE from 'three';
import { ShaderMaterial as SM } from '@/engine/Materials/ShaderMaterial';
import {
  HOLOGRAM_GLSL,
  SIMPLEX_NOISE_GLSL,
  STANDARD_VERTEX_HEADER,
  STANDARD_FRAGMENT_HEADER,
  resolveIncludes,
} from '@/engine/Materials/ShaderChunks';
import { useProfilerStore } from '@/stores/profilerStore';
import { ProfilerHUD } from './ProfilerHUD';

const log = createLogger('CustomStage');

const LOCAL_HDRI: Record<string, string> = {
  studio: '/hdri/studio_small_03_1k.hdr',
  sunset: '/hdri/venice_sunset_1k.hdr',
  warehouse: '/hdri/empty_warehouse_01_1k.hdr',
  night: '/hdri/dikhololo_night_1k.hdr',
  city: '/hdri/potsdamer_platz_1k.hdr',
};

interface CustomStageStats {
  fps: number;
  draws: number;
  tris: number;
}

export function CustomStage({ onError }: { onError?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 暴露给外部 effect:renderer / camera / scene / controls / ground / grid。 */
  const stageRef = useRef<{
    renderer?: WebGL2Renderer;
    camera?: PerspectiveCamera;
    scene?: Scene;
    controls?: OrbitControls;
    ground?: Mesh;
    gridMesh?: Mesh;
    physicsWorld?: ECSWorld;
    physicsDebug?: PhysicsDebugRenderer;
  }>({});
  const [stats, setStats] = useState<CustomStageStats>({ fps: 0, draws: 0, tris: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const assetSource = useViewerStore((s) => s.assetSource);
  const assetName = useViewerStore((s) => s.assetName);
  const showGround = useViewerStore((s) => s.showGround);
  const postFX = useUIStore((s) => s.postFX);
  const environment = useUIStore((s) => s.environment);
  const cameraConfig = useViewerStore((s) => s.camera);
  const setCamera = useViewerStore((s) => s.setCamera);
  const animation = useViewerStore((s) => s.animation);
  const physicsDemo = useViewerStore((s) => s.physicsDemo);
  const togglePhysicsDemo = useViewerStore((s) => s.togglePhysicsDemo);
  const physicsDebug = useViewerStore((s) => s.physicsDebug);
  const profilerEnabled = useViewerStore((s) => s.profilerEnabled);

  useEffect(() => {
    if (error && onError) {
      onError();
    }
  }, [error, onError]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    if (!assetSource) return;

    log.info(`mount: kind=${assetSource.kind}, name="${assetName}"`);

    let cancelled = false;
    setLoading(true);
    setError(null);

    let file: File | null = null;
    if (assetSource.kind === 'upload') {
      file = uploadBridge.consume();
      if (!file) {
        log.error('uploadBridge has no file (race condition with upload state)');
        setError('No file handed off. Please re-upload the .glb file.');
        setLoading(false);
        return;
      }
      log.debug(`file from bridge: ${file.name}, ${(file.size / 1024).toFixed(1)} KB, type=${file.type}`);

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'glb') {
        log.warn(`reject: extension is .${ext}, expected .glb`);
        setError(`Custom renderer only supports .glb; got .${ext}. Switch back to three.js.`);
        setLoading(false);
        return;
      }
    }

    // ── 引擎装配 ────────────────────────────────────────────────────
    const tInit0 = performance.now();
    const renderer = new WebGL2Renderer(canvas, { antialias: true });
    // 初始 clearColor 来自环境设置
    applyEnvironment(renderer, environment);
    // 初始 postFX 配置
    applyPostFX(renderer, postFX);
    // postProcessingEnabled 默认 on(总是走最终合成,这样 vignette/CA 才能显示)
    renderer.postProcessingEnabled = true;
    renderer.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    log.debug(`renderer init took ${(performance.now() - tInit0).toFixed(1)}ms`);

    const camera = new PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(3, 2.2, 4.2);
    camera.lookAt(0, 0.9, 0);
    log.debug(`camera: fov=50, pos=(3, 2.2, 4.2), target=(0, 0.9, 0)`);

    const scene = new Scene();
    // 背景纯黑：WebGL2Renderer 不读 scene.background,只读 clearColor,这里省略
    log.debug('scene created (background: pure black via clearColor)');

    // ── HDRI IBL 环境贴图 ────────────────────────────────────────────────
    const hdriPath = LOCAL_HDRI[environment.preset];
    if (hdriPath) {
      const hdriLoader = new HDRLoader();
      hdriLoader.load(hdriPath).then((hdriResult) => {
        log.info(`HDRI loaded: ${hdriPath} (${hdriResult.width}x${hdriResult.height})`);
        scene.background = { color: '#000000', envMap: hdriResult.texture };
      }).catch((e) => {
        log.warn(`HDRI load failed for ${hdriPath}:`, e);
      });
    }

    const dir = new DirectionalLight(0xfff2d9, 2.0, { x: 4, y: 6, z: 3 });
    dir.castShadow = true;
    const dir2 = new DirectionalLight(0xff2bd6, 0.45, { x: -4, y: 3, z: -2 });
    const dir3 = new DirectionalLight(0x00f0ff, 0.25, { x: 0, y: -2, z: 4 });
    const amb = new AmbientLight(0xffffff, 0.55);
    scene.add(dir);
    scene.add(dir2);
    scene.add(dir3);
    scene.add(amb);
    log.debug(`lights: dir=0xfff2d9*2.0 from (4,6,3) [shadow=${dir.castShadow}], dir2=0xff2bd6*0.45 from (-4,3,-2), dir3=0x00f0ff*0.25 from (0,-2,4), ambient=0xffffff*0.55`);

    const ground = new Mesh(
      new PlaneGeometry(20, 20),
      (() => {
        const m = new StandardMaterial();
        m.baseColor = { r: 0.05, g: 0.07, b: 0.1 };
        m.metallic = 0.0;
        m.roughness = 0.95;
        m.receiveShadow = true;
        return m;
      })(),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    ground.visible = showGround;
    log.debug(`ground plane: 20x20, rotated to XZ, receiveShadow=true, visible=${showGround}`);

    // 网格(grid 是 helper,会通过 Renderer._drawHelper 旁路渲染)
    const gridMesh = createGridMesh(renderer, {
      size: 20,
      cellSize: 0.4,
      sectionSize: 2,
      cellColor: [0.10, 0.225, 0.29],
      sectionColor: [0, 0.94, 1],
      fadeDistance: 18,
      fadeStrength: 1.4,
      y: 0.001, // 略高于 ground plane 避免 z-fight
    });
    gridMesh.visible = showGround;
    scene.add(gridMesh);

    // ── Shader Toy:展示 ShaderMaterial + ShaderChunk (全息 shader)。──
    const shaderToy = new SM({
      vertexSrc: STANDARD_VERTEX_HEADER + /* glsl */ `
        void main() {
          vec4 worldPos = u_model * vec4(a_position, 1.0);
          v_worldPos = worldPos.xyz;
          v_worldNormal = normalize(u_normalMatrix * a_normal);
          v_uv = a_uv;
          gl_Position = u_projection * u_view * worldPos;
        }
      `,
      fragmentSrc: STANDARD_FRAGMENT_HEADER + HOLOGRAM_GLSL + /* glsl */ `
        void main() {
          vec3 viewDir = normalize(u_cameraPos - v_worldPos);
          vec3 base = vec3(0.05, 0.1, 0.2);
          vec3 col = applyHologram(base, v_worldNormal, viewDir);
          fragColor = vec4(col, 1.0);
        }
      `,
      uniforms: {
        u_holoColor: [0, 0.94, 1],
        u_scanlineStrength: 0.45,
        u_fresnelPower: 2.2,
      },
    });
    void SIMPLEX_NOISE_GLSL; void resolveIncludes;
    const toyGeom = new PlaneGeometry(1.4, 1.4);
    const toyMesh = new Mesh(toyGeom, shaderToy);
    toyMesh.position.set(0, 0.7, 0);
    toyMesh.rotation.x = -Math.PI / 6;
    scene.add(toyMesh);
    log.info('shader toy plane added (1.4x1.4 with Hologram shader)');

    const controls = new OrbitControls(camera, canvas, {
      enableDamping: true,
      dampingFactor: 0.12,
      minDistance: 1.5,
      maxDistance: 20,
      minPolarAngle: 0.05,
      maxPolarAngle: Math.PI / 2 - 0.05,
    });
    controls.target.set(0, 0.9, 0);
    controls.update();

    // 把内部对象暴露到外部 effect — 用一个外部 ref 对象
    if (!stageRef.current) stageRef.current = {};
    Object.assign(stageRef.current, { renderer, camera, scene, controls, ground, gridMesh });

    let root: Group | null = null;
    let rootEntityId: number | null = null;
    let raf = 0;
    let stop = false;
    let lastTs = performance.now();
    let frames = 0;
    let fpsAcc = 0;

    // ── Profiler 装配(随 stage 生命周期) ────────────────────────────
    const profiler = new Profiler({ ringSize: 60 });
    useProfilerStore.getState().setProfiler(profiler);
    useProfilerStore.getState().reset();
    const pushProfileFrame = (sample: ReturnType<Profiler['snapshot']>) => {
      if (!sample) return;
      const world = useWorldStore.getState().world;
      const sysT = world
        ? world.getSystemTimings().map((s) => ({
            name: s.name, priority: s.priority, duration: s.duration, enabled: s.enabled,
          }))
        : [];
      useProfilerStore.getState().pushFrame(sample, sysT);
    };

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.resize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // ── 加载资产 (upload / preset) ────────────────────────────────
    const attachRoot = (loadedRoot: Group): void => {
      root = loadedRoot;
      scene.add(root);
      // 归一化到合理尺寸
      const tNorm0 = performance.now();
      normalizeRoot(root, 2.4);
      log.debug(`normalizeRoot done in ${(performance.now() - tNorm0).toFixed(1)}ms ` +
        `(target size 2.4)`);

      // 动画(preset 无 clip)
      if (mixer) {
        useViewerStore.getState().setAnimation({
          isPlaying: true,
          speed: 1,
          currentTime: 0,
        });
      } else {
        // 切换到无动画资产时清掉 isPlaying 状态,避免 UI 假阳性
        useViewerStore.getState().setAnimation({
          isPlaying: false,
          clipName: '',
          currentTime: 0,
          duration: 0,
        });
        log.info('no animation mixer (preset/static asset)');
      }

      // ECS sync
      const tSync0 = performance.now();
      const sync = useWorldStore.getState().syncFromSceneGraph(root, mixer, clips);
      rootEntityId = sync.rootEntityId;
      log.debug(`ECS syncFromSceneGraph in ${(performance.now() - tSync0).toFixed(1)}ms, ` +
        `rootEntityId=${rootEntityId} (0x${(rootEntityId ?? 0).toString(16)})`);
      // 给 root entity 加 PlayerInput / Velocity，让 WASD 能驱动自研场景图
      const world = useWorldStore.getState().world;
      if (world && rootEntityId != null) {
        if (!world.hasComponent(rootEntityId, VelocityC)) {
          world.setComponent(rootEntityId, VelocityC, new Velocity());
          log.debug('attached Velocity component to root entity');
        }
        if (!world.hasComponent(rootEntityId, PlayerInputC)) {
          world.setComponent(rootEntityId, PlayerInputC, new PlayerInput());
          log.debug('attached PlayerInput component to root entity');
        }
      }

      const triCount = countTriangles(root);
      const geoCount = countGeometries(root);
      useViewerStore.getState().setStats({
        triangles: triCount,
        geometries: geoCount,
        textures: 0,
      });
      log.info(`scene ready: ${triCount} triangles across ${geoCount} meshes`);

      setLoading(false);
    };

    let mixer: AnimationMixer | null = null;
    let clips: import('@/engine').AnimationClip[] = [];

    (async () => {
      try {
        if (assetSource.kind === 'upload' && file) {
          const tFile0 = performance.now();
          const buf = await file.arrayBuffer();
          log.info(`file read in ${(performance.now() - tFile0).toFixed(1)}ms: ${(buf.byteLength / 1024).toFixed(1)} KB`);
          const loader = new GLBLoader();
          const tLoad0 = performance.now();
          const result = await loader.load(new Uint8Array(buf));
          log.info(`GLB parsed in ${(performance.now() - tLoad0).toFixed(1)}ms ` +
            `(${result.root.children.length} root groups, ${result.animations.length} clips)`);
          if (cancelled) {
            log.info('load cancelled before scene attach');
            return;
          }
          clips = result.animations;
          if (clips.length > 0) {
            mixer = new AnimationMixer(result.root);
            const action = mixer.actionFor(clips[0]);
            action.play();
            log.info(`animation started: "${clips[0].name}", ` +
              `duration=${clips[0].duration.toFixed(2)}s, ` +
              `of ${clips.length} available`);
            useViewerStore.getState().setAnimation({
              clipName: clips[0].name || 'animation',
              isPlaying: true,
              speed: 1,
              currentTime: 0,
              duration: clips[0].duration,
            });
          } else {
            log.info('no animations in GLB — model is static');
          }
          attachRoot(result.root);
        } else if (assetSource.kind === 'preset') {
          const presetId = assetSource.presetId as GeneratorName;
          const gen = GENERATORS[presetId];
          if (!gen) {
            throw new Error(`Unknown preset id: ${presetId}`);
          }
          if (cancelled) return;
          const tGen0 = performance.now();
          const presetRoot = gen();
          namePresetMeshes(presetRoot);
          log.info(`preset "${presetId}" generated in ${(performance.now() - tGen0).toFixed(1)}ms ` +
            `(${presetRoot.children.length} top-level children, ` +
            `${countGeometries(presetRoot)} meshes)`);
          if (cancelled) {
            log.info('load cancelled before scene attach');
            return;
          }
          attachRoot(presetRoot);
        } else {
          throw new Error(`Unsupported assetSource.kind: ${(assetSource as { kind: string }).kind}`);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`load failed: ${msg}`, err);
        setError(`Custom renderer load failed: ${msg}`);
        setLoading(false);
      }
    })();

    const tick = (ts: number) => {
      if (stop) return;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      // Profiler:帧起
      profiler.frameStart();
      profiler.mark('ecs');

      // ECS world update (MovementSystem / AnimStateSystem / AnimationTickSystem)
      const world = useWorldStore.getState().world;
      if (world) world.update(dt);

      profiler.markEnd('ecs');
      profiler.mark('physics');
      // Physics demo:跑独立 ECS world(物理 + 粒子),不与 player world 冲突
      const pWorld = stageRef.current.physicsWorld;
      if (pWorld) {
        pWorld.update(dt);
        syncMeshesFromTransforms(pWorld);
        // 物理调试可视化:每帧从 ECS 读 collider/contact/rigidbody 状态写 LineMesh
        const pDbg = stageRef.current.physicsDebug;
        if (pDbg) pDbg.update(pWorld);
      }
      profiler.markEnd('physics');

      profiler.mark('controls');
      controls.update();

      // 桥接：ECS root Transform → 自研 scene graph root
      if (world && root && rootEntityId != null) {
        const node = world.getSceneNode(rootEntityId);
        if (node) {
          root.position.set(node.position.x, node.position.y, node.position.z);
          root.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.w);
          root.scale.set(node.scale.x, node.scale.y, node.scale.z);
        }

        // 同步 camera yaw 到 PlayerInput，让 WASD 按当前视角方向移动
        const input = world.getComponent(rootEntityId, PlayerInputC);
        if (input) {
          const yaw = Math.atan2(camera.position.x, camera.position.z);
          input.cameraYaw = yaw;
          useViewerStore.getState().setCamera({ yaw });
        }
      }
      profiler.markEnd('controls');

      // GPU 计时:render mark 走 GPU query (ext 不可用时内部静默)
      profiler.mark('render', { gpu: { gl: renderer.gl } });
      renderer.render(scene, camera);
      profiler.markEnd('render', { gpu: { gl: renderer.gl } });

      // 异步读 GPU query 结果(非阻塞,可能下一帧才填上)
      profiler.pollGpuTimers(renderer.gl);

      const sample = profiler.frameEnd({
        drawCalls: renderer.stats.drawCalls,
        triangles: renderer.stats.triangles,
        drawCallBreakdown: {
          byMesh: renderer.stats.drawCallBreakdown,
        },
      });
      pushProfileFrame(sample);

      frames++;
      fpsAcc += dt;
      if (fpsAcc >= 0.5) {
        const fps = Math.round(frames / fpsAcc);
        setStats({ fps, draws: renderer.stats.drawCalls, tris: renderer.stats.triangles });
        useViewerStore.getState().setStats({ fps, drawCalls: renderer.stats.drawCalls });
        frames = 0;
        fpsAcc = 0;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      stop = true;
      cancelAnimationFrame(raf);
      stageRef.current = {};
      ro.disconnect();
      controls.dispose();
      log.info(`unmount: ${frames} frames since last FPS sample, ` +
        `cleaning up renderer + controls`);
      renderer.dispose();
      // 释放 Profiler GPU query
      profiler.dispose(renderer.gl);
      useProfilerStore.getState().setProfiler(null);
      useProfilerStore.getState().reset();
    };
  }, [assetSource]);

  // 外部 effect:store 变化 → 应用到引擎
  useEffect(() => {
    const r = stageRef.current.renderer;
    if (!r) return;
    applyPostFX(r, postFX);
  }, [postFX]);

  // 物理 demo:开关切换时创建 / 销毁独立的 ECS world + box/粒子 mesh
  useEffect(() => {
    const stage = stageRef.current;
    if (physicsDemo) {
      if (!stage.physicsWorld && stage.scene) {
        const demo = createPhysicsDemo(stage.scene, { boxCount: 24 });
        stage.physicsWorld = demo.world;
        log.info(`physics demo enabled: ${demo.boxIds.length} boxes + emitter`);
      }
    } else {
      stage.physicsWorld = undefined;
    }
    void togglePhysicsDemo; // 避免 unused warning
  }, [physicsDemo, togglePhysicsDemo]);

  // 物理调试可视化:创建 / 销毁 PhysicsDebugRenderer,跟随 scene 挂载
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage.scene) return;
    if (physicsDebug) {
      if (!stage.physicsDebug) {
        const r = stage.renderer;
        if (!r) return;
        const dbg = new PhysicsDebugRenderer(r);
        stage.scene.add(dbg.group);
        stage.physicsDebug = dbg;
        log.info('physics debug renderer attached');
      }
    } else {
      if (stage.physicsDebug) {
        stage.scene.remove(stage.physicsDebug.group);
        stage.physicsDebug.dispose();
        stage.physicsDebug = undefined;
        log.info('physics debug renderer detached');
      }
    }
  }, [physicsDebug]);

  useEffect(() => {
    const r = stageRef.current.renderer;
    if (!r) return;
    applyEnvironment(r, environment);
  }, [environment]);

  useEffect(() => {
    const scene = stageRef.current.scene;
    if (!scene) return;
    const hdriPath = LOCAL_HDRI[environment.preset];
    if (!hdriPath) {
      scene.background = { color: '#000000' };
      return;
    }
    const hdriLoader = new HDRLoader();
    hdriLoader.load(hdriPath).then((result) => {
      log.info(`HDRI updated: ${hdriPath}`);
      scene.background = { color: '#000000', envMap: result.texture };
    }).catch((e) => {
      log.warn(`HDRI reload failed for ${hdriPath}:`, e);
    });
  }, [environment.preset]);

  useEffect(() => {
    const ground = stageRef.current.ground;
    const grid = stageRef.current.gridMesh;
    if (ground) ground.visible = showGround;
    if (grid) grid.visible = showGround;
  }, [showGround]);

  // CameraRig:preset / fov / distance 改变时动画过渡
  useEffect(() => {
    const cam = stageRef.current.camera;
    if (!cam) return;
    // 自研 PerspectiveCamera 的 duck-typed 形态传给 animateCameraToPreset
    const target = {
      position: cam.position as unknown as THREE.Vector3,
      fov: cam.fov,
      updateProjectionMatrix: () => cam.updateProjectionMatrix(),
      getWorldDirection: (t: THREE.Vector3) => {
        // 复用我们刚加的 getWorldDirection,赋给 THREE.Vector3
        const out = new THREE.Vector3();
        cam.getWorldDirection(out as unknown as { x: number; y: number; z: number });
        t.copy(out);
        return t;
      },
      lookAt: (x: number | THREE.Vector3, y?: number, z?: number) => {
        if (typeof x === 'number') cam.lookAt(x, y ?? 0, z ?? 0);
        else cam.lookAt(x.x, x.y, x.z);
      },
    };
    animateCameraToPreset(
      target,
      cameraConfig.preset,
      { distance: cameraConfig.distance, targetHeight: cameraConfig.targetHeight, fov: cameraConfig.fov },
      { duration: 700 },
    );
  }, [cameraConfig.preset, cameraConfig.fov, cameraConfig.distance, cameraConfig.targetHeight]);

  // 同步 camera yaw → store
  useEffect(() => {
    const id = setInterval(() => {
      const cam = stageRef.current.camera;
      if (!cam) return;
      const yaw = Math.atan2(cam.position.x, cam.position.z);
      if (Math.abs(yaw - cameraConfig.yaw) > 0.001) {
        setCamera({ yaw });
      }
    }, 100);
    return () => clearInterval(id);
  }, [cameraConfig.yaw, setCamera]);

  // 动画 speed/playing 通过 store → 引擎 mixer 已经挂在 root.mixer 上,这里只做状态 sync
  void animation;



  return (
    <div ref={containerRef} className="relative w-full h-full bg-black">
      <canvas ref={canvasRef} className="block w-full h-full outline-none" tabIndex={0} />
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="hud-panel px-4 py-3 text-center">
            <div className="hud-label text-neon-cyan mb-1">CUSTOM WEBGL2</div>
            <div className="font-mono text-[10px] text-mist">loading .glb into engine...</div>
          </div>
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="hud-panel px-4 py-3 max-w-md text-center border-neon-magenta/30">
            <div className="hud-label text-neon-magenta mb-1">RENDERER ERROR</div>
            <div className="font-mono text-[10px] text-mist">{error}</div>
          </div>
        </div>
      )}
      {/* HUD overlay */}
      <div className="pointer-events-none absolute top-3 left-3 hud-panel px-3 py-2">
        <div className="hud-label text-neon-cyan">CUSTOM ENGINE</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-mist">
          <span>FPS {stats.fps.toString().padStart(3, '0')}</span>
          <span className="text-neon-cyan/30">·</span>
          <span>DRAW {stats.draws}</span>
          <span className="text-neon-cyan/30">·</span>
          <span>TRI {stats.tris}</span>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 hud-panel px-3 py-2 max-w-[260px]">
        <div className="hud-label text-neon-cyan">CONTROLS</div>
        <ul className="mt-1.5 space-y-0.5 text-[10px] font-mono text-mist">
          <li><span className="text-haze">L-DRAG</span> rotate</li>
          <li><span className="text-haze">R-DRAG</span> pan</li>
          <li><span className="text-haze">WHEEL</span> zoom</li>
          <li><span className="text-haze">WASD</span> move (with ECS bridge)</li>
        </ul>
      </div>
      {profilerEnabled && <ProfilerHUD />}
    </div>
  );
}

// ── store → engine helpers ──────────────────────────────────────────

import type { PostFXState, EnvironmentState } from '@/types';

/** PostFX:把 uiStore.postFX 写入 renderer。 */
function applyPostFX(r: WebGL2Renderer, p: PostFXState): void {
  r.postProcessingEnabled = true;
  r.bloomEnabled = p.bloom;
  r.bloomIntensity = p.bloomIntensity;
  r.chromaticAberrationEnabled = p.chromaticAberration;
  r.vignetteEnabled = p.vignette;
}

/** Environment:clearColor 跟环境预设一致。 */
function applyEnvironment(r: WebGL2Renderer, e: EnvironmentState): void {
  // 简化为根据 preset 名挑色
  const map: Record<string, [number, number, number]> = {
    midnight: [0.02, 0.025, 0.05],
    dawn: [0.18, 0.12, 0.15],
    studio: [0.06, 0.07, 0.10],
    void: [0, 0, 0],
  };
  const rgb = map[e.preset] ?? map.midnight;
  // 0..255
  r.clearColor = {
    r: rgb[0] * 0.18,
    g: rgb[1] * 0.18,
    b: rgb[2] * 0.18,
    a: 1,
  };
  r.environmentPreset = e.preset;
  // 强度/曝光(EnvironmentState 当前未拆 intensity,直接用 exposure)
  r.environmentExposure = e.exposure;
}

function normalizeRoot(root: Group, targetSize: number) {
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  let found = false;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh && mesh.geometry && mesh.geometry.boundingBox) {
      const box = mesh.geometry.boundingBox;
      min.x = Math.min(min.x, box.min.x);
      min.y = Math.min(min.y, box.min.y);
      min.z = Math.min(min.z, box.min.z);
      max.x = Math.max(max.x, box.max.x);
      max.y = Math.max(max.y, box.max.y);
      max.z = Math.max(max.z, box.max.z);
      found = true;
    }
  });
  if (!found) return;
  // size = max - min
  const size = new Vector3(max.x - min.x, max.y - min.y, max.z - min.z);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim === 0) return;
  const scale = targetSize / maxDim;
  root.scale.set(scale, scale, scale);
  root.position.y = -min.y * scale;
}

function countTriangles(root: Group): number {
  let tris = 0;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const idx = mesh.geometry.index;
      const pos = mesh.geometry.attributes.position;
      if (idx) tris += idx.count / 3;
      else if (pos) tris += pos.count / 3;
    }
  });
  return Math.round(tris);
}

function countGeometries(root: Group): number {
  let n = 0;
  root.traverse((node) => {
    if ((node as Mesh).isMesh) n++;
  });
  return n;
}

/**
 * 给预设 Group 的所有 Mesh 设置稳定、可读的名字。
 *
 * 渲染器在 Profiler 的 draw call 拆解里用 `mesh.name` 当 key;
 * 生成器没设过 name 会导致所有 mesh 撞到 "(unnamed)",看不出贡献。
 * 这里用 `${rootName}#${index}` 给每个 mesh 一个独立 key(DFS 顺序),
 * 视觉上如 "MECH_WALKER#0", "MECH_WALKER#1"... 在 Profiler 列表里
 * 能直接对应到模型部件。
 */
function namePresetMeshes(root: Group): void {
  const rootName = root.name || 'PRESET';
  let i = 0;
  root.traverse((node) => {
    if (node instanceof EngineMesh) {
      node.name = `${rootName}#${i++}`;
    }
  });
}

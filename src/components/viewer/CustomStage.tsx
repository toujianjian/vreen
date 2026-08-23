// CustomStage — 在 /viewer 中启用自研 WebGL2 引擎渲染模型。
// 支持:upload(.glb) 与 preset(6 个程序化模型)。
// 其他来源(obj/fbx 等)自动 fallback 到 three.js 路径。

import { useEffect, useRef, useState } from 'react';
import { useViewerStore } from '@/stores/viewerStore';
import { useWorldStore } from '@/stores/worldStore';
import { useUIStore } from '@/stores/uiStore';
import { uploadBridge } from '@/lib/uploadBridge';
import { GENERATORS, GeneratorName } from '@/three/generators';
import { getPresetById } from '@/lib/presets';
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
  CubeTexture,
  // 引擎功能开关所需的类
  ParticleSystem2,
  AdvancedParticleEmitter as ParticleEmitter,
  ColorOverLifeModifier,
  SizeOverLifeModifier,
  LinearCurve,
  HeightmapGenerator,
  TerrainGeometry,
  IKBone,
  IKChain,
  IKSolver,
  Color,
  BufferGeometry,
  BufferAttribute,
  ShaderProgram,
  Quaternion,
} from '@/engine';
import { createGridMesh } from '@/engine/Helpers/GridHelper';
import { createLineMesh, LineMesh } from '@/engine/Helpers/LineHelper';
import { Velocity, VelocityC, PlayerInput, PlayerInputC, World as ECSWorld } from '@/engine/ECS';
import { createPhysicsDemo, syncMeshesFromTransforms } from '@/engine/Physics/PhysicsDemo';
import { createLogger } from '@/lib/logger';
import { animateCameraToPreset } from '@/three/camera';
import * as THREE from 'three';
import { ShaderMaterial as SM } from '@/engine/Materials/ShaderMaterial';
import {
  HOLOGRAM_GLSL,
  STANDARD_VERTEX_HEADER,
  STANDARD_FRAGMENT_HEADER,
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
    // 引擎功能开关所需的运行时引用
    dirLight?: DirectionalLight;
    particleSystem?: ParticleSystem2;
    particleMesh?: Mesh;
    terrainMesh?: Mesh;
    ikSolver?: IKSolver;
    ikChain?: IKChain;
    ikMesh?: Mesh;
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
  // 引擎功能开关:粒子 / 地形 / IK / 阴影
  const particleEnabled = useViewerStore((s) => s.particleEnabled);
  const terrainEnabled = useViewerStore((s) => s.terrainEnabled);
  const ikEnabled = useViewerStore((s) => s.ikEnabled);
  const shadowEnabled = useViewerStore((s) => s.shadowEnabled);

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
        scene.background = '#000000';
        // HDRLoader 产出的是 6-face packed Texture,renderer 按立方体贴图上传;
        // scene.environment 在类型上要求 CubeTexture,这里做一次桥接 cast。
        scene.environment = hdriResult.texture as unknown as CubeTexture;
      }).catch((e) => {
        log.warn(`HDRI load failed for ${hdriPath}:`, e);
      });
    }

    const dir = new DirectionalLight(0xfff2d9, 2.0, { x: 4, y: 6, z: 3 });
    dir.castShadow = shadowEnabled;
    dir.shadow.mapSize = 2048;
    dir.shadow.cameraHalfSize = 6;
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
    Object.assign(stageRef.current, { renderer, camera, scene, controls, ground, gridMesh, dirLight: dir });

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
      // 容器布局未完成时 clientWidth/Height 可能为 0；用 canvas 自身
      // 的 client 尺寸作为后备，避免 canvas 保持默认 300x150。
      let w = Math.max(1, container.clientWidth);
      let h = Math.max(1, container.clientHeight);
      if (w < 2 && h < 2) {
        w = Math.max(1, canvas.clientWidth);
        h = Math.max(1, canvas.clientHeight);
      }
      if (w < 2 && h < 2) {
        // 布局还没好，下个帧再试
        requestAnimationFrame(resize);
        return;
      }
      renderer.resize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    ro.observe(canvas);

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
      // 关键:setAssetSource 会把 viewerStore.isLoading 置 true、loadProgress 置 0.05。
      // 这一条路径(CustomStage)只维护自己的本地 loading,从不复位 viewerStore,
      // 否则右下角状态条会永远卡在"加载中 5%"(即使模型已渲染)。
      useViewerStore.getState().setLoading(false);
      useViewerStore.getState().setLoadProgress(1);
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
          const preset = getPresetById(assetSource.presetId);
          if (!preset) {
            throw new Error(`Unknown preset id: ${assetSource.presetId}`);
          }
          const generatorName = preset.generator as GeneratorName;
          const gen = GENERATORS[generatorName];
          if (!gen) {
            throw new Error(`Unknown generator: ${generatorName} (preset ${preset.id})`);
          }
          if (cancelled) return;
          const tGen0 = performance.now();
          const presetRoot = gen();
          namePresetMeshes(presetRoot);
          log.info(`preset "${preset.id}" (generator ${generatorName}) generated in ${(performance.now() - tGen0).toFixed(1)}ms ` +
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
        useViewerStore.getState().setLoading(false);
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

      // ── 引擎功能开关的每帧驱动:粒子 billboard + IK 求解 ─────────────
      profiler.mark('engine-features');
      const psys = stageRef.current.particleSystem;
      const pmesh = stageRef.current.particleMesh;
      if (psys && pmesh && camera) {
        psys.update(dt);
        updateParticleBillboards(psys, pmesh, camera);
      }
      const ikSolver = stageRef.current.ikSolver;
      const ikChain = stageRef.current.ikChain;
      const ikMesh = stageRef.current.ikMesh;
      if (ikSolver && ikChain && ikMesh) {
        const t = ts / 1000;
        // 目标点在场景上方做利萨如轨迹,便于观察 IK 链追踪
        ikChain.target.set(
          Math.sin(t * 0.8) * 0.9,
          1.5 + Math.sin(t * 1.3) * 0.25,
          0.4 + Math.cos(t * 0.6) * 0.4,
        );
        ikSolver.solve();
        updateIKLineMesh(ikChain, ikMesh);
      }
      profiler.markEnd('engine-features');

      // GPU 计时:render mark 走 GPU query (ext 不可用时内部静默)
      profiler.mark('render', { gpu: { gl: renderer.gl } });
      try {
        renderer.render(scene, camera);
      } catch (e) {
        log.error(`render() threw: ${(e as Error).message}`, e);
        // 不再 schedule raf,避免刷屏
        stop = true;
        return;
      }
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
    log.info(`starting render loop: assetSource=${JSON.stringify(assetSource)}`);
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

  // ── 引擎功能开关:阴影 ──────────────────────────────────────────────
  // WebGL2Renderer 内部已实现 shadow pass,自动遍历 castShadow 的 DirectionalLight。
  // 这里只需要切换 dir.castShadow 标志和 shadow.mapSize,无需另接 ShadowMapManager。
  useEffect(() => {
    const dir = stageRef.current.dirLight;
    if (!dir) return;
    dir.castShadow = shadowEnabled;
    // 关闭时降到 256 节省显存,开启时恢复高分辨率
    dir.shadow.mapSize = shadowEnabled ? 2048 : 256;
    log.info(`shadow ${shadowEnabled ? 'enabled' : 'disabled'} (mapSize=${dir.shadow.mapSize})`);
  }, [shadowEnabled]);

  // ── 引擎功能开关:地形 ──────────────────────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    const scene = stage.scene;
    const renderer = stage.renderer;
    if (!scene || !renderer) return;

    if (terrainEnabled) {
      if (stage.terrainMesh) {
        stage.terrainMesh.visible = true;
        return;
      }
      const SEG = 96;
      const tGen0 = performance.now();
      const heightmap = HeightmapGenerator.fromPerlinNoise(
        SEG + 1, SEG + 1, 18, 5, 0.5, 1337,
      );
      const geo = new TerrainGeometry({
        width: 20,
        height: 20,
        widthSegments: SEG,
        heightSegments: SEG,
        heightmap,
        heightScale: 1.6,
      });
      const mat = new StandardMaterial();
      mat.baseColor = { r: 0.18, g: 0.32, b: 0.16 };
      mat.metallic = 0.0;
      mat.roughness = 0.95;
      mat.receiveShadow = true;
      const mesh = new Mesh(geo, mat);
      mesh.name = 'TERRAIN';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      // 把地形往下沉一点,让默认 ground plane 仍可见作为参考层
      mesh.position.y = -0.4;
      scene.add(mesh);
      stage.terrainMesh = mesh;
      log.info(`terrain generated in ${(performance.now() - tGen0).toFixed(1)}ms ` +
        `(${SEG}x${SEG} grid, heightScale=1.6)`);
    } else {
      const m = stage.terrainMesh;
      if (m) {
        scene.remove(m);
        m.geometry.dispose();
        stage.terrainMesh = undefined;
        log.info('terrain disposed');
      }
    }
  }, [terrainEnabled]);

  // ── 引擎功能开关:IK ────────────────────────────────────────────────
  // 创建 3 骨骼 FABRIK 链:根在 (0,1.5,0),沿 +X 伸出两段长度 0.6 的骨骼,
  // 末端为 effector(length=0)。每帧在 tick 中由 ikChain.target 驱动求解。
  // 可视化用 LineMesh (走 helper 旁路),3 段:root→mid→end→target。
  useEffect(() => {
    const stage = stageRef.current;
    const scene = stage.scene;
    const renderer = stage.renderer;
    if (!scene || !renderer) return;

    if (ikEnabled) {
      if (stage.ikSolver) return; // 已存在,避免重复创建
      const rootBone = new IKBone('ik_root', new Vector3(0, 1.5, 0), new Quaternion(), 0.6);
      const midBone = new IKBone('ik_mid', new Vector3(0.6, 0, 0), new Quaternion(), 0.6);
      const endBone = new IKBone('ik_end', new Vector3(0.6, 0, 0), new Quaternion(), 0);
      const chain = new IKChain({ iterations: 16, tolerance: 1e-3 });
      chain.addBone(rootBone);
      chain.addBone(midBone);
      chain.addBone(endBone);
      chain.target.set(0.9, 1.5, 0.4);
      chain.poleTarget = new Vector3(0, 2.5, -0.5);
      const solver = new IKSolver({ iterations: 16, tolerance: 1e-3 });
      solver.addChain(chain);

      // LineMesh:3 段(root→mid、mid→end、end→target),青色
      const lineMesh = createLineMesh(renderer, 3, [0, 0.94, 1], 1);
      lineMesh.name = 'IK_LINE';
      scene.add(lineMesh);

      stage.ikSolver = solver;
      stage.ikChain = chain;
      stage.ikMesh = lineMesh;
      log.info('IK chain enabled (3 bones, FABRIK)');
    } else {
      const m = stage.ikMesh;
      if (m) {
        scene.remove(m);
        m.geometry.dispose();
        stage.ikMesh = undefined;
      }
      stage.ikSolver = undefined;
      stage.ikChain = undefined;
      log.info('IK chain disabled');
    }
  }, [ikEnabled]);

  // ── 引擎功能开关:粒子 ──────────────────────────────────────────────
  // ParticleSystem2 产出 CPU 端 positions/colors/sizes,通过 Billboard Mesh 适配
  // 到 WebGL2Renderer 的 helper 旁路(无 POINTS 模式,故每粒子展开成 2 三角形)。
  useEffect(() => {
    const stage = stageRef.current;
    const scene = stage.scene;
    const renderer = stage.renderer;
    if (!scene || !renderer) return;

    if (particleEnabled) {
      if (stage.particleSystem) return;
      const psys = new ParticleSystem2(500);
      psys.duration = 6;
      psys.loop = true;
      const emitter = new ParticleEmitter();
      emitter.shape = { type: 'sphere', radius: 0.25, shellOnly: false };
      emitter.position = new Vector3(0, 1.4, 0);
      emitter.rate = 60;
      emitter.lifetime = 1.4 + Math.random() * 1.0;
      emitter.startSpeed = 0.4 + Math.random() * 0.8;
      emitter.startColor = { r: 0, g: 0.94, b: 1, a: 1 }; // 青色
      emitter.endColor = { r: 1, g: 0.18, b: 0.84, a: 1 }; // 品红
      emitter.startSize = 0.10 + Math.random() * 0.06;
      emitter.endSize = 0;
      emitter.gravity = new Vector3(0, -0.4, 0);
      emitter.drag = 0.6;
      psys.addEmitter(emitter);
      psys.addModifier(new ColorOverLifeModifier(
        new Color(0, 0.94, 1),
        new Color(1, 0.18, 0.84),
      ));
      psys.addModifier(new SizeOverLifeModifier(new LinearCurve(1, 0)));

      // Billboard Mesh:预分配 maxParticles*6 顶点的 buffer,每帧只更新 count*6 部分
      const MAX_VERTS = psys.maxParticles * 6;
      const positions = new Float32Array(MAX_VERTS * 3);
      const colors = new Float32Array(MAX_VERTS * 3);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(positions, 3));
      geo.setAttribute('color', new BufferAttribute(colors, 3));
      // 让 frustum culling 不要把整个 billboard 池剔除(顶点都是 0 时 bounding sphere 半径为 0)
      geo.computeBoundingBox();
      const mesh = new Mesh(geo, {} as never);
      mesh.name = 'PARTICLES';
      mesh.frustumCulled = false;
      mesh.userData = {
        __helper: 'particles',
        program: getParticleProgram(renderer.gl),
        uniforms: {
          u_softness: 0.45,
        },
      };
      scene.add(mesh);

      stage.particleSystem = psys;
      stage.particleMesh = mesh;
      log.info('particle system enabled (max=500, sphere emitter)');
    } else {
      const psys = stage.particleSystem;
      const m = stage.particleMesh;
      if (m) {
        scene.remove(m);
        m.geometry.dispose();
        stage.particleMesh = undefined;
      }
      if (psys) psys.clear();
      stage.particleSystem = undefined;
      log.info('particle system disabled');
    }
  }, [particleEnabled]);

  useEffect(() => {
    const scene = stageRef.current.scene;
    if (!scene) return;
    const hdriPath = LOCAL_HDRI[environment.preset];
    if (!hdriPath) {
      scene.background = '#000000';
      scene.environment = null;
      return;
    }
    const hdriLoader = new HDRLoader();
    hdriLoader.load(hdriPath).then((result) => {
      log.info(`HDRI updated: ${hdriPath}`);
      scene.background = '#000000';
      // HDRLoader 产出的是 6-face packed Texture,renderer 按立方体贴图上传;
      // scene.environment 在类型上要求 CubeTexture,这里做一次桥接 cast。
      scene.environment = result.texture as unknown as CubeTexture;
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
        const out = cam.getWorldDirection();
        t.copy(out as unknown as THREE.Vector3);
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

/** Environment:clearColor 跟环境预设一致。
 *
 *  clearColor 值域约定（重要，勿破坏）：
 *   - RGB 分量必须是线性空间下的 0..1 浮点，**不可再乘任意强度系数**。
 *   - 历史教训：曾在此处对 dawn 的 [0.18,0.12,0.15] 再 ×0.18 导致画面过暗，
 *     因为 WebGL2Renderer 已经会按 environmentExposure 自行缩放环境贡献，
 *     这里重复衰减 = 双重衰减。当前实现直接把预设色原值写入 clearColor。
 *   - alpha 始终为 1（canvas 不透明）。 */
function applyEnvironment(r: WebGL2Renderer, e: EnvironmentState): void {
  // 简化为根据 preset 名挑色（值域 0..1）
  const map: Record<string, [number, number, number]> = {
    midnight: [0.02, 0.025, 0.05],
    dawn: [0.18, 0.12, 0.15],
    studio: [0.06, 0.07, 0.10],
    void: [0, 0, 0],
  };
  const rgb = map[e.preset] ?? map.midnight;
  r.clearColor = {
    r: rgb[0],
    g: rgb[1],
    b: rgb[2],
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

// ── 引擎功能开关:粒子 Billboard 渲染 ─────────────────────────────────
//
// ParticleSystem2 产出 CPU 端的 positions/colors/sizes,但 WebGL2Renderer
// 没有 POINTS 图元支持(helper 旁路只支持 TRIANGLES / LINES)。这里用适配
// 方案:每个粒子在 CPU 端展开成 2 个三角形(6 顶点)构成面向相机的 billboard
// quad,通过 helper 旁路 + 自定义 ShaderProgram 渲染。
//
// Billboard 朝向:从 camera.matrixWorld 列主序提取 right (col 0) / up (col 1),
// 顶点 = 粒子中心 + (right * cornerX + up * cornerY) * size。
// 软圆:fragment shader 中根据 v_uv(由 gl_VertexID % 6 推算)到原点距离 discard。

const PARTICLE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position; // billboard 角落的世界位置(已 CPU 展开)
layout(location = 3) in vec3 a_color;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
out vec3 v_color;
out vec2 v_uv;
void main() {
  v_color = a_color;
  // gl_VertexID % 6 决定 quad 角落,uv ∈ [-1, 1]
  // 0:(-1,-1), 1:(1,-1), 2:(1,1), 3:(-1,-1), 4:(1,1), 5:(-1,1)
  int c = gl_VertexID % 6;
  vec2 uv;
  if (c == 0) uv = vec2(-1.0, -1.0);
  else if (c == 1) uv = vec2( 1.0, -1.0);
  else if (c == 2) uv = vec2( 1.0,  1.0);
  else if (c == 3) uv = vec2(-1.0, -1.0);
  else if (c == 4) uv = vec2( 1.0,  1.0);
  else             uv = vec2(-1.0,  1.0);
  v_uv = uv;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

const PARTICLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_color;
in vec2 v_uv;
uniform float u_softness;
out vec4 fragColor;
void main() {
  // 软圆 alpha:uv 到原点距离越近越实,边缘按 u_softness 平滑过渡
  float d = length(v_uv);
  float alpha = smoothstep(1.0, 1.0 - u_softness, d);
  if (alpha < 0.01) discard;
  // 加性混合感:颜色 × alpha,背景叠加而非遮挡
  fragColor = vec4(v_color * alpha, alpha);
}
`;

let _particleProgram: ShaderProgram | null = null;
function getParticleProgram(gl: WebGL2RenderingContext): ShaderProgram {
  if (_particleProgram && _particleProgram.gl === gl) return _particleProgram;
  _particleProgram = new ShaderProgram(gl, PARTICLE_VERT, PARTICLE_FRAG);
  log.debug('compiled particle billboard program');
  return _particleProgram;
}

/**
 * 把 ParticleSystem2 的当前粒子状态展开成 billboard 顶点 buffer。
 *
 * - 每个粒子 → 6 顶点(2 个三角形构成 quad)
 * - 顶点位置 = 粒子中心 + (right * cornerX + up * cornerY) * size
 *   其中 right/up 来自 camera.matrixWorld 的列 0/列 1
 * - 顶点颜色 = 粒子当前颜色
 * - 超出活跃粒子数的尾部顶点保持 (0,0,0),fragment 会因 alpha<0.01 discard
 *
 * 这里直接修改 mesh 的 BufferAttribute 数组并标记 needsUpdate,
 * WebGL2Renderer 在下一帧 _drawHelper 时会通过 bufferData 重传。
 */
function updateParticleBillboards(
  psys: ParticleSystem2,
  mesh: Mesh,
  camera: PerspectiveCamera,
): void {
  const posAttr = mesh.geometry.getAttribute('position') as BufferAttribute | undefined;
  const colAttr = mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
  if (!posAttr || !colAttr) return;

  const positions = posAttr.array as Float32Array;
  const colors = colAttr.array as Float32Array;

  // 列主序:col 0 = right, col 1 = up
  const e = camera.matrixWorld.elements;
  const rx = e[0], ry = e[1], rz = e[2];
  const ux = e[4], uy = e[5], uz = e[6];

  const particles = psys.particles;
  const n = particles.length;
  // 清空尾部(防止上一帧残留粒子绘制)
  const totalVerts = Math.min(positions.length / 3, n * 6);

  for (let i = 0; i < n; i++) {
    const p = particles[i];
    const px = p.position.x, py = p.position.y, pz = p.position.z;
    const cr = p.color.r, cg = p.color.g, cb = p.color.b;
    const s = p.size;
    const o = i * 18; // 6 顶点 * 3 float
    const oc = i * 18;

    // 6 顶点的 corner 偏移(已 unroll,避免 inner loop):
    //  0: (-1,-1)   1: ( 1,-1)   2: ( 1, 1)
    //  3: (-1,-1)   4: ( 1, 1)   5: (-1, 1)
    positions[o + 0]  = px + (-rx - ux) * s;
    positions[o + 1]  = py + (-ry - uy) * s;
    positions[o + 2]  = pz + (-rz - uz) * s;
    positions[o + 3]  = px + ( rx - ux) * s;
    positions[o + 4]  = py + ( ry - uy) * s;
    positions[o + 5]  = pz + ( rz - uz) * s;
    positions[o + 6]  = px + ( rx + ux) * s;
    positions[o + 7]  = py + ( ry + uy) * s;
    positions[o + 8]  = pz + ( rz + uz) * s;
    positions[o + 9]  = positions[o + 0];
    positions[o + 10] = positions[o + 1];
    positions[o + 11] = positions[o + 2];
    positions[o + 12] = positions[o + 6];
    positions[o + 13] = positions[o + 7];
    positions[o + 14] = positions[o + 8];
    positions[o + 15] = px + (-rx + ux) * s;
    positions[o + 16] = py + (-ry + uy) * s;
    positions[o + 17] = pz + (-rz + uz) * s;

    // 6 顶点共用粒子颜色
    for (let k = 0; k < 6; k++) {
      colors[oc + k * 3 + 0] = cr;
      colors[oc + k * 3 + 1] = cg;
      colors[oc + k * 3 + 2] = cb;
    }
  }

  // 把尾部(totalVerts..MAX)置零,避免上一帧残留粒子继续绘制
  for (let i = totalVerts * 3; i < positions.length; i++) {
    positions[i] = 0;
    colors[i] = 0;
  }

  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

/**
 * 把 IK 解算后的骨骼世界位置写入 LineMesh,共 3 段 6 顶点:
 *   root → mid → end → target
 */
function updateIKLineMesh(chain: IKChain, mesh: Mesh): void {
  if (!(mesh instanceof LineMesh)) return;
  const bones = chain.bones;
  if (bones.length < 2) return;
  const root = bones[0].getWorldPosition(new Vector3());
  const mid = bones[1].getWorldPosition(new Vector3());
  const end = bones[bones.length - 1].getWorldPosition(new Vector3());
  const tgt = chain.target;
  const verts = new Float32Array([
    root.x, root.y, root.z, mid.x, mid.y, mid.z,
    mid.x, mid.y, mid.z, end.x, end.y, end.z,
    end.x, end.y, end.z, tgt.x, tgt.y, tgt.z,
  ]);
  mesh.updateVertices(verts);
}

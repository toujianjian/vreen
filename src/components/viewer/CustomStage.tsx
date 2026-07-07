// CustomStage — 在 /viewer 中启用自研 WebGL2 引擎渲染上传的 GLB 模型。
// 当前是实验性后端：仅支持 .glb 上传文件，preset / obj / fbx 等自动 fallback。
// 目标：验证自研引擎在真实模型上的渲染、动画、ECS 同步能力。

import { useEffect, useRef, useState } from 'react';
import { useViewerStore } from '@/stores/viewerStore';
import { useWorldStore } from '@/stores/worldStore';
import { uploadBridge } from '@/lib/uploadBridge';
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
} from '@/engine';
import { Velocity, VelocityC, PlayerInput, PlayerInputC } from '@/engine/ECS';

interface CustomStageStats {
  fps: number;
  draws: number;
  tris: number;
}

export function CustomStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<CustomStageStats>({ fps: 0, draws: 0, tris: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const assetSource = useViewerStore((s) => s.assetSource);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    if (!assetSource) return;

    // 仅支持上传 GLB
    const isGlbUpload = assetSource.kind === 'upload';
    if (!isGlbUpload) {
      setError('Custom renderer currently supports uploaded .glb files only.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const file = uploadBridge.consume();
    if (!file) {
      setError('No file handed off. Please re-upload the .glb file.');
      setLoading(false);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'glb') {
      setError(`Custom renderer only supports .glb; got .${ext}. Switch back to three.js.`);
      setLoading(false);
      return;
    }

    // ── 引擎装配 ────────────────────────────────────────────────────
    const renderer = new WebGL2Renderer(canvas, { antialias: true });
    renderer.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    renderer.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    const camera = new PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(3, 2.2, 4.2);
    camera.lookAt(0, 0.9, 0);

    const scene = new Scene();
    // 背景纯黑：WebGL2Renderer 不读 scene.background,只读 clearColor,这里省略

    const dir = new DirectionalLight(0xfff2d9, 1.0, { x: 4, y: 8, z: 5 });
    dir.castShadow = true;
    const amb = new AmbientLight(0x2e3852, 0.9);
    scene.add(dir);
    scene.add(amb);

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

    let mixer: AnimationMixer | null = null;
    let root: Group | null = null;
    let rootEntityId: number | null = null;
    let raf = 0;
    let stop = false;
    let lastTs = performance.now();
    let frames = 0;
    let fpsAcc = 0;

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.resize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // ── 加载 GLB ────────────────────────────────────────────────────
    (async () => {
      try {
        const buf = await file.arrayBuffer();
        const loader = new GLBLoader();
        const result = await loader.load(new Uint8Array(buf));
        if (cancelled) return;

        root = result.root;
        scene.add(root);

        // 归一化到合理尺寸
        normalizeRoot(root, 2.4);

        // 动画
        if (result.animations.length > 0) {
          mixer = new AnimationMixer(root);
          const action = mixer.actionFor(result.animations[0]);
          action.play();
          useViewerStore.getState().setAnimation({
            clipName: result.animations[0].name || 'animation',
            isPlaying: true,
            speed: 1,
            currentTime: 0,
            duration: result.animations[0].duration,
          });
        }

        // ECS sync
        const sync = useWorldStore.getState().syncFromSceneGraph(root, mixer, result.animations);
        rootEntityId = sync.rootEntityId;
        // 给 root entity 加 PlayerInput / Velocity，让 WASD 能驱动自研场景图
        const world = useWorldStore.getState().world;
        if (world && rootEntityId != null) {
          if (!world.hasComponent(rootEntityId, VelocityC)) world.setComponent(rootEntityId, VelocityC, new Velocity());
          if (!world.hasComponent(rootEntityId, PlayerInputC)) world.setComponent(rootEntityId, PlayerInputC, new PlayerInput());
        }

        useViewerStore.getState().setStats({
          triangles: countTriangles(root),
          geometries: countGeometries(root),
          textures: 0,
        });

        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Custom renderer load failed: ${msg}`);
        setLoading(false);
      }
    })();

    const tick = (ts: number) => {
      if (stop) return;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      // ECS world update (MovementSystem / AnimStateSystem / AnimationTickSystem)
      const world = useWorldStore.getState().world;
      if (world) world.update(dt);

      controls.update();

      // 桥接：ECS root Transform → 自研 scene graph root
      if (world && root && rootEntityId != null) {
        const node = world.getSceneNode(rootEntityId);
        if (node) {
          root.position.set(node.position.x, node.position.y, node.position.z);
          root.quaternion.set(node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.w);
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
      renderer.render(scene, camera);

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
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, [assetSource]);

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
    </div>
  );
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
  const size = new Vector3().sub(max, min);
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

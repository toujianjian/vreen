// EngineDemoPage — 最小演示页：自研 WebGL2 engine + 自研 OrbitControls。
// 目的：把 Humanoid 跑起来，验证
//   ① 渲染管线 (Mesh / SkinnedMesh / Skinning)
//   ② 动画系统 (Mixer.update)
//   ③ 自研 OrbitControls 交互（左键旋转 / 右键平移 / 滚轮缩放 / damping）
// 全部不依赖 three。
//
// 该页面是 step2.5 "/engine-demo 路由" 的最小可用版本；后续
// step2.7 完成后会把 /viewer 切到这条路径作对照。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
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
  buildHumanoid,
} from '@/engine';

interface FpsSample {
  fps: number;
  draws: number;
  tris: number;
}

export function EngineDemoPage() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<FpsSample>({ fps: 0, draws: 0, tris: 0 });
  const [preset, setPreset] = useState<'free' | 'iso' | 'top' | 'front'>('free');

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let raf = 0;
    let stop = false;
    let lastTs = performance.now();
    let frames = 0;
    let fpsAcc = 0;

    // ── 引擎装配 ────────────────────────────────────────────────────
    const renderer = new WebGL2Renderer(canvas, { antialias: true });
    renderer.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    renderer.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    const camera = new PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(3, 2.2, 4.2);
    camera.lookAt(0, 0.9, 0);

    const scene = new Scene();
    scene.background = { color: '#000000' };

    // 灯
    const dir = new DirectionalLight(0xfff2d9, 1.0, { x: 4, y: 8, z: 5 });
    dir.castShadow = true;
    const amb = new AmbientLight(0x2e3852, 0.9);
    scene.add(dir);
    scene.add(amb);

    // 地面
    const ground = new Mesh(
      new PlaneGeometry(20, 20),
      (() => {
        const m = new StandardMaterial();
        m.baseColor = { r: 0.05, g: 0.07, b: 0.10 };
        m.metallic = 0.0;
        m.roughness = 0.95;
        m.receiveShadow = true;
        return m;
      })(),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 角色
    const { root, mixer, wave, skinnedMeshes } = buildHumanoid();
    for (const sm of skinnedMeshes) {
      sm.castShadow = true;
      sm.receiveShadow = true;
    }
    scene.add(root);

    // 自动播放 wave 动画
    const action = mixer.actionFor(wave);
    action.play();

    // ── 自研 OrbitControls ─────────────────────────────────────────
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

    // ── resize ─────────────────────────────────────────────────────
    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.resize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // ── render loop ────────────────────────────────────────────────
    const tick = (ts: number) => {
      if (stop) return;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      mixer.update(dt);
      controls.update();
      renderer.render(scene, camera);

      // 状态采样（每 0.5s 更新一次 UI）
      frames++;
      fpsAcc += dt;
      if (fpsAcc >= 0.5) {
        const fps = Math.round(frames / fpsAcc);
        setStats({
          fps,
          draws: renderer.stats.drawCalls,
          tris: renderer.stats.triangles,
        });
        frames = 0;
        fpsAcc = 0;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // 预设按钮：直接覆盖相机位置 + target
  useEffect(() => {
    // 找到上一次 effect 里的相机比较麻烦；改为通过事件让 controls 听
    // 暂不实现：留 hook 给后续 step
    void preset;
  }, [preset]);

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] bg-black">
      <div ref={containerRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block w-full h-full outline-none" tabIndex={0} />
      </div>

      {/* 顶部 HUD */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 flex items-start justify-between gap-3">
        <div className="pointer-events-auto hud-panel px-3 py-2 min-w-0">
          <div className="hud-label text-neon-cyan">{t('engineDemo.title')}</div>
          <div className="font-display text-[12px] tracking-[0.18em] text-haze mt-0.5">
            WEBGL2 · ORBIT · SKINNING
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-mist">
            <span>FPS {stats.fps.toString().padStart(3, '0')}</span>
            <span className="text-neon-cyan/30">·</span>
            <span>DRAW {stats.draws}</span>
            <span className="text-neon-cyan/30">·</span>
            <span>TRI {stats.tris}</span>
          </div>
        </div>

        <div className="pointer-events-auto hud-panel px-3 py-2">
          <div className="hud-label mb-1.5">CAMERA</div>
          <div className="flex items-center gap-1">
            {(['free', 'iso', 'front', 'top'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] transition-colors ${
                  preset === p ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-mist hover:text-haze'
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 左下角控制说明 */}
      <div className="pointer-events-none absolute bottom-3 left-3 hud-panel px-3 py-2 max-w-[260px]">
        <div className="hud-label text-neon-cyan">CONTROLS</div>
        <ul className="mt-1.5 space-y-0.5 text-[10px] font-mono text-mist">
          <li><span className="text-haze">L-DRAG</span> rotate</li>
          <li><span className="text-haze">R-DRAG</span> pan</li>
          <li><span className="text-haze">WHEEL</span> zoom</li>
          <li><span className="text-haze">TOUCH</span> 1f rotate · 2f zoom</li>
        </ul>
      </div>

      {/* 右下角：返回 */}
      <Link
        to="/"
        className="absolute bottom-3 right-3 hud-btn hud-btn-ghost"
        aria-label="back"
      >
        ← HOME
      </Link>
    </div>
  );
}

// Three.js 不在这里出现；为 lint 加一个使用 Group 的地方避免 unused 警告。
void Group;

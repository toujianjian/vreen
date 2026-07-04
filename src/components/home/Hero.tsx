// Hero section with 3D background, big title, CTA buttons, and a live system readout panel.
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Link } from 'react-router-dom';
import { ArrowRight, Crosshair, Zap } from 'lucide-react';
import { BackgroundScene } from '@/components/three/BackgroundScene';
import { HudPanel } from '@/components/hud/HudPanel';
import { useEffect, useState } from 'react';

export function Hero() {
  return (
    <section className="relative min-h-[88vh] w-full overflow-hidden">
      {/* 3D background */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={<div className="w-full h-full bg-space-900" />}>
          <Canvas
            dpr={[1, 1.6]}
            gl={{ antialias: true, alpha: true }}
            camera={{ position: [0, 0, 7], fov: 50 }}
          >
            <fog attach="fog" args={['#05070d', 8, 18]} />
            <BackgroundScene intensity="high" />
          </Canvas>
        </Suspense>
        {/* Vignette overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(5,7,13,0.65)_75%,rgba(5,7,13,0.95)_100%)] pointer-events-none" />
        <div className="absolute inset-0 bg-grid bg-grid-32 opacity-30 mask-fade-b pointer-events-none" />
      </div>

      {/* Foreground content */}
      <div className="relative z-10 max-w-[1600px] mx-auto px-5 pt-20 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center min-h-[88vh]">
        <div className="lg:col-span-8 space-y-8">
          <SystemStatusStrip />
          <div className="space-y-3">
            <h1 className="font-display font-black text-[clamp(2.4rem,7.5vw,7rem)] leading-[0.92] tracking-[0.04em] text-haze">
              <span className="block text-glow-soft text-neon-cyan">VREEN</span>
              <span className="block text-haze/90 text-[clamp(1rem,1.8vw,1.5rem)] tracking-[0.6em] font-mono font-light">
                // 3D DISPLAY SYSTEM
              </span>
            </h1>
            <p className="max-w-2xl text-mist text-[15px] leading-relaxed font-light">
              一座为独立游戏开发者、3D 美术与技术艺术家打造的全息操控台。
              <span className="text-haze/80">在浏览器内即可完成资产检视 · 材质编辑 · 动画播放 · 灯光环境调整 · 高质量出图</span>，
              无需安装任何本地软件。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/viewer/mech-walker"
              className="hud-btn group"
              aria-label="启动检视器"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Launch Inspector</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <a href="#gallery" className="hud-btn hud-btn-ghost">
              <Crosshair className="w-3.5 h-3.5" />
              <span>Browse Assets</span>
            </a>
            <div className="flex items-center gap-2 ml-2 font-mono text-[10px] tracking-[0.2em] text-mist">
              <span className="w-8 h-px bg-neon-cyan/50" />
              <span>SUPPORTS GLB · GLTF · OBJ · FBX · STL · PLY</span>
            </div>
          </div>

          <FeatureRow />
        </div>

        <div className="lg:col-span-4">
          <HeroReadout />
        </div>
      </div>
    </section>
  );
}

function SystemStatusStrip() {
  const items = [
    { label: 'KERNEL', value: 'VREEN-0.1.0', color: 'text-neon-cyan' },
    { label: 'MODE', value: 'INTERACTIVE', color: 'text-neon-magenta' },
    { label: 'PIPELINE', value: 'PBR · IBL · POSTFX', color: 'text-neon-amber' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em]">
      {items.map((it) => (
        <div
          key={it.label}
          className="flex items-center gap-2 px-2.5 py-1 border border-neon-cyan/15 bg-space-800/50 backdrop-blur"
        >
          <span className="text-mist">{it.label}</span>
          <span className={it.color}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function FeatureRow() {
  const features = [
    { kpi: '06', label: 'FORMAT TYPES', sub: 'GLB/GLTF/OBJ/FBX/STL/PLY' },
    { kpi: 'PBR', label: 'REAL-TIME', sub: 'METAL · ROUGH · EMISSIVE' },
    { kpi: '60+', label: 'FPS TARGET', sub: 'BUILT FOR DESKTOP' },
    { kpi: '4K', label: 'CAPTURE', sub: 'PNG EXPORT' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
      {features.map((f) => (
        <div
          key={f.label}
          className="hud-clip hud-panel px-3 py-3 backdrop-blur-md"
        >
          <div className="font-display font-black text-2xl text-neon-cyan text-glow-soft leading-none">
            {f.kpi}
          </div>
          <div className="mt-1.5 font-mono text-[10px] tracking-[0.22em] text-haze">{f.label}</div>
          <div className="mt-0.5 font-mono text-[9px] tracking-[0.18em] text-mist">{f.sub}</div>
        </div>
      ))}
    </div>
  );
}

function HeroReadout() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1200);
    return () => clearInterval(id);
  }, []);

  const lines = [
    { k: 'ASSET_INDEX', v: '6 archetypes loaded' },
    { k: 'ENVIRONMENT', v: 'IBL // city preset' },
    { k: 'POSTFX', v: 'BLOOM · CHROMA · VIGNETTE' },
    { k: 'CAMERA', v: 'iso-30° / damped' },
    { k: 'RENDERER', v: 'WebGL2 · PBR' },
  ];

  return (
    <HudPanel title="SYSTEM READOUT" tag="RUNTIME">
      <div className="p-4 space-y-3 font-mono text-[11px]">
        <div className="flex items-center justify-between text-mist">
          <span>UPLINK</span>
          <span className="flex items-center gap-1.5 text-neon-cyan">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
            ONLINE
          </span>
        </div>
        <div className="hud-divider" />
        <ul className="space-y-1.5">
          {lines.map((l, i) => (
            <li
              key={l.k}
              className="flex items-center justify-between gap-3"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="text-mist uppercase tracking-[0.18em] text-[10px]">{l.k}</span>
              <span
                className={`text-haze text-right ${
                  i === tick % lines.length ? 'text-neon-cyan text-glow-soft' : ''
                }`}
              >
                {l.v}
              </span>
            </li>
          ))}
        </ul>
        <div className="hud-divider" />
        <div className="space-y-1.5">
          <StatBar label="GPU LOAD" value={tick % 4 === 0 ? 38 : 42 + (tick % 3) * 4} max={100} unit="%" color="cyan" />
          <StatBar label="VRAM" value={12 + (tick % 5) * 2} max={64} unit="%" color="magenta" />
          <StatBar label="DRAW" value={184} max={512} unit="CALLS" color="amber" />
        </div>
        <div className="hud-divider" />
        <div className="text-[9px] tracking-[0.2em] text-mist/80">
          SESSION 0xA1F3 · CHANNEL 04 · NODE VREEN-LOCAL
        </div>
      </div>
    </HudPanel>
  );
}

function StatBar({
  label,
  value,
  max,
  unit,
  color = 'cyan',
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  color?: 'cyan' | 'magenta' | 'amber';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colorMap = {
    cyan: 'bg-neon-cyan shadow-glow',
    magenta: 'bg-neon-magenta shadow-glow-magenta',
    amber: 'bg-neon-amber shadow-glow-amber',
  };
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] tracking-[0.18em]">
        <span className="text-mist">{label}</span>
        <span className="text-haze tabular-nums">
          {value}
          <span className="text-mist ml-1">{unit}</span>
        </span>
      </div>
      <div className="mt-1 h-1 bg-space-700 overflow-hidden">
        <div
          className={`h-full ${colorMap[color]} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

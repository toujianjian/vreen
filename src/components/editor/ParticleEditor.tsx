// ParticleEditor — 粒子编辑器面板。
// 实时预览 (Canvas 2D 粒子模拟)+ 发射器/粒子/物理参数调节 +
// 大小/颜色曲线编辑 + 预设选择。赛博朋克风格(霓虹色 + 暗色背景),
// 复用 HudPanel / ColorField 框架。

import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Ghost,
  RotateCcw,
  Sparkles,
  Wind,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { ColorField } from '@/components/viewer/ColorField';
import { cn } from '@/lib/cn';

// ── 类型 ──────────────────────────────────────────────────

/** RGBA 颜色 (0..1)。 */
export interface ParticleRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 三维向量。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 发射形状。 */
export type EmissionShape = 'point' | 'sphere' | 'box' | 'cone' | 'circle';

/** 粒子配置。 */
export interface ParticleConfig {
  emissionShape: EmissionShape;
  emissionRate: number;
  maxParticles: number;
  lifetime: number;
  startSpeed: number;
  startSize: number;
  endSize: number;
  startColor: ParticleRGBA;
  endColor: ParticleRGBA;
  gravity: Vec3;
  drag: number;
  /** 大小曲线 (0..1 关键帧值数组,均匀分布 0..lifetime)。 */
  sizeCurve: number[];
  /** 颜色曲线 (0..1 关键帧值数组,控制 startColor→endColor 的进度)。 */
  colorCurve: number[];
}

interface ParticleEditorProps {
  config: ParticleConfig;
  onUpdate: (property: string, value: unknown) => void;
  onPresetSelect: (preset: string) => void;
  /** 重置回调 (可选;不传则隐藏重置按钮)。 */
  onReset?: () => void;
}

// ── 常量 ──────────────────────────────────────────────────

const EMISSION_SHAPES: EmissionShape[] = ['point', 'sphere', 'box', 'cone', 'circle'];

/** 粒子预设。 */
const PARTICLE_PRESETS = [
  { key: 'fire', label: 'Fire' },
  { key: 'smoke', label: 'Smoke' },
  { key: 'spark', label: 'Spark' },
  { key: 'magic', label: 'Magic' },
  { key: 'explosion', label: 'Explosion' },
  { key: 'rain', label: 'Rain' },
] as const;

// ── 颜色工具 ──────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rgbaToHex({ r, g, b }: ParticleRGBA): string {
  const c = (v: number) =>
    clamp01(v).toString(16).padStart(2, '0').slice(-2);
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRGBA(hex: string, a: number): ParticleRGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0.5, g: 0.5, b: 0.5, a };
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
    a,
  };
}

/** 采样曲线 (关键帧值数组,均匀分布;idx 越界钳位)。 */
function sampleCurve(curve: number[], t: number): number {
  if (curve.length === 0) return t;
  if (curve.length === 1) return curve[0];
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (curve.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(curve.length - 1, i0 + 1);
  const f = idx - i0;
  return curve[i0] * (1 - f) + curve[i1] * f;
}

// ── 主组件 ────────────────────────────────────────────────

export function ParticleEditor({
  config,
  onUpdate,
  onPresetSelect,
  onReset,
}: ParticleEditorProps) {
  const { t } = useTranslation();

  return (
    <HudPanel
      title={t('particleEditor.title')}
      tag="PARTICLE"
      variant="magenta"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 flex flex-col"
    >
      {/* 顶部工具栏 */}
      <Toolbar onPresetSelect={onPresetSelect} onReset={onReset} />

      {/* 主区域:左参数 + 右预览 */}
      <div className="flex-1 min-h-0 flex">
        {/* 左侧参数面板 */}
        <div className="w-[260px] shrink-0 border-r border-neon-magenta/15 overflow-y-auto">
          <EmitterSection config={config} onUpdate={onUpdate} />
          <ParticleSection config={config} onUpdate={onUpdate} />
          <PhysicsSection config={config} onUpdate={onUpdate} />
        </div>

        {/* 右侧预览 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <PreviewCanvas config={config} />
          <CurveEditors config={config} onUpdate={onUpdate} />
        </div>
      </div>
    </HudPanel>
  );
}

// ── 顶部工具栏 ────────────────────────────────────────────

function Toolbar({
  onPresetSelect,
  onReset,
}: {
  onPresetSelect: (preset: string) => void;
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 px-3 py-2 border-b border-neon-magenta/15 flex items-center gap-2 bg-space-900/40">
      <Sparkles className="w-3.5 h-3.5 text-neon-magenta" />
      <span className="font-display text-[10px] tracking-[0.2em] text-haze uppercase">
        {t('particleEditor.presets')}
      </span>
      <div className="ml-1 flex items-center gap-1 flex-wrap">
        {PARTICLE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPresetSelect(p.key)}
            className="px-1.5 py-0.5 text-[9px] font-mono border border-neon-magenta/20 text-mist hover:border-neon-magenta hover:text-neon-magenta hover:bg-neon-magenta/5 tracking-[0.1em] uppercase transition-colors"
            title={p.label}
          >
            {p.label}
          </button>
        ))}
      </div>
      {onReset && (
        <button
          onClick={onReset}
          className="ml-auto hud-btn !px-2 !py-1"
          title={t('particleEditor.reset')}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── 通用滑块 ──────────────────────────────────────────────

function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="hud-label mb-1 flex justify-between">
        <span>{label}</span>
        <span className="text-neon-cyan tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="hud-range"
      />
    </div>
  );
}

// ── 段容器 ────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-neon-magenta/10">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neon-magenta/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-magenta" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-magenta" />
        )}
        <span className="text-neon-magenta/80">{icon}</span>
        <span className="font-display text-[10px] tracking-[0.2em] text-haze uppercase">
          {title}
        </span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2.5">{children}</div>}
    </div>
  );
}

// ── 发射器段 ──────────────────────────────────────────────

function EmitterSection({
  config,
  onUpdate,
}: {
  config: ParticleConfig;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t('particleEditor.emitter')} icon={<CircleDot className="w-3 h-3" />}>
      {/* 发射形状 */}
      <div>
        <div className="hud-label mb-1">{t('particleEditor.emissionShape')}</div>
        <div className="grid grid-cols-5 gap-1">
          {EMISSION_SHAPES.map((s) => (
            <button
              key={s}
              onClick={() => onUpdate('emissionShape', s)}
              className={cn(
                'px-0.5 py-1 text-[8px] font-mono border tracking-[0.08em] uppercase transition-colors',
                s === config.emissionShape
                  ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
                  : 'border-neon-cyan/15 text-mist hover:border-neon-cyan hover:text-neon-cyan',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <Slider
        label={t('particleEditor.emissionRate')}
        value={config.emissionRate}
        min={0}
        max={500}
        step={1}
        onChange={(v) => onUpdate('emissionRate', v)}
      />
      <Slider
        label={t('particleEditor.maxParticles')}
        value={config.maxParticles}
        min={1}
        max={5000}
        step={1}
        onChange={(v) => onUpdate('maxParticles', Math.round(v))}
      />
      <Slider
        label={t('particleEditor.lifetime')}
        value={config.lifetime}
        min={0.1}
        max={10}
        step={0.1}
        onChange={(v) => onUpdate('lifetime', v)}
      />
      <Slider
        label={t('particleEditor.startSpeed')}
        value={config.startSpeed}
        min={0}
        max={20}
        step={0.1}
        onChange={(v) => onUpdate('startSpeed', v)}
      />
    </Section>
  );
}

// ── 粒子段 ────────────────────────────────────────────────

function ParticleSection({
  config,
  onUpdate,
}: {
  config: ParticleConfig;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t('particleEditor.particle')} icon={<Sparkles className="w-3 h-3" />}>
      <Slider
        label={t('particleEditor.startSize')}
        value={config.startSize}
        min={0.1}
        max={20}
        step={0.1}
        onChange={(v) => onUpdate('startSize', v)}
      />
      <Slider
        label={t('particleEditor.endSize')}
        value={config.endSize}
        min={0.1}
        max={20}
        step={0.1}
        onChange={(v) => onUpdate('endSize', v)}
      />
      {/* 起始颜色 */}
      <div>
        <div className="hud-label mb-1">{t('particleEditor.startColor')}</div>
        <ColorField
          value={rgbaToHex(config.startColor)}
          onChange={(h) => onUpdate('startColor', hexToRGBA(h, config.startColor.a))}
        />
        <div className="mt-1.5">
          <div className="hud-label mb-1 flex justify-between">
            <span>α</span>
            <span className="text-neon-cyan tabular-nums">{config.startColor.a.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={config.startColor.a}
            onChange={(e) =>
              onUpdate('startColor', { ...config.startColor, a: parseFloat(e.target.value) })
            }
            className="hud-range"
          />
        </div>
      </div>
      {/* 结束颜色 */}
      <div>
        <div className="hud-label mb-1">{t('particleEditor.endColor')}</div>
        <ColorField
          value={rgbaToHex(config.endColor)}
          onChange={(h) => onUpdate('endColor', hexToRGBA(h, config.endColor.a))}
        />
        <div className="mt-1.5">
          <div className="hud-label mb-1 flex justify-between">
            <span>α</span>
            <span className="text-neon-cyan tabular-nums">{config.endColor.a.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={config.endColor.a}
            onChange={(e) =>
              onUpdate('endColor', { ...config.endColor, a: parseFloat(e.target.value) })
            }
            className="hud-range"
          />
        </div>
      </div>
    </Section>
  );
}

// ── 物理段 ────────────────────────────────────────────────

function PhysicsSection({
  config,
  onUpdate,
}: {
  config: ParticleConfig;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t('particleEditor.physics')} icon={<Wind className="w-3 h-3" />}>
      {/* 重力三轴 */}
      <div>
        <div className="hud-label mb-1">{t('particleEditor.gravity')}</div>
        <div className="space-y-1.5">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-neon-cyan/70 w-3 uppercase">{axis}</span>
              <input
                type="range"
                min={-20}
                max={20}
                step={0.1}
                value={config.gravity[axis]}
                onChange={(e) =>
                  onUpdate('gravity', { ...config.gravity, [axis]: parseFloat(e.target.value) })
                }
                className="hud-range flex-1"
              />
              <span className="font-mono text-[9px] text-haze/70 w-8 text-right tabular-nums">
                {config.gravity[axis].toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <Slider
        label={t('particleEditor.drag')}
        value={config.drag}
        min={0}
        max={5}
        step={0.05}
        onChange={(v) => onUpdate('drag', v)}
      />
    </Section>
  );
}

// ── 预览画布 (Canvas 2D 粒子模拟) ─────────────────────────

interface PreviewParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

function PreviewCanvas({ config }: { config: ParticleConfig }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<PreviewParticle[]>([]);
  const emitAccumRef = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;
  const [dims, setDims] = useState({ w: 320, h: 240 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const spawnAt = (px: number, py: number, cfg: ParticleConfig) => {
      const angle = Math.random() * Math.PI * 2;
      // 形状影响初始位置散布
      let ox = 0, oy = 0;
      const r = 12;
      switch (cfg.emissionShape) {
        case 'sphere':
        case 'circle':
          ox = Math.cos(angle) * r * Math.random();
          oy = Math.sin(angle) * r * Math.random();
          break;
        case 'box':
          ox = (Math.random() - 0.5) * r * 2;
          oy = (Math.random() - 0.5) * r * 2;
          break;
        case 'cone':
          ox = Math.cos(angle) * r * Math.random() * 0.5;
          oy = 0;
          break;
        case 'point':
        default:
          break;
      }
      const speed = cfg.startSpeed * (0.6 + Math.random() * 0.8);
      // cone 向上发射;其他各向
      const dirX = cfg.emissionShape === 'cone' ? (Math.random() - 0.5) * 0.6 : Math.cos(angle);
      const dirY = cfg.emissionShape === 'cone' ? -1 : Math.sin(angle);
      particlesRef.current.push({
        x: px + ox,
        y: py + oy,
        vx: dirX * speed * 20,
        vy: dirY * speed * 20,
        age: 0,
        life: cfg.lifetime * (0.7 + Math.random() * 0.6),
      });
    };

    const step = (dt: number) => {
      const cfg = configRef.current;
      const ps = particlesRef.current;
      // 发射
      emitAccumRef.current += cfg.emissionRate * dt;
      const cx = dims.w / 2;
      const cy = dims.h / 2;
      while (emitAccumRef.current >= 1 && ps.length < cfg.maxParticles) {
        emitAccumRef.current -= 1;
        spawnAt(cx, cy, cfg);
      }
      // 更新
      const dragFactor = Math.max(0, 1 - cfg.drag * dt);
      const gx = cfg.gravity.x * 30 * dt;
      const gy = cfg.gravity.y * 30 * dt;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.age += dt;
        if (p.age >= p.life) {
          ps.splice(i, 1);
          continue;
        }
        p.vx = (p.vx + gx) * dragFactor;
        p.vy = (p.vy + gy) * dragFactor;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cfg = configRef.current;
      const ps = particlesRef.current;
      const w = canvas.width;
      const h = canvas.height;

      // 拖影背景
      ctx.fillStyle = 'rgba(10,14,26,0.25)';
      ctx.fillRect(0, 0, w, h);

      // 网格
      ctx.strokeStyle = 'rgba(0,240,255,0.05)';
      ctx.lineWidth = 1;
      const grid = 24;
      for (let x = 0; x < w; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 发射器标记
      const cx = w / 2;
      const cy = h / 2;
      ctx.strokeStyle = 'rgba(255,43,214,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.stroke();

      // 粒子
      ctx.globalCompositeOperation = 'lighter';
      for (const p of ps) {
        const t = p.age / p.life;
        const sizeT = sampleCurve(cfg.sizeCurve, t);
        const colorT = sampleCurve(cfg.colorCurve, t);
        // size: 在 startSize/endSize 之间用 sizeCurve 进度插值
        const size = cfg.startSize + (cfg.endSize - cfg.startSize) * sizeT;
        // color: colorCurve 控制 start→end 混合进度
        const r = cfg.startColor.r + (cfg.endColor.r - cfg.startColor.r) * colorT;
        const g = cfg.startColor.g + (cfg.endColor.g - cfg.startColor.g) * colorT;
        const b = cfg.startColor.b + (cfg.endColor.b - cfg.startColor.b) * colorT;
        const a = (cfg.startColor.a + (cfg.endColor.a - cfg.startColor.a) * colorT) * (1 - t * 0.3);
        const radius = Math.max(0.5, size * 1.5);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        grad.addColorStop(
          0,
          `rgba(${Math.round(clamp01(r) * 255)},${Math.round(clamp01(g) * 255)},${Math.round(clamp01(b) * 255)},${clamp01(a).toFixed(3)})`,
        );
        grad.addColorStop(1, `rgba(${Math.round(clamp01(r) * 255)},${Math.round(clamp01(g) * 255)},${Math.round(clamp01(b) * 255)},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dims]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-neon-magenta/10">
        <Ghost className="w-3 h-3 text-neon-magenta" />
        <span className="font-display text-[10px] tracking-[0.2em] text-haze uppercase">
          {t('particleEditor.preview')}
        </span>
        <span className="ml-auto font-mono text-[9px] text-mist/60 tracking-[0.14em] uppercase">
          {config.emissionShape}
        </span>
      </div>
      <div ref={wrapRef} className="flex-1 min-h-[160px] relative bg-space-900/60">
        <canvas
          ref={canvasRef}
          width={dims.w}
          height={dims.h}
          className="w-full h-full block"
        />
        {/* 角标 */}
        <span className="absolute top-1 left-1 font-mono text-[8px] text-neon-cyan/40 tracking-[0.14em] uppercase pointer-events-none">
          SIM
        </span>
      </div>
    </div>
  );
}

// ── 曲线编辑器 (大小 + 颜色) ──────────────────────────────

function CurveEditors({
  config,
  onUpdate,
}: {
  config: ParticleConfig;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-t border-neon-magenta/15 grid grid-cols-2">
      <CurveEditor
        label={t('particleEditor.sizeCurve')}
        color="#00f0ff"
        values={config.sizeCurve}
        onChange={(v) => onUpdate('sizeCurve', v)}
      />
      <CurveEditor
        label={t('particleEditor.colorCurve')}
        color="#ff2bd6"
        values={config.colorCurve}
        onChange={(v) => onUpdate('colorCurve', v)}
      />
    </div>
  );
}

function CurveEditor({
  label,
  color,
  values,
  onChange,
}: {
  label: string;
  color: string;
  values: number[];
  onChange: (values: number[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 160, h: 80 });
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 6, r: 6, t: 6, b: 14 };
  const plotW = Math.max(0, size.w - pad.l - pad.r);
  const plotH = Math.max(0, size.h - pad.t - pad.b);

  const xAt = (i: number) =>
    pad.l + (values.length <= 1 ? 0 : (i / (values.length - 1)) * plotW);
  const yAt = (v: number) => pad.t + (1 - Math.max(0, Math.min(1, v))) * plotH;

  useEffect(() => {
    if (dragIdx === null) return;
    const onMove = (e: MouseEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const norm = 1 - (y - pad.t) / plotH;
      const next = [...values];
      next[dragIdx] = Math.max(0, Math.min(1, norm));
      onChange(next);
    };
    const onUp = () => setDragIdx(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragIdx, values, plotH, onChange]);

  // 路径
  let path = '';
  if (values.length > 0) {
    path = `M ${xAt(0)} ${yAt(values[0])}`;
    for (let i = 1; i < values.length; i++) {
      path += ` L ${xAt(i)} ${yAt(values[i])}`;
    }
  }

  // 添加/删除关键帧
  const addPoint = () => {
    if (values.length >= 16) return;
    onChange([...values, 0.5]);
  };
  const removeLast = () => {
    if (values.length <= 2) return;
    onChange(values.slice(0, -1));
  };

  return (
    <div className="border-r border-neon-magenta/10 last:border-r-0">
      <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-neon-magenta/10">
        <span className="w-2 h-2" style={{ backgroundColor: color }} />
        <span className="font-display text-[9px] tracking-[0.16em] text-haze uppercase truncate flex-1">
          {label}
        </span>
        <button
          onClick={addPoint}
          className="text-mist/60 hover:text-neon-cyan text-[10px] font-mono leading-none"
          title="+"
        >
          +
        </button>
        <button
          onClick={removeLast}
          className="text-mist/60 hover:text-neon-magenta text-[10px] font-mono leading-none"
          title="-"
        >
          −
        </button>
        <span className="font-mono text-[8px] text-mist/60 tabular-nums">{values.length}</span>
      </div>
      <div className="bg-space-900/30" style={{ height: 90 }}>
        <svg ref={svgRef} className="w-full h-full">
          {/* 网格 */}
          {[0, 0.5, 1].map((g) => (
            <line
              key={`h${g}`}
              x1={pad.l}
              x2={size.w - pad.r}
              y1={pad.t + g * plotH}
              y2={pad.t + g * plotH}
              stroke="rgba(0,240,255,0.08)"
              strokeWidth={1}
            />
          ))}
          {/* 曲线 */}
          {path && <path d={path} fill="none" stroke={color} strokeWidth={1.5} />}
          {/* 点 */}
          {values.map((v, i) => (
            <circle
              key={i}
              cx={xAt(i)}
              cy={yAt(v)}
              r={3}
              fill={dragIdx === i ? color : '#0a0e1a'}
              stroke={color}
              strokeWidth={1.5}
              style={{ cursor: 'ns-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setDragIdx(i);
              }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

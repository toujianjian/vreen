// MaterialEditor — 材质编辑器面板。
// 编辑材质属性(颜色 / PBR / 发光 / 法线 / Alpha / 双面)、纹理槽位管理、
// 材质预设选择、着色器模式切换、实时预览球(Canvas 2D 近似渲染)。
// 赛博朋克风格(霓虹色 + 暗色背景),复用 HudPanel / ColorField 框架。

import {
  ChevronDown,
  ChevronRight,
  Circle,
  Globe,
  ImageIcon,
  Palette,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { ColorField } from '@/components/viewer/ColorField';
import { cn } from '@/lib/cn';

// ── 类型 ──────────────────────────────────────────────────

/** RGBA 颜色 (0..1 归一化)。 */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** RGB 颜色 (0..1 归一化)。 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 着色器模式:5 种内置。 */
export type ShaderMode = 'standard' | 'pbr' | 'toon' | 'wireframe' | 'unlit';

/** Alpha 模式。 */
export type AlphaMode = 'opaque' | 'mask' | 'blend';

/** 材质数据(与引擎 StandardMaterial / MeshPhysicalMaterial 对齐)。 */
export interface MaterialData {
  name: string;
  shaderMode: ShaderMode;
  baseColor: RGBA;
  roughness: number;
  metallic: number;
  emissive: RGB;
  emissiveIntensity: number;
  normalScale: number;
  aoStrength: number;
  alphaMode: AlphaMode;
  alphaCutoff: number;
  doubleSided: boolean;
  /** 纹理槽位:slot → textureId (null = 未分配)。 */
  textures: Record<string, string | null>;
}

interface MaterialEditorProps {
  /** 当前编辑的材质;null 显示空状态。 */
  material: MaterialData | null;
  /** 属性更新回调 (property 路径如 'roughness' / 'baseColor.r' / 'textures.albedo')。 */
  onUpdate: (property: string, value: unknown) => void;
  /** 分配纹理到槽位。 */
  onTextureAssign: (slot: string, textureId: string) => void;
  /** 移除槽位纹理。 */
  onTextureRemove: (slot: string) => void;
  /** 选择材质预设。 */
  onPresetSelect: (preset: string) => void;
  /** 切换着色器模式。 */
  onShaderModeChange: (mode: ShaderMode) => void;
}

// ── 常量 ──────────────────────────────────────────────────

/** 6 个标准纹理槽位。 */
const TEXTURE_SLOTS = [
  { key: 'albedo', label: 'Albedo' },
  { key: 'normal', label: 'Normal' },
  { key: 'roughness', label: 'Roughness' },
  { key: 'metallic', label: 'Metallic' },
  { key: 'emissive', label: 'Emissive' },
  { key: 'ao', label: 'AO' },
] as const;

/** 5 种着色器模式。 */
const SHADER_MODES: ShaderMode[] = ['standard', 'pbr', 'toon', 'wireframe', 'unlit'];

/** 材质预设。 */
const MATERIAL_PRESETS = [
  { key: 'metal', label: 'Metal' },
  { key: 'plastic', label: 'Plastic' },
  { key: 'glass', label: 'Glass' },
  { key: 'wood', label: 'Wood' },
  { key: 'stone', label: 'Stone' },
  { key: 'fabric', label: 'Fabric' },
  { key: 'emissive', label: 'Emissive' },
  { key: 'skin', label: 'Skin' },
] as const;

/** Alpha 模式。 */
const ALPHA_MODES: AlphaMode[] = ['opaque', 'mask', 'blend'];

// ── 颜色工具 ──────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) =>
    clamp(v).toString(16).padStart(2, '0').slice(-2);
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbaToHex({ r, g, b }: RGBA): string {
  return rgbToHex({ r, g, b });
}

function hexToRGB(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0.5, g: 0.5, b: 0.5 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

// ── 主组件 ────────────────────────────────────────────────

export function MaterialEditor({
  material,
  onUpdate,
  onTextureAssign,
  onTextureRemove,
  onPresetSelect,
  onShaderModeChange,
}: MaterialEditorProps) {
  const { t } = useTranslation();

  if (!material) {
    return (
      <HudPanel
        title={t('materialEditor.title')}
        tag="MATERIAL"
        className="h-full flex flex-col"
        bodyClassName="flex-1 min-h-0"
      >
        <div className="px-4 py-6 text-mist text-center text-[11px] font-mono">
          {t('materialEditor.noMaterial')}
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel
      title={t('materialEditor.title')}
      tag="MATERIAL"
      variant="magenta"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 overflow-y-auto"
    >
      {/* 名称 + 预览球 */}
      <div className="shrink-0 px-4 py-3 border-b border-neon-magenta/15 flex items-center gap-3">
        <PreviewSphere material={material} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-magenta-300/90">
            <Palette className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase">
              {t('materialEditor.title')}
            </span>
          </div>
          <input
            type="text"
            value={material.name}
            onChange={(e) => onUpdate('name', e.target.value)}
            className="mt-1.5 w-full bg-space-900/40 border border-neon-magenta/20 px-2 py-1 font-display text-[13px] tracking-[0.14em] text-haze focus:border-neon-magenta focus:outline-none"
          />
        </div>
      </div>

      {/* Shader Mode */}
      <ShaderModeSection
        mode={material.shaderMode}
        onChange={onShaderModeChange}
      />

      {/* 基础颜色 */}
      <ColorSection
        label={t('materialEditor.baseColor')}
        value={material.baseColor}
        onChange={(c) => onUpdate('baseColor', c)}
      />

      {/* PBR 属性 */}
      <PBRSection
        roughness={material.roughness}
        metallic={material.metallic}
        onUpdate={onUpdate}
      />

      {/* 发光 */}
      <EmissiveSection
        emissive={material.emissive}
        intensity={material.emissiveIntensity}
        onUpdate={onUpdate}
      />

      {/* 法线 / AO */}
      <NormalAOSection
        normalScale={material.normalScale}
        aoStrength={material.aoStrength}
        onUpdate={onUpdate}
      />

      {/* Alpha 模式 */}
      <AlphaSection
        alphaMode={material.alphaMode}
        alphaCutoff={material.alphaCutoff}
        doubleSided={material.doubleSided}
        onUpdate={onUpdate}
      />

      {/* 纹理槽位 */}
      <TextureSlotsSection
        textures={material.textures}
        onAssign={onTextureAssign}
        onRemove={onTextureRemove}
      />

      {/* 预设 */}
      <PresetSection onSelect={onPresetSelect} />
    </HudPanel>
  );
}

// ── 预览球 (Canvas 2D 近似渲染) ───────────────────────────

function PreviewSphere({ material }: { material: MaterialData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 4;

    const { baseColor, roughness, metallic, emissive, emissiveIntensity, shaderMode } = material;

    // 背景圆 (深色)
    ctx.fillStyle = '#0a0e1a';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 球体主色:基于 baseColor 与 metallic 混合
    const baseR = Math.round(baseColor.r * 255);
    const baseG = Math.round(baseColor.g * 255);
    const baseB = Math.round(baseColor.b * 255);

    // 高光强度:金属度高 + 粗糙度低 → 高光锐利
    const specularSharpness = clamp(metallic * (1 - roughness) + (1 - roughness) * 0.4);
    const highlightSize = Math.max(4, radius * (0.15 + roughness * 0.5));

    // 主渐变:左上亮 → 右下暗
    const grad = ctx.createRadialGradient(
      cx - radius * 0.4,
      cy - radius * 0.4,
      radius * 0.1,
      cx,
      cy,
      radius,
    );
    const lightR = Math.min(255, baseR + 60);
    const lightG = Math.min(255, baseG + 60);
    const lightB = Math.min(255, baseB + 60);
    const darkR = Math.round(baseR * 0.3);
    const darkG = Math.round(baseG * 0.3);
    const darkB = Math.round(baseB * 0.3);
    grad.addColorStop(0, `rgb(${lightR},${lightG},${lightB})`);
    grad.addColorStop(0.6, `rgb(${baseR},${baseG},${baseB})`);
    grad.addColorStop(1, `rgb(${darkR},${darkG},${darkB})`);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // 高光斑
    if (shaderMode !== 'unlit' && shaderMode !== 'wireframe') {
      const hg = ctx.createRadialGradient(
        cx - radius * 0.35,
        cy - radius * 0.35,
        0,
        cx - radius * 0.35,
        cy - radius * 0.35,
        highlightSize,
      );
      const hl = Math.round(255 * specularSharpness);
      hg.addColorStop(0, `rgba(255,255,255,${specularSharpness})`);
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      void hl;
    }

    // 发光叠加
    if (emissiveIntensity > 0) {
      const eR = Math.round(emissive.r * 255);
      const eG = Math.round(emissive.g * 255);
      const eB = Math.round(emissive.b * 255);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(emissiveIntensity * 0.6);
      ctx.fillStyle = `rgb(${eR},${eG},${eB})`;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();

    // 线框模式:在球上叠加经纬线
    if (shaderMode === 'wireframe') {
      ctx.strokeStyle = `rgb(${lightR},${lightG},${lightB})`;
      ctx.lineWidth = 0.6;
      ctx.globalAlpha = 0.8;
      // 经线
      for (let i = -3; i <= 3; i++) {
        const offset = (i / 4) * radius;
        const w2 = Math.sqrt(Math.max(0, radius * radius - offset * offset));
        ctx.beginPath();
        ctx.ellipse(cx, cy, w2, radius, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 纬线
      for (let i = -3; i <= 3; i++) {
        const y = cy + (i / 4) * radius;
        const r2 = Math.sqrt(Math.max(0, radius * radius - ((i / 4) * radius) ** 2));
        ctx.beginPath();
        ctx.ellipse(cx, y, r2, r2 * 0.25, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Toon 模式:量化色带描边
    if (shaderMode === 'toon') {
      ctx.strokeStyle = '#0a0e1a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 描边
    ctx.strokeStyle = 'rgba(255,43,214,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }, [material]);

  return (
    <div className="shrink-0 relative">
      <canvas
        ref={canvasRef}
        width={72}
        height={72}
        className="border border-neon-magenta/20 bg-space-900/60"
      />
      <Globe className="absolute -top-1 -right-1 w-3 h-3 text-neon-magenta/60" />
    </div>
  );
}

// ── Shader Mode 选择器 ────────────────────────────────────

function ShaderModeSection({
  mode,
  onChange,
}: {
  mode: ShaderMode;
  onChange: (mode: ShaderMode) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {t('materialEditor.shaderMode')}
        </span>
        <span className="ml-auto font-mono text-[10px] text-neon-magenta tracking-[0.16em] uppercase">
          {mode}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 grid grid-cols-5 gap-1">
          {SHADER_MODES.map((m) => (
            <button
              key={m}
              onClick={() => onChange(m)}
              className={cn(
                'px-1 py-1 text-[9px] font-mono border tracking-[0.12em] uppercase transition-colors',
                m === mode
                  ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
                  : 'border-neon-cyan/15 text-mist hover:border-neon-cyan hover:text-neon-cyan',
              )}
              title={m}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 颜色段 (基础颜色 / 发光颜色) ─────────────────────────

function ColorSection({
  label,
  value,
  onChange,
}: {
  label: string;
  value: RGBA;
  onChange: (c: RGBA) => void;
}) {
  const [open, setOpen] = useState(true);
  const hex = rgbaToHex(value);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {label}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          <ColorField
            value={hex}
            onChange={(h) => onChange({ ...hexToRGB(h), a: value.a })}
          />
          <AlphaSlider
            value={value.a}
            onChange={(a) => onChange({ ...value, a })}
          />
        </div>
      )}
    </div>
  );
}

function AlphaSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (a: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="hud-label mb-1 flex justify-between">
        <span>{t('materialEditor.alpha')}</span>
        <span className="text-neon-cyan">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="hud-range"
      />
    </div>
  );
}

// ── PBR 段 (粗糙度 / 金属度) ─────────────────────────────

function PBRSection({
  roughness,
  metallic,
  onUpdate,
}: {
  roughness: number;
  metallic: number;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          PBR
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3">
          <Slider
            label={t('materialEditor.roughness')}
            value={roughness}
            onChange={(v) => onUpdate('roughness', v)}
          />
          <Slider
            label={t('materialEditor.metallic')}
            value={metallic}
            onChange={(v) => onUpdate('metallic', v)}
          />
        </div>
      )}
    </div>
  );
}

// ── 发光段 ────────────────────────────────────────────────

function EmissiveSection({
  emissive,
  intensity,
  onUpdate,
}: {
  emissive: RGB;
  intensity: number;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hex = rgbToHex(emissive);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {t('materialEditor.emissive')}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3">
          <ColorField
            value={hex}
            onChange={(h) => onUpdate('emissive', hexToRGB(h))}
          />
          <Slider
            label={t('materialEditor.emissiveIntensity')}
            value={intensity}
            min={0}
            max={4}
            step={0.05}
            onChange={(v) => onUpdate('emissiveIntensity', v)}
          />
        </div>
      )}
    </div>
  );
}

// ── 法线 / AO 段 ─────────────────────────────────────────

function NormalAOSection({
  normalScale,
  aoStrength,
  onUpdate,
}: {
  normalScale: number;
  aoStrength: number;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {t('materialEditor.normalAO')}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3">
          <Slider
            label={t('materialEditor.normalScale')}
            value={normalScale}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => onUpdate('normalScale', v)}
          />
          <Slider
            label={t('materialEditor.aoStrength')}
            value={aoStrength}
            onChange={(v) => onUpdate('aoStrength', v)}
          />
        </div>
      )}
    </div>
  );
}

// ── Alpha 段 ──────────────────────────────────────────────

function AlphaSection({
  alphaMode,
  alphaCutoff,
  doubleSided,
  onUpdate,
}: {
  alphaMode: AlphaMode;
  alphaCutoff: number;
  doubleSided: boolean;
  onUpdate: (property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {t('materialEditor.alphaMode')}
        </span>
        <span className="ml-auto font-mono text-[10px] text-neon-cyan tracking-[0.16em] uppercase">
          {alphaMode}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3">
          <div className="grid grid-cols-3 gap-1">
            {ALPHA_MODES.map((m) => (
              <button
                key={m}
                onClick={() => onUpdate('alphaMode', m)}
                className={cn(
                  'px-1 py-1 text-[9px] font-mono border tracking-[0.12em] uppercase transition-colors',
                  m === alphaMode
                    ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                    : 'border-neon-cyan/15 text-mist hover:border-neon-cyan hover:text-neon-cyan',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {alphaMode === 'mask' && (
            <Slider
              label={t('materialEditor.alphaCutoff')}
              value={alphaCutoff}
              onChange={(v) => onUpdate('alphaCutoff', v)}
            />
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              type="button"
              onClick={() => onUpdate('doubleSided', !doubleSided)}
              className={cn(
                'px-2 py-0.5 text-[9px] font-mono border tracking-[0.16em] transition-colors',
                doubleSided
                  ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                  : 'border-neon-cyan/20 text-mist',
              )}
            >
              {doubleSided ? 'ON' : 'OFF'}
            </button>
            <span className="font-mono text-[10px] text-haze/80 tracking-[0.12em] uppercase">
              {t('materialEditor.doubleSided')}
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

// ── 纹理槽位段 ────────────────────────────────────────────

function TextureSlotsSection({
  textures,
  onAssign,
  onRemove,
}: {
  textures: Record<string, string | null>;
  onAssign: (slot: string, textureId: string) => void;
  onRemove: (slot: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {t('materialEditor.textures')}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          {TEXTURE_SLOTS.map((slot) => {
            const texId = textures[slot.key] ?? null;
            return (
              <TextureSlot
                key={slot.key}
                slotKey={slot.key}
                label={slot.label}
                textureId={texId}
                onAssign={onAssign}
                onRemove={onRemove}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TextureSlot({
  slotKey,
  label,
  textureId,
  onAssign,
  onRemove,
}: {
  slotKey: string;
  label: string;
  textureId: string | null;
  onAssign: (slot: string, textureId: string) => void;
  onRemove: (slot: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startAssign = () => {
    setEditing(true);
    setDraft(textureId ?? '');
  };

  const commitAssign = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      onAssign(slotKey, trimmed);
    }
    setEditing(false);
    setDraft('');
  };

  return (
    <div className="border border-neon-cyan/15 bg-space-900/40 p-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <ImageIcon className="w-3 h-3 text-neon-cyan/70 shrink-0" />
        <span className="font-mono text-[10px] text-haze/80 tracking-[0.12em] uppercase truncate flex-1">
          {label}
        </span>
        {textureId && (
          <button
            onClick={() => onRemove(slotKey)}
            className="text-mist hover:text-neon-magenta shrink-0"
            title={t('materialEditor.removeTexture')}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitAssign}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitAssign();
            if (e.key === 'Escape') {
              setEditing(false);
              setDraft('');
            }
          }}
          placeholder={t('materialEditor.textureIdPlaceholder')}
          className="w-full bg-space-900/60 border border-neon-cyan/40 px-1.5 py-0.5 text-[10px] font-mono text-neon-cyan focus:border-neon-cyan focus:outline-none"
        />
      ) : (
        <button
          onClick={startAssign}
          className={cn(
            'w-full flex items-center gap-1 px-1.5 py-1 border text-[9px] font-mono tracking-[0.1em] transition-colors',
            textureId
              ? 'border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan'
              : 'border-neon-cyan/10 text-mist hover:border-neon-cyan/40 hover:text-haze',
          )}
        >
          {textureId ? (
            <>
              <Circle className="w-2 h-2 fill-current shrink-0" />
              <span className="truncate flex-1 text-left">{textureId}</span>
            </>
          ) : (
            <span className="flex-1 text-left uppercase">+ {t('materialEditor.assignTexture')}</span>
          )}
        </button>
      )}
    </div>
  );
}

// ── 预设段 ────────────────────────────────────────────────

function PresetSection({ onSelect }: { onSelect: (preset: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <Sparkles className="w-3 h-3 text-neon-magenta" />
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {t('materialEditor.presets')}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-4 gap-1.5">
          {MATERIAL_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => onSelect(p.key)}
              className="px-1 py-1.5 text-[9px] font-mono border border-neon-magenta/20 text-mist hover:border-neon-magenta hover:text-neon-magenta hover:bg-neon-magenta/5 tracking-[0.1em] uppercase transition-colors"
              title={p.label}
            >
              {p.label}
            </button>
          ))}
        </div>
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

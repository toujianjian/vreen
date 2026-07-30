// ShaderEditor — 着色器编辑器面板。
// GLSL 代码编辑(顶点/片元切换)+ 实时编译预览(Canvas 2D 近似)+
// uniform 编辑器(自动检测 uniform)+ 编译错误显示 + 着色器预设选择 +
// 保存/加载着色器。赛博朋克风格(霓虹色 + 暗色背景),复用 HudPanel 框架。
//
// 设计目标:
//   - 受控组件:所有状态由父级持有,本组件仅渲染 + 触发回调
//   - 行号同步:textarea 滚动时同步行号容器滚动
//   - uniform 自动检测:从源码 `uniform <type> <name>;` 反射显示
//   - 预览:Canvas 2D 渲染一个 quad,用 uniform 值近似着色器输出
//     (真实 GLSL 编译需 WebGL 上下文,这里用启发式色块作为视觉反馈)
//   - 错误面板:列出 compileErrors,行号高亮(若错误信息含 `LINE:N`)

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode,
  FolderOpen,
  Play,
  Save,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { ColorField } from '@/components/viewer/ColorField';
import { cn } from '@/lib/cn';

// ── 类型 ──────────────────────────────────────────────────

/** Uniform 类型(与 ShaderLibrary 对齐,扩展子集)。 */
export type ShaderUniformType =
  | 'float'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'mat4'
  | 'sampler2D';

/** Uniform 描述项(由父级传入,驱动 uniform 编辑器渲染)。 */
export interface ShaderUniform {
  /** Uniform 名(如 `u_baseColor`)。 */
  name: string;
  /** 类型。 */
  type: ShaderUniformType;
  /** 当前值(number / number[] / string 纹理 id)。 */
  value: number | number[] | string;
  /** 数值型 uniform 的最小值(可选,用于 slider)。 */
  min?: number;
  /** 数值型 uniform 的最大值(可选)。 */
  max?: number;
}

/** 当前编辑的着色器阶段。 */
export type ShaderStage = 'vertex' | 'fragment';

interface ShaderEditorProps {
  /** 顶点着色器源码。 */
  vertexShader: string;
  /** 片元着色器源码。 */
  fragmentShader: string;
  /** Uniform 列表(由父级反射 / 维护)。 */
  uniforms: ShaderUniform[];
  /** 编译错误列表(空数组表示无错误或未编译)。 */
  compileErrors: string[];
  /** 顶点着色器源码变更。 */
  onVertexShaderChange: (code: string) => void;
  /** 片元着色器源码变更。 */
  onFragmentShaderChange: (code: string) => void;
  /** Uniform 值变更(name + newValue)。 */
  onUniformChange: (name: string, value: number | number[] | string) => void;
  /** 触发编译。 */
  onCompile: () => void;
  /** 保存当前着色器(命名)。 */
  onSave: (name: string) => void;
  /** 加载已保存的着色器(命名)。 */
  onLoad: (name: string) => void;
  /** 选择预设。 */
  onPresetSelect: (preset: string) => void;
}

// ── 常量 ──────────────────────────────────────────────────

/** 着色器预设(与 ShaderLibrary 内置模板对齐)。 */
const SHADER_PRESETS = [
  { key: 'unlit', label: 'Unlit' },
  { key: 'unlit-textured', label: 'Unlit Tex' },
  { key: 'diffuse', label: 'Diffuse' },
  { key: 'phong', label: 'Phong' },
  { key: 'blinn-phong', label: 'Blinn-Phong' },
  { key: 'pbr', label: 'PBR' },
  { key: 'pbr-ibl', label: 'PBR IBL' },
  { key: 'toon', label: 'Toon' },
  { key: 'water', label: 'Water' },
  { key: 'fur', label: 'Fur' },
  { key: 'parallax', label: 'Parallax' },
  { key: 'skybox', label: 'Skybox' },
] as const;

// ── 工具:从 GLSL 源码反射 uniform ─────────────────────────

const UNIFORM_RE =
  /^\s*uniform\s+(float|int|bool|vec2|vec3|vec4|mat3|mat4|sampler2D|samplerCube)\s+(\w+)\s*(?:=\s*([^;]+))?\s*;/gm;

/**
 * 从 GLSL 源码反射 uniform 声明。
 * 用于在编辑器内即时显示当前源码引用的 uniform(只读反射,不替换父级传入的 uniforms)。
 */
export function reflectUniforms(source: string): { name: string; type: string }[] {
  const out: { name: string; type: string }[] = [];
  let m: RegExpExecArray | null;
  UNIFORM_RE.lastIndex = 0;
  while ((m = UNIFORM_RE.exec(source)) !== null) {
    out.push({ type: m[1], name: m[2] });
  }
  return out;
}

// ── 颜色工具 ──────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function rgbArrToHex(rgb: number[]): string {
  const c = (v: number) =>
    Math.round(clamp(v) * 255).toString(16).padStart(2, '0').slice(-2);
  return `#${c(rgb[0] ?? 0)}${c(rgb[1] ?? 0)}${c(rgb[2] ?? 0)}`;
}

function hexToRgbArr(hex: string): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

// ── 主组件 ────────────────────────────────────────────────

export function ShaderEditor({
  vertexShader,
  fragmentShader,
  uniforms,
  compileErrors,
  onVertexShaderChange,
  onFragmentShaderChange,
  onUniformChange,
  onCompile,
  onSave,
  onLoad,
  onPresetSelect,
}: ShaderEditorProps) {
  const { t } = useTranslation();
  const [activeStage, setActiveStage] = useState<ShaderStage>('vertex');
  const [saveName, setSaveName] = useState('');
  const [loadName, setLoadName] = useState('');

  const currentCode = activeStage === 'vertex' ? vertexShader : fragmentShader;
  const currentChange = activeStage === 'vertex' ? onVertexShaderChange : onFragmentShaderChange;

  const hasErrors = compileErrors.length > 0;
  const reflectedUniforms = useMemo(() => {
    const set = new Set<string>();
    reflectUniforms(vertexShader).forEach((u) => set.add(u.name));
    reflectUniforms(fragmentShader).forEach((u) => set.add(u.name));
    return set;
  }, [vertexShader, fragmentShader]);

  return (
    <HudPanel
      title={t('shaderEditor.title')}
      tag="SHADER"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      {/* 顶部工具栏:预设 + 编译 + 保存 + 加载 */}
      <ToolbarSection
        onPresetSelect={onPresetSelect}
        onCompile={onCompile}
        onSave={onSave}
        onLoad={onLoad}
        saveName={saveName}
        setSaveName={setSaveName}
        loadName={loadName}
        setLoadName={setLoadName}
        hasErrors={hasErrors}
      />

      {/* 主体:左编辑器 + 右预览 */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_280px] gap-2 p-2 border-b border-neon-cyan/10">
        <CodeEditorSection
          activeStage={activeStage}
          onStageChange={setActiveStage}
          code={currentCode}
          onChange={currentChange}
          reflectedUniforms={reflectedUniforms}
        />
        <PreviewSection
          uniforms={uniforms}
          hasErrors={hasErrors}
          stage={activeStage}
        />
      </div>

      {/* 底部:uniform 编辑器 + 错误面板 */}
      <div className="shrink-0 grid grid-cols-2 gap-2 p-2 max-h-[40%] overflow-y-auto">
        <UniformSection
          uniforms={uniforms}
          onChange={onUniformChange}
        />
        <ErrorPanel errors={compileErrors} />
      </div>
    </HudPanel>
  );
}

// ── 顶部工具栏 ────────────────────────────────────────────

function ToolbarSection({
  onPresetSelect,
  onCompile,
  onSave,
  onLoad,
  saveName,
  setSaveName,
  loadName,
  setLoadName,
  hasErrors,
}: {
  onPresetSelect: (preset: string) => void;
  onCompile: () => void;
  onSave: (name: string) => void;
  onLoad: (name: string) => void;
  saveName: string;
  setSaveName: (v: string) => void;
  loadName: string;
  setLoadName: (v: string) => void;
  hasErrors: boolean;
}) {
  const { t } = useTranslation();
  const [presetOpen, setPresetOpen] = useState(false);

  return (
    <div className="shrink-0 px-3 py-2 border-b border-neon-cyan/15 flex items-center gap-2 flex-wrap">
      {/* 预设下拉 */}
      <div className="relative">
        <button
          onClick={() => setPresetOpen(!presetOpen)}
          className="flex items-center gap-1.5 px-2 py-1 border border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan font-mono text-[10px] tracking-[0.14em] uppercase hover:bg-neon-cyan/10 transition-colors"
        >
          <Sparkles className="w-3 h-3" />
          {t('shaderEditor.shaderPresets')}
          {presetOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        {presetOpen && (
          <div className="absolute z-10 top-full left-0 mt-1 bg-space-900/95 border border-neon-cyan/30 grid grid-cols-3 gap-1 p-1.5 w-[280px]">
            {SHADER_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  onPresetSelect(p.key);
                  setPresetOpen(false);
                }}
                className="px-1 py-1 text-[9px] font-mono border border-neon-cyan/15 text-mist hover:border-neon-cyan hover:text-neon-cyan hover:bg-neon-cyan/5 tracking-[0.1em] uppercase transition-colors"
                title={p.label}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 编译按钮 */}
      <button
        onClick={onCompile}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 border font-mono text-[10px] tracking-[0.14em] uppercase transition-colors',
          hasErrors
            ? 'border-neon-magenta/50 text-neon-magenta bg-neon-magenta/10 hover:bg-neon-magenta/20'
            : 'border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10',
        )}
      >
        <Play className="w-3 h-3" />
        {t('shaderEditor.compile')}
      </button>

      {/* 保存 */}
      <div className="flex items-center gap-1 ml-auto">
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder={t('shaderEditor.saveShader')}
          className="w-28 bg-space-900/60 border border-neon-cyan/20 px-1.5 py-1 text-[10px] font-mono text-haze focus:border-neon-cyan focus:outline-none"
        />
        <button
          onClick={() => saveName.trim() && onSave(saveName.trim())}
          disabled={!saveName.trim()}
          className="flex items-center gap-1 px-2 py-1 border border-neon-cyan/30 text-neon-cyan/90 font-mono text-[10px] tracking-[0.12em] uppercase hover:bg-neon-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-3 h-3" />
        </button>
      </div>

      {/* 加载 */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={loadName}
          onChange={(e) => setLoadName(e.target.value)}
          placeholder={t('shaderEditor.loadShader')}
          className="w-28 bg-space-900/60 border border-neon-cyan/20 px-1.5 py-1 text-[10px] font-mono text-haze focus:border-neon-cyan focus:outline-none"
        />
        <button
          onClick={() => loadName.trim() && onLoad(loadName.trim())}
          disabled={!loadName.trim()}
          className="flex items-center gap-1 px-2 py-1 border border-neon-cyan/30 text-neon-cyan/90 font-mono text-[10px] tracking-[0.12em] uppercase hover:bg-neon-cyan/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <FolderOpen className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── 代码编辑器段 ──────────────────────────────────────────

function CodeEditorSection({
  activeStage,
  onStageChange,
  code,
  onChange,
  reflectedUniforms,
}: {
  activeStage: ShaderStage;
  onStageChange: (s: ShaderStage) => void;
  code: string;
  onChange: (code: string) => void;
  reflectedUniforms: Set<string>;
}) {
  const { t } = useTranslation();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // 同步行号滚动
  useEffect(() => {
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  const lines = code.split('\n');
  const lineCount = lines.length;
  // 行号至少 1 行(空文本时也显示 1)
  const gutterLines = Math.max(lineCount, 1);

  return (
    <div className="min-h-0 flex flex-col border border-neon-cyan/15 bg-space-900/40">
      {/* Stage 切换 */}
      <div className="shrink-0 flex items-center border-b border-neon-cyan/15">
        <StageTab
          active={activeStage === 'vertex'}
          onClick={() => onStageChange('vertex')}
          label={t('shaderEditor.vertexShader')}
          icon={<Code2 className="w-3 h-3" />}
        />
        <StageTab
          active={activeStage === 'fragment'}
          onClick={() => onStageChange('fragment')}
          label={t('shaderEditor.fragmentShader')}
          icon={<FileCode className="w-3 h-3" />}
        />
        <div className="ml-auto px-2 font-mono text-[9px] text-mist tracking-[0.14em] uppercase">
          {lineCount} L · {code.length} B · {reflectedUniforms.size} U
        </div>
      </div>

      {/* 编辑器主体 */}
      <div className="flex-1 min-h-0 flex overflow-hidden font-mono text-[11px] leading-[1.45]">
        {/* 行号 */}
        <div
          ref={gutterRef}
          className="shrink-0 w-10 overflow-hidden bg-space-900/60 border-r border-neon-cyan/10 text-right text-neon-cyan/40 select-none"
          aria-hidden
        >
          {Array.from({ length: gutterLines }, (_, i) => (
            <div key={i} className="px-1.5 leading-[1.45]">
              {i + 1}
            </div>
          ))}
        </div>
        {/* textarea */}
        <textarea
          ref={taRef}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => setScrollTop((e.target as HTMLTextAreaElement).scrollTop)}
          spellCheck={false}
          wrap="off"
          className="flex-1 min-h-0 bg-transparent text-haze/90 px-2 py-0 resize-none focus:outline-none whitespace-pre overflow-auto"
          style={{ tabSize: 4 }}
        />
      </div>
    </div>
  );
}

function StageTab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] uppercase border-r border-neon-cyan/15 transition-colors',
        active
          ? 'bg-neon-cyan/10 text-neon-cyan border-b-2 border-b-neon-cyan'
          : 'text-mist hover:text-haze hover:bg-neon-cyan/5',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── 预览段(Canvas 2D 近似渲染) ───────────────────────────

function PreviewSection({
  uniforms,
  hasErrors,
  stage,
}: {
  uniforms: ShaderUniform[];
  hasErrors: boolean;
  stage: ShaderStage;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 背景:深色网格
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,229,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= w; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (hasErrors) {
      // 错误状态:红色叉
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 2;
      const m = 24;
      ctx.beginPath();
      ctx.moveTo(m, m);
      ctx.lineTo(w - m, h - m);
      ctx.moveTo(w - m, m);
      ctx.lineTo(m, h - m);
      ctx.stroke();
      return;
    }

    // 提取关键 uniform 做启发式预览
    const find = (name: string) => uniforms.find((u) => u.name === name);
    const baseColor = find('u_baseColor') ?? find('u_furColor') ?? find('u_waterColor');
    const emissive = find('u_emissive') ?? find('u_lightColor');
    const metallic = find('u_metallic');
    const roughness = find('u_roughness');

    // 中心预览球
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 16;

    let r = 0.6, g = 0.6, b = 0.65;
    if (baseColor && Array.isArray(baseColor.value)) {
      r = baseColor.value[0] ?? r;
      g = baseColor.value[1] ?? g;
      b = baseColor.value[2] ?? b;
    }

    // 金属度影响高光锐度
    const metalV = metallic && typeof metallic.value === 'number' ? metallic.value : 0;
    const roughV = roughness && typeof roughness.value === 'number' ? roughness.value : 0.5;
    const specSharp = clamp(metalV * (1 - roughV) + (1 - roughV) * 0.4);
    const hlSize = Math.max(6, radius * (0.15 + roughV * 0.5));

    // 主渐变
    const grad = ctx.createRadialGradient(
      cx - radius * 0.4, cy - radius * 0.4, radius * 0.1,
      cx, cy, radius,
    );
    const lr = Math.min(255, Math.round(r * 255 + 60));
    const lg = Math.min(255, Math.round(g * 255 + 60));
    const lb = Math.min(255, Math.round(b * 255 + 60));
    const dr = Math.round(r * 255 * 0.3);
    const dg = Math.round(g * 255 * 0.3);
    const db = Math.round(b * 255 * 0.3);
    grad.addColorStop(0, `rgb(${lr},${lg},${lb})`);
    grad.addColorStop(0.6, `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`);
    grad.addColorStop(1, `rgb(${dr},${dg},${db})`);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // 高光斑
    const hg = ctx.createRadialGradient(
      cx - radius * 0.35, cy - radius * 0.35, 0,
      cx - radius * 0.35, cy - radius * 0.35, hlSize,
    );
    hg.addColorStop(0, `rgba(255,255,255,${specSharp})`);
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // 发光叠加
    if (emissive && Array.isArray(emissive.value)) {
      const eR = Math.round((emissive.value[0] ?? 0) * 255);
      const eG = Math.round((emissive.value[1] ?? 0) * 255);
      const eB = Math.round((emissive.value[2] ?? 0) * 255);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = `rgb(${eR},${eG},${eB})`;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // 描边
    ctx.strokeStyle = 'rgba(0,229,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }, [uniforms, hasErrors, stage]);

  return (
    <div className="min-h-0 flex flex-col border border-neon-cyan/15 bg-space-900/40">
      <div className="shrink-0 px-2 py-1 border-b border-neon-cyan/15 flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.16em] text-neon-cyan/70 uppercase">
          {t('shaderEditor.preview')}
        </span>
        <span
          className={cn(
            'font-mono text-[9px] tracking-[0.16em] uppercase',
            hasErrors ? 'text-neon-magenta' : 'text-neon-cyan/60',
          )}
        >
          {hasErrors ? 'ERROR' : 'LIVE'}
        </span>
      </div>
      <div className="flex-1 min-h-0 p-2 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={256}
          height={256}
          className="border border-neon-cyan/20 bg-space-900/60 max-w-full max-h-full"
        />
      </div>
    </div>
  );
}

// ── Uniform 编辑器 ───────────────────────────────────────

function UniformSection({
  uniforms,
  onChange,
}: {
  uniforms: ShaderUniform[];
  onChange: (name: string, value: number | number[] | string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-neon-cyan/15 bg-space-900/40 flex flex-col min-h-0">
      <button
        onClick={() => setOpen(!open)}
        className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-neon-cyan/15 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[10px] tracking-[0.2em] text-haze uppercase">
          {t('shaderEditor.uniform')}
        </span>
        <span className="ml-auto font-mono text-[9px] text-neon-cyan/60 tracking-[0.14em]">
          {uniforms.length}
        </span>
      </button>
      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
          {uniforms.length === 0 ? (
            <div className="text-mist text-[10px] font-mono text-center py-4">—</div>
          ) : (
            uniforms.map((u) => (
              <UniformRow key={u.name} uniform={u} onChange={onChange} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function UniformRow({
  uniform,
  onChange,
}: {
  uniform: ShaderUniform;
  onChange: (name: string, value: number | number[] | string) => void;
}) {
  const { name, type } = uniform;

  return (
    <div className="border border-neon-cyan/10 bg-space-900/50 px-2 py-1.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-mono text-[10px] text-neon-cyan truncate flex-1">{name}</span>
        <span className="font-mono text-[8px] text-mist tracking-[0.12em] uppercase shrink-0">
          {type}
        </span>
      </div>
      {renderUniformControl(uniform, onChange)}
    </div>
  );
}

function renderUniformControl(
  uniform: ShaderUniform,
  onChange: (name: string, value: number | number[] | string) => void,
): ReactNode {
  const { name, type, value, min, max } = uniform;

  if (type === 'float') {
    const v = typeof value === 'number' ? value : 0;
    const lo = min ?? 0;
    const hi = max ?? 1;
    return (
      <div>
        <div className="hud-label mb-0.5 flex justify-between">
          <span className="font-mono text-[9px] text-mist">{v.toFixed(3)}</span>
        </div>
        <input
          type="range"
          min={lo}
          max={hi}
          step={(hi - lo) / 100}
          value={v}
          onChange={(e) => onChange(name, parseFloat(e.target.value))}
          className="hud-range"
        />
      </div>
    );
  }

  if (type === 'vec2' || type === 'vec3' || type === 'vec4') {
    const comps = type === 'vec2' ? 2 : type === 'vec3' ? 3 : 4;
    const arr = Array.isArray(value) ? value.slice(0, comps) : new Array(comps).fill(0);
    while (arr.length < comps) arr.push(0);
    const labels = ['x', 'y', 'z', 'w'];

    // 若是 vec3 且 name 含 color,提供颜色选择器
    const isColor = comps === 3 && /color/i.test(name);
    if (isColor) {
      const hex = rgbArrToHex(arr);
      return (
        <div className="flex items-center gap-1.5">
          <ColorField
            value={hex}
            onChange={(h) => onChange(name, hexToRgbArr(h))}
          />
          <span className="font-mono text-[9px] text-mist tabular-nums">
            {arr.map((v) => v.toFixed(2)).join(', ')}
          </span>
        </div>
      );
    }

    return (
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${comps}, 1fr)` }}>
        {arr.map((v, i) => (
          <label key={i} className="flex items-center gap-0.5">
            <span className="font-mono text-[8px] text-mist w-2">{labels[i]}</span>
            <input
              type="number"
              step={0.01}
              value={v}
              onChange={(e) => {
                const next = arr.slice();
                next[i] = parseFloat(e.target.value) || 0;
                onChange(name, next);
              }}
              className="w-full bg-space-900/60 border border-neon-cyan/15 px-1 py-0.5 text-[9px] font-mono text-haze focus:border-neon-cyan focus:outline-none"
            />
          </label>
        ))}
      </div>
    );
  }

  if (type === 'mat4') {
    return (
      <div className="font-mono text-[9px] text-mist">
        mat4 (16) — uniform editor skipped
      </div>
    );
  }

  if (type === 'sampler2D') {
    const v = typeof value === 'string' ? value : '';
    return (
      <input
        type="text"
        value={v}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder="texture id..."
        className="w-full bg-space-900/60 border border-neon-cyan/20 px-1.5 py-0.5 text-[9px] font-mono text-neon-cyan focus:border-neon-cyan focus:outline-none"
      />
    );
  }

  return null;
}

// ── 错误面板 ──────────────────────────────────────────────

function ErrorPanel({ errors }: { errors: string[] }) {
  const { t } = useTranslation();
  const hasErrors = errors.length > 0;

  return (
    <div className="border border-neon-cyan/15 bg-space-900/40 flex flex-col min-h-0">
      <div className="shrink-0 px-3 py-1.5 border-b border-neon-cyan/15 flex items-center gap-2">
        {hasErrors ? (
          <AlertTriangle className="w-3 h-3 text-neon-magenta" />
        ) : (
          <CheckCircle2 className="w-3 h-3 text-neon-cyan/70" />
        )}
        <span className="font-display text-[10px] tracking-[0.2em] text-haze uppercase">
          {t('shaderEditor.compileErrors')}
        </span>
        <span
          className={cn(
            'ml-auto font-mono text-[9px] tracking-[0.14em] uppercase',
            hasErrors ? 'text-neon-magenta' : 'text-neon-cyan/60',
          )}
        >
          {hasErrors ? `${errors.length} ERR` : t('shaderEditor.noErrors')}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 font-mono text-[10px] leading-[1.45]">
        {hasErrors ? (
          <ul className="space-y-1">
            {errors.map((err, i) => (
              <li key={i} className="text-neon-magenta/90 break-all">
                <span className="text-neon-magenta/60 mr-1">›</span>
                {err}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-neon-cyan/60 text-center py-4">{t('shaderEditor.noErrors')}</div>
        )}
      </div>
    </div>
  );
}

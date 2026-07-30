// LevelEditor — 关卡编辑器组件。
// 集成 SceneHierarchy + InspectorPanel + EngineConsole + AssetBrowser +
// 视口工具栏(选择/移动/旋转/缩放/吸附)+ 关卡属性(名称/环境/天空盒/雾)+
// 保存/加载 + 撤销/重做 + 播放/暂停/停止(测试模式)。
// 赛博朋克风格(霓虹色 + 暗色背景),复用 HudPanel 框架。

import {
  Box,
  CloudFog,
  FolderOpen,
  Magnet,
  Move,
  MousePointer2,
  Pause,
  Play,
  RotateCw,
  Redo2,
  Save,
  Scale,
  Settings,
  Square,
  Sun,
  Undo2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AssetBrowser, type AssetItem } from '@/components/editor/AssetBrowser';
import { EngineConsole, type ConsoleMessage } from '@/components/editor/EngineConsole';
import { InspectorPanel } from '@/components/editor/InspectorPanel';
import { SceneHierarchy } from '@/components/editor/SceneHierarchy';
import { HudPanel } from '@/components/hud/HudPanel';
import { cn } from '@/lib/cn';

// ── 类型 ──────────────────────────────────────────────────

/** 变换工具。 */
export type TransformTool = 'select' | 'move' | 'rotate' | 'scale';

/** 关卡环境设置。 */
export interface LevelEnvironment {
  name: string;
  skybox: string;
  fogMode: 'none' | 'linear' | 'exp2';
  fogColor: string;
  fogDensity: number;
  fogNear: number;
  fogFar: number;
  ambientIntensity: number;
  sunIntensity: number;
}

interface LevelEditorProps {
  /** 场景对象 (Object3D-like / 引擎 Scene / three.js Scene)。 */
  scene: unknown;
  /** 当前选中对象 ID。 */
  selectedId: string | null;
  /** 是否处于播放(测试)模式。 */
  isPlaying: boolean;
  /** 选中对象回调。 */
  onSelect: (id: string | null) => void;
  /** 更新对象属性。 */
  onUpdate: (id: string, property: string, value: unknown) => void;
  /** 添加子对象。 */
  onAdd: (parentId: string | null) => void;
  /** 删除对象。 */
  onDelete: (id: string) => void;
  /** 重命名对象。 */
  onRename: (id: string, name: string) => void;
  /** 保存关卡。 */
  onSave: () => void;
  /** 加载关卡。 */
  onLoad: () => void;
  /** 播放(测试模式)。 */
  onPlay: () => void;
  /** 暂停。 */
  onPause: () => void;
  /** 停止(退出测试模式)。 */
  onStop: () => void;
  /** 撤销。 */
  onUndo: () => void;
  /** 重做。 */
  onRedo: () => void;
  /** 是否可撤销。 */
  canUndo: boolean;
  /** 是否可重做。 */
  canRedo: boolean;
  /** 关卡环境设置(可选;不传则使用内部默认)。 */
  environment?: LevelEnvironment;
  /** 关卡环境更新回调(可选)。 */
  onEnvironmentChange?: (env: LevelEnvironment) => void;
}

// ── 默认环境 ──────────────────────────────────────────────

const DEFAULT_ENVIRONMENT: LevelEnvironment = {
  name: 'Untitled Level',
  skybox: 'studio',
  fogMode: 'none',
  fogColor: '#0a0e1a',
  fogDensity: 0.02,
  fogNear: 10,
  fogFar: 100,
  ambientIntensity: 0.3,
  sunIntensity: 1.0,
};

// ── 工具配置 ──────────────────────────────────────────────

const TOOLS: { key: TransformTool; icon: typeof Move; label: string; shortcut: string }[] = [
  { key: 'select', icon: MousePointer2, label: 'select', shortcut: 'Q' },
  { key: 'move', icon: Move, label: 'move', shortcut: 'W' },
  { key: 'rotate', icon: RotateCw, label: 'rotate', shortcut: 'E' },
  { key: 'scale', icon: Scale, label: 'scale', shortcut: 'R' },
];

const SKYBOX_PRESETS = ['studio', 'sunset', 'city', 'forest', 'space', 'night'];

// ── 主组件 ────────────────────────────────────────────────

export function LevelEditor(props: LevelEditorProps) {
  const {
    scene,
    selectedId,
    isPlaying,
    onSelect,
    onUpdate,
    onAdd,
    onDelete,
    onRename,
    onSave,
    onLoad,
    onPlay,
    onPause,
    onStop,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    environment,
    onEnvironmentChange,
  } = props;
  const { t } = useTranslation();

  const [tool, setTool] = useState<TransformTool>('select');
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [bottomTab, setBottomTab] = useState<'console' | 'assets'>('console');
  const [showSettings, setShowSettings] = useState(false);

  // 内部状态:控制台消息 + 资源列表(无外部数据源时使用)
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([]);
  const [assets] = useState<AssetItem[]>([]);

  // 关卡环境(内部降级)
  const env = environment ?? DEFAULT_ENVIRONMENT;
  const handleEnvChange = (patch: Partial<LevelEnvironment>) => {
    onEnvironmentChange?.({ ...env, ...patch });
  };

  // 选中对象:在场景树中按 ID 查找
  const selectedObject = useMemo(
    () => findObjectById(scene, selectedId),
    [scene, selectedId],
  );

  return (
    <div className="h-full w-full flex flex-col bg-space-900/40 text-haze overflow-hidden">
      {/* 顶部工具栏 */}
      <TopToolbar
        isPlaying={isPlaying}
        canUndo={canUndo}
        canRedo={canRedo}
        tool={tool}
        snapEnabled={snapEnabled}
        showSettings={showSettings}
        onToolChange={setTool}
        onSnapToggle={() => setSnapEnabled((s) => !s)}
        onSettingsToggle={() => setShowSettings((s) => !s)}
        onSave={onSave}
        onLoad={onLoad}
        onPlay={onPlay}
        onPause={onPause}
        onStop={onStop}
        onUndo={onUndo}
        onRedo={onRedo}
      />

      {/* 主体三栏 */}
      <div className="flex-1 min-h-0 flex">
        {/* 左侧:SceneHierarchy */}
        <div className="w-64 shrink-0 border-r border-neon-cyan/10 min-h-0">
          <SceneHierarchy
            scene={scene}
            selectedId={selectedId}
            onSelect={(id) => onSelect(id)}
            onAdd={onAdd}
            onDelete={onDelete}
            onRename={onRename}
            onReorder={() => {
              /* 由父组件接管,此处无操作 */
            }}
          />
        </div>

        {/* 中间:视口 + 关卡设置 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            <ViewportPlaceholder isPlaying={isPlaying} tool={tool} />
            {showSettings && (
              <LevelSettingsPanel
                env={env}
                onChange={handleEnvChange}
                onClose={() => setShowSettings(false)}
              />
            )}
          </div>

          {/* 底部:Console / Assets 标签切换 */}
          <div className="h-56 shrink-0 border-t border-neon-cyan/10">
            <div className="flex items-center border-b border-neon-cyan/10 bg-space-800/40">
              <BottomTabButton
                active={bottomTab === 'console'}
                onClick={() => setBottomTab('console')}
                label={t('levelEditor.console')}
              />
              <BottomTabButton
                active={bottomTab === 'assets'}
                onClick={() => setBottomTab('assets')}
                label={t('levelEditor.assets')}
              />
            </div>
            <div className="h-[calc(100%-29px)]">
              {bottomTab === 'console' ? (
                <EngineConsole
                  messages={consoleMessages}
                  onCommand={(cmd) => {
                    setConsoleMessages((prev) => [
                      ...prev,
                      {
                        id: `cmd-${Date.now()}`,
                        level: 'info',
                        text: `> ${cmd}`,
                        timestamp: Date.now(),
                        source: 'user',
                      },
                    ]);
                  }}
                  onClear={() => setConsoleMessages([])}
                />
              ) : (
                <AssetBrowser
                  assets={assets}
                  onImport={() => {
                    /* 由父组件接管 */
                  }}
                  onDragToScene={() => {
                    /* 由父组件接管 */
                  }}
                  onSelect={() => {
                    /* 由父组件接管 */
                  }}
                  onDelete={() => {
                    /* 由父组件接管 */
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* 右侧:InspectorPanel */}
        <div className="w-72 shrink-0 border-l border-neon-cyan/10 min-h-0">
          <InspectorPanel
            selectedObject={selectedObject}
            onUpdate={onUpdate}
            onAddComponent={() => {
              /* 由父组件接管 */
            }}
            onRemoveComponent={() => {
              /* 由父组件接管 */
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── 顶部工具栏 ────────────────────────────────────────────

interface TopToolbarProps {
  isPlaying: boolean;
  canUndo: boolean;
  canRedo: boolean;
  tool: TransformTool;
  snapEnabled: boolean;
  showSettings: boolean;
  onToolChange: (t: TransformTool) => void;
  onSnapToggle: () => void;
  onSettingsToggle: () => void;
  onSave: () => void;
  onLoad: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

function TopToolbar(props: TopToolbarProps) {
  const { t } = useTranslation();
  const {
    isPlaying,
    canUndo,
    canRedo,
    tool,
    snapEnabled,
    showSettings,
    onToolChange,
    onSnapToggle,
    onSettingsToggle,
    onSave,
    onLoad,
    onPlay,
    onPause,
    onStop,
    onUndo,
    onRedo,
  } = props;

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-neon-cyan/10 bg-space-800/40">
      {/* 文件操作 */}
      <ToolbarGroup>
        <ToolbarButton onClick={onSave} title={t('levelEditor.saveLevel')}>
          <Save className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={onLoad} title={t('levelEditor.loadLevel')}>
          <FolderOpen className="w-3.5 h-3.5" />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 撤销 / 重做 */}
      <ToolbarGroup>
        <ToolbarButton
          onClick={onUndo}
          disabled={!canUndo}
          title={t('levelEditor.undo')}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={onRedo}
          disabled={!canRedo}
          title={t('levelEditor.redo')}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 变换工具 */}
      <ToolbarGroup>
        {TOOLS.map((tl) => {
          const Icon = tl.icon;
          const active = tool === tl.key;
          return (
            <ToolbarButton
              key={tl.key}
              onClick={() => onToolChange(tl.key)}
              active={active}
              title={`${t(`levelEditor.tools.${tl.label}`)} (${tl.shortcut})`}
            >
              <Icon className="w-3.5 h-3.5" />
            </ToolbarButton>
          );
        })}
        <ToolbarButton
          onClick={onSnapToggle}
          active={snapEnabled}
          title={t('levelEditor.snap')}
        >
          <Magnet className="w-3.5 h-3.5" />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 播放控制 */}
      <ToolbarGroup>
        {isPlaying ? (
          <ToolbarButton onClick={onPause} title={t('levelEditor.pause')}>
            <Pause className="w-3.5 h-3.5" />
          </ToolbarButton>
        ) : (
          <ToolbarButton
            onClick={onPlay}
            title={t('levelEditor.play')}
            active={false}
            accent="magenta"
          >
            <Play className="w-3.5 h-3.5" />
          </ToolbarButton>
        )}
        <ToolbarButton onClick={onStop} title={t('levelEditor.stop')}>
          <Square className="w-3.5 h-3.5" />
        </ToolbarButton>
      </ToolbarGroup>

      <span className="flex-1" />

      {/* 关卡状态指示 */}
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em]">
        <span
          className={cn(
            'px-1.5 py-0.5 border',
            isPlaying
              ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
              : 'border-neon-cyan/30 text-mist',
          )}
        >
          {isPlaying ? t('levelEditor.playing') : t('levelEditor.editing')}
        </span>
      </div>

      <ToolbarDivider />

      {/* 关卡设置 */}
      <ToolbarButton
        onClick={onSettingsToggle}
        active={showSettings}
        title={t('levelEditor.levelSettings')}
      >
        <Settings className="w-3.5 h-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <span className="w-px h-5 bg-neon-cyan/15 mx-1" />;
}

function ToolbarButton({
  onClick,
  disabled,
  active,
  accent,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  accent?: 'cyan' | 'magenta';
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'p-1.5 border transition-colors',
        active
          ? accent === 'magenta'
            ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
            : 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
          : 'border-transparent text-mist hover:text-haze hover:bg-neon-cyan/5',
        disabled && 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-mist',
      )}
    >
      {children}
    </button>
  );
}

// ── 视口占位 ──────────────────────────────────────────────

function ViewportPlaceholder({
  isPlaying,
  tool,
}: {
  isPlaying: boolean;
  tool: TransformTool;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-space-900/80 to-space-800/40 overflow-hidden">
      {/* 网格背景 */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,240,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      {/* 中心占位 */}
      <div className="relative flex flex-col items-center gap-2 text-mist">
        <Box className="w-12 h-12 text-neon-cyan/30" />
        <div className="font-mono text-[11px] tracking-[0.2em] uppercase">
          {t('levelEditor.viewport')}
        </div>
        <div className="font-mono text-[9px] tracking-[0.16em] text-mist/60">
          {t('levelEditor.viewportHint')}
        </div>
      </div>
      {/* 角标:工具 + 模式 */}
      <div className="absolute top-2 left-2 flex items-center gap-2 font-mono text-[9px] tracking-[0.16em]">
        <span className="px-1.5 py-0.5 border border-neon-cyan/30 text-neon-cyan/80 uppercase">
          {tool}
        </span>
        <span
          className={cn(
            'px-1.5 py-0.5 border uppercase',
            isPlaying
              ? 'border-neon-magenta/50 text-neon-magenta'
              : 'border-neon-cyan/30 text-mist',
          )}
        >
          {isPlaying ? 'PLAY' : 'EDIT'}
        </span>
      </div>
    </div>
  );
}

// ── 关卡设置面板 ──────────────────────────────────────────

function LevelSettingsPanel({
  env,
  onChange,
  onClose,
}: {
  env: LevelEnvironment;
  onChange: (patch: Partial<LevelEnvironment>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute top-2 right-2 w-72 z-20">
      <HudPanel
        title={t('levelEditor.levelSettings')}
        tag="LEVEL"
        variant="magenta"
        className="shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
        bodyClassName="p-3 space-y-3"
        headerExtra={
          <button
            onClick={onClose}
            className="hud-btn hud-btn-ghost !py-0.5 text-[9px]"
          >
            ✕
          </button>
        }
      >
        {/* 关卡名称 */}
        <div>
          <div className="hud-label mb-1">{t('levelEditor.levelName')}</div>
          <input
            type="text"
            value={env.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="hud-input"
          />
        </div>

        {/* 天空盒 */}
        <div>
          <div className="hud-label mb-1 flex items-center gap-1">
            <Sun className="w-3 h-3" />
            <span>{t('levelEditor.skybox')}</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {SKYBOX_PRESETS.map((s) => (
              <button
                key={s}
                onClick={() => onChange({ skybox: s })}
                className={cn(
                  'px-1 py-1 text-[9px] font-mono border tracking-[0.1em] uppercase transition-colors',
                  s === env.skybox
                    ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
                    : 'border-neon-cyan/15 text-mist hover:border-neon-cyan hover:text-neon-cyan',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* 雾 */}
        <div>
          <div className="hud-label mb-1 flex items-center gap-1">
            <CloudFog className="w-3 h-3" />
            <span>{t('levelEditor.fog')}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 mb-2">
            {(['none', 'linear', 'exp2'] as const).map((m) => (
              <button
                key={m}
                onClick={() => onChange({ fogMode: m })}
                className={cn(
                  'px-1 py-1 text-[9px] font-mono border tracking-[0.1em] uppercase transition-colors',
                  m === env.fogMode
                    ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                    : 'border-neon-cyan/15 text-mist hover:border-neon-cyan hover:text-neon-cyan',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {env.fogMode !== 'none' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="hud-label w-12 shrink-0">
                  {t('levelEditor.fogColor')}
                </span>
                <input
                  type="text"
                  value={env.fogColor}
                  onChange={(e) => onChange({ fogColor: e.target.value })}
                  className="hud-input flex-1 font-mono"
                />
              </div>
              {env.fogMode === 'exp2' ? (
                <SettingSlider
                  label={t('levelEditor.fogDensity')}
                  value={env.fogDensity}
                  min={0}
                  max={0.2}
                  step={0.001}
                  onChange={(v) => onChange({ fogDensity: v })}
                />
              ) : (
                <>
                  <SettingSlider
                    label={t('levelEditor.fogNear')}
                    value={env.fogNear}
                    min={0}
                    max={200}
                    step={1}
                    onChange={(v) => onChange({ fogNear: v })}
                  />
                  <SettingSlider
                    label={t('levelEditor.fogFar')}
                    value={env.fogFar}
                    min={0}
                    max={500}
                    step={1}
                    onChange={(v) => onChange({ fogFar: v })}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* 光照 */}
        <div>
          <div className="hud-label mb-1">{t('levelEditor.lighting')}</div>
          <div className="space-y-2">
            <SettingSlider
              label={t('levelEditor.ambientIntensity')}
              value={env.ambientIntensity}
              min={0}
              max={2}
              step={0.05}
              onChange={(v) => onChange({ ambientIntensity: v })}
            />
            <SettingSlider
              label={t('levelEditor.sunIntensity')}
              value={env.sunIntensity}
              min={0}
              max={3}
              step={0.05}
              onChange={(v) => onChange({ sunIntensity: v })}
            />
          </div>
        </div>
      </HudPanel>
    </div>
  );
}

function SettingSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="hud-label mb-1 flex justify-between">
        <span>{label}</span>
        <span className="text-neon-cyan tabular-nums">
          {step < 0.01 ? value.toFixed(3) : value.toFixed(2)}
        </span>
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

// ── 底部标签按钮 ──────────────────────────────────────────

function BottomTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase border-b-2 transition-colors',
        active
          ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/5'
          : 'border-transparent text-mist hover:text-haze',
      )}
    >
      {label}
    </button>
  );
}

// ── 工具函数:在场景树中按 ID 查找对象 ─────────────────────

function findObjectById(scene: unknown, id: string | null): unknown {
  if (!id || !scene) return null;
  const walk = (obj: unknown): unknown => {
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    const oid = String(o.uuid ?? o.id ?? o.name ?? '');
    if (oid === id) return obj;
    const children = Array.isArray(o.children) ? o.children : [];
    for (const c of children) {
      const f = walk(c);
      if (f) return f;
    }
    return null;
  };
  return walk(scene);
}

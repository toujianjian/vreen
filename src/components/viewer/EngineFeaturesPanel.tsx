// EngineFeaturesPanel — 引擎功能开关面板。
//
// 集中展示自研 WebGL2 引擎的 8 个核心子系统:
//   ① 粒子系统 (ParticleSystem2)
//   ② 地形系统 (TerrainGeometry)
//   ③ IK 逆向运动学 (IKSolver)
//   ④ BVH 加速 (BVH)
//   ⑤ 物理约束 (ConstraintSolver)
//   ⑥ 动画层 (AnimationLayerMixer)
//   ⑦ 阴影系统 (ShadowMapManager)
//   ⑧ 音频系统 (AudioListener)
//
// 通过 viewerStore 的 toggle* 们驱动 CustomStage / Stage 渲染逻辑。
// 面板本身可折叠/展开,赛博朋克风格 (neon border + glassmorphism)。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Sparkles,
  Mountain,
  Bone,
  Box,
  Link2,
  Layers,
  Sun,
  Volume2,
  Power,
} from 'lucide-react';
import { useViewerStore } from '@/stores/viewerStore';
import { cn } from '@/lib/cn';

interface FeatureDef {
  /** viewerStore 上的布尔字段名 */
  field: 'particleEnabled' | 'terrainEnabled' | 'ikEnabled' | 'shadowEnabled';
  /** 对应 toggle 函数名 */
  toggle: 'toggleParticle' | 'toggleTerrain' | 'toggleIK' | 'toggleShadow';
  /** i18n key 前缀,会拼接 .title / .desc */
  i18nKey: string;
  /** lucide 图标 */
  Icon: typeof Sparkles;
  /** 强调色 tailwind class fragment,如 'neon-cyan' */
  accent: 'cyan' | 'magenta' | 'amber';
  /** 是否为内置可由 store 切换的引擎功能 (false 表示仅展示) */
  switchable: boolean;
}

const FEATURES: FeatureDef[] = [
  {
    field: 'particleEnabled',
    toggle: 'toggleParticle',
    i18nKey: 'engineFeatures.particle',
    Icon: Sparkles,
    accent: 'magenta',
    switchable: true,
  },
  {
    field: 'terrainEnabled',
    toggle: 'toggleTerrain',
    i18nKey: 'engineFeatures.terrain',
    Icon: Mountain,
    accent: 'amber',
    switchable: true,
  },
  {
    field: 'ikEnabled',
    toggle: 'toggleIK',
    i18nKey: 'engineFeatures.ik',
    Icon: Bone,
    accent: 'cyan',
    switchable: true,
  },
  {
    field: 'shadowEnabled',
    toggle: 'toggleShadow',
    i18nKey: 'engineFeatures.shadow',
    Icon: Sun,
    accent: 'amber',
    switchable: true,
  },
  // 仅展示型卡片 (无 store 开关,介绍用)
  {
    field: 'particleEnabled',
    toggle: 'toggleParticle',
    i18nKey: 'engineFeatures.bvh',
    Icon: Box,
    accent: 'cyan',
    switchable: false,
  },
  {
    field: 'particleEnabled',
    toggle: 'toggleParticle',
    i18nKey: 'engineFeatures.constraint',
    Icon: Link2,
    accent: 'magenta',
    switchable: false,
  },
  {
    field: 'particleEnabled',
    toggle: 'toggleParticle',
    i18nKey: 'engineFeatures.animLayer',
    Icon: Layers,
    accent: 'cyan',
    switchable: false,
  },
  {
    field: 'particleEnabled',
    toggle: 'toggleParticle',
    i18nKey: 'engineFeatures.audio',
    Icon: Volume2,
    accent: 'magenta',
    switchable: false,
  },
];

function accentText(accent: FeatureDef['accent']): string {
  switch (accent) {
    case 'magenta':
      return 'text-neon-magenta';
    case 'amber':
      return 'text-neon-amber';
    case 'cyan':
    default:
      return 'text-neon-cyan';
  }
}

function accentBorder(accent: FeatureDef['accent']): string {
  switch (accent) {
    case 'magenta':
      return 'border-neon-magenta/40 hover:border-neon-magenta/70';
    case 'amber':
      return 'border-neon-amber/40 hover:border-neon-amber/70';
    case 'cyan':
    default:
      return 'border-neon-cyan/40 hover:border-neon-cyan/70';
  }
}

function accentActiveBg(accent: FeatureDef['accent']): string {
  switch (accent) {
    case 'magenta':
      return 'bg-neon-magenta/15';
    case 'amber':
      return 'bg-neon-amber/15';
    case 'cyan':
    default:
      return 'bg-neon-cyan/15';
  }
}

export interface EngineFeaturesPanelProps {
  /** 初始是否展开,默认 true */
  defaultExpanded?: boolean;
  /** 是否显示为浮动面板 (absolute 定位),默认 false (内联) */
  floating?: boolean;
  /** 容器附加 className */
  className?: string;
}

export function EngineFeaturesPanel({
  defaultExpanded = true,
  floating = false,
  className,
}: EngineFeaturesPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  // 订阅所有相关状态
  const particleEnabled = useViewerStore((s) => s.particleEnabled);
  const terrainEnabled = useViewerStore((s) => s.terrainEnabled);
  const ikEnabled = useViewerStore((s) => s.ikEnabled);
  const shadowEnabled = useViewerStore((s) => s.shadowEnabled);
  const toggleParticle = useViewerStore((s) => s.toggleParticle);
  const toggleTerrain = useViewerStore((s) => s.toggleTerrain);
  const toggleIK = useViewerStore((s) => s.toggleIK);
  const toggleShadow = useViewerStore((s) => s.toggleShadow);

  // 状态值查找表
  const stateMap: Record<FeatureDef['field'], boolean> = {
    particleEnabled,
    terrainEnabled,
    ikEnabled,
    shadowEnabled,
  };
  // toggle 函数查找表
  const toggleMap: Record<FeatureDef['toggle'], () => void> = {
    toggleParticle,
    toggleTerrain,
    toggleIK,
    toggleShadow,
  };

  // 统计已启用数量
  const enabledCount = [particleEnabled, terrainEnabled, ikEnabled, shadowEnabled].filter(
    Boolean,
  ).length;

  const containerClass = cn(
    'hud-panel font-mono',
    floating && 'absolute top-3 right-3 z-20 pointer-events-auto w-[340px]',
    !floating && 'w-full',
    'p-2.5',
    className,
  );

  return (
    <div className={containerClass}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between border-b border-neon-cyan/15 pb-1.5 group"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1.5 text-neon-cyan">
          <Power className="w-3.5 h-3.5" />
          <span className="font-display text-[11px] tracking-[0.22em]">
            {t('engineFeatures.title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] tracking-[0.18em] text-mist">
            {enabledCount}/4 ON
          </span>
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-mist transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="mt-2 grid grid-cols-1 gap-1.5">
          {FEATURES.map((feat) => {
            const { Icon, i18nKey, accent, switchable } = feat;
            const isActive = switchable && stateMap[feat.field];
            const onToggle = switchable ? toggleMap[feat.toggle] : undefined;

            return (
              <div
                key={i18nKey}
                className={cn(
                  'relative p-2 border bg-space-950/50 backdrop-blur-sm transition-all duration-200',
                  accentBorder(accent),
                  isActive && accentActiveBg(accent),
                )}
              >
                {/* neon glow corner */}
                <span
                  className={cn(
                    'absolute top-0 left-0 w-1.5 h-1.5',
                    accent === 'magenta' && 'bg-neon-magenta',
                    accent === 'amber' && 'bg-neon-amber',
                    accent === 'cyan' && 'bg-neon-cyan',
                  )}
                />

                <div className="flex items-start gap-2">
                  <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', accentText(accent))} />
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        'font-display text-[10px] tracking-[0.18em] truncate',
                        accentText(accent),
                      )}
                    >
                      {t(`${i18nKey}.title`)}
                    </div>
                    <div className="text-[9px] text-mist leading-relaxed mt-0.5">
                      {t(`${i18nKey}.desc`)}
                    </div>
                  </div>
                </div>

                {/* 启用按钮 */}
                {switchable && onToggle && (
                  <button
                    type="button"
                    onClick={onToggle}
                    className={cn(
                      'mt-1.5 w-full px-2 py-1 text-[9px] tracking-[0.18em] border transition-all',
                      isActive
                        ? cn(
                            accentText(accent),
                            accentBorder(accent),
                            accentActiveBg(accent),
                          )
                        : 'border-neon-cyan/15 text-mist hover:text-haze hover:border-neon-cyan/40',
                    )}
                    aria-pressed={isActive}
                  >
                    {isActive ? t('engineFeatures.actions.on') : t('engineFeatures.actions.enable')}
                  </button>
                )}
                {!switchable && (
                  <div className="mt-1.5 w-full px-2 py-1 text-[9px] tracking-[0.18em] text-mist/60 border border-neon-cyan/10 text-center">
                    {t('engineFeatures.actions.builtin')}
                  </div>
                )}
              </div>
            );
          })}

          {/* footer hint */}
          <div className="mt-1 text-[9px] text-mist/70 leading-relaxed border-t border-neon-cyan/10 pt-1.5">
            {t('engineFeatures.hint')}
          </div>
        </div>
      )}
    </div>
  );
}

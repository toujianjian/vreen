// ProfilerHUD — 性能分析 HUD overlay。
//
// 三 tab:CPU / GPU / System
//   - CPU:本帧 CPU 总耗时 + 各 mark 耗时 + mini 折线图
//   - GPU:本帧 GPU 耗时(若 EXT_disjoint_timer_query_webgl2 不可用则显示 N/A)
//   - System:ECS 各 System 执行时序(>1ms 红色高亮)
//
// 样式:cyberpunk neon 风格(沿用 hud-panel),可拖动?目前固定右下角。

import { useState } from 'react';
import { Activity, Cpu, Eye, EyeOff, Gauge, Layers, X, BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProfilerStore } from '@/stores/profilerStore';
import { FrameChart } from './FrameChart';
import { cn } from '@/lib/cn';

type Tab = 'cpu' | 'gpu' | 'system' | 'draws';

export function ProfilerHUD() {
  const { t } = useTranslation();
  const latest = useProfilerStore((s) => s.latest);
  const history = useProfilerStore((s) => s.history);
  const systemTimings = useProfilerStore((s) => s.systemTimings);
  const [tab, setTab] = useState<Tab>('cpu');
  const [minimized, setMinimized] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="pointer-events-auto absolute top-3 right-3 hud-btn hud-btn-ghost"
        title={t('profiler.show')}
      >
        <Activity className="w-3.5 h-3.5" />
        <span>PROFILER</span>
      </button>
    );
  }

  return (
    <div
      className="pointer-events-auto absolute top-3 right-3 w-[300px] max-w-[92vw] hud-panel"
      role="region"
      aria-label={t('profiler.title')}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neon-cyan/15">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-3.5 h-3.5 text-neon-cyan shrink-0" />
          <div className="min-w-0">
            <div className="hud-label text-neon-cyan">{t('profiler.title')}</div>
            <div className="font-mono text-[9px] text-mist">
              {latest ? `frame ${latest.frame} · ${latest.fps.toFixed(0)} fps` : t('profiler.idle')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized((m) => !m)}
            className="hud-btn-icon"
            title={minimized ? t('profiler.expand') : t('profiler.collapse')}
            aria-label={minimized ? t('profiler.expand') : t('profiler.collapse')}
          >
            {minimized ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </button>
          <button
            onClick={() => setVisible(false)}
            className="hud-btn-icon text-neon-magenta"
            title={t('profiler.hide')}
            aria-label={t('profiler.hide')}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-neon-cyan/10">
            {(['cpu', 'gpu', 'system', 'draws'] as Tab[]).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  'flex-1 px-2 py-1.5 font-mono text-[10px] tracking-[0.18em] transition-colors',
                  tab === k
                    ? k === 'gpu'
                      ? 'text-neon-magenta bg-neon-magenta/10'
                      : k === 'draws'
                        ? 'text-neon-cyan bg-neon-cyan/10'
                        : 'text-neon-cyan bg-neon-cyan/10'
                    : 'text-mist hover:text-haze',
                )}
              >
                {k === 'cpu' && <Cpu className="w-3 h-3 inline mr-1" />}
                {k === 'gpu' && <Gauge className="w-3 h-3 inline mr-1" />}
                {k === 'system' && <Layers className="w-3 h-3 inline mr-1" />}
                {k === 'draws' && <BarChart3 className="w-3 h-3 inline mr-1" />}
                {t(`profiler.tab.${k}`)}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="px-3 py-2 space-y-2">
            {tab === 'cpu' && <CpuTab />}
            {tab === 'gpu' && <GpuTab />}
            {tab === 'system' && <SystemTab />}
            {tab === 'draws' && <DrawsTab />}

            {/* 帧耗时历史折线图(一直显示) */}
            <div className="pt-1 border-t border-neon-cyan/10">
              <div className="hud-label mb-1">{t('profiler.history')}</div>
              <FrameChart data={history} width={276} height={56} showGpu={tab === 'gpu'} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CpuTab() {
  const { t } = useTranslation();
  const latest = useProfilerStore((s) => s.latest);
  if (!latest) return <div className="font-mono text-[10px] text-mist">{t('profiler.noData')}</div>;
  const markEntries = Object.entries(latest.marks).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="hud-label">{t('profiler.cpuTotal')}</span>
        <span className="font-mono text-[12px] text-neon-cyan">{latest.cpuMs.toFixed(2)} ms</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="hud-label">{t('profiler.fps')}</span>
        <span className="font-mono text-[12px] text-haze">{latest.fps.toFixed(1)}</span>
      </div>
      {latest.drawCalls != null && (
        <div className="flex items-baseline justify-between">
          <span className="hud-label">{t('profiler.drawCalls')}</span>
          <span className="font-mono text-[12px] text-haze">{latest.drawCalls}</span>
        </div>
      )}
      {markEntries.length > 0 && (
        <div className="pt-1 mt-1 border-t border-neon-cyan/10 space-y-0.5">
          <div className="hud-label mb-1">{t('profiler.marks')}</div>
          {markEntries.map(([name, ms]) => (
            <div key={name} className="flex items-baseline justify-between font-mono text-[10px]">
              <span className="text-mist truncate max-w-[160px]" title={name}>{name}</span>
              <span className={cn(ms > 4 ? 'text-neon-magenta' : 'text-haze')}>{ms.toFixed(2)} ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GpuTab() {
  const { t } = useTranslation();
  const latest = useProfilerStore((s) => s.latest);
  if (!latest) return <div className="font-mono text-[10px] text-mist">{t('profiler.noData')}</div>;
  if (latest.gpuMs == null) {
    return (
      <div className="font-mono text-[10px] text-mist space-y-1">
        <div>{t('profiler.gpuNa')}</div>
        <div className="text-[9px] text-mist/70">{t('profiler.gpuNaHint')}</div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="hud-label">{t('profiler.gpuTotal')}</span>
        <span className="font-mono text-[12px] text-neon-magenta">{latest.gpuMs.toFixed(2)} ms</span>
      </div>
      {latest.drawCalls != null && (
        <div className="flex items-baseline justify-between">
          <span className="hud-label">{t('profiler.drawCalls')}</span>
          <span className="font-mono text-[12px] text-haze">{latest.drawCalls}</span>
        </div>
      )}
      {latest.triangles != null && (
        <div className="flex items-baseline justify-between">
          <span className="hud-label">{t('profiler.tris')}</span>
          <span className="font-mono text-[12px] text-haze">{latest.triangles.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

function SystemTab() {
  const { t } = useTranslation();
  const systemTimings = useProfilerStore((s) => s.systemTimings);
  if (systemTimings.length === 0) {
    return <div className="font-mono text-[10px] text-mist">{t('profiler.noSystems')}</div>;
  }
  const max = systemTimings.reduce((m, s) => Math.max(m, s.duration), 0);
  return (
    <div className="space-y-1">
      <div className="hud-label mb-1">{t('profiler.systems')}</div>
      {systemTimings.map((s) => {
        const hot = s.duration > 1.0;
        const widthPct = max > 0 ? Math.max(2, (s.duration / max) * 100) : 2;
        return (
          <div key={s.name} className="flex items-center gap-2 font-mono text-[10px]">
            <span
              className={cn('w-[110px] truncate shrink-0', hot ? 'text-neon-magenta' : 'text-mist')}
              title={`${s.name} (priority ${s.priority})`}
            >
              {s.name}
            </span>
            <div className="flex-1 h-2 bg-space-800/60 border border-neon-cyan/10 relative overflow-hidden">
              <div
                className={cn('h-full transition-all', hot ? 'bg-neon-magenta/70' : 'bg-neon-cyan/60')}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className={cn('w-[44px] text-right shrink-0', hot ? 'text-neon-magenta' : 'text-haze')}>
              {s.duration.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DrawsTab() {
  const { t } = useTranslation();
  const latest = useProfilerStore((s) => s.latest);
  const breakdown = latest?.drawCallBreakdown;
  const total = latest?.drawCalls ?? 0;
  if (!breakdown || Object.keys(breakdown.byMesh).length === 0) {
    return <div className="font-mono text-[10px] text-mist">{t('profiler.noDraws')}</div>;
  }
  // 按 draw call 次数降序,取前 12
  const rows = Object.entries(breakdown.byMesh)
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 12);
  const maxCalls = Math.max(...rows.map((r) => r.calls), 1);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="hud-label">{t('profiler.topDraws')}</span>
        <span className="font-mono text-[10px] text-haze">
          total <span className="text-neon-cyan">{total}</span> · meshes <span className="text-neon-cyan">{rows.length}</span>
        </span>
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => {
          const widthPct = Math.max(2, (r.calls / maxCalls) * 100);
          // pass 标签:哪个 pass 命中了
          const tags: string[] = [];
          if (r.passes.main > 0) tags.push(`m×${r.passes.main}`);
          if (r.passes.shadow > 0) tags.push(`s×${r.passes.shadow}`);
          if (r.passes.ssao > 0) tags.push(`ao×${r.passes.ssao}`);
          if (r.passes.helper > 0) tags.push(`h×${r.passes.helper}`);
          const hot = r.calls > 4 || r.passes.shadow > 0;
          return (
            <div key={r.name} className="flex items-center gap-1.5 font-mono text-[10px]">
              <span
                className={cn('w-[112px] truncate shrink-0', hot ? 'text-neon-magenta' : 'text-mist')}
                title={r.name}
              >
                {r.name || '(unnamed)'}
              </span>
              <div className="flex-1 h-2 bg-space-800/60 border border-neon-cyan/10 relative overflow-hidden">
                <div
                  className={cn('h-full transition-all', hot ? 'bg-neon-magenta/70' : 'bg-neon-cyan/60')}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className={cn('w-[26px] text-right shrink-0', hot ? 'text-neon-magenta' : 'text-haze')}>
                {r.calls}×
              </span>
              <span className="w-[56px] text-right shrink-0 text-mist text-[9px]" title="passes">
                {tags.join(' ') || '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

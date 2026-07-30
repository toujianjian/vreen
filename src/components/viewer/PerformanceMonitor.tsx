// PerformanceMonitor — 实时性能监控面板(图表式)。
//
// 与 ProfilerHUD 互补:
//   - ProfilerHUD:浮动 overlay,tab 切换(CPU/GPU/System/Draws),文本为主
//   - PerformanceMonitor:面板式,聚焦 4 个核心指标(FPS/帧时间/内存/DrawCall)+ 折线图
//
// 数据源:profilerStore.latest + history(FrameSample ring buffer)
// 内存:优先使用 performance.memory(Chrome),不可用时显示 N/A
// 图表:纯 SVG 折线图,零依赖
// 样式:赛博朋克(neon + glassmorphism)

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ChevronDown, Cpu, Gauge, MemoryStick, RefreshCw } from 'lucide-react';
import { useProfilerStore } from '@/stores/profilerStore';
import { cn } from '@/lib/cn';

// performance.memory 是 Chrome 非标准 API,这里做类型放宽
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getMemoryMB(): number | null {
  const perf = performance as Performance & { memory?: PerformanceMemory };
  if (perf.memory && typeof perf.memory.usedJSHeapSize === 'number') {
    return perf.memory.usedJSHeapSize / (1024 * 1024);
  }
  return null;
}

/** 判定 FPS 健康度,返回对应霓虹色。 */
function fpsColor(fps: number): string {
  if (fps >= 55) return 'text-neon-cyan';
  if (fps >= 30) return 'text-neon-amber';
  return 'text-neon-magenta';
}

/** 判定帧时间健康度。 */
function frameTimeColor(ms: number): string {
  if (ms <= 16.7) return 'text-neon-cyan'; // 60fps 预算
  if (ms <= 33.3) return 'text-neon-amber'; // 30fps 预算
  return 'text-neon-magenta';
}

/** 构建 SVG 折线 path。 */
function buildLinePath(values: number[], width: number, height: number, min: number, max: number): string {
  if (values.length === 0) return '';
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

/** 构建 SVG 区域填充 path(折线 + 底部闭合)。 */
function buildAreaPath(values: number[], width: number, height: number, min: number, max: number): string {
  if (values.length === 0) return '';
  const line = buildLinePath(values, width, height, min, max);
  const lastX = (values.length - 1) * (values.length > 1 ? width / (values.length - 1) : 0);
  return `${line} L${lastX.toFixed(2)},${height} L0,${height} Z`;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  Icon: typeof Cpu;
  valueClass: string;
}

function StatCard({ label, value, sub, Icon, valueClass }: StatCardProps) {
  return (
    <div className="relative p-2 border border-neon-cyan/20 bg-space-950/50 backdrop-blur-sm">
      <span className="absolute top-0 left-0 w-1 h-1 bg-neon-cyan" />
      <div className="flex items-center gap-1 text-neon-cyan">
        <Icon className="w-3 h-3" />
        <span className="font-display text-[8px] tracking-[0.18em]">{label}</span>
      </div>
      <div className={cn('font-mono text-[16px] mt-0.5 leading-none', valueClass)}>
        {value}
      </div>
      {sub && <div className="font-mono text-[8px] text-mist mt-0.5">{sub}</div>}
    </div>
  );
}

interface SparklineProps {
  values: number[];
  width: number;
  height: number;
  color: 'cyan' | 'magenta' | 'amber';
  min?: number;
  max?: number;
  label: string;
  unit: string;
}

function Sparkline({ values, width, height, color, min, max, label, unit }: SparklineProps) {
  const { t } = useTranslation();
  const strokeClass =
    color === 'magenta' ? 'stroke-neon-magenta' : color === 'amber' ? 'stroke-neon-amber' : 'stroke-neon-cyan';
  const fillClass =
    color === 'magenta' ? 'fill-neon-magenta/10' : color === 'amber' ? 'fill-neon-amber/10' : 'fill-neon-cyan/10';

  const lo = min ?? (values.length > 0 ? Math.min(...values) : 0);
  const hi = max ?? (values.length > 0 ? Math.max(...values) : 1);
  // 加一点 padding 避免折线贴边
  const pad = (hi - lo) * 0.1 || 1;
  const minP = lo - pad;
  const maxP = hi + pad;

  const linePath = buildLinePath(values, width, height, minP, maxP);
  const areaPath = buildAreaPath(values, width, height, minP, maxP);
  const latest = values.length > 0 ? values[values.length - 1] : 0;

  return (
    <div className="p-1.5 border border-neon-cyan/15 bg-space-950/40">
      <div className="flex items-center justify-between mb-1">
        <span className="font-display text-[8px] tracking-[0.18em] text-mist">{label}</span>
        <span className="font-mono text-[9px] text-haze">
          {latest.toFixed(1)} {unit}
        </span>
      </div>
      {values.length === 0 ? (
        <div className="flex items-center justify-center text-[9px] text-mist/60" style={{ width, height }}>
          {t('performanceMonitor.noData')}
        </div>
      ) : (
        <svg width={width} height={height} className="overflow-visible">
          {/* 0 基线 */}
          <line
            x1={0}
            x2={width}
            y1={height}
            y2={height}
            className="stroke-neon-cyan/10"
            strokeWidth={0.5}
          />
          {/* 区域填充 */}
          {areaPath && <path d={areaPath} className={fillClass} />}
          {/* 折线 */}
          {linePath && (
            <path
              d={linePath}
              className={strokeClass}
              fill="none"
              strokeWidth={1.2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {/* 最新点 */}
          {values.length > 0 && (
            <circle
              cx={(values.length - 1) * (values.length > 1 ? width / (values.length - 1) : 0)}
              cy={height - ((latest - minP) / (maxP - minP)) * height}
              r={1.8}
              className={color === 'magenta' ? 'fill-neon-magenta' : color === 'amber' ? 'fill-neon-amber' : 'fill-neon-cyan'}
            />
          )}
        </svg>
      )}
    </div>
  );
}

export interface PerformanceMonitorProps {
  /** 初始是否展开,默认 true */
  defaultExpanded?: boolean;
  /** 是否显示为浮动面板,默认 false(内联) */
  floating?: boolean;
  /** 容器附加 className */
  className?: string;
  /** 图表宽度(像素),默认 280 */
  chartWidth?: number;
  /** 图表高度(像素),默认 48 */
  chartHeight?: number;
  /** 历史采样数,默认 60 */
  sampleCount?: number;
}

export function PerformanceMonitor({
  defaultExpanded = true,
  floating = false,
  className,
  chartWidth = 280,
  chartHeight = 48,
  sampleCount = 60,
}: PerformanceMonitorProps) {
  const { t } = useTranslation();
  const latest = useProfilerStore((s) => s.latest);
  const history = useProfilerStore((s) => s.history);
  const reset = useProfilerStore((s) => s.reset);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [memMB, setMemMB] = useState<number | null>(() => getMemoryMB());

  // 定时刷新内存读数(performance.memory 不主动推送)
  useEffect(() => {
    if (!('memory' in performance)) return;
    const id = window.setInterval(() => setMemMB(getMemoryMB()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // 从 history 取最近 N 帧的指标序列
  const series = useMemo(() => {
    const recent = history.slice(-sampleCount);
    return {
      fps: recent.map((f) => f.fps),
      frameTime: recent.map((f) => f.wallDeltaMs),
      cpuMs: recent.map((f) => f.cpuMs),
      drawCalls: recent.map((f) => f.drawCalls ?? 0),
    };
  }, [history, sampleCount]);

  // 聚合统计
  const stats = useMemo(() => {
    if (history.length === 0) {
      return { avgFps: 0, minFps: 0, maxFps: 0, avgFrameTime: 0, avgDrawCalls: 0 };
    }
    const recent = history.slice(-sampleCount);
    const fpsArr = recent.map((f) => f.fps);
    const ftArr = recent.map((f) => f.wallDeltaMs);
    const dcArr = recent.map((f) => f.drawCalls ?? 0);
    return {
      avgFps: fpsArr.reduce((a, b) => a + b, 0) / fpsArr.length,
      minFps: Math.min(...fpsArr),
      maxFps: Math.max(...fpsArr),
      avgFrameTime: ftArr.reduce((a, b) => a + b, 0) / ftArr.length,
      avgDrawCalls: dcArr.reduce((a, b) => a + b, 0) / dcArr.length,
    };
  }, [history, sampleCount]);

  const containerClass = cn(
    'hud-panel font-mono',
    floating && 'absolute bottom-3 left-3 z-20 pointer-events-auto w-[320px]',
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
        className="w-full flex items-center justify-between border-b border-neon-cyan/15 pb-1.5"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1.5 text-neon-cyan">
          <Activity className="w-3.5 h-3.5" />
          <span className="font-display text-[11px] tracking-[0.22em]">
            {t('performanceMonitor.title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {latest ? (
            <span className={cn('text-[9px] tracking-[0.18em]', fpsColor(latest.fps))}>
              {latest.fps.toFixed(0)} FPS
            </span>
          ) : (
            <span className="text-[9px] tracking-[0.18em] text-mist">{t('performanceMonitor.idle')}</span>
          )}
          <ChevronDown
            className={cn('w-3.5 h-3.5 text-mist transition-transform', expanded && 'rotate-180')}
          />
        </div>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* 4 个核心指标卡片 */}
          <div className="grid grid-cols-2 gap-1.5">
            <StatCard
              label={t('performanceMonitor.fps')}
              value={latest ? latest.fps.toFixed(1) : '—'}
              sub={latest ? `${t('performanceMonitor.avg')} ${stats.avgFps.toFixed(0)} · ${t('performanceMonitor.min')} ${stats.minFps.toFixed(0)}` : undefined}
              Icon={Gauge}
              valueClass={latest ? fpsColor(latest.fps) : 'text-mist'}
            />
            <StatCard
              label={t('performanceMonitor.frameTime')}
              value={latest ? `${latest.wallDeltaMs.toFixed(2)} ms` : '—'}
              sub={latest ? `${t('performanceMonitor.avg')} ${stats.avgFrameTime.toFixed(2)} ms` : undefined}
              Icon={Cpu}
              valueClass={latest ? frameTimeColor(latest.wallDeltaMs) : 'text-mist'}
            />
            <StatCard
              label={t('performanceMonitor.drawCalls')}
              value={latest && latest.drawCalls != null ? String(latest.drawCalls) : '—'}
              sub={latest && latest.drawCalls != null ? `${t('performanceMonitor.avg')} ${stats.avgDrawCalls.toFixed(0)}` : undefined}
              Icon={Activity}
              valueClass="text-neon-cyan"
            />
            <StatCard
              label={t('performanceMonitor.memory')}
              value={memMB != null ? `${memMB.toFixed(1)} MB` : 'N/A'}
              sub={latest && latest.triangles != null ? `${t('performanceMonitor.triangles')}: ${latest.triangles.toLocaleString()}` : undefined}
              Icon={MemoryStick}
              valueClass={memMB != null ? (memMB > 200 ? 'text-neon-magenta' : memMB > 100 ? 'text-neon-amber' : 'text-neon-cyan') : 'text-mist'}
            />
          </div>

          {/* 图表区 */}
          <div className="space-y-1">
            <Sparkline
              values={series.fps}
              width={chartWidth}
              height={chartHeight}
              color="cyan"
              min={0}
              max={Math.max(60, ...series.fps, 1)}
              label={t('performanceMonitor.fpsHistory')}
              unit="fps"
            />
            <Sparkline
              values={series.frameTime}
              width={chartWidth}
              height={chartHeight}
              color="magenta"
              min={0}
              max={Math.max(33, ...series.frameTime, 1)}
              label={t('performanceMonitor.frameTimeHistory')}
              unit="ms"
            />
            <Sparkline
              values={series.drawCalls}
              width={chartWidth}
              height={chartHeight}
              color="amber"
              min={0}
              max={Math.max(10, ...series.drawCalls, 1)}
              label={t('performanceMonitor.drawCallsHistory')}
              unit=""
            />
          </div>

          {/* footer:重置 + 采样数 */}
          <div className="flex items-center justify-between border-t border-neon-cyan/10 pt-1.5">
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 text-[9px] tracking-[0.18em] text-mist hover:text-neon-magenta transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {t('performanceMonitor.reset')}
            </button>
            <span className="text-[8px] text-mist/60 tracking-[0.18em]">
              {history.length}/{sampleCount} {t('performanceMonitor.samples')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

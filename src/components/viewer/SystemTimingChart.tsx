// SystemTimingChart — 60 帧 system 执行时序 stacked-bar 迷你图。
//
// 数据来源:World.getTimingHistory() — 最多 60 帧,每帧一份 SystemTiming[]。
// 渲染:每一帧一根垂直条,沿 Y 方向按 system 时长堆叠。鼠标 hover 弹出明细。
// 配色:system name → HSL 稳定 hash(用 djb2)。色相固定,亮度和饱和度走 neon 风格。
// 不引入外部 chart 库;纯 SVG 自绘。

import { useEffect, useMemo, useState } from 'react';
import type { SystemTiming } from '@/engine/ECS/World';
import { cn } from '@/lib/cn';

interface SystemTimingChartProps {
  /** 历史帧数据(每帧一条)。World.getTimingHistory() 直接喂进来。 */
  history: ReadonlyArray<ReadonlyArray<SystemTiming>>;
  /** 当前帧号(用于在 x 轴上标 'now')。 */
  currentFrame?: number;
  /** 高度,默认 64px 够看 60 帧趋势。 */
  height?: number;
}

const FRAME_WIDTH = 4;          // 每帧 4px,60 帧 = 240px
const FRAME_GAP = 1;            // 帧间隙
const COLORS = [
  '#22d3ee', // cyan
  '#a78bfa', // violet
  '#f472b6', // pink
  '#facc15', // amber
  '#4ade80', // green
  '#fb923c', // orange
  '#60a5fa', // blue
  '#e879f9', // fuchsia
  '#34d399', // emerald
  '#f87171', // red
  '#c084fc', // purple
  '#fde047', // yellow
];

/** djb2 hash → index for stable per-system color. */
function colorFor(name: string): string {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h) + name.charCodeAt(i);
    h = h & 0x7fffffff;
  }
  return COLORS[h % COLORS.length];
}

export function SystemTimingChart({
  history,
  currentFrame,
  height = 64,
}: SystemTimingChartProps) {
  // 稳定 system 名 → 颜色;出现在历史里第一次就锁住。
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const frame of history) {
      for (const t of frame) {
        if (!m.has(t.name)) m.set(t.name, colorFor(t.name));
      }
    }
    return m;
  }, [history]);

  // 找最大单帧总时长,作为 y 轴归一化基准(用 99% 分位避免尖刺压扁整体)。
  const maxFrameMs = useMemo(() => {
    if (history.length === 0) return 1;
    const totals = history.map((f) => f.reduce((s, t) => s + t.duration, 0));
    totals.sort((a, b) => a - b);
    const p = totals[Math.floor(totals.length * 0.99)] ?? totals[totals.length - 1] ?? 1;
    return Math.max(p, 0.5);
  }, [history]);

  // 平均与最近 12 帧的趋势提示
  const stats = useMemo(() => {
    if (history.length === 0) return { avg: 0, last: 0, peak: 0, lastFrame: 0 };
    const lastFrame = history[history.length - 1] ?? [];
    const last = lastFrame.reduce((s, t) => s + t.duration, 0);
    const sum = history.reduce((s, f) => s + f.reduce((x, t) => x + t.duration, 0), 0);
    const avg = sum / history.length;
    const peak = Math.max(...history.map((f) => f.reduce((s, t) => s + t.duration, 0)));
    return { avg, last, peak, lastFrame: lastFrame.length };
  }, [history]);

  const [hover, setHover] = useState<{ frameIdx: number; x: number; y: number } | null>(null);
  // 关闭 hover 提示
  useEffect(() => {
    if (hover == null) return;
    const onScroll = () => setHover(null);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [hover]);

  if (history.length === 0) {
    return (
      <div className="text-mist font-mono text-[10px] py-1.5">
        no frames yet
      </div>
    );
  }

  const W = history.length * (FRAME_WIDTH + FRAME_GAP);
  const hoverFrame = hover ? history[hover.frameIdx] : null;

  return (
    <div className="border border-neon-cyan/10 bg-space-900/30 p-1.5 font-mono">
      <div className="flex items-center justify-between mb-1 text-[9px]">
        <span className="hud-label flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan" />
          TIMING · {history.length} frames
        </span>
        <div className="flex items-center gap-2 text-mist">
          <span>
            last <span className="text-haze">{stats.last.toFixed(2)}</span>ms
          </span>
          <span>
            avg <span className="text-haze">{stats.avg.toFixed(2)}</span>ms
          </span>
          <span>
            peak <span className={stats.peak > 4 ? 'text-neon-magenta' : 'text-haze'}>{stats.peak.toFixed(2)}</span>ms
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          width={W}
          height={height}
          viewBox={`0 0 ${W} ${height}`}
          className="block"
          onMouseLeave={() => setHover(null)}
        >
          {/* 基线 */}
          <line
            x1={0} y1={height - 0.5}
            x2={W} y2={height - 0.5}
            stroke="#0e7490" strokeOpacity={0.3} strokeWidth={0.5}
          />
          {/* 16ms (60fps) 参考线 */}
          {maxFrameMs >= 16 && (
            <line
              x1={0} y1={height - (16 / maxFrameMs) * (height - 2) - 0.5}
              x2={W} y2={height - (16 / maxFrameMs) * (height - 2) - 0.5}
              stroke="#a78bfa" strokeOpacity={0.35} strokeWidth={0.5} strokeDasharray="2 2"
            />
          )}
          {/* 当前帧高亮列 */}
          {currentFrame != null && (
            <rect
              x={(history.length - 1) * (FRAME_WIDTH + FRAME_GAP) - 1}
              y={0}
              width={FRAME_WIDTH + 2}
              height={height}
              fill="#22d3ee" fillOpacity={0.05}
            />
          )}
          {/* 每帧 stacked bar */}
          {history.map((frame, i) => {
            const x = i * (FRAME_WIDTH + FRAME_GAP);
            let yCursor = height;
            return (
              <g
                key={i}
                onMouseEnter={(ev) => {
                  const rect = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({
                    frameIdx: i,
                    x: rect.left + x + FRAME_WIDTH / 2,
                    y: rect.top,
                  });
                }}
              >
                {frame.map((t) => {
                  if (t.duration <= 0) return null;
                  const h = (t.duration / maxFrameMs) * (height - 2);
                  yCursor -= h;
                  return (
                    <rect
                      key={t.name}
                      x={x}
                      y={yCursor}
                      width={FRAME_WIDTH}
                      height={Math.max(0.5, h)}
                      fill={colorMap.get(t.name) ?? '#22d3ee'}
                      fillOpacity={t.enabled ? 0.85 : 0.3}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* hover tooltip */}
        {hover != null && hoverFrame && (
          <div
            className="pointer-events-none fixed z-50 border border-neon-cyan/40 bg-space-900/95 px-2 py-1 font-mono text-[9px] text-haze shadow-lg"
            style={{ left: hover.x, top: hover.y - 4, transform: 'translate(-50%, -100%)' }}
          >
            <div className="text-neon-cyan mb-0.5">
              frame #{hover.frameIdx} · total{' '}
              {hoverFrame.reduce((s, t) => s + t.duration, 0).toFixed(2)}ms
            </div>
            {hoverFrame
              .slice()
              .sort((a, b) => b.duration - a.duration)
              .map((t) => (
                <div key={t.name} className="flex items-center gap-1.5 leading-tight">
                  <span
                    className="w-1.5 h-1.5 inline-block shrink-0"
                    style={{ background: colorMap.get(t.name) ?? '#22d3ee' }}
                  />
                  <span className={t.enabled ? 'text-haze' : 'text-mist/50'}>{t.name}</span>
                  <span className="ml-auto text-mist">{t.duration.toFixed(2)}ms</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Legend:列出该 chart 里出现过的所有 system + 颜色 */}
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
        {Array.from(colorMap.entries()).map(([name, c]) => (
          <span key={name} className="flex items-center gap-1 text-mist">
            <span className="w-1.5 h-1.5 inline-block" style={{ background: c }} />
            {name}
          </span>
        ))}
        <span className="ml-auto text-mist/60">p99={maxFrameMs.toFixed(2)}ms</span>
      </div>

      <div className={cn('mt-1 text-[9px] text-mist/70 flex items-center gap-2')}>
        <span>↓ 16.67ms = 60fps budget</span>
        {stats.last > 16.67 && (
          <span className="text-neon-magenta">⚠ last frame over budget</span>
        )}
      </div>
    </div>
  );
}

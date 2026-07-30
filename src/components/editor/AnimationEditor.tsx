// AnimationEditor — 动画编辑器面板。
// 时间轴(可拖拽播放头)+ 关键帧列表(增删改)+ 曲线编辑器(贝塞尔)+
// 动画层管理 + 播放/暂停/停止/循环。赛博朋克风格(霓虹色 + 暗色背景),
// 复用 HudPanel / ColorField 框架。

import {
  ChevronDown,
  ChevronRight,
  Diamond,
  GitCommitVertical,
  Layers,
  Pause,
  Play,
  Plus,
  Repeat,
  Spline,
  Square,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { cn } from '@/lib/cn';

// ── 类型 ──────────────────────────────────────────────────

/** 轨道类型。 */
export type TrackType = 'position' | 'rotation' | 'scale' | 'morph';

/** 关键帧插值模式。 */
export type InterpolationType = 'linear' | 'step' | 'bezier';

/** 关键帧。 */
export interface Keyframe {
  id: string;
  /** 时间 (s)。 */
  time: number;
  /** 值 (标量;对 Vector3 轨道代表主分量)。 */
  value: number;
  interpolation: InterpolationType;
  /** 贝塞尔切入切线 (-1..1 归一化偏移)。 */
  tangentIn?: number;
  /** 贝塞尔切出切线。 */
  tangentOut?: number;
}

/** 动画轨道。 */
export interface AnimationTrack {
  id: string;
  name: string;
  type: TrackType;
  keyframes: Keyframe[];
  /** 轨道颜色 (hex)。 */
  color: string;
  /** 是否启用(层管理)。 */
  enabled?: boolean;
  /** 是否锁定。 */
  locked?: boolean;
}

interface AnimationEditorProps {
  tracks: AnimationTrack[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isLooping: boolean;
  onAddKeyframe: (trackId: string, time: number, value: number) => void;
  onRemoveKeyframe: (trackId: string, keyframeId: string) => void;
  onUpdateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  onTimeChange: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onLoop: (loop: boolean) => void;
  /** 轨道启用/锁定切换 (可选,层管理)。 */
  onTrackToggle?: (trackId: string, field: 'enabled' | 'locked', value: boolean) => void;
}

// ── 常量 ──────────────────────────────────────────────────

const TRACK_TYPES: TrackType[] = ['position', 'rotation', 'scale', 'morph'];

const INTERP_MODES: InterpolationType[] = ['linear', 'step', 'bezier'];

/** 轨道标签列宽度 (px)。 */
const LABEL_WIDTH = 140;
/** 时间轴左/右内边距 (px)。 */
const TIMELINE_PAD = 8;

// ── 工具 ──────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 100);
  return `${m}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

/** 计算轨道值域 (带 padding)。 */
function computeValueRange(keyframes: Keyframe[]): { min: number; max: number } {
  if (keyframes.length === 0) return { min: -1, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const k of keyframes) {
    if (k.value < min) min = k.value;
    if (k.value > max) max = k.value;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  return { min: min - pad, max: max + pad };
}

// ── 主组件 ────────────────────────────────────────────────

export function AnimationEditor({
  tracks,
  currentTime,
  duration,
  isPlaying,
  isLooping,
  onAddKeyframe,
  onRemoveKeyframe,
  onUpdateKeyframe,
  onTimeChange,
  onPlay,
  onPause,
  onStop,
  onLoop,
  onTrackToggle,
}: AnimationEditorProps) {
  const { t } = useTranslation();
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
    tracks[0]?.id ?? null,
  );
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);

  // 选中轨道变化时清空关键帧选中
  useEffect(() => {
    setSelectedKeyframeId(null);
  }, [selectedTrackId]);

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null;
  const selectedKeyframe =
    selectedTrack?.keyframes.find((k) => k.id === selectedKeyframeId) ?? null;

  return (
    <HudPanel
      title={t('animationEditor.title')}
      tag="ANIM"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 flex flex-col"
    >
      {/* 顶部工具栏 */}
      <Toolbar
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        isLooping={isLooping}
        onPlay={onPlay}
        onPause={onPause}
        onStop={onStop}
        onLoop={onLoop}
      />

      {/* 时间轴 + 轨道 */}
      <TimelineArea
        tracks={tracks}
        currentTime={currentTime}
        duration={duration}
        selectedTrackId={selectedTrackId}
        selectedKeyframeId={selectedKeyframeId}
        onSelectTrack={setSelectedTrackId}
        onSelectKeyframe={setSelectedKeyframeId}
        onTimeChange={onTimeChange}
        onAddKeyframe={onAddKeyframe}
        onTrackToggle={onTrackToggle}
      />

      {/* 曲线编辑器 */}
      <CurveEditor
        track={selectedTrack}
        currentTime={currentTime}
        duration={duration}
        selectedKeyframeId={selectedKeyframeId}
        onSelectKeyframe={setSelectedKeyframeId}
        onUpdateKeyframe={onUpdateKeyframe}
      />

      {/* 关键帧属性面板 */}
      <KeyframePanel
        keyframe={selectedKeyframe}
        track={selectedTrack}
        duration={duration}
        onUpdate={(updates) => {
          if (selectedTrackId && selectedKeyframeId) {
            onUpdateKeyframe(selectedTrackId, selectedKeyframeId, updates);
          }
        }}
        onRemove={() => {
          if (selectedTrackId && selectedKeyframeId) {
            onRemoveKeyframe(selectedTrackId, selectedKeyframeId);
            setSelectedKeyframeId(null);
          }
        }}
      />
    </HudPanel>
  );
}

// ── 顶部工具栏 ────────────────────────────────────────────

function Toolbar({
  currentTime,
  duration,
  isPlaying,
  isLooping,
  onPlay,
  onPause,
  onStop,
  onLoop,
}: {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isLooping: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onLoop: (loop: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 px-3 py-2 border-b border-neon-cyan/15 flex items-center gap-2 bg-space-900/40">
      <div className="flex items-center gap-1">
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="hud-btn !px-2 !py-1"
          title={isPlaying ? t('animationEditor.pause') : t('animationEditor.play')}
        >
          {isPlaying ? (
            <Pause className="w-3 h-3" />
          ) : (
            <Play className="w-3 h-3" />
          )}
        </button>
        <button
          onClick={onStop}
          className="hud-btn !px-2 !py-1"
          title={t('animationEditor.stop')}
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => onLoop(!isLooping)}
          className={cn(
            'hud-btn !px-2 !py-1',
            isLooping && '!border-neon-magenta !text-neon-magenta',
          )}
          title={t('animationEditor.loop')}
        >
          <Repeat className="w-3 h-3" />
        </button>
      </div>

      <div className="ml-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em]">
        <span className="text-neon-cyan tabular-nums">{formatTime(currentTime)}</span>
        <span className="text-mist">/</span>
        <span className="text-haze/70 tabular-nums">{formatTime(duration)}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono tracking-[0.14em] uppercase">
        <Layers className="w-3 h-3 text-neon-cyan/70" />
        <span className="text-haze/70">{t('animationEditor.duration')}</span>
      </div>
    </div>
  );
}

// ── 时间轴区域 (标尺 + 轨道 + 播放头) ────────────────────

function TimelineArea({
  tracks,
  currentTime,
  duration,
  selectedTrackId,
  selectedKeyframeId,
  onSelectTrack,
  onSelectKeyframe,
  onTimeChange,
  onAddKeyframe,
  onTrackToggle,
}: {
  tracks: AnimationTrack[];
  currentTime: number;
  duration: number;
  selectedTrackId: string | null;
  selectedKeyframeId: string | null;
  onSelectTrack: (id: string) => void;
  onSelectKeyframe: (id: string | null) => void;
  onTimeChange: (time: number) => void;
  onAddKeyframe: (trackId: string, time: number, value: number) => void;
  onTrackToggle?: (trackId: string, field: 'enabled' | 'locked', value: boolean) => void;
}) {
  const { t } = useTranslation();
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);

  // 测量时间轴宽度
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () => setAreaWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timelineWidth = Math.max(0, areaWidth - LABEL_WIDTH - TIMELINE_PAD * 2);
  const safeDuration = duration > 0 ? duration : 1;

  const timeToX = useCallback(
    (time: number) => TIMELINE_PAD + (time / safeDuration) * timelineWidth,
    [safeDuration, timelineWidth],
  );
  const xToTime = useCallback(
    (x: number) => clamp(((x - TIMELINE_PAD) / timelineWidth) * safeDuration, 0, safeDuration),
    [safeDuration, timelineWidth],
  );

  // 播放头拖拽
  useEffect(() => {
    if (!draggingPlayhead) return;
    const onMove = (e: MouseEvent) => {
      const el = areaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      onTimeChange(xToTime(x));
    };
    const onUp = () => setDraggingPlayhead(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingPlayhead, xToTime, onTimeChange]);

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    const el = areaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL_WIDTH;
    onTimeChange(xToTime(x));
    setDraggingPlayhead(true);
  };

  // 标尺刻度
  const tickCount = 10;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (i / tickCount) * safeDuration);
  const playheadX = timeToX(currentTime);

  return (
    <div className="shrink-0 border-b border-neon-cyan/10 overflow-hidden">
      {/* 标尺行 */}
      <div className="flex items-stretch bg-space-900/30">
        <div
          className="shrink-0 flex items-center px-2 py-1 border-r border-neon-cyan/10 font-mono text-[9px] tracking-[0.16em] text-mist uppercase"
          style={{ width: LABEL_WIDTH }}
        >
          {t('animationEditor.timeline')}
        </div>
        <div
          ref={areaRef}
          className="relative flex-1 cursor-text select-none"
          onMouseDown={handleRulerMouseDown}
        >
          {/* 刻度 */}
          <div className="relative h-6">
            {ticks.map((tk, i) => {
              const x = timeToX(tk);
              return (
                <div
                  key={i}
                  className="absolute top-0 h-full flex flex-col items-center"
                  style={{ left: x, transform: 'translateX(-50%)' }}
                >
                  <span className="block w-px h-2 bg-neon-cyan/30" />
                  <span className="mt-0.5 font-mono text-[8px] text-haze/60 tabular-nums">
                    {tk.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 轨道列表 */}
      <div className="relative max-h-[220px] overflow-y-auto">
        {tracks.length === 0 && (
          <div className="px-3 py-4 text-mist text-center text-[10px] font-mono">
            {t('animationEditor.noTrack')}
          </div>
        )}
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            selected={track.id === selectedTrackId}
            selectedKeyframeId={selectedKeyframeId}
            labelWidth={LABEL_WIDTH}
            timeToX={timeToX}
            currentTime={currentTime}
            onSelectTrack={() => onSelectTrack(track.id)}
            onSelectKeyframe={onSelectKeyframe}
            onAddKeyframe={onAddKeyframe}
            onTrackToggle={onTrackToggle}
          />
        ))}

        {/* 播放头覆盖线 (跨所有轨道) */}
        {tracks.length > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-neon-magenta/80 pointer-events-none z-10"
            style={{ left: LABEL_WIDTH + playheadX }}
          >
            <span className="absolute -top-0 -translate-x-1/2 w-2 h-2 bg-neon-magenta rotate-45" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 轨道行 ────────────────────────────────────────────────

function TrackRow({
  track,
  selected,
  selectedKeyframeId,
  labelWidth,
  timeToX,
  currentTime,
  onSelectTrack,
  onSelectKeyframe,
  onAddKeyframe,
  onTrackToggle,
}: {
  track: AnimationTrack;
  selected: boolean;
  selectedKeyframeId: string | null;
  labelWidth: number;
  timeToX: (t: number) => number;
  currentTime: number;
  onSelectTrack: () => void;
  onSelectKeyframe: (id: string | null) => void;
  onAddKeyframe: (trackId: string, time: number, value: number) => void;
  onTrackToggle?: (trackId: string, field: 'enabled' | 'locked', value: boolean) => void;
}) {
  const { t } = useTranslation();
  const enabled = track.enabled !== false;

  const handleAddAtPlayhead = () => {
    if (track.locked) return;
    // 在播放头位置插入关键帧,值取该时刻的采样(简化:取最近关键帧值或 0)
    const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
    let value = 0;
    if (sorted.length > 0) {
      let prev = sorted[0];
      for (const k of sorted) {
        if (k.time <= currentTime) prev = k;
        else break;
      }
      value = prev.value;
    }
    onAddKeyframe(track.id, currentTime, value);
  };

  return (
    <div
      className={cn(
        'flex items-stretch border-b border-neon-cyan/5 transition-colors',
        selected ? 'bg-neon-cyan/[0.06]' : 'hover:bg-neon-cyan/[0.03]',
      )}
    >
      {/* 标签列 */}
      <div
        className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-r border-neon-cyan/10"
        style={{ width: labelWidth }}
      >
        <span
          className="w-2 h-2 shrink-0"
          style={{ backgroundColor: track.color, opacity: enabled ? 1 : 0.3 }}
        />
        <button
          onClick={onSelectTrack}
          className="flex-1 min-w-0 text-left font-mono text-[10px] tracking-[0.1em] text-haze truncate hover:text-neon-cyan transition-colors"
          title={track.name}
        >
          {track.name}
        </button>
        <span className="font-mono text-[8px] text-mist/70 uppercase tracking-[0.12em] shrink-0">
          {track.type.slice(0, 3)}
        </span>
        {onTrackToggle && (
          <button
            onClick={() => onTrackToggle(track.id, 'enabled', !enabled)}
            className={cn(
              'shrink-0 w-3 h-3 border text-[7px] font-mono leading-none flex items-center justify-center',
              enabled
                ? 'border-neon-cyan/40 text-neon-cyan'
                : 'border-mist/30 text-mist/40',
            )}
            title={t('animationEditor.track')}
          >
            {enabled ? '●' : '○'}
          </button>
        )}
      </div>

      {/* 关键帧列 */}
      <div
        className="relative flex-1 h-7"
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelectKeyframe(null);
        }}
      >
        {/* 轨道基线 */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-neon-cyan/10" />

        {/* 关键帧菱形 */}
        {track.keyframes.map((k) => {
          const x = timeToX(k.time);
          const isSel = k.id === selectedKeyframeId && selected;
          return (
            <button
              key={k.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectTrack();
                onSelectKeyframe(k.id);
              }}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: x }}
              title={`${k.time.toFixed(2)}s · ${k.value.toFixed(3)}`}
            >
              <Diamond
                className={cn(
                  'w-2.5 h-2.5',
                  isSel ? 'text-neon-magenta fill-neon-magenta/40' : 'fill-transparent',
                )}
                style={{ color: isSel ? undefined : track.color }}
                strokeWidth={isSel ? 2 : 1.5}
              />
            </button>
          );
        })}

        {/* 双击空白添加关键帧 */}
        <button
          onClick={handleAddAtPlayhead}
          disabled={track.locked}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-mist/40 hover:text-neon-magenta disabled:opacity-30"
          title={t('animationEditor.addKeyframe')}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── 曲线编辑器 ────────────────────────────────────────────

function CurveEditor({
  track,
  currentTime,
  duration,
  selectedKeyframeId,
  onSelectKeyframe,
  onUpdateKeyframe,
}: {
  track: AnimationTrack | null;
  currentTime: number;
  duration: number;
  selectedKeyframeId: string | null;
  onSelectKeyframe: (id: string | null) => void;
  onUpdateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
}) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 320, h: 140 });
  const [drag, setDrag] = useState<
    | { kind: 'keyframe'; id: string; offsetX: number; offsetY: number }
    | { kind: 'tangentIn'; id: string }
    | { kind: 'tangentOut'; id: string }
    | null
  >(null);

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

  const pad = { l: 28, r: 12, t: 10, b: 18 };
  const plotW = Math.max(0, size.w - pad.l - pad.r);
  const plotH = Math.max(0, size.h - pad.t - pad.b);
  const safeDuration = duration > 0 ? duration : 1;

  const range = track ? computeValueRange(track.keyframes) : { min: -1, max: 1 };

  const timeToX = (time: number) => pad.l + (time / safeDuration) * plotW;
  const valueToY = (v: number) =>
    pad.t + (1 - (v - range.min) / (range.max - range.min || 1)) * plotH;
  const xToTime = (x: number) => clamp(((x - pad.l) / plotW) * safeDuration, 0, safeDuration);
  const yToValue = (y: number) => {
    const norm = 1 - (y - pad.t) / plotH;
    return range.min + norm * (range.max - range.min);
  };

  // 拖拽处理
  useEffect(() => {
    if (!drag || !track) return;
    const onMove = (e: MouseEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (drag.kind === 'keyframe') {
        const time = xToTime(x);
        const value = yToValue(y);
        onUpdateKeyframe(track.id, drag.id, { time, value });
      } else {
        // 切线: 用相对 keyframe 的偏移作为切线斜率
        const kf = track.keyframes.find((k) => k.id === drag.id);
        if (!kf) return;
        const dx = x - timeToX(kf.time);
        const dy = y - valueToY(kf.value);
        const tangent = dx !== 0 ? -dy / dx : 0;
        if (drag.kind === 'tangentIn') {
          onUpdateKeyframe(track.id, drag.id, { tangentIn: clamp(tangent, -5, 5) });
        } else {
          onUpdateKeyframe(track.id, drag.id, { tangentOut: clamp(tangent, -5, 5) });
        }
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, track, plotW, plotH, range, safeDuration, onUpdateKeyframe]);

  const playheadX = timeToX(currentTime);

  // 构建曲线路径
  const buildPath = (): string => {
    if (!track || track.keyframes.length === 0) return '';
    const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
    let d = `M ${timeToX(sorted[0].time)} ${valueToY(sorted[0].value)}`;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.interpolation === 'step') {
        d += ` L ${timeToX(cur.time)} ${valueToY(prev.value)}`;
        d += ` L ${timeToX(cur.time)} ${valueToY(cur.value)}`;
      } else if (prev.interpolation === 'bezier' && prev.tangentOut != null && cur.tangentIn != null) {
        const x0 = timeToX(prev.time), y0 = valueToY(prev.value);
        const x1 = timeToX(cur.time), y1 = valueToY(cur.value);
        const dx = (x1 - x0) / 3;
        const cx1 = x0 + dx, cy1 = y0 - prev.tangentOut * dx;
        const cx2 = x1 - dx, cy2 = y1 + cur.tangentIn * dx;
        d += ` C ${cx1} ${cy1} ${cx2} ${cy2} ${x1} ${y1}`;
      } else {
        d += ` L ${timeToX(cur.time)} ${valueToY(cur.value)}`;
      }
    }
    return d;
  };

  return (
    <div className="shrink-0 border-b border-neon-cyan/10">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-neon-cyan/5">
        <Spline className="w-3 h-3 text-neon-magenta" />
        <span className="font-display text-[10px] tracking-[0.2em] text-haze uppercase">
          {t('animationEditor.curveEditor')}
        </span>
        {track && (
          <span className="ml-auto font-mono text-[9px] text-mist/70 tracking-[0.12em] truncate">
            {track.name}
          </span>
        )}
      </div>
      <div className="relative bg-space-900/30" style={{ height: 160 }}>
        {!track ? (
          <div className="absolute inset-0 flex items-center justify-center text-mist text-[10px] font-mono">
            {t('animationEditor.noTrack')}
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="w-full h-full"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) onSelectKeyframe(null);
            }}
          >
            {/* 网格 */}
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
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
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <line
                key={`v${g}`}
                y1={pad.t}
                y2={size.h - pad.b}
                x1={pad.l + g * plotW}
                x2={pad.l + g * plotW}
                stroke="rgba(0,240,255,0.08)"
                strokeWidth={1}
              />
            ))}
            {/* 轴标签 */}
            <text x={4} y={pad.t + 4} className="fill-mist/50 font-mono" fontSize={8}>
              {range.max.toFixed(1)}
            </text>
            <text x={4} y={size.h - pad.b} className="fill-mist/50 font-mono" fontSize={8}>
              {range.min.toFixed(1)}
            </text>
            <text x={pad.l} y={size.h - 4} className="fill-mist/50 font-mono" fontSize={8}>
              0
            </text>
            <text x={size.w - pad.r - 18} y={size.h - 4} className="fill-mist/50 font-mono" fontSize={8}>
              {safeDuration.toFixed(1)}s
            </text>

            {/* 曲线 */}
            {track.keyframes.length > 0 && (
              <path
                d={buildPath()}
                fill="none"
                stroke={track.color}
                strokeWidth={1.5}
                opacity={0.9}
              />
            )}

            {/* 播放头 */}
            <line
              x1={playheadX}
              x2={playheadX}
              y1={pad.t}
              y2={size.h - pad.b}
              stroke="rgba(255,43,214,0.6)"
              strokeWidth={1}
            />

            {/* 关键帧 + 切线手柄 */}
            {track.keyframes.map((k) => {
              const kx = timeToX(k.time);
              const ky = valueToY(k.value);
              const isSel = k.id === selectedKeyframeId;
              const dx = (plotW / Math.max(1, track.keyframes.length)) / 4;
              return (
                <g key={k.id}>
                  {/* 切线手柄 (仅选中 bezier 关键帧显示) */}
                  {isSel && k.interpolation === 'bezier' && (
                    <>
                      {k.tangentIn != null && (
                        <g
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDrag({ kind: 'tangentIn', id: k.id });
                          }}
                          style={{ cursor: 'ew-resize' }}
                        >
                          <line
                            x1={kx - dx}
                            y1={ky + k.tangentIn * dx}
                            x2={kx}
                            y2={ky}
                            stroke="rgba(255,43,214,0.5)"
                            strokeWidth={1}
                          />
                          <circle
                            cx={kx - dx}
                            cy={ky + k.tangentIn * dx}
                            r={3}
                            fill="rgba(255,43,214,0.8)"
                          />
                        </g>
                      )}
                      {k.tangentOut != null && (
                        <g
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDrag({ kind: 'tangentOut', id: k.id });
                          }}
                          style={{ cursor: 'ew-resize' }}
                        >
                          <line
                            x1={kx}
                            y1={ky}
                            x2={kx + dx}
                            y2={ky - k.tangentOut * dx}
                            stroke="rgba(255,43,214,0.5)"
                            strokeWidth={1}
                          />
                          <circle
                            cx={kx + dx}
                            cy={ky - k.tangentOut * dx}
                            r={3}
                            fill="rgba(255,43,214,0.8)"
                          />
                        </g>
                      )}
                    </>
                  )}
                  {/* 关键帧点 */}
                  <circle
                    cx={kx}
                    cy={ky}
                    r={isSel ? 5 : 3.5}
                    fill={isSel ? '#ff2bd6' : '#0a0e1a'}
                    stroke={track.color}
                    strokeWidth={isSel ? 2 : 1.5}
                    style={{ cursor: 'grab' }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onSelectKeyframe(k.id);
                      setDrag({ kind: 'keyframe', id: k.id, offsetX: 0, offsetY: 0 });
                    }}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

// ── 关键帧属性面板 ────────────────────────────────────────

function KeyframePanel({
  keyframe,
  track,
  duration,
  onUpdate,
  onRemove,
}: {
  keyframe: Keyframe | null;
  track: AnimationTrack | null;
  duration: number;
  onUpdate: (updates: Partial<Keyframe>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div className="shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-neon-cyan/10 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <GitCommitVertical className="w-3 h-3 text-neon-magenta" />
        <span className="font-display text-[10px] tracking-[0.2em] text-haze uppercase">
          {t('animationEditor.properties')}
        </span>
        {keyframe && (
          <span className="ml-auto font-mono text-[9px] text-neon-cyan tabular-nums">
            {keyframe.time.toFixed(2)}s
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 py-2.5 space-y-2.5">
          {!keyframe ? (
            <div className="text-mist text-[10px] font-mono text-center py-2">
              {t('animationEditor.noKeyframe')}
            </div>
          ) : (
            <>
              {/* 时间 */}
              <div>
                <div className="hud-label mb-1 flex justify-between">
                  <span>{t('animationEditor.keyframe')} · t</span>
                  <span className="text-neon-cyan tabular-nums">{keyframe.time.toFixed(3)}s</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration > 0 ? duration : 1}
                  step={0.01}
                  value={keyframe.time}
                  onChange={(e) => onUpdate({ time: parseFloat(e.target.value) })}
                  className="hud-range"
                />
              </div>

              {/* 值 */}
              <div>
                <div className="hud-label mb-1 flex justify-between">
                  <span>value</span>
                  <span className="text-neon-cyan tabular-nums">{keyframe.value.toFixed(3)}</span>
                </div>
                <input
                  type="number"
                  step={0.01}
                  value={keyframe.value}
                  onChange={(e) => onUpdate({ value: parseFloat(e.target.value) || 0 })}
                  className="hud-input font-mono w-full"
                />
              </div>

              {/* 插值模式 */}
              <div>
                <div className="hud-label mb-1">{t('animationEditor.interpolation')}</div>
                <div className="grid grid-cols-3 gap-1">
                  {INTERP_MODES.map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        const updates: Partial<Keyframe> = { interpolation: m };
                        if (m === 'bezier' && keyframe.tangentIn == null) {
                          updates.tangentIn = 0;
                          updates.tangentOut = 0;
                        }
                        onUpdate(updates);
                      }}
                      className={cn(
                        'px-1 py-1 text-[9px] font-mono border tracking-[0.1em] uppercase transition-colors',
                        m === keyframe.interpolation
                          ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
                          : 'border-neon-cyan/15 text-mist hover:border-neon-cyan hover:text-neon-cyan',
                      )}
                    >
                      {t(`animationEditor.${m}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 轨道类型显示 */}
              {track && (
                <div className="flex items-center gap-2 text-[9px] font-mono">
                  <span className="text-mist/70 tracking-[0.14em] uppercase">
                    {t('animationEditor.track')}:
                  </span>
                  <span className="text-haze/80">{track.name}</span>
                  <span
                    className="ml-auto px-1.5 py-0.5 border border-neon-cyan/20 text-neon-cyan tracking-[0.1em] uppercase"
                  >
                    {TRACK_TYPES.includes(track.type) ? track.type : track.type}
                  </span>
                </div>
              )}

              {/* 贝塞尔切线 */}
              {keyframe.interpolation === 'bezier' && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <TangentField
                    label={t('animationEditor.tangentIn')}
                    value={keyframe.tangentIn ?? 0}
                    onChange={(v) => onUpdate({ tangentIn: v })}
                  />
                  <TangentField
                    label={t('animationEditor.tangentOut')}
                    value={keyframe.tangentOut ?? 0}
                    onChange={(v) => onUpdate({ tangentOut: v })}
                  />
                </div>
              )}

              {/* 删除 */}
              <button
                onClick={onRemove}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border border-neon-magenta/20 text-neon-magenta/80 hover:bg-neon-magenta/10 hover:text-neon-magenta text-[10px] font-mono tracking-[0.14em] uppercase transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {t('animationEditor.removeKeyframe')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TangentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="hud-label mb-1 flex justify-between">
        <span className="truncate">{label}</span>
        <span className="text-neon-cyan tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={-5}
        max={5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="hud-range"
      />
    </div>
  );
}

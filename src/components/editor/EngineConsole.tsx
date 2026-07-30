// EngineConsole — 引擎控制台 / 日志面板。
// 显示日志消息 (info / warn / error / debug),支持按级别过滤 / 搜索 / 清空 /
// 自动滚动 / 命令输入。赛博朋克风格。

import { ChevronDown, Search, Terminal, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { cn } from '@/lib/cn';

export interface ConsoleMessage {
  id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  text: string;
  timestamp: number;
  source?: string;
}

interface EngineConsoleProps {
  messages: ConsoleMessage[];
  onCommand: (command: string) => void;
  onClear: () => void;
}

type Level = ConsoleMessage['level'];

/** 级别 → 颜色 / 背景 / 短标签。 */
const LEVEL_STYLE: Record<Level, { color: string; bg: string; label: string }> = {
  debug: { color: 'text-mist', bg: 'bg-space-800/40', label: 'DBG' },
  info: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/5', label: 'INF' },
  warn: { color: 'text-neon-amber', bg: 'bg-neon-amber/5', label: 'WRN' },
  error: { color: 'text-neon-magenta', bg: 'bg-neon-magenta/5', label: 'ERR' },
};

const ALL_LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

export function EngineConsole({ messages, onCommand, onClear }: EngineConsoleProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Set<Level>>(new Set(ALL_LEVELS));
  const [search, setSearch] = useState('');
  const [command, setCommand] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (!filters.has(m.level)) return false;
      if (q) {
        const hitText = m.text.toLowerCase().includes(q);
        const hitSource = (m.source ?? '').toLowerCase().includes(q);
        if (!hitText && !hitSource) return false;
      }
      return true;
    });
  }, [messages, filters, search]);

  // 自动滚动:仅当用户停在底部时贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScroll) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottomRef.current = atBottom;
  };

  const toggleFilter = (lvl: Level) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  };

  const submitCommand = () => {
    const cmd = command.trim();
    if (!cmd) return;
    onCommand(cmd);
    setCommand('');
    stickToBottomRef.current = true;
  };

  return (
    <HudPanel
      title={t('editor.console')}
      tag="CONSOLE"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 flex flex-col"
      headerExtra={
        <button
          onClick={onClear}
          className="hud-btn hud-btn-ghost !py-0.5 text-[9px]"
          title={t('editor.clear')}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      }
    >
      {/* 过滤 + 搜索 */}
      <div className="shrink-0 px-3 py-2 border-b border-neon-cyan/10 space-y-1.5">
        <div className="flex items-center gap-1">
          {ALL_LEVELS.map((lvl) => {
            const s = LEVEL_STYLE[lvl];
            const on = filters.has(lvl);
            return (
              <button
                key={lvl}
                onClick={() => toggleFilter(lvl)}
                className={cn(
                  'px-1.5 py-0.5 text-[9px] font-mono border tracking-[0.16em] transition-colors',
                  on
                    ? cn(s.color, 'border-current')
                    : 'text-mist/40 border-neon-cyan/15 hover:text-mist',
                )}
                title={t(`editor.${lvl}`)}
              >
                {s.label}
              </button>
            );
          })}
          <span className="flex-1" />
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              'px-1.5 py-0.5 text-[9px] font-mono border transition-colors',
              autoScroll
                ? 'text-neon-cyan border-neon-cyan'
                : 'text-mist border-neon-cyan/20 hover:text-haze',
            )}
            title={t('editor.autoScroll')}
          >
            <ChevronDown
              className={cn('w-3 h-3 transition-transform', autoScroll && 'rotate-180')}
            />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Search className="w-3 h-3 text-mist shrink-0" />
          <input
            className="hud-input !border-0 !bg-transparent !px-0 !py-0"
            placeholder={t('editor.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-mist hover:text-neon-magenta shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px] leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-mist text-center text-[11px]">—</div>
        ) : (
          filtered.map((m) => {
            const s = LEVEL_STYLE[m.level];
            const ts = new Date(m.timestamp);
            const hh = String(ts.getHours()).padStart(2, '0');
            const mm = String(ts.getMinutes()).padStart(2, '0');
            const ss = String(ts.getSeconds()).padStart(2, '0');
            return (
              <div
                key={m.id}
                className={cn(
                  'px-3 py-0.5 border-b border-neon-cyan/5 flex items-start gap-2',
                  s.bg,
                )}
              >
                <span className="text-mist/50 text-[9px] shrink-0 tabular-nums">
                  {hh}:{mm}:{ss}
                </span>
                <span className={cn('text-[9px] shrink-0 tracking-[0.16em]', s.color)}>
                  {s.label}
                </span>
                {m.source && (
                  <span className="text-mist/60 text-[9px] shrink-0">[{m.source}]</span>
                )}
                <span className={cn('flex-1 break-words', s.color)}>{m.text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* 命令输入 */}
      <div className="shrink-0 px-3 py-2 border-t border-neon-cyan/10 flex items-center gap-2">
        <Terminal className="w-3 h-3 text-neon-cyan shrink-0" />
        <input
          className="hud-input !border-0 !bg-transparent !px-0 !py-0 flex-1"
          placeholder={t('editor.command')}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitCommand();
          }}
        />
        <button
          onClick={submitCommand}
          className="hud-btn hud-btn-ghost !py-0.5 text-[9px]"
          title={t('editor.submit')}
        >
          ↵
        </button>
      </div>
    </HudPanel>
  );
}

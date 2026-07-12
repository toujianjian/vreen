// logger — 统一日志系统。
//
// 用法:
//   import { createLogger } from '@/lib/logger';
//   const log = createLogger('Loader');
//   log.info('model loaded', { tris: 24000 });
//   log.warn('slow frame', dt);
//   log.error('load failed', err);
//
// 设计:
//   - 分层级: DEBUG < INFO < OK < WARN < ERROR
//   - 带模块标签,浏览器控制台输出彩色前缀
//   - 自动同步到 useUIStore.pushLog 供 TerminalLog 组件显示
//   - 支持运行时过滤(按 level / module)

import { useUIStore } from '@/stores/uiStore';

// ── 日志级别 ─────────────────────────────────────────────────────
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO:  1,
  OK:    2,
  WARN:  3,
  ERROR: 4,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

/** 运行时最低输出级别(可动态调整)。设为 DEBUG 则所有日志都输出。 */
export let minLevel: LogLevel = 'DEBUG';

export function setMinLevel(level: LogLevel): void {
  minLevel = level;
}

// ── 样式表(浏览器控制台) ─────────────────────────────────────────
const STYLES: Record<LogLevel, [string, string]> = {
  DEBUG: ['color:#5a6478', 'color:#5a6478;font-weight:600'],
  INFO:  ['color:#22d3ee', 'color:#22d3ee;font-weight:600'],
  OK:    ['color:#34d399', 'color:#34d399;font-weight:600'],
  WARN:  ['color:#fbbf24', 'color:#fbbf24;font-weight:600'],
  ERROR: ['color:#ef4444', 'color:#ef4444;font-weight:600'],
};

// ── Logger 实例 ──────────────────────────────────────────────────

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info:  (msg: string, ...args: unknown[]) => void;
  ok:    (msg: string, ...args: unknown[]) => void;
  warn:  (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

// 节流:同一 msg 在 interval ms 内只推送一次 UI
const _throttleMap = new Map<string, number>();
const THROTTLE_UI = 500;

function shouldThrottle(key: string): boolean {
  const now = performance.now();
  const last = _throttleMap.get(key);
  if (last && now - last < THROTTLE_UI) return true;
  _throttleMap.set(key, now);
  return false;
}

/** 创建带模块标签的 Logger。module 是简短的组件/子系统名,如 "ECS" "Loader" "Renderer"。 */
export function createLogger(module: string): Logger {
  const logAt = (level: LogLevel, msg: string, ...args: unknown[]) => {
    if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;

    // ── 控制台输出(带样式) ──────────────────────────────────
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm
    const prefix = `[${ts}] [${module}]`;
    const [tagStyle, moduleStyle] = STYLES[level];
    const tag = `%c${level.padEnd(5)}%c`;

    switch (level) {
      case 'ERROR':
        console.error(tag, tagStyle, `${prefix} ${msg}`, moduleStyle, ...args);
        break;
      case 'WARN':
        console.warn(tag, tagStyle, `${prefix} ${msg}`, moduleStyle, ...args);
        break;
      case 'DEBUG':
        console.debug(tag, tagStyle, `${prefix} ${msg}`, moduleStyle, ...args);
        break;
      default:
        console.log(tag, tagStyle, `${prefix} ${msg}`, moduleStyle, ...args);
    }

    // ── 推送到 UI 日志(节流,避免高频刷屏) ──────────────────
    const uiKey = `${module}:${msg}`;
    if (shouldThrottle(uiKey)) return;

    try {
      const state = useUIStore.getState();
      state.pushLog(
        level === 'ERROR' ? 'ERR' : level as 'INFO' | 'OK' | 'WARN',
        msg,
      );
    } catch {
      // store 可能尚未初始化
    }
  };

  return {
    debug: (msg, ...args) => logAt('DEBUG', msg, ...args),
    info:  (msg, ...args) => logAt('INFO', msg, ...args),
    ok:    (msg, ...args) => logAt('OK', msg, ...args),
    warn:  (msg, ...args) => logAt('WARN', msg, ...args),
    error: (msg, ...args) => logAt('ERROR', msg, ...args),
  };
}

/** 全局默认 logger (module="VREEN") */
export const log = createLogger('VREEN');

// @vreen/engine — 内置 logger。
//
// 引擎内部用 createLogger(tag) 拿 logger 实例。默认 sink 走 console +
// 模块前缀;消费者可以 setLoggerSink() 注入一个自己的 sink(例如把
// log 推给主 app 的 UI / 状态 / 第三方监控)。
//
// 设计原则:
//   - 引擎永远不 panic,所有错误可恢复(尽量 try/catch + log)
//   - 默认输出到 console,生产可关掉(LEVEL=ERROR 或更高)
//   - 注入 sink 不改变 console 输出(双写),便于本地调试 + 远端监控并存

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogEntry {
  level: Exclude<LogLevel, 'silent'>;
  module: string;
  message: string;
  timestamp: number;
}

export type LogSink = (entry: LogEntry) => void;

let _sinks: LogSink[] = [];
let _minLevel: LogLevel = (typeof globalThis !== 'undefined'
  && (globalThis as { __VREEN_ENGINE_LOG_LEVEL__?: LogLevel }).__VREEN_ENGINE_LOG_LEVEL__)
  || 'info';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, silent: 4,
};

function shouldEmit(level: Exclude<LogLevel, 'silent'>): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[_minLevel];
}

function emit(level: Exclude<LogLevel, 'silent'>, module: string, args: unknown[]): void {
  if (!shouldEmit(level)) return;
  const message = args.map((a) => {
    if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  const entry: LogEntry = { level, module, message, timestamp: Date.now() };
  for (const sink of _sinks) {
    try { sink(entry); } catch { /* sink 错误吞掉 */ }
  }
  const prefix = `[${module}]`;
  if (level === 'error') console.error(prefix, message);
  else if (level === 'warn') console.warn(prefix, message);
  else if (level === 'info') console.info(prefix, message);
  else console.debug(prefix, message);
}

export function setLoggerSink(sink: LogSink | null): void {
  if (sink) _sinks.push(sink);
  else _sinks = [];
}

export function setMinLevel(level: LogLevel): void {
  _minLevel = level;
}

export function getMinLevel(): LogLevel {
  return _minLevel;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (...a) => emit('debug', module, a),
    info: (...a) => emit('info', module, a),
    warn: (...a) => emit('warn', module, a),
    error: (...a) => emit('error', module, a),
  };
}

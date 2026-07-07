// Loader — 资产加载抽象层。
//
// 设计目标：
//   - 每种资产类型（OBJ / GLB / GLTF / Texture / HDRI）实现一个 Loader<T>，
//     `load(source, ctx?)` 返回该资产在引擎中的强类型对象。
//   - AssetManager 用 (format, sourceKey) 缓存 Promise，确保同源资产并发
//     请求只解析一次；也支持显式 invalidate。
//   - 通用进度 / 取消通过 LoaderContext 传递，跨 Loader 共享。
//   - 不绑定 DOM（不监听 fetch 之外的事件），纯函数 + Promise。

/** 资产源：URL 字符串 / URL / File / Blob / ArrayBuffer / Uint8Array。 */
export type AssetSource = string | URL | File | Blob | ArrayBuffer | Uint8Array;

/** 加载进度。 */
export interface LoaderProgress {
  loaded: number;
  total: number;
  ratio: number;
}

/** 加载上下文。 */
export interface LoaderContext {
  /** 取消信号。中断时 loader 应当尽早 reject / 抛 AbortError。 */
  signal?: AbortSignal;
  /** 进度回调 (0..1)。 */
  onProgress?: (p: LoaderProgress) => void;
  /** 给 loader 用的 hint (例如 { mime: 'image/png' })。 */
  hints?: Record<string, unknown>;
}

/** 通用 Loader 接口。每种资产一个实现。 */
export interface Loader<T> {
  /** 此 Loader 接受的格式名 (例: 'glb' / 'texture' / 'hdri')。 */
  readonly format: string;
  /** 检测 source 是否能由本 loader 处理。可选：未实现则视为通用接受。 */
  canLoad?(source: AssetSource, hints?: Record<string, unknown>): boolean;
  /** 加载并解析。 */
  load(source: AssetSource, ctx?: LoaderContext): Promise<T>;
}

/** 把 source 归一化为 cache key。File/Blob 用 name+size+type；其他用 toString()。 */
export function cacheKeyFor(source: AssetSource): string {
  if (typeof source === 'string') return `str:${source}`;
  if (source instanceof URL) return `url:${source.toString()}`;
  if (source instanceof File) return `file:${source.name}|${source.size}|${source.type}`;
  if (source instanceof Blob) return `blob:${source.size}|${source.type}`;
  if (source instanceof Uint8Array) return `u8:${source.byteLength}:${sampleHead(source)}`;
  if (source instanceof ArrayBuffer) return `ab:${source.byteLength}:${sampleHead(new Uint8Array(source))}`;
  return 'unknown';
}

function sampleHead(u8: Uint8Array): string {
  const n = Math.min(8, u8.length);
  let s = '';
  for (let i = 0; i < n; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

/** 用 fetch + progress 拿 ArrayBuffer（处理 URL 形式 source）。 */
export async function fetchAsArrayBuffer(
  source: AssetSource,
  onProgress?: (p: LoaderProgress) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  let url: string;
  if (typeof source === 'string') url = source;
  else if (source instanceof URL) url = source.toString();
  else throw new TypeError('fetchAsArrayBuffer: source must be a URL string');

  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status} ${resp.statusText}`);

  const total = Number(resp.headers.get('content-length') || 0);
  if (!resp.body || !onProgress || total === 0) {
    return resp.arrayBuffer();
  }
  // 流式读取以便上报进度
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ loaded, total, ratio: loaded / total });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

/** 把任意 source 归一为 ArrayBuffer。 */
export async function toArrayBuffer(source: AssetSource): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  if (source instanceof Uint8Array) {
    return source.byteOffset === 0 && source.byteLength === source.buffer.byteLength
      ? (source.buffer as ArrayBuffer)
      : source.slice().buffer;
  }
  if (source instanceof Blob) return source.arrayBuffer();
  throw new TypeError('toArrayBuffer: source must be Blob / ArrayBuffer / Uint8Array');
}

/** 取消异常的统一判定。 */
export function isAbortError(e: unknown): boolean {
  if (!e) return false;
  const anyE = e as { name?: string; code?: number };
  return anyE.name === 'AbortError' || anyE.code === DOMException.ABORT_ERR;
}

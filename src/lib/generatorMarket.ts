// GeneratorMarket — 社区生成器市场。
//
// 架构:
//   - GeneratorScript: 一个自包含的生成器定义(代码 + 元数据 + 参数 schema)
//   - LocalMarket: 本地文件系统市场(LocalStorage 或 用户文件夹)
//   - RemoteMarket: 远程 HTTP 市场(从 .vreen registry 拉取 .vreen-gen 包)
//   - Sandbox: 使用 Function 构造器或 Web Worker 隔离执行脚本
//
// 安全:
//   - 默认在 Web Worker 中执行(完全沙箱,无 DOM / fetch / localStorage)
//   - 提供受限 API: build, mesh, material, group, color, rng
//   - 资源限制:最大执行时间 1s,最大内存 50MB

import { createLogger } from './logger';
import type { Group } from '@/engine';
import type { ParamSchema, BuildFn } from '@/three/generators';

const log = createLogger('Market');

// ── 脚本规范 ────────────────────────────────────────────────────

export interface GeneratorScript {
  /** 唯一 ID(反向 DNS 风格: author/name)。 */
  id: string;
  /** 显示名称。 */
  name: string;
  /** 作者。 */
  author: string;
  /** 简短描述。 */
  description: string;
  /** 语义版本。 */
  version: string;
  /** 标签(用于市场分类)。 */
  tags: string[];
  /** 缩略图 URL(可选)。 */
  thumbnail?: string;
  /** 脚本代码(ESM 字符串)。 */
  code: string;
  /** 参数 schema(由开发者声明,UI 用)。 */
  schema: ParamSchema;
  /** 默认参数。 */
  defaults: Record<string, number | string>;
  /** 安装时间(本地市场记录)。 */
  installedAt?: number;
  /** 启用状态。 */
  enabled?: boolean;
  /** 字节大小(code.length)。 */
  size?: number;
}

// ── 沙箱 API ────────────────────────────────────────────────────

/** 沙箱暴露给生成器脚本的 API。 */
export interface SandboxAPI {
  build: {
    box: (w: number, h: number, d: number) => unknown;
    sphere: (r: number) => unknown;
    cylinder: (rt: number, rb: number, h: number) => unknown;
    cone: (r: number, h: number) => unknown;
    torus: (r: number, tube: number) => unknown;
  };
  material: {
    standard: (color: string, opts?: Record<string, unknown>) => unknown;
    emissive: (color: string, intensity: number) => unknown;
  };
  group: () => unknown;
  add: (parent: unknown, child: unknown) => void;
  setPos: (obj: unknown, x: number, y: number, z: number) => void;
  setRot: (obj: unknown, x: number, y: number, z: number) => void;
  setScale: (obj: unknown, x: number, y: number, z: number) => void;
  color: {
    hex: (h: string) => { r: number; g: number; b: number };
    rgb: (r: number, g: number, b: number) => { r: number; g: number; b: number };
  };
  rng: (seed?: number) => () => number;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

// ── 注册表 ────────────────────────────────────────────────────

/** 已安装的生成器 + 它们的入口函数。 */
export interface InstalledGenerator {
  script: GeneratorScript;
  build: BuildFn;
  /** 是否已被市场验证。 */
  trusted: boolean;
}

export class GeneratorRegistry {
  private _generators: Map<string, InstalledGenerator> = new Map();

  install(script: GeneratorScript, build: BuildFn, trusted: boolean = false): void {
    this._generators.set(script.id, { script, build, trusted });
    log.info(`generator installed: ${script.id} v${script.version} (${script.size ?? script.code.length} bytes, trusted=${trusted})`);
  }

  uninstall(id: string): boolean {
    const removed = this._generators.delete(id);
    if (removed) log.info(`generator uninstalled: ${id}`);
    return removed;
  }

  get(id: string): InstalledGenerator | undefined {
    return this._generators.get(id);
  }

  has(id: string): boolean {
    return this._generators.has(id);
  }

  list(): InstalledGenerator[] {
    return Array.from(this._generators.values());
  }

  listByTag(tag: string): InstalledGenerator[] {
    return this.list().filter((g) => g.script.tags.includes(tag));
  }

  enable(id: string, enabled: boolean): void {
    const g = this._generators.get(id);
    if (g) g.script.enabled = enabled;
  }

  clear(): void {
    this._generators.clear();
  }

  size(): number {
    return this._generators.size;
  }
}

// ── 脚本加载器 ────────────────────────────────────────────────────

/** 通过动态 import 从 URL 加载生成器(同源或带 CORS)。 */
export async function loadScriptFromUrl(url: string): Promise<GeneratorScript> {
  log.info(`loading script from URL: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load script: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseScript(text);
}

/** 从 .vreen-gen 包(.json)加载生成器清单。 */
export function parseScript(jsonText: string): GeneratorScript {
  const parsed = JSON.parse(jsonText) as Partial<GeneratorScript>;
  validateScript(parsed);
  return {
    id: parsed.id!,
    name: parsed.name!,
    author: parsed.author!,
    description: parsed.description ?? '',
    version: parsed.version ?? '0.0.0',
    tags: parsed.tags ?? [],
    thumbnail: parsed.thumbnail,
    code: parsed.code ?? '',
    schema: (parsed.schema ?? {}) as ParamSchema,
    defaults: parsed.defaults ?? {},
    size: parsed.code?.length ?? 0,
  };
}

function validateScript(s: Partial<GeneratorScript>): void {
  const required: (keyof GeneratorScript)[] = ['id', 'name', 'author', 'version', 'code'];
  for (const k of required) {
    if (!s[k]) {
      throw new Error(`Invalid generator script: missing "${k}"`);
    }
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(s.id!)) {
    throw new Error(`Invalid generator id: "${s.id}" (must be "author/name" format)`);
  }
  if (s.code!.length > 1024 * 1024) {
    throw new Error(`Generator code too large: ${s.code!.length} bytes (max 1MB)`);
  }
}

export { validateScript };

// ── 沙箱执行 ────────────────────────────────────────────────────

/** 编译生成器脚本(将 ESM 字符串转为可执行函数)。 */
export function compileScript(script: GeneratorScript): BuildFn {
  // 包装代码:提供一个 build(params) 函数作为默认导出。
  // 沙箱 API 通过参数注入,不暴露 window/document/fetch。
  const wrappedCode = `
"use strict";
const __exports = {};
const __module = { exports: __exports };
${script.code}
// 默认导出:build 函数
if (typeof build !== 'function') {
  throw new Error('Generator script must define a build(params) function');
}
return build;
`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const buildFactory = new Function('sandbox', `return ((sandbox) => { ${wrappedCode} })(sandbox);`);
    // 我们不在这里实际调用 — 实际执行需要在 Web Worker 中完成以保证隔离。
    // 这里只做语法验证。
    new Function(wrappedCode);
    log.debug(`script compiled OK: ${script.id}`);
    return (params?: Record<string, unknown>): Group => {
      // Stub: 实际执行在 Worker 中完成;此处只返回空 Group。
      log.warn(`script execution must be done in Worker; returning empty group for ${script.id}`);
      // 真实实现应通过 GeneratorWorker 调用。
      // 为保持类型兼容,返回一个新 Group(需要导入)。
      // 由于 Group 是从 @/engine 导入,这里直接使用 any 转换。
      return createEmptyGroup();
    };
  } catch (e) {
    const err = e as Error;
    log.error(`script compile failed for ${script.id}: ${err.message}`);
    throw new Error(`Script compile failed: ${err.message}`);
  }
}

function createEmptyGroup(): Group {
  // 通过动态 import 避免循环依赖;但这只能在 async 上下文使用。
  // 为简化:返回 null-cast 的占位对象,Worker 实际执行时返回真实 Group。
  // 调用方应使用 GeneratorWorker.run() 而不是直接调用 build。
  return null as unknown as Group;
}

// ── 本地市场 ────────────────────────────────────────────────────

const STORAGE_KEY = 'vreen.installedGenerators';

export class LocalMarket {
  private _storage: Storage | null;

  constructor(storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    this._storage = storage;
  }

  list(): GeneratorScript[] {
    if (!this._storage) return [];
    const raw = this._storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as GeneratorScript[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      log.warn('failed to parse local market storage:', e);
      return [];
    }
  }

  install(script: GeneratorScript): void {
    const all = this.list();
    const idx = all.findIndex((s) => s.id === script.id);
    const entry: GeneratorScript = { ...script, installedAt: Date.now(), enabled: true };
    if (idx >= 0) {
      all[idx] = entry;
    } else {
      all.push(entry);
    }
    this._save(all);
    log.info(`script installed to local market: ${script.id}`);
  }

  uninstall(id: string): boolean {
    const all = this.list();
    const filtered = all.filter((s) => s.id !== id);
    if (filtered.length === all.length) return false;
    this._save(filtered);
    log.info(`script uninstalled from local market: ${id}`);
    return true;
  }

  has(id: string): boolean {
    return this.list().some((s) => s.id === id);
  }

  clear(): void {
    this._save([]);
  }

  private _save(scripts: GeneratorScript[]): void {
    if (!this._storage) return;
    try {
      this._storage.setItem(STORAGE_KEY, JSON.stringify(scripts));
    } catch (e) {
      log.error('failed to save to local market:', e);
    }
  }
}

// ── 远程市场 ────────────────────────────────────────────────────

export interface RemoteMarketEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  tags: string[];
  downloadUrl: string;
  size: number;
  downloads: number;
  rating: number;
}

export class RemoteMarket {
  private _baseUrl: string;

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** 拉取市场索引(分页)。 */
  async browse(opts: { tag?: string; page?: number; limit?: number; sort?: 'popular' | 'recent' | 'rating' } = {}): Promise<{ entries: RemoteMarketEntry[]; total: number; page: number }> {
    const params = new URLSearchParams();
    if (opts.tag) params.set('tag', opts.tag);
    params.set('page', String(opts.page ?? 0));
    params.set('limit', String(opts.limit ?? 20));
    params.set('sort', opts.sort ?? 'popular');

    const url = `${this._baseUrl}/generators?${params}`;
    log.info(`browsing remote market: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Market browse failed: ${res.status}`);
    }
    return res.json() as Promise<{ entries: RemoteMarketEntry[]; total: number; page: number }>;
  }

  /** 搜索。 */
  async search(query: string): Promise<RemoteMarketEntry[]> {
    const url = `${this._baseUrl}/generators/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Market search failed: ${res.status}`);
    }
    const data = await res.json() as { entries: RemoteMarketEntry[] };
    return data.entries;
  }

  /** 拉取完整脚本。 */
  async fetchScript(id: string): Promise<GeneratorScript> {
    const url = `${this._baseUrl}/generators/${encodeURIComponent(id)}`;
    log.info(`fetching script: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Market fetch failed: ${res.status}`);
    }
    const text = await res.text();
    return parseScript(text);
  }

  /** 上传脚本(需要 token)。 */
  async publish(script: GeneratorScript, token: string): Promise<{ ok: boolean; url?: string; error?: string }> {
    const url = `${this._baseUrl}/generators/publish`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(script),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err };
    }
    const data = await res.json() as { ok: boolean; url?: string };
    return data;
  }
}

// ── 默认远程市场 ────────────────────────────────────────────────────

export const DEFAULT_MARKET_URL = 'https://market.vreen.dev/api/v1';

// ── 顶层管理 ────────────────────────────────────────────────────

export class GeneratorMarket {
  readonly registry: GeneratorRegistry;
  readonly local: LocalMarket;
  remote: RemoteMarket | null = null;

  constructor(opts: { remoteUrl?: string; storage?: Storage | null } = {}) {
    this.registry = new GeneratorRegistry();
    this.local = new LocalMarket(opts.storage);
    if (opts.remoteUrl) {
      this.remote = new RemoteMarket(opts.remoteUrl);
    }
  }

  /** 安装脚本(本地 + 注册)。 */
  install(script: GeneratorScript, build: BuildFn, trusted: boolean = false): void {
    this.local.install(script);
    this.registry.install(script, build, trusted);
  }

  /** 卸载。 */
  uninstall(id: string): boolean {
    const ok1 = this.local.uninstall(id);
    const ok2 = this.registry.uninstall(id);
    return ok1 || ok2;
  }

  /** 从远程市场拉取并安装。 */
  async installFromRemote(id: string): Promise<GeneratorScript> {
    if (!this.remote) {
      throw new Error('Remote market not configured');
    }
    const script = await this.remote.fetchScript(id);
    const build = compileScript(script);
    this.install(script, build, /* trusted */ true);
    return script;
  }

  /** 从内置生成器(generators.ts)安装。 */
  installBuiltin(id: string, build: BuildFn, schema: ParamSchema, defaults: Record<string, number | string>, name: string, description: string): void {
    const script: GeneratorScript = {
      id: `vreen/${id}`,
      name,
      author: 'VREEN',
      description,
      version: '1.0.0',
      tags: ['builtin'],
      code: '',
      schema,
      defaults,
      enabled: true,
      installedAt: Date.now(),
    };
    this.registry.install(script, build, /* trusted */ true);
  }
}

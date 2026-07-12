// vreenRegistry — 客户端 registry 检索/解析工具。
//
// 用法:
//   const reg = await loadRegistry('https://registry.vreen.dev/index.json');
//   const pkg = findPackage(reg, 'robot.glb');
//   const version = resolveVersion(pkg, '^1.0.0');
//   const url = resolveDownloadUrl(version, reg.baseUrl);
//
//   // 检查本地缓存是否最新:
//   if (await matchesLocalCache(version, localFile)) return;
//   await downloadTo(version.downloadUrl, localFile);

import { createLogger } from '@/lib/logger';
import { computeSha256 } from './vreenValidate';

const log = createLogger('vreenRegistry');

// ── 类型 ──────────────────────────────────────────────────────────

export interface RegistryVersion {
  version: string;
  releasedAt: string;
  downloadUrl: string;
  deltaUrl?: string;
  size: number;
  sha256: string;
  formatVersion?: string;
  engineVersions?: string[];
  dependencies?: Record<string, string>;
  yanked?: boolean;
  yankReason?: string;
}

export interface RegistryPackage {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  author?: string;
  license?: string;
  homepage?: string;
  icon?: string;
  latest: string;
  versions: RegistryVersion[];
}

export interface RegistryIndex {
  version: '1.0.0';
  generatedAt: string;
  baseUrl?: string;
  packages: RegistryPackage[];
}

export interface CacheManifestEntry {
  id: string;
  version: string;
  size: number;
  sha256: string;
  savedAt: string;
}

// ── 加载 ─────────────────────────────────────────────────────────

/** 从 URL 加载 registry(支持相对/绝对 URL)。 */
export async function loadRegistry(source: string | URL | RegistryIndex): Promise<RegistryIndex> {
  if (typeof source !== 'string' && !(source instanceof URL)) {
    return source as RegistryIndex;
  }
  const url = String(source);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status} ${url}`);
  const json = await res.json() as RegistryIndex;
  if (json.version !== '1.0.0') {
    log.warn(`registry version ${json.version} (expected 1.0.0)`);
  }
  return json;
}

// ── 查找 ─────────────────────────────────────────────────────────

/** 查找包(by id)。 */
export function findPackage(reg: RegistryIndex, id: string): RegistryPackage | null {
  return reg.packages.find((p) => p.id === id) ?? null;
}

/** 列出全部包 id。 */
export function listPackageIds(reg: RegistryIndex): string[] {
  return reg.packages.map((p) => p.id);
}

/** 列出所有有特定 tag 的包。 */
export function filterByTag(reg: RegistryIndex, tag: string): RegistryPackage[] {
  return reg.packages.filter((p) => p.tags?.includes(tag) ?? false);
}

// ── 版本解析 ─────────────────────────────────────────────────────

/** 极简 semver 解析 — 支持 `^x.y.z`, `~x.y.z`, `>=x.y.z`, 精确 `x.y.z`。 */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): [number, number, number, string] => {
    const parts = s.replace(/^[^0-9]*/, '').split(/[.-]/);
    return [
      parseInt(parts[0] ?? '0', 10) || 0,
      parseInt(parts[1] ?? '0', 10) || 0,
      parseInt(parts[2] ?? '0', 10) || 0,
      parts[3] ?? '',
    ];
  };
  const [a1, a2, a3, aPre] = parse(a);
  const [b1, b2, b3, bPre] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  if (a3 !== b3) return a3 - b3;
  // pre-release 排序:有 pre 的低于无 pre 的
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return aPre.localeCompare(bPre);
  return 0;
}

function matchesRange(version: string, range: string): boolean {
  range = range.trim();
  if (range === 'latest' || range === '*') return true;
  if (range.startsWith('^')) {
    // 锁定 major + minor,从 patch 向上
    const [maj, min] = range.slice(1).split('.').map((p) => parseInt(p, 10));
    const [v1, v2] = version.split('.').map((p) => parseInt(p, 10));
    return v1 === maj && v2 >= min;
  }
  if (range.startsWith('~')) {
    const [maj, min] = range.slice(1).split('.').map((p) => parseInt(p, 10));
    const [v1, v2, v3] = version.split('.').map((p) => parseInt(p, 10));
    return v1 === maj && v2 === min;
  }
  if (range.startsWith('>=')) {
    return compareSemver(version, range.slice(2)) >= 0;
  }
  if (range.startsWith('>')) {
    return compareSemver(version, range.slice(1)) > 0;
  }
  if (range.startsWith('<=')) {
    return compareSemver(version, range.slice(2)) <= 0;
  }
  if (range.startsWith('<')) {
    return compareSemver(version, range.slice(1)) < 0;
  }
  return version === range;
}

/** 找符合 range 的最新版本(yanked 跳过)。 */
export function resolveVersion(pkg: RegistryPackage, range: string = 'latest'): RegistryVersion | null {
  // 排序 + 反向
  const sorted = [...pkg.versions].sort((a, b) => -compareSemver(a.version, b.version));
  for (const v of sorted) {
    if (v.yanked) continue;
    if (matchesRange(v.version, range)) return v;
  }
  return null;
}

// ── URL 解析 ─────────────────────────────────────────────────────

function substituteBase(url: string, baseUrl?: string): string {
  if (!url.includes('{baseUrl}')) return url;
  if (!baseUrl) return url.replace(/\{baseUrl\}/g, '');
  return url.replace(/\{baseUrl\}/g, baseUrl);
}

export function resolveDownloadUrl(v: RegistryVersion, baseUrl?: string): string {
  return substituteBase(v.downloadUrl, baseUrl);
}

export function resolveDeltaUrl(v: RegistryVersion, baseUrl?: string): string | null {
  if (!v.deltaUrl) return null;
  return substituteBase(v.deltaUrl, baseUrl);
}

// ── 本地缓存一致性检查 ──────────────────────────────────────────

export interface CacheCheck {
  fresh: boolean;
  expected: { size: number; sha256: string };
  actual?: { size: number; sha256: string };
}

export async function matchesLocalCache(
  v: RegistryVersion,
  filePath: string | File | ArrayBuffer | Uint8Array,
): Promise<CacheCheck> {
  let bytes: Uint8Array;
  if (typeof filePath === 'string') {
    // 浏览器不能直接读 path — 走 fetch
    const res = await fetch(filePath);
    if (!res.ok) return { fresh: false, expected: { size: v.size, sha256: v.sha256 } };
    bytes = new Uint8Array(await res.arrayBuffer());
  } else if (filePath instanceof File) {
    bytes = new Uint8Array(await filePath.arrayBuffer());
  } else if (filePath instanceof ArrayBuffer) {
    bytes = new Uint8Array(filePath);
  } else {
    bytes = filePath;
  }
  if (bytes.byteLength !== v.size) {
    return { fresh: false, expected: { size: v.size, sha256: v.sha256 }, actual: { size: bytes.byteLength, sha256: '' } };
  }
  const sha = await computeSha256(bytes);
  return {
    fresh: sha === v.sha256,
    expected: { size: v.size, sha256: v.sha256 },
    actual: { size: bytes.byteLength, sha256: sha },
  };
}

// ── CLI 友好输出 ─────────────────────────────────────────────────

export function formatRegistry(reg: RegistryIndex): string {
  const lines: string[] = [];
  lines.push(`Vreen registry v${reg.version} (${reg.generatedAt})`);
  lines.push(`base: ${reg.baseUrl ?? '(none)'}`);
  lines.push(`packages: ${reg.packages.length}`);
  for (const p of reg.packages) {
    lines.push(`  • ${p.id} v${p.latest} — ${p.name}${p.tags?.length ? ` [${p.tags.join(', ')}]` : ''}`);
    lines.push(`    versions: ${p.versions.map((v) => v.version + (v.yanked ? '(yanked)' : '')).join(', ')}`);
  }
  return lines.join('\n');
}

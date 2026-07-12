// vreenValidate — 完整 .vreen 包校验：sha256 摘要、schema 验证、文件大小一致性。
//
// 三个主要 API:
//   - computeSha256(data)              : 异步 hash
//   - computeSha256Sync(data)          : 同步实现(基于 SHA-256 私有实现,仅在 Web Crypto 不可用时使用)
//   - verifyPackageIntegrity(unpacked) : 校验所有 assets 的 sha256/size 与 manifest 一致
//   - getValidationReport(unpacked)    : 一份结构化报告(errors / warnings / details)

import type { UnpackedVreen } from './vreenPack';
import type { VreenManifest, VreenScene, VreenAssetEntry } from './vreenManifest';
import { validateManifest, validateScene, VreenFormatError } from './vreenManifest';

const log = createLogger('vreenValidate');
import { createLogger } from '@/lib/logger';

/** SHA-256 hex 字符串,带分桶提升大文件处理。 */
export async function computeSha256(data: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuf = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
    return bufToHex(hashBuf);
  }
  return computeSha256Sync(data);
}

/** 同步 SHA-256:用于 Node/Service Worker 等无 Web Crypto 的环境。
 *  基于 NIST FIPS 180-4 实现的纯 JS,仅作降级。性能约 50MB/s,远低于 Web Crypto。 */
export function computeSha256Sync(data: Uint8Array): string {
  // SHA-256 constants
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // Pad:1 bit + 0 bits + 64-bit length
  const len = data.length;
  const bitLen = BigInt(len) * 8n;
  const padLen = ((len + 9 + 63) & ~63);
  const buf = new Uint8Array(padLen);
  buf.set(data);
  buf[len] = 0x80;
  // Big-endian 64-bit length at the end
  for (let i = 0; i < 8; i++) {
    buf[padLen - 1 - i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);
  }

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const W = new Uint32Array(64);
  for (let chunk = 0; chunk < padLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const off = chunk + i * 4;
      W[i] = (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
  return hex;
}

function rotr(n: number, k: number): number {
  return (n >>> k) | (n << (32 - k));
}

function bufToHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0');
  return hex;
}

// ── 完整校验 ──────────────────────────────────────────────────────────

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** 可选定位(如 asset path / field name)。 */
  path?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  /** 0.2.x 字段统计。 */
  stats: {
    assetCount: number;
    totalAssetBytes: number;
    modelCount: number;
    textureCount: number;
    hdriCount: number;
    audioCount: number;
    entityCount: number;
    manifestSize: number;
    sceneSize: number;
  };
  /** 校验耗时 (ms)。 */
  durationMs: number;
}

const HEX_RE = /^[0-9a-f]{64}$/;

/** 详细验证:schema + sha256 + size 一致性。 */
export async function getValidationReport(unpacked: UnpackedVreen): Promise<ValidationReport> {
  const t0 = performance.now();
  const issues: ValidationIssue[] = [];

  // 1. schema 验证(已经在 unpack 时跑过一次;这里捕获详细错误)
  try {
    validateManifest(unpacked.manifest);
  } catch (e) {
    issues.push({
      level: 'error',
      code: 'MANIFEST_INVALID',
      message: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    validateScene(unpacked.scene);
  } catch (e) {
    issues.push({
      level: 'error',
      code: 'SCENE_INVALID',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. 资产 size + sha256
  let totalAssetBytes = 0;
  let modelCount = 0, textureCount = 0, hdriCount = 0, audioCount = 0;
  for (const a of unpacked.manifest.assets) {
    totalAssetBytes += a.size;
    if (a.kind === 'model') modelCount++;
    else if (a.kind === 'texture') textureCount++;
    else if (a.kind === 'hdri') hdriCount++;
    else if (a.kind === 'audio') audioCount++;

    const data = unpacked.assets.get(a.id);
    if (!data) {
      issues.push({
        level: 'error',
        code: 'ASSET_MISSING',
        message: `asset ${a.id} (${a.kind}) is declared but missing`,
        path: a.path,
      });
      continue;
    }
    if (a.size > 0 && data.byteLength !== a.size) {
      issues.push({
        level: 'error',
        code: 'ASSET_SIZE_MISMATCH',
        message: `asset ${a.id} expected ${a.size} bytes, got ${data.byteLength}`,
        path: a.path,
      });
    }
    if (a.sha256) {
      if (!HEX_RE.test(a.sha256)) {
        issues.push({
          level: 'warning',
          code: 'SHA256_BAD_FORMAT',
          message: `asset ${a.id} sha256 not 64 hex chars: ${a.sha256}`,
          path: a.path,
        });
      } else {
        const actual = await computeSha256(data);
        if (actual !== a.sha256) {
          issues.push({
            level: 'error',
            code: 'SHA256_MISMATCH',
            message: `asset ${a.id} sha256 mismatch: expected ${a.sha256}, got ${actual}`,
            path: a.path,
          });
        }
      }
    }
  }

  // 3. primaryModelId 必须指向真实 model asset
  if (unpacked.manifest.primaryModelId) {
    const m = unpacked.manifest.assets.find((a) => a.id === unpacked.manifest.primaryModelId);
    if (!m) {
      issues.push({
        level: 'error',
        code: 'PRIMARY_MODEL_MISSING',
        message: `primaryModelId ${unpacked.manifest.primaryModelId} not found in assets`,
      });
    } else if (m.kind !== 'model') {
      issues.push({
        level: 'error',
        code: 'PRIMARY_MODEL_NOT_MODEL',
        message: `primaryModelId ${m.id} is kind=${m.kind}, expected model`,
        path: m.path,
      });
    }
  } else if (modelCount > 0) {
    issues.push({
      level: 'info',
      code: 'NO_PRIMARY_MODEL',
      message: 'manifest has no primaryModelId; UI may pick first model automatically',
    });
  }

  // 4. world (ECS) 结构
  const w = unpacked.world;
  if (w) {
    if (w.version !== '0.2.0') {
      issues.push({
        level: 'warning',
        code: 'WORLD_VERSION_MISMATCH',
        message: `world.version=${String(w.version)} (expected 0.2.0)`,
      });
    }
  }

  // 5. 简易统计
  const entityCount = w?.entities.length ?? 0;
  const manifestSize = JSON.stringify(unpacked.manifest).length;
  const sceneSize = JSON.stringify(unpacked.scene).length;

  return {
    ok: issues.every((i) => i.level !== 'error'),
    issues,
    stats: {
      assetCount: unpacked.manifest.assets.length,
      totalAssetBytes,
      modelCount,
      textureCount,
      hdriCount,
      audioCount,
      entityCount,
      manifestSize,
      sceneSize,
    },
    durationMs: Math.round(performance.now() - t0),
  };
}

/** 简化的"是否有效"检查 — 任何 error 即 false。 */
export async function verifyPackageIntegrity(unpacked: UnpackedVreen): Promise<boolean> {
  const r = await getValidationReport(unpacked);
  return r.ok;
}

/** 格式化报告为可读字符串(CLI 友好)。 */
export function formatReport(report: ValidationReport, verbose = false): string {
  const lines: string[] = [];
  lines.push(`vreen validate — ${report.ok ? 'OK' : 'FAILED'} (${report.durationMs}ms)`);
  lines.push(`  assets: ${report.stats.assetCount} (${(report.stats.totalAssetBytes / 1024).toFixed(1)} KB)`);
  lines.push(`  models=${report.stats.modelCount} textures=${report.stats.textureCount} hdri=${report.stats.hdriCount} audio=${report.stats.audioCount}`);
  lines.push(`  entities: ${report.stats.entityCount}`);
  lines.push(`  manifest=${report.stats.manifestSize}B  scene=${report.stats.sceneSize}B`);

  if (report.issues.length === 0) {
    lines.push('  no issues');
  } else {
    const errs = report.issues.filter((i) => i.level === 'error');
    const warns = report.issues.filter((i) => i.level === 'warning');
    const infos = report.issues.filter((i) => i.level === 'info');
    lines.push(`  issues: ${errs.length} error(s), ${warns.length} warning(s), ${infos.length} info`);
    if (verbose) {
      for (const i of report.issues) {
        const tag = i.level.toUpperCase().padEnd(7);
        const where = i.path ? ` [${i.path}]` : '';
        lines.push(`    ${tag} ${i.code}${where} — ${i.message}`);
      }
    }
  }
  return lines.join('\n');
}

export { VreenFormatError, validateManifest, validateScene };
export type { VreenManifest, VreenScene, VreenAssetEntry };

// vreenDiff — .vreen 增量包工具。
//
// 提供:
//   - diffVreenPackages(a, b)        : 列出两份包之间的资产差异
//   - createVreenDelta(base, head)   : 生成一个增量包(只含 base → head 之间的差异)
//   - applyVreenDelta(base, delta)   : 把增量包应用到 base 得到 head
//
// 增量包(.vreen-delta) 同样使用 zip 格式,内含:
//   manifest.json   (同 head 风格,但 primaryModelId 保留)
//   scene.json      (head 完整 scene)
//   world.json      (head 完整 world,如果存在)
//   delta.json      (结构化 diff,描述哪些 asset 是 add/modify/remove,以及原 base 的 sha256)
//   assets/<id>     (仅 add / modify 的资产字节)
//
// 应用 delta 时:把 base 中未改动的 asset 字节复制,再覆盖 / 添加 delta 内的。

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { packVreenPackage, type PackResult, type PackInput } from './vreenPack';
import { tryUnpackAnyVreen, unpackVreenPackage, type UnpackedVreen } from './vreenPack';
import { computeSha256 } from './vreenValidate';
import { VREEN_FORMAT_VERSION, type VreenAssetEntry, VreenFormatError, validateScene, validateManifest } from './vreenManifest';
import { createLogger } from '@/lib/logger';

const log = createLogger('vreenDiff');

// ── diff 数据结构 ─────────────────────────────────────────────────────

export interface AssetDiff {
  id: string;
  kind: VreenAssetEntry['kind'];
  path: string;
  status: 'added' | 'modified' | 'removed' | 'unchanged';
  /** base 中的 sha256(如存在)。 */
  baseSha256?: string;
  /** head 中的 sha256(如存在)。 */
  headSha256?: string;
  /** head 中的字节数(如存在)。 */
  headSize?: number;
  /** base 中的字节数(如存在)。 */
  baseSize?: number;
  originalName?: string;
}

export interface PackageDiff {
  baseManifestVersion: string;
  headManifestVersion: string;
  baseAssetName: string;
  headAssetName: string;
  baseExportedAt: string;
  headExportedAt: string;
  /** 各资产 id 的差异。 */
  assets: AssetDiff[];
  sceneChanged: boolean;
  worldChanged: boolean;
  primaryModelChanged: boolean;
  /** delta 体积(只算 add/modify 的字节)。 */
  deltaBytes: number;
  /** 完整 head 体积(manifest + scene + 全部 asset)。 */
  fullBytes: number;
  /** 节省比例 = 1 - deltaBytes / fullBytes。 */
  savingsRatio: number;
}

const ASSET_KIND_FROM_PATH: Record<string, VreenAssetEntry['kind']> = {
  'assets/': 'model',
  'assets/textures/': 'texture',
  'assets/hdri/': 'hdri',
  'assets/audio/': 'audio',
};

function kindFromPath(p: string): VreenAssetEntry['kind'] {
  for (const prefix in ASSET_KIND_FROM_PATH) {
    if (p.startsWith(prefix)) return ASSET_KIND_FROM_PATH[prefix] as VreenAssetEntry['kind'];
  }
  return 'model';
}

function assetEntryToMap(entries: VreenAssetEntry[]): Map<string, VreenAssetEntry> {
  const m = new Map<string, VreenAssetEntry>();
  for (const e of entries) m.set(e.id, e);
  return m;
}

function sceneEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── 主 API:diff ───────────────────────────────────────────────────────

export async function diffVreenPackages(
  base: UnpackedVreen,
  head: UnpackedVreen,
): Promise<PackageDiff> {
  const baseAssets = assetEntryToMap(base.manifest.assets);
  const headAssets = assetEntryToMap(head.manifest.assets);

  const diffs: AssetDiff[] = [];
  let deltaBytes = 0;
  let fullBytes = 0;

  // 全量 head 字节(从 base 不必重新算 — 留作 fullBytes)
  for (const a of base.manifest.assets) {
    const data = base.assets.get(a.id);
    if (data) fullBytes += data.byteLength;
  }
  for (const a of head.manifest.assets) {
    const data = head.assets.get(a.id);
    if (data) fullBytes += data.byteLength;
  }
  // manifest + scene
  fullBytes += JSON.stringify(head.manifest).length + JSON.stringify(head.scene).length;
  if (head.world) fullBytes += JSON.stringify(head.world).length;

  // 遍历 head 与 base 的并集
  const allIds = new Set<string>([...baseAssets.keys(), ...headAssets.keys()]);
  for (const id of allIds) {
    const b = baseAssets.get(id);
    const h = headAssets.get(id);
    const headData = h ? head.assets.get(id) : undefined;
    const baseData = b ? base.assets.get(id) : undefined;

    if (b && !h) {
      // removed
      diffs.push({
        id, kind: b.kind, path: b.path, status: 'removed',
        baseSha256: b.sha256, baseSize: b.size, originalName: b.originalName,
      });
    } else if (!b && h) {
      // added
      const size = headData?.byteLength ?? h.size;
      diffs.push({
        id, kind: h.kind, path: h.path, status: 'added',
        headSha256: h.sha256, headSize: size, originalName: h.originalName,
      });
      deltaBytes += size;
    } else if (b && h) {
      // both — compare sha256 or compute
      const baseHash = b.sha256 ?? (baseData ? await computeSha256(baseData) : undefined);
      const headHash = h.sha256 ?? (headData ? await computeSha256(headData) : undefined);
      if (baseHash && headHash && baseHash === headHash) {
        diffs.push({
          id, kind: h.kind, path: h.path, status: 'unchanged',
          baseSha256: baseHash, headSha256: headHash, headSize: h.size, baseSize: b.size,
          originalName: h.originalName,
        });
      } else {
        const size = headData?.byteLength ?? h.size;
        diffs.push({
          id, kind: h.kind, path: h.path, status: 'modified',
          baseSha256: baseHash, headSha256: headHash, headSize: size, baseSize: b.size,
          originalName: h.originalName,
        });
        deltaBytes += size;
      }
    }
  }

  const sceneChanged = !sceneEquals(base.scene, head.scene);
  const worldChanged = !sceneEquals(base.world ?? null, head.world ?? null);
  const primaryModelChanged = base.manifest.primaryModelId !== head.manifest.primaryModelId;

  return {
    baseManifestVersion: base.manifest.version,
    headManifestVersion: head.manifest.version,
    baseAssetName: base.manifest.assetName,
    headAssetName: head.manifest.assetName,
    baseExportedAt: base.manifest.exportedAt,
    headExportedAt: head.manifest.exportedAt,
    assets: diffs,
    sceneChanged,
    worldChanged,
    primaryModelChanged,
    deltaBytes,
    fullBytes,
    savingsRatio: fullBytes > 0 ? 1 - deltaBytes / fullBytes : 0,
  };
}

// ── 主 API:create delta ───────────────────────────────────────────────

export interface DeltaInput {
  base: UnpackedVreen;
  head: UnpackedVreen;
  diff: PackageDiff;
}

export interface DeltaResult {
  bytes: Uint8Array;
  /** 增量包中的 entry 路径。 */
  entries: Record<string, number>;
  deltaBytes: number;
  savingsRatio: number;
}

export async function createVreenDelta(input: DeltaInput): Promise<DeltaResult> {
  const { base, head, diff } = input;
  const entries: Record<string, Uint8Array> = {};

  // 1) delta.json — 结构化 diff
  const deltaDoc = {
    version: VREEN_FORMAT_VERSION,
    type: 'delta' as const,
    baseExportedAt: base.manifest.exportedAt,
    headExportedAt: head.manifest.exportedAt,
    baseAssetName: base.manifest.assetName,
    headAssetName: head.manifest.assetName,
    basePrimaryModelId: base.manifest.primaryModelId,
    headPrimaryModelId: head.manifest.primaryModelId,
    assets: diff.assets,
    sceneChanged: diff.sceneChanged,
    worldChanged: diff.worldChanged,
    primaryModelChanged: diff.primaryModelChanged,
  };
  entries['delta.json'] = strToU8(JSON.stringify(deltaDoc, null, 2));

  // 2) head scene + manifest(增量包需要 head 的最新状态来 apply)
  entries['scene.json'] = strToU8(JSON.stringify(head.scene, null, 2));
  const deltaManifest = {
    ...head.manifest,
    type: 'delta' as const,
    delta: {
      baseExportedAt: base.manifest.exportedAt,
      deltaBytes: diff.deltaBytes,
      fullBytes: diff.fullBytes,
      savingsRatio: diff.savingsRatio,
      changedAssetIds: diff.assets
        .filter((a) => a.status === 'added' || a.status === 'modified')
        .map((a) => a.id),
      removedAssetIds: diff.assets
        .filter((a) => a.status === 'removed')
        .map((a) => a.id),
    },
  };
  entries['manifest.json'] = strToU8(JSON.stringify(deltaManifest, null, 2));

  // 3) world.json (如果存在)
  if (head.world) {
    entries['world.json'] = strToU8(JSON.stringify(head.world, null, 2));
  }

  // 4) assets — 只打包 add/modify 的字节
  for (const a of diff.assets) {
    if (a.status !== 'added' && a.status !== 'modified') continue;
    const data = head.assets.get(a.id);
    if (!data) {
      log.warn(`delta: head asset ${a.id} bytes missing, skipping`);
      continue;
    }
    entries[a.path] = data;
  }

  const zipped = zipSync(entries, { level: 6 });
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(entries)) out[k] = v.byteLength;
  return {
    bytes: zipped,
    entries: out,
    deltaBytes: diff.deltaBytes,
    savingsRatio: diff.savingsRatio,
  };
}

// ── 主 API:apply delta ───────────────────────────────────────────────

export interface ApplyDeltaResult {
  head: UnpackedVreen;
  appliedAdds: number;
  appliedModifies: number;
  appliedRemoves: number;
}

export async function applyVreenDelta(
  base: UnpackedVreen,
  deltaBytes: Uint8Array,
): Promise<ApplyDeltaResult> {
  const entries = unzipSync(deltaBytes);
  if (!entries['delta.json']) {
    throw new VreenFormatError('not a valid .vreen-delta: missing delta.json');
  }
  const deltaDoc = JSON.parse(strFromU8(entries['delta.json'])) as {
    type: string;
    headExportedAt: string;
    headAssetName: string;
    headPrimaryModelId: string | null;
    assets: AssetDiff[];
    sceneChanged: boolean;
    worldChanged: boolean;
    primaryModelChanged: boolean;
  };
  if (deltaDoc.type !== 'delta') {
    throw new VreenFormatError(`not a valid .vreen-delta: type=${String(deltaDoc.type)}`);
  }

  // 1) 重建 head 资产表 — 复制 base 中未改动的 + 替换/添加 delta 内的
  const newAssets = new Map<string, Uint8Array>();
  const newManifestAssets: VreenAssetEntry[] = [];
  let adds = 0, mods = 0, removes = 0;
  const baseById = assetEntryToMap(base.manifest.assets);
  const headDeltaById = new Map<string, AssetDiff>();
  for (const a of deltaDoc.assets) headDeltaById.set(a.id, a);

  // union
  const allIds = new Set<string>([...baseById.keys(), ...headDeltaById.keys()]);
  for (const id of allIds) {
    const b = baseById.get(id);
    const d = headDeltaById.get(id);
    if (b && (!d || d.status === 'unchanged' || d.status === 'removed')) {
      if (d && d.status === 'removed') {
        removes++;
        continue;
      }
      // unchanged — 复制 base 字节
      const data = base.assets.get(id);
      if (data) {
        newAssets.set(id, data);
        newManifestAssets.push(b);
      }
    } else if (b && d && d.status === 'modified') {
      // 从 delta 字节中找
      const data = entries[d.path];
      if (!data) throw new VreenFormatError(`delta missing modified asset ${id}`);
      newAssets.set(id, data);
      newManifestAssets.push({ ...b, sha256: d.headSha256, size: d.headSize ?? data.byteLength });
      mods++;
    } else if (!b && d && (d.status === 'added' || d.status === 'modified')) {
      const data = entries[d.path];
      if (!data) throw new VreenFormatError(`delta missing added asset ${id}`);
      newAssets.set(id, data);
      newManifestAssets.push({
        id: d.id, kind: d.kind, path: d.path, size: data.byteLength,
        sha256: d.headSha256, originalName: d.originalName,
      });
      adds++;
    }
  }

  // 2) scene/world 来自 delta 内的 head 副本
  const sceneText = entries['scene.json'] ? strFromU8(entries['scene.json']) : null;
  if (!sceneText) throw new VreenFormatError('delta missing scene.json');
  const scene = JSON.parse(sceneText);
  validateScene(scene);
  const worldText = entries['world.json'] ? strFromU8(entries['world.json']) : null;
  const world = worldText ? JSON.parse(worldText) : null;

  // 3) 构造 head manifest
  const headManifest = {
    version: VREEN_FORMAT_VERSION,
    exportedAt: deltaDoc.headExportedAt,
    name: deltaDoc.headAssetName || 'delta-applied',
    assetName: deltaDoc.headAssetName,
    assets: newManifestAssets,
    primaryModelId: deltaDoc.headPrimaryModelId,
    world: world ?? undefined,
    generator: 'VREEN Delta Apply 0.2.1',
  };
  validateManifest(headManifest);

  return {
    head: {
      manifest: headManifest,
      scene,
      assets: newAssets,
      legacy: base.legacy,
      world,
    },
    appliedAdds: adds,
    appliedModifies: mods,
    appliedRemoves: removes,
  };
}

// ── 端到端:base + delta → 完整 head pack ─────────────────────────────

export async function applyDeltaThenPack(
  base: UnpackedVreen,
  deltaBytes: Uint8Array,
  packOptions: Omit<PackInput, 'scene' | 'world' | 'assets' | 'primaryModelId' | 'name' | 'assetName'> = {},
): Promise<PackResult> {
  const applied = await applyVreenDelta(base, deltaBytes);
  const assets = [];
  for (const a of applied.head.manifest.assets) {
    const data = applied.head.assets.get(a.id);
    if (!data) continue;
    assets.push({ id: a.id, kind: a.kind, data, originalName: a.originalName, sha256: a.sha256 });
  }
  return packVreenPackage({
    name: applied.head.manifest.name,
    assetName: applied.head.manifest.assetName,
    scene: applied.head.scene,
    assets,
    primaryModelId: applied.head.manifest.primaryModelId,
    world: applied.head.world ?? undefined,
    generator: applied.head.manifest.generator,
    ...packOptions,
  });
}

// ── CLI 友好的 diff 摘要 ─────────────────────────────────────────────

export function formatDiff(diff: PackageDiff): string {
  const lines: string[] = [];
  lines.push(`vreen diff: ${diff.baseAssetName} → ${diff.headAssetName}`);
  lines.push(`  base: ${diff.baseManifestVersion} @ ${diff.baseExportedAt}`);
  lines.push(`  head: ${diff.headManifestVersion} @ ${diff.headExportedAt}`);
  const added = diff.assets.filter((a) => a.status === 'added').length;
  const mod = diff.assets.filter((a) => a.status === 'modified').length;
  const rm = diff.assets.filter((a) => a.status === 'removed').length;
  const same = diff.assets.filter((a) => a.status === 'unchanged').length;
  lines.push(`  assets: +${added} ~${mod} -${rm} =${same}`);
  lines.push(`  scene: ${diff.sceneChanged ? 'CHANGED' : 'unchanged'}`);
  lines.push(`  world: ${diff.worldChanged ? 'CHANGED' : 'unchanged'}`);
  lines.push(`  primary: ${diff.primaryModelChanged ? 'CHANGED' : 'unchanged'}`);
  lines.push(`  delta bytes: ${(diff.deltaBytes / 1024).toFixed(1)} KB / full ${(diff.fullBytes / 1024).toFixed(1)} KB (savings ${(diff.savingsRatio * 100).toFixed(1)}%)`);
  return lines.join('\n');
}

// ── 重新导出,方便 import ────────────────────────────────────────────
export { tryUnpackAnyVreen, unpackVreenPackage };

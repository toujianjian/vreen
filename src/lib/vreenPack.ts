// vreenPack — `.vreen` (zip) 容器的打包 / 解包工具。
//
// 用 fflate 压缩 (与 lib/export.ts 共用)。
//
// packVreenPackage  -> Uint8Array (zip bytes)
// unpackVreenPackage -> { manifest, scene, state, assets: Map<id, Uint8Array> }
//哈哈哈
// 与 lib/export.ts 的关系：
//   - 旧的 0.1.x 容器 (project.json + model.<ext>) 仍可被 unpackVreenPackage
//     识别，结果会把内容归一化到新结构 (manifest 0.2.0 + scene 0.2.0)。
//   - 旧的 pack 路径（exportVreenPackage / downloadVreenBundle）保持不变。
//   - 新路径在 src/lib/vreenPack.ts 里，按 0.2.0 规范打包。

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  VreenManifest,
  VreenScene,
  VreenFormatError,
  VREEN_FORMAT_VERSION,
  VREEN_FORMAT_VERSION_LEGACY,
  validateManifest,
  validateScene,
  VreenAssetEntry,
  VreenWorldJson,
  defaultAssetPath,
} from './vreenManifest';
import { applyVreenPackage, VreenPackage, VREEN_PACKAGE_VERSION } from './export';

export type { VreenScene, VreenWorldJson, VreenAssetEntry, VreenManifest } from './vreenManifest';
export { VREEN_FORMAT_VERSION } from './vreenManifest';

// ── Pack input ──────────────────────────────────────────────────────
export interface PackAssetInput {
  id?: string;
  kind: VreenAssetEntry['kind'];
  data: Uint8Array;
  originalName?: string;
  sha256?: string;
  meta?: Record<string, unknown>;
}

export interface PackInput {
  name: string;
  assetName: string;
  /** 旧 0.1.x 风格的扁平 scene 状态；如果不传 scene 则必须传 legacyState。 */
  legacyState?: VreenPackage;
  /** 新 0.2.0 风格的 scene 状态。 */
  scene?: VreenScene;
  assets?: PackAssetInput[];
  primaryModelId?: string | null;
  /** 嵌入的 ECS World (POJO 形式)，由 World.toJSON() 产生。 */
  world?: VreenWorldJson;
  generator?: string;
}

export interface PackResult {
  bytes: Uint8Array;
  manifest: VreenManifest;
  /** 实际写入的 zip entry 路径 → size。 */
  entries: Record<string, number>;
}

/** 当 PackInput 缺 legacyState 又缺 scene 时，给一个最小兜底 scene 防止崩。 */
function emptyScene(): VreenScene {
  return {
    version: VREEN_FORMAT_VERSION,
    camera: {},
    animation: { speed: 1 },
    environment: { preset: 'studio', exposure: 1, background: 'solid', backgroundColor: '#000000' },
    postFX: { bloom: false, bloomIntensity: 0, chromaticAberration: false, vignette: false, ssao: false },
    materials: {},
  };
}

// ── Pack ────────────────────────────────────────────────────────────
export function packVreenPackage(input: PackInput): PackResult {
  const scene: VreenScene = input.scene
    ?? (input.legacyState ? legacyToScene(input.legacyState) : emptyScene());
  validateScene(scene);

  const entries: Record<string, Uint8Array> = {};
  const assetEntries: VreenAssetEntry[] = [];
  let primaryModelId: string | null = input.primaryModelId ?? null;

  if (input.assets) {
    for (let i = 0; i < input.assets.length; i++) {
      const a = input.assets[i];
      const id = a.id ?? cryptoRandId();
      const path = defaultAssetPath(a.kind, a.originalName ?? 'asset', id);
      entries[path] = a.data;
      const entry: VreenAssetEntry = {
        id,
        kind: a.kind,
        path,
        size: a.data.byteLength,
        originalName: a.originalName,
        sha256: a.sha256,
        meta: a.meta,
      };
      assetEntries.push(entry);
      if (a.kind === 'model' && primaryModelId === null) {
        primaryModelId = id;
      }
    }
  }

  const manifest: VreenManifest = {
    version: VREEN_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    name: input.name,
    assetName: input.assetName,
    assets: assetEntries,
    primaryModelId,
    world: input.world,
    generator: input.generator ?? 'VREEN Engine 0.2.1',
  };
  validateManifest(manifest);

  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  entries['scene.json'] = strToU8(JSON.stringify(scene, null, 2));
  // 旧工具读 project.json 时也能用：复制一份 scene 当 state。
  entries['project.json'] = strToU8(JSON.stringify(sceneToLegacyState(scene, input.assetName), null, 2));

  const zipped = zipSync(entries, { level: 6 });
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(entries)) out[k] = v.byteLength;
  return { bytes: zipped, manifest, entries: out };
}

// ── Unpack ──────────────────────────────────────────────────────────
export interface UnpackedVreen {
  /** 0.2.0 manifest；0.1.x 包会自动合成一个最小 manifest。 */
  manifest: VreenManifest;
  scene: VreenScene;
  /** asset id -> bytes。空集 (0.1.x 旧包：含 'model' 单条)。 */
  assets: Map<string, Uint8Array>;
  /** 旧 0.1.x project.json 解析后的扁平 VreenPackage（兼容性输出）。 */
  legacy: VreenPackage;
  /** 嵌入的 ECS World (toJSON 形式)。旧 0.1.x 包为 null。 */
  world: VreenWorldJson | null;
}

export async function unpackVreenPackage(source: ArrayBuffer | Uint8Array): Promise<UnpackedVreen> {
  const u8 = source instanceof Uint8Array ? source : new Uint8Array(source);

  // Sniff
  const isZip = u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;

  if (!isZip) {
    // 纯 JSON —— 0.1.x 单文件
    const text = new TextDecoder().decode(u8);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      throw new VreenFormatError('not a valid .vreen file (neither zip nor JSON)');
    }
    return normalizeLegacyJson(parsed, 'plain.vreen.json');
  }

  const entries = unzipSync(u8);
  if (entries['manifest.json'] && entries['scene.json']) {
    return parseVreen02(entries);
  }
  // 旧 0.1.x 容器
  if (entries['project.json']) {
    const text = strFromU8(entries['project.json']);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      throw new VreenFormatError('invalid project.json');
    }
    return normalizeLegacyJson(parsed, 'legacy.vreen');
  }
  throw new VreenFormatError('zip missing manifest.json / scene.json / project.json');
}

function parseVreen02(entries: Record<string, Uint8Array>): UnpackedVreen {
  const m = JSON.parse(strFromU8(entries['manifest.json']));
  const s = JSON.parse(strFromU8(entries['scene.json']));
  validateManifest(m);
  validateScene(s);
  const assets = new Map<string, Uint8Array>();
  for (const a of m.assets) {
    const data = entries[a.path];
    if (data) assets.set(a.id, data);
  }
  return {
    manifest: m,
    scene: s,
    assets,
    legacy: sceneToLegacyState(s, m.assetName),
    world: m.world ?? null,
  };
}

function normalizeLegacyJson(parsed: unknown, fallbackName: string): UnpackedVreen {
  if (!parsed || typeof parsed !== 'object') {
    throw new VreenFormatError('legacy .vreen is not an object');
  }
  const p = parsed as Partial<VreenPackage>;
  if (p.version !== VREEN_PACKAGE_VERSION) {
    throw new VreenFormatError(
      `legacy .vreen version mismatch: ${String(p.version)} (expected ${VREEN_PACKAGE_VERSION})`,
    );
  }
  // 校验 + 装配最小 manifest
  const pkg: VreenPackage = applyVreenPackage(parsed);
  const scene = legacyToScene(pkg);
  const manifest: VreenManifest = {
    version: VREEN_FORMAT_VERSION,
    exportedAt: pkg.exportedAt,
    name: pkg.assetName || 'legacy',
    assetName: pkg.assetName,
    assets: [],
    primaryModelId: null,
    world: undefined,
    generator: 'VREEN Legacy Upgrader',
  };
  return { manifest, scene, assets: new Map(), world: null, legacy: pkg };
}

function legacyToScene(pkg: VreenPackage): VreenScene {
  return {
    version: VREEN_FORMAT_VERSION,
    camera: pkg.camera as unknown as Record<string, unknown>,
    animation: pkg.animation,
    environment: pkg.environment as unknown as Record<string, unknown>,
    postFX: pkg.postFX as unknown as Record<string, unknown>,
    materials: pkg.materials as unknown as Record<string, unknown>,
  };
}

function sceneToLegacyState(scene: VreenScene, assetName: string): VreenPackage {
  return {
    version: VREEN_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    assetName,
    camera: scene.camera as unknown as VreenPackage['camera'],
    animation: scene.animation,
    materials: scene.materials as unknown as VreenPackage['materials'],
    environment: scene.environment as unknown as VreenPackage['environment'],
    postFX: scene.postFX as unknown as VreenPackage['postFX'],
  };
}

// ── helpers ─────────────────────────────────────────────────────────
function cryptoRandId(): string {
  // 16 字节十六进制；不依赖 crypto.randomUUID() 兼容旧环境
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// ── 浏览器下载 helper ──────────────────────────────────────────────
/** Filename-safe slug。 */
function slugify(s: string): string {
  return (s || 'project').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 60) || 'project';
}

/** 直接把 zip bytes 触发浏览器下载为 `<slug>.vreen`。 */
export function downloadVreenBytes(bytes: Uint8Array, assetName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(assetName)}.vreen`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 嗅探并解压任意 .vreen 文件：zip 走 0.2.x，裸 JSON 走 0.1.x。
 *  旧 0.1.x JSON 解析路径在 export.ts 里的 importVreenPackageFile。 */
export async function tryUnpackAnyVreen(
  source: ArrayBuffer | Uint8Array | File,
): Promise<UnpackedVreen> {
  // File 路径 — 优先看 4 字节 magic
  if (typeof File !== 'undefined' && source instanceof File) {
    const head = new Uint8Array(await source.slice(0, 4).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    if (!isZip) {
      // 0.1.x 裸 JSON：解析 + 构造最小 UnpackedVreen
      const text = await source.text();
      return tryUnpackAnyVreen(new TextEncoder().encode(text));
    }
  }
  return unpackVreenPackage(source as ArrayBuffer | Uint8Array);
}

// 旧 API re-export 兼容
export { VREEN_FORMAT_VERSION_LEGACY, VREEN_PACKAGE_VERSION };

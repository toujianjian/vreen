// export.ts — 0.1.x 旧版 .vreen 兼容层 (read-only)。
//
// 历史角色：旧的 .vreen 写入路径（exportVreenPackage / downloadVreenPackage /
// downloadVreenBundle）已废弃，统一走 src/lib/vreenPack.ts 的 0.2.1 pack 路径。
// 本文件只保留读侧（importVreenPackageFile / applyVreenPackage / isVreenPackageFile
// / VreenPackage 类型 / VREEN_PACKAGE_VERSION），让 Uploader 等入口仍能识别
// 0.1.x 旧 .vreen.json / .vreen 包做向后兼容。
//
// importVreenPackageFile 会嗅探前 4 字节：zip 头走 vreenPack 的 unpackVreenPackage
// (支持 0.1.x + 0.2.1)，否则按 0.1.x 裸 JSON 解析（applyVreenPackage）。

import { useViewerStore } from '@/stores/viewerStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorldStore } from '@/stores/worldStore';
import { unpackVreenPackage } from './vreenPack';

export const VREEN_PACKAGE_VERSION = '0.1.0' as const;

export interface VreenPackage {
  version: typeof VREEN_PACKAGE_VERSION;
  exportedAt: string;
  assetName: string;
  camera: ReturnType<typeof useViewerStore.getState>['camera'];
  animation: Pick<ReturnType<typeof useViewerStore.getState>['animation'], 'speed'>;
  materials: ReturnType<typeof useInspectorStore.getState>['materials'];
  environment: ReturnType<typeof useUIStore.getState>['environment'];
  postFX: ReturnType<typeof useUIStore.getState>['postFX'];
}

/** Result of importing a .vreen package — package state + (optional) embedded model. */
export interface VreenImportResult {
  pkg: VreenPackage;
  /** The embedded model file, if the package was a zip container. Caller is
   *  responsible for handing this off to the viewer (e.g. via uploadBridge). */
  modelFile: File | null;
}

/** Filename-safe slug. */
function slugify(s: string): string {
  return (s || 'project').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-.]/g, '').slice(0, 60) || 'project';
}

/** Detect whether a filename is any flavour of .vreen package. */
export function isVreenPackageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.vreen') || lower.endsWith('.vreen.json');
}

/**
 * Apply a 0.1.x .vreen package's scene state to the running stores.
 * Throws on version mismatch or malformed JSON.
 */
export function applyVreenPackage(pkg: unknown): VreenPackage {
  if (!pkg || typeof pkg !== 'object') {
    throw new Error('Invalid .vreen package: not an object');
  }
  const p = pkg as Partial<VreenPackage>;
  if (p.version !== VREEN_PACKAGE_VERSION) {
    throw new Error(
      `Unsupported .vreen package version: ${String(p.version)} (expected ${VREEN_PACKAGE_VERSION})`,
    );
  }
  if (!p.camera || !p.materials || !p.environment || !p.postFX) {
    throw new Error('Invalid .vreen package: missing required fields');
  }

  useViewerStore.setState({ camera: { ...p.camera } });
  useViewerStore.setState((s) => ({
    animation: { ...s.animation, speed: p.animation?.speed ?? s.animation.speed },
  }));
  useInspectorStore.setState({ materials: { ...p.materials } });
  useUIStore.setState({
    environment: p.environment as ReturnType<typeof useUIStore.getState>['environment'],
    postFX: p.postFX as ReturnType<typeof useUIStore.getState>['postFX'],
    envCustomFile: null,
  });
  if (p.assetName) {
    useViewerStore.setState({ assetName: p.assetName });
  }
  return p as VreenPackage;
}

/**
 * Read a File (JSON or zip) and apply the package to the stores.
 * Resolves with `{ pkg, modelFile }` — `modelFile` is non-null only when
 * the package was a self-contained `.vreen` zip with an embedded model.
 *
 * Auto-detects:
 *   - 0.1.x 裸 JSON (`.vreen.json` 或无扩展 zip) → applyVreenPackage
 *   - 0.1.x / 0.2.1 zip → vreenPack.unpackVreenPackage（含 ECS world 还原）
 *
 * Caller is responsible for routing `modelFile` to the viewer
 * (e.g. `uploadBridge.set(modelFile)` then navigating to `/viewer`).
 */
export async function importVreenPackageFile(file: File): Promise<VreenImportResult> {
  const MAX = 200 * 1024 * 1024; // 200 MB upper bound (allows for big models)
  if (file.size > MAX) {
    throw new Error(`.vreen package too large (${file.size} B > ${MAX} B)`);
  }

  // Sniff: first 4 bytes. PK\x03\x04 == zip.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;

  if (isZip) {
    // 0.1.x / 0.2.1 zip 都走 vreenPack 解析
    const bytes = new Uint8Array(await file.arrayBuffer());
    const unpacked = await unpackVreenPackage(bytes);
    // 把 0.2.1 scene 写回 store (applyVreenPackage 是 0.1.x-only)
    useViewerStore.setState((s) => ({
      camera: { ...s.camera, ...(unpacked.scene.camera as object) },
      animation: { ...s.animation, ...unpacked.scene.animation },
      assetName: unpacked.manifest.assetName || unpacked.manifest.name,
    }));
    useInspectorStore.setState({ materials: unpacked.scene.materials as never });
    useUIStore.setState({
      environment: unpacked.scene.environment as never,
      postFX: unpacked.scene.postFX as never,
      envCustomFile: null,
    });
    if (unpacked.manifest.world) {
      useWorldStore.getState().deserialize(unpacked.manifest.world);
    }
    // 返回 VreenPackage 形状（Uploader/Inspector 不感知 0.2.1 结构）
    const pkg: VreenPackage = {
      version: VREEN_PACKAGE_VERSION,
      exportedAt: unpacked.manifest.exportedAt,
      assetName: unpacked.manifest.assetName,
      camera: unpacked.scene.camera as unknown as VreenPackage['camera'],
      animation: unpacked.scene.animation as { speed: number },
      materials: unpacked.scene.materials as unknown as VreenPackage['materials'],
      environment: unpacked.scene.environment as unknown as VreenPackage['environment'],
      postFX: unpacked.scene.postFX as unknown as VreenPackage['postFX'],
    };
    const modelEntry = unpacked.manifest.assets.find((a) => a.kind === 'model');
    let modelFile: File | null = null;
    if (modelEntry) {
      const data = unpacked.assets.get(modelEntry.id);
      if (data) {
        const ext = (modelEntry.originalName ?? 'glb').split('.').pop() ?? 'glb';
        modelFile = new File([data as unknown as BlobPart], `embedded.${ext}`, { type: 'application/octet-stream' });
      }
    }
    return { pkg, modelFile };
  }

  // 0.1.x 裸 JSON
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid .vreen package: file is not valid JSON');
  }
  const pkg = applyVreenPackage(parsed);
  return { pkg, modelFile: null };
}

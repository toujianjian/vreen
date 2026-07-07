// vreenManifest — `.vreen` 包格式的 schema 定义与运行时校验。
//
// 文件布局 (.vreen = zip):
//   manifest.json         —— 包描述、版本、资产清单
//   scene.json            —— camera / animation / environment / postFX
//   state.json            —— UI store 状态（兼容 0.1.0）
//   assets/
//     model.<ext>         —— 主模型 (可选)
//     textures/<id>.png   —— 贴图
//     hdri/<id>.hdr       —— HDRI
//     audio/<id>.ogg      —— 音频（规划中）
//
// 版本策略：
//   0.1.x —— 旧版：单个 project.json，camera/materials/environment/postFX 平铺
//   0.2.x —— 新版：manifest + scene + state + assets/ 分层
//   unpackVreenPackage 同时识别 0.1 和 0.2，按规范化形式返回。

/** 当前规范版本。 */
export const VREEN_FORMAT_VERSION = '0.2.1' as const;

/** 旧版 (0.1.x) 兼容。 */
export const VREEN_FORMAT_VERSION_LEGACY = '0.1.0' as const;

/** 资产类型 → 子目录映射。 */
export const VREEN_ASSET_DIRS = {
  model: 'assets',
  texture: 'assets/textures',
  hdri: 'assets/hdri',
  audio: 'assets/audio',
} as const;

export type AssetKind = keyof typeof VREEN_ASSET_DIRS;

export interface VreenAssetEntry {
  /** 稳定 ID (uuid 形式)，scene/materials 等通过它引用。 */
  id: string;
  kind: AssetKind;
  /** 包内相对路径 (manifest 内自动生成；不要手写)。 */
  path: string;
  /** 文件大小 (bytes) — 写入时记录，便于 UI 报告。 */
  size: number;
  /** 资产原始文件名（用户上传时的 name）。 */
  originalName?: string;
  /** 资产内容的 sha256 (hex)。可选；用于缓存命中校验。 */
  sha256?: string;
  /** 自由扩展字段（如 imageWidth/Height、format 等）。 */
  meta?: Record<string, unknown>;
}

/** manifest.json 的强类型。 */
export interface VreenManifest {
  version: typeof VREEN_FORMAT_VERSION;
  /** 包被导出的 UTC 时间。 */
  exportedAt: string;
  /** 包名 / 项目名。 */
  name: string;
  /** 原始 3D 资产的展示名 (e.g. 文件名)。 */
  assetName: string;
  /** 资产清单。 */
  assets: VreenAssetEntry[];
  /** 主模型资产 id（可选，对应 assets[].id, kind === 'model'）。 */
  primaryModelId: string | null;
  /** 嵌入的 ECS World (toJSON 形式)。Phase A: 平行架构。
   *  Java 端可解析后做同构仿真/重放。 */
  world?: VreenWorldJson;
  /** manifest 作者 / 工具。 */
  generator: string;
}

/** World.toJSON() 的反序列化形式（POJO）。 */
export interface VreenWorldJson {
  version: '0.2.0';
  name: string;
  frame: number;
  entities: VreenEntityJson[];
}
export interface VreenEntityJson {
  id: number;
  name: string;
  sceneNode: {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  };
  /** key = ComponentType.name, value = 组件数据本身。 */
  components: Record<string, unknown>;
}

/** scene.json 的强类型。 */
export interface VreenScene {
  version: typeof VREEN_FORMAT_VERSION;
  camera: Record<string, unknown>;
  animation: { speed: number };
  environment: Record<string, unknown>;
  postFX: Record<string, unknown>;
  /** 0.1 兼容：materials 也搬到这里。 */
  materials: Record<string, unknown>;
}

/** state.json —— 0.1 project.json 的别名，保留以保证旧工具能读。 */
export interface VreenLegacyState {
  version: typeof VREEN_FORMAT_VERSION_LEGACY;
  exportedAt: string;
  assetName: string;
  camera: Record<string, unknown>;
  animation: { speed: number };
  materials: Record<string, unknown>;
  environment: Record<string, unknown>;
  postFX: Record<string, unknown>;
}

// ── 校验 ────────────────────────────────────────────────────────────
export class VreenFormatError extends Error {
  constructor(message: string) {
    super(`VreenFormatError: ${message}`);
    this.name = 'VreenFormatError';
  }
}

export function validateManifest(m: unknown): asserts m is VreenManifest {
  if (!m || typeof m !== 'object') throw new VreenFormatError('manifest is not an object');
  const o = m as Partial<VreenManifest>;
  if (o.version !== VREEN_FORMAT_VERSION) {
    throw new VreenFormatError(
      `manifest.version must be "${VREEN_FORMAT_VERSION}" (got ${String(o.version)})`,
    );
  }
  if (typeof o.name !== 'string') throw new VreenFormatError('manifest.name missing');
  if (typeof o.assetName !== 'string') throw new VreenFormatError('manifest.assetName missing');
  if (!Array.isArray(o.assets)) throw new VreenFormatError('manifest.assets must be an array');
  for (const a of o.assets) {
    if (typeof a.id !== 'string') throw new VreenFormatError('asset.id must be string');
    if (!(a.kind in VREEN_ASSET_DIRS)) throw new VreenFormatError(`unknown asset.kind: ${a.kind}`);
    if (typeof a.path !== 'string') throw new VreenFormatError('asset.path must be string');
    if (typeof a.size !== 'number') throw new VreenFormatError('asset.size must be number');
  }
  if (o.primaryModelId !== null && typeof o.primaryModelId !== 'string') {
    throw new VreenFormatError('manifest.primaryModelId must be string|null');
  }
  if (o.world !== undefined) {
    if (typeof o.world !== 'object' || o.world === null) {
      throw new VreenFormatError('manifest.world must be an object');
    }
    const w = o.world as Partial<VreenWorldJson>;
    if (w.version !== '0.2.0') {
      throw new VreenFormatError(`manifest.world.version must be "0.2.0" (got ${String(w.version)})`);
    }
    if (!Array.isArray(w.entities)) {
      throw new VreenFormatError('manifest.world.entities must be an array');
    }
  }
}

export function validateScene(s: unknown): asserts s is VreenScene {
  if (!s || typeof s !== 'object') throw new VreenFormatError('scene is not an object');
  const o = s as Partial<VreenScene>;
  if (o.version !== VREEN_FORMAT_VERSION) {
    throw new VreenFormatError(`scene.version must be "${VREEN_FORMAT_VERSION}"`);
  }
  if (typeof o.camera !== 'object') throw new VreenFormatError('scene.camera missing');
  if (typeof o.environment !== 'object') throw new VreenFormatError('scene.environment missing');
  if (typeof o.postFX !== 'object') throw new VreenFormatError('scene.postFX missing');
  if (typeof o.materials !== 'object') throw new VreenFormatError('scene.materials missing');
  if (typeof o.animation !== 'object' || typeof o.animation.speed !== 'number') {
    throw new VreenFormatError('scene.animation.speed missing');
  }
}

/** 根据 kind 推导 path。 */
export function defaultAssetPath(kind: AssetKind, originalName: string, id: string): string {
  const base = (originalName.split(/[\\/]/).pop() || 'asset').replace(/[^A-Za-z0-9._-]/g, '_');
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  const stem = ext ? base.slice(0, -ext.length) : base;
  const shortId = id.slice(0, 8);
  return `${VREEN_ASSET_DIRS[kind]}/${stem}_${shortId}${ext}`;
}

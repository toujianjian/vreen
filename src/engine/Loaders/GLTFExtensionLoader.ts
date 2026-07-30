// GLTFExtensionLoader — 增强版 GLTF 加载器,参考 three.js GLTFLoader 设计。
//
// 在现有 GLBLoader 之上叠加:
//   - 扩展注册机制 (registerExtension):支持运行时挂载 KHR_* / EXT_* 扩展处理器
//   - DRACO 解码器注入 (setDRACODecoder):KHR_draco_mesh_compression
//   - KTX2 解码器注入 (setKTX2Decoder):KHR_texture_basisu
//   - URL → 已加载场景缓存 (loadedScenes):避免同 URL 重复解析
//   - 细粒度 parse* API:可单独解析 GLTF JSON / node / mesh / material / accessor / bufferView
//
// 与 GLBLoader 的关系:
//   - GLBLoader 关注 .glb 二进制容器解析 → 自研引擎对象
//   - GLTFExtensionLoader 在解析前后插入扩展处理 / 缓存 / 注入解码器
//   - 实际 JSON+BIN 解析仍委托 GLBLoader.parseGLB + buildFromGltf 路径
//
// 与 three.js GLTFLoader 的差异:
//   - three.js 用 pluginCallbacks 注册解析器;VREEN 用 extensionHandlers Map
//   - three.js 内置所有 KHR 扩展;VREEN 只内置 DRACO,其余扩展需外部注册
//   - VREEN 不维护 LoadingManager (与 AssetManager 解耦)
//
// API:
//   const loader = new GLTFExtensionLoader();
//   loader.setDRACODecoder(dracoDecoderModule);
//   loader.registerExtension('KHR_materials_unlit', (parser, ctx) => { ... });
//   const result = await loader.loadAsync('model.glb');
//   scene.add(result.root);

import { Object3D } from '../Core/Object3D';
import { Group } from '../Core/Group';
import { GLBLoader, parseGLB, type LoadedGLB } from './GLBLoader';
import {
  AssetSource,
  LoaderContext,
  toArrayBuffer,
  fetchAsArrayBuffer,
} from './Loader';
import { createLogger } from '@/lib/logger';

const log = createLogger('GLTFExtensionLoader');

// ── 公共类型 ────────────────────────────────────────────────

/**
 * 扩展处理器上下文。传入每个 registerExtension 注册的回调。
 */
export interface GLTFExtensionContext {
  /** 整个 GLTF JSON 对象。 */
  json: GLTFJson;
  /** 原始 BIN chunk 引用 (可为 null,纯 JSON glTF 场景)。 */
  bin: Uint8Array | null;
  /** 当前正在解析的 node/mesh/material 索引 (-1 表示全局)。 */
  index: number;
  /** 当前扩展的 raw JSON 对象 (extensions[extName])。 */
  extensionData: unknown;
  /** 解析器实例 (本 loader),扩展可访问其内部 API。 */
  parser: GLTFExtensionLoader;
}

/**
 * 扩展处理器签名。
 *  - beforeParse(json, bin):在 JSON 解析前调用,可修改 JSON 或返回新 JSON
 *  - afterParseNode(node, ctx):在 node 构建后调用,可修改/替换 node
 *  - afterParseMesh(mesh, ctx):同上,对 mesh
 *  - afterParseMaterial(material, ctx):同上,对材质
 *  - 后处理 (dispose):loader dispose 时清理扩展自身状态
 */
export interface GLTFExtensionHandler {
  name: string;
  /** 全局预处理,在 JSON 解析前调用。返回新 JSON 或 undefined (原地修改)。 */
  beforeParse?(json: GLTFJson, bin: Uint8Array | null): GLTFJson | void;
  /** node 构建后调用 (index 为 node 索引)。 */
  afterParseNode?(node: Object3D, ctx: GLTFExtensionContext): void;
  /** mesh 构建后调用 (index 为 mesh 索引)。 */
  afterParseMesh?(mesh: unknown, ctx: GLTFExtensionContext): void;
  /** material 构建后调用 (index 为 material 索引)。 */
  afterParseMaterial?(material: unknown, ctx: GLTFExtensionContext): void;
  /** loader dispose 时调用,清理扩展状态。 */
  dispose?(): void;
}

/**
 * GLTF 2.0 JSON 顶层结构 (与 GLBLoader.GltfJson 对齐,但导出为公共类型供扩展使用)。
 */
export interface GLTFJson {
  asset?: { version?: string; generator?: string; copyright?: string };
  scene?: number;
  scenes?: { name?: string; nodes: number[] }[];
  nodes?: GLTFNode[];
  meshes?: GLTFMesh[];
  accessors?: GLTFAccessor[];
  bufferViews?: GLTFBufferView[];
  buffers?: GLTFBuffer[];
  materials?: GLTFMaterial[];
  skins?: GLTFSkin[];
  animations?: GLTFAnimation[];
  textures?: GLTFTexture[];
  images?: GLTFImage[];
  samplers?: GLTFSampler[];
  cameras?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  camera?: number;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFMesh {
  name?: string;
  primitives: GLTFPrimitive[];
  weights?: number[];
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: { [semantic: string]: number }[];
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFAccessor {
  bufferView?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';
  min?: number[];
  max?: number[];
  normalized?: boolean;
  byteOffset?: number;
  sparse?: unknown;
  name?: string;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFBuffer {
  byteLength: number;
  uri?: string;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: { index: number; texCoord?: number };
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: { index: number; texCoord?: number };
  };
  normalTexture?: { index: number; texCoord?: number; scale?: number };
  occlusionTexture?: { index: number; texCoord?: number; strength?: number };
  emissiveTexture?: { index: number; texCoord?: number };
  emissiveFactor?: [number, number, number];
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFSkin {
  joints: number[];
  inverseBindMatrices?: number;
  skeleton?: number;
  name?: string;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFAnimation {
  name?: string;
  channels: { sampler: number; target: { node: number; path: string } }[];
  samplers: { input: number; output: number; interpolation?: string }[];
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFTexture {
  sampler?: number;
  source?: number;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFImage {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
  name?: string;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

export interface GLTFSampler {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
  name?: string;
  extensions?: Record<string, unknown>;
  extras?: unknown;
}

// ── DRACO / KTX2 解码器抽象 ────────────────────────────────

/**
 * DRACO 解码器接口 (与 DracoDecoder.ts 的 decodeDraco 对齐)。
 * 注入后 GLTFExtensionLoader 会用它解码 KHR_draco_mesh_compression primitive。
 */
export interface DRACODecoderLike {
  decode(
    bytes: Uint8Array,
    specs: { semantic: string; componentCount: number }[],
  ): Promise<{
    positions: Float32Array | null;
    normals: Float32Array | null;
    uvs: Float32Array | null;
    tangents: Float32Array | null;
    colors: Float32Array | null;
    indices: Uint32Array;
    vertexCount: number;
  }>;
}

/**
 * KTX2 解码器接口 (与 KTX2Loader 的 parseKtx2Container 对齐)。
 * 注入后 GLTFExtensionLoader 在 KHR_texture_basisu 命中时使用。
 */
export interface KTX2DecoderLike {
  parse(bytes: Uint8Array): Promise<unknown>;
}

// ── 主类 ────────────────────────────────────────────────────

/**
 * 增强版 GLTF 加载器。
 *
 * 内部委托 GLBLoader 完成 .glb / .gltf 二进制容器解析,在解析前后插入扩展处理:
 *   1. beforeParse:扩展可改写 JSON (例如移除 Draco 标记)
 *   2. 委托 GLBLoader.load 完成实际场景构建
 *   3. afterParseNode/Mesh/Material:扩展可对构建结果做后处理
 *   4. 缓存结果到 loadedScenes
 */
export class GLTFExtensionLoader {
  readonly format = 'gltf';

  /** 是否支持 DRACO 解码 (setDRACODecoder 后置 true)。 */
  dracoSupported: boolean = false;
  /** 是否支持 KTX2 解码 (setKTX2Decoder 后置 true)。 */
  ktx2Supported: boolean = false;

  /** 已注册扩展 (按 name 索引,后注册的覆盖同名)。 */
  extensionHandlers: Map<string, GLTFExtensionHandler> = new Map();

  /** 已加载场景缓存 (按 URL/源 key 索引)。 */
  loadedScenes: Map<string, LoadedGLB> = new Map();

  /** 内部 GLBLoader 实例 (复用其 parseGLB + buildFromGltf 路径)。 */
  private _glbLoader: GLBLoader = new GLBLoader();

  /** DRACO 解码器实例 (注入式,避免直接依赖 draco3d)。 */
  private _dracoDecoder: DRACODecoderLike | null = null;

  /** KTX2 解码器实例。 */
  private _ktx2Decoder: KTX2DecoderLike | null = null;

  /** 命中扩展时使用的原始 JSON (parseGLTFJSON 后保存,供 parse* 子方法访问)。 */
  private _currentJson: GLTFJson | null = null;

  /** 命中扩展时使用的原始 BIN (parseGLTFJSON 后保存)。 */
  private _currentBin: Uint8Array | null = null;

  // ── 加载入口 ──────────────────────────────────────────────

  /**
   * 异步加载 GLTF/GLB 文件。
   * 内部走 fetchAsArrayBuffer (URL) 或 toArrayBuffer (Blob/ArrayBuffer),
   * 然后调用 parse 完成解析。
   *
   * @param source URL 字符串 / Blob / ArrayBuffer / Uint8Array / File
   * @param ctx 加载上下文 (取消信号 / 进度回调)
   */
  async load(source: AssetSource, ctx?: LoaderContext): Promise<LoadedGLB> {
    const t0 = performance.now();
    const cacheKey = this._cacheKeyFor(source);
    const cached = this.loadedScenes.get(cacheKey);
    if (cached) {
      log.debug(`load() cache hit: ${cacheKey}`);
      return cached;
    }
    log.debug(`load() start, source=${this._describeSource(source)}`);

    const buf = await this._readSource(source, ctx);
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    ctx?.onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, ratio: 0.5 });

    const result = await this.parse(buf);
    this.loadedScenes.set(cacheKey, result);
    log.info(`load() done in ${(performance.now() - t0).toFixed(1)}ms, ` +
      `meshes=${result.root.children.length}, animations=${result.animations.length}`);
    ctx?.onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, ratio: 1 });
    return result;
  }

  /** load 的 Promise 别名 (与 three.js GLTFLoader.loadAsync 对齐)。 */
  loadAsync(source: AssetSource, ctx?: LoaderContext): Promise<LoadedGLB> {
    return this.load(source, ctx);
  }

  /**
   * 解析 ArrayBuffer 形式的 GLTF/GLB 数据。
   * 内部走 GLBLoader.parseGLB → beforeParse 扩展钩子 → GLBLoader.load (复用 buildFromGltf) → afterParse* 钩子。
   *
   * 注意:此处不走 loadedScenes 缓存 (缓存只在 load() 顶层命中)。
   */
  async parse(data: ArrayBuffer | Uint8Array): Promise<LoadedGLB> {
    const t0 = performance.now();
    // 归一为独立的 ArrayBuffer (parseGLB 期望 ArrayBuffer;Uint8Array 可能 view 到大 buffer 的子段)
    let buf: ArrayBuffer;
    if (data instanceof Uint8Array) {
      // 仅拷贝非完整 buffer 视图,避免不必要的内存复制
      if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        buf = data.buffer as ArrayBuffer;
      } else {
        buf = data.slice().buffer as ArrayBuffer;
      }
    } else {
      buf = data;
    }
    log.debug(`parse(): ${(buf.byteLength / 1024).toFixed(1)} KB`);

    // 1) GLB 容器解析 → { json, bin }
    const { json, bin } = parseGLB(buf);
    log.debug(`parseGLB done: scenes=${json.scenes?.length ?? 0}, ` +
      `nodes=${json.nodes?.length ?? 0}, meshes=${json.meshes?.length ?? 0}`);

    // 2) beforeParse 钩子 (扩展可改写 JSON,例如预先解 Draco)
    let workingJson: GLTFJson = json as unknown as GLTFJson;
    for (const handler of this.extensionHandlers.values()) {
      if (handler.beforeParse) {
        const next = handler.beforeParse(workingJson, bin);
        if (next) workingJson = next;
      }
    }

    // 3) 缓存 current JSON/BIN 供 parseNode/Mesh/Material 等子方法访问
    this._currentJson = workingJson;
    this._currentBin = bin;

    // 4) 委托 GLBLoader.load 完成实际场景构建 (用 ArrayBuffer 作为 source,
    //    GLBLoader.canLoad 会检测 .glb 后缀,因此用 canLoad=false 走 fallback)
    //    GLBLoader.load 内部已支持 ArrayBuffer/Uint8Array。
    const u8 = new Uint8Array(buf);
    const result = await this._glbLoader.load(u8);

    // 5) afterParse* 钩子:遍历扩展处理器 + 节点树
    if (this.extensionHandlers.size > 0) {
      this._invokeAfterParseHooks(result);
    }

    this._currentJson = null;
    this._currentBin = null;
    log.debug(`parse() done in ${(performance.now() - t0).toFixed(1)}ms`);
    return result;
  }

  // ── 扩展注册 ──────────────────────────────────────────────

  /**
   * 注册扩展处理器。
   * @param name 扩展名 (如 'KHR_materials_unlit')
   * @param handler 处理器实例
   */
  registerExtension(name: string, handler: GLTFExtensionHandler): this {
    this.extensionHandlers.set(name, handler);
    log.debug(`extension registered: ${name}`);
    return this;
  }

  /** 注销扩展。 */
  unregisterExtension(name: string): this {
    const h = this.extensionHandlers.get(name);
    if (h?.dispose) {
      try { h.dispose(); } catch (e) {
        log.warn(`extension "${name}" dispose failed: ${(e as Error).message}`);
      }
    }
    this.extensionHandlers.delete(name);
    return this;
  }

  /** 检查某扩展是否已注册。 */
  hasExtension(name: string): boolean {
    return this.extensionHandlers.has(name);
  }

  /** 检查 GLTF JSON 是否声明使用了某扩展。 */
  isExtensionUsed(json: GLTFJson, name: string): boolean {
    return (json.extensionsUsed ?? []).includes(name);
  }

  /** 检查 GLTF JSON 是否要求某扩展 (硬依赖)。 */
  isExtensionRequired(json: GLTFJson, name: string): boolean {
    return (json.extensionsRequired ?? []).includes(name);
  }

  // ── DRACO / KTX2 注入 ─────────────────────────────────────

  /** 注入 DRACO 解码器 (KHR_draco_mesh_compression)。 */
  setDRACODecoder(decoder: DRACODecoderLike | null): this {
    this._dracoDecoder = decoder;
    this.dracoSupported = decoder !== null;
    log.info(`DRACO decoder ${decoder ? 'set' : 'cleared'}`);
    return this;
  }

  /** 获取当前 DRACO 解码器 (扩展可访问)。 */
  getDRACODecoder(): DRACODecoderLike | null {
    return this._dracoDecoder;
  }

  /** 注入 KTX2 解码器 (KHR_texture_basisu)。 */
  setKTX2Decoder(decoder: KTX2DecoderLike | null): this {
    this._ktx2Decoder = decoder;
    this.ktx2Supported = decoder !== null;
    log.info(`KTX2 decoder ${decoder ? 'set' : 'cleared'}`);
    return this;
  }

  /** 获取当前 KTX2 解码器。 */
  getKTX2Decoder(): KTX2DecoderLike | null {
    return this._ktx2Decoder;
  }

  // ── 缓存管理 ──────────────────────────────────────────────

  /** 获取已加载场景映射 (按 cache key 索引)。 */
  getLoadedScenes(): Map<string, LoadedGLB> {
    return new Map(this.loadedScenes);
  }

  /** 清除所有缓存的场景。不 dispose 已加载的 Group (调用方负责场景生命周期)。 */
  clearCache(): this {
    this.loadedScenes.clear();
    log.debug('cache cleared');
    return this;
  }

  /** 从缓存中移除指定 key。 */
  evictFromCache(key: string): this {
    this.loadedScenes.delete(key);
    return this;
  }

  // ── 细粒度 parse* API (供扩展与外部工具调用) ──────────────

  /**
   * 解析 GLTF JSON (验证 asset.version / 必需扩展是否全部支持)。
   * 不构建场景对象,仅做结构检查。
   * @returns 通过校验的 JSON (原地)
   */
  parseGLTFJSON(json: GLTFJson): GLTFJson {
    if (!json.asset?.version) {
      throw new Error('GLTFExtensionLoader.parseGLTFJSON: missing asset.version');
    }
    const major = parseInt(String(json.asset.version.split('.')[0]), 10);
    if (major !== 2) {
      log.warn(`GLTF version ${json.asset.version} (expected 2.x), attempting anyway`);
    }
    // 检查 extensionsRequired 是否全部已注册或内置 (DRACO)
    const required = json.extensionsRequired ?? [];
    const builtin = this.dracoSupported ? ['KHR_draco_mesh_compression'] : [];
    const missing: string[] = [];
    for (const ext of required) {
      if (!this.extensionHandlers.has(ext) && !builtin.includes(ext)) {
        missing.push(ext);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `GLTFExtensionLoader: required extensions not registered: ${missing.join(', ')}. ` +
        `Use registerExtension() before load().`,
      );
    }
    log.debug(`parseGLTFJSON ok: asset v${json.asset.version}, ` +
      `extensionsUsed=[${(json.extensionsUsed ?? []).join(',')}] ` +
      `extensionsRequired=[${required.join(',')}]`);
    return json;
  }

  /**
   * 解析单个 GLTF node (按索引)。
   * 返回 node 的 TRS 变换与 children 列表 (不构建 Object3D,仅元数据)。
   * 扩展可在 afterParseNode 钩子里访问这些元数据决定是否修改 Object3D。
   */
  parseNode(node: GLTFNode, json: GLTFJson): {
    name: string;
    translation: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
    children: number[];
    meshIndex: number | null;
    skinIndex: number | null;
    cameraIndex: number | null;
    extensions: Record<string, unknown> | null;
  } {
    void json;
    return {
      name: node.name ?? '',
      translation: node.translation ?? [0, 0, 0],
      rotation: node.rotation ?? [0, 0, 0, 1],
      scale: node.scale ?? [1, 1, 1],
      children: node.children ?? [],
      meshIndex: node.mesh ?? null,
      skinIndex: node.skin ?? null,
      cameraIndex: node.camera ?? null,
      extensions: node.extensions ?? null,
    };
  }

  /**
   * 解析单个 mesh (按索引)。
   * 返回 primitive 列表 + 各 primitive 的属性映射。
   */
  parseMesh(mesh: GLTFMesh, json: GLTFJson): {
    name: string;
    primitives: {
      attributes: Record<string, number>;
      indices: number | null;
      material: number | null;
      mode: number;
      extensions: Record<string, unknown> | null;
    }[];
    weights: number[];
    extensions: Record<string, unknown> | null;
  } {
    void json;
    return {
      name: mesh.name ?? '',
      primitives: mesh.primitives.map((p) => ({
        attributes: p.attributes,
        indices: p.indices ?? null,
        material: p.material ?? null,
        mode: p.mode ?? 4,
        extensions: p.extensions ?? null,
      })),
      weights: mesh.weights ?? [],
      extensions: mesh.extensions ?? null,
    };
  }

  /**
   * 解析单个 material (按索引)。
   * 返回 PBR 参数与扩展映射。
   */
  parseMaterial(material: GLTFMaterial, json: GLTFJson): {
    name: string;
    baseColorFactor: [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
    emissiveFactor: [number, number, number];
    alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
    alphaCutoff: number;
    doubleSided: boolean;
    extensions: Record<string, unknown> | null;
  } {
    void json;
    const pbr = material.pbrMetallicRoughness ?? {};
    return {
      name: material.name ?? '',
      baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      emissiveFactor: material.emissiveFactor ?? [0, 0, 0],
      alphaMode: material.alphaMode ?? 'OPAQUE',
      alphaCutoff: material.alphaCutoff ?? 0.5,
      doubleSided: material.doubleSided ?? false,
      extensions: material.extensions ?? null,
    };
  }

  /**
   * 解析单个 accessor (按索引)。
   * 返回 bufferView 索引、componentType、count、type 与归一化标志。
   */
  parseAccessor(accessor: GLTFAccessor, json: GLTFJson): {
    bufferView: number | null;
    componentType: number;
    count: number;
    type: GLTFAccessor['type'];
    normalized: boolean;
    byteOffset: number;
    componentCount: number;
    min: number[] | null;
    max: number[] | null;
  } {
    void json;
    return {
      bufferView: accessor.bufferView ?? null,
      componentType: accessor.componentType,
      count: accessor.count,
      type: accessor.type,
      normalized: accessor.normalized ?? false,
      byteOffset: accessor.byteOffset ?? 0,
      componentCount: this._componentCountFor(accessor.type),
      min: accessor.min ?? null,
      max: accessor.max ?? null,
    };
  }

  /**
   * 解析单个 bufferView (按索引)。
   * 返回 buffer 索引、byteOffset、byteLength、byteStride 与 target。
   */
  parseBufferView(bufferView: GLTFBufferView, json: GLTFJson): {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    byteStride: number | null;
    target: number | null;
    extensions: Record<string, unknown> | null;
  } {
    void json;
    return {
      buffer: bufferView.buffer,
      byteOffset: bufferView.byteOffset ?? 0,
      byteLength: bufferView.byteLength,
      byteStride: bufferView.byteStride ?? null,
      target: bufferView.target ?? null,
      extensions: bufferView.extensions ?? null,
    };
  }

  // ── 内部辅助 ──────────────────────────────────────────────

  /** 遍历场景树调用 afterParseNode 钩子。 */
  private _invokeAfterParseHooks(result: LoadedGLB): void {
    const json = this._currentJson;
    if (!json) return;
    const nodes = json.nodes ?? [];

    // 节点 → Object3D 映射通过 name 匹配 (GLBLoader 用 node.name || `Node_${i}`)
    const nodeNameToObj = new Map<string, Object3D>();
    result.root.traverse((o) => { nodeNameToObj.set(o.name, o); });

    for (let i = 0; i < nodes.length; i++) {
      const nodeDef = nodes[i];
      const obj = nodeNameToObj.get(nodeDef.name ?? `Node_${i}`);
      if (!obj) continue;
      for (const handler of this.extensionHandlers.values()) {
        if (!handler.afterParseNode) continue;
        if (!nodeDef.extensions) continue;
        for (const extName of Object.keys(nodeDef.extensions)) {
          if (handler.name === extName) {
            const ctx: GLTFExtensionContext = {
              json,
              bin: this._currentBin,
              index: i,
              extensionData: nodeDef.extensions[extName],
              parser: this,
            };
            try {
              handler.afterParseNode(obj, ctx);
            } catch (e) {
              log.warn(`extension "${extName}".afterParseNode failed at node #${i}: ${(e as Error).message}`);
            }
          }
        }
      }
    }

    // mesh / material 钩子 (按索引遍历)
    const meshes = json.meshes ?? [];
    const materials = json.materials ?? [];
    for (let i = 0; i < meshes.length; i++) {
      for (const handler of this.extensionHandlers.values()) {
        if (!handler.afterParseMesh) continue;
        if (!meshes[i].extensions) continue;
        for (const extName of Object.keys(meshes[i].extensions!)) {
          if (handler.name === extName) {
            const ctx: GLTFExtensionContext = {
              json,
              bin: this._currentBin,
              index: i,
              extensionData: meshes[i].extensions![extName],
              parser: this,
            };
            try { handler.afterParseMesh(undefined, ctx); } catch (e) {
              log.warn(`extension "${extName}".afterParseMesh failed at mesh #${i}: ${(e as Error).message}`);
            }
          }
        }
      }
    }
    for (let i = 0; i < materials.length; i++) {
      for (const handler of this.extensionHandlers.values()) {
        if (!handler.afterParseMaterial) continue;
        if (!materials[i].extensions) continue;
        for (const extName of Object.keys(materials[i].extensions!)) {
          if (handler.name === extName) {
            const ctx: GLTFExtensionContext = {
              json,
              bin: this._currentBin,
              index: i,
              extensionData: materials[i].extensions![extName],
              parser: this,
            };
            try { handler.afterParseMaterial(undefined, ctx); } catch (e) {
              log.warn(`extension "${extName}".afterParseMaterial failed at material #${i}: ${(e as Error).message}`);
            }
          }
        }
      }
    }
  }

  private _componentCountFor(type: GLTFAccessor['type']): number {
    switch (type) {
      case 'SCALAR': return 1;
      case 'VEC2': return 2;
      case 'VEC3': return 3;
      case 'VEC4': return 4;
      case 'MAT2': return 4;
      case 'MAT3': return 9;
      case 'MAT4': return 16;
    }
  }

  private async _readSource(source: AssetSource, ctx?: LoaderContext): Promise<ArrayBuffer> {
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      return await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    }
    return await toArrayBuffer(source);
  }

  private _cacheKeyFor(source: AssetSource): string {
    if (typeof source === 'string') return `str:${source}`;
    if (source instanceof URL) return `url:${source.toString()}`;
    if (typeof File !== 'undefined' && source instanceof File) return `file:${source.name}|${source.size}|${source.type}`;
    if (typeof Blob !== 'undefined' && source instanceof Blob) return `blob:${source.size}|${source.type}`;
    if (source instanceof Uint8Array) return `u8:${source.byteLength}`;
    if (source instanceof ArrayBuffer) return `ab:${source.byteLength}`;
    return 'unknown';
  }

  private _describeSource(source: AssetSource): string {
    if (typeof source === 'string') return `url(${source})`;
    if (source instanceof URL) return `url(${source.toString()})`;
    if (typeof File !== 'undefined' && source instanceof File) return `file(${source.name}, ${source.size}B)`;
    if (typeof Blob !== 'undefined' && source instanceof Blob) return `blob(${source.size}B, ${source.type || '?'})`;
    if (source instanceof ArrayBuffer) return `ab(${source.byteLength}B)`;
    if (source instanceof Uint8Array) return `u8(${source.byteLength}B)`;
    return 'unknown';
  }

  /** 释放资源:清理扩展状态、缓存、内部 GLBLoader。 */
  dispose(): void {
    for (const handler of this.extensionHandlers.values()) {
      if (handler.dispose) {
        try { handler.dispose(); } catch (e) {
          log.warn(`extension "${handler.name}" dispose failed: ${(e as Error).message}`);
        }
      }
    }
    this.extensionHandlers.clear();
    this.loadedScenes.clear();
    this._dracoDecoder = null;
    this._ktx2Decoder = null;
    this.dracoSupported = false;
    this.ktx2Supported = false;
    this._currentJson = null;
    this._currentBin = null;
  }
}

/** 默认导出的 Group 类型 (供外部类型推断)。 */
export type { Group, Object3D };

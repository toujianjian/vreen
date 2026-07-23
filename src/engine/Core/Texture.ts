// Texture — 引擎侧的纹理抽象。
//
// 当前实现只覆盖最常用的 ImageBitmap-backed 2D 纹理（PNG / JPG / WebP
// 通过浏览器 createImageBitmap）。HDR 浮点纹理由 HDRLoader 返回 RGBA32F
// 的 CPU-side data，由调用方决定是否上传为浮点 GL 纹理。KTX2 容器
// (Phase 4.1) 把数据塞进 compressedLevels,renderer 走 compressedTexImage2D
// 或 texImage2D(per-mip) 上传。
//
// 约定：
//   - `image` 是解码后的位图 (ImageBitmap / HTMLImageElement / RGBA32F data)
//   - `compressedLevels` 是 KTX2 解析后的 per-mip 数据(可能 uncompressed)
//   - `version` 单调递增；外部修改 image 或 compressedLevels 后 bump 一下让 renderer 重传
//   - GPU upload 由 renderer 负责，本类不直接持有 GL handle

import type { CompressedMipmapLevel } from '../Loaders/KTX2Loader';

export type TextureImage =
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | { data: Float32Array; width: number; height: number; format: 'rgba32f' };

export interface TextureOptions {
  flipY?: boolean;
  /** MIN filter. Default LINEAR_MIPMAP_LINEAR when mipmaps enabled. */
  minFilter?: 'linear' | 'nearest' | 'linear-mipmap-linear' | 'linear-mipmap-nearest';
  magFilter?: 'linear' | 'nearest';
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
  generateMipmaps?: boolean;
  /** Color space. Default 'srgb' for color textures, 'linear' for data textures. */
  colorSpace?: 'srgb' | 'linear';
}

/**
 * 像素格式 — 对应 WebGL2 的 format 参数(像素在内存中的通道排列)。
 * 子类纹理(CubeTexture / DataTexture / DepthTexture 等)用此类型描述 format 字段。
 */
export type PixelFormat =
  | 'rgba' // RGBA 四通道
  | 'rgb' // RGB 三通道
  | 'rg' // RG 两通道
  | 'r' // 单通道
  | 'depth' // 深度分量(用于阴影贴图)
  | 'depth-stencil'; // 深度 + 模板

/**
 * 像素数据类型 — 对应 WebGL2 的 type 参数(每个通道的数值表示)。
 * 决定了 typed array 的具体类型与 GPU 内部存储精度。
 */
export type PixelType =
  | 'unsigned-byte' // Uint8Array,归一化到 [0,1]
  | 'unsigned-short' // Uint16Array
  | 'unsigned-int' // Uint32Array(深度纹理默认)
  | 'float' // Float32Array(HDR / 浮点数据)
  | 'half-float'; // Uint16Array(半精度浮点)

/** 立方体纹理映射模式 — 决定视线如何投射到立方体 6 面。 */
export type CubeMapping =
  | 'cube-reflection' // 反射映射(默认,用于环境反射)
  | 'cube-refraction'; // 折射映射(用于玻璃/水类材质)

export class Texture {
  readonly uuid: string;
  name: string;
  image: TextureImage | null = null;
  /**
   * Phase 4.1: KTX2 解析后的 per-mip 数据。
   * 当此字段非 null 时,renderer 走 KTX2 上传路径(忽略 image)。
   * 每个元素描述一个 mip level 的字节、宽高、GL format hint。
   */
  compressedLevels: CompressedMipmapLevel[] | null = null;
  /** compressedLevels 对应的 base level 尺寸。 */
  compressedWidth: number = 0;
  compressedHeight: number = 0;
  /** 每次替换 image 或 compressedLevels 后 +1，renderer 据此判断是否需要重传 GPU。 */
  version: number = 0;

  flipY: boolean;
  minFilter: NonNullable<TextureOptions['minFilter']>;
  magFilter: NonNullable<TextureOptions['magFilter']>;
  wrapS: NonNullable<TextureOptions['wrapS']>;
  wrapT: NonNullable<TextureOptions['wrapT']>;
  generateMipmaps: boolean;
  colorSpace: NonNullable<TextureOptions['colorSpace']>;

  /** renderer 填充：编译出的 GL 纹理句柄。 */
  glTexture: WebGLTexture | null = null;
  glVersion: number = -1;

  constructor(name = 'Texture', opts: TextureOptions = {}) {
    this.uuid = cryptoRand();
    this.name = name;
    this.flipY = opts.flipY ?? true;
    this.minFilter = opts.minFilter ?? 'linear-mipmap-linear';
    this.magFilter = opts.magFilter ?? 'linear';
    this.wrapS = opts.wrapS ?? 'repeat';
    this.wrapT = opts.wrapT ?? 'repeat';
    this.generateMipmaps = opts.generateMipmaps ?? true;
    this.colorSpace = opts.colorSpace ?? 'srgb';
  }

  /** 替换像素数据。自动 bump version。 */
  setImage(img: TextureImage): this {
    this.image = img;
    this.compressedLevels = null;
    this.compressedWidth = 0;
    this.compressedHeight = 0;
    this.version++;
    return this;
  }

  /**
   * Phase 4.1: 设置 KTX2 解析后的 per-mip levels。
   * - 传入非空数组 → renderer 走 compressed/per-mip 上传路径
   * - 同时清空 image 字段
   * - 自动 bump version
   */
  setCompressedLevels(levels: CompressedMipmapLevel[], width: number, height: number): this {
    this.compressedLevels = levels;
    this.compressedWidth = width;
    this.compressedHeight = height;
    this.image = null;
    this.version++;
    return this;
  }

  /** ImageBitmap 形式的尺寸。HDR data texture 走 data 字段。
   *  KTX2 纹理走 compressedWidth/Height。 */
  getSize(): { width: number; height: number } {
    if (this.compressedLevels !== null) {
      return { width: this.compressedWidth, height: this.compressedHeight };
    }
    const im = this.image;
    if (!im) return { width: 0, height: 0 };
    if (im instanceof ImageBitmap || im instanceof HTMLImageElement || im instanceof HTMLCanvasElement || im instanceof OffscreenCanvas) {
      return { width: im.width, height: im.height };
    }
    return { width: im.width, height: im.height };
  }
}

let _texId = 0;
function cryptoRand(): string {
  // 简单 UUID 形式；不依赖 crypto.randomUUID() 兼容旧环境
  _texId = (_texId + 1) | 0;
  return 'tex_' + ((_texId * 0x9e3779b1) >>> 0).toString(16).padStart(8, '0');
}

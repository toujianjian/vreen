// Texture — 引擎侧的纹理抽象。
//
// 当前实现只覆盖最常用的 ImageBitmap-backed 2D 纹理（PNG / JPG / WebP
// 通过浏览器 createImageBitmap）。HDR 浮点纹理由 HDRLoader 返回 RGBA32F
// 的 CPU-side data，由调用方决定是否上传为浮点 GL 纹理。
//
// 约定：
//   - `image` 是解码后的位图 (ImageBitmap / HTMLImageElement / RGBA32F data)
//   - `version` 单调递增；外部修改 image 后 bump 一下让 renderer 重传
//   - GPU upload 由 renderer 负责，本类不直接持有 GL handle

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

export class Texture {
  readonly uuid: string;
  name: string;
  image: TextureImage | null = null;
  /** 每次替换 image 后 +1，renderer 据此判断是否需要重传 GPU。 */
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
    this.version++;
    return this;
  }

  /** ImageBitmap 形式的尺寸。HDR data texture 走 data 字段。 */
  getSize(): { width: number; height: number } {
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

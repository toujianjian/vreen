// CompressedTexture — 压缩纹理基类(S3TC / ETC / BPTC / PVRTC / ASTC 等)。
//
// 适配自 three.js 的 CompressedTexture。与 DataTexture 不同,压缩纹理的
// 像素数据已经是 GPU 可直接消费的压缩块格式,无需在 CPU 端解压。
// renderer 走 compressedTexImage2D(per-mip) 上传。
//
// 约定:
//   - `mipmaps` 数组的每个元素描述一个 mip level 的 {data, width, height}
//   - `format` 是压缩格式枚举(对应 WebGL2 的 GL_COMPRESSED_* 常量语义)
//   - `type` 固定为 'unsigned-byte'(压缩块按字节解释)
//   - `generateMipmaps` 默认 false(压缩纹理通常自带 mip 链)
//   - `flipY` 默认 false(压缩块无法做行翻转,需在上传前自行处理)
//   - 当 `mipmaps` 非空时,base level 尺寸取自 mipmaps[0]

import { Texture, type PixelType } from './Texture';

/**
 * 压缩像素格式 — 对应 WebGL2 的 GL_COMPRESSED_* 常量语义。
 * 子类(如 S3TC/ETC/BPTC 具体类)在构造时固定此字段。
 */
export type CompressedPixelFormat =
  | 's3tc-dxt1'
  | 's3tc-dxt3'
  | 's3tc-dxt5'
  | 'bptc'
  | 'etc1'
  | 'etc2-rgb'
  | 'etc2-rgba'
  | 'pvrtc-rgb-4bpp'
  | 'pvrtc-rgba-4bpp'
  | 'astc-4x4'
  | 'astc-6x6'
  | 'astc-8x8';

/** 单个 mip level 的压缩数据。 */
export interface CompressedMipmap {
  /** 压缩块字节流,长度由格式 block size × block count 决定。 */
  data: Uint8Array;
  /** 该 mip level 的宽度(像素)。 */
  width: number;
  /** 该 mip level 的高度(像素)。 */
  height: number;
}

export interface CompressedTextureOptions {
  format?: CompressedPixelFormat;
  type?: PixelType;
  flipY?: boolean;
  generateMipmaps?: boolean;
  colorSpace?: 'srgb' | 'linear';
  minFilter?: 'linear' | 'nearest' | 'linear-mipmap-linear' | 'linear-mipmap-nearest';
  magFilter?: 'linear' | 'nearest';
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
}

export class CompressedTexture extends Texture {
  readonly isCompressedTexture = true;

  /** mip 链数据,索引 0 为 base level。空数组表示尚未填充。 */
  mipmaps: CompressedMipmap[];
  format: CompressedPixelFormat;
  type: PixelType;

  constructor(
    mipmaps: CompressedMipmap[] = [],
    opts: CompressedTextureOptions = {},
  ) {
    super('CompressedTexture', {
      flipY: opts.flipY ?? false,
      generateMipmaps: opts.generateMipmaps ?? false,
      colorSpace: opts.colorSpace ?? 'srgb',
      minFilter: opts.minFilter ?? 'linear-mipmap-linear',
      magFilter: opts.magFilter ?? 'linear',
      wrapS: opts.wrapS ?? 'clamp',
      wrapT: opts.wrapT ?? 'clamp',
    });
    this.mipmaps = mipmaps.slice();
    this.format = opts.format ?? 's3tc-dxt5';
    this.type = opts.type ?? 'unsigned-byte';
  }

  /** 替换 mip 链。自动 bump version。 */
  setMipmaps(mipmaps: CompressedMipmap[]): this {
    this.mipmaps = mipmaps.slice();
    this.version++;
    return this;
  }

  /** 追加一个 mip level。自动 bump version。 */
  addMipmap(level: CompressedMipmap): this {
    this.mipmaps.push(level);
    this.version++;
    return this;
  }

  /** base level 尺寸(取自 mipmaps[0]);无数据时返回 0×0。 */
  getSize(): { width: number; height: number } {
    const base = this.mipmaps[0];
    if (!base) return { width: 0, height: 0 };
    return { width: base.width, height: base.height };
  }

  copy(source: CompressedTexture): this {
    this.name = source.name;
    this.mipmaps = source.mipmaps.map((m) => ({ data: m.data, width: m.width, height: m.height }));
    this.format = source.format;
    this.type = source.type;
    this.flipY = source.flipY;
    this.minFilter = source.minFilter;
    this.magFilter = source.magFilter;
    this.wrapS = source.wrapS;
    this.wrapT = source.wrapT;
    this.generateMipmaps = source.generateMipmaps;
    this.colorSpace = source.colorSpace;
    this.version++;
    return this;
  }

  clone(): CompressedTexture {
    return new CompressedTexture().copy(this);
  }
}

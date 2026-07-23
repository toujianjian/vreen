// DataTexture — 数据纹理,直接从 Uint8Array / Float32Array 创建。
//
// 适配自 three.js 的 DataTexture。data 字段持有原始像素 buffer,width/height
// 描述尺寸,format/type 描述像素解释方式。renderer 走 texImage2D 上传。
//
// 约定:
//   - `data` 为原始 typed array,长度应 >= width * height * channels
//   - `generateMipmaps` 默认 false,`flipY` 默认 false
//   - `unpackAlignment` 默认 1(与 three.js 一致,数据纹理按字节对齐)

import { Texture, type PixelFormat, type PixelType } from './Texture';

/** 数据纹理支持的 typed array 类型。 */
export type DataTextureBuffer =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Float32Array;

export interface DataTextureOptions {
  format?: PixelFormat;
  type?: PixelType;
  flipY?: boolean;
  generateMipmaps?: boolean;
  colorSpace?: 'srgb' | 'linear';
  minFilter?: 'linear' | 'nearest' | 'linear-mipmap-linear' | 'linear-mipmap-nearest';
  magFilter?: 'linear' | 'nearest';
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
  /** 像素行对齐(1/2/4/8),默认 1。 */
  unpackAlignment?: number;
}

export class DataTexture extends Texture {
  readonly isDataTexture = true;

  data: DataTextureBuffer | null;
  width: number;
  height: number;
  format: PixelFormat;
  type: PixelType;
  /** 像素行对齐(1/2/4/8),默认 1。 */
  unpackAlignment: number;

  constructor(
    data: DataTextureBuffer | null = null,
    width = 1,
    height = 1,
    opts: DataTextureOptions = {},
  ) {
    super('DataTexture', {
      flipY: opts.flipY ?? false,
      generateMipmaps: opts.generateMipmaps ?? false,
      colorSpace: opts.colorSpace ?? 'linear',
      minFilter: opts.minFilter ?? 'nearest',
      magFilter: opts.magFilter ?? 'nearest',
      wrapS: opts.wrapS ?? 'clamp',
      wrapT: opts.wrapT ?? 'clamp',
    });
    this.data = data;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.format = opts.format ?? 'rgba';
    // 未显式指定 type 时,按 data 的具体 typed array 类型推断
    this.type = opts.type ?? (data instanceof Float32Array ? 'float' : 'unsigned-byte');
    this.unpackAlignment = opts.unpackAlignment ?? 1;
  }

  copy(source: DataTexture): this {
    this.name = source.name;
    this.data = source.data;
    this.width = source.width;
    this.height = source.height;
    this.format = source.format;
    this.type = source.type;
    this.unpackAlignment = source.unpackAlignment;
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

  clone(): DataTexture {
    return new DataTexture().copy(this);
  }

  /** 序列化为普通对象(data 仅记录长度,不直接序列化原始像素)。 */
  toJSON(): Record<string, unknown> {
    return {
      uuid: this.uuid,
      name: this.name,
      width: this.width,
      height: this.height,
      format: this.format,
      type: this.type,
      unpackAlignment: this.unpackAlignment,
      flipY: this.flipY,
      minFilter: this.minFilter,
      magFilter: this.magFilter,
      wrapS: this.wrapS,
      wrapT: this.wrapT,
      generateMipmaps: this.generateMipmaps,
      colorSpace: this.colorSpace,
      dataLength: this.data?.length ?? 0,
      dataByteLength: this.data?.byteLength ?? 0,
    };
  }
}

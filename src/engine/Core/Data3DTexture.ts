// Data3DTexture — 真 3D 纹理 (WebGL2 TEXTURE_3D)。
//
// 适配自 three.js Data3DTexture(r152+),用于:
//   - 3D LUT 颜色查找表(电影级调色,与 LUTCubeLoader / LUTPass 配套)
//   - 体积雾 / 体积光照(密度场采样)
//   - 体素数据(医疗 CT/MRI 切片、MarchingCubes 密度场)
//   - 3D 噪声预计算(Perlin/Worley 3D 噪声缓存)
//
// 与 DataArrayTexture 的区别:
//   - DataArrayTexture → TEXTURE_2D_ARRAY:多层 2D 纹理,层间无插值,
//     适合纹理图集、阴影级联;采样器 sampler2DArray。
//   - Data3DTexture → TEXTURE_3D:三线性各向同性插值,
//     适合连续体积场(密度/LUT);采样器 sampler3D。
//
// 约定:
//   - `data` 长度应 >= width * height * depth * channels
//   - `generateMipmaps` 默认 false,`flipY` 默认 false
//   - `wrapR` 控制 R(深度)方向包裹,默认 clamp
//   - renderer 上传走 texImage3D(TEXTURE_3D, ...)

import { Texture, type PixelFormat, type PixelType } from './Texture';
import type { DataTextureBuffer } from './DataTexture';

/** R(深度)方向包裹模式。 */
export type WrapR = 'repeat' | 'clamp' | 'mirror';

export interface Data3DTextureOptions {
  format?: PixelFormat;
  type?: PixelType;
  flipY?: boolean;
  generateMipmaps?: boolean;
  colorSpace?: 'srgb' | 'linear';
  wrapR?: WrapR;
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
  minFilter?: 'linear' | 'nearest' | 'linear-mipmap-linear' | 'linear-mipmap-nearest';
  magFilter?: 'linear' | 'nearest';
  /** 像素行对齐(1/2/4/8),默认 1。 */
  unpackAlignment?: number;
}

/**
 * 真 3D 纹理 — 对应 WebGL2 `TEXTURE_3D`。
 *
 * 三线性插值在三个维度上连续,适合体积场采样。
 * 采样器类型为 `sampler3D`(GLSL `texture(sampler3D, vec3)`).
 */
export class Data3DTexture extends Texture {
  readonly isData3DTexture = true;

  data: DataTextureBuffer | null;
  width: number;
  height: number;
  depth: number;
  format: PixelFormat;
  type: PixelType;
  /** R 方向(深度方向)包裹模式,默认 clamp。 */
  wrapR: WrapR;
  unpackAlignment: number;

  constructor(
    data: DataTextureBuffer | null = null,
    width = 1,
    height = 1,
    depth = 1,
    opts: Data3DTextureOptions = {},
  ) {
    super('Data3DTexture', {
      flipY: opts.flipY ?? false,
      generateMipmaps: opts.generateMipmaps ?? false,
      colorSpace: opts.colorSpace ?? 'linear',
      minFilter: opts.minFilter ?? 'linear',
      magFilter: opts.magFilter ?? 'linear',
      wrapS: opts.wrapS ?? 'clamp',
      wrapT: opts.wrapT ?? 'clamp',
    });
    this.data = data;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.depth = Math.max(1, Math.floor(depth));
    this.format = opts.format ?? 'rgba';
    this.type = opts.type ?? (data instanceof Float32Array ? 'float' : 'unsigned-byte');
    this.wrapR = opts.wrapR ?? 'clamp';
    this.unpackAlignment = opts.unpackAlignment ?? 1;
  }

  /** 替换体素数据并 bump version(触发 renderer 重传)。 */
  setData(data: DataTextureBuffer, width: number, height: number, depth: number): this {
    this.data = data;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.depth = Math.max(1, Math.floor(depth));
    this.version++;
    return this;
  }

  copy(source: Data3DTexture): this {
    this.name = source.name;
    this.data = source.data;
    this.width = source.width;
    this.height = source.height;
    this.depth = source.depth;
    this.format = source.format;
    this.type = source.type;
    this.wrapR = source.wrapR;
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

  clone(): Data3DTexture {
    return new Data3DTexture().copy(this);
  }
}

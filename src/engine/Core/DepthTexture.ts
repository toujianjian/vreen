// DepthTexture — 深度纹理,用于阴影贴图 / 深度后处理。
//
// 适配自 three.js 的 DepthTexture。仅保存 width/height/type/format,
// 真正的 GL 深度纹理由 renderer 在 FBO 创建时分配(gl.texImage2D +
// DEPTH_COMPONENT24 / DEPTH24_STENCIL8)。
//
// 约定:
//   - `format` 必须为 'depth' 或 'depth-stencil',否则构造抛错
//   - `generateMipmaps` 默认 false,`flipY` 默认 false
//   - `compareFunction` 默认 null(不启用硬件深度比较)
//   - 默认 filter 为 nearest(深度纹理不做插值)

import { Texture, type PixelFormat, type PixelType } from './Texture';

/** 深度比较函数(对应 WebGL2 的 compare function,用于硬件 PCF)。 */
export type DepthCompareFunction =
  | 'never'
  | 'less'
  | 'equal'
  | 'less-equal'
  | 'greater'
  | 'not-equal'
  | 'greater-equal'
  | 'always';

export interface DepthTextureOptions {
  type?: PixelType;
  format?: PixelFormat;
  flipY?: boolean;
  generateMipmaps?: boolean;
  compareFunction?: DepthCompareFunction | null;
}

export class DepthTexture extends Texture {
  readonly isDepthTexture = true;

  width: number;
  height: number;
  type: PixelType;
  format: PixelFormat;
  /** 深度比较函数,默认 null(不启用比较)。 */
  compareFunction: DepthCompareFunction | null;

  constructor(width: number, height: number, opts: DepthTextureOptions = {}) {
    super('DepthTexture', {
      flipY: opts.flipY ?? false,
      generateMipmaps: opts.generateMipmaps ?? false,
      colorSpace: 'linear',
      minFilter: 'nearest',
      magFilter: 'nearest',
      wrapS: 'clamp',
      wrapT: 'clamp',
    });
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.type = opts.type ?? 'unsigned-int';
    const fmt = opts.format ?? 'depth';
    if (fmt !== 'depth' && fmt !== 'depth-stencil') {
      throw new Error("DepthTexture: format 必须为 'depth' 或 'depth-stencil'");
    }
    this.format = fmt;
    this.compareFunction = opts.compareFunction ?? null;
  }

  copy(source: DepthTexture): this {
    this.name = source.name;
    this.width = source.width;
    this.height = source.height;
    this.type = source.type;
    this.format = source.format;
    this.compareFunction = source.compareFunction;
    this.flipY = source.flipY;
    this.minFilter = source.minFilter;
    this.magFilter = source.magFilter;
    this.wrapS = source.wrapS;
    this.wrapT = source.wrapT;
    this.generateMipmaps = source.generateMipmaps;
    this.version++;
    return this;
  }

  clone(): DepthTexture {
    return new DepthTexture(this.width, this.height).copy(this);
  }
}

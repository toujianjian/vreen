// CubeTexture — 立方体纹理(6 面环境贴图)。
//
// 适配自 three.js 的 CubeTexture。保留 6 面 images 数组、mapping、format、type
// 等核心属性。本类不直接持有 GL handle,上传由 renderer 负责。
//
// 约定:
//   - `images` 顺序为 [+X, -X, +Y, -Y, +Z, -Z](right, left, top, bottom, front, back)
//   - `flipY` 默认 false(与 three.js 一致,立方体贴图不做 Y 翻转)
//   - `set` / `fromEquirectangular` 后自动 bump version,renderer 据此重传

import { Texture, type CubeMapping, type PixelFormat, type PixelType } from './Texture';

/** 立方体单面图像 — 仅接受位图类源,不支持 data 形式。 */
export type CubeFaceImage =
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas;

export interface CubeTextureOptions {
  mapping?: CubeMapping;
  format?: PixelFormat;
  type?: PixelType;
  flipY?: boolean;
  generateMipmaps?: boolean;
  colorSpace?: 'srgb' | 'linear';
  minFilter?: 'linear' | 'nearest' | 'linear-mipmap-linear' | 'linear-mipmap-nearest';
  magFilter?: 'linear' | 'nearest';
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
}

const EMPTY_FACES: (CubeFaceImage | null)[] = [null, null, null, null, null, null];

export class CubeTexture extends Texture {
  readonly isCubeTexture = true;

  /** 6 面图像,顺序 [+X, -X, +Y, -Y, +Z, -Z]。 */
  images: (CubeFaceImage | null)[];
  mapping: CubeMapping;
  format: PixelFormat;
  type: PixelType;

  constructor(
    images: (CubeFaceImage | null)[] = EMPTY_FACES,
    opts: CubeTextureOptions = {},
  ) {
    super('CubeTexture', {
      flipY: opts.flipY ?? false,
      generateMipmaps: opts.generateMipmaps ?? true,
      colorSpace: opts.colorSpace ?? 'srgb',
      minFilter: opts.minFilter ?? 'linear-mipmap-linear',
      magFilter: opts.magFilter ?? 'linear',
      wrapS: opts.wrapS ?? 'clamp',
      wrapT: opts.wrapT ?? 'clamp',
    });
    this.images = images.length === 6 ? images.slice() : EMPTY_FACES.slice();
    this.mapping = opts.mapping ?? 'cube-reflection';
    this.format = opts.format ?? 'rgba';
    this.type = opts.type ?? 'unsigned-byte';
  }

  /** 替换 6 面图像。自动 bump version。 */
  set(images: (CubeFaceImage | null)[]): this {
    if (images.length !== 6) {
      throw new Error('CubeTexture.set: images 必须为长度 6 的数组');
    }
    this.images = images.slice();
    this.version++;
    return this;
  }

  /** 复制 source 的字段到本实例。自动 bump version。 */
  copy(source: CubeTexture): this {
    this.name = source.name;
    this.images = source.images.slice();
    this.mapping = source.mapping;
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

  clone(): CubeTexture {
    return new CubeTexture().copy(this);
  }

  /**
   * 从等距矩形 (equirectangular) 全景图生成立方体 6 面(简化版)。
   *
   * 简化策略:将源图引用填入 6 面,标记 version 触发更新。真正的等距矩形
   * → 立方体重投影需要 GPU 采样,由 renderer / PMREM 流程完成,超出本类职责。
   */
  fromEquirectangular(source: CubeFaceImage): this {
    this.images = [source, source, source, source, source, source];
    this.version++;
    return this;
  }
}

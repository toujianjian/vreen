// DataArrayTexture — 2D 数组纹理(纹理数组)。
//
// 适配自 three.js 的 DataArrayTexture。在 DataTexture 基础上增加 depth 维度,
// 用于一次绑定访问多层纹理。renderer 上传走 texStorage3D / texSubImage3D。
//
// 约定:
//   - `data` 长度应 >= width * height * depth * channels
//   - `generateMipmaps` 默认 false,`flipY` 默认 false
//   - `wrapR` 控制 W(深度)方向包裹,默认 clamp
//   - `layerUpdates` 记录需要局部更新的层索引,renderer 消费后清空

import { Texture, type PixelFormat, type PixelType } from './Texture';
import type { DataTextureBuffer } from './DataTexture';

/** W(深度)方向包裹模式。 */
export type WrapR = 'repeat' | 'clamp' | 'mirror';

export interface DataArrayTextureOptions {
  format?: PixelFormat;
  type?: PixelType;
  flipY?: boolean;
  generateMipmaps?: boolean;
  colorSpace?: 'srgb' | 'linear';
  wrapR?: WrapR;
  /** 像素行对齐(1/2/4/8),默认 1。 */
  unpackAlignment?: number;
}

export class DataArrayTexture extends Texture {
  readonly isDataArrayTexture = true;

  data: DataTextureBuffer | null;
  width: number;
  height: number;
  depth: number;
  format: PixelFormat;
  type: PixelType;
  /** W 方向(深度方向)包裹模式,默认 clamp。 */
  wrapR: WrapR;
  unpackAlignment: number;
  /** 需要更新的层索引集合(renderer 消费后清空)。 */
  layerUpdates: Set<number>;

  constructor(
    data: DataTextureBuffer | null = null,
    width = 1,
    height = 1,
    depth = 1,
    opts: DataArrayTextureOptions = {},
  ) {
    super('DataArrayTexture', {
      flipY: opts.flipY ?? false,
      generateMipmaps: opts.generateMipmaps ?? false,
      colorSpace: opts.colorSpace ?? 'linear',
      minFilter: 'nearest',
      magFilter: 'nearest',
      wrapS: 'clamp',
      wrapT: 'clamp',
    });
    this.data = data;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.depth = Math.max(1, Math.floor(depth));
    this.format = opts.format ?? 'rgba';
    this.type = opts.type ?? (data instanceof Float32Array ? 'float' : 'unsigned-byte');
    this.wrapR = opts.wrapR ?? 'clamp';
    this.unpackAlignment = opts.unpackAlignment ?? 1;
    this.layerUpdates = new Set<number>();
  }

  /** 标记某层需要更新(renderer 仅重传该层,而非整个数组)。自动 bump version。 */
  addLayerUpdate(layerIndex: number): this {
    this.layerUpdates.add(layerIndex);
    this.version++;
    return this;
  }

  /** 清空层更新标记。 */
  clearLayerUpdates(): this {
    this.layerUpdates.clear();
    return this;
  }

  copy(source: DataArrayTexture): this {
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
    this.layerUpdates = new Set(source.layerUpdates);
    this.version++;
    return this;
  }

  clone(): DataArrayTexture {
    return new DataArrayTexture().copy(this);
  }
}

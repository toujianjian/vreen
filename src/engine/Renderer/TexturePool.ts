// TexturePool — 无绑定纹理池 (适配自 o3de Atom Bindless 概念)。
//
// o3de 的 Bindless 系统允许着色器通过整数索引访问任意纹理,无需逐 draw 绑定。
// 这对 GPU 驱动渲染、地形材质混合、Decal 贴花、光线追踪等场景至关重要。
//
// WebGL2 适配:
//   o3de 使用 DX12/Vulkan 的 descriptor heap + bindless flag。
//   VREEN 使用 WebGL2 TEXTURE_2D_ARRAY:
//     - 所有纹理打包到一个 DataArrayTexture (sampler2DArray)
//     - 着色器用 texture(sampler2DArray, vec3(uv, slotIndex)) 采样
//     - 逐 draw 只需传入 slotIndex (uniform 或顶点属性)
//
// 用途:
//   - GPU 驱动渲染:Compute shader 剔除后,每个 meshlet 自带纹理索引
//   - 地形材质混合:Shader 根据 material mask 采样不同纹理层
//   - Instanced 渲染:每个实例关联不同纹理,通过 instance attribute 传入索引
//   - Decal 系统:Decal 贴图按索引查找,无需逐 decal 绑定
//
// 参考:
//   - o3de Gems/Atom/RHI/Bindless.md
//   - o3de Atom RHI ImagePool / DescriptorPool
//   - WebGL2 TEXTURE_2D_ARRAY (sampler2DArray)

import { DataArrayTexture } from '../Core/DataArrayTexture';
import type { DataTextureBuffer } from '../Core/DataTexture';
import type { PixelFormat, PixelType } from '../Core/Texture';

/** 纹理池槽位状态。 */
type SlotState = 'free' | 'occupied' | 'dirty';

/** 单个槽位的元数据。 */
interface SlotInfo {
  state: SlotState;
  /** 槽位版本号(每次更新递增)。 */
  version: number;
  /** 用户标签(可选,用于调试)。 */
  label?: string;
}

export interface TexturePoolOptions {
  /** 池容量(最大纹理数)。默认 512。 */
  capacity?: number;
  /** 每张纹理的宽度。默认 1024。 */
  width?: number;
  /** 每张纹理的高度。默认 1024。 */
  height?: number;
  /** 像素格式。默认 'rgba'。 */
  format?: PixelFormat;
  /** 像素类型。默认 'unsigned-byte'。 */
  type?: PixelType;
  /** 是否生成 mipmap。默认 false。 */
  generateMipmaps?: boolean;
  /** 颜色空间。默认 'srgb'。 */
  colorSpace?: 'srgb' | 'linear';
}

/**
 * 无绑定纹理池 — 将多张纹理打包到 TEXTURE_2D_ARRAY,着色器通过整数索引访问。
 *
 * 适配自 o3de Atom Bindless 系统,使用 WebGL2 sampler2DArray 实现。
 *
 * 用法:
 * ```ts
 * const pool = new TexturePool({ capacity: 256, width: 512, height: 512 });
 * const slot = pool.allocate('diffuse-0');
 * pool.update(slot, textureData);
 * // 着色器中: texture(sampler2DArray, vec3(uv, slot))
 * pool.free(slot);
 * ```
 */
export class TexturePool {
  /** 池容量(最大纹理数)。 */
  readonly capacity: number;
  /** 每张纹理宽度。 */
  readonly width: number;
  /** 每张纹理高度。 */
  readonly height: number;
  /** 像素格式。 */
  readonly format: PixelFormat;
  /** 像素类型。 */
  readonly type: PixelType;

  /** 底层 DataArrayTexture (renderer 上传到 TEXTURE_2D_ARRAY)。 */
  readonly arrayTexture: DataArrayTexture;

  /** 槽位元数据。 */
  private _slots: SlotInfo[];
  /** 空闲槽位链表(栈)。 */
  private _freeList: number[];
  /** 已分配槽位数。 */
  private _allocatedCount = 0;

  constructor(opts: TexturePoolOptions = {}) {
    this.capacity = Math.max(1, Math.floor(opts.capacity ?? 512));
    this.width = Math.max(1, Math.floor(opts.width ?? 1024));
    this.height = Math.max(1, Math.floor(opts.height ?? 1024));
    this.format = opts.format ?? 'rgba';
    this.type = opts.type ?? 'unsigned-byte';

    // 计算通道数
    const channels = this.format === 'rgba' ? 4
      : this.format === 'rgb' ? 3
      : this.format === 'rg' ? 2 : 1;

    // 分配底层 buffer
    const dataCtor = this.type === 'float' ? Float32Array
      : this.type === 'half-float' ? Uint16Array
      : this.type === 'unsigned-short' ? Uint16Array
      : this.type === 'unsigned-int' ? Uint32Array
      : Uint8Array;
    const data = new dataCtor(this.width * this.height * this.capacity * channels) as DataTextureBuffer;

    this.arrayTexture = new DataArrayTexture(data, this.width, this.height, this.capacity, {
      format: this.format,
      type: this.type,
      generateMipmaps: opts.generateMipmaps ?? false,
      colorSpace: opts.colorSpace ?? 'srgb',
      wrapR: 'clamp',
      flipY: false,
      unpackAlignment: 1,
    });
    // DataArrayTexture 硬编码 wrapS/wrapT=clamp, minFilter/magFilter=nearest,
    // 这里覆盖为池所需配置
    this.arrayTexture.wrapS = 'repeat';
    this.arrayTexture.wrapT = 'repeat';
    this.arrayTexture.minFilter = opts.generateMipmaps ? 'linear-mipmap-linear' : 'linear';
    this.arrayTexture.magFilter = 'linear';
    this.arrayTexture.name = 'TexturePool';

    // 初始化槽位
    this._slots = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      this._slots[i] = { state: 'free', version: 0 };
    }
    // 空闲列表(从后往前,这样 allocate 返回 0, 1, 2, ...)
    this._freeList = [];
    for (let i = this.capacity - 1; i >= 0; i--) {
      this._freeList.push(i);
    }
  }

  /** 已分配槽位数。 */
  get allocatedCount(): number { return this._allocatedCount; }

  /** 可用槽位数。 */
  get freeCount(): number { return this.capacity - this._allocatedCount; }

  /**
   * 分配一个纹理槽位。
   * @param label 可选调试标签
   * @returns 槽位索引,若池已满返回 -1
   */
  allocate(label?: string): number {
    if (this._freeList.length === 0) return -1;
    const slot = this._freeList.pop()!;
    this._slots[slot].state = 'occupied';
    this._slots[slot].version++;
    this._slots[slot].label = label;
    this._allocatedCount++;
    return slot;
  }

  /**
   * 释放一个纹理槽位。
   * @param slot 槽位索引
   */
  free(slot: number): void {
    if (slot < 0 || slot >= this.capacity) return;
    if (this._slots[slot].state === 'free') return;
    this._slots[slot].state = 'free';
    this._slots[slot].label = undefined;
    this._freeList.push(slot);
    this._allocatedCount--;
  }

  /**
   * 更新槽位中的纹理数据。
   * @param slot 槽位索引
   * @param data 纹理像素数据(宽度×高度×channels)
   */
  update(slot: number, data: DataTextureBuffer): void {
    if (slot < 0 || slot >= this.capacity) {
      throw new Error(`TexturePool.update: slot ${slot} out of range [0, ${this.capacity})`);
    }
    if (this._slots[slot].state !== 'occupied') {
      throw new Error(`TexturePool.update: slot ${slot} is not allocated`);
    }

    // 将数据拷贝到 arrayTexture 的对应层
    const channels = this.format === 'rgba' ? 4
      : this.format === 'rgb' ? 3
      : this.format === 'rg' ? 2 : 1;
    const layerSize = this.width * this.height * channels;
    const offset = slot * layerSize;
    const src = data;
    const dst = this.arrayTexture.data!;

    // 逐元素拷贝(处理类型差异)
    const copyCount = Math.min(src.length, layerSize);
    for (let i = 0; i < copyCount; i++) {
      dst[offset + i] = src[i];
    }

    // 标记层需要更新
    this.arrayTexture.layerUpdates.add(slot);
    this._slots[slot].version++;
    this.arrayTexture.version++;
  }

  /** 获取槽位版本号(用于 GPU 驱动渲染的版本检查)。 */
  getSlotVersion(slot: number): number {
    if (slot < 0 || slot >= this.capacity) return -1;
    return this._slots[slot].version;
  }

  /** 获取槽位标签。 */
  getSlotLabel(slot: number): string | undefined {
    if (slot < 0 || slot >= this.capacity) return undefined;
    return this._slots[slot].label;
  }

  /** 检查槽位是否已分配。 */
  isAllocated(slot: number): boolean {
    if (slot < 0 || slot >= this.capacity) return false;
    return this._slots[slot].state === 'occupied';
  }

  /** 释放所有槽位。 */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this._slots[i].state = 'free';
      this._slots[i].label = undefined;
    }
    this._freeList = [];
    for (let i = this.capacity - 1; i >= 0; i--) {
      this._freeList.push(i);
    }
    this._allocatedCount = 0;
  }

  /** 获取池统计信息。 */
  getStats(): TexturePoolStats {
    return {
      capacity: this.capacity,
      allocated: this._allocatedCount,
      free: this.capacity - this._allocatedCount,
      width: this.width,
      height: this.height,
      format: this.format,
      type: this.type,
    };
  }
}

/** 纹理池统计信息。 */
export interface TexturePoolStats {
  capacity: number;
  allocated: number;
  free: number;
  width: number;
  height: number;
  format: PixelFormat;
  type: PixelType;
}

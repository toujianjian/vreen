// Source — 纹理数据源封装。
//
// 适配自 three.js 的 Source。把"纹理像素从哪里来"与"纹理采样参数"
// 解耦:Texture 持有采样状态(wrap / filter / colorSpace),Source 持有
// 实际像素数据(ImageData / HTMLImageElement / HTMLCanvasElement / Uint8Array)。
// 当像素数据变化时,调用 needsUpdate() bump version,renderer 据此重传。
//
// 约定:
//   - `data` 是原始像素源,类型联合覆盖最常见的 4 种来源
//   - `width` / `height` 在构造时由调用方显式提供(data 类型不一致,无法统一推断)
//   - `version` 单调递增;外部修改 data 后调用 needsUpdate()
//   - 本类不直接持有 GL handle,纯 CPU 侧元数据

/** Source 接受的像素数据类型。 */
export type SourceData =
  | ImageData
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Float32Array;

export interface SourceOptions {
  width?: number;
  height?: number;
}

export class Source {
  readonly isSource = true;

  /** 原始像素数据。 */
  data: SourceData | null;
  /** 像素宽度(由构造方提供,不随 data 自动推断)。 */
  width: number;
  /** 像素高度(由构造方提供,不随 data 自动推断)。 */
  height: number;
  /**
   * 单调递增的版本号。
   * 外部修改 data 后调用 needsUpdate() 触发 +1,renderer 据此判断是否重传 GPU。
   */
  version: number;

  constructor(data: SourceData | null = null, opts: SourceOptions = {}) {
    this.data = data;
    this.width = Math.max(0, Math.floor(opts.width ?? 0));
    this.height = Math.max(0, Math.floor(opts.height ?? 0));
    this.version = 0;
  }

  /**
   * 标记 data 已变化,需要重新上传 GPU。
   * 每次调用使 version +1。
   */
  needsUpdate(): this {
    this.version++;
    return this;
  }

  /** 替换像素数据。同步更新尺寸并 bump version。 */
  setData(data: SourceData, width: number, height: number): this {
    this.data = data;
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    this.version++;
    return this;
  }

  /** 从 source 拷贝 data/width/height 到本实例。不 bump version(由调用方按需触发)。 */
  copy(source: Source): this {
    this.data = source.data;
    this.width = source.width;
    this.height = source.height;
    return this;
  }

  /** 返回值相等但独立的 Source 实例(data 引用共享)。 */
  clone(): Source {
    return new Source(this.data, { width: this.width, height: this.height });
  }

  /** 序列化为普通对象(data 仅记录类型与长度,不直接序列化原始像素)。 */
  toJSON(): Record<string, unknown> {
    const data = this.data;
    let dataType: string | null = null;
    let dataLength = 0;
    if (data instanceof Uint8Array) {
      dataType = 'Uint8Array';
      dataLength = data.length;
    } else if (data instanceof Uint16Array) {
      dataType = 'Uint16Array';
      dataLength = data.length;
    } else if (data instanceof Uint32Array) {
      dataType = 'Uint32Array';
      dataLength = data.length;
    } else if (data instanceof Float32Array) {
      dataType = 'Float32Array';
      dataLength = data.length;
    } else if (typeof ImageData !== 'undefined' && data instanceof ImageData) {
      dataType = 'ImageData';
      dataLength = data.data.length;
    } else if (typeof HTMLImageElement !== 'undefined' && data instanceof HTMLImageElement) {
      dataType = 'HTMLImageElement';
    } else if (typeof HTMLCanvasElement !== 'undefined' && data instanceof HTMLCanvasElement) {
      dataType = 'HTMLCanvasElement';
    } else if (typeof OffscreenCanvas !== 'undefined' && data instanceof OffscreenCanvas) {
      dataType = 'OffscreenCanvas';
    } else if (data === null) {
      dataType = null;
    } else {
      dataType = 'unknown';
    }
    return {
      width: this.width,
      height: this.height,
      version: this.version,
      dataType,
      dataLength,
    };
  }
}

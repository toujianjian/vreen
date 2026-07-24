// CanvasTexture — 画布纹理,从 HTMLCanvasElement 创建。
//
// 适配自 three.js 的 CanvasTexture。canvas 内容可被外部动态绘制
// (例如 2D 文本、UI 烘焙、签名笔迹),调用 update() 后 version +1,
// renderer 据此从 canvas 重新读取像素并重传 GPU。
//
// 约定:
//   - `canvas` 字段持有 HTMLCanvasElement 源
//   - HTMLCanvasElement 已在基类 TextureImage 联合中,因此构造时
//     同时把 image 指向 canvas,保证基类 getSize() 等方法可用
//   - `generateMipmaps` 默认 true,`flipY` 默认 true(与 three.js 一致)
//   - `update()` 由外部在 canvas 内容变化后调用,bump version 触发重传
//   - `colorSpace` 默认 'srgb'(canvas 通常用于颜色贴图)

import { Texture } from './Texture';

export interface CanvasTextureOptions {
  flipY?: boolean;
  generateMipmaps?: boolean;
  colorSpace?: 'srgb' | 'linear';
  minFilter?: 'linear' | 'nearest' | 'linear-mipmap-linear' | 'linear-mipmap-nearest';
  magFilter?: 'linear' | 'nearest';
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
}

export class CanvasTexture extends Texture {
  readonly isCanvasTexture = true;

  /** 画布元素源。 */
  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, opts: CanvasTextureOptions = {}) {
    super('CanvasTexture', {
      flipY: opts.flipY ?? true,
      generateMipmaps: opts.generateMipmaps ?? true,
      colorSpace: opts.colorSpace ?? 'srgb',
      minFilter: opts.minFilter ?? 'linear-mipmap-linear',
      magFilter: opts.magFilter ?? 'linear',
      wrapS: opts.wrapS ?? 'clamp',
      wrapT: opts.wrapT ?? 'clamp',
    });
    this.canvas = canvas;
    // 让基类 getSize() 等方法直接可用:image 与 canvas 共享引用。
    this.image = canvas;
    // 构造即视为一次像素上传,version 起步为 1。
    this.version = 1;
  }

  /**
   * 由外部在 canvas 内容变化后调用。
   * bump version 触发 renderer 重新从 canvas 读取像素并上传 GPU。
   */
  update(): void {
    this.version++;
  }

  /** 替换 canvas 源。同步 image 字段并 bump version。 */
  setCanvas(canvas: HTMLCanvasElement): this {
    this.canvas = canvas;
    this.image = canvas;
    this.version++;
    return this;
  }

  copy(source: CanvasTexture): this {
    this.name = source.name;
    this.canvas = source.canvas;
    this.image = source.canvas;
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

  clone(): CanvasTexture {
    return new CanvasTexture(this.canvas).copy(this);
  }
}

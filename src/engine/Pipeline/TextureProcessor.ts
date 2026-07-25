// TextureProcessor — 纹理处理器(压缩/调整/生成 mipmap/格式转换/预乘 alpha)。
//
// 设计目标:
//   * 与 AssetPipeline 解耦,可独立调用,也可作为 PipelineStep 注册
//   * 处理对象是引擎的 Texture 类(Core/Texture),不直接绑定 GPU
//   * 像素操作在 CPU 侧进行(基于 ImageBitmap / Canvas),无 WebGL 依赖
//   * 浏览器环境下使用 createImageBitmap / OffscreenCanvas;
//     Node 环境下提供基于 RGBA Uint8ClampedArray 的纯数学实现
//
// 注:compress() 在真实运行时通常由 KTX2 编码器(如 Basis Universal)完成,
// 本类提供的是"标记压缩需求 + 元数据写入"的轻量实现,
// 让管线后续步骤知道该纹理应使用何种压缩目标格式。

import { Texture, type TextureImage } from '../Core/Texture';
import { createLogger } from '@/lib/logger';

const log = createLogger('TextureProcessor');

/**
 * 纹理元数据存储(Texture 类本身未暴露 userData 字段,
 * 用模块级 WeakMap 维护每纹理的处理元数据)。
 */
const textureMetadata = new WeakMap<Texture, Record<string, unknown>>();

/** 取/初始化纹理元数据。 */
function getMetadata(texture: Texture): Record<string, unknown> {
  let m = textureMetadata.get(texture);
  if (!m) { m = {}; textureMetadata.set(texture, m); }
  return m;
}

/** 支持的压缩格式(与 WebGL2 扩展名对齐)。 */
export type CompressedFormat =
  | 's3tc'      // BC1-3
  | 'bptc'      // BC6H/BC7
  | 'etc2'      // ETC2 / EAC
  | 'astc'      // ASTC
  | 'pvrtc'     // PVRTC (iOS)
  | 'none';     // 不压缩

/** 像素格式(目标)。 */
export type TargetFormat = 'rgba8' | 'rgb8' | 'rgba32f' | 'r8';

/**
 * 纹理处理器(全部静态方法)。
 */
export class TextureProcessor {
  /**
   * 压缩纹理(标记压缩需求 + 元数据写入)。
   * 实际编码由 GPU/工具链完成;本方法仅写入元数据,
   * 让 KTX2Loader / 渲染器在后续步骤中选择对应压缩路径。
   */
  static compress(texture: Texture, format: CompressedFormat): Texture {
    getMetadata(texture).compressedFormat = format;
    texture.version++;
    log.info(`compress("${texture.name}") → ${format}`);
    return texture;
  }

  /**
   * 调整纹理大小。
   * 浏览器:用 OffscreenCanvas / createImageBitmap 重新绘制。
   * 数据纹理(rgba32f):直接重采样到新尺寸。
   */
  static async resize(
    texture: Texture,
    width: number,
    height: number,
  ): Promise<Texture> {
    if (width <= 0 || height <= 0) {
      throw new Error(`TextureProcessor.resize: width/height 必须为正数`);
    }
    const im = texture.image;
    if (!im) {
      log.warn(`resize("${texture.name}") — 纹理无 image,跳过`);
      return texture;
    }
    if ('data' in im && im.data instanceof Float32Array) {
      // rgba32f 数据纹理:最近邻重采样
      const src = im.data;
      const srcW = im.width;
      const srcH = im.height;
      const dst = new Float32Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = Math.min(srcW - 1, Math.floor(x * srcW / width));
          const sy = Math.min(srcH - 1, Math.floor(y * srcH / height));
          const si = (sy * srcW + sx) * 4;
          const di = (y * width + x) * 4;
          dst[di] = src[si];
          dst[di + 1] = src[si + 1];
          dst[di + 2] = src[si + 2];
          dst[di + 3] = src[si + 3];
        }
      }
      texture.image = { data: dst, width, height, format: 'rgba32f' };
      texture.version++;
      log.info(`resize("${texture.name}") data ${srcW}x${srcH} → ${width}x${height}`);
      return texture;
    }
    // 浏览器位图路径
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // TS: ImageBitmap / HTMLImageElement 都可绘制到 canvas
        ctx.drawImage(im as CanvasImageSource, 0, 0, width, height);
        const bitmap = canvas.transferToImageBitmap?.();
        if (bitmap) {
          texture.image = bitmap;
          texture.version++;
          log.info(`resize("${texture.name}") bitmap → ${width}x${height}`);
        }
      }
    }
    return texture;
  }

  /**
   * 生成 mipmap(标记需求 + 元数据)。
   * 实际 mipmap 链由 GPU 在 texImage2D 后用 generateMipmap(gl) 生成,
   * 或由 KTX2 编码器在压缩时预生成。本方法开启 generateMipmaps 标志。
   */
  static generateMipmaps(texture: Texture): Texture {
    texture.generateMipmaps = true;
    texture.version++;
    log.info(`generateMipmaps("${texture.name}") — flagged`);
    return texture;
  }

  /**
   * 转换像素格式(标记目标格式)。
   * 实际像素重排发生在 GPU 上传时(由 renderer 根据 colorSpace/format 处理)。
   */
  static convertFormat(texture: Texture, format: TargetFormat): Texture {
    getMetadata(texture).targetFormat = format;
    if (format === 'r8' || format === 'rgb8') {
      // 单通道 / 三通道纹理通常不应使用 sRGB
      texture.colorSpace = 'linear';
    }
    texture.version++;
    log.info(`convertFormat("${texture.name}") → ${format}`);
    return texture;
  }

  /**
   * 预乘 alpha:对每个像素 RGB *= A。
   * 浏览器:通过 OffscreenCanvas + ImageData 操作;
   * 数据纹理:直接遍历 Float32Array。
   */
  static async premultiplyAlpha(texture: Texture): Promise<Texture> {
    const im = texture.image;
    if (!im) {
      log.warn(`premultiplyAlpha("${texture.name}") — 纹理无 image,跳过`);
      return texture;
    }
    if ('data' in im && im.data instanceof Float32Array) {
      const data = im.data;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        data[i] *= a;
        data[i + 1] *= a;
        data[i + 2] *= a;
      }
      texture.version++;
      log.info(`premultiplyAlpha("${texture.name}") data — done`);
      return texture;
    }
    if (typeof OffscreenCanvas !== 'undefined' && 'width' in (im as object)) {
      const w = (im as { width: number }).width;
      const h = (im as { height: number }).height;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(im as CanvasImageSource, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;
        for (let i = 0; i < pixels.length; i += 4) {
          const a = pixels[i + 3] / 255;
          pixels[i] = Math.round(pixels[i] * a);
          pixels[i + 1] = Math.round(pixels[i + 1] * a);
          pixels[i + 2] = Math.round(pixels[i + 2] * a);
        }
        ctx.putImageData(imgData, 0, 0);
        const bitmap = canvas.transferToImageBitmap?.();
        if (bitmap) {
          texture.image = bitmap;
          texture.version++;
          log.info(`premultiplyAlpha("${texture.name}") bitmap — done`);
        }
      }
    }
    return texture;
  }

  /**
   * 工具:从 TextureImage 提取 RGBA Uint8ClampedArray。
   * 仅浏览器环境可用(Node 测试环境会返回 null)。
   */
  static toImageData(image: TextureImage): { data: Uint8ClampedArray; width: number; height: number } | null {
    if ('data' in image && image.data instanceof Float32Array) {
      // rgba32f → rgba8
      const w = image.width, h = image.height;
      const out = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < out.length; i++) {
        out[i] = Math.max(0, Math.min(255, image.data[i] * 255));
      }
      return { data: out, width: w, height: h };
    }
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (!('width' in (image as object))) return null;
    const w = (image as { width: number }).width;
    const h = (image as { height: number }).height;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  }
}

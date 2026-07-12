// TextureLoader — 把 PNG / JPG / WebP / GIF 解码为引擎 Texture。
//
// 走浏览器原生 createImageBitmap（off-main-thread 解码；HEIC 等特殊
// 格式取决于浏览器支持）。本 loader 不直接调用 WebGL——把像素交给
// engine/Core/Texture 包装，renderer 在第一次 draw 时上传到 GPU。

import { Texture, TextureImage, TextureOptions } from '../Core/Texture';
import {
  AssetSource,
  Loader,
  LoaderContext,
  toArrayBuffer,
  fetchAsArrayBuffer,
  isAbortError,
} from './Loader';

export class TextureLoader implements Loader<Texture> {
  readonly format = 'texture';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] && typeof hints['mime'] === 'string') {
      return hints['mime'].startsWith('image/');
    }
    if (source instanceof File) return source.type.startsWith('image/');
    if (source instanceof Blob) return source.type.startsWith('image/');
    if (typeof source === 'string') {
      const lower = source.toLowerCase();
      return /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower);
    }
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<Texture> {
    const image = await this._decodeImage(source, ctx);
    const opts = (ctx?.hints?.['textureOptions'] as TextureOptions | undefined) ?? {};
    const name = typeof source === 'string'
      ? source.split('/').pop() || 'texture'
      : source instanceof File
        ? source.name
        : 'texture';
    const t = new Texture(name, opts);
    t.setImage(image);
    return t;
  }

  private async _decodeImage(source: AssetSource, ctx?: LoaderContext): Promise<TextureImage> {
    const signal = ctx?.signal;
    // 1) URL string → fetch + createImageBitmap
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      const buf = await fetchAsArrayBuffer(url, ctx?.onProgress, signal);
      return await decodeBuffer(buf, signal);
    }
    // 2) Blob-like (File/Blob) → 直接 createImageBitmap
    if (source instanceof Blob) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      try {
        return await createImageBitmap(source);
      } catch (e) {
        if (isAbortError(e)) throw e;
        // 退回 Blob.arrayBuffer → decodeBuffer
        return await decodeBuffer(await source.arrayBuffer(), signal);
      }
    }
    // 3) 已是 ArrayBuffer / Uint8Array
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      return await decodeBuffer(await toArrayBuffer(source), signal);
    }
    throw new TypeError('TextureLoader: unsupported source type');
  }
}

async function decodeBuffer(buf: ArrayBuffer, signal?: AbortSignal): Promise<TextureImage> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  // 用 Blob 包一下，createImageBitmap 接受 Blob
  const blob = new Blob([buf]);
  try {
    return await createImageBitmap(blob);
  } catch (e) {
    if (isAbortError(e)) throw e;
    // 浏览器不支持时，尝试用 Image element 回退
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('image decode failed'));
        i.src = url;
      });
      return img;
    } finally {
      // 延迟 revoke，等浏览器消费完
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

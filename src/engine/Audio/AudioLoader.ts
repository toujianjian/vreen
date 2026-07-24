// AudioLoader — 把任意音频字节流（mp3/ogg/wav/…）解码为 AudioBuffer。
//
// 实现 Loader<AudioBuffer> 接口，可注册进 AssetManager 统一缓存。
// 解码依赖浏览器原生 AudioContext.decodeAudioData；Node 测试环境
// 需通过 AudioContextManager.setContext() 注入带 decodeAudioData 的 mock。

import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
  toArrayBuffer,
} from '../Loaders/Loader';
import { AudioContextManager } from './AudioContext';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioLoader');

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|weba|webm|opus)(\?|#|$)/i;

export class AudioLoader implements Loader<AudioBuffer> {
  readonly format = 'audio';
  /** 可选：复用外部 AudioContext 而不取全局单例。 */
  private readonly _context: AudioContext | undefined;

  constructor(context?: AudioContext) {
    this._context = context;
  }

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] && typeof hints['mime'] === 'string' && hints['mime'].startsWith('audio/')) {
      return true;
    }
    if (source instanceof File) return AUDIO_EXT.test(source.name);
    if (typeof source === 'string') return AUDIO_EXT.test(source);
    return source instanceof Blob || source instanceof ArrayBuffer || source instanceof Uint8Array;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<AudioBuffer> {
    let buf: ArrayBuffer;
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      log.info(`fetch audio: ${url}`);
      buf = await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    } else {
      buf = await toArrayBuffer(source);
    }
    if (ctx?.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    const context = this._context ?? AudioContextManager.getContext();
    // 现代 decodeAudioData 返回 Promise；老 Safari 用回调形式。
    const decode = context.decodeAudioData.bind(context) as (
      data: ArrayBuffer,
      success?: (b: AudioBuffer) => void,
      failure?: (e: unknown) => void,
    ) => Promise<AudioBuffer> | void;

    const result = decode(buf);
    if (result instanceof Promise) {
      const buffer = await result;
      log.info(`decoded audio: ${(buf.byteLength / 1024).toFixed(1)} KB → ${buffer.duration.toFixed(2)}s`);
      return buffer;
    }
    // 回调路径
    return await new Promise<AudioBuffer>((resolve, reject) => {
      decode(buf, resolve, reject);
    });
  }
}

// VideoTexture — 视频纹理,从 HTMLVideoElement 创建。
//
// 适配自 three.js 的 VideoTexture。每帧由 renderer 调用 update() 检查
// video.readyState,有新帧则 bump version 触发重传。
//
// 约定:
//   - `video` 字段持有 HTMLVideoElement 源
//   - 若浏览器支持 requestVideoFrameCallback,构造时注册回调自动 bump version
//   - `generateMipmaps` 默认 false(视频每帧变化,mipmap 开销过大)
//   - `update()` 在不支持 rVFC 时由 renderer 每帧调用
//
// 注意:HTMLVideoElement 不在基类 TextureImage 联合中,因此 `image` 保持 null,
// renderer 通过 `video` 字段读取源。

import { Texture } from './Texture';

export interface VideoTextureOptions {
  flipY?: boolean;
  colorSpace?: 'srgb' | 'linear';
  minFilter?: 'linear' | 'nearest' | 'linear-mipmap-linear' | 'linear-mipmap-nearest';
  magFilter?: 'linear' | 'nearest';
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
}

/** HTMLMediaElement.HAVE_CURRENT_DATA 的数值常量(= 2)。 */
const HAVE_CURRENT_DATA = 2;

/** requestVideoFrameCallback 宿主接口(duck-typing,避免 any)。 */
interface RVFCHost {
  requestVideoFrameCallback(cb: () => void): number;
  cancelVideoFrameCallback?(id: number): void;
}

export class VideoTexture extends Texture {
  readonly isVideoTexture = true;

  /** 视频元素源。 */
  video: HTMLVideoElement;
  /** 是否已通过 requestVideoFrameCallback 注册自动更新。 */
  private _rVFCRegistered: boolean = false;

  constructor(video: HTMLVideoElement, opts: VideoTextureOptions = {}) {
    super('VideoTexture', {
      flipY: opts.flipY ?? true,
      generateMipmaps: false,
      colorSpace: opts.colorSpace ?? 'srgb',
      minFilter: opts.minFilter ?? 'linear',
      magFilter: opts.magFilter ?? 'linear',
      wrapS: opts.wrapS ?? 'clamp',
      wrapT: opts.wrapT ?? 'clamp',
    });
    this.video = video;

    // 若浏览器支持 requestVideoFrameCallback,注册自动更新回调
    const host = video as unknown as { requestVideoFrameCallback?: unknown };
    if (typeof host.requestVideoFrameCallback === 'function') {
      const cbHost = video as unknown as RVFCHost;
      const update = (): void => {
        this.version++;
        cbHost.requestVideoFrameCallback(update);
      };
      cbHost.requestVideoFrameCallback(update);
      this._rVFCRegistered = true;
    }
  }

  /**
   * 由 renderer 每帧调用。在不支持 requestVideoFrameCallback 的浏览器中,
   * 当 video 已有当前帧数据时 bump version 触发重传。
   * 支持 rVFC 时由回调自动更新,本方法为空操作。
   */
  update(): void {
    const video = this.video;
    if (!this._rVFCRegistered && video.readyState >= HAVE_CURRENT_DATA) {
      this.version++;
    }
  }
}

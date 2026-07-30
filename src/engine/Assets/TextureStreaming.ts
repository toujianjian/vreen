// TextureStreaming — 纹理流式加载系统(Mipmap streaming + 按需加载)。
//
// 设计目标:
//   - 大场景中存在大量高分辨率纹理时,一次性全部上传 GPU 会导致显存爆炸。
//     本系统按"距相机距离 / 屏幕占比"动态决定每张纹理应该加载到哪个 mip 级别,
//     近处 / 大占比的纹理加载高精度 mip,远处 / 小占比的只加载低精度 mip。
//   - 配合 maxMemoryUsage 上限做 LRU 驱逐:超限时卸载低优先级纹理的 mip 链。
//   - 与 Assets/AssetRegistry、Loaders/AssetManager 互补:
//       AssetManager 关注"按 URL 解析 + Promise 缓存",
//       AssetRegistry 关注"已加载实例的引用计数",
//       TextureStreaming 关注"已加载纹理的 mip 级别动态调度"。
//
// 数据模型:
//   - StreamingTexture 持有 baseTexture(引擎 Texture 元数据)+ mipLevels 总数
//     + loadedMips 当前已加载到第几层(0 表示全部未加载,N 表示已加载 0..N-1)。
//   - 调用方在 requestMipLevel / update 后,通过 getTexture 拿到 baseTexture,
//     baseTexture.version 会被 bump,renderer 据此重传 GPU。
//   - 本系统不直接 fetch/decode 图片数据;实际的 mip 数据由调用方通过
//     onLoadMip 回调注入(保持零运行时依赖,测试友好)。
//
// 不变量:
//   - loadedMips ∈ [0, mipLevels];
//   - currentMemoryUsage 始终等于所有 StreamingTexture.size 之和(size 由
//     调用方在 registerTexture 时声明,表示该纹理完整 mip 链的字节大小;
//     简化模型下 currentMemoryUsage 反映"已注册纹理的总声明大小",evict
//     时按 LRU + 优先级剔除整张纹理)。

import { createLogger } from '@/lib/logger';
import type { Texture } from '../Core/Texture';
import type { Camera } from '../Cameras/Camera';

const log = createLogger('TextureStreaming');

/** 单张纹理的流式加载状态。 */
export interface StreamingTexture {
  /** 纹理 id(在 TextureStreaming 内唯一)。 */
  id: string;
  /** 资源 URL(仅记录用,不影响调度)。 */
  url: string;
  /** 底层引擎 Texture 实例(渲染目标)。 */
  baseTexture: Texture | null;
  /** 该纹理的总 mip 级别数(0 表示无 mip / 单层)。 */
  mipLevels: number;
  /** 当前已加载的 mip 层数(0 = 未加载, N = 已加载 0..N-1)。 */
  loadedMips: number;
  /** 优先级(数值越大越重要,驱逐时优先保留)。 */
  priority: number;
  /** 最近一次被使用的时间戳(performance.now 毫秒)。 */
  lastUsed: number;
  /** 该纹理完整 mip 链的字节大小(调用方声明)。 */
  size: number;
  /** 像素格式标识(如 'rgba8' / 'bc1' / 'bc7',仅记录用)。 */
  format: string;
  /** 纹理基础宽度(0 级 mip 宽度)。 */
  width: number;
  /** 纹理基础高度(0 级 mip 高度)。 */
  height: number;
  /** 纹理世界空间位置(用于按距离调度;调用方在 registerTexture 时填入,
   *  update 时由 computeDesiredMip 读取)。null 表示不参与距离调度。 */
  position: { x: number; y: number; z: number } | null;
}

/** registerTexture 配置。 */
export interface StreamingTextureConfig {
  /** 资源 URL。 */
  url: string;
  /** 已就绪的 Texture 实例(若为 null,需调用方在 requestMipLevel 时填入)。 */
  baseTexture?: Texture | null;
  /** 总 mip 级别数。 */
  mipLevels: number;
  /** 完整 mip 链字节大小。 */
  size: number;
  /** 像素格式。 */
  format?: string;
  /** 基础宽度。 */
  width: number;
  /** 基础高度。 */
  height: number;
  /** 优先级(默认 0)。 */
  priority?: number;
  /** 初始已加载 mip 数(默认 0)。 */
  loadedMips?: number;
  /** 世界空间位置(可选,用于距离调度)。 */
  position?: { x: number; y: number; z: number } | null;
}

/** 触发 mip 加载的回调(由调用方注入实际 decode/upload 逻辑)。 */
export type LoadMipCallback = (
  id: string,
  level: number,
  texture: Texture | null,
) => void;

/** 卸载 mip 的回调(由调用方注入实际 GL 释放逻辑)。 */
export type UnloadMipCallback = (
  id: string,
  level: number,
  texture: Texture | null,
) => void;

/** 流式加载统计。 */
export interface TextureStreamingStats {
  /** 已注册纹理总数。 */
  registered: number;
  /** 已完全加载(loadedMips === mipLevels)的纹理数。 */
  fullyLoaded: number;
  /** 完全未加载(loadedMips === 0)的纹理数。 */
  unloaded: number;
  /** 已加载 mip 层总数(所有纹理的 loadedMips 之和)。 */
  loadedMipTotal: number;
  /** 当前已声明内存使用(字节)。 */
  memoryUsage: number;
  /** 内存上限(字节)。 */
  memoryLimit: number;
  /** 内存使用率(0..1)。 */
  memoryRatio: number;
  /** 上一次 update 触发的驱逐次数。 */
  evictions: number;
  /** 上一次 update 触发的 mip 加载请求数。 */
  loadRequests: number;
}

/** TextureStreaming 构造选项。 */
export interface TextureStreamingOptions {
  /** 最大内存使用(字节,默认 256MB)。 */
  maxMemoryUsage?: number;
  /** update 节流间隔(毫秒,默认 100;0 表示每帧都更新)。 */
  updateInterval?: number;
  /** 加载 mip 时的回调。 */
  onLoadMip?: LoadMipCallback;
  /** 卸载 mip 时的回调。 */
  onUnloadMip?: UnloadMipCallback;
}

// 临时向量复用,避免 update 中每张纹理分配。
const _tmpCamPos = { x: 0, y: 0, z: 0 };

/**
 * 纹理流式加载管理器。
 *
 * 用法:
 *   const ts = new TextureStreaming({ maxMemoryUsage: 512 * 1024 * 1024 });
 *   ts.registerTexture('tex1', { url: '/a.png', mipLevels: 10, size: 4096*4096*4, width: 4096, height: 4096, position: {x:0,y:0,z:0} });
 *   ts.setCamera(camera);
 *   ts.update(dt, camera); // 内部按距离计算期望 mip 并触发 onLoadMip
 */
export class TextureStreaming {
  /** 已注册纹理表:id → StreamingTexture。 */
  textures: Map<string, StreamingTexture> = new Map();
  /** 最大内存使用(字节)。 */
  maxMemoryUsage: number;
  /** 当前已声明内存使用(字节)。 */
  currentMemoryUsage: number = 0;
  /** 当前相机(由 setCamera 设置)。 */
  camera: Camera | null = null;
  /** update 节流间隔(毫秒)。 */
  updateInterval: number;
  /** 上一次 update 的时间戳。 */
  lastUpdate: number = 0;

  /** 加载 mip 回调(由调用方注入)。 */
  private _onLoadMip: LoadMipCallback | null;
  /** 卸载 mip 回调。 */
  private _onUnloadMip: UnloadMipCallback | null;
  /** 临时统计累加器(每次 update 重置)。 */
  private _stats: TextureStreamingStats = {
    registered: 0,
    fullyLoaded: 0,
    unloaded: 0,
    loadedMipTotal: 0,
    memoryUsage: 0,
    memoryLimit: 0,
    memoryRatio: 0,
    evictions: 0,
    loadRequests: 0,
  };

  constructor(opts: TextureStreamingOptions = {}) {
    this.maxMemoryUsage = opts.maxMemoryUsage ?? 256 * 1024 * 1024;
    this.updateInterval = opts.updateInterval ?? 100;
    this._onLoadMip = opts.onLoadMip ?? null;
    this._onUnloadMip = opts.onUnloadMip ?? null;
  }

  /**
   * 注册一张纹理。
   * 重复注册同一 id 时覆盖原条目(原条目的 size 从 currentMemoryUsage 扣除)。
   */
  registerTexture(id: string, config: StreamingTextureConfig): StreamingTexture {
    if (this.textures.has(id)) {
      const old = this.textures.get(id)!;
      this.currentMemoryUsage -= old.size;
      log.warn(`registerTexture("${id}") — overriding existing entry`);
    }
    const tex: StreamingTexture = {
      id,
      url: config.url,
      baseTexture: config.baseTexture ?? null,
      mipLevels: Math.max(0, Math.floor(config.mipLevels)),
      loadedMips: Math.max(0, Math.floor(config.loadedMips ?? 0)),
      priority: config.priority ?? 0,
      lastUsed: performance.now(),
      size: Math.max(0, config.size),
      format: config.format ?? 'rgba8',
      width: Math.max(0, config.width),
      height: Math.max(0, config.height),
      position: config.position ?? null,
    };
    // clamp loadedMips 到 [0, mipLevels]
    if (tex.loadedMips > tex.mipLevels) tex.loadedMips = tex.mipLevels;
    this.textures.set(id, tex);
    this.currentMemoryUsage += tex.size;
    log.debug(`registerTexture("${id}") — mipLevels=${tex.mipLevels}, size=${tex.size}`);
    return tex;
  }

  /** 注销一张纹理(不触发 onUnloadMip;调用方自行释放 GPU 资源)。 */
  unregisterTexture(id: string): boolean {
    const tex = this.textures.get(id);
    if (!tex) return false;
    this.currentMemoryUsage -= tex.size;
    if (this.currentMemoryUsage < 0) this.currentMemoryUsage = 0;
    this.textures.delete(id);
    log.debug(`unregisterTexture("${id}")`);
    return true;
  }

  /**
   * 请求加载到指定 mip 级别(0 = 最高精度,数值越大越低精度)。
   * 本方法直接调整 loadedMips 并触发 onLoadMip 回调。
   * 实际意义:加载 0..level-1 共 level 个 mip 层。
   */
  requestMipLevel(id: string, level: number): void {
    const tex = this.textures.get(id);
    if (!tex) {
      log.warn(`requestMipLevel("${id}") — id not registered`);
      return;
    }
    const clamped = Math.max(0, Math.min(Math.floor(level), tex.mipLevels));
    if (clamped === tex.loadedMips) return;
    // 若减少,触发 onUnloadMip(从 clamped 到 loadedMips-1)
    if (clamped < tex.loadedMips && this._onUnloadMip) {
      for (let l = clamped; l < tex.loadedMips; l++) {
        try {
          this._onUnloadMip(id, l, tex.baseTexture);
        } catch (err) {
          log.error(`onUnloadMip("${id}", ${l}) threw: ${(err as Error).message ?? err}`);
        }
      }
    } else if (clamped > tex.loadedMips && this._onLoadMip) {
      for (let l = tex.loadedMips; l < clamped; l++) {
        try {
          this._onLoadMip(id, l, tex.baseTexture);
        } catch (err) {
          log.error(`onLoadMip("${id}", ${l}) threw: ${(err as Error).message ?? err}`);
        }
      }
    }
    tex.loadedMips = clamped;
    tex.lastUsed = performance.now();
    // 触发 renderer 重传(baseTexture.version bump)
    if (tex.baseTexture) tex.baseTexture.version++;
  }

  /**
   * 每帧更新入口。按 updateInterval 节流。
   * 1) 对每张带 position 的纹理,计算期望 mip 级别;
   * 2) 若期望级别与当前不同,触发 requestMipLevel;
   * 3) 若内存超限,调用 evict()。
   */
  update(dt: number, camera?: Camera | null): void {
    void dt; // dt 当前未使用,保留接口供未来动画过渡用
    const now = performance.now();
    if (this.updateInterval > 0 && now - this.lastUpdate < this.updateInterval) {
      return;
    }
    this.lastUpdate = now;

    const cam = camera ?? this.camera;
    if (cam) {
      // 从 camera.matrixWorld 提取世界位置(平移分量)
      const e = cam.matrixWorld.elements;
      _tmpCamPos.x = e[12];
      _tmpCamPos.y = e[13];
      _tmpCamPos.z = e[14];

      let loadRequests = 0;
      for (const tex of this.textures.values()) {
        if (!tex.position) continue;
        const desired = this.computeDesiredMip(tex, cam);
        if (desired !== tex.loadedMips) {
          this.requestMipLevel(tex.id, desired);
          loadRequests++;
        }
      }
      this._stats.loadRequests = loadRequests;
    }

    // 内存超限时驱逐
    let evictions = 0;
    while (this.currentMemoryUsage > this.maxMemoryUsage && this.textures.size > 0) {
      const victim = this._pickEvictionVictim();
      if (!victim) break;
      this.unregisterTexture(victim.id);
      evictions++;
    }
    this._stats.evictions = evictions;
  }

  /** 设置当前相机。 */
  setCamera(camera: Camera | null): void {
    this.camera = camera;
  }

  /** 设置最大内存上限(字节)。若新上限小于当前使用,立即驱逐。 */
  setMaxMemory(bytes: number): void {
    this.maxMemoryUsage = Math.max(0, Math.floor(bytes));
    while (this.currentMemoryUsage > this.maxMemoryUsage && this.textures.size > 0) {
      const victim = this._pickEvictionVictim();
      if (!victim) break;
      this.unregisterTexture(victim.id);
    }
  }

  /** 当前已声明内存使用(字节)。 */
  getMemoryUsage(): number {
    return this.currentMemoryUsage;
  }

  /** 获取指定 id 的 StreamingTexture(未注册返回 undefined)。 */
  getTexture(id: string): StreamingTexture | undefined {
    return this.textures.get(id);
  }

  /** 已注册纹理数。 */
  getTextureCount(): number {
    return this.textures.size;
  }

  /**
   * 计算指定纹理在当前相机视角下的期望 mip 级别。
   *
   * 简化策略(可读性优先):
   *   - 若 tex.position 为 null,返回 tex.mipLevels(最高精度)。
   *   - 距离相机越远,期望 mip 数值越大(精度越低);
   *   - 距离 < nearDist  → 期望 0(最高精度,加载全部 mip);
   *   - 距离 > farDist   → 期望 mipLevels(最低精度,只加载基础层);
   *   - 中间距离线性插值。
   *
   * @param tex 目标纹理
   * @param camera 当前相机
   * @returns 期望的 loadedMips 值(0..mipLevels)
   */
  computeDesiredMip(texture: StreamingTexture, camera?: Camera | null): number {
    if (!texture.position) return texture.mipLevels;
    if (texture.mipLevels === 0) return 0;
    const cam = camera ?? this.camera;
    if (!cam) return texture.mipLevels;

    const e = cam.matrixWorld.elements;
    const dx = texture.position.x - e[12];
    const dy = texture.position.y - e[13];
    const dz = texture.position.z - e[14];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 基于纹理尺寸估算近/远距离阈值:
    //   nearDist  = max(width, height)            — 近于此距离 → 最高精度
    //   farDist   = max(width, height) * 8        — 远于此距离 → 最低精度
    const maxDim = Math.max(texture.width, texture.height);
    const nearDist = maxDim;
    const farDist = maxDim * 8;

    if (dist <= nearDist) return 0;
    if (dist >= farDist) return texture.mipLevels;

    // 线性插值:期望 mip = round(mipLevels * (dist - nearDist) / (farDist - nearDist))
    const t = (dist - nearDist) / (farDist - nearDist);
    const desired = Math.round(texture.mipLevels * t);
    return Math.max(0, Math.min(desired, texture.mipLevels));
  }

  /**
   * 驱逐低优先级纹理(按 priority 升序、lastUsed 升序排列,先驱逐最旧最低优先级)。
   * 返回被驱逐的 id 列表。
   *
   * @param targetBytes 驱逐到 currentMemoryUsage <= targetBytes 为止
   *                    (默认 maxMemoryUsage)
   */
  evict(targetBytes: number = this.maxMemoryUsage): string[] {
    const evicted: string[] = [];
    while (this.currentMemoryUsage > targetBytes && this.textures.size > 0) {
      const victim = this._pickEvictionVictim();
      if (!victim) break;
      this.unregisterTexture(victim.id);
      evicted.push(victim.id);
    }
    this._stats.evictions += evicted.length;
    return evicted;
  }

  /** 内部:挑选下一个被驱逐的纹理(优先级最低 + 最久未用)。 */
  private _pickEvictionVictim(): StreamingTexture | null {
    let victim: StreamingTexture | null = null;
    let bestScore = Infinity;
    for (const tex of this.textures.values()) {
      // score = priority * 1e6 + lastUsed(优先级低 + 旧的 score 小,先驱逐)。
      // priority 权重远大于 lastUsed,保证先按优先级排序;同优先级下 lastUsed
      // 越小(越旧)score 越小,先被驱逐(LRU)。
      const score = tex.priority * 1e6 + tex.lastUsed;
      if (score < bestScore) {
        bestScore = score;
        victim = tex;
      }
    }
    return victim;
  }

  /** 设置加载 mip 回调。 */
  setLoadMipCallback(cb: LoadMipCallback | null): void {
    this._onLoadMip = cb;
  }

  /** 设置卸载 mip 回调。 */
  setUnloadMipCallback(cb: UnloadMipCallback | null): void {
    this._onUnloadMip = cb;
  }

  /**
   * 获取统计快照。
   * 注意:evictions / loadRequests 是上一次 update 的统计,不累加。
   */
  getStats(): TextureStreamingStats {
    let fullyLoaded = 0;
    let unloaded = 0;
    let loadedMipTotal = 0;
    for (const tex of this.textures.values()) {
      if (tex.loadedMips >= tex.mipLevels && tex.mipLevels > 0) fullyLoaded++;
      if (tex.loadedMips === 0) unloaded++;
      loadedMipTotal += tex.loadedMips;
    }
    return {
      registered: this.textures.size,
      fullyLoaded,
      unloaded,
      loadedMipTotal,
      memoryUsage: this.currentMemoryUsage,
      memoryLimit: this.maxMemoryUsage,
      memoryRatio: this.maxMemoryUsage > 0
        ? this.currentMemoryUsage / this.maxMemoryUsage
        : 0,
      evictions: this._stats.evictions,
      loadRequests: this._stats.loadRequests,
    };
  }

  /** 清空所有纹理(不触发 onUnloadMip;调用方自行释放 GPU 资源)。 */
  clear(): void {
    const n = this.textures.size;
    this.textures.clear();
    this.currentMemoryUsage = 0;
    if (n > 0) log.debug(`clear() — dropped ${n} entries`);
  }
}

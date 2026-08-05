// WebXRDepthSensing —— AR 深度感知 (真实世界深度图)。
//
// 适配自 three.js `WebXRDepthSensing` (src/renderers/webxr/WebXRDepthSensing.js)
// 与 W3C WebXR Depth Sensing Module。three.js 用 ShaderMaterial + ExternalTexture
// 写 gl_FragDepth 做基于真实深度的遮挡;VREEN 改为纯数据状态机,
// 由渲染层消费深度纹理 (设置深度写入 / 遮挡 mesh)。
//
// 深度感知让 AR 虚拟物体被真实物体正确遮挡 (虚拟角色走到真实沙发后面时被遮挡)。
// 数据来源:AR 设备的深度传感器或算法估计 (LiDAR / RGB-D / SLAM 深度)。

import type { XRDepthData } from './WebXRTypes';

/** 深度感知状态。 */
export interface DepthSensingState {
  /** 深度纹理 (opaque,渲染层解释为 sampler2D/sampler2DArray)。 */
  texture: unknown | null;
  /** 深度近裁面 (米)。 */
  depthNear: number;
  /** 深度远裁面 (米)。 */
  depthFar: number;
  /** 深度图原点 (归一化纹理坐标)。 */
  origin: { x: number; y: number };
  /** 深度图尺寸 (像素)。 */
  width: number;
  height: number;
  /** 每像素的物理尺寸 (米)。 */
  rawValueToMeters: number;
  /** 是否有有效深度数据。 */
  active: boolean;
}

const DEFAULT_STATE: DepthSensingState = {
  texture: null,
  depthNear: 0,
  depthFar: 0,
  origin: { x: 0, y: 0 },
  width: 0,
  height: 0,
  rawValueToMeters: 1,
  active: false,
};

/**
 * WebXRDepthSensing —— 跟踪 AR 深度数据。
 *
 * ```ts
 * const depth = new WebXRDepthSensing();
 * manager.addEventListener('depthsensing', (e) => {
 *   depth.update(e.depth);
 * });
 * if (depth.state.active) {
 *   // 渲染层:用 depth.state.texture 写 gl_FragDepth 做遮挡
 * }
 * ```
 */
export class WebXRDepthSensing {
  /** 当前深度感知状态。 */
  state: DepthSensingState = { ...DEFAULT_STATE, origin: { ...DEFAULT_STATE.origin } };

  /**
   * 用一帧的深度数据更新状态。
   * 适配 three.js `WebXRDepthSensing.init`:
   *   * 首次有效数据时创建纹理。
   *   * 同步 depthNear/depthFar (可能与 renderState 不同)。
   */
  update(data: XRDepthData | null): void {
    if (!data) {
      // 无深度数据 (本帧) —— 保持上一次状态,仅标记非 active 直到下次有效。
      this.state.active = false;
      return;
    }

    this.state.texture = data.texture;
    this.state.depthNear = data.depthNear;
    this.state.depthFar = data.depthFar;
    this.state.origin = { ...data.origin };
    this.state.width = data.width;
    this.state.height = data.height;
    this.state.rawValueToMeters = data.rawValueToMeters;
    this.state.active = true;
  }

  /** 重置 (会话结束)。 */
  reset(): void {
    this.state.texture = null;
    this.state.depthNear = 0;
    this.state.depthFar = 0;
    this.state.origin = { x: 0, y: 0 };
    this.state.width = 0;
    this.state.height = 0;
    this.state.rawValueToMeters = 1;
    this.state.active = false;
  }

  /** 是否有深度纹理。 */
  hasTexture(): boolean {
    return this.state.texture !== null;
  }

  /**
   * 采样深度图某点的深度值 (米)。
   * @param u 纹理 U [0,1]
   * @param v 纹理 V [0,1]
   * @param sample 采样函数 (渲染层提供,从纹理读取原始值)
   * @returns 深度 (米),或 null
   */
  sampleDepth(u: number, v: number, sample: (u: number, v: number) => number | null): number | null {
    if (!this.state.active) return null;
    const raw = sample(u, v);
    if (raw === null) return null;
    return raw * this.state.rawValueToMeters;
  }

  /**
   * 判断世界点是否被真实物体遮挡 (深度测试)。
   * @param pointDepth 点的相机空间深度 (米)
   * @param u 纹理 U
   * @param v 纹理 V
   * @param sample 采样函数
   * @returns true=被遮挡
   */
  isOccluded(pointDepth: number, u: number, v: number, sample: (u: number, v: number) => number | null): boolean {
    const realDepth = this.sampleDepth(u, v, sample);
    if (realDepth === null) return false;
    // 真实物体比虚拟点更近 → 遮挡。
    return realDepth < pointDepth;
  }
}

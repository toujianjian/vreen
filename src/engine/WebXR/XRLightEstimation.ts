// XRLightEstimation —— AR 光照估计 (主光 + 球谐环境光)。
//
// 适配自 three.js `XREstimatedLight` (examples/jsm/webxr/XREstimatedLight.js)
// 与 W3C WebXR Lighting Estimation Module。three.js 用 LightProbe + DirectionalLight
// + WebGLCubeRenderTarget 直接驱动渲染;VREEN 改为纯数据 `XRLightEstimateState`,
// 由渲染层 / 场景层消费 (设置 DirectionalLight 参数 + IBL SH 系数)。
//
// 输出:
//   * directionalLight —— 主光 (颜色归一化 + 强度标量 + 方向)。
//   * lightProbe —— 球谐系数 (27 数值,9 个 RGB),用于 IBL 环境光。
//   * estimationActive —— 是否正在接收估计 (首次有效数据后置 true)。

import { Vector3 } from '../Math';
import type { XRLightEstimate } from './WebXRTypes';

/** 引擎侧主光参数 (供 DirectionalLight 消费)。 */
export interface XREstimatedDirectionalLight {
  /** 归一化颜色 (0~1,各通道除以最大通道)。 */
  color: { r: number; g: number; b: number };
  /** 强度标量 (原始最大通道值)。 */
  intensity: number;
  /** 方向 (世界空间单位向量)。 */
  position: Vector3;
}

/** 光照估计状态。 */
export interface XRLightEstimateState {
  /** 主光参数。 */
  directionalLight: XREstimatedDirectionalLight;
  /** 球谐系数 (27 数值)。 */
  sphericalHarmonics: number[];
  /** 探针强度 (恒为 1,有数据时)。 */
  probeIntensity: number;
  /** 是否正在接收估计。 */
  estimationActive: boolean;
}

const DEFAULT_STATE: XRLightEstimateState = {
  directionalLight: {
    color: { r: 1, g: 1, b: 1 },
    intensity: 0,
    position: new Vector3(0, 1, 0),
  },
  sphericalHarmonics: new Array(27).fill(0),
  probeIntensity: 0,
  estimationActive: false,
};

/**
 * XRLightEstimation —— 跟踪 AR 光照估计,输出引擎友好参数。
 *
 * ```ts
 * const light = new XRLightEstimation();
 * manager.addEventListener('lightestimate', () => {
 *   light.update(manager.getLightEstimate());
 * });
 * // 渲染层读取
 * const { directionalLight, sphericalHarmonics } = light.state;
 * ```
 */
export class XRLightEstimation {
  /** 当前光照估计状态。 */
  state: XRLightEstimateState = {
    directionalLight: {
      color: { ...DEFAULT_STATE.directionalLight.color },
      intensity: DEFAULT_STATE.directionalLight.intensity,
      position: new Vector3(),
    },
    sphericalHarmonics: [...DEFAULT_STATE.sphericalHarmonics],
    probeIntensity: DEFAULT_STATE.probeIntensity,
    estimationActive: DEFAULT_STATE.estimationActive,
  };

  /** 估计开始回调 (首次有效数据)。 */
  onEstimationStart?: () => void;
  /** 估计结束回调 (会话结束)。 */
  onEstimationEnd?: () => void;

  private started = false;

  /**
   * 用一帧的 XRLightEstimate 更新状态。
   * 适配 three.js `SessionLightProbe.onXRFrame`:
   *   * 球谐直接拷贝到 lightProbe。
   *   * 主光颜色归一化 (各通道 / 最大通道),强度 = 最大通道值。
   *   * 主光方向拷贝。
   */
  update(estimate: XRLightEstimate | null): void {
    if (!estimate) return;

    const { primaryLightIntensity, primaryLightDirection, sphericalHarmonicsCoefficients } = estimate;

    // 主光:归一化颜色 + 标量强度 (WebXR 可返回 >1 的颜色值)。
    const intensityScalar = Math.max(
      1.0,
      Math.max(
        primaryLightIntensity.x,
        Math.max(primaryLightIntensity.y, primaryLightIntensity.z),
      ),
    );

    this.state.directionalLight.color = {
      r: primaryLightIntensity.x / intensityScalar,
      g: primaryLightIntensity.y / intensityScalar,
      b: primaryLightIntensity.z / intensityScalar,
    };
    this.state.directionalLight.intensity = intensityScalar;
    this.state.directionalLight.position.copy(primaryLightDirection);

    // 球谐系数。
    this.state.sphericalHarmonics = [...sphericalHarmonicsCoefficients];
    this.state.probeIntensity = 1.0;

    // 首次有效数据 → estimationstart。
    if (!this.started) {
      this.started = true;
      this.state.estimationActive = true;
      this.onEstimationStart?.();
    }
  }

  /** 重置 (会话结束时)。 */
  reset(): void {
    const wasActive = this.started;
    this.started = false;
    this.state.estimationActive = false;
    this.state.directionalLight.color = { r: 1, g: 1, b: 1 };
    this.state.directionalLight.intensity = 0;
    this.state.sphericalHarmonics = new Array(27).fill(0);
    this.state.probeIntensity = 0;
    if (wasActive) this.onEstimationEnd?.();
  }
}

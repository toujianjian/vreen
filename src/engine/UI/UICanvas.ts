// UICanvas —— UI 根画布 (渲染模式 / 缩放 / 屏幕适配)。
//
// 仿照 o3de LyShine `UiCanvasComponent`、UE5 UMG `UWidget` 根 / `UMG::Canvas`、
// Unity `Canvas`。职责:
//   * 持有 UIElement 层级树的根。
//   * 定义渲染模式 (ScreenSpaceOverlay / ScreenSpaceCamera / WorldSpace)。
//   * 定义缩放模式 (ConstantPixelSize / ScaleWithScreenSize / ConstantPhysicalSize),
//     参考 Unity CanvasScaler + UE5 UMG DPI scaling。
//   * 每帧驱动 layout() + render()。
//   * 提供 hitTest 入口 (屏幕坐标 → 命中元素)。
//
// 渲染模式:
//   * ScreenSpaceOverlay —— 画布覆盖在屏幕最上层,不受相机变换影响 (HUD/UI 常用)。
//   * ScreenSpaceCamera  —— 画布渲染在相机前方固定距离的平面上 (可被 3D 物体遮挡)。
//   * WorldSpace         —— 画布作为 3D 世界中的一个平面存在 (世界看板/操作台)。
//
// 缩放模式:
//   * ConstantPixelSize   —— 像素 1:1,不随分辨率缩放。
//   * ScaleWithScreenSize —— 以参考分辨率缩放,匹配屏幕 (matchWidthOrHeight 0~1)。
//   * ConstantPhysicalSize —— 按物理 DPI 缩放 (移动端)。
//
// 纯 CPU 布局/命中逻辑,无 WebGL 依赖。

import { UIElement } from './UIElement';

/** 画布渲染模式。 */
export type CanvasRenderMode =
  | 'screenSpaceOverlay'
  | 'screenSpaceCamera'
  | 'worldSpace';

/** 画布缩放模式。 */
export type CanvasScaleMode =
  | 'constantPixelSize'
  | 'scaleWithScreenSize'
  | 'constantPhysicalSize';

/** ScaleWithScreenSize 的匹配策略。 */
export interface ScreenMatchOptions {
  /** 参考分辨率 (设计稿尺寸)。 */
  referenceResolution: { width: number; height: number };
  /**
   * 匹配宽度或高度 (0=完全匹配宽度, 1=完全匹配高度, 0.5=平衡)。
   * - 0: scaleFactor = screen.width / ref.width (横屏 UI 常用)
   * - 1: scaleFactor = screen.height / ref.height (竖屏 UI 常用)
   * - 0.5: 取两者对数平均 (平衡)
   */
  matchWidthOrHeight: number;
}

/** 画布缩放配置。 */
export interface CanvasScalerConfig {
  mode: CanvasScaleMode;
  /** ConstantPixelSize 时的固定缩放因子。 */
  scaleFactor?: number;
  /** ScaleWithScreenSize 配置。 */
  screenMatch?: ScreenMatchOptions;
  /** ConstantPhysicalSize 时的目标 DPI。 */
  referenceDPI?: number;
  /** 当前设备 DPI (ConstantPhysicalSize 使用)。 */
  fallbackDPI?: number;
}

/** 画布尺寸快照 (由外部渲染器每帧更新)。 */
export interface CanvasScreenInfo {
  width: number;
  height: number;
  /** 设备像素比 (window.devicePixelRatio)。 */
  pixelRatio: number;
}

/**
 * UICanvas —— UI 渲染根。
 *
 * ```ts
 * const canvas = new UICanvas({
 *   renderMode: 'screenSpaceOverlay',
 *   scaler: {
 *     mode: 'scaleWithScreenSize',
 *     screenMatch: { referenceResolution: { width: 1920, height: 1080 }, matchWidthOrHeight: 0.5 },
 *   },
 * });
 *
 * const button = new UIButton('start');
 * canvas.root.addChild(button);
 *
 * // 每帧:
 * canvas.update(screenInfo);
 * ```
 */
export class UICanvas {
  readonly type: string = 'UICanvas';

  /** 渲染模式。 */
  renderMode: CanvasRenderMode;

  /** 缩放配置。 */
  scaler: CanvasScalerConfig;

  /** 根元素 (画布自身作为根容器)。 */
  readonly root: UIElement;

  /** 当前屏幕信息 (每帧由 update 设置)。 */
  screenInfo: CanvasScreenInfo = { width: 1920, height: 1080, pixelRatio: 1 };

  /** 当前缩放因子 (由 update 计算)。 */
  scaleFactor: number = 1;

  /** WorldSpace 模式下的 3D 位置/尺寸 (平面在 3D 世界的变换)。 */
  worldPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  worldSize: { width: number; height: number } = { width: 2, height: 1 };

  /** 是否启用 (false 时跳过 layout/render)。 */
  enabled: boolean = true;

  constructor(options?: {
    renderMode?: CanvasRenderMode;
    scaler?: CanvasScalerConfig;
    root?: UIElement;
  }) {
    this.renderMode = options?.renderMode ?? 'screenSpaceOverlay';
    this.scaler = options?.scaler ?? { mode: 'constantPixelSize', scaleFactor: 1 };
    this.root = options?.root ?? new UIElement('canvas-root');
    // 根元素默认全屏拉伸。
    this.root.transform.setAnchorPreset('stretchAll');
    this.root.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.root.name = 'canvas-root';
    // 根容器不参与命中检测 (点击空白处应命中 null,不命中画布根)。
    this.root.isRaycastTarget = false;
  }

  /**
   * 每帧更新:计算缩放因子 + 驱动布局 + 渲染。
   *
   * @param screen 当前屏幕信息 (若不传则用上次的 screenInfo)。
   */
  update(screen?: CanvasScreenInfo): void {
    if (!this.enabled) return;
    if (screen) this.screenInfo = screen;

    this.scaleFactor = this.computeScaleFactor();

    // 根元素铺满屏幕 (在缩放后的逻辑像素空间中)。
    const logicalWidth = this.screenInfo.width / this.scaleFactor;
    const logicalHeight = this.screenInfo.height / this.scaleFactor;

    // 布局:根元素从 (0,0) 开始,尺寸为逻辑屏幕尺寸。
    this.root.layout(0, 0, logicalWidth, logicalHeight);

    // 渲染。
    this.root.render();
  }

  /**
   * 计算缩放因子。
   * - constantPixelSize: 固定 scaleFactor。
   * - scaleWithScreenSize: 参考 Resolution + matchWidthOrHeight。
   * - constantPhysicalSize: DPI 比值。
   */
  computeScaleFactor(): number {
    const { width: sw, height: sh, pixelRatio } = this.screenInfo;

    switch (this.scaler.mode) {
      case 'constantPixelSize':
        return this.scaler.scaleFactor ?? 1;

      case 'scaleWithScreenSize': {
        const match = this.scaler.screenMatch;
        if (!match) return 1;
        const { width: rw, height: rh } = match.referenceResolution;
        const m = Math.max(0, Math.min(1, match.matchWidthOrHeight));
        // 对数空间插值 (避免极端 match 时跳变),参考 Unity CanvasScaler 实现。
        const logW = Math.log(sw / rw);
        const logH = Math.log(sh / rh);
        const logScale = logW * (1 - m) + logH * m;
        return Math.exp(logScale);
      }

      case 'constantPhysicalSize': {
        const refDPI = this.scaler.referenceDPI ?? 96;
        const deviceDPI = this.scaler.fallbackDPI ?? 96 * pixelRatio;
        return deviceDPI / refDPI;
      }

      default:
        return 1;
    }
  }

  /**
   * 命中检测:屏幕坐标 (物理像素) → 命中的最顶层元素。
   * 自动将物理像素坐标转换为逻辑像素坐标 (除以 scaleFactor)。
   */
  hitTest(screenX: number, screenY: number): UIElement | null {
    if (!this.enabled) return null;
    // 屏幕坐标 → 逻辑坐标。注意 Y 轴:浏览器 pointer 事件 Y 向下,
    // 我们的 UI 坐标系 Y 向上,需翻转。
    const logicalX = screenX / this.scaleFactor;
    const logicalY = (this.screenInfo.height / this.scaleFactor) - (screenY / this.scaleFactor);
    return this.root.raycast(logicalX, logicalY);
  }

  /**
   * 递归查找所有参与命中检测的元素 (用于 Tab 导航 / 调试)。
   * 返回按渲染顺序的列表 (从前到后)。
   */
  collectRaycastTargets(): UIElement[] {
    const out: UIElement[] = [];
    const collect = (el: UIElement): void => {
      if (el.activeInHierarchy && el.isRaycastTarget) {
        out.push(el);
      }
      for (const child of el.children) collect(child);
    };
    collect(this.root);
    return out;
  }

  /** 销毁画布及所有元素。 */
  destroy(): void {
    this.root.destroy();
    this.enabled = false;
  }
}

/** 默认画布缩放配置 (1:1 像素)。 */
export const DEFAULT_CANVAS_SCALER: CanvasScalerConfig = {
  mode: 'constantPixelSize',
  scaleFactor: 1,
};

/** 1080p 参考分辨率缩放配置 (平衡宽高)。 */
export const HD_1080P_SCALER: CanvasScalerConfig = {
  mode: 'scaleWithScreenSize',
  screenMatch: {
    referenceResolution: { width: 1920, height: 1080 },
    matchWidthOrHeight: 0.5,
  },
};

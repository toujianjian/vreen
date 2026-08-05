// UIPrimitives —— 显示型控件 (UIText / UIImage / UIRawImage)。
//
// 仿照 o3de LyShine `UiTextComponent` / `UiImageComponent`、UE5 UMG
// `UTextBlock` / `UImage`、Unity `Text` / `Image`。这些控件只负责显示,
// 不接收交互 (isRaycastTarget 可配置)。
//
// 渲染集成:控件持有「绘制指令」(draw command),由 UICanvas 在 onRender
// 阶段收集后交给渲染层。绘制指令是纯数据 (无 WebGL 依赖),便于测试与
// 序列化。实际渲染由 Renderer 层消费这些指令。
//
// 与 Core/Text 的区别:Core/Text 是 3D 空间文字 (Object3D),UIText 是
// 屏幕空间 UI 文字 (RectTransform + 布局参与)。UIText 可委托 Core/Text
// 做实际光栅化,但布局/锚点/对齐由 UI 系统管理。

import { UIElement } from './UIElement';
import type { ILayoutElement } from './UILayout';
import { getLayoutElement } from './UILayout';

/** RGBA 颜色 (0~1)。 */
export interface UIColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 文本水平对齐。 */
export type UITextAlignment = 'left' | 'center' | 'right';
/** 文本垂直对齐。 */
export type UIVerticalAlignment = 'top' | 'middle' | 'bottom';
/** 文本溢出处理。 */
export type UITextOverflow = 'overflow' | 'truncate' | 'wrap' | 'ellipsis';

/** 绘制指令 (纯数据,由渲染层消费)。 */
export type UIDrawCommand =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; color: UIColor; radius?: number; borderColor?: UIColor; borderWidth?: number }
  | { kind: 'text'; x: number; y: number; width: number; height: number; text: string; color: UIColor; fontSize: number; font?: string; align: UITextAlignment; verticalAlign: UIVerticalAlignment; rotation?: number }
  | { kind: 'image'; x: number; y: number; width: number; height: number; color: UIColor; uv?: { u0: number; v0: number; u1: number; v1: number } };

/**
 * UIText —— 屏幕空间文本控件。
 *
 * ```ts
 * const label = new UIText('score');
 * label.text = 'Score: 100';
 * label.color = { r: 1, g: 1, b: 1, a: 1 };
 * label.fontSize = 24;
 * label.alignment = 'center';
 * ```
 */
export class UIText extends UIElement {
  override readonly type: string = 'UIText';

  /** 文本内容。 */
  text: string = '';
  /** 字体大小 (逻辑像素)。 */
  fontSize: number = 16;
  /** 字体族 (CSS font-family 风格)。 */
  font: string = 'sans-serif';
  /** 文字颜色。 */
  color: UIColor = { r: 1, g: 1, b: 1, a: 1 };
  /** 水平对齐。 */
  alignment: UITextAlignment = 'left';
  /** 垂直对齐。 */
  verticalAlignment: UIVerticalAlignment = 'middle';
  /** 溢出处理。 */
  overflow: UITextOverflow = 'overflow';
  /** 行间距倍数 (1.0 = 单倍行距)。 */
  lineSpacing: number = 1.2;
  /** 是否自动换行 (width 限制时)。 */
  wordWrap: boolean = false;

  /** 计算后的绘制指令 (onRender 时生成)。 */
  drawCommand: UIDrawCommand | null = null;

  constructor(name: string = 'UIText', text: string = '') {
    super(name);
    this.text = text;
    this.isRaycastTarget = false; // 文本默认不参与命中检测。
  }

  /** 内容驱动尺寸:根据文本长度估算首选宽度。 */
  getLayoutElement(): ILayoutElement {
    // 粗略估算:每字符宽度 ≈ fontSize * 0.6,行数由换行决定。
    const lines = this.wordWrap ? [this.text] : this.text.split('\n');
    let maxChars = 0;
    for (const line of lines) maxChars = Math.max(maxChars, line.length);
    const estimatedWidth = maxChars * this.fontSize * 0.6;
    const estimatedHeight = lines.length * this.fontSize * this.lineSpacing;
    return {
      minWidth: 0,
      minHeight: this.fontSize,
      preferredWidth: Math.ceil(estimatedWidth),
      preferredHeight: Math.ceil(estimatedHeight),
      flexibleWidth: 0,
      flexibleHeight: 0,
    };
  }

  override onRender(): void {
    const r = this.worldRect;
    this.drawCommand = {
      kind: 'text',
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      text: this.text,
      color: this.color,
      fontSize: this.fontSize,
      font: this.font,
      align: this.alignment,
      verticalAlign: this.verticalAlignment,
    };
  }

  /** 设置文本 (链式)。 */
  setText(text: string): this {
    this.text = text;
    return this;
  }

  /** 设置颜色 (链式)。 */
  setColor(r: number, g: number, b: number, a: number = 1): this {
    this.color = { r, g, b, a };
    return this;
  }
}

/**
 * UIImage —— 矩形图像控件 (纯色 / 纹理 / 九宫格)。
 *
 * ```ts
 * const bg = new UIImage('background');
 * bg.color = { r: 0.1, g: 0.1, b: 0.15, a: 0.9 };
 * bg.transform.setSize(400, 300);
 * ```
 */
export class UIImage extends UIElement {
  override readonly type: string = 'UIImage';

  /** 主色 (纯色填充或纹理着色)。 */
  color: UIColor = { r: 1, g: 1, b: 1, a: 1 };
  /** 纹理 UV (若使用纹理)。 */
  uv: { u0: number; v0: number; u1: number; v1: number } | null = null;
  /** 圆角半径 (像素,0=直角)。 */
  cornerRadius: number = 0;
  /** 边框颜色 (null=无边框)。 */
  borderColor: UIColor | null = null;
  /** 边框宽度 (像素)。 */
  borderWidth: number = 0;
  /** 是否平铺填充 (true=纹理重复,false=拉伸)。 */
  tiled: boolean = false;

  drawCommand: UIDrawCommand | null = null;

  constructor(name: string = 'UIImage') {
    super(name);
  }

  override onRender(): void {
    const r = this.worldRect;
    if (this.uv) {
      this.drawCommand = {
        kind: 'image',
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        color: this.color,
        uv: this.uv,
      };
    } else {
      this.drawCommand = {
        kind: 'rect',
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        color: this.color,
        radius: this.cornerRadius,
        borderColor: this.borderColor ?? undefined,
        borderWidth: this.borderWidth,
      };
    }
  }

  /** 设置颜色 (链式)。 */
  setColor(r: number, g: number, b: number, a: number = 1): this {
    this.color = { r, g, b, a };
    return this;
  }
}

/**
 * UIRawImage —— 原始图像 (不做九宫格/着色,直接绘制纹理)。
 * 用于视频帧、截图、动态纹理等场景。
 */
export class UIRawImage extends UIImage {
  override readonly type: string = 'UIRawImage';

  constructor(name: string = 'UIRawImage') {
    super(name);
    this.uv = { u0: 0, v0: 0, u1: 1, v1: 1 };
  }
}

/** 颜色工具。 */
export const UIColors = {
  white: (): UIColor => ({ r: 1, g: 1, b: 1, a: 1 }),
  black: (): UIColor => ({ r: 0, g: 0, b: 0, a: 1 }),
  transparent: (): UIColor => ({ r: 0, g: 0, b: 0, a: 0 }),
  red: (): UIColor => ({ r: 1, g: 0, b: 0, a: 1 }),
  green: (): UIColor => ({ r: 0, g: 1, b: 0, a: 1 }),
  blue: (): UIColor => ({ r: 0, g: 0, b: 1, a: 1 }),
  lerp(a: UIColor, b: UIColor, t: number): UIColor {
    return {
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t,
      a: a.a + (b.a - a.a) * t,
    };
  },
};

// 确保 getLayoutElement 在未混入时可用 (退化为 transform 尺寸)。
export { getLayoutElement };

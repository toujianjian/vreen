// UIScrollRect —— 滚动视图 (视口 + 内容 + 滚动条)。
//
// 仿照 o3de LyShine `UiScrollBox`、UE5 UMG `UScrollBox`、Unity `ScrollRect`。
// 当内容超出视口时,通过滚动偏移显示内容的不同部分。
//
// 结构:
//   * viewport (裁剪区域) —— 内容只在此区域内可见。
//   * content (滚动内容) —— 实际子元素容器,尺寸可超过 viewport。
//   * horizontalScrollbar / verticalScrollbar —— 可选滚动条。
//
// 裁剪实现:content 的子元素在 layout 阶段被 viewport 裁剪 (通过 worldRect 相交)。
// 渲染层根据 worldRect 与 viewport 的关系丢弃/裁剪绘制指令。

import { UIElement } from './UIElement';
import { UIImage } from './UIPrimitives';
import type { UIDragEvent } from './UIInput';

/** 滚动方向。 */
export type ScrollDirection = 'horizontal' | 'vertical' | 'both';

/** 滚动条可见性。 */
export type ScrollbarVisibility = 'permanent' | 'auto' | 'hidden';

/** 滚动配置。 */
export interface ScrollRectOptions {
  direction: ScrollDirection;
  /** 滚动灵敏度 (每次滚轮事件的像素位移)。 */
  scrollSensitivity: number;
  /** 惯性 (松开后继续滚动)。 */
  inertia: boolean;
  /** 减速率 (inertia=true 时,每秒速度衰减比例 0~1)。 */
  decelerationRate: number;
  /** 弹性 (滚到边界时回弹)。 */
  elastic: boolean;
  /** 弹性系数 (越大力越小)。 */
  elasticity: number;
  horizontalScrollbarVisibility: ScrollbarVisibility;
  verticalScrollbarVisibility: ScrollbarVisibility;
}

const DEFAULT_SCROLL_OPTIONS: ScrollRectOptions = {
  direction: 'vertical',
  scrollSensitivity: 40,
  inertia: true,
  decelerationRate: 0.05,
  elastic: true,
  elasticity: 0.1,
  horizontalScrollbarVisibility: 'auto',
  verticalScrollbarVisibility: 'auto',
};

/**
 * UIScrollRect —— 滚动视图。
 *
 * ```ts
 * const scroll = new UIScrollRect('inventory');
 * for (const item of items) {
 *   scroll.content.addChild(itemRow);
 * }
 * canvas.root.addChild(scroll);
 * ```
 */
export class UIScrollRect extends UIElement {
  override readonly type: string = 'UIScrollRect';

  options: ScrollRectOptions;

  /** 视口 (裁剪区域,内容只在此可见)。 */
  readonly viewport: UIElement;
  /** 内容容器 (子元素的实际父级)。 */
  readonly content: UIElement;
  /** 水平滚动条。 */
  readonly horizontalScrollbar: UIImage;
  /** 垂直滚动条。 */
  readonly verticalScrollbar: UIImage;

  /** 当前水平滚动位置 (0=最左,1=最右)。 */
  horizontalNormalizedPosition: number = 0;
  /** 当前垂直滚动位置 (0=最上,1=最下)。 */
  verticalNormalizedPosition: number = 0;

  /** 滚动速度 (惯性用)。 */
  private velocity: { x: number; y: number } = { x: 0, y: 0 };

  constructor(name: string = 'UIScrollRect', options?: Partial<ScrollRectOptions>) {
    super(name);
    this.options = { ...DEFAULT_SCROLL_OPTIONS, ...options };

    // viewport:占据整个 scroll rect,作为 content 的父。
    this.viewport = new UIElement(`${name}/viewport`);
    this.viewport.transform.setAnchorPreset('stretchAll');
    this.viewport.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.viewport.isRaycastTarget = false;
    this.addChild(this.viewport);

    // content:在 viewport 内,可超出尺寸。
    this.content = new UIElement(`${name}/content`);
    this.content.transform.setAnchorPreset('stretchAll');
    this.content.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.viewport.addChild(this.content);

    // 滚动条。
    this.horizontalScrollbar = new UIImage(`${name}/hbar`);
    this.horizontalScrollbar.transform.setAnchorPreset('bottomStretch');
    this.horizontalScrollbar.transform.offsets = { left: 0, bottom: 0, right: 0, top: -12 };
    this.horizontalScrollbar.color = { r: 0.3, g: 0.3, b: 0.35, a: 0.8 };
    this.horizontalScrollbar.visible = this.options.horizontalScrollbarVisibility === 'permanent';
    this.addChild(this.horizontalScrollbar);

    this.verticalScrollbar = new UIImage(`${name}/vbar`);
    this.verticalScrollbar.transform.setAnchorPreset('stretchRight');
    this.verticalScrollbar.transform.offsets = { left: -12, bottom: 0, right: 0, top: 0 };
    this.verticalScrollbar.color = { r: 0.3, g: 0.3, b: 0.35, a: 0.8 };
    this.verticalScrollbar.visible = this.options.verticalScrollbarVisibility === 'permanent';
    this.addChild(this.verticalScrollbar);

    this.isRaycastTarget = true;

    // 拖拽滚动。
    this.onDrag = (e: UIDragEvent) => this.handleDrag(e);
    this.onDragStart = () => { this.velocity = { x: 0, y: 0 }; };
  }

  /** 拖拽处理:移动内容。 */
  private handleDrag(e: UIDragEvent): void {
    const vp = this.viewport.worldRect;
    const cw = this.content.worldRect.width;
    const ch = this.content.worldRect.height;

    if ((this.options.direction === 'horizontal' || this.options.direction === 'both') && cw > vp.width) {
      const range = cw - vp.width;
      this.horizontalNormalizedPosition = Math.max(0, Math.min(1, this.horizontalNormalizedPosition - e.deltaX / range));
    }
    if ((this.options.direction === 'vertical' || this.options.direction === 'both') && ch > vp.height) {
      const range = ch - vp.height;
      // UI Y 向上:向上拖拽 (deltaY>0) 应减小 normalizedPosition (看下方内容)。
      this.verticalNormalizedPosition = Math.max(0, Math.min(1, this.verticalNormalizedPosition + e.deltaY / range));
    }
    this.velocity = { x: -e.deltaX, y: e.deltaY };
  }

  /** 滚轮处理 (由 UIInputDispatcher 调用)。 */
  handleScroll(deltaX: number, deltaY: number): void {
    const vp = this.viewport.worldRect;
    const cw = this.content.worldRect.width;
    const ch = this.content.worldRect.height;

    if ((this.options.direction === 'vertical' || this.options.direction === 'both') && ch > vp.height) {
      const range = ch - vp.height;
      this.verticalNormalizedPosition = Math.max(0, Math.min(1, this.verticalNormalizedPosition + deltaY * this.options.scrollSensitivity / range));
    }
    if ((this.options.direction === 'horizontal' || this.options.direction === 'both') && cw > vp.width) {
      const range = cw - vp.width;
      this.horizontalNormalizedPosition = Math.max(0, Math.min(1, this.horizontalNormalizedPosition - deltaX * this.options.scrollSensitivity / range));
    }
  }

  /** 每帧更新:惯性 + 弹性 + 应用偏移。 */
  override onLayout(_width: number, _height: number): void {
    // 惯性衰减。
    if (this.options.inertia) {
      this.velocity.x *= 1 - this.options.decelerationRate;
      this.velocity.y *= 1 - this.options.decelerationRate;
      if (Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.y) > 0.1) {
        this.handleDrag({
          uiEvent: {} as any,
          startX: 0, startY: 0, x: 0, y: 0,
          deltaX: this.velocity.x, deltaY: this.velocity.y,
          button: 'left',
        });
      }
    }

    // 弹性回弹 (超出 0~1 时拉回)。
    if (this.options.elastic) {
      const e = this.options.elasticity;
      if (this.horizontalNormalizedPosition < 0) this.horizontalNormalizedPosition *= (1 - e);
      else if (this.horizontalNormalizedPosition > 1) this.horizontalNormalizedPosition = 1 + (this.horizontalNormalizedPosition - 1) * (1 - e);
      if (this.verticalNormalizedPosition < 0) this.verticalNormalizedPosition *= (1 - e);
      else if (this.verticalNormalizedPosition > 1) this.verticalNormalizedPosition = 1 + (this.verticalNormalizedPosition - 1) * (1 - e);
    } else {
      this.horizontalNormalizedPosition = Math.max(0, Math.min(1, this.horizontalNormalizedPosition));
      this.verticalNormalizedPosition = Math.max(0, Math.min(1, this.verticalNormalizedPosition));
    }

    // 应用内容偏移:content 在 viewport 中的位置由 normalizedPosition 决定。
    const cw = this.content.worldRect.width;
    const ch = this.content.worldRect.height;
    const vp = this.viewport.worldRect;

    if (cw > vp.width) {
      const range = cw - vp.width;
      this.content.transform.offsets.left = -this.horizontalNormalizedPosition * range;
      this.content.transform.offsets.right = -this.horizontalNormalizedPosition * range + cw;
    }
    if (ch > vp.height) {
      const range = ch - vp.height;
      // vertical 0=顶 (content 底部对齐 viewport 顶),1=底。
      this.content.transform.offsets.bottom = this.verticalNormalizedPosition * range;
      this.content.transform.offsets.top = this.verticalNormalizedPosition * range + ch;
    }
  }

  /** 滚动到顶部。 */
  scrollToTop(): void {
    this.verticalNormalizedPosition = 0;
    this.velocity = { x: 0, y: 0 };
  }

  /** 滚动到底部。 */
  scrollToBottom(): void {
    this.verticalNormalizedPosition = 1;
    this.velocity = { x: 0, y: 0 };
  }
}

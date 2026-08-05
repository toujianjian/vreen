// UILayout —— 自动布局系统 (LayoutGroup / ContentSizeFitter / LayoutElement)。
//
// 仿照 o3de LyShine `UiLayoutColumn/Row/Grid`、UE5 UMG `UHorizontalBox /
// UVerticalBox / UGridPanel / USizeBox`、Unity `LayoutGroup / ContentSizeFitter
// / LayoutElement`。解决「子元素位置/尺寸自动计算」问题,免去手动设置每个
// 元素的 RectTransform offsets。
//
// 三大组件:
//   1. LayoutElement —— 声明元素的「首选尺寸」与「弹性权重」,供 LayoutGroup 查询。
//   2. LayoutGroup (Horizontal/Vertical/Grid) —— 容器,按规则排列子元素。
//   3. ContentSizeFitter —— 根据内容调整自身尺寸 (min/preferred)。
//
// 布局两阶段 (Unity 模式):
//   * CalcHorizontal/Vertical —— 自底向上计算各元素首选尺寸。
//   * SetChildren —— 自顶向下分配位置与尺寸。
//
// 用法:把 LayoutGroup 附加到 UIElement (作为 userData 或 mixin),在 onLayout
// 中调用 group.layoutChildren(width, height)。本实现采用「LayoutGroup 继承 UIElement」
// 的方式,更符合 UE5 (UHorizontalBox 即 UWidget) 的结构。

import { UIElement } from './UIElement';

/** 子元素对齐方式 (当 group 尺寸大于内容总尺寸时)。 */
export type ChildAlignment =
  | 'upperLeft' | 'upperCenter' | 'upperRight'
  | 'middleLeft' | 'middleCenter' | 'middleRight'
  | 'lowerLeft' | 'lowerCenter' | 'lowerRight';

/** 元素布局偏好 (供 LayoutGroup 查询)。 */
export interface ILayoutElement {
  /** 最小宽度 (group 不会压缩到此以下)。 */
  minWidth: number;
  /** 最小高度。 */
  minHeight: number;
  /** 首选宽度 (无弹性时按此尺寸分配)。 */
  preferredWidth: number;
  /** 首选高度。 */
  preferredHeight: number;
  /** 水平弹性权重 (剩余空间按此比例分配,0=不拉伸)。 */
  flexibleWidth: number;
  /** 垂直弹性权重。 */
  flexibleHeight: number;
}

/**
 * 从 UIElement 提取布局偏好。
 *
 * 查找顺序:element.userData 若为 ILayoutElement-compatible 则用之;
 * 否则用 transform.sizeDelta 作为 preferred,min = 0,flexible = 0。
 * 子类 (如 UIText/UIImage) 可覆盖 getLayoutElement() 提供内容驱动尺寸。
 */
export function getLayoutElement(el: UIElement): ILayoutElement {
  // 若元素自身实现了 getLayoutElement (混入接口),优先使用。
  const maybe = el as UIElement & { getLayoutElement?(): ILayoutElement };
  if (typeof maybe.getLayoutElement === 'function') {
    return maybe.getLayoutElement();
  }
  // 退化为 transform 当前尺寸。
  const sd = el.transform.sizeDelta;
  return {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: Math.max(0, sd.x),
    preferredHeight: Math.max(0, sd.y),
    flexibleWidth: 0,
    flexibleHeight: 0,
  };
}

/** 布局组公共配置。 */
export interface LayoutGroupOptions {
  /** 子元素间距 (像素)。 */
  spacing: number;
  /** 内边距 (像素) {left, right, top, bottom}。 */
  padding: { left: number; right: number; top: number; bottom: number };
  /** 子元素对齐。 */
  childAlignment: ChildAlignment;
  /** 是否控制子元素尺寸 (true=强制子元素填充分配区域)。 */
  controlChildSize: boolean;
  /** 是否使用子元素弹性权重分配剩余空间。 */
  useFlexibleSpaces: boolean;
  /** 是否在布局后强制子元素填满分配区域 (childForceExpand)。 */
  childForceExpandWidth: boolean;
  childForceExpandHeight: boolean;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutGroupOptions = {
  spacing: 0,
  padding: { left: 0, right: 0, top: 0, bottom: 0 },
  childAlignment: 'upperLeft',
  controlChildSize: true,
  useFlexibleSpaces: false,
  childForceExpandWidth: false,
  childForceExpandHeight: false,
};

/** 计算对齐偏移 (内容在容器中的偏移)。 */
function alignOffset(
  containerSize: number,
  contentSize: number,
  align: ChildAlignment,
  horizontal: boolean,
): number {
  if (contentSize >= containerSize) return 0;
  const isCenter = align.includes('Center');
  const isRightOrLower = align.includes('Right') || align.includes('lower');
  if (horizontal) {
    // 水平方向。
    if (align.includes('upper') || align.includes('middle') || align.includes('lower')) {
      // 水平由后缀决定:Left/Center/Right。
      if (align.includes('Left')) return 0;
      if (isCenter) return (containerSize - contentSize) * 0.5;
      if (isRightOrLower) return containerSize - contentSize;
      // upperLeft/middleLeft/lowerLeft 已处理;含 Center/Right 的分支。
      // 实际 childAlignment 格式为 prefix+horizontal,如 middleCenter。
      return align.includes('Center') ? (containerSize - contentSize) * 0.5 : 0;
    }
  }
  // 竖直方向:upper=顶 (offset 0), lower=底, center=中。
  if (align.includes('upper')) return containerSize - contentSize;
  if (align.includes('lower')) return 0;
  if (align.includes('middle') || align.includes('Center')) return (containerSize - contentSize) * 0.5;
  return 0;
}

/**
 * 通用布局组基类。子类 (Horizontal/Vertical/Grid) 实现 layoutChildren。
 *
 * LayoutGroup 继承 UIElement,因此自身有 transform,布局结果写入子元素的
 * transform.offsets (相对本 group 的本地坐标系)。
 */
export abstract class LayoutGroup extends UIElement {
  options: LayoutGroupOptions;

  constructor(name: string, options?: Partial<LayoutGroupOptions>) {
    super(name);
    this.options = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
    // LayoutGroup 自身不应被 layoutGroup 二次控制其子元素尺寸时覆盖。
  }

  /** onLayout 钩子:布局子元素。 */
  override onLayout(width: number, height: number): void {
    this.layoutChildren(width, height);
  }

  /** 子类实现:在给定容器尺寸内排列子元素。 */
  abstract layoutChildren(width: number, height: number): void;

  /** 设置子元素本地 rect (相对 group 内边距区域)。 */
  protected setChildRect(child: UIElement, x: number, y: number, w: number, h: number): void {
    // 使用点锚点 (左下),直接设置 offsets 实现绝对定位。
    child.transform.anchors = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    child.transform.offsets = {
      left: x,
      bottom: y,
      right: x + w,
      top: y + h,
    };
  }
}

/**
 * 水平布局组 —— 子元素从左到右排列。
 * 仿 UE5 UHorizontalBox / Unity HorizontalLayoutGroup。
 */
export class HorizontalLayoutGroup extends LayoutGroup {
  constructor(name: string = 'HorizontalLayoutGroup', options?: Partial<LayoutGroupOptions>) {
    super(name, options);
  }

  override layoutChildren(width: number, height: number): void {
    const { spacing, padding, childAlignment, controlChildSize, useFlexibleSpaces, childForceExpandWidth, childForceExpandHeight } = this.options;
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const visible = this.children.filter((c) => c.enabled);
    if (visible.length === 0) return;

    // 1. 计算首选尺寸总和与弹性权重总和。
    let preferredTotal = 0;
    let flexTotal = 0;
    const prefs = visible.map((c) => {
      const le = getLayoutElement(c);
      preferredTotal += le.preferredWidth;
      flexTotal += useFlexibleSpaces || childForceExpandWidth ? le.flexibleWidth : 0;
      return le;
    });
    preferredTotal += spacing * (visible.length - 1);

    // 2. 分配宽度。
    let extraSpace = innerW - preferredTotal;
    const widths = prefs.map((le, i) => {
      let w = le.preferredWidth;
      if (extraSpace > 0 && flexTotal > 0 && (useFlexibleSpaces || childForceExpandWidth)) {
        w += (extraSpace * prefs[i].flexibleWidth) / flexTotal;
      } else if (childForceExpandWidth && extraSpace > 0) {
        // 无弹性权重但强制展开:均分。
        w += extraSpace / visible.length;
      }
      return controlChildSize ? w : Math.max(le.preferredWidth, le.minWidth);
    });

    // 若 controlChildSize=false,用元素自身 transform.sizeDelta (保留用户设定的尺寸)。
    if (!controlChildSize) {
      for (let i = 0; i < visible.length; i++) {
        widths[i] = visible[i].transform.sizeDelta.x;
      }
    }

    // 3. 计算内容总宽 (用于对齐)。
    const contentW = widths.reduce((a, b) => a + b, 0) + spacing * (visible.length - 1);
    const startX = padding.left + alignOffset(innerW, contentW, childAlignment, true);

    // 4. 摆放。
    let cursorX = startX;
    for (let i = 0; i < visible.length; i++) {
      const le = prefs[i];
      const childH = controlChildSize
        ? (childForceExpandHeight ? innerH : Math.min(le.preferredHeight, innerH))
        : getLayoutElement(visible[i]).preferredHeight;
      // 竖直对齐。
      const childY = padding.bottom + alignOffset(innerH, childH, childAlignment, false);
      this.setChildRect(visible[i], cursorX, childY, widths[i], childH);
      cursorX += widths[i] + spacing;
    }
  }
}

/**
 * 垂直布局组 —— 子元素从上到下排列。
 * 仿 UE5 UVerticalBox / Unity VerticalLayoutGroup。
 *
 * 注意:UI 坐标系 Y 向上,「从上到下」意味着第一个子元素 Y 最大 (顶部),
 * 后续子元素 Y 递减。
 */
export class VerticalLayoutGroup extends LayoutGroup {
  constructor(name: string = 'VerticalLayoutGroup', options?: Partial<LayoutGroupOptions>) {
    super(name, options);
  }

  override layoutChildren(width: number, height: number): void {
    const { spacing, padding, childAlignment, controlChildSize, useFlexibleSpaces, childForceExpandWidth, childForceExpandHeight } = this.options;
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const visible = this.children.filter((c) => c.enabled);
    if (visible.length === 0) return;

    let preferredTotal = 0;
    let flexTotal = 0;
    const prefs = visible.map((c) => {
      const le = getLayoutElement(c);
      preferredTotal += le.preferredHeight;
      flexTotal += useFlexibleSpaces || childForceExpandHeight ? le.flexibleHeight : 0;
      return le;
    });
    preferredTotal += spacing * (visible.length - 1);

    let extraSpace = innerH - preferredTotal;
    const heights = prefs.map((le, i) => {
      let h = le.preferredHeight;
      if (extraSpace > 0 && flexTotal > 0 && (useFlexibleSpaces || childForceExpandHeight)) {
        h += (extraSpace * prefs[i].flexibleHeight) / flexTotal;
      } else if (childForceExpandHeight && extraSpace > 0) {
        h += extraSpace / visible.length;
      }
      return controlChildSize ? h : Math.max(le.preferredHeight, le.minHeight);
    });

    if (!controlChildSize) {
      for (let i = 0; i < visible.length; i++) {
        heights[i] = visible[i].transform.sizeDelta.y;
      }
    }

    const contentH = heights.reduce((a, b) => a + b, 0) + spacing * (visible.length - 1);
    // 竖直对齐:upper=内容顶部对齐容器顶部。
    const startY = padding.bottom + alignOffset(innerH, contentH, childAlignment, false);
    // 从上往下:第一个元素在最高 Y。
    let cursorY = startY + contentH;
    for (let i = 0; i < visible.length; i++) {
      const le = prefs[i];
      cursorY -= heights[i];
      const childW = controlChildSize
        ? (childForceExpandWidth ? innerW : Math.min(le.preferredWidth, innerW))
        : getLayoutElement(visible[i]).preferredWidth;
      const childX = padding.left + alignOffset(innerW, childW, childAlignment, true);
      this.setChildRect(visible[i], childX, cursorY, childW, heights[i]);
      cursorY -= spacing;
    }
  }
}

/** 网格布局配置。 */
export interface GridLayoutOptions extends Partial<LayoutGroupOptions> {
  /** 列数 (0=根据 cellSize 自动计算)。 */
  columns?: number;
  /** 行数 (0=自动)。 */
  rows?: number;
  /** 单元格尺寸。 */
  cellSize: { width: number; height: number };
}

/**
 * 网格布局组 —— 子元素按行列网格排列。
 * 仿 UE5 UGridPanel / Unity GridLayoutGroup。
 */
export class GridLayoutGroup extends LayoutGroup {
  gridOptions: GridLayoutOptions;

  constructor(name: string = 'GridLayoutGroup', options?: GridLayoutOptions) {
    super(name, options);
    this.gridOptions = { columns: 1, rows: 0, cellSize: { width: 100, height: 100 }, ...options };
  }

  override layoutChildren(width: number, _height: number): void {
    const { spacing, padding, cellSize } = { ...this.options, ...this.gridOptions };
    const cols = this.gridOptions.columns || 1;
    const innerW = width - padding.left - padding.right;
    // const innerH = height - padding.top - padding.bottom;

    const visible = this.children.filter((c) => c.enabled);
    if (visible.length === 0) return;

    // 实际列宽:若 cellSize.width<=0 则按列数均分内宽。
    const cellW = cellSize.width > 0 ? cellSize.width : (innerW - spacing * (cols - 1)) / cols;
    const cellH = cellSize.height;

    for (let i = 0; i < visible.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding.left + col * (cellW + spacing);
      // 从上往下排列 (Y 向上):第一行在顶部。
      const totalRows = Math.ceil(visible.length / cols);
      const y = padding.bottom + (totalRows - 1 - row) * (cellH + this.options.spacing);
      this.setChildRect(visible[i], x, y, cellW, cellH);
    }
  }
}

/**
 * ContentSizeFitter —— 根据子元素内容调整自身尺寸。
 * 仿 Unity ContentSizeFitter / UE5 USizeBox。
 *
 * 不继承 LayoutGroup (它不是容器,而是附加到任意 UIElement 的行为)。
 * 通过在元素的 onLayout 中调用 fit 来实现。
 */
export class ContentSizeFitter {
  /** 水平适配模式。 */
  horizontalFit: 'none' | 'minSize' | 'preferredSize' | 'unconstrained';
  /** 垂直适配模式。 */
  verticalFit: 'none' | 'minSize' | 'preferredSize' | 'unconstrained';

  constructor(
    horizontalFit: 'none' | 'minSize' | 'preferredSize' | 'unconstrained' = 'preferredSize',
    verticalFit: 'none' | 'minSize' | 'preferredSize' | 'unconstrained' = 'preferredSize',
  ) {
    this.horizontalFit = horizontalFit;
    this.verticalFit = verticalFit;
  }

  /**
   * 计算并应用尺寸到目标元素的 transform。
   * 应在子元素布局完成「之后」、父元素布局该元素「之前」调用。
   */
  fit(target: UIElement): { width: number; height: number } {
    let width = target.transform.sizeDelta.x;
    let height = target.transform.sizeDelta.y;

    // 聚合子元素的首选尺寸。
    const children = target.children.filter((c) => c.enabled);
    if (children.length > 0) {
      let maxRight = 0;
      let maxTop = 0;
      for (const child of children) {
        const le = getLayoutElement(child);
        const r = child.transform.computeRect(le.preferredWidth, le.preferredHeight);
        maxRight = Math.max(maxRight, r.x + r.width);
        maxTop = Math.max(maxTop, r.y + r.height);
      }
      if (this.horizontalFit !== 'none') {
        width = this.horizontalFit === 'minSize' ? 0 : maxRight;
      }
      if (this.verticalFit !== 'none') {
        height = this.verticalFit === 'minSize' ? 0 : maxTop;
      }
    }

    target.transform.setSize(width, height);
    return { width, height };
  }
}

/**
 * LayoutElement —— 显式声明元素的布局偏好 (覆盖默认的 transform 尺寸)。
 * 仿 Unity LayoutElement。
 *
 * 用法:作为 UIElement 的 userData 设置,或通过 getLayoutElement() 返回。
 */
export class LayoutElementPrefs implements ILayoutElement {
  minWidth: number = 0;
  minHeight: number = 0;
  preferredWidth: number = 100;
  preferredHeight: number = 100;
  flexibleWidth: number = 0;
  flexibleHeight: number = 0;
  /** 是否启用 (false 时 LayoutGroup 忽略此偏好)。 */
  enabled: boolean = true;

  constructor(prefs?: Partial<ILayoutElement>) {
    if (prefs) Object.assign(this, prefs);
  }
}

/** 将 LayoutElementPrefs 附加到 UIElement (作为 userData + getLayoutElement 方法)。 */
export function attachLayoutPrefs(el: UIElement, prefs: LayoutElementPrefs): void {
  const enriched = el as UIElement & { getLayoutElement?(): ILayoutElement; layoutPrefs?: LayoutElementPrefs };
  enriched.layoutPrefs = prefs;
  enriched.getLayoutElement = () => (prefs.enabled ? prefs : getLayoutElementFallback(el));
}

/** 无 prefs 时的退化解 (避免 attachLayoutPrefs 中递归)。 */
function getLayoutElementFallback(el: UIElement): ILayoutElement {
  const sd = el.transform.sizeDelta;
  return {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: Math.max(0, sd.x),
    preferredHeight: Math.max(0, sd.y),
    flexibleWidth: 0,
    flexibleHeight: 0,
  };
}

/** 布局方向 (用于查询)。 */
export type LayoutAxis = 'horizontal' | 'vertical';

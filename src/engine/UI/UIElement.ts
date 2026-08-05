// UIElement —— UI 元素基类 (层级 / 变换 / 渲染 / 交互)。
//
// 仿照 o3de LyShine `UiElementInterface` / `UiElementComponent`、UE5 UMG
// `UWidget`、Unity `UIBehaviour`。所有 UI 控件 (UIText / UIImage / UIButton / ...)
// 继承此类,获得:
//   * 父子层级 (children 数组 + parent 引用)
//   * RectTransform (锚点/枢轴/偏移/尺寸)
//   * 可见性 (visible + activeInHierarchy)
//   * 命中检测 (isRaycastTarget + raycast)
//   * 标识 (name + id)
//   * 生命周期 (onEnable / onDisable / onLayout / onRender)
//
// 渲染集成:UIElement 是纯逻辑对象,实际渲染由子类委托给底层原语
// (Core/Text、Core/Sprite 等)。这样布局/层级/交互逻辑可独立测试,
// 不依赖 WebGL。UICanvas 在每帧 onRender 中收集所有可见元素的绘制指令。
//
// 与 3D Object3D 的关系:UIElement 不继承 Object3D (3D 场景图),
// 而是独立的 2D 层级。world-space UI 可由 UICanvas 投影到 3D。

import { RectTransform, type UIRect } from './RectTransform';
import type { UIPointerEvent, UIDragEvent, UIKeyEvent } from './UIInput';

/** 元素可见性状态。 */
export interface UIElementVisibility {
  /** 自身可见标志。 */
  visible: boolean;
  /** 是否参与层级 (false 时连同子元素一起隐藏)。 */
  get activeInHierarchy(): boolean;
}

/** UI 元素生命周期回调 (子类覆盖)。 */
export interface UIElementLifecycle {
  /** 元素被启用 / 添加到层级时调用。 */
  onEnable?(): void;
  /** 元素被禁用 / 从层级移除时调用。 */
  onDisable?(): void;
  /** 布局阶段 (父尺寸已知,计算自身尺寸/位置)。 */
  onLayout?(parentWidth: number, parentHeight: number): void;
  /** 渲染阶段 (收集绘制指令)。 */
  onRender?(): void;
}

/** UI 元素唯一标识 (用于事件路由 / 查找)。 */
let __uiElementIdCounter = 0;

/**
 * UIElement —— 所有 UI 控件的基类。
 *
 * ```ts
 * const root = new UIElement('root');
 * const child = new UIElement('child');
 * root.addChild(child);
 * child.transform.setAnchorPreset('stretchAll');
 * ```
 */
export class UIElement {
  readonly type: string = 'UIElement';

  /** 唯一 ID (自动递增)。 */
  readonly id: number = ++__uiElementIdCounter;

  /** 人类可读名称 (非唯一,用于调试 / 查找)。 */
  name: string;

  /** 2D 变换。 */
  readonly transform: RectTransform = new RectTransform();

  /** 父元素 (null = 根)。 */
  parent: UIElement | null = null;

  /** 子元素列表 (顺序即渲染顺序,后添加的在上方)。 */
  readonly children: UIElement[] = [];

  /** 自身可见标志。 */
  visible: boolean = true;

  /** 是否参与命中检测 (不可见元素自动不参与)。 */
  isRaycastTarget: boolean = true;

  /** 是否启用 (false 时 onLayout/onRender 不调用,子元素也被冻结)。 */
  enabled: boolean = true;

  /** 用户自定义数据 (任意类型,用于绑定游戏状态)。 */
  userData: unknown = undefined;

  /** 计算后的世界包围盒 (由 UICanvas 在布局阶段填充)。 */
  worldRect: UIRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(name: string = 'UIElement') {
    this.name = name;
  }

  /** 层级中是否激活 (自身 enabled+visible 且所有祖先均激活)。 */
  get activeInHierarchy(): boolean {
    if (!this.enabled || !this.visible) return false;
    return this.parent ? this.parent.activeInHierarchy : true;
  }

  /** 添加子元素 (自动从原父级移除)。 */
  addChild(child: UIElement): UIElement {
    if (child.parent !== null) {
      child.parent.removeChild(child);
    }
    child.parent = this;
    this.children.push(child);
    child.onEnable?.();
    return child;
  }

  /** 在指定索引处插入子元素。 */
  addChildAt(child: UIElement, index: number): UIElement {
    if (child.parent !== null) {
      child.parent.removeChild(child);
    }
    child.parent = this;
    this.children.splice(index, 0, child);
    child.onEnable?.();
    return child;
  }

  /** 移除子元素。 */
  removeChild(child: UIElement): boolean {
    const idx = this.children.indexOf(child);
    if (idx === -1) return false;
    this.children.splice(idx, 1);
    child.parent = null;
    child.onDisable?.();
    return true;
  }

  /** 移除所有子元素。 */
  removeAllChildren(): void {
    // 倒序移除避免索引偏移。
    for (let i = this.children.length - 1; i >= 0; i--) {
      this.removeChild(this.children[i]);
    }
  }

  /** 子元素数量。 */
  get childCount(): number {
    return this.children.length;
  }

  /** 按名称查找直接子元素。 */
  findChild(name: string): UIElement | null {
    return this.children.find((c) => c.name === name) ?? null;
  }

  /** 递归查找后代 (深度优先)。 */
  findDescendant(name: string): UIElement | null {
    for (const child of this.children) {
      if (child.name === name) return child;
      const found = child.findDescendant(name);
      if (found) return found;
    }
    return null;
  }

  /** 设置兄弟节点中的索引 (渲染顺序)。 */
  setSiblingIndex(index: number): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx === -1) return;
    this.parent.children.splice(idx, 1);
    const clamped = Math.max(0, Math.min(index, this.parent.children.length));
    this.parent.children.splice(clamped, 0, this);
  }

  /** 置于最前 (最后渲染,视觉最上方)。 */
  bringToFront(): void {
    if (!this.parent) return;
    this.setSiblingIndex(this.parent.children.length - 1);
  }

  /** 置于最后 (最先渲染,视觉最下方)。 */
  sendToBack(): void {
    this.setSiblingIndex(0);
  }

  /**
   * 命中检测 —— 判断世界坐标点是否落在本元素上。
   * 默认实现使用 worldRect;子类可覆盖以支持非矩形形状。
   */
  hitTest(x: number, y: number): boolean {
    if (!this.activeInHierarchy || !this.isRaycastTarget) return false;
    return (
      x >= this.worldRect.x &&
      x <= this.worldRect.x + this.worldRect.width &&
      y >= this.worldRect.y &&
      y <= this.worldRect.y + this.worldRect.height
    );
  }

  /**
   * 递归命中检测 —— 从子元素倒序遍历,返回最顶层命中的元素。
   * 用于 UIInput 的 raycast:点击事件应路由到视觉最上层的元素。
   */
  raycast(x: number, y: number): UIElement | null {
    if (!this.activeInHierarchy) return null;

    // 倒序遍历子元素 (后渲染的在上方,优先命中)。
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].raycast(x, y);
      if (hit) return hit;
    }

    // 没有子元素命中,检测自身。
    return this.hitTest(x, y) ? this : null;
  }

  /** 布局阶段:计算自身 worldRect 并递归布局子元素。 */
  layout(parentX: number, parentY: number, parentWidth: number, parentHeight: number): void {
    if (!this.enabled) return;

    // 计算本地 rect (相对父元素左下角)。
    const local = this.transform.computeRect(parentWidth, parentHeight);

    // worldRect = 父元素原点 + 本地偏移。
    this.worldRect = {
      x: parentX + local.x,
      y: parentY + local.y,
      width: local.width,
      height: local.height,
    };

    // 通知子类布局已完成 (供 ContentSizeFitter / LayoutGroup 使用)。
    this.onLayout?.(local.width, local.height);

    // 递归布局子元素 (以自身 rect 为父区域)。
    if (this.visible) {
      for (const child of this.children) {
        child.layout(this.worldRect.x, this.worldRect.y, local.width, local.height);
      }
    }
  }

  /** 渲染阶段:自身 + 递归渲染子元素。 */
  render(): void {
    if (!this.activeInHierarchy) return;
    this.onRender?.();
    for (const child of this.children) {
      child.render();
    }
  }

  /** 销毁:从父级移除并清理子元素。 */
  destroy(): void {
    this.removeAllChildren();
    if (this.parent) {
      this.parent.removeChild(this);
    }
    this.onDisable?.();
  }

  // 生命周期钩子 (子类覆盖)。
  onEnable?(): void;
  onDisable?(): void;
  onLayout?(width: number, height: number): void;
  onRender?(): void;

  // 输入事件回调 (UIInputDispatcher 通过 bubblePointer/bubbleDrag 沿父链派发)。
  // 任意 UIElement 均可设置这些回调接收事件,无需继承 UIInteractable。
  // UIInteractable 子类在此基础上增加状态机 + 颜色过渡。
  onPointerDown?(e: UIPointerEvent): void;
  onPointerMove?(e: UIPointerEvent): void;
  onPointerUp?(e: UIPointerEvent): void;
  onPointerClick?(e: UIPointerEvent): void;
  onPointerEnter?(e: UIPointerEvent): void;
  onPointerExit?(e: UIPointerEvent): void;
  onDrag?(e: UIDragEvent): void;
  onDragStart?(e: UIDragEvent): void;
  onDragEnd?(e: UIDragEvent): void;
  onKeyDown?(e: UIKeyEvent): void;
  onKeyUp?(e: UIKeyEvent): void;
  onFocus?(): void;
  onBlur?(): void;
}

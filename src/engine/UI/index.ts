// UI barrel — 游戏内 UI 系统 (Canvas / Widget / Layout / Input / Animation)。
//
// 仿照 o3de LyShine、UE5 UMG、Unity UI Toolkit 的统一 in-game UI 实现。
// 纯 CPU 布局/命中/动画逻辑,无 WebGL 依赖;渲染层消费 UIDrawCommand 绘制。
// 与 Core/Text、Core/Sprite 互补:Core 是 3D 空间原语,UI 是屏幕空间系统。

// 基础变换 (锚点 / 枢轴 / 偏移 / 尺寸)。
export {
  RectTransform,
  ANCHOR_PRESETS,
  type Anchors,
  type Offsets,
  type UIRect,
  type AnchorPreset,
} from './RectTransform';

// 元素基类 (层级 / 可见性 / 命中 / 生命周期)。
export { UIElement, type UIElementVisibility, type UIElementLifecycle } from './UIElement';

// 画布 (渲染模式 / 缩放 / 屏幕适配)。
export {
  UICanvas,
  DEFAULT_CANVAS_SCALER,
  HD_1080P_SCALER,
  type CanvasRenderMode,
  type CanvasScaleMode,
  type ScreenMatchOptions,
  type CanvasScalerConfig,
  type CanvasScreenInfo,
} from './UICanvas';

// 布局系统 (Horizontal / Vertical / Grid / ContentSizeFitter / LayoutElement)。
export {
  HorizontalLayoutGroup,
  VerticalLayoutGroup,
  GridLayoutGroup,
  ContentSizeFitter,
  LayoutElementPrefs,
  attachLayoutPrefs,
  getLayoutElement,
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutGroupOptions,
  type GridLayoutOptions,
  type ChildAlignment,
  type ILayoutElement,
  type LayoutAxis,
} from './UILayout';

// 显示控件 (UIText / UIImage / UIRawImage) + 颜色工具。
export {
  UIText,
  UIImage,
  UIRawImage,
  UIColors,
  type UIColor,
  type UITextAlignment,
  type UIVerticalAlignment,
  type UITextOverflow,
  type UIDrawCommand,
} from './UIPrimitives';

// 交互控件 (Button / Slider / Toggle / Dropdown)。
export {
  UIInteractable,
  UIButton,
  UISlider,
  UIToggle,
  UIDropdown,
  UIDropdownItem,
  getInteractableLayout,
  DEFAULT_COLOR_BLOCK,
  DEFAULT_TRANSITION,
  type InteractionState,
  type ColorBlock,
  type TransitionMode,
  type TransitionConfig,
} from './UIControls';

// 滚动视图。
export {
  UIScrollRect,
  type ScrollRectOptions,
  type ScrollDirection,
  type ScrollbarVisibility,
} from './UIScrollRect';

// 输入事件 (指针 / 键盘 / 焦点 / 拖拽)。
export {
  UIInputDispatcher,
  UIEvent,
  type UIPointerInput,
  type UIKeyInput,
  type UIPointerEvent,
  type UIKeyEvent,
  type UIDragEvent,
  type PointerButton,
  type IInteractable,
} from './UIInput';

// 动画系统 (Tween / 缓动 / 序列)。
export {
  UIAnimator,
  UITween,
  UISequence,
  Easing,
  type EaseFunction,
  type LoopMode,
  type TweenTarget,
} from './UIAnimator';

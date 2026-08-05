// UIControls —— 交互型控件 (Button / Slider / Toggle / Dropdown)。
//
// 仿照 o3de LyShine `UiButtonComponent` / `UiSliderInterface`、UE5 UMG
// `UButton` / `USlider` / `UCheckBox` / `UComboBox`、Unity `Button` /
// `Slider` / `Toggle` / `Dropdown`。这些控件:
//   * 实现 IInteractable 接口,接收 UIInputDispatcher 派发的事件。
//   * 内部组合显示子元素 (UIImage 背景 + UIText 标签)。
//   * 维护交互状态 (normal / hover / pressed / disabled / focused)。
//   * 触发业务回调 (onClick / onValueChanged)。
//
// 控件自带视觉状态机:根据交互状态切换颜色/缩放,无需用户手动管理。
// 用户只需设置 colors / transition 配置 + 业务回调。

import { UIElement } from './UIElement';
import { UIImage } from './UIPrimitives';
import { UIText } from './UIPrimitives';
import type { UIColor } from './UIPrimitives';
import type { IInteractable, UIPointerEvent, UIKeyEvent, UIDragEvent } from './UIInput';
import type { ILayoutElement } from './UILayout';

/** 交互状态。 */
export type InteractionState = 'normal' | 'hover' | 'pressed' | 'disabled' | 'focused';

/** 颜色块 (各状态颜色)。 */
export interface ColorBlock {
  normalColor: UIColor;
  hoverColor: UIColor;
  pressedColor: UIColor;
  disabledColor: UIColor;
  focusedColor: UIColor;
  /** 颜色过渡时长 (秒,0=立即)。 */
  fadeDuration: number;
  /** 倍率 (乘到颜色上)。 */
  colorMultiplier: number;
}

export const DEFAULT_COLOR_BLOCK: ColorBlock = {
  normalColor: { r: 1, g: 1, b: 1, a: 1 },
  hoverColor: { r: 0.95, g: 0.95, b: 0.95, a: 1 },
  pressedColor: { r: 0.8, g: 0.8, b: 0.8, a: 1 },
  disabledColor: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 },
  focusedColor: { r: 0.9, g: 0.95, b: 1, a: 1 },
  fadeDuration: 0.1,
  colorMultiplier: 1,
};

/** 过渡模式。 */
export type TransitionMode = 'none' | 'colorTint' | 'spriteSwap' | 'scale';

/** 过渡配置。 */
export interface TransitionConfig {
  mode: TransitionMode;
  /** Scale 模式:按下时缩放。 */
  pressedScale: { x: number; y: number };
  /** Scale 模式:hover 时缩放。 */
  hoverScale: { x: number; y: number };
}

export const DEFAULT_TRANSITION: TransitionConfig = {
  mode: 'colorTint',
  pressedScale: { x: 0.95, y: 0.95 },
  hoverScale: { x: 1.05, y: 1.05 },
};

/**
 * 可交互基类 —— 管理状态机 + 过渡 + 回调。
 * Button / Toggle / Slider 等继承此类。
 */
export abstract class UIInteractable extends UIElement implements IInteractable {
  /** 当前交互状态。 */
  state: InteractionState = 'normal';

  /** 是否可交互 (false 时进入 disabled 状态,不接收事件)。 */
  interactable: boolean = true;

  /** 颜色块。 */
  colors: ColorBlock = { ...DEFAULT_COLOR_BLOCK };

  /** 过渡配置。 */
  transition: TransitionConfig = { ...DEFAULT_TRANSITION };

  /** 目标图像 (颜色过渡作用对象,通常是背景图)。 */
  protected targetGraphic: UIImage | null = null;

  /** 业务回调。 */
  onClick?: (e: UIPointerEvent) => void;
  onValueChanged?: (value: number | boolean | string) => void;

  // IInteractable 默认实现 (子类可覆盖)。
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

  constructor(name: string) {
    super(name);
    this.isRaycastTarget = true;
  }

  /** 设置可交互性。 */
  setInteractable(v: boolean): void {
    this.interactable = v;
    this.state = v ? 'normal' : 'disabled';
    this.applyTransition();
  }

  /** 应用当前状态的视觉效果。 */
  protected applyTransition(): void {
    if (!this.targetGraphic) return;
    const c = this.getColorForState(this.state);
    this.targetGraphic.color = c;

    if (this.transition.mode === 'scale') {
      switch (this.state) {
        case 'pressed':
          this.transform.scale = { ...this.transition.pressedScale };
          break;
        case 'hover':
          this.transform.scale = { ...this.transition.hoverScale };
          break;
        default:
          this.transform.scale = { x: 1, y: 1 };
      }
    }
  }

  /** 获取状态对应颜色。 */
  protected getColorForState(state: InteractionState): UIColor {
    const cb = this.colors;
    let c: UIColor;
    switch (state) {
      case 'disabled': c = cb.disabledColor; break;
      case 'pressed': c = cb.pressedColor; break;
      case 'hover': c = cb.hoverColor; break;
      case 'focused': c = cb.focusedColor; break;
      default: c = cb.normalColor;
    }
    const m = cb.colorMultiplier;
    return { r: c.r * m, g: c.g * m, b: c.b * m, a: c.a * m };
  }

  /** 状态切换 (内部)。 */
  protected setState(s: InteractionState): void {
    if (!this.interactable && s !== 'disabled') return;
    this.state = s;
    this.applyTransition();
  }

  // 指针事件处理 (更新状态 + 触发业务回调)。
  protected handlePointerEnter(_e: UIPointerEvent): void {
    if (!this.interactable) return;
    if (this.state === 'pressed') return; // 按下时保持 pressed
    this.setState('hover');
  }

  protected handlePointerExit(_e: UIPointerEvent): void {
    if (!this.interactable) return;
    if (this.state === 'pressed') return;
    this.setState('normal');
  }

  protected handlePointerDown(_e: UIPointerEvent): void {
    if (!this.interactable) return;
    this.setState('pressed');
  }

  protected handlePointerUp(e: UIPointerEvent): void {
    if (!this.interactable) return;
    if (e.isInside) this.setState('hover');
    else this.setState('normal');
  }

  protected handlePointerClick(e: UIPointerEvent): void {
    if (!this.interactable) return;
    this.onClick?.(e);
  }
}

/**
 * UIButton —— 按钮 (背景图 + 文字标签 + 点击回调)。
 *
 * ```ts
 * const btn = new UIButton('start', 'Start Game');
 * btn.onClick = (e) => { console.log('clicked'); };
 * canvas.root.addChild(btn);
 * ```
 */
export class UIButton extends UIInteractable {
  override readonly type: string = 'UIButton';

  /** 背景图 (自动创建)。 */
  readonly background: UIImage;
  /** 标签文字 (自动创建)。 */
  readonly label: UIText;

  constructor(name: string = 'UIButton', text: string = '') {
    super(name);
    this.background = new UIImage(`${name}/bg`);
    this.background.transform.setAnchorPreset('stretchAll');
    this.background.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.background.isRaycastTarget = false; // 内部图形不参与命中,由按钮自身处理。
    this.targetGraphic = this.background;
    this.addChild(this.background);

    this.label = new UIText(`${name}/label`, text);
    this.label.transform.setAnchorPreset('stretchAll');
    this.label.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.label.alignment = 'center';
    this.label.verticalAlignment = 'middle';
    this.addChild(this.label);

    // 绑定指针事件到基类处理。
    this.onPointerEnter = (e) => this.handlePointerEnter(e);
    this.onPointerExit = (e) => this.handlePointerExit(e);
    this.onPointerDown = (e) => this.handlePointerDown(e);
    this.onPointerUp = (e) => this.handlePointerUp(e);
    this.onPointerClick = (e) => this.handlePointerClick(e);
  }

  /** 设置标签文本。 */
  setText(text: string): this {
    this.label.text = text;
    return this;
  }
}

/**
 * UISlider —— 滑块 (轨道 + 填充 + 手柄)。
 *
 * ```ts
 * const volume = new UISlider('volume');
 * volume.minValue = 0;
 * volume.maxValue = 100;
 * volume.value = 50;
 * volume.onValueChanged = (v) => { audio.gain = v / 100; };
 * ```
 */
export class UISlider extends UIInteractable {
  override readonly type: string = 'UISlider';

  /** 取值范围。 */
  minValue: number = 0;
  maxValue: number = 1;
  /** 当前值。 */
  value: number = 0;
  /** 是否为整数步进 (0=连续)。 */
  wholeNumbers: boolean = false;

  /** 方向。 */
  direction: 'leftToRight' | 'rightToLeft' | 'bottomToTop' | 'topToBottom' = 'leftToRight';

  /** 轨道背景 (自动创建)。 */
  readonly track: UIImage;
  /** 填充区 (自动创建)。 */
  readonly fill: UIImage;
  /** 手柄 (自动创建)。 */
  readonly handle: UIImage;

  constructor(name: string = 'UISlider') {
    super(name);
    this.colors.normalColor = { r: 0.2, g: 0.2, b: 0.25, a: 1 };
    this.colors.hoverColor = { r: 0.25, g: 0.25, b: 0.3, a: 1 };

    this.track = new UIImage(`${name}/track`);
    this.track.transform.setAnchorPreset('stretchAll');
    this.track.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.track.color = { r: 0.15, g: 0.15, b: 0.2, a: 1 };
    this.track.isRaycastTarget = false; // 内部图形不参与命中。
    this.addChild(this.track);

    this.fill = new UIImage(`${name}/fill`);
    this.fill.color = { r: 0.2, g: 0.6, b: 1, a: 1 };
    this.fill.isRaycastTarget = false;
    this.addChild(this.fill);

    this.handle = new UIImage(`${name}/handle`);
    this.handle.transform.setSize(20, 20);
    this.handle.color = { r: 1, g: 1, b: 1, a: 1 };
    this.handle.cornerRadius = 10;
    this.handle.isRaycastTarget = false;
    this.targetGraphic = this.handle;
    this.addChild(this.handle);

    // 拖拽手柄调整值。
    this.onPointerDown = (e) => {
      if (!this.interactable) return;
      this.setState('pressed');
      this.updateValueFromPointer(e.x, e.y);
    };
    this.onPointerUp = (e) => this.handlePointerUp(e);
    this.onDrag = (e) => {
      if (!this.interactable) return;
      this.updateValueFromPointer(e.x, e.y);
    };
    this.onPointerEnter = (e) => this.handlePointerEnter(e);
    this.onPointerExit = (e) => this.handlePointerExit(e);

    this.setValue(this.value);
  }

  /** 归一化值 [0,1]。 */
  get normalizedValue(): number {
    const range = this.maxValue - this.minValue;
    if (range === 0) return 0;
    return (this.value - this.minValue) / range;
  }

  /** 设置值 (会触发 onValueChanged)。 */
  setValue(v: number): void {
    let newVal = Math.max(this.minValue, Math.min(this.maxValue, v));
    if (this.wholeNumbers) newVal = Math.round(newVal);
    if (newVal !== this.value) {
      this.value = newVal;
      this.onValueChanged?.(newVal);
    }
    this.updateVisuals();
  }

  /** 根据指针位置更新值。 */
  private updateValueFromPointer(x: number, y: number): void {
    const r = this.worldRect;
    let t = 0;
    switch (this.direction) {
      case 'leftToRight':
        t = (x - r.x) / r.width;
        break;
      case 'rightToLeft':
        t = 1 - (x - r.x) / r.width;
        break;
      case 'bottomToTop':
        t = (y - r.y) / r.height;
        break;
      case 'topToBottom':
        t = 1 - (y - r.y) / r.height;
        break;
    }
    t = Math.max(0, Math.min(1, t));
    this.setValue(this.minValue + t * (this.maxValue - this.minValue));
  }

  /** 更新填充与手柄位置。 */
  private updateVisuals(): void {
    const t = this.normalizedValue;
    const horizontal = this.direction === 'leftToRight' || this.direction === 'rightToLeft';
    if (horizontal) {
      // 填充:从左/右开始,占 t 比例宽度。
      this.fill.transform.setAnchorPreset(this.direction === 'leftToRight' ? 'stretchLeft' : 'stretchRight');
      if (this.direction === 'leftToRight') {
        this.fill.transform.anchors = { minX: 0, minY: 0, maxX: t, maxY: 1 };
        this.fill.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
      } else {
        this.fill.transform.anchors = { minX: 1 - t, minY: 0, maxX: 1, maxY: 1 };
        this.fill.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
      }
      // 手柄:在 t 位置。
      const handleX = (this.direction === 'leftToRight' ? t : 1 - t) * r_width(this);
      this.handle.transform.anchors = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      this.handle.transform.offsets = {
        left: handleX - 10,
        bottom: -10,
        right: handleX + 10,
        top: 10,
      };
    } else {
      const fromBottom = this.direction === 'bottomToTop';
      this.fill.transform.anchors = fromBottom
        ? { minX: 0, minY: 0, maxX: 1, maxY: t }
        : { minX: 0, minY: 1 - t, maxX: 1, maxY: 1 };
      this.fill.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
      const handleY = (fromBottom ? t : 1 - t) * r_height(this);
      this.handle.transform.anchors = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      this.handle.transform.offsets = {
        left: -10,
        bottom: handleY - 10,
        right: 10,
        top: handleY + 10,
      };
    }
  }

  override onLayout(_width: number, _height: number): void {
    // 布局后重新计算手柄位置。
    this.updateVisuals();
  }
}

function r_width(s: UISlider): number {
  return s.worldRect.width;
}
function r_height(s: UISlider): number {
  return s.worldRect.height;
}

/**
 * UIToggle —— 复选框 (框 + 勾选标记 + 标签)。
 *
 * ```ts
 * const mute = new UIToggle('mute', 'Mute Audio');
 * mute.isOn = false;
 * mute.onValueChanged = (v) => { audio.muted = !v; };
 * ```
 */
export class UIToggle extends UIInteractable {
  override readonly type: string = 'UIToggle';

  /** 是否勾选。 */
  isOn: boolean = false;

  /** 复选框背景 (自动创建)。 */
  readonly checkbox: UIImage;
  /** 勾选标记 (勾选时显示)。 */
  readonly checkmark: UIImage;
  /** 标签文字。 */
  readonly label: UIText;

  constructor(name: string = 'UIToggle', text: string = '') {
    super(name);
    this.transform.setSize(200, 24);

    this.checkbox = new UIImage(`${name}/box`);
    this.checkbox.transform.setSize(24, 24);
    this.checkbox.transform.setAnchorPreset('middleLeft');
    this.checkbox.transform.offsets = { left: 0, bottom: -12, right: 24, top: 12 };
    this.checkbox.color = { r: 0.15, g: 0.15, b: 0.2, a: 1 };
    this.checkbox.borderWidth = 2;
    this.checkbox.borderColor = { r: 0.6, g: 0.6, b: 0.7, a: 1 };
    this.checkbox.isRaycastTarget = false;
    this.targetGraphic = this.checkbox;
    this.addChild(this.checkbox);

    this.checkmark = new UIImage(`${name}/check`);
    this.checkmark.transform.setAnchorPreset('stretchAll');
    this.checkmark.transform.offsets = { left: 4, bottom: 4, right: -4, top: -4 };
    this.checkmark.color = { r: 0.2, g: 0.9, b: 0.3, a: 1 };
    this.checkmark.isRaycastTarget = false;
    this.checkbox.addChild(this.checkmark);

    this.label = new UIText(`${name}/label`, text);
    this.label.transform.setAnchorPreset('stretchRight');
    this.label.transform.offsets = { left: 30, bottom: 0, right: 0, top: 0 };
    this.label.alignment = 'left';
    this.addChild(this.label);

    this.onPointerClick = (_e) => {
      if (!this.interactable) return;
      this.toggle();
    };
    this.onPointerEnter = (e) => this.handlePointerEnter(e);
    this.onPointerExit = (e) => this.handlePointerExit(e);

    this.updateVisuals();
  }

  /** 切换勾选状态。 */
  toggle(): void {
    this.isOn = !this.isOn;
    this.onValueChanged?.(this.isOn);
    this.updateVisuals();
  }

  /** 设置勾选状态 (不触发回调)。 */
  setOn(on: boolean, fireCallback: boolean = false): void {
    if (this.isOn === on) return;
    this.isOn = on;
    if (fireCallback) this.onValueChanged?.(on);
    this.updateVisuals();
  }

  private updateVisuals(): void {
    this.checkmark.visible = this.isOn;
  }
}

/**
 * UIDropdown —— 下拉选择框 (当前值 + 展开列表)。
 *
 * ```ts
 * const quality = new UIDropdown('quality');
 * quality.options = ['Low', 'Medium', 'High', 'Ultra'];
 * quality.value = 'Medium';
 * quality.onValueChanged = (v) => { settings.quality = v as string; };
 * ```
 */
export class UIDropdown extends UIInteractable {
  override readonly type: string = 'UIDropdown';

  /** 选项列表。 */
  options: string[] = [];
  /** 当前选中值。 */
  value: string = '';
  /** 是否展开下拉列表。 */
  isExpanded: boolean = false;

  /** 背景框 (自动创建)。 */
  readonly background: UIImage;
  /** 当前值标签。 */
  readonly caption: UIText;
  /** 下拉箭头。 */
  readonly arrow: UIText;
  /** 下拉列表容器 (展开时显示)。 */
  readonly list: UIElement;

  constructor(name: string = 'UIDropdown') {
    super(name);
    this.transform.setSize(160, 32);

    this.background = new UIImage(`${name}/bg`);
    this.background.transform.setAnchorPreset('stretchAll');
    this.background.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.background.color = { r: 0.15, g: 0.15, b: 0.2, a: 1 };
    this.background.borderWidth = 1;
    this.background.borderColor = { r: 0.5, g: 0.5, b: 0.6, a: 1 };
    this.background.isRaycastTarget = false;
    this.targetGraphic = this.background;
    this.addChild(this.background);

    this.caption = new UIText(`${name}/caption`, '');
    this.caption.transform.setAnchorPreset('stretchAll');
    this.caption.transform.offsets = { left: 8, bottom: 0, right: -24, top: 0 };
    this.caption.alignment = 'left';
    this.addChild(this.caption);

    this.arrow = new UIText(`${name}/arrow`, '▼');
    this.arrow.transform.setSize(16, 16);
    this.arrow.transform.setAnchorPreset('middleRight');
    this.arrow.transform.offsets = { left: -20, bottom: -8, right: -4, top: 8 };
    this.arrow.fontSize = 12;
    this.addChild(this.arrow);

    this.list = new UIElement(`${name}/list`);
    this.list.transform.setAnchorPreset('bottomStretch');
    this.list.transform.offsets = { left: 0, bottom: -100, right: 0, top: 0 };
    this.list.visible = false;
    this.addChild(this.list);

    this.onPointerClick = (_e) => {
      if (!this.interactable) return;
      this.toggleExpanded();
    };
    this.onPointerEnter = (e) => this.handlePointerEnter(e);
    this.onPointerExit = (e) => this.handlePointerExit(e);
  }

  /** 展开/收起列表。 */
  toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    this.list.visible = this.isExpanded;
    this.arrow.text = this.isExpanded ? '▲' : '▼';
    if (this.isExpanded) this.rebuildList();
  }

  /** 重建选项列表。 */
  private rebuildList(): void {
    this.list.removeAllChildren();
    const itemHeight = 28;
    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const item = new UIDropdownItem(`${this.name}/item-${i}`, opt, i);
      item.transform.setSize(160, itemHeight);
      item.transform.anchors = { minX: 0, minY: 1, maxX: 1, maxY: 1 };
      item.transform.offsets = {
        left: 0,
        bottom: -(i + 1) * itemHeight,
        right: 0,
        top: -i * itemHeight,
      };
      item.onSelect = (idx) => this.selectIndex(idx);
      this.list.addChild(item);
    }
  }

  /** 选中索引。 */
  selectIndex(idx: number): void {
    if (idx < 0 || idx >= this.options.length) return;
    const newVal = this.options[idx];
    if (newVal !== this.value) {
      this.value = newVal;
      this.caption.text = newVal;
      this.onValueChanged?.(newVal);
    }
    this.toggleExpanded();
  }

  /** 设置选项列表。 */
  setOptions(options: string[]): this {
    this.options = options;
    if (options.length > 0 && !options.includes(this.value)) {
      this.value = options[0];
      this.caption.text = this.value;
    }
    return this;
  }
}

/** 下拉选项 (内部使用)。 */
export class UIDropdownItem extends UIInteractable {
  override readonly type: string = 'UIDropdownItem';

  readonly bg: UIImage;
  readonly label: UIText;
  readonly index: number;
  onSelect?: (index: number) => void;

  constructor(name: string, text: string, index: number) {
    super(name);
    this.index = index;
    this.bg = new UIImage(`${name}/bg`);
    this.bg.transform.setAnchorPreset('stretchAll');
    this.bg.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    this.bg.color = { r: 0.15, g: 0.15, b: 0.2, a: 1 };
    this.targetGraphic = this.bg;
    this.addChild(this.bg);

    this.label = new UIText(`${name}/label`, text);
    this.label.transform.setAnchorPreset('stretchAll');
    this.label.transform.offsets = { left: 8, bottom: 0, right: -8, top: 0 };
    this.label.alignment = 'left';
    this.label.fontSize = 14;
    this.addChild(this.label);

    this.onPointerClick = (_e) => {
      this.onSelect?.(this.index);
    };
    this.onPointerEnter = (_e) => {
      if (!this.interactable) return;
      this.bg.color = { r: 0.25, g: 0.4, b: 0.8, a: 1 };
    };
    this.onPointerExit = (_e) => {
      this.bg.color = { r: 0.15, g: 0.15, b: 0.2, a: 1 };
    };
  }
}

/** 控件布局偏好 (可交互控件默认有尺寸)。 */
export function getInteractableLayout(el: UIInteractable): ILayoutElement {
  const sd = el.transform.sizeDelta;
  return {
    minWidth: 20,
    minHeight: 20,
    preferredWidth: Math.max(80, sd.x),
    preferredHeight: Math.max(24, sd.y),
    flexibleWidth: 0,
    flexibleHeight: 0,
  };
}

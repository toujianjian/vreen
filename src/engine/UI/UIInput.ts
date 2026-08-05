// UIInput —— UI 输入事件系统 (指针 / 键盘 / 焦点 / 拖拽)。
//
// 仿照 o3de LyShine `UiInteractableActions` / `UiNavigationHelpers`、
// UE5 UMG `FWidget` input + `FSlateApplication` routing、Unity
// `EventSystem` + `PointerInputModule`。职责:
//   * 指针事件路由 (pointerDown / move / up / click / enter / exit / drag)。
//   * 键盘事件路由 (keyDown / keyUp / tab 导航)。
//   * 焦点管理 (focus / blur / Tab 顺序)。
//   * 拖拽检测 (dragThreshold + drag 事件)。
//   * 活跃指针状态跟踪 (多指/多按钮)。
//
// 事件冒泡:默认「冒泡」(从命中元素向上到根),可 stopPropagation。
// 与 UICanvas.hitTest 配合:每帧/每次输入调用 hitTest 找到目标元素,
// 然后由 UIInputDispatcher 派发事件。
//
// 纯 CPU 逻辑,无 DOM 依赖 (渲染层负责把浏览器事件转换为 UIPointerInput)。

import type { UICanvas } from './UICanvas';
import type { UIElement } from './UIElement';

/** 指针按钮。 */
export type PointerButton = 'left' | 'right' | 'middle';

/** 指针输入事件 (渲染层 → UIInputDispatcher)。 */
export interface UIPointerInput {
  type: 'down' | 'move' | 'up';
  /** 屏幕坐标 (物理像素,左上角原点,与浏览器 pointer 事件一致)。 */
  x: number;
  y: number;
  button: PointerButton;
}

/** 键盘输入事件。 */
export interface UIKeyInput {
  type: 'down' | 'up';
  key: string;
  code: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** UI 事件冒泡控制。 */
export class UIEvent {
  /** 是否已请求停止冒泡。 */
  propagationStopped: boolean = false;
  /** 是否已请求停止默认处理。 */
  defaultPrevented: boolean = false;
  /** 命中目标。 */
  target: UIElement;
  /** 当前处理节点 (冒泡过程中变化)。 */
  currentTarget: UIElement;

  constructor(target: UIElement) {
    this.target = target;
    this.currentTarget = target;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

/** 指针事件详情。 */
export interface UIPointerEvent {
  /** 事件控制 (冒泡)。 */
  uiEvent: UIEvent;
  /** 逻辑像素坐标 (已由 canvas 转换,Y 向上)。 */
  x: number;
  y: number;
  /** 相对目标的本地坐标 (目标左下角为原点)。 */
  localX: number;
  localY: number;
  button: PointerButton;
  /** 是否在目标元素内 (move/enter/exit 判断用)。 */
  isInside: boolean;
}

/** 键盘事件详情。 */
export interface UIKeyEvent {
  uiEvent: UIEvent;
  key: string;
  code: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** 拖拽事件详情。 */
export interface UIDragEvent {
  uiEvent: UIEvent;
  /** 拖拽起始逻辑坐标。 */
  startX: number;
  startY: number;
  /** 当前逻辑坐标。 */
  x: number;
  y: number;
  /** 位移增量 (自上一帧)。 */
  deltaX: number;
  deltaY: number;
  button: PointerButton;
}

/**
 * 可交互接口 —— 元素若要接收指针事件,需实现这些方法。
 * UIElement 默认无事件处理;子类 (UIButton 等) 混入这些方法。
 */
export interface IInteractable {
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

/** 指针状态跟踪 (单个指针)。 */
interface PointerState {
  /** 按下时的命中元素 (capture 目标)。 */
  pressedTarget: UIElement | null;
  /** 当前 hover 元素。 */
  hoverTarget: UIElement | null;
  /** 按下时逻辑坐标。 */
  pressX: number;
  pressY: number;
  /** 上一帧逻辑坐标。 */
  lastX: number;
  lastY: number;
  /** 是否正在拖拽。 */
  dragging: boolean;
  /** 拖拽目标 (通常 = pressedTarget)。 */
  dragTarget: UIElement | null;
}

/**
 * UIInputDispatcher —— 事件派发器。
 *
 * 每帧由渲染层调用:
 *   dispatcher.processPointer(canvas, input)
 *   dispatcher.processKeyboard(canvas, keyInput)
 *
 * ```ts
 * const dispatcher = new UIInputDispatcher();
 * dispatcher.attachToCanvas(canvas);
 * // 渲染层收到 pointerdown:
 * dispatcher.processPointer(canvas, { type: 'down', x, y, button: 'left' });
 * ```
 */
export class UIInputDispatcher {
  /** 指针拖拽阈值 (像素,超过才触发 drag)。 */
  dragThreshold: number = 5;

  /** 当前焦点元素 (null = 无)。 */
  focused: UIElement | null = null;

  /** 是否启用 Tab 导航。 */
  navigationEnabled: boolean = true;

  /** 按钮索引顺序 (Tab 时按渲染顺序)。 */
  private pointerStates: Map<PointerButton, PointerState> = new Map();

  /** 附加到的画布 (用于 Tab 导航遍历)。 */
  private canvas: UICanvas | null = null;

  attachToCanvas(canvas: UICanvas): void {
    this.canvas = canvas;
  }

  /** 获取/创建指针状态。 */
  private getPointerState(button: PointerButton): PointerState {
    let s = this.pointerStates.get(button);
    if (!s) {
      s = {
        pressedTarget: null,
        hoverTarget: null,
        pressX: 0,
        pressY: 0,
        lastX: 0,
        lastY: 0,
        dragging: false,
        dragTarget: null,
      };
      this.pointerStates.set(button, s);
    }
    return s;
  }

  /**
   * 处理指针输入。
   * 返回命中的目标元素 (null = 未命中任何可交互元素)。
   */
  processPointer(canvas: UICanvas, input: UIPointerInput): UIElement | null {
    const state = this.getPointerState(input.button);
    // 物理 → 逻辑坐标 (与 canvas.hitTest 内部一致)。
    const scaleFactor = canvas.scaleFactor || 1;
    const logicalX = input.x / scaleFactor;
    const logicalY = (canvas.screenInfo.height / scaleFactor) - (input.y / scaleFactor);

    const hit = canvas.root.raycast(logicalX, logicalY);

    switch (input.type) {
      case 'down': {
        state.pressedTarget = hit;
        state.pressX = logicalX;
        state.pressY = logicalY;
        state.lastX = logicalX;
        state.lastY = logicalY;
        state.dragging = false;
        state.dragTarget = hit;

        if (hit) {
          // 聚焦命中元素 (若可聚焦)。
          this.focus(hit);
          this.bubblePointer(hit, 'onPointerDown', logicalX, logicalY, input.button, canvas, true);
        } else {
          // 点击空白处取消焦点。
          this.blur();
        }
        return hit;
      }

      case 'move': {
        // hover enter/exit 检测。
        if (hit !== state.hoverTarget) {
          if (state.hoverTarget) {
            this.bubblePointer(state.hoverTarget, 'onPointerExit', logicalX, logicalY, input.button, canvas, false);
          }
          state.hoverTarget = hit;
          if (hit) {
            this.bubblePointer(hit, 'onPointerEnter', logicalX, logicalY, input.button, canvas, true);
          }
        } else if (hit) {
          // 仍在同一元素内,触发 move。
          this.bubblePointer(hit, 'onPointerMove', logicalX, logicalY, input.button, canvas, true);
        }

        // 拖拽检测。
        if (state.pressedTarget && !state.dragging) {
          const dx = logicalX - state.pressX;
          const dy = logicalY - state.pressY;
          if (Math.sqrt(dx * dx + dy * dy) > this.dragThreshold) {
            state.dragging = true;
            this.bubbleDrag(state.pressedTarget, 'onDragStart', state.pressX, state.pressY, logicalX, logicalY, 0, 0, input.button);
          }
        }
        if (state.dragging && state.pressedTarget) {
          const deltaX = logicalX - state.lastX;
          const deltaY = logicalY - state.lastY;
          this.bubbleDrag(state.pressedTarget, 'onDrag', state.pressX, state.pressY, logicalX, logicalY, deltaX, deltaY, input.button);
        }

        state.lastX = logicalX;
        state.lastY = logicalY;
        return hit;
      }

      case 'up': {
        if (state.pressedTarget) {
          const target = state.pressedTarget;
          // 若在目标内松开 → click。
          const inside = target.hitTest(logicalX, logicalY);
          this.bubblePointer(target, 'onPointerUp', logicalX, logicalY, input.button, canvas, inside);

          if (state.dragging) {
            this.bubbleDrag(target, 'onDragEnd', state.pressX, state.pressY, logicalX, logicalY, 0, 0, input.button);
          } else if (inside) {
            // click = down + up 在同一元素内且未拖拽。
            this.bubblePointer(target, 'onPointerClick', logicalX, logicalY, input.button, canvas, true);
          }
        }
        state.pressedTarget = null;
        state.dragging = false;
        state.dragTarget = null;
        return hit;
      }
    }
    return hit;
  }

  /**
   * 处理键盘输入。事件派发给当前焦点元素 (冒泡)。
   */
  processKeyboard(_canvas: UICanvas, input: UIKeyInput): void {
    if (!this.focused) {
      // 无焦点时,Tab 尝试聚焦第一个可交互元素。
      if (this.navigationEnabled && input.type === 'down' && input.key === 'Tab') {
        this.tabNext();
      }
      return;
    }

    const event = new UIEvent(this.focused);
    const keyEvent: UIKeyEvent = {
      uiEvent: event,
      key: input.key,
      code: input.code,
      shift: input.shift,
      ctrl: input.ctrl,
      alt: input.alt,
    };

    if (input.type === 'down') {
      this.bubbleKey(this.focused, 'onKeyDown', keyEvent);
      // Tab 导航。
      if (this.navigationEnabled && input.key === 'Tab' && !event.defaultPrevented) {
        if (input.shift) this.tabPrev();
        else this.tabNext();
      }
    } else {
      this.bubbleKey(this.focused, 'onKeyUp', keyEvent);
    }
  }

  /** 聚焦元素。 */
  focus(el: UIElement): void {
    if (this.focused === el) return;
    if (this.focused) {
      this.bubbleSimple(this.focused, 'onBlur');
    }
    this.focused = el;
    this.bubbleSimple(el, 'onFocus');
  }

  /** 取消焦点。 */
  blur(): void {
    if (!this.focused) return;
    this.bubbleSimple(this.focused, 'onBlur');
    this.focused = null;
  }

  /** Tab 到下一个可交互元素。 */
  tabNext(): void {
    const targets = this.canvas ? this.canvas.collectRaycastTargets() : [];
    if (targets.length === 0) return;
    if (!this.focused) {
      this.focus(targets[0]);
      return;
    }
    const idx = targets.indexOf(this.focused);
    const next = targets[(idx + 1) % targets.length];
    this.focus(next);
  }

  /** Tab 到上一个可交互元素。 */
  tabPrev(): void {
    const targets = this.canvas ? this.canvas.collectRaycastTargets() : [];
    if (targets.length === 0) return;
    if (!this.focused) {
      this.focus(targets[targets.length - 1]);
      return;
    }
    const idx = targets.indexOf(this.focused);
    const prev = targets[(idx - 1 + targets.length) % targets.length];
    this.focus(prev);
  }

  // ---- 内部:事件冒泡 ----

  private bubblePointer(
    target: UIElement,
    method: keyof IInteractable,
    x: number,
    y: number,
    button: PointerButton,
    _canvas: UICanvas,
    isInside: boolean,
  ): void {
    const event = new UIEvent(target);
    const pe: UIPointerEvent = {
      uiEvent: event,
      x,
      y,
      localX: x - target.worldRect.x,
      localY: y - target.worldRect.y,
      button,
      isInside,
    };
    let current: UIElement | null = target;
    while (current && !event.propagationStopped) {
      event.currentTarget = current;
      const handler = (current as IInteractable)[method] as ((e: UIPointerEvent) => void) | undefined;
      if (typeof handler === 'function') handler.call(current, pe);
      current = current.parent;
    }
  }

  private bubbleDrag(
    target: UIElement,
    method: keyof IInteractable,
    startX: number,
    startY: number,
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    button: PointerButton,
  ): void {
    const event = new UIEvent(target);
    const de: UIDragEvent = {
      uiEvent: event,
      startX,
      startY,
      x,
      y,
      deltaX,
      deltaY,
      button,
    };
    let current: UIElement | null = target;
    while (current && !event.propagationStopped) {
      event.currentTarget = current;
      const handler = (current as IInteractable)[method] as ((e: UIDragEvent) => void) | undefined;
      if (typeof handler === 'function') handler.call(current, de);
      current = current.parent;
    }
  }

  private bubbleKey(target: UIElement, method: keyof IInteractable, keyEvent: UIKeyEvent): void {
    let current: UIElement | null = target;
    while (current && !keyEvent.uiEvent.propagationStopped) {
      keyEvent.uiEvent.currentTarget = current;
      const handler = (current as IInteractable)[method] as ((e: UIKeyEvent) => void) | undefined;
      if (typeof handler === 'function') handler.call(current, keyEvent);
      current = current.parent;
    }
  }

  private bubbleSimple(target: UIElement, method: 'onFocus' | 'onBlur'): void {
    let current: UIElement | null = target;
    while (current) {
      const handler = (current as IInteractable)[method] as (() => void) | undefined;
      if (typeof handler === 'function') handler.call(current);
      current = current.parent;
    }
  }
}

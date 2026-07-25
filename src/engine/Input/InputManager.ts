// InputManager — 输入管理器:统一管理键盘 / 鼠标 / 触摸 / 手柄输入。
//
// 职责:
//   - attach(domElement):绑定 DOM 事件监听器,把原生事件转换为
//     KeyboardState / MouseState / TouchState / GamepadState 的状态变更;
//   - update():每帧调用,推进各 state 的帧末清理 + 手柄轮询;
//   - setEnabled(false):暂停输入采集 (事件处理器短路),但 update() 仍
//     清理 per-frame 缓冲,避免重新启用时残留陈旧的 pressed 标记。
//
// 与 InputMap 的关系:InputManager 不持有 InputMap —— 用户自建 InputMap
// 并在每帧调用 map.update(inputManager) 即可。二者通过 InputStateProvider
// 接口解耦,避免循环引用。
//
// 测试 / Node 环境:DOM 事件由调用方 mock;GamepadState 在无
// navigator.getGamepads 时退化为「未连接」,不抛错。

import { createLogger } from '@/lib/logger';
import { KeyboardState } from './KeyboardState';
import { MouseState } from './MouseState';
import { TouchState } from './TouchState';
import { GamepadState } from './GamepadState';

const log = createLogger('InputManager');

/** InputManager 构造选项。 */
export interface InputManagerOptions {
  /** 触摸最大点数,默认 5。 */
  maxTouches?: number;
  /** 手柄死区,默认 0.1。 */
  gamepadDeadzone?: number;
  /** 是否在 touchmove / wheel 时 preventDefault (避免页面滚动),默认 true。 */
  preventDefaultTouch?: boolean;
  /** 是否在 wheel 时 preventDefault,默认 true。 */
  preventDefaultWheel?: boolean;
}

/** 已注册的事件监听器记录,便于 detach。 */
interface RegisteredListener {
  target: EventTarget;
  type: string;
  handler: EventListenerOrEventListenerObject;
}

export class InputManager {
  readonly keyboard: KeyboardState = new KeyboardState();
  readonly mouse: MouseState = new MouseState();
  readonly touch: TouchState;
  readonly gamepad: GamepadState;
  /** 是否启用输入采集。 */
  enabled: boolean = true;

  private _element: HTMLElement | null = null;
  private _listeners: RegisteredListener[] = [];
  private _preventDefaultTouch: boolean;
  private _preventDefaultWheel: boolean;

  constructor(opts: InputManagerOptions = {}) {
    this.touch = new TouchState(opts.maxTouches ?? 5);
    this.gamepad = new GamepadState(opts.gamepadDeadzone ?? 0.1);
    this._preventDefaultTouch = opts.preventDefaultTouch ?? true;
    this._preventDefaultWheel = opts.preventDefaultWheel ?? true;
  }

  /** 当前是否已 attach 到 DOM 元素。 */
  isAttached(): boolean {
    return this._element !== null;
  }

  /** 是否启用。 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** 启用 / 禁用输入采集。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      // 禁用时清空按下状态,避免「禁用期间一直按住」的残留
      this.keyboard.reset();
      this.mouse.reset();
      this.touch.reset();
    }
    log.info(`setEnabled(${enabled})`);
  }

  /**
   * 绑定到 DOM 元素,开始采集输入。
   *
   * 键盘事件绑到 domElement (需 focusable);若需全局键盘,可传 window
   * 或 document。鼠标 / 触摸 / 滚轮绑到 domElement。
   *
   * 重复 attach 会先 detach 旧的。
   */
  attach(domElement: HTMLElement): void {
    if (this._element === domElement) return;
    if (this._element) this.detach();
    this._element = domElement;
    this._add(domElement, 'keydown', this._onKeyDown);
    this._add(domElement, 'keyup', this._onKeyUp);
    this._add(domElement, 'mousedown', this._onMouseDown);
    this._add(domElement, 'mouseup', this._onMouseUp);
    this._add(domElement, 'mousemove', this._onMouseMove);
    this._add(domElement, 'wheel', this._onWheel);
    this._add(domElement, 'touchstart', this._onTouchStart);
    this._add(domElement, 'touchmove', this._onTouchMove);
    this._add(domElement, 'touchend', this._onTouchEnd);
    this._add(domElement, 'touchcancel', this._onTouchCancel);
    log.info('attach — listeners bound');
  }

  /** 解绑所有监听器。 */
  detach(): void {
    if (!this._element) return;
    for (const { target, type, handler } of this._listeners) {
      target.removeEventListener(type, handler);
    }
    this._listeners = [];
    this._element = null;
    this.keyboard.reset();
    this.mouse.reset();
    this.touch.reset();
    log.info('detach — listeners removed');
  }

  /**
   * 每帧调用 —— 推进各 state 的帧末清理 + 手柄轮询。
   *
   * 即使 enabled=false 也会调用,以清理 per-frame 缓冲;
   * 但 enabled=false 时手柄轮询跳过 (反正事件被短路)。
   */
  update(): void {
    if (this.enabled) {
      this.gamepad.poll();
    }
    this.keyboard.update();
    this.mouse.update();
    this.touch.update();
    this.gamepad.update();
  }

  // ── 事件处理器 (箭头函数,绑定 this) ─────────────────────────

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    this.keyboard.press(e.code);
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    this.keyboard.release(e.code);
  };

  private _onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    this._updateMousePos(e);
    this.mouse.press(e.button);
  };

  private _onMouseUp = (e: MouseEvent): void => {
    if (!this.enabled) return;
    this._updateMousePos(e);
    this.mouse.release(e.button);
  };

  private _onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    this._updateMousePos(e);
  };

  private _onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    this.mouse.scroll(e.deltaY);
    if (this._preventDefaultWheel) e.preventDefault();
  };

  private _onTouchStart = (e: TouchEvent): void => {
    if (!this.enabled) return;
    if (this._preventDefaultTouch) e.preventDefault();
    for (const t of this._iterTouches(e.changedTouches)) {
      const { x, y } = this._touchPos(t);
      this.touch.begin(t.identifier, x, y);
    }
  };

  private _onTouchMove = (e: TouchEvent): void => {
    if (!this.enabled) return;
    if (this._preventDefaultTouch) e.preventDefault();
    for (const t of this._iterTouches(e.changedTouches)) {
      const { x, y } = this._touchPos(t);
      this.touch.move(t.identifier, x, y);
    }
  };

  private _onTouchEnd = (e: TouchEvent): void => {
    if (!this.enabled) return;
    if (this._preventDefaultTouch) e.preventDefault();
    for (const t of this._iterTouches(e.changedTouches)) {
      this.touch.end(t.identifier);
    }
  };

  private _onTouchCancel = (e: TouchEvent): void => {
    if (!this.enabled) return;
    for (const t of this._iterTouches(e.changedTouches)) {
      this.touch.cancel(t.identifier);
    }
  };

  // ── 辅助 ────────────────────────────────────────────────────

  /** 注册一个监听器并记录,便于 detach。 */
  private _add(
    target: EventTarget,
    type: string,
    handler: (e: never) => void,
  ): void {
    const h = handler as EventListenerOrEventListenerObject;
    target.addEventListener(type, h);
    this._listeners.push({ target, type, handler: h });
  }

  /** 把 MouseEvent 的 clientX/Y 转为元素相对坐标。 */
  private _updateMousePos(e: MouseEvent): void {
    const { x, y } = this._clientToElement(e.clientX, e.clientY);
    this.mouse.move(x, y);
  }

  /** 把 Touch 的 clientX/Y 转为元素相对坐标。 */
  private _touchPos(t: Touch): { x: number; y: number } {
    return this._clientToElement(t.clientX, t.clientY);
  }

  /** client 坐标 → 元素相对坐标;无 getBoundingClientRect 时直接返回 client 坐标。 */
  private _clientToElement(clientX: number, clientY: number): { x: number; y: number } {
    const el = this._element as HTMLElement & {
      getBoundingClientRect?: () => { left: number; top: number };
    };
    if (el && typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    }
    return { x: clientX, y: clientY };
  }

  /** 遍历 TouchList (兼容真实 DOM TouchList 与 mock 数组)。 */
  private *_iterTouches(list: TouchList | Touch[]): IterableIterator<Touch> {
    const len = (list as Touch[]).length;
    for (let i = 0; i < len; i++) {
      yield (list as Touch[])[i];
    }
  }
}

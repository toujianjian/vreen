// InputAction — 输入动作:将物理输入 (键盘/鼠标/手柄) 映射到逻辑动作。
//
// 一个 InputAction 持有多个 InputBinding,每帧 evaluate() 时遍历所有
// binding,聚合出 value (0..1, 或 -1..1 轴值) 与 pressed (本帧是否刚触发)。
//
// 聚合规则:
//   - pressed = 任一 binding 本帧刚触发 → true
//   - value   = 所有 binding 中绝对值最大的那个 (保留符号),让最强输入胜出
//
// 典型用法:
//   const jump = new InputAction('jump');
//   jump.addBinding({ type: 'keyboard', code: 'Space' });
//   jump.addBinding({ type: 'gamepad', button: 0 });
//   // 每帧:
//   jump.evaluate(inputManager);
//   if (jump.isPressed()) player.jump();

import type { KeyboardState } from './KeyboardState';
import type { MouseState } from './MouseState';
import type { GamepadState } from './GamepadState';
import type { TouchState } from './TouchState';

/** 输入源类型。 */
export type InputBindingType = 'keyboard' | 'mouse' | 'gamepad';

/**
 * 输入绑定 —— 描述一个物理输入如何贡献到动作。
 *
 * - keyboard: `code` (KeyboardEvent.code,如 'KeyW')
 * - mouse:    `button` (MouseEvent.button,0=左,1=中,2=右)
 * - gamepad:  `button` (按钮索引) 或 `axis` (轴索引) 二选一
 */
export interface InputBinding {
  type: InputBindingType;
  /** keyboard 时的键码 (KeyboardEvent.code)。 */
  code?: string;
  /** mouse / gamepad 时的按钮索引。 */
  button?: number;
  /** gamepad 时的轴索引 (与 button 互斥)。 */
  axis?: number;
  /** gamepad 轴被视为「按下」的阈值 (|axis| > threshold),默认 0.5。 */
  axisThreshold?: number;
}

/**
 * 输入状态提供者契约 —— InputManager 结构性地满足此接口。
 *
 * InputAction / InputMap 通过此接口读取输入,避免直接依赖 InputManager
 * 类造成循环引用。
 */
export interface InputStateProvider {
  readonly keyboard: KeyboardState;
  readonly mouse: MouseState;
  readonly touch: TouchState;
  readonly gamepad: GamepadState;
}

export class InputAction {
  /** 动作名 (与 InputMap 中的 key 对应)。 */
  readonly name: string;
  /** 绑定列表。 */
  readonly bindings: InputBinding[] = [];
  /** 当前评估值 (0..1 或 -1..1)。每帧 evaluate() 更新。 */
  value: number = 0;
  /** 本帧是否刚触发。每帧 evaluate() 更新。 */
  pressed: boolean = false;

  constructor(name: string, bindings: InputBinding[] = []) {
    this.name = name;
    for (const b of bindings) this.bindings.push({ ...b });
  }

  /** 添加一个绑定。返回 this 以便链式调用。 */
  addBinding(binding: InputBinding): this {
    this.bindings.push({ ...binding });
    return this;
  }

  /** 移除所有绑定。 */
  clearBindings(): void {
    this.bindings.length = 0;
  }

  /**
   * 评估当前值 —— 读取 input 状态,更新 value / pressed。
   *
   * 每帧调用一次 (通常由 InputMap.update 间接调用)。
   */
  evaluate(input: InputStateProvider): void {
    let value = 0;
    let pressed = false;
    for (const b of this.bindings) {
      const r = this._evaluateBinding(b, input);
      if (r.pressed) pressed = true;
      if (Math.abs(r.value) > Math.abs(value)) value = r.value;
    }
    this.value = value;
    this.pressed = pressed;
  }

  /** 本帧是否刚触发 (evaluate 后调用)。 */
  isPressed(): boolean {
    return this.pressed;
  }

  /** 当前值 (0..1 或 -1..1)。 */
  getValue(): number {
    return this.value;
  }

  /** 评估单个 binding,返回 { value, pressed }。 */
  private _evaluateBinding(
    b: InputBinding,
    input: InputStateProvider,
  ): { value: number; pressed: boolean } {
    switch (b.type) {
      case 'keyboard': {
        const code = b.code ?? '';
        return {
          value: input.keyboard.isDown(code) ? 1 : 0,
          pressed: input.keyboard.isPressed(code),
        };
      }
      case 'mouse': {
        const btn = b.button ?? 0;
        return {
          value: input.mouse.isButtonDown(btn) ? 1 : 0,
          pressed: input.mouse.isButtonPressed(btn),
        };
      }
      case 'gamepad': {
        if (b.axis !== undefined) {
          const v = input.gamepad.getAxis(b.axis);
          const thr = b.axisThreshold ?? 0.5;
          return { value: v, pressed: Math.abs(v) > thr };
        }
        const btn = b.button ?? 0;
        return {
          value: input.gamepad.getTrigger(btn),
          pressed: input.gamepad.isButtonDown(btn),
        };
      }
      default:
        return { value: 0, pressed: false };
    }
  }
}

// InputAction 测试 — 输入动作映射。
//
// 验证:
//   • keyboard / mouse / gamepad(button) / gamepad(axis) 绑定评估
//   • 多绑定聚合:pressed=OR, value=最大绝对值
//   • addBinding 链式 / clearBindings
//   • evaluate 更新 value / pressed,isPressed / getValue 读取
import { describe, it, expect } from 'vitest';
import { InputAction, type InputBinding, type InputStateProvider } from './InputAction';
import { KeyboardState } from './KeyboardState';
import { MouseState } from './MouseState';
import { TouchState } from './TouchState';
import { GamepadState } from './GamepadState';

/** 构造可控的 InputStateProvider mock。 */
function makeProvider(overrides: Partial<{
  keyboard: KeyboardState;
  mouse: MouseState;
  touch: TouchState;
  gamepad: GamepadState;
}> = {}): InputStateProvider {
  return {
    keyboard: overrides.keyboard ?? new KeyboardState(),
    mouse: overrides.mouse ?? new MouseState(),
    touch: overrides.touch ?? new TouchState(),
    gamepad: overrides.gamepad ?? new GamepadState(),
  };
}

describe('InputAction — 键盘绑定', () => {
  it('按下时 value=1, pressed=true', () => {
    const kb = new KeyboardState();
    kb.press('Space');
    const a = new InputAction('jump', [{ type: 'keyboard', code: 'Space' }]);
    a.evaluate(makeProvider({ keyboard: kb }));
    expect(a.getValue()).toBe(1);
    expect(a.isPressed()).toBe(true);
  });

  it('持续按住:第二帧 pressed=false (KeyboardState.update 后)', () => {
    const kb = new KeyboardState();
    kb.press('Space');
    const a = new InputAction('jump', [{ type: 'keyboard', code: 'Space' }]);
    const p = makeProvider({ keyboard: kb });
    a.evaluate(p);
    expect(a.isPressed()).toBe(true);
    kb.update(); // 帧末
    a.evaluate(p);
    expect(a.getValue()).toBe(1); // 仍按住
    expect(a.isPressed()).toBe(false); // 但非本帧刚按下
  });

  it('未按下时 value=0, pressed=false', () => {
    const a = new InputAction('jump', [{ type: 'keyboard', code: 'Space' }]);
    a.evaluate(makeProvider());
    expect(a.getValue()).toBe(0);
    expect(a.isPressed()).toBe(false);
  });
});

describe('InputAction — 鼠标绑定', () => {
  it('鼠标按钮按下时 value=1, pressed=true', () => {
    const m = new MouseState();
    m.press(0);
    const a = new InputAction('fire', [{ type: 'mouse', button: 0 }]);
    a.evaluate(makeProvider({ mouse: m }));
    expect(a.getValue()).toBe(1);
    expect(a.isPressed()).toBe(true);
  });

  it('右键 button=2', () => {
    const m = new MouseState();
    m.press(2);
    const a = new InputAction('aim', [{ type: 'mouse', button: 2 }]);
    a.evaluate(makeProvider({ mouse: m }));
    expect(a.getValue()).toBe(1);
    expect(a.isPressed()).toBe(true);
  });
});

describe('InputAction — 手柄绑定', () => {
  it('button 索引:value 取 trigger, pressed 取 isButtonDown', () => {
    const g = new GamepadState();
    g.connected = true;
    g.buttons = [
      { pressed: true, touched: true, value: 1 },
      { pressed: false, touched: false, value: 0 },
    ];
    const a = new InputAction('jump', [{ type: 'gamepad', button: 0 }]);
    a.evaluate(makeProvider({ gamepad: g }));
    expect(a.getValue()).toBe(1);
    expect(a.isPressed()).toBe(true);
  });

  it('axis 索引:value 取轴值 (应用死区), pressed 超过阈值', () => {
    const g = new GamepadState(0.1);
    g.connected = true;
    g.axes = new Float32Array([0.8, -0.3]);
    const a = new InputAction('moveX', [{ type: 'gamepad', axis: 0, axisThreshold: 0.5 }]);
    a.evaluate(makeProvider({ gamepad: g }));
    expect(a.getValue()).toBeCloseTo(0.8, 5);
    expect(a.isPressed()).toBe(true); // |0.8| > 0.5
  });

  it('axis 未超阈值时 pressed=false', () => {
    const g = new GamepadState(0.1);
    g.connected = true;
    g.axes = new Float32Array([0.3]);
    const a = new InputAction('moveX', [{ type: 'gamepad', axis: 0, axisThreshold: 0.5 }]);
    a.evaluate(makeProvider({ gamepad: g }));
    expect(a.getValue()).toBeCloseTo(0.3, 5);
    expect(a.isPressed()).toBe(false);
  });

  it('axis 在死区内时 value=0', () => {
    const g = new GamepadState(0.2);
    g.connected = true;
    g.axes = new Float32Array([0.15]);
    const a = new InputAction('moveX', [{ type: 'gamepad', axis: 0 }]);
    a.evaluate(makeProvider({ gamepad: g }));
    expect(a.getValue()).toBe(0);
  });
});

describe('InputAction — 多绑定聚合', () => {
  it('pressed = 任一绑定本帧触发', () => {
    const kb = new KeyboardState();
    kb.press('Space');
    const a = new InputAction('jump', [
      { type: 'keyboard', code: 'Space' },
      { type: 'keyboard', code: 'Enter' },
    ]);
    a.evaluate(makeProvider({ keyboard: kb }));
    expect(a.isPressed()).toBe(true);
  });

  it('value = 最大绝对值 (保留符号)', () => {
    const g = new GamepadState(0.1);
    g.connected = true;
    g.axes = new Float32Array([0.8, -0.4]);
    const a = new InputAction('move', [
      { type: 'gamepad', axis: 1 }, // -0.4
      { type: 'gamepad', axis: 0 }, // 0.8
    ]);
    a.evaluate(makeProvider({ gamepad: g }));
    expect(a.getValue()).toBeCloseTo(0.8, 5);
  });

  it('键盘 + 手柄组合:键盘按下 value=1, 胜过手柄轴 0', () => {
    const kb = new KeyboardState();
    kb.press('KeyD');
    const g = new GamepadState(0.1);
    g.connected = true;
    g.axes = new Float32Array([0]);
    const a = new InputAction('right', [
      { type: 'keyboard', code: 'KeyD' },
      { type: 'gamepad', axis: 0 },
    ]);
    a.evaluate(makeProvider({ keyboard: kb, gamepad: g }));
    expect(a.getValue()).toBe(1);
    expect(a.isPressed()).toBe(true);
  });
});

describe('InputAction — 绑定管理', () => {
  it('addBinding 链式追加', () => {
    const a = new InputAction('jump');
    expect(a.bindings).toHaveLength(0);
    const ret = a.addBinding({ type: 'keyboard', code: 'Space' });
    expect(ret).toBe(a); // 链式
    a.addBinding({ type: 'mouse', button: 0 });
    expect(a.bindings).toHaveLength(2);
  });

  it('构造时传入的 bindings 被复制 (不共享引用)', () => {
    const input: InputBinding[] = [{ type: 'keyboard', code: 'Space' }];
    const a = new InputAction('jump', input);
    a.addBinding({ type: 'mouse', button: 0 });
    expect(input).toHaveLength(1); // 原数组未被污染
  });

  it('clearBindings 清空', () => {
    const a = new InputAction('jump', [{ type: 'keyboard', code: 'Space' }]);
    a.clearBindings();
    expect(a.bindings).toHaveLength(0);
    a.evaluate(makeProvider());
    expect(a.getValue()).toBe(0);
    expect(a.isPressed()).toBe(false);
  });
});

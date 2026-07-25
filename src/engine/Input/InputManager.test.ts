// InputManager 测试 — 输入管理器。
//
// 验证:
//   • attach / detach / isAttached
//   • isEnabled / setEnabled
//   • 键盘事件 → KeyboardState
//   • 鼠标事件 → MouseState (含坐标转换)
//   • 触摸事件 → TouchState (多点)
//   • update 清理 per-frame 缓冲 + 手柄轮询
//   • setEnabled(false) 短路事件处理
//
// 测试环境 (node, 无真实 DOM) 使用 MockElement 模拟 addEventListener /
// removeEventListener / dispatchEvent / getBoundingClientRect。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from './InputManager';

/**
 * Mock DOM 元素 —— 记录所有 addEventListener 注册的 handler,
 * 并通过 dispatch(type, event) 触发对应 handler。
 */
class MockElement {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  style: Record<string, string> = {};
  private _rect = { left: 0, top: 0 };

  setRect(left: number, top: number): void {
    this._rect = { left, top };
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** 触发指定类型的所有监听器。 */
  dispatch(type: string, event: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) fn(event);
  }

  getBoundingClientRect(): { left: number; top: number } {
    return this._rect;
  }
}

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    preventDefault(): void { /* mock */ },
    ...overrides,
  };
}

describe('InputManager — attach / detach', () => {
  it('attach 后 isAttached=true', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    expect(mgr.isAttached()).toBe(false);
    mgr.attach(el as unknown as HTMLElement);
    expect(mgr.isAttached()).toBe(true);
    mgr.detach();
    expect(mgr.isAttached()).toBe(false);
  });

  it('detach 后事件不再被处理', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
    mgr.detach();
    el.dispatch('keydown', makeEvent({ code: 'KeyW' }));
    expect(mgr.keyboard.isDown('KeyW')).toBe(false);
  });

  it('重复 attach 不同元素先 detach 旧的', () => {
    const el1 = new MockElement();
    const el2 = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el1 as unknown as HTMLElement);
    mgr.attach(el2 as unknown as HTMLElement);
    // el1 的事件不再被处理
    el1.dispatch('keydown', makeEvent({ code: 'KeyW' }));
    expect(mgr.keyboard.isDown('KeyW')).toBe(false);
    // el2 的事件被处理
    el2.dispatch('keydown', makeEvent({ code: 'KeyA' }));
    expect(mgr.keyboard.isDown('KeyA')).toBe(true);
  });

  it('重复 attach 同一元素 no-op', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
    mgr.attach(el as unknown as HTMLElement);
    el.dispatch('keydown', makeEvent({ code: 'KeyW' }));
    expect(mgr.keyboard.isDown('KeyW')).toBe(true);
  });
});

describe('InputManager — 键盘事件', () => {
  let el: MockElement;
  let mgr: InputManager;
  beforeEach(() => {
    el = new MockElement();
    mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
  });
  afterEach(() => mgr.detach());

  it('keydown → KeyboardState.press', () => {
    el.dispatch('keydown', makeEvent({ code: 'Space' }));
    expect(mgr.keyboard.isDown('Space')).toBe(true);
    expect(mgr.keyboard.isPressed('Space')).toBe(true);
  });

  it('keyup → KeyboardState.release', () => {
    el.dispatch('keydown', makeEvent({ code: 'Space' }));
    el.dispatch('keyup', makeEvent({ code: 'Space' }));
    expect(mgr.keyboard.isDown('Space')).toBe(false);
    expect(mgr.keyboard.isReleased('Space')).toBe(true);
  });
});

describe('InputManager — 鼠标事件', () => {
  let el: MockElement;
  let mgr: InputManager;
  beforeEach(() => {
    el = new MockElement();
    el.setRect(10, 20);
    mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
  });
  afterEach(() => mgr.detach());

  it('mousedown → MouseState.press + position 更新', () => {
    el.dispatch('mousedown', makeEvent({ button: 0, clientX: 50, clientY: 60 }));
    expect(mgr.mouse.isButtonPressed(0)).toBe(true);
    expect(mgr.mouse.position.x).toBe(40); // 50 - rect.left=10
    expect(mgr.mouse.position.y).toBe(40); // 60 - rect.top=20
  });

  it('mouseup → MouseState.release', () => {
    el.dispatch('mousedown', makeEvent({ button: 2, clientX: 0, clientY: 0 }));
    el.dispatch('mouseup', makeEvent({ button: 2, clientX: 0, clientY: 0 }));
    expect(mgr.mouse.isButtonDown(2)).toBe(false);
    expect(mgr.mouse.isButtonReleased(2)).toBe(true);
  });

  it('mousemove 累加 delta', () => {
    el.dispatch('mousemove', makeEvent({ clientX: 20, clientY: 30 }));
    // rect.left=10, rect.top=20 → position (10, 10), delta (10, 10)
    expect(mgr.mouse.position.x).toBe(10);
    expect(mgr.mouse.delta.x).toBe(10);
    el.dispatch('mousemove', makeEvent({ clientX: 30, clientY: 30 }));
    expect(mgr.mouse.position.x).toBe(20);
    expect(mgr.mouse.delta.x).toBe(20); // 10 + 10
  });

  it('wheel 累加 wheelDelta', () => {
    el.dispatch('wheel', makeEvent({ deltaY: 120 }));
    expect(mgr.mouse.getWheel()).toBe(120);
  });
});

describe('InputManager — 触摸事件', () => {
  let el: MockElement;
  let mgr: InputManager;
  beforeEach(() => {
    el = new MockElement();
    mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
  });
  afterEach(() => mgr.detach());

  it('touchstart → TouchState.begin (多点)', () => {
    el.dispatch('touchstart', makeEvent({
      changedTouches: [
        { identifier: 0, clientX: 10, clientY: 10 },
        { identifier: 1, clientX: 50, clientY: 50 },
      ],
    }));
    expect(mgr.touch.getTouchCount()).toBe(2);
    expect(mgr.touch.getTouch(0)).toBeDefined();
    expect(mgr.touch.getTouch(0)!.phase).toBe('began');
    expect(mgr.touch.getTouch(1)).toBeDefined();
  });

  it('touchmove → TouchState.move (更新 position 与 delta)', () => {
    el.dispatch('touchstart', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 10, clientY: 10 }],
    }));
    el.dispatch('touchmove', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 20, clientY: 10 }],
    }));
    const t = mgr.touch.getTouch(0)!;
    expect(t.position.x).toBe(20);
    expect(t.delta.x).toBe(10);
    expect(t.phase).toBe('moved');
  });

  it('touchend → TouchState.end (phase=ended, 仍在 map 中直到 update)', () => {
    el.dispatch('touchstart', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }],
    }));
    el.dispatch('touchend', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }],
    }));
    const t = mgr.touch.getTouch(0);
    expect(t).toBeDefined();
    expect(t!.phase).toBe('ended');
  });

  it('touchcancel → phase=cancelled', () => {
    el.dispatch('touchstart', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }],
    }));
    el.dispatch('touchcancel', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }],
    }));
    expect(mgr.touch.getTouch(0)!.phase).toBe('cancelled');
  });

  it('getMultiTouchDistance — 双指距离', () => {
    el.dispatch('touchstart', makeEvent({
      changedTouches: [
        { identifier: 0, clientX: 0, clientY: 0 },
        { identifier: 1, clientX: 30, clientY: 40 },
      ],
    }));
    expect(mgr.touch.getMultiTouchDistance()).toBeCloseTo(50, 5); // 3-4-5
  });
});

describe('InputManager — update', () => {
  it('update 清空 per-frame 缓冲', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
    el.dispatch('keydown', makeEvent({ code: 'KeyW' }));
    el.dispatch('mousedown', makeEvent({ button: 0, clientX: 0, clientY: 0 }));
    el.dispatch('wheel', makeEvent({ deltaY: 100 }));

    expect(mgr.keyboard.isPressed('KeyW')).toBe(true);
    expect(mgr.mouse.isButtonPressed(0)).toBe(true);
    expect(mgr.mouse.getWheel()).toBe(100);

    mgr.update();

    expect(mgr.keyboard.isPressed('KeyW')).toBe(false);
    expect(mgr.keyboard.isDown('KeyW')).toBe(true); // 仍按住
    expect(mgr.mouse.isButtonPressed(0)).toBe(false);
    expect(mgr.mouse.isButtonDown(0)).toBe(true);
    expect(mgr.mouse.getWheel()).toBe(0);
  });

  it('update 移除 ended / cancelled 触摸', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
    el.dispatch('touchstart', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }],
    }));
    el.dispatch('touchend', makeEvent({
      changedTouches: [{ identifier: 0, clientX: 0, clientY: 0 }],
    }));
    expect(mgr.touch.getTouchCount()).toBe(1);
    mgr.update();
    expect(mgr.touch.getTouchCount()).toBe(0);
  });
});

describe('InputManager — enabled', () => {
  it('默认 enabled=true', () => {
    const mgr = new InputManager();
    expect(mgr.isEnabled()).toBe(true);
  });

  it('setEnabled(false) 后事件不再被处理', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
    mgr.setEnabled(false);
    el.dispatch('keydown', makeEvent({ code: 'KeyW' }));
    expect(mgr.keyboard.isDown('KeyW')).toBe(false);
  });

  it('setEnabled(false) 清空按下状态', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
    el.dispatch('keydown', makeEvent({ code: 'KeyW' }));
    expect(mgr.keyboard.isDown('KeyW')).toBe(true);
    mgr.setEnabled(false);
    expect(mgr.keyboard.isDown('KeyW')).toBe(false);
  });

  it('setEnabled(true) 重新启用后恢复采集', () => {
    const el = new MockElement();
    const mgr = new InputManager();
    mgr.attach(el as unknown as HTMLElement);
    mgr.setEnabled(false);
    mgr.setEnabled(true);
    el.dispatch('keydown', makeEvent({ code: 'KeyW' }));
    expect(mgr.keyboard.isDown('KeyW')).toBe(true);
  });
});

describe('InputManager — 手柄轮询', () => {
  afterEach(() => {
    // 清理 mock navigator
    const g = globalThis as { navigator?: unknown };
    delete g.navigator;
  });

  it('无 navigator.getGamepads 时 connected=false,不抛错', () => {
    const mgr = new InputManager();
    expect(() => mgr.update()).not.toThrow();
    expect(mgr.gamepad.isConnected()).toBe(false);
  });

  it('有 navigator.getGamepads 时 poll 拉取快照', () => {
    const fakePad = {
      axes: [0.5, -0.2],
      buttons: [
        { pressed: true, touched: true, value: 1 },
        { pressed: false, touched: false, value: 0 },
      ],
    };
    const g = globalThis as { navigator?: { getGamepads: () => unknown[] } };
    g.navigator = { getGamepads: () => [fakePad] };
    const mgr = new InputManager();
    mgr.update();
    expect(mgr.gamepad.isConnected()).toBe(true);
    expect(mgr.gamepad.getAxis(0)).toBeCloseTo(0.5, 5);
    expect(mgr.gamepad.isButtonDown(0)).toBe(true);
  });

  it('连接状态变化触发监听器', () => {
    const g = globalThis as { navigator?: { getGamepads: () => unknown[] } };
    g.navigator = { getGamepads: () => [] };
    const mgr = new InputManager();
    const events: boolean[] = [];
    mgr.gamepad.onConnectionChange((c) => events.push(c));
    mgr.update(); // 仍无连接
    g.navigator.getGamepads = () => [{ axes: [], buttons: [] }];
    mgr.update(); // 连接
    expect(events).toEqual([true]);
  });
});

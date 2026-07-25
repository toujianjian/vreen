// InputMap 测试 — 输入映射表。
//
// 验证:
//   • addAction / getAction / removeAction / size / clear
//   • update 评估所有动作
//   • saveToJSON / loadFromJSON 往返一致
//   • loadFromJSON 覆盖式重建
import { describe, it, expect, beforeEach } from 'vitest';
import { InputMap } from './InputMap';
import { InputAction, type InputStateProvider } from './InputAction';
import { KeyboardState } from './KeyboardState';
import { MouseState } from './MouseState';
import { TouchState } from './TouchState';
import { GamepadState } from './GamepadState';

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

describe('InputMap — CRUD', () => {
  let map: InputMap;
  beforeEach(() => {
    map = new InputMap();
  });

  it('addAction / getAction', () => {
    const a = new InputAction('jump');
    map.addAction('jump', a);
    expect(map.getAction('jump')).toBe(a);
    expect(map.getAction('missing')).toBeUndefined();
  });

  it('addAction 覆盖同名', () => {
    const a1 = new InputAction('jump', [{ type: 'keyboard', code: 'Space' }]);
    const a2 = new InputAction('jump', [{ type: 'mouse', button: 0 }]);
    map.addAction('jump', a1);
    map.addAction('jump', a2);
    expect(map.getAction('jump')).toBe(a2);
    expect(map.size).toBe(1);
  });

  it('addAction 链式', () => {
    const ret = map.addAction('a', new InputAction('a'));
    expect(ret).toBe(map);
  });

  it('removeAction', () => {
    map.addAction('jump', new InputAction('jump'));
    expect(map.removeAction('jump')).toBe(true);
    expect(map.removeAction('jump')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('size / clear', () => {
    map.addAction('a', new InputAction('a'));
    map.addAction('b', new InputAction('b'));
    expect(map.size).toBe(2);
    map.clear();
    expect(map.size).toBe(0);
  });
});

describe('InputMap — update', () => {
  it('评估所有动作', () => {
    const kb = new KeyboardState();
    kb.press('Space');
    kb.press('KeyW');
    const p = makeProvider({ keyboard: kb });

    const map = new InputMap();
    map.addAction('jump', new InputAction('jump', [{ type: 'keyboard', code: 'Space' }]));
    map.addAction('forward', new InputAction('forward', [{ type: 'keyboard', code: 'KeyW' }]));
    map.addAction('idle', new InputAction('idle', [{ type: 'keyboard', code: 'KeyX' }]));

    map.update(p);

    expect(map.getAction('jump')!.isPressed()).toBe(true);
    expect(map.getAction('forward')!.isPressed()).toBe(true);
    expect(map.getAction('idle')!.isPressed()).toBe(false);
    expect(map.getAction('idle')!.getValue()).toBe(0);
  });
});

describe('InputMap — JSON 往返', () => {
  it('saveToJSON 输出结构', () => {
    const map = new InputMap();
    map.addAction('jump', new InputAction('jump', [
      { type: 'keyboard', code: 'Space' },
      { type: 'gamepad', button: 0 },
    ]));
    map.addAction('fire', new InputAction('fire', [
      { type: 'mouse', button: 0 },
    ]));
    const json = map.saveToJSON();
    expect(json.actions).toHaveLength(2);
    expect(json.actions[0].name).toBe('jump');
    expect(json.actions[0].bindings).toHaveLength(2);
    expect(json.actions[1].name).toBe('fire');
    expect(json.actions[1].bindings[0].type).toBe('mouse');
  });

  it('loadFromJSON 重建等价 map', () => {
    const src = new InputMap();
    src.addAction('jump', new InputAction('jump', [
      { type: 'keyboard', code: 'Space' },
      { type: 'gamepad', button: 0, axisThreshold: 0.6 },
    ]));
    const json = src.saveToJSON();

    const dst = new InputMap();
    dst.loadFromJSON(json);
    expect(dst.size).toBe(1);
    const a = dst.getAction('jump')!;
    expect(a.name).toBe('jump');
    expect(a.bindings).toHaveLength(2);
    expect(a.bindings[0].code).toBe('Space');
    expect(a.bindings[1].button).toBe(0);
    expect(a.bindings[1].axisThreshold).toBe(0.6);
  });

  it('loadFromJSON 覆盖式 (清空旧动作)', () => {
    const map = new InputMap();
    map.addAction('old', new InputAction('old'));
    map.loadFromJSON({
      actions: [{ name: 'new', bindings: [{ type: 'keyboard', code: 'Space' }] }],
    });
    expect(map.getAction('old')).toBeUndefined();
    expect(map.getAction('new')).toBeDefined();
  });

  it('saveToJSON → loadFromJSON → saveToJSON 幂等', () => {
    const src = new InputMap();
    src.addAction('jump', new InputAction('jump', [
      { type: 'keyboard', code: 'Space' },
      { type: 'mouse', button: 1 },
    ]));
    const j1 = src.saveToJSON();
    const dst = new InputMap();
    dst.loadFromJSON(j1);
    const j2 = dst.saveToJSON();
    expect(j2).toEqual(j1);
  });

  it('loadFromJSON 空 actions 不抛错', () => {
    const map = new InputMap();
    map.addAction('x', new InputAction('x'));
    map.loadFromJSON({ actions: [] });
    expect(map.size).toBe(0);
  });

  it('loadFromJSON 缺省 actions 字段不抛错', () => {
    const map = new InputMap();
    expect(() => map.loadFromJSON({} as never)).not.toThrow();
    expect(map.size).toBe(0);
  });
});

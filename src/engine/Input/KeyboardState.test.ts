// KeyboardState 测试 — 键盘状态机。
//
// 验证:
//   • press / release 推动 keysDown / keysPressed / keysReleased
//   • 重复 press (autorepeat) 不重复计入 keysPressed
//   • isDown / isPressed / isReleased / anyDown / allDown 查询
//   • update 清空 per-frame 集合,保留 keysDown
//   • reset 清空所有
import { describe, it, expect, beforeEach } from 'vitest';
import { KeyboardState } from './KeyboardState';

describe('KeyboardState', () => {
  let k: KeyboardState;
  beforeEach(() => {
    k = new KeyboardState();
  });

  it('press 加入 keysDown 与 keysPressed', () => {
    k.press('KeyW');
    expect(k.keysDown.has('KeyW')).toBe(true);
    expect(k.keysPressed.has('KeyW')).toBe(true);
    expect(k.isDown('KeyW')).toBe(true);
    expect(k.isPressed('KeyW')).toBe(true);
  });

  it('重复 press 不重复计入 keysPressed', () => {
    k.press('KeyW');
    k.press('KeyW'); // autorepeat
    expect(k.keysPressed.size).toBe(1);
    expect(k.isPressed('KeyW')).toBe(true);
  });

  it('release 从 keysDown 移除并加入 keysReleased', () => {
    k.press('KeyW');
    k.release('KeyW');
    expect(k.isDown('KeyW')).toBe(false);
    expect(k.isReleased('KeyW')).toBe(true);
  });

  it('release 未按下的键不产生 keysReleased', () => {
    k.release('KeyA');
    expect(k.keysReleased.size).toBe(0);
  });

  it('isDown / isPressed / isReleased 各自独立', () => {
    k.press('Space');
    expect(k.isDown('Space')).toBe(true);
    expect(k.isPressed('Space')).toBe(true);
    expect(k.isReleased('Space')).toBe(false);
    k.update();
    expect(k.isDown('Space')).toBe(true);
    expect(k.isPressed('Space')).toBe(false);
    expect(k.isReleased('Space')).toBe(false);
    k.release('Space');
    expect(k.isDown('Space')).toBe(false);
    expect(k.isReleased('Space')).toBe(true);
  });

  it('anyDown — 任一按下', () => {
    k.press('KeyW');
    expect(k.anyDown('KeyA', 'KeyW', 'KeyS')).toBe(true);
    expect(k.anyDown('KeyA', 'KeyS')).toBe(false);
    expect(k.anyDown()).toBe(false);
  });

  it('allDown — 全部按下', () => {
    k.press('KeyW');
    k.press('KeyA');
    expect(k.allDown('KeyW', 'KeyA')).toBe(true);
    expect(k.allDown('KeyW', 'KeyS')).toBe(false);
    expect(k.allDown()).toBe(true); // 空集视为全满足
  });

  it('update 清空 pressed / released,保留 keysDown', () => {
    k.press('KeyW');
    k.release('KeyA');
    k.update();
    expect(k.keysPressed.size).toBe(0);
    expect(k.keysReleased.size).toBe(0);
    expect(k.keysDown.has('KeyW')).toBe(true);
  });

  it('reset 清空所有集合', () => {
    k.press('KeyW');
    k.release('KeyA');
    k.reset();
    expect(k.keysDown.size).toBe(0);
    expect(k.keysPressed.size).toBe(0);
    expect(k.keysReleased.size).toBe(0);
  });
});

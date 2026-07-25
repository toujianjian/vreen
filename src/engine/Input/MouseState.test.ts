// MouseState 测试 — 鼠标状态机。
//
// 验证:
//   • press / release / move / scroll 推动状态
//   • isButtonDown / isButtonPressed / isButtonReleased / getWheel
//   • delta 累加与 position 更新
//   • update 清零 delta / wheel,清空 pressed / released
//   • reset 清空所有
import { describe, it, expect, beforeEach } from 'vitest';
import { MouseState } from './MouseState';

describe('MouseState', () => {
  let m: MouseState;
  beforeEach(() => {
    m = new MouseState();
  });

  it('press 加入 buttonsDown / buttonsPressed', () => {
    m.press(0);
    expect(m.isButtonDown(0)).toBe(true);
    expect(m.isButtonPressed(0)).toBe(true);
    expect(m.isButtonReleased(0)).toBe(false);
  });

  it('release 加入 buttonsReleased,移出 buttonsDown', () => {
    m.press(1);
    m.release(1);
    expect(m.isButtonDown(1)).toBe(false);
    expect(m.isButtonReleased(1)).toBe(true);
  });

  it('不同按钮编号独立跟踪 (0=左,1=中,2=右)', () => {
    m.press(0);
    m.press(2);
    expect(m.isButtonDown(0)).toBe(true);
    expect(m.isButtonDown(1)).toBe(false);
    expect(m.isButtonDown(2)).toBe(true);
  });

  it('move 更新 position 并累加 delta', () => {
    m.move(10, 20);
    expect(m.position.x).toBe(10);
    expect(m.position.y).toBe(20);
    expect(m.delta.x).toBe(10);
    expect(m.delta.y).toBe(20);
    m.move(15, 25);
    expect(m.position.x).toBe(15);
    expect(m.delta.x).toBe(15); // 累加:10 + 5
    expect(m.delta.y).toBe(25); // 20 + 5
  });

  it('scroll 累加 wheelDelta', () => {
    m.scroll(100);
    m.scroll(-50);
    expect(m.getWheel()).toBe(50);
  });

  it('update 清零 delta / wheel,清空 pressed / released,保留 buttonsDown', () => {
    m.press(0);
    m.move(10, 20);
    m.scroll(100);
    m.release(2);
    m.update();
    expect(m.delta.x).toBe(0);
    expect(m.delta.y).toBe(0);
    expect(m.getWheel()).toBe(0);
    expect(m.isButtonPressed(0)).toBe(false);
    expect(m.isButtonReleased(2)).toBe(false);
    expect(m.isButtonDown(0)).toBe(true);
  });

  it('reset 清空所有状态', () => {
    m.press(0);
    m.move(10, 20);
    m.scroll(100);
    m.reset();
    expect(m.position.x).toBe(0);
    expect(m.delta.x).toBe(0);
    expect(m.getWheel()).toBe(0);
    expect(m.buttonsDown.size).toBe(0);
    expect(m.buttonsPressed.size).toBe(0);
    expect(m.buttonsReleased.size).toBe(0);
  });

  it('重复 press 不重复计入 buttonsPressed', () => {
    m.press(0);
    m.press(0);
    expect(m.buttonsPressed.size).toBe(1);
  });
});

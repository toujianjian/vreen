// MouseState — 鼠标输入状态。
//
// 跟踪：
//   - position / delta — 鼠标光标位置与帧内位移 (px)
//   - buttonsDown / buttonsPressed / buttonsReleased — 三套按键集合
//   - wheelDelta — 本帧滚轮累计增量 (px),向上为正
//
// 按钮编号遵循 MouseEvent.button 约定：0=左键, 1=中键, 2=右键,
// 3=后退, 4=前进。InputManager 在 mousedown / mouseup / mousemove /
// wheel 事件中调用对应方法推动状态机。
//
// 与 PointerLockControls / OrbitControls 的关系：那些控制器直接消费
// DOM 事件做相机操作;MouseState 提供「本帧快照」式的查询接口,
// 适合游戏逻辑 (InputAction / InputMap) 消费。

import { Vector2 } from '../Math/Vector2';

export class MouseState {
  /** 当前光标位置 (相对于 attach 的 DOM 元素,px)。 */
  readonly position: Vector2 = new Vector2();
  /** 本帧位移 (上一帧 position → 当前 position)。帧末 update() 清零。 */
  readonly delta: Vector2 = new Vector2();
  /** 当前按下的按钮 (button 编号)。 */
  readonly buttonsDown: Set<number> = new Set();
  /** 本帧刚按下的按钮。帧末 update() 清空。 */
  readonly buttonsPressed: Set<number> = new Set();
  /** 本帧刚释放的按钮。帧末 update() 清空。 */
  readonly buttonsReleased: Set<number> = new Set();
  /** 本帧滚轮增量 (向上为正)。帧末 update() 清零。 */
  wheelDelta: number = 0;

  /** 由 InputManager 在 mousedown 事件中调用。 */
  press(button: number): void {
    if (!this.buttonsDown.has(button)) {
      this.buttonsPressed.add(button);
    }
    this.buttonsDown.add(button);
  }

  /** 由 InputManager 在 mouseup 事件中调用。 */
  release(button: number): void {
    if (this.buttonsDown.delete(button)) {
      this.buttonsReleased.add(button);
    }
  }

  /** 由 InputManager 在 mousemove 事件中调用 —— 更新 position 并累加 delta。 */
  move(x: number, y: number): void {
    const dx = x - this.position.x;
    const dy = y - this.position.y;
    this.position.set(x, y);
    this.delta.x += dx;
    this.delta.y += dy;
  }

  /** 由 InputManager 在 wheel 事件中调用 —— 累加滚轮增量。 */
  scroll(deltaY: number): void {
    this.wheelDelta += deltaY;
  }

  /** 按钮当前是否处于按下状态。0=左, 1=中, 2=右。 */
  isButtonDown(button: number): boolean {
    return this.buttonsDown.has(button);
  }

  /** 按钮是否在本帧刚被按下。 */
  isButtonPressed(button: number): boolean {
    return this.buttonsPressed.has(button);
  }

  /** 按钮是否在本帧刚被释放。 */
  isButtonReleased(button: number): boolean {
    return this.buttonsReleased.has(button);
  }

  /** 本帧滚轮增量 (向上为正)。 */
  getWheel(): number {
    return this.wheelDelta;
  }

  /** 帧末调用 — 清零 delta / wheelDelta,清空 pressed / released。 */
  update(): void {
    this.delta.set(0, 0);
    this.wheelDelta = 0;
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
  }

  /** 清空所有状态 (失焦 / 解绑 / 重置时调用)。 */
  reset(): void {
    this.position.set(0, 0);
    this.delta.set(0, 0);
    this.wheelDelta = 0;
    this.buttonsDown.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
  }
}

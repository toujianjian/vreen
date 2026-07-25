// KeyboardState — 键盘输入状态。
//
// 跟踪三类键集合：
//   - keysDown    — 当前处于按下状态的键
//   - keysPressed — 本帧刚按下的键 (帧末 update() 清空)
//   - keysReleased— 本帧刚释放的键 (帧末 update() 清空)
//
// 键码采用 KeyboardEvent.code (例如 'KeyW' / 'ArrowUp' / 'Space')，
// 因为 code 不受键盘布局影响，更适合游戏输入。InputManager 在
// keydown / keyup 事件中调用 press() / release() 推动状态机。
//
// 线程模型：单线程 JS 主循环，所有方法同步。

export class KeyboardState {
  /** 当前按下的键 (code)。 */
  readonly keysDown: Set<string> = new Set();
  /** 本帧刚按下的键 (code)。帧末 update() 清空。 */
  readonly keysPressed: Set<string> = new Set();
  /** 本帧刚释放的键 (code)。帧末 update() 清空。 */
  readonly keysReleased: Set<string> = new Set();

  /**
   * 由 InputManager 在 keydown 事件中调用。
   *
   * 重复 keydown (autorepeat) 不会重复计入 keysPressed ——
   * 只有从「未按下」到「按下」的真正转换才算一次「本帧按下」。
   */
  press(code: string): void {
    if (!this.keysDown.has(code)) {
      this.keysPressed.add(code);
    }
    this.keysDown.add(code);
  }

  /** 由 InputManager 在 keyup 事件中调用。 */
  release(code: string): void {
    if (this.keysDown.delete(code)) {
      this.keysReleased.add(code);
    }
  }

  /** 键当前是否处于按下状态。 */
  isDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** 键是否在本帧刚被按下。 */
  isPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  /** 键是否在本帧刚被释放。 */
  isReleased(code: string): boolean {
    return this.keysReleased.has(code);
  }

  /** 任一键处于按下状态时返回 true。 */
  anyDown(...codes: string[]): boolean {
    for (const c of codes) {
      if (this.keysDown.has(c)) return true;
    }
    return false;
  }

  /** 全部键都处于按下状态时返回 true。 */
  allDown(...codes: string[]): boolean {
    for (const c of codes) {
      if (!this.keysDown.has(c)) return false;
    }
    return true;
  }

  /** 帧末调用 — 清空本帧的 pressed / released 集合。 */
  update(): void {
    this.keysPressed.clear();
    this.keysReleased.clear();
  }

  /** 清空所有状态 (失焦 / 解绑 / 重置时调用)。 */
  reset(): void {
    this.keysDown.clear();
    this.keysPressed.clear();
    this.keysReleased.clear();
  }
}

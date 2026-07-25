// GamepadState — 手柄输入状态。
//
// 封装 Gamepad API (navigator.getGamepads),提供死区处理与按钮查询。
// InputManager.update() 每帧调用 poll() 刷新 axes / buttons 快照。
//
// 测试 / Node 环境无 navigator.getGamepads 时退化为「未连接」,
// 不抛错 —— 让游戏逻辑可以优雅地跳过手柄输入路径。
//
// 扳机震动 (rumble) 需要 GamepadHapticActuator,仅在支持的浏览器生效;
// 不支持时静默 no-op。

/** 手柄按钮快照 (与浏览器 GamepadButton 同构,避免 DOM lib 依赖)。 */
export interface GamepadButtonState {
  pressed: boolean;
  touched: boolean;
  value: number;
}

/** 手柄连接事件 listener。 */
export type GamepadConnectionListener = (connected: boolean) => void;

export class GamepadState {
  /** 是否已连接。 */
  connected: boolean = false;
  /** 轴值数组 (标准化到 -1..1)。 */
  axes: Float32Array = new Float32Array(0);
  /** 按钮快照数组。 */
  buttons: GamepadButtonState[] = [];
  /** 摇杆死区 (0..1),|axis| < deadzone 时归零。默认 0.1。 */
  deadzone: number;
  /** 监听的 gamepad index;若 null 则取第一个可用 gamepad。 */
  index: number | null = null;

  private _connectionListeners: GamepadConnectionListener[] = [];

  constructor(deadzone: number = 0.1) {
    this.deadzone = deadzone;
  }

  /** 注册连接状态变化监听器。返回取消注册函数。 */
  onConnectionChange(listener: GamepadConnectionListener): () => void {
    this._connectionListeners.push(listener);
    return () => {
      const i = this._connectionListeners.indexOf(listener);
      if (i >= 0) this._connectionListeners.splice(i, 1);
    };
  }

  /** 是否已连接。 */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 获取轴值 (应用死区)。
   *
   * 线性死区:`|v| < deadzone` → 0;否则原值返回 (不做 rescale,
   * 让调用方按需做幂曲线等处理)。
   */
  getAxis(index: number): number {
    if (index < 0 || index >= this.axes.length) return 0;
    const v = this.axes[index];
    if (Math.abs(v) < this.deadzone) return 0;
    return v;
  }

  /** 按钮是否处于按下状态。 */
  isButtonDown(index: number): boolean {
    return this.buttons[index]?.pressed ?? false;
  }

  /** 扳机值 (0..1)。普通按钮返回 0 或 1,模拟扳机返回中间值。 */
  getTrigger(index: number): number {
    return this.buttons[index]?.value ?? 0;
  }

  /**
   * 触发震动 (需浏览器支持 GamepadHapticActuator)。
   *
   * @param strong  强震动强度 (0..1)
   * @param weak    弱震动强度 (0..1)
   * @param duration 持续时间 (ms)
   * @returns 是否成功触发 (不支持时返回 false)
   */
  async rumble(strong: number, weak: number, duration: number): Promise<boolean> {
    const pad = this._getRawGamepad();
    if (!pad) return false;
    const actuator = (pad as unknown as {
      vibrationActuator?: {
        playEffect: (
          type: string,
          params: { strongMagnitude: number; weakMagnitude: number; duration: number },
        ) => Promise<unknown>;
      };
    }).vibrationActuator;
    if (!actuator) return false;
    try {
      await actuator.playEffect('dual-rumble', {
        duration,
        strongMagnitude: strong,
        weakMagnitude: weak,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 每帧调用 —— 从 navigator.getGamepads() 拉取最新快照。
   *
   * 无 navigator / 未连接时:connected=false,axes/buttons 清空。
   * 同时检测连接状态变化并通知监听器。
   */
  poll(): void {
    const pad = this._getRawGamepad();
    const wasConnected = this.connected;
    if (pad) {
      this.connected = true;
      this.axes = new Float32Array(pad.axes ?? []);
      this.buttons = (pad.buttons ?? []).map((b) => ({
        pressed: b.pressed,
        touched: b.touched,
        value: b.value,
      }));
    } else {
      this.connected = false;
      this.axes = new Float32Array(0);
      this.buttons = [];
    }
    if (this.connected !== wasConnected) {
      for (const l of this._connectionListeners) {
        try {
          l(this.connected);
        } catch {
          /* listener 抛错不阻断其他 listener */
        }
      }
    }
  }

  /** 帧末调用 —— 当前无 per-frame 缓冲需要清理 (poll 已覆写)。 */
  update(): void {
    /* no-op: poll() 每帧覆写 axes/buttons,无需额外清理 */
  }

  /** 清空所有状态。 */
  reset(): void {
    this.connected = false;
    this.axes = new Float32Array(0);
    this.buttons = [];
  }

  /** 从 navigator.getGamepads() 取目标 gamepad (或第一个)。 */
  private _getRawGamepad(): Gamepad | null {
    const g = globalThis as { navigator?: { getGamepads?: () => (Gamepad | null)[] } };
    if (!g.navigator?.getGamepads) return null;
    const pads = g.navigator.getGamepads.call(g.navigator);
    if (!pads) return null;
    if (this.index !== null) return pads[this.index] ?? null;
    for (const p of pads) {
      if (p) return p;
    }
    return null;
  }
}

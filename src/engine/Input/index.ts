// Input barrel —— 输入系统统一导出。
//
// 模块组成：
//   - KeyboardState  — 键盘状态 (keysDown / keysPressed / keysReleased)
//   - MouseState     — 鼠标状态 (position / delta / buttons / wheelDelta)
//   - TouchState     — 触摸状态 (多点触摸 + phase + 双指距离)
//   - GamepadState   — 手柄状态 (axes / buttons + 死区 + rumble)
//   - InputAction    — 输入动作 (物理输入 → 逻辑动作映射)
//   - InputMap       — 输入映射表 (多动作管理 + JSON 往返)
//   - InputManager   — 输入管理器 (统一 attach DOM + 推进各 state)

export { KeyboardState } from './KeyboardState';
export { MouseState } from './MouseState';
export { TouchState, type Touch, type TouchPhase } from './TouchState';
export {
  GamepadState,
  type GamepadButtonState,
  type GamepadConnectionListener,
} from './GamepadState';
export {
  InputAction,
  type InputBinding,
  type InputBindingType,
  type InputStateProvider,
} from './InputAction';
export { InputMap, type InputMapJSON } from './InputMap';
export { InputManager, type InputManagerOptions } from './InputManager';

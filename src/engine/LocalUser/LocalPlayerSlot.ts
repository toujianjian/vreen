// LocalPlayerSlot — 本地玩家槽位:index + state + profile + inputDevice + cameraRig。
// 参考 o3de Gems/LocalUser:LocalPlayerSlot。

import type { LocalUserProfile } from './LocalUserProfile';

export type PlayerSlotState = 'empty' | 'active' | 'inactive';

export interface LocalPlayerSlot {
  index: number;          // 0-based slot index
  state: PlayerSlotState;
  profile: LocalUserProfile | null;
  /** Input device id (gamepad index, or 'keyboard' / 'keyboard2'). */
  inputDeviceId: string | null;
  /** Camera rig index (for split-screen). */
  cameraRigIndex: number | null;
}

export function createEmptySlot(index: number): LocalPlayerSlot {
  return { index, state: 'empty', profile: null, inputDeviceId: null, cameraRigIndex: null };
}

// LocalUserManager — 本地用户管理器:多槽位 + join/leave/reactivate + 设置管理。
// 参考 o3de Gems/LocalUser:LocalUserManager。
//
// 职责:
//   - 维护 N 个 LocalPlayerSlot (默认 4,钳制 [1, 16])
//   - join:分配空槽位给 profile + inputDevice
//   - leave:标记槽位为 inactive,清空 profile/device
//   - reactivate:重新激活 inactive 槽位
//   - findByDevice / activeSlots / getProfile / setSetting 查询与配置
//   - reset:清空所有槽位

import { createLogger } from '@/lib/logger';
import { LocalPlayerSlot, createEmptySlot } from './LocalPlayerSlot';
import type { LocalUserProfile } from './LocalUserProfile';

const log = createLogger('LocalUser');

export interface LocalUserManagerOptions {
  slotCount: number; // default 4
}

export class LocalUserManager {
  slots: LocalPlayerSlot[];

  constructor(opts: Partial<LocalUserManagerOptions> = {}) {
    const n = Math.max(1, Math.min(16, opts.slotCount ?? 4));
    this.slots = Array.from({ length: n }, (_, i) => createEmptySlot(i));
  }

  /** Assign a profile to an empty slot. Returns slot index or -1 if all full. */
  join(profile: LocalUserProfile, inputDeviceId: string, cameraRigIndex?: number): number {
    const slot = this.slots.find((s) => s.state === 'empty');
    if (!slot) {
      log.warn(`No empty slot for ${profile.displayName}`);
      return -1;
    }
    slot.state = 'active';
    slot.profile = profile;
    slot.inputDeviceId = inputDeviceId;
    slot.cameraRigIndex = cameraRigIndex ?? slot.index;
    return slot.index;
  }

  /** Mark a slot as left (profile cleared, state inactive). */
  leave(slotIndex: number): boolean {
    const s = this.slots[slotIndex];
    if (!s) return false;
    s.state = 'inactive';
    s.profile = null;
    s.inputDeviceId = null;
    s.cameraRigIndex = null;
    return true;
  }

  /** Reactivate an inactive slot (keeps profile if you reassign). */
  reactivate(slotIndex: number, profile: LocalUserProfile, inputDeviceId: string): boolean {
    const s = this.slots[slotIndex];
    if (!s || s.state === 'active') return false;
    s.state = 'active';
    s.profile = profile;
    s.inputDeviceId = inputDeviceId;
    return true;
  }

  /** Get the active slot bound to a device, or null. */
  findByDevice(inputDeviceId: string): LocalPlayerSlot | null {
    return this.slots.find((s) => s.state === 'active' && s.inputDeviceId === inputDeviceId) ?? null;
  }

  /** Get all active slots. */
  activeSlots(): LocalPlayerSlot[] {
    return this.slots.filter((s) => s.state === 'active');
  }

  /** Get the profile for a slot, or null. */
  getProfile(slotIndex: number): LocalUserProfile | null {
    return this.slots[slotIndex]?.profile ?? null;
  }

  /** Update a profile setting. */
  setSetting(slotIndex: number, key: string, value: number | string | boolean): boolean {
    const s = this.slots[slotIndex];
    if (!s || !s.profile) return false;
    s.profile.settings[key] = value;
    return true;
  }

  /** Reset all slots to empty. */
  reset(): void {
    for (const s of this.slots) {
      s.state = 'empty';
      s.profile = null;
      s.inputDeviceId = null;
      s.cameraRigIndex = null;
    }
  }
}

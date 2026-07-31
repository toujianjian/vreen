// LocalUser barrel — 本地多用户管理 (Profile + Slot + Manager)。
//
// 模块组成:
//   - LocalUserProfile  — 用户档案 (id + displayName + settings + savePartition)
//   - LocalPlayerSlot   — 玩家槽位 (index + state + profile + inputDevice + cameraRig)
//   - LocalUserManager  — 多槽位管理器 (join/leave/reactivate/findByDevice/activeSlots/setSetting/reset)

export * from './LocalUserProfile';
export * from './LocalPlayerSlot';
export * from './LocalUserManager';

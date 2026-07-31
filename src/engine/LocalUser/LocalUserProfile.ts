// LocalUserProfile — 本地用户档案:id + 显示名 + 设置 + 存档分区键。
// 参考 o3de Gems/LocalUser:LocalUserProfile。

export interface LocalUserProfile {
  id: string;
  displayName: string;
  /** Settings map (audio volume, sensitivity, etc.). */
  settings: Record<string, number | string | boolean>;
  /** Save-data partition key (per-player save slot namespace). */
  savePartition: string;
}

export function createProfile(id: string, displayName: string): LocalUserProfile {
  return { id, displayName, settings: {}, savePartition: `player_${id}` };
}

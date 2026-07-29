// Gameplay barrel — 游戏玩法系统统一导出。
//
// 包含:
//   * DialogueSystem       — 对话系统主控(状态机 + 事件派发)
//   * DialogueTree         — 对话树(节点 + 选项的有向图)
//   * DialogueParticipant  — 对话参与者(NPC / 玩家 / 旁白)
//   * QuestSystem          — 任务系统(目标 + 前置 + 状态机)
//   * InventorySystem      — 物品栏(可堆叠物品 + 货币 + slot)

export {
  DialogueSystem,
  DIALOGUE_EVENTS,
  type DialogueStartPayload,
  type DialogueAdvancePayload,
  type DialogueChoosePayload,
  type DialogueEndPayload,
} from './DialogueSystem';
export {
  DialogueTree,
  type DialogueNode,
  type DialogueOption,
  type DialogueTreeJSON,
  type DialogueTreeOptions,
} from './DialogueTree';
export {
  DialogueParticipant,
  type DialogueParticipantOptions,
} from './DialogueParticipant';
export {
  QuestSystem,
  QUEST_EVENTS,
  type Quest,
  type QuestObjective,
  type QuestObjectiveType,
  type QuestState,
  type QuestStartedPayload,
  type QuestCompletedPayload,
  type QuestObjectivePayload,
  type QuestAbandonedPayload,
} from './QuestSystem';
export {
  InventorySystem,
  type InventoryItem,
  type ItemType,
  type InventorySystemOptions,
} from './InventorySystem';

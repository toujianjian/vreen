// QuestSystem — 任务系统。
//
// 设计:
//   * quests: Map<id, Quest> 持所有已注册任务模板
//   * activeQuests: Set<id> 当前进行中的任务
//   * completedQuests: Set<id> 已完成任务(不可重复完成)
//   * 通过 EventBus 派发 quest:started / quest:completed / quest:objective / quest:abandoned 事件
//   * QuestObjective 支持 type: 'kill' | 'collect' | 'talk' | 'reach' | 'custom',由调用方解释语义
//
// 状态机:
//   INACTIVE → startQuest(id) → ACTIVE → completeObjective(...) → COMPLETED
//                                  ↓
//                              abandonQuest(id) → ABANDONED(可重新 start)
//
// 不变量:
//   - 任务 id 唯一
//   - 已完成任务不能再次 start(canStartQuest 返回 false)
//   - objective.current 上限为 objective.count,达到时 completed = true
//   - 所有 objective.completed = true 时,Quest 自动转为 COMPLETED

import { EventBus } from '../Events/EventBus';

/** 任务系统事件名常量。 */
export const QUEST_EVENTS = {
  STARTED: 'quest:started',
  COMPLETED: 'quest:completed',
  OBJECTIVE: 'quest:objective',
  ABANDONED: 'quest:abandoned',
} as const;

/** 任务目标类型(由调用方解释语义,系统只跟踪 current/count)。 */
export type QuestObjectiveType = 'kill' | 'collect' | 'talk' | 'reach' | 'custom';

/** 任务状态。 */
export type QuestState = 'inactive' | 'active' | 'completed' | 'abandoned';

/** 任务目标。 */
export interface QuestObjective {
  /** 目标唯一 ID(在所属 Quest 内唯一)。 */
  id: string;
  /** 目标描述(可本地化)。 */
  description: string;
  /** 目标类型(由调用方解释)。 */
  type: QuestObjectiveType;
  /** 目标对象 ID(如敌人类型 / 物品 ID / NPC ID / 坐标 ID)。 */
  target: string;
  /** 需要的数量(如杀 5 个怪 = 5)。 */
  count: number;
  /** 当前进度(初始 0)。 */
  current: number;
  /** 是否已完成(current >= count)。 */
  completed: boolean;
}

/** 任务。 */
export interface Quest {
  /** 任务唯一 ID。 */
  id: string;
  /** 任务标题(可本地化)。 */
  title: string;
  /** 任务描述(可本地化)。 */
  description: string;
  /** 目标列表。 */
  objectives: QuestObjective[];
  /** 奖励(由调用方解释,系统不消费)。 */
  rewards: unknown;
  /** 当前状态。 */
  state: QuestState;
  /** 前置任务 ID 列表(全部 completed 才能 start)。 */
  prerequisites: string[];
}

/** 任务开始事件载荷。 */
export interface QuestStartedPayload {
  questId: string;
  quest: Quest;
}

/** 任务完成事件载荷。 */
export interface QuestCompletedPayload {
  questId: string;
  quest: Quest;
}

/** 任务目标推进事件载荷。 */
export interface QuestObjectivePayload {
  questId: string;
  objectiveId: string;
  objective: QuestObjective;
  delta: number;
}

/** 任务放弃事件载荷。 */
export interface QuestAbandonedPayload {
  questId: string;
  quest: Quest;
}

/**
 * 任务系统 — 管理任务注册、激活、目标推进、完成。
 *
 * 使用方式:
 *   const sys = new QuestSystem(bus);
 *   sys.registerQuest({ id: 'q1', title: '...', objectives: [...], ... });
 *   sys.startQuest('q1');
 *   sys.progressObjective('q1', 'kill_goblins', 1);
 *   // 当所有目标完成,任务自动转 COMPLETED 并派发 quest:completed
 */
export class QuestSystem {
  /** 事件总线(可选)。 */
  readonly bus: EventBus | null;
  /** 已注册的任务模板:id → Quest。 */
  readonly quests: Map<string, Quest> = new Map();
  /** 活跃任务 ID 集合。 */
  readonly activeQuests: Set<string> = new Set();
  /** 已完成任务 ID 集合。 */
  readonly completedQuests: Set<string> = new Set();

  constructor(bus: EventBus | null = null) {
    this.bus = bus;
  }

  /** 注册任务模板。若已存在同 id 则覆盖。 */
  registerQuest(quest: Quest): this {
    this.quests.set(quest.id, {
      ...quest,
      objectives: quest.objectives.map((o) => ({ ...o, current: 0, completed: false })),
      state: 'inactive',
    });
    return this;
  }

  /** 获取任务。 */
  getQuest(id: string): Quest | undefined {
    return this.quests.get(id);
  }

  /** 检查前置任务是否全部完成。 */
  canStartQuest(id: string): boolean {
    const quest = this.quests.get(id);
    if (!quest) return false;
    if (quest.state === 'completed') return false;
    if (quest.state === 'active') return false;
    return quest.prerequisites.every((preId) => this.completedQuests.has(preId));
  }

  /** 开始任务。返回是否成功。 */
  startQuest(id: string): boolean {
    const quest = this.quests.get(id);
    if (!quest) return false;
    if (!this.canStartQuest(id)) return false;
    quest.state = 'active';
    this.activeQuests.add(id);
    this.bus?.emit(QUEST_EVENTS.STARTED, { questId: id, quest } as QuestStartedPayload);
    return true;
  }

  /** 推进目标进度。返回推进后的当前进度(-1 表示失败)。 */
  progressObjective(questId: string, objectiveId: string, amount: number): number {
    const quest = this.quests.get(questId);
    if (!quest || quest.state !== 'active') return -1;
    const obj = quest.objectives.find((o) => o.id === objectiveId);
    if (!obj) return -1;
    if (obj.completed) return obj.current;
    obj.current = Math.min(obj.count, obj.current + amount);
    if (obj.current >= obj.count) {
      obj.completed = true;
    }
    this.bus?.emit(QUEST_EVENTS.OBJECTIVE, {
      questId,
      objectiveId,
      objective: obj,
      delta: amount,
    } as QuestObjectivePayload);
    // 检查是否所有目标完成
    if (quest.objectives.every((o) => o.completed)) {
      this.completeQuestInternal(questId);
    }
    return obj.current;
  }

  /** 直接完成某目标(跳过进度累积)。返回是否成功。 */
  completeObjective(questId: string, objectiveId: string): boolean {
    const quest = this.quests.get(questId);
    if (!quest || quest.state !== 'active') return false;
    const obj = quest.objectives.find((o) => o.id === objectiveId);
    if (!obj || obj.completed) return false;
    const delta = obj.count - obj.current;
    obj.current = obj.count;
    obj.completed = true;
    this.bus?.emit(QUEST_EVENTS.OBJECTIVE, {
      questId,
      objectiveId,
      objective: obj,
      delta,
    } as QuestObjectivePayload);
    if (quest.objectives.every((o) => o.completed)) {
      this.completeQuestInternal(questId);
    }
    return true;
  }

  /** 放弃任务(可重新 start)。返回是否成功。 */
  abandonQuest(id: string): boolean {
    const quest = this.quests.get(id);
    if (!quest || quest.state !== 'active') return false;
    quest.state = 'abandoned';
    this.activeQuests.delete(id);
    // 重置目标进度
    for (const o of quest.objectives) {
      o.current = 0;
      o.completed = false;
    }
    this.bus?.emit(QUEST_EVENTS.ABANDONED, { questId: id, quest } as QuestAbandonedPayload);
    return true;
  }

  /** 获取所有活跃任务。 */
  getActiveQuests(): Quest[] {
    return Array.from(this.activeQuests)
      .map((id) => this.quests.get(id))
      .filter((q): q is Quest => q !== undefined);
  }

  /** 获取所有已完成任务。 */
  getCompletedQuests(): Quest[] {
    return Array.from(this.completedQuests)
      .map((id) => this.quests.get(id))
      .filter((q): q is Quest => q !== undefined);
  }

  /** 清空所有任务(不影响活跃/已完成集合,需单独调用)。 */
  clear(): void {
    this.quests.clear();
    this.activeQuests.clear();
    this.completedQuests.clear();
  }

  /** 内部:完成任务(所有目标已完成时调用)。 */
  private completeQuestInternal(questId: string): void {
    const quest = this.quests.get(questId);
    if (!quest) return;
    quest.state = 'completed';
    this.activeQuests.delete(questId);
    this.completedQuests.add(questId);
    this.bus?.emit(QUEST_EVENTS.COMPLETED, { questId, quest } as QuestCompletedPayload);
  }
}

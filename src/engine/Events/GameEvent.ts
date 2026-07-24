// GameEvent — 游戏事件基类与预定义事件类型。
//
// 设计原则（贴近 Java 风格，方便服务端 / 模拟器对等实现）：
//   - GameEvent 是不可变 POJO：type(事件名) + timestamp(毫秒) + data(载荷)。
//   - 预定义事件类型继承基类，构造时固定 type，data 用强类型接口。
//   - 实体 ID 用 number（与 ECS EntityId 同型）保持 Events 模块对 ECS 零依赖，
//     可独立复用、独立测试。

/** 事件载荷：碰撞信息。entityId 字段为 ECS EntityId（number），保持解耦。 */
export interface CollisionEventData {
  selfId: number;
  otherId: number;
  /** 碰撞法线（单位向量，从 other 指向 self）。 */
  normal: [number, number, number];
  /** 穿透深度（米）。 */
  depth: number;
  /** 接触点世界坐标。 */
  point: [number, number, number];
}

/** 事件载荷：触发器（无物理响应的重叠）。 */
export interface TriggerEventData {
  selfId: number;
  otherId: number;
  /** 'enter' | 'exit' | 'stay'。 */
  phase: 'enter' | 'exit' | 'stay';
}

/** 事件载荷：实体生成。 */
export interface SpawnEventData {
  entityId: number;
  /** 可选：来源 prefab / 生成器名。 */
  source?: string;
  /** 可选：生成位置。 */
  position?: [number, number, number];
}

/** 事件载荷：实体销毁。 */
export interface DestroyEventData {
  entityId: number;
  /** 可选：销毁原因（'killed' / 'lifetime' / 'manual' ...）。 */
  reason?: string;
}

/** 事件载荷：计分。 */
export interface ScoreEventData {
  /** 得分方 entityId（可为 0 表示全局）。 */
  entityId: number;
  delta: number;
  total: number;
}

/** 事件载荷：自定义事件。 */
export interface CustomEventData {
  name: string;
  payload: unknown;
}

/** 所有预定义事件类型名常量，方便 emit/on 时统一引用。 */
export const GameEventType = {
  Collision: 'collision',
  Trigger: 'trigger',
  Spawn: 'spawn',
  Destroy: 'destroy',
  Score: 'score',
  Custom: 'custom',
} as const;
export type GameEventType = typeof GameEventType[keyof typeof GameEventType];

/**
 * 游戏事件基类。不可变：type / timestamp / data 均为 readonly。
 * 子类化以固定 type + 强类型 data；也可直接 `new GameEvent('foo', data)`。
 */
export class GameEvent<T = unknown> {
  readonly type: string;
  readonly timestamp: number;
  readonly data: T;

  constructor(type: string, data: T, timestamp: number = Date.now()) {
    this.type = type;
    this.data = data;
    this.timestamp = timestamp;
  }

  /** 调试用简要描述。 */
  toString(): string {
    return `GameEvent(${this.type})@${this.timestamp}`;
  }
}

/** 碰撞事件。type 固定 = 'collision'。 */
export class CollisionEvent extends GameEvent<CollisionEventData> {
  constructor(data: CollisionEventData, timestamp?: number) {
    super(GameEventType.Collision, data, timestamp);
  }
}

/** 触发器事件。type 固定 = 'trigger'。 */
export class TriggerEvent extends GameEvent<TriggerEventData> {
  constructor(data: TriggerEventData, timestamp?: number) {
    super(GameEventType.Trigger, data, timestamp);
  }
}

/** 生成事件。type 固定 = 'spawn'。 */
export class SpawnEvent extends GameEvent<SpawnEventData> {
  constructor(data: SpawnEventData, timestamp?: number) {
    super(GameEventType.Spawn, data, timestamp);
  }
}

/** 销毁事件。type 固定 = 'destroy'。 */
export class DestroyEvent extends GameEvent<DestroyEventData> {
  constructor(data: DestroyEventData, timestamp?: number) {
    super(GameEventType.Destroy, data, timestamp);
  }
}

/** 计分事件。type 固定 = 'score'。 */
export class ScoreEvent extends GameEvent<ScoreEventData> {
  constructor(data: ScoreEventData, timestamp?: number) {
    super(GameEventType.Score, data, timestamp);
  }
}

/** 自定义事件。type 固定 = 'custom'，具体名放 data.name。 */
export class CustomEvent extends GameEvent<CustomEventData> {
  constructor(data: CustomEventData, timestamp?: number) {
    super(GameEventType.Custom, data, timestamp);
  }
}

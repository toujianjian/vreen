// ScriptComponent — ECS 脚本组件。
//
// 设计原则（贴近 Unity MonoBehaviour 风格，但用 ECS 数据/行为分离）：
//   - ScriptComponent 是 ECS 组件（POJO + 脚本实例引用），由 ScriptSystem 驱动。
//   - ScriptInstance 是用户实现的接口（可选生命周期回调），不是基类 ——
//     避免强制继承，方便用对象字面量定义。
//   - 脚本通过 ScriptContext 拿到 world + 自身 entityId，不持有反向引用。
//
// 生命周期（由 ScriptSystem 调用，按顺序）：
//   1. onStart(ctx)     —— 首次 update 前，仅调用一次。
//   2. onUpdate(ctx, dt) —— 每帧（enabled = true 时）。
//   3. onCollision(ctx, info) / onTrigger(ctx, info) —— 由物理系统或
//      ScriptSystem.dispatchCollision / dispatchTrigger 触发。
//   4. onDestroy(ctx)   —— 组件被移除或实体销毁时调用一次。
//
// 不变量：
//   - script 实例本身不存业务状态到 ECS 序列化层（ScriptComponent 是非 POJO，
//     不进 .vreen，与 MeshRef / AnimState 同类）。
//   - enabled = false 时跳过 onUpdate，但 onStart 已调用过则不重调。

import { ComponentType } from '../ECS/ComponentType';
import type { World, EntityId } from '../ECS/World';
import type { CollisionEventData, TriggerEventData } from '../Events/GameEvent';

/** 脚本运行上下文：脚本通过它访问 World 与自身实体。 */
export interface ScriptContext {
  world: World;
  /** 脚本所附加到的实体 ID。 */
  entityId: EntityId;
}

/**
 * 用户脚本接口。所有回调可选 —— 只实现需要的即可。
 * 实现可以是 class 实例或对象字面量。
 */
export interface ScriptInstance {
  /** 首次 update 前调用一次。 */
  onStart?(ctx: ScriptContext): void;
  /** 每帧调用（enabled = true 时）。 */
  onUpdate?(ctx: ScriptContext, dt: number): void;
  /** 组件移除 / 实体销毁时调用一次。 */
  onDestroy?(ctx: ScriptContext): void;
  /** 碰撞回调（由 ScriptSystem.dispatchCollision 触发）。 */
  onCollision?(ctx: ScriptContext, info: CollisionEventData): void;
  /** 触发器回调（由 ScriptSystem.dispatchTrigger 触发）。 */
  onTrigger?(ctx: ScriptContext, info: TriggerEventData): void;
}

/** 脚本组件：持有 ScriptInstance + enabled + 内部 started 标记。 */
export class ScriptComponent {
  /** 用户脚本实例。 */
  script: ScriptInstance;
  /** 是否启用。false 时 ScriptSystem 跳过 onUpdate / 回调。 */
  enabled: boolean = true;
  /** 内部：onStart 是否已调用过（由 ScriptSystem 设置，避免重复调用）。 */
  started: boolean = false;

  constructor(script: ScriptInstance) {
    this.script = script;
  }
}

/** 组件类型单例（与 TransformC / VelocityC 等同模式）。 */
export const ScriptC = new ComponentType<ScriptComponent>('Script');

/** ScriptComponent 持有运行时脚本引用，属于非 POJO 组件，不进 .vreen 序列化。 */
export const SCRIPT_COMPONENT_NAME = 'Script';

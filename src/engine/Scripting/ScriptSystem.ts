// ScriptSystem — 驱动 ScriptComponent 的 ECS 系统。
//
// 设计原则：
//   - 每帧遍历持有 ScriptComponent 的实体，按生命周期调用脚本回调。
//   - onStart 懒触发：第一次 enabled update 之前调用一次（started 标记去重）。
//   - 提供 dispatchCollision / dispatchTrigger 给物理系统调用，把碰撞/触发
//     信息转发到相关实体的脚本回调。
//   - 提供 destroyScripts(world, id) 在实体销毁前调用 onDestroy。
//
// priority 默认 300（在物理 / 动画系统之后），保证脚本读到的是本帧最新状态。
//
// 不变量：
//   - enabled = false 的组件：不触发 onStart / onUpdate（但若已 started，
//     重新 enable 后 onStart 不会再调）。
//   - dispatchCollision / dispatchTrigger 只对 alive 且 enabled 的实体生效。

import { System } from '../ECS/World';
import type { World, EntityId } from '../ECS/World';
import { ScriptC } from './ScriptComponent';
import type { ScriptContext } from './ScriptComponent';
import { createLogger } from '@/lib/logger';

const log = createLogger('Scripting.ScriptSystem');

/** 碰撞信息（与 Events.CollisionEventData 同构）。selfId 必须存在脚本组件，
 *  otherId 仅作信息传入。 */
export interface CollisionInfo {
  selfId: EntityId;
  otherId: EntityId;
  /** 碰撞法线（单位向量，从 other 指向 self）。 */
  normal: [number, number, number];
  /** 穿透深度（米）。 */
  depth: number;
  /** 接触点世界坐标。 */
  point: [number, number, number];
}

/** 触发器信息（与 Events.TriggerEventData 同构，selfId/otherId 用 EntityId）。 */
export interface TriggerInfo {
  selfId: EntityId;
  otherId: EntityId;
  /** 'enter' | 'exit' | 'stay'。 */
  phase: 'enter' | 'exit' | 'stay';
}

/** 碰撞分发参数：selfId 必须存在脚本组件，otherId 仅作信息传入。 */
export type CollisionDispatch = CollisionInfo;
/** 触发器分发参数。 */
export type TriggerDispatch = TriggerInfo;

export class ScriptSystem extends System {
  constructor() {
    super('ScriptSystem', 300);
  }

  override update(world: World, dt: number): void {
    world.queryWith(ScriptC, (id, sc) => {
      if (!sc.enabled) return;
      const ctx: ScriptContext = { world, entityId: id };
      if (!sc.started) {
        try {
          sc.script.onStart?.(ctx);
        } catch (e) {
          log.error(`onStart threw for entity 0x${id.toString(16)}:`, e);
        }
        sc.started = true;
      }
      try {
        sc.script.onUpdate?.(ctx, dt);
      } catch (e) {
        log.error(`onUpdate threw for entity 0x${id.toString(16)}:`, e);
      }
    });
  }

  /** 把一次碰撞分发到 selfId 上的脚本 onCollision。
   *  selfId 不存在 / 未启用脚本 / 无 onCollision 回调时为 no-op。 */
  dispatchCollision(world: World, info: CollisionDispatch): void {
    const sc = world.getComponent(info.selfId, ScriptC);
    if (!sc || !sc.enabled) return;
    const fn = sc.script.onCollision;
    if (!fn) return;
    const ctx: ScriptContext = { world, entityId: info.selfId };
    try {
      fn(ctx, info);
    } catch (e) {
      log.error(`onCollision threw for entity 0x${info.selfId.toString(16)}:`, e);
    }
  }

  /** 把一次触发器事件分发到 selfId 上的脚本 onTrigger。 */
  dispatchTrigger(world: World, info: TriggerDispatch): void {
    const sc = world.getComponent(info.selfId, ScriptC);
    if (!sc || !sc.enabled) return;
    const fn = sc.script.onTrigger;
    if (!fn) return;
    const ctx: ScriptContext = { world, entityId: info.selfId };
    try {
      fn(ctx, info);
    } catch (e) {
      log.error(`onTrigger threw for entity 0x${info.selfId.toString(16)}:`, e);
    }
  }

  /** 在实体销毁前调用其脚本的 onDestroy（由 World.destroyEntity 调用方触发）。
   *  返回是否实际调用了 onDestroy。 */
  destroyScripts(world: World, id: EntityId): boolean {
    const sc = world.getComponent(id, ScriptC);
    if (!sc) return false;
    const fn = sc.script.onDestroy;
    if (!fn) return false;
    const ctx: ScriptContext = { world, entityId: id };
    try {
      fn(ctx);
    } catch (e) {
      log.error(`onDestroy threw for entity 0x${id.toString(16)}:`, e);
    }
    return true;
  }
}

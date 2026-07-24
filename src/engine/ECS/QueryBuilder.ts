// QueryBuilder — Phase 2.3.3 高频查询缓存。
//
// 问题:World.query(...types) 每次都重新扫组件存储并新建数组,
// 在 hot path(MovementSystem 每帧扫 Velocity+Transform)上造成
// 不必要的 CPU 开销 + GC 压力。
//
// 设计:
//   - QueryBuilder 持有 ComponentType[] 列表,首次 get() 时执行查询并缓存。
//   - World 维护 modCount(createEntity/destroyEntity/setComponent/removeComponent/loadJSON 时 +1)。
//   - QueryBuilder.get() 比较当前 modCount 与缓存时的 modCount,相等则返回缓存副本,
//     不等则重新查询。
//   - World 在 loadJSON 完成后主动调 qb.invalidate() 通知失效(避免依赖 modCount 比对)。
//   - 调用方拿到的数组是副本,可自由修改,不会污染缓存。
//   - dispose() 解除 World 注册,GC 友好。
//
// 使用:
//   ```ts
//   const movers = world.queryBuilder(VelocityC, TransformC);
//   // 每帧:
//   const ids = movers.get(); // 没结构变化时 O(1) 返回缓存副本
//   ```

import type { World, EntityId } from './World';
import type { ComponentType } from './ComponentType';
import { createLogger } from '@/lib/logger';

const log = createLogger('QueryBuilder');

export class QueryBuilder {
  private readonly _world: World;
  private readonly _types: readonly ComponentType<unknown>[];
  private _cached: EntityId[] | null = null;
  private _cachedAtMod: number = -1;
  private _queryCount: number = 0;
  private _cacheHitCount: number = 0;
  private _disposed: boolean = false;

  constructor(world: World, types: readonly ComponentType<unknown>[]) {
    if (types.length === 0) {
      log.warn('QueryBuilder: 空类型列表将匹配所有 entity,可能非预期');
    }
    this._world = world;
    this._types = [...types];
    world._registerQueryBuilder(this);
  }

  /** 返回匹配的 EntityId 列表。
   *  - 若 World 结构未变化(modCount 相等),返回缓存副本
   *  - 若结构变化,重新查询并更新缓存
   *  - 返回的数组始终是副本,调用方可自由修改 */
  get(): EntityId[] {
    if (this._disposed) {
      throw new Error('QueryBuilder.get: 已 dispose,不可继续使用');
    }
    const currentMod = this._world.modCount();
    if (this._cached && this._cachedAtMod === currentMod) {
      this._cacheHitCount++;
      return [...this._cached]; // 副本
    }
    // 重新查询
    this._cached = this._world.query(...this._types);
    this._cachedAtMod = currentMod;
    this._queryCount++;
    return [...this._cached];
  }

  /** 强制失效缓存。下次 get() 会重新查询。 */
  invalidate(): void {
    this._cached = null;
    this._cachedAtMod = -1;
  }

  /** 缓存命中次数(性能调试用)。 */
  get cacheHits(): number { return this._cacheHitCount; }
  /** 实际查询次数(性能调试用)。 */
  get queryCount(): number { return this._queryCount; }
  /** 是否已 dispose。 */
  get disposed(): boolean { return this._disposed; }

  /** 解除 World 注册。dispose 后再调 get() 会抛错。 */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._world._unregisterQueryBuilder(this);
    this._cached = null;
  }
}

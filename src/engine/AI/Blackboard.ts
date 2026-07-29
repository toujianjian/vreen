// Blackboard — AI 共享内存(黑板)。
//
// 设计:
//   * 行为树各节点通过黑板共享状态,避免节点间直接耦合
//   * 数据以 Map<string, unknown> 存储,提供类型安全获取方法
//   * 不强依赖 Vector3 等引擎类型,getVector3 仅做鸭子类型校验
//   * 黑板本身不感知行为树生命周期,可被多棵树共享
//
// 与 BehaviorTree 的关系:
//   * BehaviorTree 持有一个 Blackboard 实例,tick 时传入每个节点
//   * 节点通过 blackboard.get/set 读写上下文(目标/自身状态/感知结果)
//   * 黑板可作为多个 AI 实体间的消息板(发布感知/共享目标)

import { Vector3 } from '../Math';

/**
 * 黑板 — 行为树节点共享的键值存储。
 *
 * 用法:
 *   const bb = new Blackboard();
 *   bb.set('target', new Vector3(1, 0, 0));
 *   bb.set('hp', 100);
 *   const t = bb.getVector3('target'); // 类型安全
 */
export class Blackboard {
  /** 内部存储。 */
  private data: Map<string, unknown> = new Map();

  /** 获取值(不存在返回 undefined)。 */
  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  /** 设置值(覆盖已有值)。 */
  set(key: string, value: unknown): this {
    this.data.set(key, value);
    return this;
  }

  /** 是否存在该键。 */
  has(key: string): boolean {
    return this.data.has(key);
  }

  /** 移除键值(不存在不报错)。 */
  remove(key: string): this {
    this.data.delete(key);
    return this;
  }

  /** 清空所有数据。 */
  clear(): this {
    this.data.clear();
    return this;
  }

  /** 已存储键数量。 */
  get size(): number {
    return this.data.size;
  }

  /** 获取所有键(快照数组)。 */
  keys(): string[] {
    return Array.from(this.data.keys());
  }

  /** 类型安全:获取 number,不存在或类型不符返回 fallback。 */
  getNumber(key: string, fallback = 0): number {
    const v = this.data.get(key);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return fallback;
  }

  /** 类型安全:获取 string,不存在或类型不符返回 fallback。 */
  getString(key: string, fallback = ''): string {
    const v = this.data.get(key);
    if (typeof v === 'string') return v;
    return fallback;
  }

  /** 类型安全:获取 boolean,不存在或类型不符返回 fallback。 */
  getBool(key: string, fallback = false): boolean {
    const v = this.data.get(key);
    if (typeof v === 'boolean') return v;
    return fallback;
  }

  /** 类型安全:获取 Vector3,不存在或类型不符返回 fallback。
   *  鸭子类型校验:对象含 x/y/z number 字段即视为 Vector3 兼容。 */
  getVector3(key: string, fallback?: Vector3): Vector3 | undefined {
    const v = this.data.get(key);
    if (v && typeof v === 'object'
      && typeof (v as Vector3).x === 'number'
      && typeof (v as Vector3).y === 'number'
      && typeof (v as Vector3).z === 'number') {
      return v as Vector3;
    }
    return fallback;
  }
}

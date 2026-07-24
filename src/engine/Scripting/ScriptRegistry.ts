// ScriptRegistry — 脚本名 → 工厂 注册表。
//
// 设计原则：
//   - 用名字注册脚本工厂，运行时按名创建实例（解耦：场景/存档只存脚本名）。
//   - 工厂是无参函数 () => ScriptInstance，内部可构造带初始状态的脚本。
//   - 全局单例 scriptRegistry 供默认使用；也可 new ScriptRegistry() 自建独立注册表
//     （如多 World 各持一份）。
//
// 不变量：
//   - register 同名覆盖（返回是否覆盖了既有注册）。
//   - create 未知名返回 undefined（不抛错，调用方决定如何处理）。

import type { ScriptInstance } from './ScriptComponent';

/** 脚本工厂签名：返回新脚本实例。 */
export type ScriptFactory = () => ScriptInstance;

export class ScriptRegistry {
  private readonly factories: Map<string, ScriptFactory> = new Map();

  /** 注册脚本工厂。同名覆盖；返回是否覆盖了既有注册。 */
  register(name: string, factory: ScriptFactory): boolean {
    const existed = this.factories.has(name);
    this.factories.set(name, factory);
    return existed;
  }

  /** 按名创建脚本实例。未知名返回 undefined。 */
  create(name: string): ScriptInstance | undefined {
    const f = this.factories.get(name);
    return f ? f() : undefined;
  }

  /** 是否已注册该脚本名。 */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** 列出所有已注册脚本名（快照数组）。 */
  getRegistered(): string[] {
    return Array.from(this.factories.keys());
  }

  /** 取消注册某脚本名。返回是否成功移除。 */
  unregister(name: string): boolean {
    return this.factories.delete(name);
  }

  /** 清空所有注册。 */
  clear(): void {
    this.factories.clear();
  }

  /** 已注册脚本数。 */
  size(): number {
    return this.factories.size;
  }
}

/** 默认全局注册表（与 ComponentTypeRegistry 单例风格一致）。 */
export const scriptRegistry = new ScriptRegistry();

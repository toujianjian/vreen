// ComponentType — 共享的组件类型标识。在独立的文件里定义,避免
// World.ts ↔ Components.ts 互相 import 时形成循环。
//
// 设计原则:
//   - 每个 ComponentType 实例表示一个组件类型(Transform, Velocity, ...)。
//   - 全局按 name / id 双向索引,方便 World.toJSON() 还原和
//     World.loadJSON() 通过 name 查回 type。
//   - class 形式但**static fields 全部懒加载** —— 避免和 Components.ts
//     的 `new ComponentType<T>(...)` 互相 import 时,Rollup 误把 `new`
//     排到 `let X = class { ... }` 之前(那是 `Cannot access 'X'
//     before initialization` 的常见根因)。

export class ComponentType<T = unknown> {
  /** 全局唯一 id，用于内部 Map key。 */
  readonly id: number;
  /** 人类可读名（用于调试 / 序列化）。 */
  readonly name: string;

  constructor(name: string) {
    this.id = ComponentType._nextId();
    this.name = name;
    ComponentType._byName().set(name, this as unknown as ComponentType<unknown>);
    ComponentType._byId().set(this.id, this as unknown as ComponentType<unknown>);
  }

  // 全部用 module-scoped 变量,不用 class field,这样:
  //   1. class body 里的代码可以引用,但值在 module 求值时
  //      第一次访问才被初始化 → 避开 TDZ。
  //   2. Rollup 不会重排这些纯函数引用,即使 World.ts 在 Components.ts
  //      之后被 import,`new ComponentType('Transform')` 也能跑(因为
  //      `ComponentType` 本身是 class,class 的 binding 始终先于
  //      `new` 求值,见 ES2022 spec)。
  private static _nextIdImpl = 1;
  private static _byNameImpl: Map<string, ComponentType<unknown>> | null = null;
  private static _byIdImpl: Map<number, ComponentType<unknown>> | null = null;

  private static _nextId(): number {
    return ComponentType._nextIdImpl++;
  }
  private static _byName(): Map<string, ComponentType<unknown>> {
    if (ComponentType._byNameImpl === null) ComponentType._byNameImpl = new Map();
    return ComponentType._byNameImpl;
  }
  private static _byId(): Map<number, ComponentType<unknown>> {
    if (ComponentType._byIdImpl === null) ComponentType._byIdImpl = new Map();
    return ComponentType._byIdImpl;
  }

  /** 按 name 查 type；用于 World.loadJSON() 把 POJO 数据还原回强类型。 */
  static byName(name: string): ComponentType<unknown> | undefined {
    return ComponentType._byName().get(name);
  }

  /** 按 id 查 type；用于 World.toJSON() 内部把 cid 翻回 name。 */
  static byId(id: number): ComponentType<unknown> | undefined {
    return ComponentType._byId().get(id);
  }

  /** 列出当前所有已注册的 ComponentType（调试 / 工具用）。 */
  static knownTypes(): readonly ComponentType<unknown>[] {
    return Array.from(ComponentType._byId().values());
  }
}

/** 工厂函数糖:有些模块用函数式更顺手;与 `new ComponentType<T>(...)` 等价。 */
export function defineComponentType<T = unknown>(name: string): ComponentType<T> {
  return new ComponentType<T>(name);
}

/** 反查注册表(`ComponentType.byName` 的别名,模块风格统一)。 */
export const ComponentTypeRegistry = {
  byName: (name: string) => ComponentType.byName(name),
  byId: (id: number) => ComponentType.byId(id),
  knownTypes: () => ComponentType.knownTypes(),
};

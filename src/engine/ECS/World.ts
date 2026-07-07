// ECS — Entity-Component-System 核心抽象。
//
// 设计原则（贴近 Java 风格，方便服务端 / 模拟器对等实现）：
//   - Entity 是整型 ID（高位 = version，低位 = index），可序列化。
//   - Component 是纯数据 POJO；通过 ComponentType<T> 标识（运行时单例）。
//   - System 是普通 class；update(World, dt) 每帧调用。
//   - World 是显式 query：query(...types) 返回满足所有组件的 EntityId 列表。
//   - 平行架构：Entity.sceneNode 指向 scene graph 的 Object3D，渲染仍走
//     WebGL2Renderer / scene graph。Phase B 时 scene graph 退为 ECS 内部。
//
// 不变量：
//   - ComponentType.id 全局唯一；销毁 ComponentType 不允许。
//   - World.update() 内只读 Component 数据；System 想改就用 setComponent。
//   - query 每次都新建数组（避免迭代期间结构变更）。需要 hot-path 优化
//     时改用 QueryBuilder 缓存。

import { Object3D } from '../Core/Object3D';
import { AnimStateC } from './Components';

// ── EntityId ────────────────────────────────────────────────────────
/** 32-bit packed id: high 12 bits = version, low 20 bits = index.
 *  版本号在每次同 index 复用时 +1，避免 stale 引用被误认。 */
export type EntityId = number;

/** 组件名集合：含运行时对象引用（Object3D / AnimationMixer），
 *  toJSON() / loadJSON() 会跳过它们。导出 / 导入后由调用方重新 attach。 */
export const NON_POJO_COMPONENTS: ReadonlySet<string> = new Set([
  'MeshRef',
  'SkinnedMeshRef',
  'AnimState',
]);

const VERSION_BITS = 12;
const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;

export function packEntityId(index: number, version: number): EntityId {
  return ((version & ((1 << VERSION_BITS) - 1)) << INDEX_BITS) | (index & INDEX_MASK);
}
export function entityIndex(id: EntityId): number {
  return id & INDEX_MASK;
}
export function entityVersion(id: EntityId): number {
  return (id >>> INDEX_BITS) & ((1 << VERSION_BITS) - 1);
}
export function isValidEntityId(id: EntityId, current: { version: number }): boolean {
  return entityVersion(id) === current.version;
}

// ── ComponentType ───────────────────────────────────────────────────
/** 组件类型标识。每个逻辑类型一个 ComponentType 实例。
 *  全局按 name / id 双向索引，方便 World.toJSON() 还原和
 *  World.loadJSON() 通过 name 查回 type。 */
export class ComponentType<T> {
  private static _nextId = 1;
  private static _byName = new Map<string, ComponentType<unknown>>();
  private static _byId = new Map<number, ComponentType<unknown>>();

  /** 全局唯一 id，用于内部 Map key。 */
  readonly id: number;
  /** 人类可读名（用于调试 / 序列化）。 */
  readonly name: string;

  constructor(name: string) {
    this.id = ComponentType._nextId++;
    this.name = name;
    ComponentType._byName.set(name, this as unknown as ComponentType<unknown>);
    ComponentType._byId.set(this.id, this as unknown as ComponentType<unknown>);
  }

  /** 按 name 查 type；用于 World.loadJSON() 把 POJO 数据还原回强类型。 */
  static byName(name: string): ComponentType<unknown> | undefined {
    return ComponentType._byName.get(name);
  }

  /** 按 id 查 type；用于 World.toJSON() 内部把 cid 翻回 name。 */
  static byId(id: number): ComponentType<unknown> | undefined {
    return ComponentType._byId.get(id);
  }

  /** 列出当前所有已注册的 ComponentType（调试 / 工具用）。 */
  static knownTypes(): readonly ComponentType<unknown>[] {
    return Array.from(ComponentType._byId.values());
  }
}

/** Component factory 签名：返回该组件的空实例 (POJO)。
 *  World.loadJSON() 会调用 factory() 拿模板，然后用 JSON 数据 Object.assign 覆盖字段。
 *  只接受纯数据组件（Transform / Velocity / Health / Tag / Lifetime / PlayerInput）。
 *  含 Object3D / AnimationMixer 引用的组件（MeshRef / SkinnedMeshRef / AnimState）不参与序列化。 */
export type ComponentFactory = () => object;

/** POJO 组件名注册表，World.loadJSON 需要。 */
export type ComponentRegistry = Record<string, ComponentFactory>;

/** 内部存储：每个 ComponentType 一张 EntityId → T 映射。 */
type ComponentStore<T> = Map<EntityId, T>;
type AnyComponentStore = Map<EntityId, unknown>;

// ── EntityRecord ────────────────────────────────────────────────────
interface EntityRecord {
  /** 实体在 World.entities Map 里的 index（与 version 配对形成 id）。 */
  id: EntityId;
  name: string;
  /** 指向 scene graph 的 Object3D；World.createEntity 时创建并 add 进 root。 */
  sceneNode: Object3D;
  /** 该实体已注册的 ComponentType 列表（用于快速 query 匹配）。 */
  componentSet: Set<number>;
}

// ── System ──────────────────────────────────────────────────────────
export abstract class System {
  /** System 名（用于调试 / 排序）。 */
  readonly name: string;
  /** 优先级：值小的先 update。默认 0。 */
  readonly priority: number;
  /** 是否启用。 */
  enabled: boolean = true;

  constructor(name: string, priority: number = 0) {
    this.name = name;
    this.priority = priority;
  }

  abstract update(world: World, dt: number): void;

  /** System 启用时调用一次（可空实现）。 */
  onAttach?(world: World): void;
  /** System 销毁时调用一次（可空实现）。 */
  onDetach?(world: World): void;
}

// ── World ───────────────────────────────────────────────────────────
export interface WorldOptions {
  /** World 名（调试用）。 */
  name?: string;
}

export class World {
  name: string;

  /** 内部连续 index → record。空闲 index 放回 freeList。 */
  private _records: (EntityRecord | null)[] = [];
  /** 当前每个 index 的 version；复用时 +1。 */
  private _versions: number[] = [];
  /** 空闲 index 栈。 */
  private _freeList: number[] = [];
  /** 当前最大 index + 1。 */
  private _nextIndex: number = 0;

  /** 按 ComponentType.id 分桶存储。 */
  private _components: Map<number, AnyComponentStore> = new Map();

  /** Systems，按 priority 升序排列。 */
  private _systems: System[] = [];
  private _systemMap: Map<System, number> = new Map();

  /** 每帧 +1，方便 system 判断本帧数据是否变化。 */
  private _frame: number = 0;

  /** 场景根节点（新 entity.sceneNode 会被 add 到这里）。 */
  readonly sceneRoot: Object3D;

  constructor(opts: WorldOptions = {}) {
    this.name = opts.name ?? 'World';
    this.sceneRoot = new Object3D();
    this.sceneRoot.name = 'WorldRoot';
  }

  // ── Entity 生命周期 ────────────────────────────────────────────
  /** 创建实体。返回的 EntityId 是稳定的、序列化的。 */
  createEntity(name?: string): EntityId {
    const idx = this._freeList.length > 0 ? this._freeList.pop()! : this._nextIndex++;
    let version = this._versions[idx] ?? 0;
    const id = packEntityId(idx, version);
    const sceneNode = new Object3D();
    sceneNode.name = name ?? `Entity_${idx}`;
    this.sceneRoot.add(sceneNode);
    const rec: EntityRecord = { id, name: sceneNode.name, sceneNode, componentSet: new Set() };
    this._records[idx] = rec;
    return id;
  }

  /** 销毁实体。复用其 index，version +1。 */
  destroyEntity(id: EntityId): void {
    if (!this._isLive(id)) return;
    const idx = entityIndex(id);
    const rec = this._records[idx]!;
    // 清除所有 component
    for (const cid of rec.componentSet) {
      this._components.get(cid)?.delete(id);
    }
    rec.componentSet.clear();
    // 从 scene graph 移除
    rec.sceneNode.parent?.remove(rec.sceneNode);
    this._records[idx] = null;
    this._versions[idx] = (this._versions[idx] ?? 0) + 1;
    this._freeList.push(idx);
  }

  /** 检查 EntityId 是否还指向有效实体。 */
  isAlive(id: EntityId): boolean {
    return this._isLive(id);
  }

  /** 取得实体的 Object3D scene 节点。 */
  getSceneNode(id: EntityId): Object3D | null {
    const rec = this._recordOf(id);
    return rec ? rec.sceneNode : null;
  }

  /** 设置实体名（同时设置 scene node 名）。 */
  setName(id: EntityId, name: string): void {
    const rec = this._recordOf(id);
    if (!rec) return;
    rec.name = name;
    rec.sceneNode.name = name;
  }

  getName(id: EntityId): string | null {
    const rec = this._recordOf(id);
    return rec ? rec.name : null;
  }

  /** 当前存活的实体总数。 */
  entityCount(): number {
    return this._nextIndex - this._freeList.length;
  }

  /** 遍历所有活实体（按 id 升序）。 */
  forEachEntity(fn: (id: EntityId, name: string) => void): void {
    for (let i = 0; i < this._records.length; i++) {
      const r = this._records[i];
      if (r) fn(r.id, r.name);
    }
  }

  // ── 调试 / Inspector 用 API ──────────────────────────────────
  /** 列出当前所有活实体的快照（id + name + 持有的组件名）。组件名按
   *  ComponentType.name 给出;非 POJO (MeshRef / SkinnedMeshRef / AnimState)
   *  也包含,Inspector 看到会标 "runtime ref" 不展开。
   *  返回新数组,调用方可以自由缓存。 */
  listEntities(): EntitySummary[] {
    const out: EntitySummary[] = [];
    for (let i = 0; i < this._records.length; i++) {
      const r = this._records[i];
      if (!r) continue;
      const compNames: string[] = [];
      for (const cid of r.componentSet) {
        const t = ComponentType.byId(cid);
        if (t) compNames.push(t.name);
      }
      compNames.sort();
      out.push({ id: r.id, name: r.name, components: compNames });
    }
    return out;
  }

  /** 拿单个实体的完整快照:identity + sceneNode TRS + 所有 POJO 组件
   *  的可序列化数据。Inspector 拿来画 ECSPanel 详情。 */
  getEntitySnapshot(id: EntityId): EntitySnapshot | null {
    const rec = this._recordOf(id);
    if (!rec) return null;
    const node = rec.sceneNode;
    const components: Record<string, unknown> = {};
    for (const cid of rec.componentSet) {
      const t = ComponentType.byId(cid);
      if (!t) continue;
      // 非 POJO 不展开:Inspector 显示 "runtime ref" 提示。
      if (NON_POJO_COMPONENTS.has(t.name)) {
        components[t.name] = { __ref: true, kind: t.name };
        continue;
      }
      const store = this._components.get(cid);
      if (!store) continue;
      components[t.name] = store.get(id);
    }
    return {
      id: rec.id,
      name: rec.name,
      version: entityVersion(rec.id),
      index: entityIndex(rec.id),
      sceneNode: {
        position: [node.position.x, node.position.y, node.position.z],
        rotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.w],
        scale: [node.scale.x, node.scale.y, node.scale.z],
      },
      components,
    };
  }

  /** 读 entity 的 AnimState 运行时快照(给 Inspector 渲染用)。
   *  返回 null 表示该 entity 没 AnimState / 没 state machine。
   *  AnimState 是非 POJO,getEntitySnapshot 不会展开;这里直接读。 */
  getAnimStateRuntime(id: EntityId): AnimStateRuntime | null {
    const anim = this.getComponent(id, AnimStateC);
    if (!anim || !anim.stateMachine) return null;
    const sm = anim.stateMachine;
    return {
      currentState: sm.current ? sm.current.name : null,
      pendingState: sm.pendingState ? sm.pendingState.name : null,
      transitionT: sm.transitionT,
      stateNames: sm.listStateNames(),
      clipCount: anim.clips.size,
      currentClipTime: sm.current
        ? sm.mixer.actionFor(sm.current.clip).time
        : 0,
    };
  }

  // ── Component 增删改查 ─────────────────────────────────────────
  /** 给实体添加 / 替换组件数据。 */
  setComponent<T>(id: EntityId, type: ComponentType<T>, data: T): void {
    const rec = this._recordOf(id);
    if (!rec) throw new Error(`World.setComponent: entity ${id} not alive`);
    let store = this._components.get(type.id);
    if (!store) {
      store = new Map<EntityId, T>();
      this._components.set(type.id, store);
    }
    store.set(id, data);
    rec.componentSet.add(type.id);
  }

  /** 读取组件数据。 */
  getComponent<T>(id: EntityId, type: ComponentType<T>): T | undefined {
    const store = this._components.get(type.id) as ComponentStore<T> | undefined;
    return store?.get(id);
  }

  /** 检查是否拥有该组件。 */
  hasComponent<T>(id: EntityId, type: ComponentType<T>): boolean {
    return this._components.get(type.id)?.has(id) ?? false;
  }

  /** 移除组件。 */
  removeComponent<T>(id: EntityId, type: ComponentType<T>): boolean {
    const rec = this._recordOf(id);
    if (!rec) return false;
    const store = this._components.get(type.id);
    if (!store?.delete(id)) return false;
    rec.componentSet.delete(type.id);
    return true;
  }

  /** 同时读多个组件；任一缺失则返回 null。 */
  getComponents<A, B>(id: EntityId, a: ComponentType<A>, b: ComponentType<B>): [A, B] | null {
    const sa = this._components.get(a.id) as ComponentStore<A> | undefined;
    const sb = this._components.get(b.id) as ComponentStore<B> | undefined;
    if (!sa || !sb) return null;
    const va = sa.get(id), vb = sb.get(id);
    return va !== undefined && vb !== undefined ? [va, vb] : null;
  }

  // ── Query ──────────────────────────────────────────────────────
  /** 返回同时拥有所有传入组件类型的实体 ID 列表（每次新建数组）。 */
  query(...types: ComponentType<unknown>[]): EntityId[] {
    if (types.length === 0) {
      const out: EntityId[] = [];
      for (let i = 0; i < this._records.length; i++) {
        const r = this._records[i];
        if (r) out.push(r.id);
      }
      return out;
    }
    // 取组件存储最少的类型作为驱动
    let driver: AnyComponentStore | null = null;
    for (const t of types) {
      const s = this._components.get(t.id);
      if (!s) return [];
      if (!driver || s.size < driver.size) driver = s;
    }
    const out: EntityId[] = [];
    for (const id of driver!.keys()) {
      const rec = this._recordOf(id);
      if (!rec) continue;
      let ok = true;
      for (const t of types) {
        if (!rec.componentSet.has(t.id)) { ok = false; break; }
      }
      if (ok) out.push(id);
    }
    return out;
  }

  /** query 但直接 yield (id, ...components) 元组，零分配回调。 */
  queryWith<A>(
    a: ComponentType<A>,
    fn: (id: EntityId, a: A) => void,
  ): void {
    const sa = this._components.get(a.id) as ComponentStore<A> | undefined;
    if (!sa) return;
    for (const [id, va] of sa) {
      const rec = this._recordOf(id);
      if (!rec || !rec.componentSet.has(a.id)) continue;
      fn(id, va);
    }
  }
  queryWith2<A, B>(
    a: ComponentType<A>, b: ComponentType<B>,
    fn: (id: EntityId, a: A, b: B) => void,
  ): void {
    const sa = this._components.get(a.id) as ComponentStore<A> | undefined;
    const sb = this._components.get(b.id) as ComponentStore<B> | undefined;
    if (!sa || !sb) return;
    // 用较小集合作驱动
    const [driver, other, typeOther] = sa.size <= sb.size
      ? [sa, sb, b] as const
      : [sb, sa, a] as const;
    for (const id of driver.keys()) {
      const rec = this._recordOf(id);
      if (!rec || !rec.componentSet.has(a.id) || !rec.componentSet.has(b.id)) continue;
      // fn 签名固定 (id, A, B)，不论 driver 是哪个集合都按 sa(sb) 顺序传。
      fn(id, sa.get(id)!, sb.get(id)!);
    }
  }

  // ── System 生命周期 ────────────────────────────────────────────
  addSystem(s: System): void {
    if (this._systemMap.has(s)) return;
    this._systems.push(s);
    this._systems.sort((x, y) => x.priority - y.priority);
    this._systemMap.set(s, this._systems.indexOf(s));
    s.onAttach?.(this);
  }

  removeSystem(s: System): boolean {
    const idx = this._systemMap.get(s);
    if (idx === undefined) return false;
    s.onDetach?.(this);
    this._systems.splice(idx, 1);
    this._systemMap.delete(s);
    // 重排
    for (let i = idx; i < this._systems.length; i++) this._systemMap.set(this._systems[i], i);
    return true;
  }

  getSystems(): readonly System[] {
    return this._systems;
  }

  // ── 帧驱动 ─────────────────────────────────────────────────────
  /** 当前帧号（自 World 创建起累加）。 */
  frame(): number {
    return this._frame;
  }

  /** 推进所有 System。 */
  update(dt: number): void {
    this._frame++;
    for (const s of this._systems) {
      if (s.enabled) s.update(this, dt);
    }
  }

  // ── 序列化 (POJO-friendly) ────────────────────────────────────
  /** 导出为纯 JSON 友好的对象（POJO），不携带 Object3D 引用。
   *  序列化后的 sceneNode 字段只有 name + 变换信息。
   *  非 POJO 组件 (MeshRef / SkinnedMeshRef / AnimState) 会被跳过 —
   *  它们绑定到运行时 Object3D / AnimationMixer，不在 .vreen 里持久化。 */
  toJSON(): WorldJson {
    const entities: WorldEntityJson[] = [];
    for (let i = 0; i < this._records.length; i++) {
      const r = this._records[i];
      if (!r) continue;
      const e: WorldEntityJson = {
        id: r.id, name: r.name,
        sceneNode: {
          position: [r.sceneNode.position.x, r.sceneNode.position.y, r.sceneNode.position.z],
          rotation: [r.sceneNode.rotation.x, r.sceneNode.rotation.y, r.sceneNode.rotation.z, r.sceneNode.rotation.w],
          scale: [r.sceneNode.scale.x, r.sceneNode.scale.y, r.sceneNode.scale.z],
        },
        components: {},
      };
      for (const cid of r.componentSet) {
        const store = this._components.get(cid);
        const type = ComponentType.byId(cid);
        if (!store || !type) continue;
        // 跳过非 POJO 组件（含 Object3D / AnimationMixer 引用）。
        if (NON_POJO_COMPONENTS.has(type.name)) continue;
        e.components[type.name] = store.get(r.id);
      }
      entities.push(e);
    }
    return {
      version: '0.2.0',
      name: this.name,
      frame: this._frame,
      entities,
    };
  }

  /** 从 WorldJson 重建 entity + 组件。会先清空当前 World。
   *  @param json     World.toJSON() 产物
   *  @param registry 组件名 → factory 的注册表（导出导入都要用同一份）。
   *                  注册表里没有的组件名会被跳过并 warn。
   *                  含 Object3D 引用的组件名（MeshRef / SkinnedMeshRef / AnimState）
   *                  即使在注册表里也会被跳过 — 它们在 .vreen 里不持久化。 */
  loadJSON(json: WorldJson, registry: ComponentRegistry): void {
    if (json.version !== '0.2.0') {
      throw new Error(`World.loadJSON: unsupported version "${json.version}" (expected "0.2.0")`);
    }

    // 清空当前 World
    for (let i = 0; i < this._records.length; i++) {
      const r = this._records[i];
      if (!r) continue;
      for (const cid of r.componentSet) {
        this._components.get(cid)?.delete(r.id);
      }
      r.componentSet.clear();
      r.sceneNode.parent?.remove(r.sceneNode);
    }
    this._records = [];
    this._versions = [];
    this._freeList = [];
    this._nextIndex = 0;
    this._components.clear();
    this._systems = [];
    this._systemMap.clear();
    this._frame = 0;
    this.name = json.name;

    for (const e of json.entities) {
      const id = this.createEntity(e.name);
      const node = this.getSceneNode(id);
      if (node) {
        node.position.set(
          e.sceneNode.position[0], e.sceneNode.position[1], e.sceneNode.position[2],
        );
        node.rotation.set(
          e.sceneNode.rotation[0], e.sceneNode.rotation[1],
          e.sceneNode.rotation[2], e.sceneNode.rotation[3],
        );
        node.scale.set(
          e.sceneNode.scale[0], e.sceneNode.scale[1], e.sceneNode.scale[2],
        );
      }

      for (const [compName, raw] of Object.entries(e.components)) {
        if (NON_POJO_COMPONENTS.has(compName)) {
          // 不参与 .vreen 序列化；调用方需要在 import 后重新 attach
          continue;
        }
        const type = ComponentType.byName(compName);
        if (!type) {
          console.warn(`[World.loadJSON] unknown component "${compName}" — skipped. ` +
            `Make sure it's imported once so ComponentType is registered.`);
          continue;
        }
        const factory = registry[compName];
        if (!factory) {
          console.warn(`[World.loadJSON] no factory for component "${compName}" — skipped. ` +
            `Add it to the ComponentRegistry.`);
          continue;
        }
        const instance = factory();
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          Object.assign(instance, raw as object);
        }
        // setComponent 强类型签名 <T>，用 loose cast 把 unknown 数据塞进去
        (this.setComponent as (i: EntityId, t: ComponentType<unknown>, d: unknown) => void)
          (id, type as ComponentType<unknown>, instance);
      }
    }

    // 还原 frame 计数（不算入已重建的 entity 数量）
    this._frame = json.frame;
  }

  // ── 内部 ───────────────────────────────────────────────────────
  private _recordOf(id: EntityId): EntityRecord | null {
    if (!this._isLive(id)) return null;
    return this._records[entityIndex(id)] ?? null;
  }
  private _isLive(id: EntityId): boolean {
    if (id == null) return false;
    const idx = entityIndex(id);
    if (idx < 0 || idx >= this._records.length) return false;
    return entityVersion(id) === (this._versions[idx] ?? 0) && this._records[idx] !== null;
  }
}

// ── JSON POJO 形式（Java 端可读写） ───────────────────────────────
export interface WorldJson {
  version: '0.2.0';
  name: string;
  frame: number;
  entities: WorldEntityJson[];
}
export interface WorldEntityJson {
  id: EntityId;
  name: string;
  sceneNode: {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  };
  /** key = ComponentType.name, value = 组件数据本身。 */
  components: Record<string, unknown>;
}

// ── 调试 / Inspector 用 POJO 快照（同步读取，不持久化） ─────────
/** 实体简要列表：id + name + 组件名。 */
export interface EntitySummary {
  id: EntityId;
  name: string;
  components: string[];
}

/** 单个实体完整快照：identity + sceneNode TRS + 各组件数据。
 *  非 POJO 组件的 value 是 `{ __ref: true, kind: 'MeshRef' | 'SkinnedMeshRef' | 'AnimState' }`。 */
export interface EntitySnapshot {
  id: EntityId;
  name: string;
  /** packed id 的解包分量,给 UI 调试用。 */
  version: number;
  index: number;
  sceneNode: {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  };
  components: Record<string, unknown>;
}

/** AnimState runtime 数据 (给 Inspector 画 state machine 面板用)。 */
export interface AnimStateRuntime {
  currentState: string | null;
  /** 正在过渡到的目标 state;null = 稳定态。 */
  pendingState: string | null;
  /** 剩余过渡时间 (秒);<=0 = 稳定。 */
  transitionT: number;
  /** 注册的所有 state 名。 */
  stateNames: string[];
  /** AnimState.clips 里的 clip 数。 */
  clipCount: number;
  /** 当前 state 对应 action 的播放时间 (秒)。 */
  currentClipTime: number;
}

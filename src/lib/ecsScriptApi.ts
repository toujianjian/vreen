// EcsScriptAPI — Blockly 脚本与 ECS World 之间的桥接层。
//
// Phase 3.1: Blockly 积木 → ECS Component 绑定
// Phase 3.2: Tick 事件回调(通过 onTick 注册)
//
// 设计:
//   • 纯逻辑类,不依赖 React/zustand,方便单元测试
//   • VREEN API (vreenBlockly.ts) 内部用这个类操作 World
//   • 组件数据通过 JSON 字符串交换(Blockly 积木只支持 string/number/array)
//   • 常用操作(position/health/tag/velocity)有专用方法,避免每次拼 JSON

import {
  World,
  type EntityId,
  ComponentTypeRegistry,
  Transform,
  TransformC,
  Velocity,
  VelocityC,
  Health,
  HealthC,
  Tag,
  TagC,
  Lifetime,
  PlayerInput,
  MeshRef,
  MeshRefC,
  SkinnedMeshRef,
  SkinnedMeshRefC,
  AnimState,
  AnimStateC,
} from '@/engine/ECS';
import { StandardMaterial } from '@/engine/Materials/StandardMaterial';
import { AnimationStateMachine } from '@/engine/Animation/AnimationStateMachine';
import type { AnimationClip } from '@/engine/Animation/AnimationClip';
import type { Material } from '@/engine/Core/Material';
import type { Mesh } from '@/engine/Core/Mesh';

/** Tick 回调签名。 */
export type TickCallback = (dt: number) => void;

export class EcsScriptAPI {
  /** Tick 回调列表。Phase 3.2 用。 */
  private tickCallbacks: TickCallback[] = [];

  constructor(private world: World) {}

  /** 当前绑定的 World(只读,用于缓存键比较)。 */
  getWorld(): World { return this.world; }

  // ── Entity 管理 ──────────────────────────────────────────────

  /** 创建一个新 entity,返回其 id。 */
  createEntity(name?: string): EntityId {
    return this.world.createEntity(name);
  }

  /** 销毁 entity。返回是否成功(entity 不存在时返回 false)。 */
  destroyEntity(id: EntityId): boolean {
    if (!this.world.isAlive(id)) return false;
    this.world.destroyEntity(id);
    return true;
  }

  /** 获取 entity 名。 */
  getEntityName(id: EntityId): string {
    return this.world.getName(id) ?? '';
  }

  /** 设置 entity 名。 */
  setEntityName(id: EntityId, name: string): void {
    this.world.setName(id, name);
  }

  /** 当前存活 entity 数。 */
  entityCount(): number {
    return this.world.entityCount();
  }

  /** 列出所有存活 entity 的 id。 */
  listEntities(): EntityId[] {
    const ids: EntityId[] = [];
    this.world.forEachEntity((id) => ids.push(id));
    return ids;
  }

  // ── 通用组件操作 ─────────────────────────────────────────────

  /** 添加/设置组件。dataJson 是组件字段的 JSON(可选,缺省=空实例)。
   *  返回是否成功(组件名未知或 JSON 无效时返回 false)。 */
  setComponent(id: EntityId, compName: string, dataJson?: string): boolean {
    const type = ComponentTypeRegistry.byName(compName);
    if (!type) return false;
    const instance = this.createComponentFromJson(compName, dataJson);
    if (!instance) return false;
    this.world.setComponent(id, type, instance);
    return true;
  }

  /** 获取组件的 JSON 字符串。无组件或未知类型返回 null。 */
  getComponent(id: EntityId, compName: string): string | null {
    const type = ComponentTypeRegistry.byName(compName);
    if (!type) return null;
    const comp = this.world.getComponent(id, type);
    if (!comp) return null;
    try {
      return JSON.stringify(comp);
    } catch {
      return null;
    }
  }

  /** 移除组件。返回是否成功(组件不存在或类型未知时返回 false)。 */
  removeComponent(id: EntityId, compName: string): boolean {
    const type = ComponentTypeRegistry.byName(compName);
    if (!type) return false;
    return this.world.removeComponent(id, type);
  }

  /** 检查 entity 是否有指定组件。 */
  hasComponent(id: EntityId, compName: string): boolean {
    const type = ComponentTypeRegistry.byName(compName);
    if (!type) return false;
    return this.world.hasComponent(id, type);
  }

  /** 查询拥有指定组件的所有 entity id。 */
  queryEntities(compName: string): EntityId[] {
    const type = ComponentTypeRegistry.byName(compName);
    if (!type) return [];
    return this.world.query(type);
  }

  /** 列出所有已注册的组件名。 */
  listComponentNames(): string[] {
    const names: string[] = [];
    for (const t of ComponentTypeRegistry.knownTypes()) {
      names.push(t.name);
    }
    return names;
  }

  // ── Transform 专用 ───────────────────────────────────────────

  /** 设置 entity 位置(同时更新 Transform 组件和 sceneNode)。 */
  setEntityPosition(id: EntityId, x: number, y: number, z: number): boolean {
    let t = this.world.getComponent(id, TransformC) as Transform | undefined;
    if (!t) {
      t = new Transform();
      this.world.setComponent(id, TransformC, t);
    }
    t.position = [x, y, z];
    const node = this.world.getSceneNode(id);
    if (node) node.position.set(x, y, z);
    return true;
  }

  /** 获取 entity 位置。优先读 Transform 组件,降级读 sceneNode。 */
  getEntityPosition(id: EntityId): [number, number, number] {
    const t = this.world.getComponent(id, TransformC) as Transform | undefined;
    if (t) return [...t.position];
    const node = this.world.getSceneNode(id);
    if (node) return [node.position.x, node.position.y, node.position.z];
    return [0, 0, 0];
  }

  /** 设置 entity 缩放。 */
  setEntityScale(id: EntityId, x: number, y: number, z: number): boolean {
    let t = this.world.getComponent(id, TransformC) as Transform | undefined;
    if (!t) {
      t = new Transform();
      this.world.setComponent(id, TransformC, t);
    }
    t.scale = [x, y, z];
    const node = this.world.getSceneNode(id);
    if (node) node.scale.set(x, y, z);
    return true;
  }

  // ── Health 专用 ──────────────────────────────────────────────

  /** 设置 entity 生命值。 */
  setEntityHealth(id: EntityId, hp: number, maxHp?: number): boolean {
    let h = this.world.getComponent(id, HealthC) as Health | undefined;
    if (!h) {
      h = new Health(maxHp ?? hp);
      this.world.setComponent(id, HealthC, h);
    }
    h.hp = hp;
    if (maxHp !== undefined) h.maxHp = maxHp;
    return true;
  }

  /** 获取 entity 生命值。 */
  getEntityHealth(id: EntityId): { hp: number; maxHp: number } | null {
    const h = this.world.getComponent(id, HealthC) as Health | undefined;
    if (!h) return null;
    return { hp: h.hp, maxHp: h.maxHp };
  }

  /** 对 entity 造成伤害。 */
  damageEntity(id: EntityId, amount: number): boolean {
    const h = this.world.getComponent(id, HealthC) as Health | undefined;
    if (!h) return false;
    h.hp -= amount;
    return true;
  }

  /** 治疗 entity。 */
  healEntity(id: EntityId, amount: number): boolean {
    const h = this.world.getComponent(id, HealthC) as Health | undefined;
    if (!h) return false;
    h.hp = Math.min(h.hp + amount, h.maxHp);
    return true;
  }

  // ── Tag 专用 ─────────────────────────────────────────────────

  /** 设置 entity 的 Tag 值。 */
  setEntityTag(id: EntityId, value: string): boolean {
    let tag = this.world.getComponent(id, TagC) as Tag | undefined;
    if (!tag) {
      tag = new Tag(value);
      this.world.setComponent(id, TagC, tag);
    }
    tag.value = value;
    return true;
  }

  /** 获取 entity 的 Tag 值。 */
  getEntityTag(id: EntityId): string | null {
    const tag = this.world.getComponent(id, TagC) as Tag | undefined;
    return tag ? tag.value : null;
  }

  /** 查询所有拥有指定 Tag 值的 entity。 */
  queryByTag(value: string): EntityId[] {
    const result: EntityId[] = [];
    this.world.queryWith(TagC, (id, tag) => {
      if (tag.value === value) result.push(id);
    });
    return result;
  }

  // ── Velocity 专用 ────────────────────────────────────────────

  /** 设置 entity 速度。 */
  setEntityVelocity(id: EntityId, x: number, y: number, z: number): boolean {
    let v = this.world.getComponent(id, VelocityC) as Velocity | undefined;
    if (!v) {
      v = new Velocity();
      this.world.setComponent(id, VelocityC, v);
    }
    v.linear = [x, y, z];
    return true;
  }

  /** 获取 entity 速度。 */
  getEntityVelocity(id: EntityId): [number, number, number] | null {
    const v = this.world.getComponent(id, VelocityC) as Velocity | undefined;
    return v ? [...v.linear] : null;
  }

  // ── 材质操作 (Phase 3.3) ─────────────────────────────────────

  /** 取 entity 主材质(数组时取第一个)。非 StandardMaterial 返回 null。 */
  private getStandardMaterial(id: EntityId): StandardMaterial | null {
    const ref = this.world.getComponent(id, MeshRefC) as MeshRef | undefined;
    if (!ref) return null;
    const mat = this.firstMaterial(ref.mesh);
    return mat instanceof StandardMaterial ? mat : null;
  }

  private firstMaterial(mesh: Mesh): Material | undefined {
    const m = mesh.material;
    return Array.isArray(m) ? m[0] : m;
  }

  /** 设置 entity 的 baseColor (rgb 0..1)。 */
  setEntityMaterialColor(id: EntityId, r: number, g: number, b: number): boolean {
    const mat = this.getStandardMaterial(id);
    if (!mat) return false;
    mat.baseColor = { r, g, b };
    return true;
  }

  /** 设置 entity 的金属度 (0..1)。 */
  setEntityMaterialMetallic(id: EntityId, value: number): boolean {
    const mat = this.getStandardMaterial(id);
    if (!mat) return false;
    mat.metallic = Math.max(0, Math.min(1, value));
    return true;
  }

  /** 设置 entity 的粗糙度 (0..1)。 */
  setEntityMaterialRoughness(id: EntityId, value: number): boolean {
    const mat = this.getStandardMaterial(id);
    if (!mat) return false;
    mat.roughness = Math.max(0, Math.min(1, value));
    return true;
  }

  /** 设置 entity 的自发光颜色 (rgb 0..1) + 强度。 */
  setEntityMaterialEmissive(id: EntityId, r: number, g: number, b: number, intensity: number): boolean {
    const mat = this.getStandardMaterial(id);
    if (!mat) return false;
    mat.emissive = { r, g, b };
    mat.emissiveIntensity = Math.max(0, intensity);
    return true;
  }

  /** 设置 entity 的不透明度 (0..1)。 */
  setEntityMaterialOpacity(id: EntityId, value: number): boolean {
    const mat = this.getStandardMaterial(id);
    if (!mat) return false;
    mat.opacity = Math.max(0, Math.min(1, value));
    return true;
  }

  /** 切换 entity 材质线框模式。 */
  setEntityMaterialWireframe(id: EntityId, on: boolean): boolean {
    const mat = this.getStandardMaterial(id);
    if (!mat) return false;
    mat.wireframe = on;
    return true;
  }

  /** 获取金属度。 */
  getEntityMaterialMetallic(id: EntityId): number {
    return this.getStandardMaterial(id)?.metallic ?? 0;
  }

  /** 获取粗糙度。 */
  getEntityMaterialRoughness(id: EntityId): number {
    return this.getStandardMaterial(id)?.roughness ?? 0;
  }

  /** 获取不透明度。 */
  getEntityMaterialOpacity(id: EntityId): number {
    return this.getStandardMaterial(id)?.opacity ?? 1;
  }

  /** 获取 baseColor (rgb 0..1)。 */
  getEntityMaterialColor(id: EntityId): [number, number, number] {
    const mat = this.getStandardMaterial(id);
    if (!mat) return [0.8, 0.8, 0.8];
    return [mat.baseColor.r, mat.baseColor.g, mat.baseColor.b];
  }

  /** 用新 StandardMaterial 替换 entity 的主材质。返回是否成功。 */
  assignNewStandardMaterial(id: EntityId): boolean {
    const ref = this.world.getComponent(id, MeshRefC) as MeshRef | undefined;
    if (!ref) return false;
    const mat = new StandardMaterial();
    if (Array.isArray(ref.mesh.material)) {
      ref.mesh.material[0] = mat;
    } else {
      ref.mesh.material = mat;
    }
    return true;
  }

  // ── 动画状态机 (Phase 3.4) ───────────────────────────────────

  /** 取 entity 的 AnimState(无则创建)。需要 SkinnedMeshRef 提供 mixer。 */
  private getOrCreateAnimState(id: EntityId): AnimState | null {
    let anim = this.world.getComponent(id, AnimStateC) as AnimState | undefined;
    if (anim) return anim;
    // 没有 AnimState,尝试从 SkinnedMeshRef 创建
    const ref = this.world.getComponent(id, SkinnedMeshRefC) as SkinnedMeshRef | undefined;
    if (!ref) return null;
    anim = new AnimState();
    anim.stateMachine = new AnimationStateMachine(ref.mixer);
    this.world.setComponent(id, AnimStateC, anim);
    return anim;
  }

  /** 取 entity 已有的 AnimState(不创建)。 */
  private getAnimState(id: EntityId): AnimState | null {
    const anim = this.world.getComponent(id, AnimStateC) as AnimState | undefined;
    return anim ?? null;
  }

  /** 为 entity 初始化动画状态机(从 SkinnedMeshRef 取 mixer)。
   *  返回是否成功(无 SkinnedMeshRef 或已有 SM 时返回 false)。 */
  initAnimStateMachine(id: EntityId): boolean {
    const ref = this.world.getComponent(id, SkinnedMeshRefC) as SkinnedMeshRef | undefined;
    if (!ref) return false;
    let anim = this.world.getComponent(id, AnimStateC) as AnimState | undefined;
    if (anim && anim.stateMachine) return false; // 已有 SM
    if (!anim) {
      anim = new AnimState();
      this.world.setComponent(id, AnimStateC, anim);
    }
    anim.stateMachine = new AnimationStateMachine(ref.mixer);
    return true;
  }

  /** 给 entity 的状态机添加状态。
   *  clipName 必须已在 AnimState.clips 中注册(由 SceneContents 加载时填充)。
   *  loop: 'once' | 'repeat' | 'pingpong' */
  addAnimState(id: EntityId, stateName: string, clipName: string, loop: 'once' | 'repeat' | 'pingpong', timeScale: number = 1): boolean {
    const anim = this.getOrCreateAnimState(id);
    if (!anim || !anim.stateMachine) return false;
    const clip = anim.clips.get(clipName);
    if (!clip) return false;
    anim.stateMachine.add({ name: stateName, clip, loop, timeScale });
    return true;
  }

  /** 给 entity 的状态机添加过渡。duration=0 表示立即切换。 */
  addAnimTransition(id: EntityId, from: string, to: string, duration: number = 0): boolean {
    const anim = this.getAnimState(id);
    if (!anim?.stateMachine) return false;
    anim.stateMachine.on({ from, to, duration });
    return true;
  }

  /** 让 entity 进入指定状态。 */
  enterAnimState(id: EntityId, stateName: string): boolean {
    const anim = this.getAnimState(id);
    if (!anim?.stateMachine) return false;
    return anim.stateMachine.enter(stateName);
  }

  /** 获取 entity 当前动画状态名。无 SM 或无当前状态返回空字符串。 */
  getCurrentAnimState(id: EntityId): string {
    const anim = this.getAnimState(id);
    if (!anim?.stateMachine) return '';
    return anim.stateMachine.current?.name ?? '';
  }

  /** 列出 entity 状态机的所有状态名。 */
  listAnimStates(id: EntityId): string[] {
    const anim = this.getAnimState(id);
    if (!anim?.stateMachine) return [];
    return anim.stateMachine.listStateNames();
  }

  /** 注册 clip 到 entity 的 AnimState.clips(供 addAnimState 引用)。
   *  clipName 是用户给的名字,clip 是 AnimationClip 实例。 */
  registerAnimClip(id: EntityId, clipName: string, clip: AnimationClip): boolean {
    const anim = this.getOrCreateAnimState(id);
    if (!anim) return false;
    anim.clips.set(clipName, clip);
    return true;
  }

  /** 列出 entity 已注册的 clip 名。 */
  listAnimClips(id: EntityId): string[] {
    const anim = this.getAnimState(id);
    if (!anim) return [];
    return Array.from(anim.clips.keys());
  }

  // ── Tick 回调 (Phase 3.2) ────────────────────────────────────

  /** 注册一个每帧回调。返回 unsubscribe 函数。 */
  onTick(cb: TickCallback): () => void {
    this.tickCallbacks.push(cb);
    return () => {
      const i = this.tickCallbacks.indexOf(cb);
      if (i >= 0) this.tickCallbacks.splice(i, 1);
    };
  }

  /** 由外部主循环每帧调用,驱动所有 tick 回调。 */
  tick(dt: number): void {
    for (const cb of this.tickCallbacks) {
      try {
        cb(dt);
      } catch (err) {
        // 单个回调出错不中断其他回调
        console.error('[EcsScriptAPI] tick callback error:', err);
      }
    }
  }

  /** 清除所有 tick 回调。 */
  clearTickCallbacks(): void {
    this.tickCallbacks.length = 0;
  }

  /** 当前注册的 tick 回调数(调试用)。 */
  tickCallbackCount(): number {
    return this.tickCallbacks.length;
  }

  // ── 内部:从 JSON 创建组件实例 ───────────────────────────────

  private createComponentFromJson(compName: string, dataJson?: string): object | null {
    let data: Record<string, unknown> = {};
    if (dataJson) {
      try {
        data = JSON.parse(dataJson);
      } catch {
        return null;
      }
    }
    switch (compName) {
      case 'Transform': {
        const t = new Transform();
        if (Array.isArray(data.position)) t.position = data.position as [number, number, number];
        if (Array.isArray(data.rotation)) t.rotation = data.rotation as [number, number, number, number];
        if (Array.isArray(data.scale)) t.scale = data.scale as [number, number, number];
        return t;
      }
      case 'Velocity': {
        const v = new Velocity();
        if (Array.isArray(data.linear)) v.linear = data.linear as [number, number, number];
        if (typeof data.angularY === 'number') v.angularY = data.angularY;
        return v;
      }
      case 'Health': {
        const maxHp = typeof data.maxHp === 'number' ? data.maxHp : 100;
        const hp = typeof data.hp === 'number' ? data.hp : maxHp;
        return new Health(maxHp, hp);
      }
      case 'Tag': {
        return new Tag(typeof data.value === 'string' ? data.value : '');
      }
      case 'Lifetime': {
        return new Lifetime(typeof data.remaining === 'number' ? data.remaining : 1);
      }
      case 'PlayerInput': {
        const p = new PlayerInput();
        if (typeof data.forward === 'number') p.forward = data.forward;
        if (typeof data.right === 'number') p.right = data.right;
        if (typeof data.run === 'boolean') p.run = data.run;
        if (typeof data.jump === 'boolean') p.jump = data.jump;
        if (typeof data.attack === 'boolean') p.attack = data.attack;
        if (typeof data.cameraYaw === 'number') p.cameraYaw = data.cameraYaw;
        return p;
      }
      default:
        return null;
    }
  }
}

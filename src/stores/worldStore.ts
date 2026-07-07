// useWorldStore — 持有当前 Viewer 关联的 ECS World 实例 + 暴露 mutation API。
//
// World 是命令式对象（含 sceneNode 引用），不能放进 zustand state 序列化。
// 这里只持有 *引用* + 一个自增的 `version` 字段，UI 组件订阅 version 触发 re-render。
//
// 注册表 (COMPONENT_REGISTRY) 在文件内 hardcode 列出 POJO 组件的 factory。
// 加载新 .vreen 时由 World.loadJSON() 用该表把 POJO 数据还原回强类型实例。
// 非 POJO 组件 (MeshRef / SkinnedMeshRef / AnimState) 永远不进注册表 —
// 它们持有 Object3D / AnimationMixer 引用，.vreen 不持久化。

import { create } from 'zustand';
import {
  World,
  ComponentType,
  Transform,
  TransformC,
  Velocity,
  MeshRef,
  MeshRefC,
  SkinnedMeshRef,
  SkinnedMeshRefC,
  AnimState,
  AnimStateC,
  VelocityC,
  Health,
  HealthC,
  Tag,
  TagC,
  Lifetime,
  LifetimeC,
  PlayerInput,
  PlayerInputC,
  AnimationTickSystem,
  MovementSystem,
  AnimStateSystem,
  PlayerInputSystem,
  type EntityId,
  type ComponentRegistry,
  type WorldJson,
} from '@/engine/ECS';
import type { Object3D } from '@/engine/Core/Object3D';
import type { Mesh } from '@/engine/Core/Mesh';
import type { SkinnedMesh } from '@/engine/Core/SkinnedMesh';
import type { AnimationMixer } from '@/engine/Animation/AnimationMixer';
import type { AnimationClip } from '@/engine/Animation/AnimationClip';
import { AnimationStateMachine } from '@/engine/Animation';

/** 全局单例的 system —— 整个 viewer 生命周期共用,避免 world 重建时
 *  重新构造。 */
const ANIM_TICK_SYSTEM = new AnimationTickSystem();
const MOVEMENT_SYSTEM = new MovementSystem();
const ANIM_STATE_SYSTEM = new AnimStateSystem();
const PLAYER_INPUT_SYSTEM = new PlayerInputSystem();

/** 给外部 World 注入默认 system 列表。resetWorld / ensureWorld / setWorld
 *  都会调一次,保证 ECS 自驱。 */
function installDefaultSystems(w: World): void {
  if (!w.getSystems().includes(PLAYER_INPUT_SYSTEM)) {
    w.addSystem(PLAYER_INPUT_SYSTEM);
  }
  if (!w.getSystems().includes(MOVEMENT_SYSTEM)) {
    w.addSystem(MOVEMENT_SYSTEM);
  }
  if (!w.getSystems().includes(ANIM_STATE_SYSTEM)) {
    w.addSystem(ANIM_STATE_SYSTEM);
  }
  if (!w.getSystems().includes(ANIM_TICK_SYSTEM)) {
    w.addSystem(ANIM_TICK_SYSTEM);
  }
}

/** POJO 组件 factory 注册表：toJSON 输出的组件名 → 重建时构造空实例的函数。
 *  非 POJO 组件（MeshRef / SkinnedMeshRef / AnimState）持有运行时引用，
 *  不参与 .vreen 序列化，因此也不进注册表。 */
const COMPONENT_REGISTRY: ComponentRegistry = {
  Transform: () => new Transform(),
  Velocity: () => new Velocity(),
  Health: () => new Health(0),
  Tag: () => new Tag(''),
  Lifetime: () => new Lifetime(0),
  PlayerInput: () => new PlayerInput(),
};

interface WorldStoreState {
  /** 自增版本号；每次 World 改变后 +1。UI 订阅这个触发重渲。 */
  version: number;
  /** 当前 viewer 关联的 ECS World。null 表示尚未初始化。 */
  world: World | null;

  /** 获取（按需懒初始化）当前 World。 */
  ensureWorld: (name?: string) => World;
  /** 直接替换 World 引用（用于 LOAD .vreen）。 */
  setWorld: (w: World) => void;
  /** 销毁当前 World 并重建（资产切换时使用）。 */
  resetWorld: (name?: string) => World;

  /** Convenience: 在当前 World 创建 entity。返回新 id（version 也会 +1）。 */
  addEntity: (name?: string) => EntityId | null;
  /** Convenience: 设置组件（自动用 COMPONENT_REGISTRY 还原 type）。 */
  setComponentByName: <T extends object>(id: EntityId, compName: string, data: T) => boolean;
  /** Convenience: 销毁 entity。 */
  removeEntity: (id: EntityId) => void;

  /** Phase 2: 把当前 scene graph 同步成 ECS entities。
   *  会先 resetWorld 清空旧 entity，再为每个 Mesh / SkinnedMesh / Group / AnimationClip
   *  创建 entity 并挂上对应组件。返回新创建的 entity id 列表。 */
  syncFromSceneGraph: (
    root: Object3D,
    mixer: AnimationMixer | null,
    clips: AnimationClip[],
  ) => {
    meshEntityIds: EntityId[];
    clipEntityIds: EntityId[];
    /** 与传入 root 对应的 entity id (DFS 第一个 pop 出来的就是 root)。
     *  MovementSystem 改这个 entity 的 Transform 后,SceneContents 桥回 three.js root。 */
    rootEntityId: EntityId | null;
  };

  /** Phase 2 演示：打开后,MovementSystem 推进 root entity 的 Transform,
   *  SceneContents 把 entity.sceneNode 的 TRS 同步回 three.js group,
   *  实测 "ECS 改 → 渲染跟着变"。关闭时回到 r3f 自管姿态。 */
  ecsMovementEnabled: boolean;
  setEcsMovementEnabled: (v: boolean) => void;

  /** 导出当前 World 为 POJO JSON（带 version 自增通知）。 */
  serialize: () => WorldJson | null;
  /** 加载 WorldJson 重建 World。 */
  deserialize: (json: WorldJson) => void;

  /** Inspector 调试用：entityCount 快照。 */
  entityCount: () => number;
}

export const useWorldStore = create<WorldStoreState>((set, get) => ({
  world: null,
  version: 0,
  ecsMovementEnabled: false,

  ensureWorld: (name) => {
    const cur = get().world;
    if (cur) return cur;
    const w = new World({ name: name ?? 'ViewerWorld' });
    installDefaultSystems(w);
    set({ world: w, version: get().version + 1 });
    return w;
  },

  setWorld: (w) => {
    installDefaultSystems(w);
    set({ world: w, version: get().version + 1 });
  },

  resetWorld: (name) => {
    const w = new World({ name: name ?? 'ViewerWorld' });
    installDefaultSystems(w);
    set({ world: w, version: get().version + 1 });
    return w;
  },

  addEntity: (name) => {
    const w = get().world;
    if (!w) return null;
    const id = w.createEntity(name);
    set({ version: get().version + 1 });
    return id;
  },

  setComponentByName: (id, compName, data) => {
    const w = get().world;
    if (!w) return false;
    const type = ComponentType.byName(compName);
    if (!type) return false;
    (w.setComponent as (i: EntityId, t: ComponentType<unknown>, d: unknown) => void)(
      id,
      type,
      data,
    );
    set({ version: get().version + 1 });
    return true;
  },

  removeEntity: (id) => {
    const w = get().world;
    if (!w) return;
    w.destroyEntity(id);
    set({ version: get().version + 1 });
  },

  syncFromSceneGraph: (root, mixer, clips) => {
    // 先清空旧 World
    const w = get().resetWorld(`World@${root.name || 'asset'}`);
    const meshEntityIds: EntityId[] = [];
    const clipEntityIds: EntityId[] = [];
    let rootEntityId: EntityId | null = null;

    // ── 1. DFS scene tree，注册 mesh / skinnedMesh / group entity ──
    const stack: Object3D[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const name = node.name || node.type || 'Node';
      const id = w.createEntity(name);
      // 第一个 pop 出来的是 root (DFS 栈先 push root, 后续 push 它的 children,
      // pop 顺序就是 root → children)。用 index 0 标志 root。
      if (rootEntityId === null) rootEntityId = id;

      // Transform 总是要：sceneNode 已经由 World 内部建好 (x/y/z/quaternion)
      // 把当前矩阵的 translation / quaternion / scale 同步过去。
      const t = w.getSceneNode(id);
      if (t) {
        t.position.set(node.position.x, node.position.y, node.position.z);
        t.rotation.set(
          node.rotation.x, node.rotation.y,
          node.rotation.z, node.rotation.w,
        );
        t.scale.set(node.scale.x, node.scale.y, node.scale.z);
      }

      // 强制 tag 一个 Transform component，让 ECS 用户能在 query 时拿到。
      // 严格说 sceneNode 已经持有这个信息，但 query 模式按 component 走方便。
      w.setComponent(id, TransformC, new Transform());
      const tr = w.getComponent(id, TransformC) as Transform | undefined;
      if (tr) {
        tr.position = [node.position.x, node.position.y, node.position.z];
        tr.rotation = [
          node.rotation.x, node.rotation.y,
          node.rotation.z, node.rotation.w,
        ];
        tr.scale = [node.scale.x, node.scale.y, node.scale.z];
      }

      // Type-specific 组件
      if (isSkinnedMesh(node) && mixer) {
        const ref = new SkinnedMeshRef(node, mixer);
        w.setComponent(id, SkinnedMeshRefC, ref);
        meshEntityIds.push(id);
      } else if (isMesh(node)) {
        const ref = new MeshRef(node);
        ref.castShadow = (node as Mesh).castShadow;
        ref.receiveShadow = (node as Mesh).receiveShadow;
        w.setComponent(id, MeshRefC, ref);
        meshEntityIds.push(id);
      }

      // 继续 DFS
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }

    // ── 2. AnimationClip → AnimState (装在 root entity 上) ──
    // 不再为每个 clip 创独立 entity。统一一个 AnimState + 真正可工作的
    // AnimationStateMachine,挂在 root entity。AnimStateSystem 每帧
    // tick 这个 state machine,guards 读 root 的 Velocity 决定 transition。
    if (rootEntityId !== null && mixer && clips.length > 0) {
      const animState = new AnimState();
      for (const c of clips) animState.registerClip(c);

      const sm = new AnimationStateMachine(mixer);
      // clip 名启发式分类: 含 idle → Idle, 含 walk → Walk, 含 run → Run,
      // 其余按索引映射(第 0 个 = Idle, 第 1 个 = Walk, 第 2 个 = Run, ...)
      const findClip = (hint: string, fallbackIdx: number): AnimationClip => {
        const hit = clips.find((c) => c.name.toLowerCase().includes(hint));
        return hit ?? clips[Math.min(fallbackIdx, clips.length - 1)];
      };
      const idleClip = findClip('idle', 0);
      const walkClip = findClip('walk', 1);
      const runClip = findClip('run', 2);
      const haveWalk = walkClip !== idleClip;
      const haveRun = runClip !== walkClip && runClip !== idleClip;

      sm.add({ name: 'Idle', clip: idleClip, loop: 'repeat' });
      const speed = (id: EntityId): number => {
        const v = w.getComponent(id, VelocityC);
        return v ? Math.hypot(v.linear[0], v.linear[1], v.linear[2]) : 0;
      };
      if (haveWalk) {
        sm.add({ name: 'Walk', clip: walkClip, loop: 'repeat' });
        sm.on({
          from: 'Idle', to: 'Walk',
          guard: (world, eid) => speed(eid) > 0.1,
        });
        sm.on({
          from: 'Walk', to: 'Idle',
          guard: (world, eid) => speed(eid) < 0.05,
        });
      }
      if (haveRun) {
        sm.add({ name: 'Run', clip: runClip, loop: 'repeat' });
        sm.on({
          from: 'Walk', to: 'Run',
          guard: (world, eid) => speed(eid) > 2.0,
          duration: 0.15,
        });
        sm.on({
          from: 'Run', to: 'Walk',
          guard: (world, eid) => speed(eid) < 1.5,
          duration: 0.15,
        });
      }

      // 初始 state 选 Idle (如果 idleClip 存在, 否则 clips[0])
      sm.enter('Idle');
      // 同步 AnimState.clip 给 UI
      animState.clip = sm.current ? sm.current.name : null;
      animState.stateMachine = sm;
      w.setComponent(rootEntityId, AnimStateC, animState);
      clipEntityIds.push(rootEntityId);
    }
    // resetWorld 内部已 +1 version,这里不再重复触发重渲

    return { meshEntityIds, clipEntityIds, rootEntityId };
  },

  serialize: () => {
    const w = get().world;
    if (!w) return null;
    return w.toJSON();
  },

  deserialize: (json) => {
    const cur = get().world;
    if (cur) {
      cur.loadJSON(json, COMPONENT_REGISTRY);
      // loadJSON 内部会清掉所有 system,重新装回默认的。
      installDefaultSystems(cur);
    } else {
      const w = new World({ name: json.name });
      w.loadJSON(json, COMPONENT_REGISTRY);
      installDefaultSystems(w);
      set({ world: w });
    }
    set({ version: get().version + 1 });
  },

  entityCount: () => {
    const w = get().world;
    return w ? w.entityCount() : 0;
  },

  setEcsMovementEnabled: (v) => set({ ecsMovementEnabled: v }),
}));

// ── 暴露给非 React 上下文（pack/unpack）的纯函数版本 ─────────────
/** 用默认 COMPONENT_REGISTRY 把 WorldJson 写回一个新 World。 */
export function buildWorldFromJson(json: WorldJson): World {
  const w = new World({ name: json.name });
  w.loadJSON(json, COMPONENT_REGISTRY);
  return w;
}

/** 当前已注册的 POJO 组件名列表（用于 .vreen 校验 / UI 调试）。 */
export function listRegisteredPojoComponents(): readonly string[] {
  return Object.keys(COMPONENT_REGISTRY);
}

// ── Type guards (避免循环 import engine.Core.Mesh/SkinnedMesh 引入 React/r3f) ──
function isMesh(n: Object3D): n is Mesh {
  return n.type === 'Mesh';
}
function isSkinnedMesh(n: Object3D): n is SkinnedMesh {
  return n.type === 'SkinnedMesh';
}

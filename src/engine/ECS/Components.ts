// CommonComponents — 常用 ECS 组件定义 (POJO 数据)。
//
// 每个组件都是纯数据 class（Java record 风格），方便 Java 端生成对等
// record / POJO。组件数据完全公开（public fields），不持有引用回
// World 或 Entity —— 这是 ECS 的"数据 vs 行为分离"原则。
//
// 组件类型用 ComponentType<T> 单例标识，全局唯一。
// 通过 `import { Transform } from '...'` 即可使用；同一模块多次
// import 拿到的是同一个 ComponentType 实例（TS 模块单例）。

import { ComponentType } from './World';
import type { Mesh } from '../Core/Mesh';
import type { SkinnedMesh } from '../Core/SkinnedMesh';
import type { AnimationClip } from '../Animation/AnimationClip';
import type { AnimationMixer } from '../Animation/AnimationMixer';
import type { AnimationStateMachine } from '../Animation/AnimationStateMachine';

// ── Transform ───────────────────────────────────────────────────────
/** 位置 / 旋转 / 缩放。Position 单位为米，Rotation 是 quaternion。 */
export class Transform {
  position: [number, number, number] = [0, 0, 0];
  /** quaternion: [x, y, z, w] */
  rotation: [number, number, number, number] = [0, 0, 0, 1];
  scale: [number, number, number] = [1, 1, 1];

  static identity(): Transform {
    return new Transform();
  }
  static fromPos(x: number, y: number, z: number): Transform {
    const t = new Transform();
    t.position = [x, y, z];
    return t;
  }
}
export const TransformC = new ComponentType<Transform>('Transform');

// ── Velocity ────────────────────────────────────────────────────────
/** 线速度 (m/s)。MovementSystem 用它更新 Transform.position。 */
export class Velocity {
  linear: [number, number, number] = [0, 0, 0];
  /** 角速度 (rad/s)，绕 Y 轴（简化版）。 */
  angularY: number = 0;
}
export const VelocityC = new ComponentType<Velocity>('Velocity');

// ── MeshRef ─────────────────────────────────────────────────────────
/** 指向场景图里的 Mesh 句柄。Renderer 在 World.update 之后用这个
 *  收集所有可见 mesh 一次性画。 */
export class MeshRef {
  mesh: Mesh;
  castShadow: boolean = true;
  receiveShadow: boolean = true;
  constructor(mesh: Mesh) { this.mesh = mesh; }
}
export const MeshRefC = new ComponentType<MeshRef>('MeshRef');

// ── SkinnedMeshRef ──────────────────────────────────────────────────
/** 指向 SkinnedMesh + 它的 AnimationMixer。AnimationTickSystem 用 mixer
 *  推进动画；renderer 走 SkinnedMesh 的 USE_SKINNING 路径。 */
export class SkinnedMeshRef {
  mesh: SkinnedMesh;
  mixer: AnimationMixer;
  constructor(mesh: SkinnedMesh, mixer: AnimationMixer) {
    this.mesh = mesh;
    this.mixer = mixer;
  }
}
export const SkinnedMeshRefC = new ComponentType<SkinnedMeshRef>('SkinnedMeshRef');

// ── AnimState ───────────────────────────────────────────────────────
/** 角色动画状态机当前状态。AnimationStateMachine 才是真正的驱动器,
 *  本组件只是 state machine 在 ECS 侧的句柄 + 一些便利字段。
 *
 *  Phase 2 之后:AnimStateSystem 每帧调 stateMachine.tick(),状态机的
 *  guards 读其他组件 (Velocity / PlayerInput) 来决定 transition。
 *
 *  ⚠️ 这是非 POJO 组件:持有 AnimationStateMachine 引用(内含 mixer)，
 *  不进 .vreen 序列化。世界反序列化后会丢 state machine 引用,需要
 *  重新 setComponent(AnimStateC, new AnimState()) + 重新构造 SM。 */
export class AnimState {
  /** 当前 state 名 (从 state machine 同步过来,只读). */
  clip: string | null = null;
  /** 播放速率 1.0 = 原速,写回 SM 中所有 action.timeScale。 */
  speed: number = 1;
  /** 注册的全部可选 clip。state machine 不强制使用它(可自行 add())，
   *  但 SceneContents 加载完模型后会把 clips 塞进来 + 默认构造 SM。 */
  clips: Map<string, AnimationClip> = new Map();
  /** 真正驱动状态切换的有限状态机。null = 该 entity 不参与动画状态机。 */
  stateMachine: AnimationStateMachine | null = null;

  /** 把 AnimationClip 加入可选集。 */
  registerClip(clip: AnimationClip): void {
    this.clips.set(clip.name, clip);
  }
}
export const AnimStateC = new ComponentType<AnimState>('AnimState');

// ── Health / Damage （游戏常用） ──────────────────────────────────
/** 生命值。HP <= 0 时可由系统触发死亡 / 销毁 entity。 */
export class Health {
  hp: number;
  maxHp: number;
  constructor(maxHp: number, hp: number = maxHp) {
    this.maxHp = maxHp;
    this.hp = hp;
  }
  isDead(): boolean { return this.hp <= 0; }
}
export const HealthC = new ComponentType<Health>('Health');

// ── Tag ────────────────────────────────────────────────────────────
/** 标记型组件（无数据），用于 query 过滤。 */
export class Tag {
  /** 自由字符串。例: 'Player' / 'Enemy' / 'MainCamera'。 */
  value: string;
  constructor(value: string) { this.value = value; }
}
export const TagC = new ComponentType<Tag>('Tag');

// ── Lifetime ───────────────────────────────────────────────────────
/** 倒计时；归零时由 LifecycleSystem 销毁实体（用于粒子/特效）。 */
export class Lifetime {
  /** 剩余秒数。 */
  remaining: number;
  constructor(remaining: number) { this.remaining = remaining; }
}
export const LifetimeC = new ComponentType<Lifetime>('Lifetime');

// ── Input 标记 ─────────────────────────────────────────────────────
/** 给定 entity 的输入意图（玩家控制）。WASD/跳跃/动作等。 */
export class PlayerInput {
  /** 前进意图 (W/S) : -1(后) .. 1(前) */
  forward: number = 0;
  /** 右移意图 (A/D) : -1(左) .. 1(右) */
  right: number = 0;
  /** 跑步冲刺 (Shift) */
  run: boolean = false;
  jump: boolean = false;
  attack: boolean = false;
  /** 相机 yaw (弧度)。PlayerInputSystem 用它把 forward/right
   *  从相机空间转到世界空间，实现 "按屏幕方向移动"。 */
  cameraYaw: number = 0;
}
export const PlayerInputC = new ComponentType<PlayerInput>('PlayerInput');

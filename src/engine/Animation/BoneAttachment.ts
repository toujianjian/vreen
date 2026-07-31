// BoneAttachment — 把任意 Object3D 附加到骨骼上,使其跟随骨骼运动。
//
// 设计目标:
//   - 类似 Godot BoneAttachment / UE AttachToComponent / o3de ActorComponent 的功能:
//     让非 SkinnedMesh 对象(武器 / 道具 / 装备槽 / VFX 锚点 / 摄像机)跟随
//     指定骨骼的世界变换运动。
//   - 与直接 parent 到 Bone 的区别:
//     1) BoneAttachment 在 update() 中显式同步目标世界矩阵,不依赖场景图父子关系,
//        可跨子树附加(目标可以不在 Bone 的 children 中)。
//     2) 支持 offset 偏移(局部相对骨骼的相对变换)。
//     3) 支持 followMode: 'world'(完整世界跟随)/ 'position'(只跟随位置)/
//     'rotation'(只跟随旋转)/ 'snap'(瞬时贴合,无插值)。
//     4) 支持 smoothing 平滑跟随(指数衰减插值)。
//   - 与 SkinnedMesh 的区别:
//     SkinnedMesh 用骨骼驱动 *顶点*(GPU skinning),而 BoneAttachment 驱动
//     *整个对象的 transform*。两者互补。
//
// 用法:
//   const sword = new Mesh(geom, mat);
//   const attachment = new BoneAttachment({
//     target: sword,
//     bone: rightHandBone,
//     offset: new Matrix4().makeTranslation(0.1, 0, 0),
//     followMode: 'world',
//     smoothing: 0.15,
//   });
//   // 每帧(在骨骼更新后、渲染前)调用:
//   attachment.update(dt);
//
// 不变量:
//   - target 与 bone 都必须已加入场景图(有 matrixWorld)。
//   - update() 不会自动调用 bone.updateMatrixWorld();调用方负责先更新骨骼。
//   - smoothing=0 表示瞬时贴合;0 < smoothing < 1 表示指数衰减。
//   - dispose() 解除引用,但不释放 target / bone 本身。

import { Object3D } from '../Core/Object3D';
import { Bone } from '../Core/Bone';
import { Matrix4 } from '../Math/Matrix4';
import { Quaternion } from '../Math/Quaternion';
import { Vector3 } from '../Math/Vector3';
import { createLogger } from '@/lib/logger';

const log = createLogger('BoneAttachment');

/** 跟随模式。 */
export type FollowMode =
  | 'world' // 完整世界变换跟随(位置 + 旋转 + 缩放)
  | 'position' // 只跟随位置
  | 'rotation' // 只跟随旋转
  | 'snap'; // 瞬时贴合(等价于 world + smoothing=0,但跳过所有插值逻辑)

export interface BoneAttachmentOptions {
  /** 被附加的对象。 */
  target: Object3D;
  /** 跟随的骨骼。 */
  bone: Bone;
  /** 相对骨骼的偏移(局部变换,在 bone.matrixWorld 空间下)。默认单位矩阵。 */
  offset?: Matrix4;
  /** 跟随模式。默认 'world'。 */
  followMode?: FollowMode;
  /**
   * 平滑系数 [0, 1)。
   * - 0: 瞬时贴合(默认)
   * - 0.1: 缓慢跟随(指数衰减,大值更慢)
   * - 实现使用 lerp(current, target, 1 - smoothing) 形式,
   *   所以 smoothing 越大,跟随越慢。
   */
  smoothing?: number;
  /**
   * 是否自动把 target 加到 bone 的 children 中(默认 false)。
   * 若为 true,则 BoneAttachment 不再每帧同步 matrixWorld,而是依赖场景图。
   * 一般场景下 false 更灵活(可跨子树附加)。
   */
  attachToSceneGraph?: boolean;
  /** 是否启用(关闭时 update() 无效)。 */
  enabled?: boolean;
}

// 复用临时变量避免 GC 压力
const _m1 = new Matrix4();
const _m2 = new Matrix4();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _s1 = new Vector3();
const _s2 = new Vector3();

/**
 * 把任意 Object3D 附加到骨骼上,使其跟随骨骼运动。
 *
 * 用法见文件头注释。
 */
export class BoneAttachment {
  /** 被附加的对象。 */
  target: Object3D;
  /** 跟随的骨骼。 */
  bone: Bone;
  /** 相对骨骼的偏移(局部变换)。 */
  offset: Matrix4;
  /** 跟随模式。 */
  followMode: FollowMode;
  /** 平滑系数 [0, 1)。 */
  smoothing: number;
  /** 是否自动加到场景图。 */
  attachToSceneGraph: boolean;
  /** 是否启用。 */
  enabled: boolean;

  private _attached: boolean = false;
  private _initialized: boolean = false;
  /** 上一帧目标位置(smoothing 用)。 */
  private _lastPos = new Vector3();
  /** 上一帧目标旋转(smoothing 用)。 */
  private _lastRot = new Quaternion();
  /** 上一帧目标缩放(smoothing 用)。 */
  private _lastScale = new Vector3(1, 1, 1);

  constructor(opts: BoneAttachmentOptions) {
    this.target = opts.target;
    this.bone = opts.bone;
    this.offset = opts.offset ?? new Matrix4().identity();
    this.followMode = opts.followMode ?? 'world';
    this.smoothing = opts.smoothing ?? 0;
    this.attachToSceneGraph = opts.attachToSceneGraph ?? false;
    this.enabled = opts.enabled ?? true;

    if (this.attachToSceneGraph) {
      this._attachToSceneGraph();
    }
  }

  /** 把 target 加到 bone 的 children 中。 */
  private _attachToSceneGraph(): void {
    if (this._attached) return;
    if (this.target.parent !== null) {
      this.target.parent.remove(this.target);
    }
    this.bone.add(this.target);
    this._attached = true;
    log.debug(`attached ${this.target.name || this.target.uuid} to bone ${this.bone.name || this.bone.uuid}`);
  }

  /** 从场景图中移除 target(仅 attachToSceneGraph=true 时有效)。 */
  detachFromSceneGraph(): void {
    if (!this._attached) return;
    this.bone.remove(this.target);
    this._attached = false;
  }

  /**
   * 每帧更新 target 的世界变换。
   *
   * 必须在骨骼 updateMatrixWorld() 之后、渲染之前调用。
   *
   * @param dt 帧时间(秒)。smoothing=0 时可省略。
   */
  update(dt: number = 0): void {
    if (!this.enabled) return;
    if (this.attachToSceneGraph) {
      // 由场景图驱动,无需手动同步
      return;
    }

    // 计算目标世界矩阵 = bone.matrixWorld * offset
    _m1.multiplyMatrices(this.bone.matrixWorld, this.offset);

    // 拆解目标矩阵
    _m1.decompose(_v1, _q1, _s1); // target pos / rot / scale

    if (this.followMode === 'snap' || this.smoothing <= 0 || !this._initialized) {
      // 瞬时贴合或首次初始化
      this._applyTransform(_v1, _q1, _s1);
      this._lastPos.copy(_v1);
      this._lastRot.copy(_q1);
      this._lastScale.copy(_s1);
      this._initialized = true;
      return;
    }

    // 平滑插值(指数衰减)
    // alpha = 1 - exp(-dt / tau),其中 tau = smoothing / ln(2) ?
    // 简化为 alpha = clamp(1 - smoothing, 0, 1) * dt * 60
    // 但这种帧率依赖不好。改用 alpha = 1 - exp(-dt / max(smoothing, 1e-4))
    const tau = Math.max(this.smoothing, 1e-4);
    const alpha = 1 - Math.exp(-dt / tau);
    const a = Math.max(0, Math.min(1, alpha));

    // lerp 位置
    _v2.copy(this._lastPos).lerp(_v1, a);
    // slerp 旋转
    _q2.copy(this._lastRot).slerp(_q1, a);
    // lerp 缩放
    _s2.copy(this._lastScale).lerp(_s1, a);

    // 应用
    this._applyTransform(_v2, _q2, _s2);

    // 更新历史
    this._lastPos.copy(_v2);
    this._lastRot.copy(_q2);
    this._lastScale.copy(_s2);
  }

  /** 把 pos/rot/scale 写入 target 的世界变换。 */
  private _applyTransform(pos: Vector3, rot: Quaternion, scale: Vector3): void {
    switch (this.followMode) {
      case 'world':
      case 'snap': {
        // 完整世界变换:把目标 world matrix 设为 pos/rot/scale
        // target.matrixWorld = compose(pos, rot, scale)
        _m2.compose(pos, rot, scale);
        this.target.matrixWorld.copy(_m2);
        // 同步 target.matrixWorldInverse
        this.target.matrixWorldInverse.copy(_m2).invert();
        // 标记 dirty,以便后续 updateMatrixWorld 不会覆盖
        // 注意:这里直接写 matrixWorld,如果 target.matrixAutoUpdate=true 且
        // 之后被 updateMatrixWorld 调用,会被覆盖。建议把 target.matrixAutoUpdate=false。
        this.target.matrixAutoUpdate = false;
        this.target.matrixWorldNeedsUpdate = false;
        break;
      }
      case 'position': {
        // 只跟随位置:保留 target 原有旋转/缩放
        this.target.matrixWorld.decompose(_v2, _q2, _s2);
        _m2.compose(pos, _q2, _s2);
        this.target.matrixWorld.copy(_m2);
        this.target.matrixWorldInverse.copy(_m2).invert();
        this.target.matrixAutoUpdate = false;
        this.target.matrixWorldNeedsUpdate = false;
        break;
      }
      case 'rotation': {
        // 只跟随旋转:保留 target 原有位置/缩放
        this.target.matrixWorld.decompose(_v2, _q2, _s2);
        _m2.compose(_v2, rot, _s2);
        this.target.matrixWorld.copy(_m2);
        this.target.matrixWorldInverse.copy(_m2).invert();
        this.target.matrixAutoUpdate = false;
        this.target.matrixWorldNeedsUpdate = false;
        break;
      }
    }

    // 递归更新 target 子树的世界矩阵(因为 target.matrixWorld 改了)
    for (const child of this.target.children) {
      child.updateMatrixWorld(true);
    }
  }

  /** 立即重置平滑历史(下次 update 直接贴合)。 */
  reset(): void {
    this._initialized = false;
  }

  /** 设置新的 offset 并立即重置平滑历史。 */
  setOffset(offset: Matrix4): void {
    this.offset.copy(offset);
    this.reset();
  }

  /** 切换到新骨骼。 */
  setBone(bone: Bone): void {
    if (this.attachToSceneGraph && this._attached) {
      this.detachFromSceneGraph();
      this.bone = bone;
      this._attachToSceneGraph();
    } else {
      this.bone = bone;
    }
    this.reset();
  }

  /** 解除引用(不释放 target / bone)。 */
  dispose(): void {
    this.detachFromSceneGraph();
    this.target.matrixAutoUpdate = true; // 恢复默认
    this.enabled = false;
    log.debug('disposed');
  }
}

// ─────────────────────────────────────────────────────────────────────
// 批量管理器(便于管理一个角色身上的所有附件)
// ─────────────────────────────────────────────────────────────────────

/**
 * BoneAttachment 批量管理器。
 *
 * 一个角色通常有多个附件(左手武器、右手武器、头盔、背部道具、VFX 锚点),
 * 本管理器统一 update / 启停 / 查找。
 *
 * 用法:
 *   const mgr = new BoneAttachmentManager();
 *   mgr.add('sword', swordAttachment);
 *   mgr.add('helmet', helmetAttachment);
 *   // 每帧:
 *   mgr.update(dt);
 *   // 按名停用:
 *   mgr.setEnabled('sword', false);
 */
export class BoneAttachmentManager {
  private _map = new Map<string, BoneAttachment>();

  /** 添加附件(同名会覆盖)。 */
  add(name: string, attachment: BoneAttachment): void {
    this._map.set(name, attachment);
  }

  /** 移除并 dispose 附件。 */
  remove(name: string): void {
    const a = this._map.get(name);
    if (a) {
      a.dispose();
      this._map.delete(name);
    }
  }

  /** 获取附件。 */
  get(name: string): BoneAttachment | undefined {
    return this._map.get(name);
  }

  /** 启用/停用。 */
  setEnabled(name: string, enabled: boolean): void {
    const a = this._map.get(name);
    if (a) a.enabled = enabled;
  }

  /** 全部启用/停用。 */
  setAllEnabled(enabled: boolean): void {
    for (const a of this._map.values()) a.enabled = enabled;
  }

  /** 批量 update。 */
  update(dt: number = 0): void {
    for (const a of this._map.values()) a.update(dt);
  }

  /** 释放所有附件。 */
  dispose(): void {
    for (const a of this._map.values()) a.dispose();
    this._map.clear();
  }

  /** 所有附件名。 */
  names(): string[] {
    return Array.from(this._map.keys());
  }

  /** 附件数量。 */
  get size(): number {
    return this._map.size;
  }
}

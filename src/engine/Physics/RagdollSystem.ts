// RagdollSystem — 骨骼布娃娃物理:把 Skeleton 的骨头转成刚体 + 锥-扭/铰链关节,
// 模拟受重力/外力作用下的整体连锁运动,再把世界变换写回 Bone。
//
// 设计:
//   - 每个 RagdollBone = 一个 RigidbodyLike(球/胶囊/盒)锚定到一根 Bone。
//   - 父子 Bone 之间用 ConeTwistConstraint(肩/髋/脊柱)或 HingeJointConstraint(膝/肘)连接。
//   - 模拟步:重力 → 速度积分 → 角速度积分(quaternion) → ConstraintSolver → 可选地面碰撞。
//   - 写回:把每个刚体的世界 position/quaternion 写回对应 Bone 的本地 position/quaternion
//     (考虑父节点世界变换),然后 updateMatrixWorld() 重算骨骼子树。
//
// 与 ECS PhysicsSystems 解耦:
//   - 布娃娃是"骨头→刚体→骨头"的 specialized pipeline,形态与一般刚体不同,
//     独立实现避免污染主物理流水线。
//   - 可选地与外部 CollisionSystem 交互(collideWithSphere/Box),但不依赖。
//
// 参考:
//   - o3de PhysX RagdollConfiguration / RagdollInstance
//   - Unreal Engine FAnimNode_Ragdoll
//   - Three.js AmmoJS Ragdoll 示例

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { Bone } from '../Core/Bone';
import type { Object3D } from '../Core/Object3D';
import {
  Constraint, type RigidbodyLike, type Mat3,
  mat3Identity, applyImpulse,
} from './Constraint';
import { ConstraintSolver } from './ConstraintSolver';
import { ConeTwistConstraint } from './ConeTwistConstraint';
import { HingeJointConstraint } from './HingeJointConstraint';

/** 碰撞器形状。 */
export type RagdollShape = 'sphere' | 'capsule' | 'box';

/** 单个 RagdollBone 的配置。 */
export interface RagdollBoneConfig {
  /** 骨骼名称(对应 Bone.name)。 */
  boneName: string;
  /** 父骨骼名称(根节点为 undefined)。 */
  parentBone?: string;
  /** 碰撞器形状。 */
  shape: RagdollShape;
  /** 球半径 / 胶囊半径 / 盒半边长(各分量)。 */
  radius?: number;
  /** 盒半边长(shape='box' 时使用)。 */
  halfExtents?: Vector3;
  /** 胶囊长度(shape='capsule' 时,沿胶囊轴的长度,不含端盖)。 */
  length?: number;
  /** 质量(kg)。 */
  mass: number;
  /** 关节类型(连接到父骨头)。 */
  joint?: 'cone' | 'hinge' | 'fixed' | 'ball';
  /** 关节锚点在父骨头本地空间的偏移(默认 (0,0,0),即父骨头原点)。 */
  parentAnchor?: Vector3;
  /** 关节锚点在本骨头本地空间的偏移(默认 (0,0,0),即本骨头原点)。 */
  boneAnchor?: Vector3;
  /** 锥角限制(弧度,joint='cone' 时使用,默认 π/4)。 */
  swingLimit?: number;
  /** Twist 最小角(joint='cone' 时使用,默认 -π/4)。 */
  twistMin?: number;
  /** Twist 最大角(joint='cone' 时使用,默认 π/4)。 */
  twistMax?: number;
  /** 铰链轴(本地空间,joint='hinge' 时使用,默认 (0,1,0))。 */
  hingeAxis?: Vector3;
  /** 铰链最小角(弧度,默认 -π/2)。 */
  hingeMin?: number;
  /** 铰链最大角(弧度,默认 π/2)。 */
  hingeMax?: number;
  /** 是否启用 twist 限制(joint='cone' 时)。 */
  twistEnabled?: boolean;
  /** 是否固定(不参与重力/积分,常用作根)。 */
  pinned?: boolean;
}

/** 运行时 RagdollBone:刚体 + 几何信息。 */
export interface RagdollBone {
  /** 配置。 */
  config: RagdollBoneConfig;
  /** 对应的 Bone 节点。 */
  bone: Bone;
  /** 父 RagdollBone(根为 null)。 */
  parent: RagdollBone | null;
  /** 刚体实现(满足 RigidbodyLike)。 */
  body: RagdollRigidbody;
  /** 关节约束(根为 null)。 */
  joint: Constraint | null;
}

/** Ragdoll 刚体:RigidbodyLike 的具体实现 + 碰撞器几何。 */
export interface RagdollRigidbody extends RigidbodyLike {
  /** 形状。 */
  shape: RagdollShape;
  /** 球/胶囊半径。 */
  radius: number;
  /** 胶囊长度。 */
  length: number;
  /** 盒半边长。 */
  halfExtents: Vector3;
  /** 线性阻尼 [0,1]。 */
  linearDamping: number;
  /** 角阻尼 [0,1]。 */
  angularDamping: number;
  /** 摩擦系数(地面碰撞用)。 */
  friction: number;
  /** 恢复系数(地面碰撞用)。 */
  restitution: number;
}

/** Ragdoll 统计信息。 */
export interface RagdollStats {
  boneCount: number;
  jointCount: number;
  pinnedCount: number;
  totalMass: number;
  constraintIterations: number;
  gravity: Vector3;
}

/** 构造选项。 */
export interface RagdollOptions {
  /** 重力(默认 (0,-9.8,0))。 */
  gravity?: Vector3;
  /** 线性阻尼(默认 0.05)。 */
  linearDamping?: number;
  /** 角阻尼(默认 0.05)。 */
  angularDamping?: number;
  /** 约束求解迭代次数(默认 12)。 */
  constraintIterations?: number;
  /** 全局摩擦(默认 0.6)。 */
  friction?: number;
  /** 全局恢复系数(默认 0.05)。 */
  restitution?: number;
  /** 是否启用地面碰撞(默认 false)。 */
  groundCollision?: boolean;
  /** 地面 Y 高度(默认 0)。 */
  groundY?: number;
  /** 物理步长(默认 1/60)。 */
  fixedDt?: number;
}

/** 默认人形 ragdoll 配置(对应 Humanoid.ts 的骨骼命名)。 */
export function createHumanoidRagdollConfig(): RagdollBoneConfig[] {
  const hipSwing = Math.PI / 4;        // 45°
  const shoulderSwing = Math.PI / 3;   // 60°
  const spineSwing = Math.PI / 8;      // 22.5°
  const neckSwing = Math.PI / 6;       // 30°
  const kneeRange = { min: -Math.PI * 0.9, max: 0 };
  const elbowRange = { min: -Math.PI * 0.9, max: 0 };

  return [
    { boneName: 'pelvis', shape: 'box', halfExtents: new Vector3(0.16, 0.09, 0.10), mass: 8, joint: 'cone', parentBone: undefined, swingLimit: 0, twistMin: 0, twistMax: 0, pinned: true },
    { boneName: 'spine', parentBone: 'pelvis', shape: 'box', halfExtents: new Vector3(0.14, 0.10, 0.09), mass: 6, joint: 'cone', swingLimit: spineSwing, twistMin: -Math.PI / 8, twistMax: Math.PI / 8, twistEnabled: true },
    { boneName: 'chest', parentBone: 'spine', shape: 'box', halfExtents: new Vector3(0.18, 0.13, 0.11), mass: 10, joint: 'cone', swingLimit: spineSwing, twistMin: -Math.PI / 8, twistMax: Math.PI / 8, twistEnabled: true },
    { boneName: 'head', parentBone: 'chest', shape: 'sphere', radius: 0.11, mass: 4, joint: 'cone', swingLimit: neckSwing, twistMin: -Math.PI / 6, twistMax: Math.PI / 6, twistEnabled: true },
    { boneName: 'shoulder.L', parentBone: 'chest', shape: 'sphere', radius: 0.05, mass: 1, joint: 'cone', swingLimit: shoulderSwing, twistMin: 0, twistMax: 0 },
    { boneName: 'upperArm.L', parentBone: 'shoulder.L', shape: 'capsule', radius: 0.05, length: 0.22, mass: 2, joint: 'cone', swingLimit: shoulderSwing, twistMin: -Math.PI / 4, twistMax: Math.PI / 4, twistEnabled: true },
    { boneName: 'lowerArm.L', parentBone: 'upperArm.L', shape: 'capsule', radius: 0.045, length: 0.20, mass: 1.5, joint: 'hinge', hingeAxis: new Vector3(0, 0, 1), hingeMin: elbowRange.min, hingeMax: elbowRange.max },
    { boneName: 'shoulder.R', parentBone: 'chest', shape: 'sphere', radius: 0.05, mass: 1, joint: 'cone', swingLimit: shoulderSwing, twistMin: 0, twistMax: 0 },
    { boneName: 'upperArm.R', parentBone: 'shoulder.R', shape: 'capsule', radius: 0.05, length: 0.22, mass: 2, joint: 'cone', swingLimit: shoulderSwing, twistMin: -Math.PI / 4, twistMax: Math.PI / 4, twistEnabled: true },
    { boneName: 'lowerArm.R', parentBone: 'upperArm.R', shape: 'capsule', radius: 0.045, length: 0.20, mass: 1.5, joint: 'hinge', hingeAxis: new Vector3(0, 0, 1), hingeMin: elbowRange.min, hingeMax: elbowRange.max },
    { boneName: 'thigh.L', parentBone: 'pelvis', shape: 'capsule', radius: 0.065, length: 0.24, mass: 5, joint: 'cone', swingLimit: hipSwing, twistMin: -Math.PI / 6, twistMax: Math.PI / 6, twistEnabled: true },
    { boneName: 'shin.L', parentBone: 'thigh.L', shape: 'capsule', radius: 0.055, length: 0.22, mass: 3, joint: 'hinge', hingeAxis: new Vector3(0, 0, 1), hingeMin: kneeRange.min, hingeMax: kneeRange.max },
    { boneName: 'foot.L', parentBone: 'shin.L', shape: 'box', halfExtents: new Vector3(0.07, 0.03, 0.11), mass: 1, joint: 'cone', swingLimit: Math.PI / 6, twistMin: 0, twistMax: 0 },
    { boneName: 'thigh.R', parentBone: 'pelvis', shape: 'capsule', radius: 0.065, length: 0.24, mass: 5, joint: 'cone', swingLimit: hipSwing, twistMin: -Math.PI / 6, twistMax: Math.PI / 6, twistEnabled: true },
    { boneName: 'shin.R', parentBone: 'thigh.R', shape: 'capsule', radius: 0.055, length: 0.22, mass: 3, joint: 'hinge', hingeAxis: new Vector3(0, 0, 1), hingeMin: kneeRange.min, hingeMax: kneeRange.max },
    { boneName: 'foot.R', parentBone: 'shin.R', shape: 'box', halfExtents: new Vector3(0.07, 0.03, 0.11), mass: 1, joint: 'cone', swingLimit: Math.PI / 6, twistMin: 0, twistMax: 0 },
  ];
}

const _v1 = new Vector3();
const _v2 = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _qTmp = new Quaternion();

export class RagdollSystem {
  /** 所有 RagdollBone(按配置顺序)。 */
  bones: RagdollBone[] = [];
  /** boneName → RagdollBone 索引。 */
  readonly boneIndex = new Map<string, RagdollBone>();
  /** 约束求解器。 */
  solver: ConstraintSolver;
  /** 配置。 */
  gravity: Vector3;
  linearDamping: number;
  angularDamping: number;
  friction: number;
  restitution: number;
  groundCollision: boolean;
  groundY: number;
  fixedDt: number;
  /** 累积时间(用于固定步推进)。 */
  private accumulator: number = 0;
  /** 是否在 kinematic(动画驱动)模式。 */
  kinematicMode: boolean = false;

  constructor(opts: RagdollOptions = {}) {
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -9.8, 0);
    this.linearDamping = opts.linearDamping ?? 0.05;
    this.angularDamping = opts.angularDamping ?? 0.05;
    this.friction = opts.friction ?? 0.6;
    this.restitution = opts.restitution ?? 0.05;
    this.groundCollision = opts.groundCollision ?? false;
    this.groundY = opts.groundY ?? 0;
    this.fixedDt = opts.fixedDt ?? 1 / 60;
    this.solver = new ConstraintSolver(opts.constraintIterations ?? 12);
  }

  /** 从 Skeleton + 配置构建 ragdoll。调用前需先 updateMatrixWorld(true) 让骨骼世界变换就绪。 */
  build(bones: Bone[], configs: RagdollBoneConfig[]): void {
    this.clear();
    // 索引 Bone.name → Bone
    const boneMap = new Map<string, Bone>();
    for (const b of bones) boneMap.set(b.name, b);

    // 先创建所有 RagdollBone(不带 joint,joint 需要引用 parent.body)
    for (const cfg of configs) {
      const bone = boneMap.get(cfg.boneName);
      if (!bone) throw new Error(`RagdollSystem.build: bone not found: ${cfg.boneName}`);
      const body = this.createRigidbody(bone, cfg);
      const rb: RagdollBone = { config: cfg, bone, parent: null, body, joint: null };
      this.bones.push(rb);
      this.boneIndex.set(cfg.boneName, rb);
    }

    // 设置 parent 关系 + 创建 joint
    for (const rb of this.bones) {
      const cfg = rb.config;
      if (!cfg.parentBone) {
        continue;
      }
      const parent = this.boneIndex.get(cfg.parentBone);
      if (!parent) throw new Error(`RagdollSystem.build: parent bone not found: ${cfg.parentBone}`);
      rb.parent = parent;
      rb.joint = this.createJoint(parent, rb);
      if (rb.joint) this.solver.addConstraint(rb.joint);
    }
  }

  /** 清空所有 ragdoll 状态。 */
  clear(): void {
    this.bones = [];
    this.boneIndex.clear();
    this.solver.clear();
    this.accumulator = 0;
  }

  /** 推进一帧(可变步长,内部按 fixedDt 子步推进)。 */
  update(dt: number): void {
    if (this.bones.length === 0) return;
    if (this.kinematicMode) {
      // kinematic 模式:刚体跟随 Bone,不模拟物理
      this.syncBodiesToBones();
      return;
    }
    this.accumulator += Math.min(dt, 0.1); // 防大步长
    while (this.accumulator >= this.fixedDt) {
      this.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }
    this.writeBackToBones();
  }

  /** 单步固定步长模拟。 */
  private step(dt: number): void {
    // 1) 累积重力 + 阻尼
    for (const rb of this.bones) {
      const b = rb.body;
      if (b.invMass <= 0) continue;
      // 重力
      b.velocity.x += this.gravity.x * dt;
      b.velocity.y += this.gravity.y * dt;
      b.velocity.z += this.gravity.z * dt;
      // 阻尼
      const ld = Math.max(0, 1 - this.linearDamping * dt);
      const ad = Math.max(0, 1 - this.angularDamping * dt);
      b.velocity.multiplyScalar(ld);
      b.angularVelocity.multiplyScalar(ad);
    }

    // 2) 速度积分位置 + 四元数
    for (const rb of this.bones) {
      const b = rb.body;
      if (b.invMass <= 0) continue;
      b.position.x += b.velocity.x * dt;
      b.position.y += b.velocity.y * dt;
      b.position.z += b.velocity.z * dt;
      // quaternion += 0.5 * (omega * quaternion) * dt
      const omega = b.angularVelocity;
      const qx = b.quaternion.x, qy = b.quaternion.y, qz = b.quaternion.z, qw = b.quaternion.w;
      // dq/dt = 0.5 * omega(as quaternion) * q
      _q1.set(omega.x * 0.5, omega.y * 0.5, omega.z * 0.5, 0);
      _q2.copy(_q1).multiply(b.quaternion);
      // Quaternion 没有 multiplyScalar,手动按 dt 缩放
      _q2.x *= dt; _q2.y *= dt; _q2.z *= dt; _q2.w *= dt;
      b.quaternion.x = qx + _q2.x;
      b.quaternion.y = qy + _q2.y;
      b.quaternion.z = qz + _q2.z;
      b.quaternion.w = qw + _q2.w;
      b.quaternion.normalize();
    }

    // 3) 约束求解
    this.solver.solveAll(dt);

    // 4) 可选地面碰撞
    if (this.groundCollision) {
      this.solveGroundCollision();
    }
  }

  /** 地面碰撞:对每个非固定刚体,如果低于 groundY,投影到地面并施加冲量。 */
  private solveGroundCollision(): void {
    for (const rb of this.bones) {
      const b = rb.body;
      if (b.invMass <= 0) continue;
      // 简化:用刚体最低点(中心 - 形状半径)
      let lowest = b.position.y;
      let radius = 0;
      if (b.shape === 'sphere') radius = b.radius;
      else if (b.shape === 'capsule') radius = b.radius;
      else if (b.shape === 'box') radius = Math.min(b.halfExtents.x, b.halfExtents.y, b.halfExtents.z);
      lowest -= radius;
      if (lowest >= this.groundY) continue;

      // 位置投影
      const penetration = this.groundY - lowest;
      b.position.y += penetration;

      // 速度修正:法向(沿 +Y)冲量
      const vNorm = b.velocity.y;
      if (vNorm < 0) {
        const e = this.restitution;
        const j = -(1 + e) * vNorm / b.invMass;
        b.velocity.y += j * b.invMass;
        // 摩擦:切向冲量
        const vtX = b.velocity.x;
        const vtZ = b.velocity.z;
        const vtLen = Math.hypot(vtX, vtZ);
        if (vtLen > 1e-6) {
          const maxFriction = this.friction * Math.abs(j);
          const frictionImpulse = Math.min(vtLen, maxFriction) / vtLen;
          b.velocity.x -= vtX * frictionImpulse;
          b.velocity.z -= vtZ * frictionImpulse;
        }
        // 角阻尼(地面接触时减小角速度)
        b.angularVelocity.multiplyScalar(0.9);
      }
    }
  }

  /** 把刚体的世界变换写回 Bone 的本地变换。 */
  private writeBackToBones(): void {
    // 先从根开始,确保父节点世界变换已更新
    const root = this.bones.find((b) => b.parent === null);
    if (!root) return;

    // 写回顺序:按拓扑顺序(父先于子)
    const sorted = this.topologicalSort();

    for (const rb of sorted) {
      const b = rb.bone;
      const parent = b.parent;
      if (parent) {
        // 计算父节点的世界变换(已被 updateMatrixWorld 缓存)
        // localPos = parentWorldInv * bodyPos
        // localRot = parentWorldRotInv * bodyRot
        parent.updateMatrixWorld(true);
        // 提取父世界变换
        extractWorldTRS(parent, _v1, _q1);
        _q2.copy(_q1).invert();
        // localRot = inv(parentWorldRot) * bodyRot
        _qTmp.copy(rb.body.quaternion);
        _q2.multiply(_qTmp);
        // localPos = inv(parentWorldRot) * (bodyPos - parentWorldPos)
        _v2.copy(rb.body.position).sub(_v1).applyQuaternion(_q2);
        b.position.copy(_v2);
        b.rotation.copy(_q2);
      } else {
        // 根骨头:直接写世界变换
        b.position.copy(rb.body.position);
        b.rotation.copy(rb.body.quaternion);
      }
      b.updateMatrix();
      b.updateMatrixWorld(true);
    }
  }

  /** 拓扑排序(父先于子)。 */
  private topologicalSort(): RagdollBone[] {
    const visited = new Set<RagdollBone>();
    const result: RagdollBone[] = [];
    const visit = (rb: RagdollBone) => {
      if (visited.has(rb)) return;
      if (rb.parent) visit(rb.parent);
      visited.add(rb);
      result.push(rb);
    };
    for (const rb of this.bones) visit(rb);
    return result;
  }

  /** kinematic 模式:把刚体位置同步到 Bone(动画驱动刚体)。 */
  private syncBodiesToBones(): void {
    for (const rb of this.bones) {
      rb.bone.updateMatrixWorld(true);
      extractWorldTRS(rb.bone, _v1, _q1);
      rb.body.position.copy(_v1);
      rb.body.quaternion.copy(_q1);
      rb.body.velocity.set(0, 0, 0);
      rb.body.angularVelocity.set(0, 0, 0);
    }
  }

  /** 创建刚体并初始化位置/朝向/惯性张量。 */
  private createRigidbody(bone: Bone, cfg: RagdollBoneConfig): RagdollRigidbody {
    bone.updateMatrixWorld(true);
    extractWorldTRS(bone, _v1, _q1);
    const pinned = cfg.pinned ?? false;
    const mass = pinned ? 0 : cfg.mass;
    const invMass = pinned ? 0 : 1 / cfg.mass;

    const shape = cfg.shape;
    const radius = cfg.radius ?? 0.05;
    const length = cfg.length ?? 0;
    const halfExtents = cfg.halfExtents ?? new Vector3(0.05, 0.05, 0.05);

    const body: RagdollRigidbody = {
      position: _v1.clone(),
      quaternion: _q1.clone(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
      mass,
      invMass,
      invInertia: computeInertiaTensor(shape, mass, radius, length, halfExtents),
      shape,
      radius,
      length,
      halfExtents: halfExtents.clone(),
      linearDamping: this.linearDamping,
      angularDamping: this.angularDamping,
      friction: this.friction,
      restitution: this.restitution,
    };
    return body;
  }

  /** 创建关节约束。 */
  private createJoint(parent: RagdollBone, child: RagdollBone): Constraint | null {
    const cfg = child.config;
    const jointType = cfg.joint ?? 'cone';

    // 锚点:parent 端在 parentBone 本地空间的 parentAnchor,bone 端在 bone 本地空间的 boneAnchor
    const parentAnchor = cfg.parentAnchor ?? new Vector3();
    const boneAnchor = cfg.boneAnchor ?? new Vector3();

    if (jointType === 'cone') {
      const c = new ConeTwistConstraint(parent.body, child.body, parentAnchor, boneAnchor);
      c.swingLimit = cfg.swingLimit ?? Math.PI / 4;
      c.twistMin = cfg.twistMin ?? -Math.PI / 4;
      c.twistMax = cfg.twistMax ?? Math.PI / 4;
      c.twistEnabled = cfg.twistEnabled ?? false;
      return c;
    }
    if (jointType === 'hinge') {
      const axis = cfg.hingeAxis ?? new Vector3(0, 1, 0);
      const h = new HingeJointConstraint(parent.body, child.body, parentAnchor, boneAnchor, axis, axis.clone());
      // HingeJointConstraint 当前实现无角度限制,这里靠 axis 对齐约束相对旋转
      void cfg.hingeMin; void cfg.hingeMax;
      return h;
    }
    if (jointType === 'fixed') {
      // 用 ConeTwistConstraint swingLimit=0 + twistEnabled=[0,0] 近似 fixed
      const c = new ConeTwistConstraint(parent.body, child.body, parentAnchor, boneAnchor);
      c.swingLimit = 0;
      c.twistMin = 0;
      c.twistMax = 0;
      c.swingEnabled = true;
      c.twistEnabled = true;
      return c;
    }
    if (jointType === 'ball') {
      // 纯球关节,无角度限制
      const c = new ConeTwistConstraint(parent.body, child.body, parentAnchor, boneAnchor);
      c.swingLimit = Math.PI;
      c.swingEnabled = false;
      c.twistEnabled = false;
      return c;
    }
    return null;
  }

  /** 对指定骨头施加冲量(世界空间)。 */
  applyImpulse(boneName: string, impulse: Vector3): boolean {
    const rb = this.boneIndex.get(boneName);
    if (!rb) return false;
    applyImpulse(rb.body, impulse, new Vector3());
    return true;
  }

  /** 对指定骨头施加角冲量(世界空间)。 */
  applyAngularImpulse(boneName: string, angularImpulse: Vector3): boolean {
    const rb = this.boneIndex.get(boneName);
    if (!rb) return false;
    const b = rb.body;
    if (b.invMass <= 0) return false;
    const dOmega = mat3MulVec_safe(b.invInertia, angularImpulse);
    b.angularVelocity.add(dOmega);
    return true;
  }

  /** 设置骨头为固定/非固定(运行时切换)。 */
  setPinned(boneName: string, pinned: boolean): boolean {
    const rb = this.boneIndex.get(boneName);
    if (!rb) return false;
    const b = rb.body;
    if (pinned) {
      b.mass = 0;
      b.invMass = 0;
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
    } else {
      b.mass = rb.config.mass;
      b.invMass = 1 / b.mass;
    }
    return true;
  }

  /** 获取统计信息。 */
  getStats(): RagdollStats {
    let totalMass = 0;
    let pinnedCount = 0;
    let jointCount = 0;
    for (const rb of this.bones) {
      if (rb.body.invMass > 0) totalMass += rb.body.mass;
      else pinnedCount++;
      if (rb.joint) jointCount++;
    }
    return {
      boneCount: this.bones.length,
      jointCount,
      pinnedCount,
      totalMass,
      constraintIterations: this.solver.iterations,
      gravity: this.gravity.clone(),
    };
  }
}

/** 从 Object3D 的 matrixWorld 提取世界位置和旋转(假设无非均匀缩放)。 */
function extractWorldTRS(obj: Object3D, outPos: Vector3, outRot: Quaternion): void {
  const e = obj.matrixWorld.elements;
  outPos.set(e[12], e[13], e[14]);
  const m00 = e[0], m01 = e[4], m02 = e[8];
  const m10 = e[1], m11 = e[5], m12 = e[9];
  const m20 = e[2], m21 = e[6], m22 = e[10];
  setQuatFromRotationMatrix(outRot, m00, m01, m02, m10, m11, m12, m20, m21, m22);
}

/** 从 3x3 旋转矩阵(行主序参数)设置四元数。 */
function setQuatFromRotationMatrix(
  q: Quaternion,
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): void {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q.w = 0.25 / s;
    q.x = (m21 - m12) * s;
    q.y = (m02 - m20) * s;
    q.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q.w = (m21 - m12) / s;
    q.x = 0.25 * s;
    q.y = (m01 + m10) / s;
    q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q.w = (m02 - m20) / s;
    q.x = (m01 + m10) / s;
    q.y = 0.25 * s;
    q.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q.w = (m10 - m01) / s;
    q.x = (m02 + m20) / s;
    q.y = (m12 + m21) / s;
    q.z = 0.25 * s;
  }
  q.normalize();
}

/** 计算碰撞器形状对应的逆惯性张量(世界空间对角矩阵,column-major)。
 *  假设碰撞器主轴与刚体本地轴对齐。返回 column-major 9 元组。 */
function computeInertiaTensor(
  shape: RagdollShape,
  mass: number,
  radius: number,
  length: number,
  halfExtents: Vector3,
): Mat3 {
  if (mass <= 0) return mat3Identity();
  let Ixx = 0, Iyy = 0, Izz = 0;
  if (shape === 'sphere') {
    // I = 2/5 * m * r²
    const I = 0.4 * mass * radius * radius;
    Ixx = Iyy = Izz = I;
  } else if (shape === 'capsule') {
    // 胶囊沿 Y 轴(长度 length,半径 radius)
    // 简化:用圆柱体公式
    // Ixx = Izz = m*(3r² + h²)/12; Iyy = m*r²/2
    const h = length;
    Ixx = Izz = mass * (3 * radius * radius + h * h) / 12;
    Iyy = mass * radius * radius / 2;
  } else {
    // box:Ixx = m(hy²+hz²)/3,等
    const hx = halfExtents.x, hy = halfExtents.y, hz = halfExtents.z;
    Ixx = mass * (hy * hy + hz * hz) / 3;
    Iyy = mass * (hx * hx + hz * hz) / 3;
    Izz = mass * (hx * hx + hy * hy) / 3;
  }
  // 逆 = 1/Ixx, 1/Iyy, 1/Izz(对角矩阵)
  // column-major: [invIxx, 0, 0, 0, invIyy, 0, 0, 0, invIzz]
  return [
    1 / Ixx, 0, 0,
    0, 1 / Iyy, 0,
    0, 0, 1 / Izz,
  ];
}

/** mat3MulVec 的本地封装(避免循环导入检查)。 */
function mat3MulVec_safe(m: Mat3, v: Vector3): Vector3 {
  const out = new Vector3();
  out.x = m[0] * v.x + m[3] * v.y + m[6] * v.z;
  out.y = m[1] * v.x + m[4] * v.y + m[7] * v.z;
  out.z = m[2] * v.x + m[5] * v.y + m[8] * v.z;
  return out;
}

// ProceduralAnimation — 程序化动画系统。
// 在骨骼动画之上叠加程序化运动:步态生成 / 头部追踪 / 二次运动 / 呼吸 / 待机摇摆等。
//
// 设计:
//   * 与 AnimationMixer 互补:Mixer 播放预录关键帧clip,ProceduralAnimation
//     生成无数据的程序化运动(正弦/噪声/物理近似),二者可串联(Mixer 先 pose,
//     ProceduralAnimation 再叠加微动)。
//   * 节点模型:每个 ProceduralNode 绑定一根骨骼(target = 骨骼名),持类型 +
//     权重 + 参数表(Map<string, number>)。权重做 slerp 混合,0 = 不影响。
//   * `update(dt, skeleton)` 每帧迭代启用节点,按 type 分派到对应更新函数。
//     需要外部输入的节点(headTrack/lookAt/reach 需要 target,walkCycle/runCycle
//     需要 speed,secondaryMotion 需要 velocity)从 params 表读取
//     (targetX/Y/Z、speed、velX/Y/Z),调用方通过 setNodeParam 写入。
//   * 骨骼查找:按 name 在 skeleton.bones 中查找;未找到则跳过该节点。
//   * 程序化运动修改骨骼的 LOCAL rotation/position(与 AnimationMixer 一致,
//     后续 updateMatrixWorld 统一计算世界矩阵)。
//
// 与 IK 的关系:reach 节点是简化版"伸手"(直接把骨骼位置朝目标插值),
// 不做 IK 链求解;精确 IK 用 IKSolver/IKHumanoid。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import type { Skeleton } from '../Core/Skeleton';
import type { Bone } from '../Core/Bone';

/** 程序化节点类型。 */
export type ProceduralNodeType =
  | 'headTrack'
  | 'breathing'
  | 'walkCycle'
  | 'runCycle'
  | 'idleSway'
  | 'lookAt'
  | 'reach'
  | 'secondaryMotion';

/** 单个程序化节点:绑定一根骨骼,持类型 + 权重 + 参数表。 */
export interface ProceduralNode {
  /** 节点唯一 id。 */
  id: string;
  /** 节点类型。 */
  type: ProceduralNodeType;
  /** 绑定的骨骼名(skeleton.bones 中按 name 查找)。 */
  target: string;
  /** 混合权重 [0,1]。0 = 不影响,1 = 完全覆盖。 */
  weight: number;
  /** 参数表(数值)。各类型节点的参数语义见下方更新函数。 */
  params: Map<string, number>;
  /** 是否启用。 */
  enabled: boolean;
}

/** `getStats()` 返回的统计信息。 */
export interface ProceduralAnimationStats {
  /** 节点总数。 */
  nodeCount: number;
  /** 启用节点数。 */
  enabledCount: number;
  /** 累计时间(秒)。 */
  time: number;
  /** 按类型分组的节点数。 */
  typeCounts: Record<string, number>;
}

// 内部复用的临时变量
const _v1 = new Vector3();
const _v2 = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();

export class ProceduralAnimation {
  /** 所有程序化节点(id → node)。 */
  proceduralNodes: Map<string, ProceduralNode> = new Map();
  /** 累计时间(秒)。 */
  time: number = 0;
  /** 系统总开关。 */
  enabled: boolean = true;

  /** id 计数器,保证唯一。 */
  private _idCounter: number = 0;

  /**
   * 添加程序化节点。
   * @param type   节点类型
   * @param target 绑定的骨骼名
   * @returns 新节点的 id
   */
  addNode(type: ProceduralNodeType, target: string): string {
    const id = `pa_${++this._idCounter}`;
    const node: ProceduralNode = {
      id,
      type,
      target,
      weight: 1,
      params: new Map(),
      enabled: true,
    };
    // 各类型节点的默认参数
    applyDefaultParams(node);
    this.proceduralNodes.set(id, node);
    return id;
  }

  /**
   * 移除节点。
   * @returns 是否成功移除
   */
  removeNode(id: string): boolean {
    return this.proceduralNodes.delete(id);
  }

  /**
   * 设置节点参数。已存在则更新,不存在则新增。
   */
  setNodeParam(id: string, name: string, value: number): void {
    const node = this.proceduralNodes.get(id);
    if (!node) return;
    node.params.set(name, value);
  }

  /**
   * 获取节点参数。不存在返回 0。
   */
  getNodeParam(id: string, name: string): number {
    const node = this.proceduralNodes.get(id);
    if (!node) return 0;
    const v = node.params.get(name);
    return v === undefined ? 0 : v;
  }

  /**
   * 设置节点权重(自动 clamp 到 [0,1])。
   */
  setNodeWeight(id: string, weight: number): void {
    const node = this.proceduralNodes.get(id);
    if (!node) return;
    node.weight = Math.max(0, Math.min(1, weight));
  }

  /** 启用节点。 */
  enableNode(id: string): void {
    const node = this.proceduralNodes.get(id);
    if (node) node.enabled = true;
  }

  /** 禁用节点。 */
  disableNode(id: string): void {
    const node = this.proceduralNodes.get(id);
    if (node) node.enabled = false;
  }

  /** 获取所有节点(按插入序)。 */
  getNodes(): ProceduralNode[] {
    return Array.from(this.proceduralNodes.values());
  }

  /**
   * 每帧更新:推进时间,迭代启用节点并按类型分派。
   * @param dt       帧间隔(秒)
   * @param skeleton 目标骨骼(节点 target 按 name 查找)
   */
  update(dt: number, skeleton: Skeleton): void {
    if (!this.enabled) return;
    if (dt > 0) this.time += dt;
    for (const node of this.proceduralNodes.values()) {
      if (!node.enabled || node.weight <= 0) continue;
      const bone = findBone(skeleton, node.target);
      if (!bone) continue;
      switch (node.type) {
        case 'headTrack': {
          _v1.set(
            node.params.get('targetX') ?? 0,
            node.params.get('targetY') ?? 0,
            node.params.get('targetZ') ?? 0,
          );
          this.updateHeadTrack(node, skeleton, _v1);
          break;
        }
        case 'breathing':
          this.updateBreathing(node, skeleton);
          break;
        case 'walkCycle': {
          const speed = node.params.get('speed') ?? 1;
          this.updateWalkCycle(node, skeleton, speed);
          break;
        }
        case 'runCycle': {
          const speed = node.params.get('speed') ?? 2;
          this.updateRunCycle(node, skeleton, speed);
          break;
        }
        case 'idleSway':
          this.updateIdleSway(node, skeleton);
          break;
        case 'lookAt': {
          _v1.set(
            node.params.get('targetX') ?? 0,
            node.params.get('targetY') ?? 0,
            node.params.get('targetZ') ?? 0,
          );
          this.updateLookAt(node, skeleton, _v1);
          break;
        }
        case 'reach': {
          _v1.set(
            node.params.get('targetX') ?? 0,
            node.params.get('targetY') ?? 0,
            node.params.get('targetZ') ?? 0,
          );
          this.updateReach(node, skeleton, _v1);
          break;
        }
        case 'secondaryMotion': {
          _v1.set(
            node.params.get('velX') ?? 0,
            node.params.get('velY') ?? 0,
            node.params.get('velZ') ?? 0,
          );
          this.updateSecondaryMotion(node, skeleton, _v1);
          break;
        }
      }
    }
  }

  /**
   * 头部追踪:旋转骨骼朝向 target(局部空间)。
   * 参数:maxAngle(最大转角弧度,默认 π/2)。
   * 实现:计算 target 相对骨骼本地位置的方向,用 setFromUnitVectors 算目标旋转,
   *      与当前旋转 slerp(weight),再按 maxAngle 限制。
   */
  updateHeadTrack(node: ProceduralNode, skeleton: Skeleton, target: Vector3): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    _v1.subVectors(target, bone.position);
    const len = _v1.length();
    if (len < 1e-6) return;
    _v1.divideScalar(len); // 单位方向
    // 骨骼本地 +Z 作为"前方"
    _v2.set(0, 0, 1);
    _q1.setFromUnitVectors(_v2, _v1);
    // 限制最大转角
    const maxAngle = node.params.get('maxAngle') ?? Math.PI / 2;
    clampRotation(_q1, maxAngle);
    blendRotation(bone, _q1, node.weight);
  }

  /**
   * 呼吸:胸腔骨骼缩放正弦起伏(设置式,不累积)。
   * 参数:rate(频率,默认 0.25Hz)、amplitude(幅度,默认 0.02)。
   * 实现:对骨骼 scale.y 做 1 + amplitude * phase 调制,按权重插值。
   */
  updateBreathing(node: ProceduralNode, skeleton: Skeleton): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    const rate = node.params.get('rate') ?? 0.25;
    const amplitude = node.params.get('amplitude') ?? 0.02;
    const phase = Math.sin(this.time * rate * Math.PI * 2);
    const w = node.weight;
    // 缩放 y:1 + amplitude * phase,按权重插值(设置式,每帧重算不累积)
    bone.scale.y = 1 + amplitude * phase * w;
  }

  /**
   * 步态周期:腿部骨骼绕 X 轴正弦摆动(前后)。
   * 参数:frequency(步频,默认 1)、amplitude(摆幅弧度,默认 0.4)。
   * speed 缩放 frequency(speed 越大步频越快)。
   */
  updateWalkCycle(node: ProceduralNode, skeleton: Skeleton, speed: number): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    const frequency = node.params.get('frequency') ?? 1;
    const amplitude = node.params.get('amplitude') ?? 0.4;
    const phase = node.params.get('phase') ?? 0;
    const angle = Math.sin(this.time * frequency * speed * Math.PI * 2 + phase) * amplitude;
    _q1.setFromAxisAngle(_v1.set(1, 0, 0), angle);
    blendRotation(bone, _q1, node.weight);
  }

  /**
   * 跑步周期:类似 walkCycle 但更大摆幅 + 更快步频。
   * 参数:frequency(默认 1.6)、amplitude(默认 0.7)。
   */
  updateRunCycle(node: ProceduralNode, skeleton: Skeleton, speed: number): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    const frequency = node.params.get('frequency') ?? 1.6;
    const amplitude = node.params.get('amplitude') ?? 0.7;
    const phase = node.params.get('phase') ?? 0;
    const angle = Math.sin(this.time * frequency * speed * Math.PI * 2 + phase) * amplitude;
    _q1.setFromAxisAngle(_v1.set(1, 0, 0), angle);
    blendRotation(bone, _q1, node.weight);
  }

  /**
   * 待机摇摆:躯干骨骼小幅 Z 轴正弦摇摆 + Y 轴微转。
   * 参数:rate(默认 0.5)、amplitude(默认 0.05)。
   */
  updateIdleSway(node: ProceduralNode, skeleton: Skeleton): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    const rate = node.params.get('rate') ?? 0.5;
    const amplitude = node.params.get('amplitude') ?? 0.05;
    const phaseZ = Math.sin(this.time * rate * Math.PI * 2) * amplitude;
    const phaseY = Math.cos(this.time * rate * Math.PI * 2 * 0.5) * amplitude * 0.5;
    _q1.setFromAxisAngle(_v1.set(0, 0, 1), phaseZ);
    _q2.setFromAxisAngle(_v2.set(0, 1, 0), phaseY);
    _q1.multiply(_q2);
    blendRotation(bone, _q1, node.weight);
  }

  /**
   * 注视目标:与 headTrack 等价但语义上用于眼/头独立节点。
   * 参数:maxAngle(默认 π/3)。
   */
  updateLookAt(node: ProceduralNode, skeleton: Skeleton, target: Vector3): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    _v1.subVectors(target, bone.position);
    const len = _v1.length();
    if (len < 1e-6) return;
    _v1.divideScalar(len);
    _v2.set(0, 0, 1);
    _q1.setFromUnitVectors(_v2, _v1);
    const maxAngle = node.params.get('maxAngle') ?? Math.PI / 3;
    clampRotation(_q1, maxAngle);
    blendRotation(bone, _q1, node.weight);
  }

  /**
   * 伸手:把骨骼本地位置朝 target 插值移动(简化版,非 IK 链)。
   * 参数:stiffness(趋近系数 0..1,默认 0.3)。
   */
  updateReach(node: ProceduralNode, skeleton: Skeleton, target: Vector3): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    const stiffness = node.params.get('stiffness') ?? 0.3;
    const w = node.weight * Math.max(0, Math.min(1, stiffness));
    bone.position.x += (target.x - bone.position.x) * w;
    bone.position.y += (target.y - bone.position.y) * w;
    bone.position.z += (target.z - bone.position.z) * w;
  }

  /**
   * 二次运动(惯性/跟随):骨骼朝 velocity 反方向倾斜,模拟惯性滞后。
   * 参数:stiffness(刚度 0..1,默认 0.5)、damping(阻尼 0..1,默认 0.1)。
   * 实现:目标旋转 = 由 velocity 反向推算的倾斜角;与当前旋转 slerp。
   */
  updateSecondaryMotion(node: ProceduralNode, skeleton: Skeleton, velocity: Vector3): void {
    const bone = findBone(skeleton, node.target);
    if (!bone) return;
    const stiffness = node.params.get('stiffness') ?? 0.5;
    const damping = node.params.get('damping') ?? 0.1;
    const speed = velocity.length();
    if (speed < 1e-6) return;
    // 倾斜方向:velocity 反向在 XZ 平面的投影,绕与之垂直的轴倾斜
    _v1.copy(velocity).multiplyScalar(-1);
    _v1.y = 0;
    const horizLen = _v1.length();
    if (horizLen < 1e-6) return;
    _v1.divideScalar(horizLen);
    // 倾斜轴 = up × horizDir (绕该轴倾斜)
    _v2.set(0, 1, 0);
    const tiltAxis = _v2.cross(_v1); // (0,1,0) × horiz
    const tiltAxisLen = tiltAxis.length();
    if (tiltAxisLen < 1e-6) return;
    tiltAxis.divideScalar(tiltAxisLen);
    // 倾斜角 ∝ speed * damping,上限由 stiffness 约束
    const tiltAngle = Math.min(Math.PI / 4, speed * damping) * stiffness;
    _q1.setFromAxisAngle(tiltAxis, tiltAngle);
    blendRotation(bone, _q1, node.weight);
  }

  /** 启用/禁用系统总开关。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 清空所有节点并重置时间。 */
  clear(): void {
    this.proceduralNodes.clear();
    this.time = 0;
  }

  /** 获取统计信息。 */
  getStats(): ProceduralAnimationStats {
    let enabledCount = 0;
    const typeCounts: Record<string, number> = {};
    for (const node of this.proceduralNodes.values()) {
      if (node.enabled) enabledCount++;
      typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
    }
    return {
      nodeCount: this.proceduralNodes.size,
      enabledCount,
      time: this.time,
      typeCounts,
    };
  }
}

// ── 内部工具 ──────────────────────────────────────────────────────────

/** 在 skeleton.bones 中按 name 查找骨骼。 */
function findBone(skeleton: Skeleton, name: string): Bone | null {
  for (let i = 0; i < skeleton.bones.length; i++) {
    if (skeleton.bones[i].name === name) return skeleton.bones[i];
  }
  return null;
}

/**
 * 把目标旋转按权重 slerp 混合到 bone.rotation。
 * weight=0 不动,weight=1 直接覆盖,中间值做 slerp。
 */
function blendRotation(bone: Bone, target: Quaternion, weight: number): void {
  if (weight <= 0) return;
  if (weight >= 1) {
    bone.rotation.copy(target);
    return;
  }
  _q2.copy(bone.rotation).slerp(target, weight);
  bone.rotation.copy(_q2);
}

/**
 * 限制四元数旋转角度不超过 maxAngle(弧度)。
 * 超过则按 maxAngle 重新构造(保持轴方向)。
 */
function clampRotation(q: Quaternion, maxAngle: number): void {
  const axis = _v1.set(0, 0, 0);
  const angle = q.toAxisAngle(axis);
  if (angle > maxAngle) {
    q.setFromAxisAngle(axis, maxAngle);
  }
}

/** 为各类型节点写入默认参数(仅当未设置时)。 */
function applyDefaultParams(node: ProceduralNode): void {
  const set = (name: string, value: number): void => {
    if (!node.params.has(name)) node.params.set(name, value);
  };
  switch (node.type) {
    case 'headTrack':
      set('targetX', 0);
      set('targetY', 0);
      set('targetZ', 1);
      set('maxAngle', Math.PI / 2);
      break;
    case 'breathing':
      set('rate', 0.25);
      set('amplitude', 0.02);
      break;
    case 'walkCycle':
      set('frequency', 1);
      set('amplitude', 0.4);
      set('phase', 0);
      set('speed', 1);
      break;
    case 'runCycle':
      set('frequency', 1.6);
      set('amplitude', 0.7);
      set('phase', 0);
      set('speed', 2);
      break;
    case 'idleSway':
      set('rate', 0.5);
      set('amplitude', 0.05);
      break;
    case 'lookAt':
      set('targetX', 0);
      set('targetY', 0);
      set('targetZ', 1);
      set('maxAngle', Math.PI / 3);
      break;
    case 'reach':
      set('targetX', 0);
      set('targetY', 0);
      set('targetZ', 1);
      set('stiffness', 0.3);
      break;
    case 'secondaryMotion':
      set('velX', 0);
      set('velY', 0);
      set('velZ', 0);
      set('stiffness', 0.5);
      set('damping', 0.1);
      break;
  }
}

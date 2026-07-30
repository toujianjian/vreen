// PerceptionSystem — AI 感知系统(视觉/听觉/触觉/嗅觉 + 记忆)。
//
// 设计:
//   * 与行为树/Agent 解耦:纯数据 + 检测逻辑,由外部系统每帧调用 update
//   * 传感器(Sensor)挂载在拥有位置/朝向的 owner 上(Agent/Object3D/任意对象)
//   * 检测算法按 SensorType 分派:vision(FOV+距离+遮挡) / hearing(距离+噪声) /
//     touch(距离) / smell(距离+风向)
//   * 感知事件(PerceptionEvent)记录检测到的目标信息,超出 maxPerceptions 时淘汰最旧
//   * 灵敏度(sensitivity)作为二次阈值:通过几何检测但强度 < sensitivity 标记为
//     未确认(isConfirmed=false),代表模糊/微弱信号
//
// 与 AI 模块其他组件的关系:
//   * PerceptionSystem 可作为 BehaviorTree 的感知层:每帧 update → 把 confirmed
//     事件写入 Blackboard,行为树节点读取后决策
//   * 与 Agent 互补:Agent 负责移动,PerceptionSystem 负责"看到/听到"目标
//   * 与 CrowdSystem 互补:CrowdSystem 调度群体避障,PerceptionSystem 提供目标感知

import { Vector3 } from '../Math';

/** 传感器类型。 */
export type SensorType = 'vision' | 'hearing' | 'touch' | 'smell';

/** 传感器 — 挂载在 owner 上的感知器官。 */
export interface Sensor {
  /** 传感器唯一标识。 */
  id: string;
  /** 传感器类型。 */
  type: SensorType;
  /** 拥有者(需含 position: Vector3,可选 forward/velocity/rotation)。 */
  owner: any;
  /** 检测范围(单位距离)。 */
  range: number;
  /** 视野角度(弧度,仅 vision 使用;完整 FOV,half-angle = angle/2)。 */
  angle: number;
  /** 灵敏度阈值 [0,1](强度 >= sensitivity 视为已确认)。 */
  sensitivity: number;
  /** 目标类型过滤(空数组 = 接受所有类型)。 */
  filter: string[];
  /** 冷却时间(秒,两次检测间最小间隔)。 */
  cooldown: number;
  /** 最近一次触发时间戳(秒)。 */
  lastTrigger: number;
}

/** 感知事件 — 一次检测的完整记录。 */
export interface PerceptionEvent {
  /** 触发该事件的传感器 ID。 */
  sensorId: string;
  /** 目标类型(来自 target.type)。 */
  targetType: string;
  /** 目标对象引用。 */
  target: any;
  /** 检测到目标时的位置(快照,克隆避免后续修改)。 */
  position: Vector3;
  /** 检测强度 [0,1](距离越近强度越高)。 */
  strength: number;
  /** 事件时间戳(秒)。 */
  timestamp: number;
  /** 是否已确认(强度 >= 传感器灵敏度)。 */
  isConfirmed: boolean;
}

/** 感知目标最小契约:需提供位置与类型,可选噪声级别。 */
export interface PerceptionTarget {
  /** 目标位置。 */
  position: Vector3;
  /** 目标类型(用于 sensor.filter)。 */
  type: string;
  /** 目标发出的噪声级别(0-1+,仅 hearing 使用;未提供时默认 1.0)。 */
  noise?: number;
  [key: string]: unknown;
}

/** 遮挡测试回调:返回 true 表示 from→to 视线被遮挡。 */
export type OcclusionTest = (from: Vector3, to: Vector3) => boolean;

// 临时向量复用,避免热路径分配。
const _toTarget = new Vector3();
const _toSensor = new Vector3();
const _forward = new Vector3();

/** 从 owner 提取位置(鸭子类型校验:含 x/y/z number 字段)。 */
function getOwnerPosition(owner: any): Vector3 | null {
  if (!owner) return null;
  const pos = owner.position;
  if (
    pos &&
    typeof pos.x === 'number' &&
    typeof pos.y === 'number' &&
    typeof pos.z === 'number'
  ) {
    return pos as Vector3;
  }
  return null;
}

/** 从 owner 提取朝前方向(归一化)。
 *  优先级:owner.forward > owner.velocity(归一化) > owner.rotation 应用于 (0,0,-1)。
 *  无可用信息时返回默认 (0,0,-1)(Object3D 前向约定)。 */
function getOwnerForward(owner: any, out: Vector3): Vector3 {
  if (owner && owner.forward && typeof owner.forward.x === 'number') {
    out.copy(owner.forward as Vector3);
    const l = out.length();
    if (l > 1e-6) out.multiplyScalar(1 / l);
    return out;
  }
  if (
    owner &&
    owner.velocity &&
    typeof owner.velocity.x === 'number' &&
    owner.velocity.lengthSq() > 1e-6
  ) {
    out.copy(owner.velocity as Vector3);
    out.normalize();
    return out;
  }
  if (owner && owner.rotation && typeof owner.rotation.x === 'number' && typeof owner.rotation.w === 'number') {
    out.set(0, 0, -1);
    out.applyQuaternion(owner.rotation as any);
    const l = out.length();
    if (l > 1e-6) out.multiplyScalar(1 / l);
    return out;
  }
  out.set(0, 0, -1);
  return out;
}

/**
 * AI 感知系统 — 管理传感器集合 + 检测目标 + 记录感知事件。
 *
 * 用法:
 *   const ps = new PerceptionSystem();
 *   ps.addSensor('eyes', {
 *     id: 'eyes', type: 'vision', owner: agent,
 *     range: 20, angle: Math.PI / 2, sensitivity: 0.3,
 *     filter: ['enemy'], cooldown: 0.1, lastTrigger: 0,
 *   });
 *   ps.update(dt, enemies);
 *   const confirmed = ps.getRecentPerceptions(1.0).filter(e => e.isConfirmed);
 */
export class PerceptionSystem {
  /** 传感器表(id → Sensor)。 */
  sensors: Map<string, Sensor> = new Map();
  /** 感知事件缓冲(按时间顺序追加,超出 maxPerceptions 淘汰最旧)。 */
  perceptions: PerceptionEvent[] = [];
  /** 事件缓冲上限。 */
  maxPerceptions: number;
  /** 风向(归一化,仅 smell 使用;默认 +X)。 */
  windDirection: Vector3 = new Vector3(1, 0, 0);
  /** 风强度 [0,1](0=无风,1=强风;仅 smell 使用)。 */
  windStrength: number = 0;
  /** 可选遮挡测试(仅 vision 使用;未设置时假定无遮挡)。 */
  occlusionTest: OcclusionTest | null = null;
  /** 内部时钟(秒,由 update(dt) 累积)。 */
  protected currentTime: number = 0;

  constructor(maxPerceptions: number = 256) {
    this.maxPerceptions = maxPerceptions;
  }

  /** 添加传感器(同 id 覆盖)。 */
  addSensor(id: string, sensor: Sensor): this {
    if (!sensor) {
      throw new Error(`PerceptionSystem.addSensor: sensor is null (id=${id})`);
    }
    sensor.id = id;
    this.sensors.set(id, sensor);
    return this;
  }

  /** 移除传感器。 */
  removeSensor(id: string): this {
    this.sensors.delete(id);
    return this;
  }

  /** 获取传感器(不存在返回 undefined)。 */
  getSensor(id: string): Sensor | undefined {
    return this.sensors.get(id);
  }

  /** 获取所有传感器(数组快照)。 */
  getSensors(): Sensor[] {
    return Array.from(this.sensors.values());
  }

  /** 每帧更新:遍历传感器 → 检测目标 → 生成事件。 */
  update(dt: number, entities: PerceptionTarget[]): void {
    if (dt <= 0) return;
    this.currentTime += dt;
    for (const sensor of this.sensors.values()) {
      // 冷却检查:lastTrigger<=0 表示从未触发(初始状态),跳过冷却检查
      if (sensor.lastTrigger > 0 && this.currentTime - sensor.lastTrigger < sensor.cooldown) continue;
      const ownerPos = getOwnerPosition(sensor.owner);
      if (!ownerPos) continue;
      for (const target of entities) {
        // 跳过自身
        if (target === sensor.owner) continue;
        // 跳过无位置目标
        if (!target || !target.position) continue;
        // 类型过滤
        if (sensor.filter.length > 0 && !sensor.filter.includes(target.type)) continue;

        let detected = false;
        let strength = 0;
        switch (sensor.type) {
          case 'vision': {
            detected = this.checkVision(sensor, target);
            if (detected) {
              const d = ownerPos.distanceTo(target.position);
              strength = sensor.range > 0 ? Math.max(0, 1 - d / sensor.range) : 1;
            }
            break;
          }
          case 'hearing': {
            const noise = target.noise ?? 1.0;
            detected = this.checkHearing(sensor, target, noise);
            if (detected) {
              const d = ownerPos.distanceTo(target.position);
              const att = sensor.range > 0 ? 1 - d / sensor.range : 1;
              strength = Math.min(1, noise * att);
            }
            break;
          }
          case 'touch': {
            detected = this.checkTouch(sensor, target);
            if (detected) strength = 1;
            break;
          }
          case 'smell': {
            detected = this.checkSmell(sensor, target);
            if (detected) {
              const d = ownerPos.distanceTo(target.position);
              strength = sensor.range > 0 ? Math.max(0, 1 - d / sensor.range) : 1;
            }
            break;
          }
        }
        if (!detected) continue;
        // 灵敏度阈值:强度 >= sensitivity → confirmed
        const isConfirmed = strength >= sensor.sensitivity;
        this.pushEvent({
          sensorId: sensor.id,
          targetType: target.type,
          target,
          position: target.position.clone(),
          strength,
          timestamp: this.currentTime,
          isConfirmed,
        });
        // 记录确认时间(用于冷却判定;不 break,传感器可同帧检测多个目标)
        if (isConfirmed) {
          sensor.lastTrigger = this.currentTime;
        }
      }
    }
  }

  /** 视觉检测:距离 + FOV + 遮挡。 */
  checkVision(sensor: Sensor, target: PerceptionTarget): boolean {
    const ownerPos = getOwnerPosition(sensor.owner);
    if (!ownerPos) return false;
    const dist = ownerPos.distanceTo(target.position);
    if (dist > sensor.range || dist < 1e-6) return false;
    // FOV:forward · dirToTarget >= cos(halfAngle)
    getOwnerForward(sensor.owner, _forward);
    _toTarget.subVectors(target.position, ownerPos);
    _toTarget.normalize();
    const dot = _forward.dot(_toTarget);
    const halfAngle = sensor.angle / 2;
    if (dot < Math.cos(halfAngle)) return false;
    // 遮挡测试(可选)
    if (this.occlusionTest && this.occlusionTest(ownerPos, target.position)) return false;
    return true;
  }

  /** 听觉检测:距离衰减 + 噪声强度 >= 灵敏度。 */
  checkHearing(sensor: Sensor, target: PerceptionTarget, noise: number): boolean {
    const ownerPos = getOwnerPosition(sensor.owner);
    if (!ownerPos) return false;
    const dist = ownerPos.distanceTo(target.position);
    if (dist > sensor.range) return false;
    const attenuation = sensor.range > 0 ? 1 - dist / sensor.range : 1;
    const perceived = noise * attenuation;
    return perceived >= sensor.sensitivity;
  }

  /** 触觉检测:距离 <= range(touch 传感器 range 通常很小)。 */
  checkTouch(sensor: Sensor, target: PerceptionTarget): boolean {
    const ownerPos = getOwnerPosition(sensor.owner);
    if (!ownerPos) return false;
    const dist = ownerPos.distanceTo(target.position);
    return dist <= sensor.range;
  }

  /** 嗅觉检测:距离 + 风向(风从目标吹向 owner 时范围最大)。 */
  checkSmell(sensor: Sensor, target: PerceptionTarget): boolean {
    const ownerPos = getOwnerPosition(sensor.owner);
    if (!ownerPos) return false;
    const dist = ownerPos.distanceTo(target.position);
    if (dist > sensor.range || dist < 1e-6) return false;
    if (this.windStrength < 1e-6) {
      // 无风:气味扩散,有效范围减半
      return dist <= sensor.range * 0.5;
    }
    // 风向影响:风从目标吹向 owner 时 alignment=1(满范围),反向时 alignment=-1(1/4 范围)
    _toSensor.subVectors(ownerPos, target.position);
    _toSensor.normalize();
    const alignment = this.windDirection.dot(_toSensor);
    const effectiveRange = sensor.range * (0.25 + 0.75 * (alignment * 0.5 + 0.5));
    return dist <= effectiveRange;
  }

  /** 获取所有感知事件(引用,调用方不应直接修改)。 */
  getPerceptions(): PerceptionEvent[] {
    return this.perceptions;
  }

  /** 按目标类型筛选感知事件。 */
  getPerceptionsByType(type: string): PerceptionEvent[] {
    return this.perceptions.filter((e) => e.targetType === type);
  }

  /** 获取最近 timeWindow 秒内的感知事件。 */
  getRecentPerceptions(timeWindow: number): PerceptionEvent[] {
    const cutoff = this.currentTime - timeWindow;
    return this.perceptions.filter((e) => e.timestamp >= cutoff);
  }

  /** 清空所有感知事件(传感器保留)。 */
  clearPerceptions(): this {
    this.perceptions.length = 0;
    return this;
  }

  /** 设置传感器灵敏度。 */
  setSensitivity(id: string, sensitivity: number): this {
    const s = this.sensors.get(id);
    if (s) s.sensitivity = sensitivity;
    return this;
  }

  /** 设置传感器检测范围。 */
  setRange(id: string, range: number): this {
    const s = this.sensors.get(id);
    if (s) s.range = range;
    return this;
  }

  /** 设置传感器视野角度(FOV,弧度)。 */
  setAngle(id: string, angle: number): this {
    const s = this.sensors.get(id);
    if (s) s.angle = angle;
    return this;
  }

  /** 获取系统统计。 */
  getStats(): PerceptionStats {
    const byType: Record<string, number> = {};
    let confirmed = 0;
    for (const e of this.perceptions) {
      byType[e.targetType] = (byType[e.targetType] ?? 0) + 1;
      if (e.isConfirmed) confirmed++;
    }
    return {
      sensorCount: this.sensors.size,
      perceptionCount: this.perceptions.length,
      confirmedCount: confirmed,
      byTargetType: byType,
      currentTime: this.currentTime,
    };
  }

  /** 内部:追加事件并裁剪到 maxPerceptions。 */
  protected pushEvent(event: PerceptionEvent): void {
    this.perceptions.push(event);
    while (this.perceptions.length > this.maxPerceptions) {
      this.perceptions.shift();
    }
  }
}

/** 感知系统统计信息。 */
export interface PerceptionStats {
  sensorCount: number;
  perceptionCount: number;
  confirmedCount: number;
  byTargetType: Record<string, number>;
  currentTime: number;
}

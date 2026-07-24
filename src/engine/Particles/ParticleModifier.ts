// ParticleModifier — 粒子修改器(影响粒子行为)。
//
// 7 种内置修改器:
//   - ForceFieldModifier        力场(引力/斥力)
//   - VortexModifier            涡旋(绕轴旋转)
//   - TurbulenceModifier        湍流(基于位置/时间的伪噪声扰动)
//   - ColorOverLifeModifier     生命周期颜色变化
//   - SizeOverLifeModifier      生命周期大小变化
//   - VelocityOverLifeModifier  生命周期速度变化(按 curve 缩放初始速度)
//   - SubEmittersModifier       子发射器(粒子死亡时触发)
//
// 每个修改器实现 apply(particle, dt, system)。ParticleSystem2 在每个
// 粒子每帧调用所有 modifier。
//
// 注意:SubEmittersModifier 通过 system.spawn 触发新粒子,因此 apply
// 有副作用——若需要纯函数式行为,可在 system 层关闭 sub-emitter。

import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { clamp, lerp } from '../Math/MathUtils';
import { ParticleData } from './ParticleData';
import {
  ConstantCurve,
  LinearCurve,
  type ParticleCurve,
} from './ParticleCurve';
import type { ParticleSystem2 } from './ParticleSystem2';
import type { ParticleEmitter } from './ParticleEmitter';

/** 修改器基类。所有具体修改器继承此类并实现 apply。 */
export abstract class ParticleModifier {
  /** 是否启用(系统级开关,关闭时 system 跳过此 modifier)。 */
  enabled: boolean = true;
  /** 修改器优先级(数值小先执行),默认 0。 */
  priority: number = 0;
  abstract apply(p: ParticleData, dt: number, system: ParticleSystem2): void;
}

// ── 力场 ────────────────────────────────────────────────────────────

/** 引力/斥力场。strength > 0 吸引,< 0 排斥。力按 1/r² 衰减,
 *  远距离自动加 epsilon 避免奇点。 */
export class ForceFieldModifier extends ParticleModifier {
  /** 力场中心 (世界坐标)。 */
  center: Vector3;
  /** 强度:正=吸引,负=斥力。 */
  strength: number;
  /** 最小距离平方,防止近场爆炸。 */
  minRadiusSq: number;

  constructor(center?: Vector3, strength: number = 1, minRadius: number = 0.1) {
    super();
    this.center = center ?? new Vector3();
    this.strength = strength;
    this.minRadiusSq = minRadius * minRadius;
  }

  apply(p: ParticleData, dt: number, _system: ParticleSystem2): void {
    const dx = this.center.x - p.position.x;
    const dy = this.center.y - p.position.y;
    const dz = this.center.z - p.position.z;
    const distSq = Math.max(this.minRadiusSq, dx * dx + dy * dy + dz * dz);
    const dist = Math.sqrt(distSq);
    // force = strength / r²,方向:strength>0 指向 center
    const f = this.strength / distSq;
    p.velocity.x += (dx / dist) * f * dt;
    p.velocity.y += (dy / dist) * f * dt;
    p.velocity.z += (dz / dist) * f * dt;
  }
}

// ── 涡旋 ────────────────────────────────────────────────────────────

/** 绕 axis 旋转的涡旋力。粒子在 axis 垂直面内被推动。 */
export class VortexModifier extends ParticleModifier {
  /** 旋转轴(无需归一化,内部归一化)。 */
  axis: Vector3;
  /** 涡旋强度。 */
  strength: number;
  /** 涡旋中心。 */
  center: Vector3;
  private _axisN: Vector3;

  constructor(
    axis?: Vector3,
    strength: number = 1,
    center?: Vector3,
  ) {
    super();
    this.axis = axis ?? new Vector3(0, 1, 0);
    this.strength = strength;
    this.center = center ?? new Vector3();
    this._axisN = new Vector3();
  }

  apply(p: ParticleData, dt: number, _system: ParticleSystem2): void {
    this._axisN.copy(this.axis).normalize();
    // r = p.position - center,投影到 axis 垂直面
    const rx = p.position.x - this.center.x;
    const ry = p.position.y - this.center.y;
    const rz = p.position.z - this.center.z;
    const along = rx * this._axisN.x + ry * this._axisN.y + rz * this._axisN.z;
    const px = rx - this._axisN.x * along;
    const py = ry - this._axisN.y * along;
    const pz = rz - this._axisN.z * along;
    // tangent = axis × r
    const tx = this._axisN.y * pz - this._axisN.z * py;
    const ty = this._axisN.z * px - this._axisN.x * pz;
    const tz = this._axisN.x * py - this._axisN.y * px;
    const tlen = Math.hypot(tx, ty, tz) || 1;
    const s = this.strength * dt / tlen;
    p.velocity.x += tx * s;
    p.velocity.y += ty * s;
    p.velocity.z += tz * s;
  }
}

// ── 湍流 ────────────────────────────────────────────────────────────

/** 基于位置 + 时间的伪噪声扰动。非真 Perlin,但开销低、效果近似。 */
export class TurbulenceModifier extends ParticleModifier {
  strength: number;
  frequency: number;
  timeScale: number;
  /** 内部累积时间,避免引用 performance.now()(测试不友好)。 */
  private _t: number;

  constructor(strength: number = 1, frequency: number = 1, timeScale: number = 1) {
    super();
    this.strength = strength;
    this.frequency = frequency;
    this.timeScale = timeScale;
    this._t = 0;
  }

  apply(p: ParticleData, dt: number, _system: ParticleSystem2): void {
    this._t += dt * this.timeScale;
    const f = this.frequency;
    const t = this._t;
    const fx = Math.sin(p.position.x * f + t) * Math.cos(p.position.y * f * 0.7 + t * 1.3);
    const fy = Math.sin(p.position.y * f + t * 1.7) * Math.cos(p.position.z * f * 1.1 + t);
    const fz = Math.sin(p.position.z * f + t * 2.3) * Math.cos(p.position.x * f * 0.9 + t * 0.6);
    p.velocity.x += fx * this.strength * dt;
    p.velocity.y += fy * this.strength * dt;
    p.velocity.z += fz * this.strength * dt;
  }
}

// ── Color over life ─────────────────────────────────────────────────

/** 按 t = life/maxLife 在 startColor → endColor 之间插值,写入 p.color。 */
export class ColorOverLifeModifier extends ParticleModifier {
  startColor: Color;
  endColor: Color;

  constructor(start?: Color, end?: Color) {
    super();
    this.startColor = start ?? new Color(1, 1, 1);
    this.endColor = end ?? new Color(0, 0, 0);
  }

  apply(p: ParticleData, dt: number, _system: ParticleSystem2): void {
    const t = clamp((p.life + dt) / p.maxLife, 0, 1);
    p.color.r = lerp(this.startColor.r, this.endColor.r, t);
    p.color.g = lerp(this.startColor.g, this.endColor.g, t);
    p.color.b = lerp(this.startColor.b, this.endColor.b, t);
  }
}

// ── Size over life ──────────────────────────────────────────────────

/** 按 curve.evaluate(t) 在 startSize → endSize 之间插值,写入 p.size。 */
export class SizeOverLifeModifier extends ParticleModifier {
  curve: ParticleCurve;

  constructor(curve?: ParticleCurve) {
    super();
    this.curve = curve ?? new LinearCurve(1, 0);
  }

  apply(p: ParticleData, dt: number, _system: ParticleSystem2): void {
    const t = clamp((p.life + dt) / p.maxLife, 0, 1);
    const k = this.curve.evaluate(t);
    p.size = lerp(p.startSize, p.endSize, k);
  }
}

// ── Velocity over life ──────────────────────────────────────────────

/** 按 curve 缩放粒子初始速度。每个粒子的初始速度在首次 apply 时缓存
 *  到 customData[0..2],后续帧从缓存读取,保证逐粒子一致。 */
export class VelocityOverLifeModifier extends ParticleModifier {
  curve: ParticleCurve;
  /** customData 起始槽位(避免与其它 modifier 冲突)。 */
  slot: number;

  constructor(curve?: ParticleCurve, slot: number = 0) {
    super();
    this.curve = curve ?? new LinearCurve(1, 0);
    this.slot = slot;
  }

  apply(p: ParticleData, dt: number, _system: ParticleSystem2): void {
    const base = this.slot * 3;
    // 初始化缓存:首次看到该粒子时记录其初始速度
    if (p.customData.length < base + 3) {
      p.customData.length = base + 3;
      p.customData[base + 0] = p.velocity.x;
      p.customData[base + 1] = p.velocity.y;
      p.customData[base + 2] = p.velocity.z;
    }
    const t = clamp((p.life + dt) / p.maxLife, 0, 1);
    const scale = this.curve.evaluate(t);
    p.velocity.x = p.customData[base + 0] * scale;
    p.velocity.y = p.customData[base + 1] * scale;
    p.velocity.z = p.customData[base + 2] * scale;
  }
}

// ── Sub-emitters ────────────────────────────────────────────────────

/** 粒子死亡时触发 sub-emitter。每粒子仅触发一次,通过 customData 槽位
 *  标记已触发(槽位由 slot 指定,默认紧接 VelocityOverLife 之后)。 */
export class SubEmittersModifier extends ParticleModifier {
  /** 死亡时触发的发射器。 */
  onDeathEmitter: ParticleEmitter | null;
  /** 碰撞时触发的发射器(本修改器不检测碰撞,需外部代码设置 hasCollision 标记)。 */
  onCollisionEmitter: ParticleEmitter | null;
  /** 一次触发的粒子数(覆盖 emitter.burstCount)。 */
  spawnCount: number;
  /** customData 标记槽位。 */
  slot: number;
  /** 子粒子初速度继承父粒子的比例 (0..1)。 */
  inheritVelocity: number;

  constructor(slot: number = 1) {
    super();
    this.onDeathEmitter = null;
    this.onCollisionEmitter = null;
    this.spawnCount = 5;
    this.slot = slot;
    this.inheritVelocity = 0;
  }

  apply(p: ParticleData, dt: number, system: ParticleSystem2): void {
    const flagIdx = this.slot * 3; // 复用 VelocityOverLife 的 3-槽位布局
    if (p.customData.length <= flagIdx) {
      p.customData.length = flagIdx + 1;
      p.customData[flagIdx] = 0;
    }
    const triggered = p.customData[flagIdx] !== 0;
    // 预测本帧是否死亡
    const willDie = p.life + dt >= p.maxLife;
    if (this.onDeathEmitter && willDie && !triggered) {
      p.customData[flagIdx] = 1;
      const pos = p.position.clone();
      const vel = this.inheritVelocity > 0
        ? p.velocity.clone().multiplyScalar(this.inheritVelocity)
        : new Vector3();
      const savedBias = this.onDeathEmitter.directionBias.clone();
      this.onDeathEmitter.directionBias.copy(vel);
      this.onDeathEmitter.trigger(system, pos, this.spawnCount);
      this.onDeathEmitter.directionBias.copy(savedBias);
    }
  }
}

/** 默认 curve 常量,供模块内引用。 */
export const _defaultConstantOne = new ConstantCurve(1);

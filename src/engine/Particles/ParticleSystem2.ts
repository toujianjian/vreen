// ParticleSystem2 — 高级 CPU 粒子系统。
//
// 设计:
// - 持有 particles / emitters / modifiers / trail 四类对象
// - spawn(count, position, velocity) 是低层级 API:按系统默认属性创建
//   count 个粒子,返回创建的数组(emitter 可在此基础上覆盖属性)
// - update(dt) 每帧推进:
//     1. emitters.update → system.spawn 新粒子
//     2. 对每个粒子:
//        a. 默认 color/size 生命周期插值(可被 modifier 覆盖)
//        b. modifiers.apply(可能改 velocity/color/size,可能 spawn 子粒子)
//        c. 积分:life += dt;vel += accel*dt;vel *= (1-drag*dt);pos += vel*dt;rot += angVel*dt
//        d. life >= maxLife → 标记死亡
//     3. trail.update
//     4. 清理死亡粒子(回收到对象池)
// - render() 返回扁平的 Float32Array,供 WebGL2Renderer 上传 VBO
// - 对象池:maxParticles 内的死亡粒子进入 pool 复用,避免 GC 抖动
//
// 为未来 GPU 粒子做准备:数据布局与 WebGL2 buffer 一致(position/color/size
// 各一个 attribute),迁移到 GPU 时只需把 update 逻辑搬到 compute shader。

import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { clamp, lerp } from '../Math/MathUtils';
import { ParticleData } from './ParticleData';
import { ParticleEmitter } from './ParticleEmitter';
import {
  ParticleModifier,
  ColorOverLifeModifier,
  SizeOverLifeModifier,
} from './ParticleModifier';
import { TrailModule } from './TrailModule';

/** 粒子系统渲染数据:三个扁平 attribute + 粒子数。 */
export interface ParticleSystemRenderData {
  /** 位置 [x,y,z, ...] length = count*3。 */
  positions: Float32Array;
  /** 颜色 [r,g,b, ...] length = count*3。 */
  colors: Float32Array;
  /** 大小 [s, ...] length = count。 */
  sizes: Float32Array;
  /** 活跃粒子数。 */
  count: number;
}

/** 默认 spawn 属性(未通过 emitter 而是直接调用 spawn 时使用)。 */
export interface SpawnDefaults {
  lifetime: { min: number; max: number };
  startColor: Color;
  endColor: Color;
  startSize: { min: number; max: number };
  endSize: { min: number; max: number };
  gravity: number;
  drag: number;
}

export class ParticleSystem2 {
  /** 最大粒子数(超出则 spawn 静默失败)。 */
  maxParticles: number;
  /** 当前活跃粒子。 */
  particles: ParticleData[];
  /** 发射器列表。 */
  emitters: ParticleEmitter[];
  /** 修改器列表(按 priority 升序执行)。 */
  modifiers: ParticleModifier[];
  /** 拖尾模块(可选)。 */
  trail: TrailModule | null;

  /** 系统总时长(s)。loop=true 时到 duration 后回绕。 */
  duration: number;
  /** 是否循环。 */
  loop: boolean;
  /** 已运行时间。 */
  time: number;

  /** 默认 spawn 属性。 */
  defaults: SpawnDefaults;

  /** 对象池:回收的死亡粒子。 */
  private particlePool: ParticleData[];
  /** 修改器是否已按 priority 排序的脏标记。 */
  private modifiersDirty: boolean;

  constructor(maxParticles: number = 1000) {
    this.maxParticles = maxParticles;
    this.particles = [];
    this.emitters = [];
    this.modifiers = [];
    this.trail = null;
    this.duration = 5;
    this.loop = true;
    this.time = 0;
    this.defaults = {
      lifetime: { min: 1, max: 2 },
      startColor: new Color(1, 1, 1),
      endColor: new Color(1, 1, 1),
      startSize: { min: 0.05, max: 0.1 },
      endSize: { min: 0, max: 0 },
      gravity: 0,
      drag: 0,
    };
    this.particlePool = [];
    this.modifiersDirty = false;
  }

  /** 添加修改器(标记脏位,下次 update 前重排)。 */
  addModifier(m: ParticleModifier): this {
    this.modifiers.push(m);
    this.modifiersDirty = true;
    return this;
  }

  /** 添加发射器。 */
  addEmitter(e: ParticleEmitter): this {
    this.emitters.push(e);
    return this;
  }

  /** 设置拖尾模块。 */
  setTrail(trail: TrailModule | null): this {
    this.trail = trail;
    return this;
  }

  /**
   * 手动生成粒子。
   * @param count 数量
   * @param position 出生位置(所有粒子共用,可由 emitter 在调用后覆盖)
   * @param velocity 初始速度
   * @returns 实际创建的粒子数组(可能少于 count,达到 maxParticles 时停止)
   */
  spawn(count: number, position: Vector3, velocity: Vector3): ParticleData[] {
    const spawned: ParticleData[] = [];
    const d = this.defaults;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const p = this.acquireParticle();
      p.reset();
      p.position.copy(position);
      p.velocity.copy(velocity);
      p.acceleration.set(0, d.gravity, 0);
      p.maxLife = lerp(d.lifetime.min, d.lifetime.max, Math.random());
      p.life = 0;
      p.alive = true;
      p.startColor.copy(d.startColor);
      p.endColor.copy(d.endColor);
      p.color.copy(d.startColor);
      p.startSize = lerp(d.startSize.min, d.startSize.max, Math.random());
      p.endSize = lerp(d.endSize.min, d.endSize.max, Math.random());
      p.size = p.startSize;
      this.particles.push(p);
      spawned.push(p);
    }
    return spawned;
  }

  /** 每帧推进整个系统。 */
  update(dt: number): void {
    // 时间推进
    this.time += dt;
    if (this.loop && this.duration > 0 && this.time > this.duration) {
      this.time = this.time % this.duration;
    }

    // 排序 modifier
    if (this.modifiersDirty) {
      this.modifiers.sort((a, b) => a.priority - b.priority);
      this.modifiersDirty = false;
    }

    // 1. emitters spawn(新粒子加入 particles 尾部)
    for (const em of this.emitters) {
      em.update(dt, this);
    }

    // 2. 推进粒子
    // 缓存初始数量,避免 SubEmittersModifier spawn 出来的新粒子在本帧被处理
    const initialCount = this.particles.length;
    const hasColorMod = this.modifiers.some(m => m.enabled && m instanceof ColorOverLifeModifier);
    const hasSizeMod = this.modifiers.some(m => m.enabled && m instanceof SizeOverLifeModifier);
    for (let i = 0; i < initialCount; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;

      // a. 默认 color/size 生命周期插值(用预测的帧末 life,使渲染时颜色与位置同步)
      const t = clamp((p.life + dt) / p.maxLife, 0, 1);
      if (!hasColorMod) {
        p.color.r = lerp(p.startColor.r, p.endColor.r, t);
        p.color.g = lerp(p.startColor.g, p.endColor.g, t);
        p.color.b = lerp(p.startColor.b, p.endColor.b, t);
      }
      if (!hasSizeMod) {
        p.size = lerp(p.startSize, p.endSize, t);
      }

      // b. 应用修改器(可能 spawn 子粒子,会追加到 this.particles 但不会进入本帧循环)
      for (const m of this.modifiers) {
        if (m.enabled) m.apply(p, dt, this);
      }

      // c. 积分
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        continue;
      }
      p.velocity.x += p.acceleration.x * dt;
      p.velocity.y += p.acceleration.y * dt;
      p.velocity.z += p.acceleration.z * dt;
      const drag = this.defaults.drag;
      if (drag > 0) {
        const d = Math.max(0, 1 - drag * dt);
        p.velocity.multiplyScalar(d);
      }
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;
      p.rotation += p.angularVelocity * dt;
    }

    // 3. trail
    if (this.trail) {
      this.trail.update(this.particles, dt);
    }

    // 4. 清理死亡粒子(回收到池)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (!this.particles[i].alive) {
        const dead = this.particles[i];
        this.particles.splice(i, 1);
        this.releaseParticle(dead);
      }
    }
  }

  /** 返回渲染数据。 */
  render(): ParticleSystemRenderData {
    const n = this.particles.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      positions[i * 3 + 0] = p.position.x;
      positions[i * 3 + 1] = p.position.y;
      positions[i * 3 + 2] = p.position.z;
      colors[i * 3 + 0] = p.color.r;
      colors[i * 3 + 1] = p.color.g;
      colors[i * 3 + 2] = p.color.b;
      sizes[i] = p.size;
    }
    return { positions, colors, sizes, count: n };
  }

  /** 重置:清空所有粒子,重置时间,重置 emitters 与 trail。 */
  reset(): void {
    for (const p of this.particles) this.releaseParticle(p);
    this.particles.length = 0;
    this.time = 0;
    for (const em of this.emitters) em.reset();
    if (this.trail) this.trail.reset();
  }

  /** 清空所有粒子与对象池。 */
  clear(): void {
    this.particles.length = 0;
    this.particlePool.length = 0;
    if (this.trail) this.trail.reset();
  }

  /** 当前活跃粒子数。 */
  get aliveCount(): number {
    return this.particles.length;
  }

  private acquireParticle(): ParticleData {
    return this.particlePool.pop() ?? new ParticleData();
  }

  private releaseParticle(p: ParticleData): void {
    // 不在此处 reset:外部可能仍持有引用并读取 alive/life 等字段。
    // reset 推迟到 acquireParticle 后由 spawn() 调用,避免回收时副作用。
    if (this.particlePool.length < this.maxParticles) {
      this.particlePool.push(p);
    }
  }
}

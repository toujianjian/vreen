// WaterInteraction — 水面交互系统 (涟漪 / 飞溅 / 浮力标记)。
//
// 设计:
//   * Ripple  — 圆形扩散波, 在 XZ 平面以 speed 向外传播, 振幅按 damping 衰减,
//               到 maxAge 后移除。每个 ripple 在其波前附近形成高斯包络的正弦扰动。
//   * Splash — 粒子飞溅, 携带初始 position/velocity, 受重力下落, 粒子数随时间衰减。
//   * interact(position, velocity, mass) — 由外部物体 (角色 / 投掷物 / 浮体) 调用,
//               自动按动量大小生成涟漪 (始终) 与飞溅 (超过 splashThreshold 时)。
//
// 与 WaterSimulation 的关系:
//   * WaterSimulation 解 2D 波动方程 (网格离散, 高频局部传播, 适合小水池)。
//   * WaterInteraction 用解析涟漪叠加 (无网格, 适合大水面 + 离散事件源),
//     可与 FFTOcean 叠加: FFTOcean 提供风浪, WaterInteraction 提供玩家扰动。
//
// 用法:
//   const wi = new WaterInteraction({ maxRipples: 64 });
//   wi.interact(playerPos, playerVel, playerMass);
//   wi.update(dt);
//   const h = wi.sampleHeight(x, z, time);     // 叠加涟漪高度
//   const n = wi.sampleNormal(x, z, time);     // 叠加涟漪法线

import { Vector3 } from '../Math/Vector3';

/** 涟漪: 圆形扩散波, 在 XZ 平面以 speed 向外传播。 */
export interface Ripple {
  /** 唯一 id (自增分配)。 */
  id: number;
  /** 中心位置 (XZ 平面, y 视为水面高度)。 */
  position: { x: number; z: number };
  /** 初始振幅 (米)。 */
  amplitude: number;
  /** 波长 (米, 相邻波峰间距)。 */
  wavelength: number;
  /** 波前传播速度 (米/秒)。 */
  speed: number;
  /** 当前年龄 (秒)。 */
  age: number;
  /** 最大寿命 (秒, 超过则移除)。 */
  maxAge: number;
  /** 阻尼系数 (1/秒, 越大振幅衰减越快)。 */
  damping: number;
}

/** 飞溅: 粒子云, 携带初始速度受重力下落。 */
export interface Splash {
  /** 唯一 id (自增分配)。 */
  id: number;
  /** 飞溅起点 (世界空间)。 */
  position: Vector3;
  /** 初始速度 (米/秒)。 */
  velocity: Vector3;
  /** 当前粒子数 (随时间衰减)。 */
  particles: number;
  /** 当前年龄 (秒)。 */
  age: number;
  /** 最大寿命 (秒)。 */
  maxAge: number;
}

/** WaterInteraction 构造选项。 */
export interface WaterInteractionOptions {
  /** 最大同时存在的涟漪数 (超过则淘汰最旧)。 */
  maxRipples?: number;
  /** 最大同时存在的飞溅数。 */
  maxSplashes?: number;
  /** 交互半径 (米, 超过则不产生涟漪, 用于剔除远处扰动)。 */
  interactionRadius?: number;
  /** 波阻尼 (涟漪振幅衰减率, 1/秒)。 */
  waveDamping?: number;
  /** 飞溅阈值 (速度 m/s, 超过则产生飞溅)。 */
  splashThreshold?: number;
  /** 泡沫衰减率 (1/秒, 越大泡沫消散越快)。 */
  foamDecay?: number;
  /** 默认涟漪波长 (米)。 */
  defaultWavelength?: number;
  /** 默认涟漪传播速度 (米/秒)。 */
  defaultSpeed?: number;
  /** 默认涟漪寿命 (秒)。 */
  defaultMaxAge?: number;
  /** 默认飞溅寿命 (秒)。 */
  defaultSplashMaxAge?: number;
  /** 涟漪最大振幅 (米, 钳制防止过大)。 */
  maxAmplitude?: number;
}

/** WaterInteraction.getStats() 返回的统计信息。 */
export interface WaterInteractionStats {
  /** 当前涟漪数。 */
  rippleCount: number;
  /** 当前飞溅数。 */
  splashCount: number;
  /** 累计生成过的涟漪数 (含已淘汰)。 */
  totalRipplesCreated: number;
  /** 累计生成过的飞溅数。 */
  totalSplashesCreated: number;
  /** 交互半径。 */
  interactionRadius: number;
  /** 波阻尼。 */
  waveDamping: number;
  /** 飞溅阈值。 */
  splashThreshold: number;
  /** 泡沫衰减率。 */
  foamDecay: number;
  /** 当前模拟时间 (秒)。 */
  time: number;
}

/** 重力加速度 (m/s², 飞溅粒子下落用)。 */
const G = 9.81;

/**
 * 水面交互系统 — 解析涟漪叠加 + 粒子飞溅。
 *
 * 不依赖网格, 直接用解析公式叠加每个 ripple 的高度贡献, 适合大水面稀疏扰动。
 * 与 FFTOcean / WaterSimulation 解耦, 可作为额外高度层叠加。
 */
export class WaterInteraction {
  /** 当前活跃涟漪。 */
  ripples: Ripple[] = [];
  /** 最大涟漪数。 */
  maxRipples: number;
  /** 当前活跃飞溅。 */
  splashes: Splash[] = [];
  /** 最大飞溅数。 */
  maxSplashes: number;
  /** 交互半径 (米)。 */
  interactionRadius: number;
  /** 波阻尼。 */
  waveDamping: number;
  /** 飞溅阈值 (m/s)。 */
  splashThreshold: number;
  /** 泡沫衰减率 (1/秒)。 */
  foamDecay: number;
  /** 默认涟漪波长。 */
  defaultWavelength: number;
  /** 默认涟漪传播速度。 */
  defaultSpeed: number;
  /** 默认涟漪寿命。 */
  defaultMaxAge: number;
  /** 默认飞溅寿命。 */
  defaultSplashMaxAge: number;
  /** 涟漪最大振幅。 */
  maxAmplitude: number;

  /** 自增 id 计数器 (涟漪与飞溅共享)。 */
  private _nextId: number = 1;
  /** 累计生成涟漪数。 */
  private _totalRipplesCreated: number = 0;
  /** 累计生成飞溅数。 */
  private _totalSplashesCreated: number = 0;
  /** 模拟时间 (秒)。 */
  private _time: number = 0;

  constructor(opts: WaterInteractionOptions = {}) {
    this.maxRipples = Math.max(0, Math.floor(opts.maxRipples ?? 64));
    this.maxSplashes = Math.max(0, Math.floor(opts.maxSplashes ?? 32));
    this.interactionRadius = Math.max(0, opts.interactionRadius ?? 50);
    this.waveDamping = Math.max(0, opts.waveDamping ?? 0.5);
    this.splashThreshold = Math.max(0, opts.splashThreshold ?? 2.0);
    this.foamDecay = Math.max(0, opts.foamDecay ?? 1.0);
    this.defaultWavelength = Math.max(0.001, opts.defaultWavelength ?? 1.5);
    this.defaultSpeed = Math.max(0, opts.defaultSpeed ?? 2.0);
    this.defaultMaxAge = Math.max(0.001, opts.defaultMaxAge ?? 4.0);
    this.defaultSplashMaxAge = Math.max(0.001, opts.defaultSplashMaxAge ?? 1.5);
    this.maxAmplitude = Math.max(0, opts.maxAmplitude ?? 1.0);
  }

  // ── 添加 ──────────────────────────────────────────────

  /**
   * 添加一个涟漪。
   * 若当前涟漪数超过 maxRipples, 淘汰最旧的。
   *
   * @param position 涟漪中心 (XZ 平面, y 忽略)。
   * @param amplitude 初始振幅 (米, 会被钳制到 maxAmplitude)。
   * @param wavelength 波长 (米, 默认 defaultWavelength)。
   * @returns 新涟漪的 id, 若超出交互半径或振幅为 0 返回 -1。
   */
  addRipple(
    position: { x: number; z: number } | Vector3,
    amplitude: number,
    wavelength?: number,
  ): number {
    const amp = Math.max(0, Math.min(this.maxAmplitude, amplitude));
    if (amp <= 0) return -1;
    // 容量管理: 超过上限则淘汰最旧 (按 age/maxAge 比例最大)
    if (this.ripples.length >= this.maxRipples) {
      this._evictOldestRipple();
    }
    const id = this._nextId++;
    const ripple: Ripple = {
      id,
      position: { x: position.x, z: position.z },
      amplitude: amp,
      wavelength: Math.max(0.001, wavelength ?? this.defaultWavelength),
      speed: this.defaultSpeed,
      age: 0,
      maxAge: this.defaultMaxAge,
      damping: this.waveDamping,
    };
    this.ripples.push(ripple);
    this._totalRipplesCreated++;
    return id;
  }

  /**
   * 添加一个飞溅。
   * 若当前飞溅数超过 maxSplashes, 淘汰最旧的。
   *
   * @param position 飞溅起点 (世界空间)。
   * @param velocity 初始速度 (米/秒)。
   * @param particles 粒子数。
   * @returns 新飞溅的 id, 若粒子数 ≤ 0 返回 -1。
   */
  addSplash(position: Vector3, velocity: Vector3, particles: number): number {
    const pc = Math.max(0, Math.floor(particles));
    if (pc <= 0) return -1;
    if (this.splashes.length >= this.maxSplashes) {
      this._evictOldestSplash();
    }
    const id = this._nextId++;
    const splash: Splash = {
      id,
      position: position.clone(),
      velocity: velocity.clone(),
      particles: pc,
      age: 0,
      maxAge: this.defaultSplashMaxAge,
    };
    this.splashes.push(splash);
    this._totalSplashesCreated++;
    return id;
  }

  // ── 更新 ──────────────────────────────────────────────

  /**
   * 推进一帧: 涟漪年龄增长 / 飞溅粒子运动 + 重力下落 + 粒子衰减。
   * 超过寿命的对象会被移除。
   *
   * @param dt 流逝时间 (秒, 钳到非负)。
   */
  update(dt: number): this {
    if (dt < 0) dt = 0;
    this._time += dt;
    // 涟漪
    if (this.ripples.length > 0) {
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.age += dt;
        if (r.age >= r.maxAge) {
          this.ripples.splice(i, 1);
        }
      }
    }
    // 飞溅: 粒子受重力下落 + 粒子数按时间衰减
    if (this.splashes.length > 0) {
      for (let i = this.splashes.length - 1; i >= 0; i--) {
        const s = this.splashes[i];
        s.age += dt;
        // 位置积分 (抛体运动)
        s.position.x += s.velocity.x * dt;
        s.position.y += s.velocity.y * dt;
        s.position.z += s.velocity.z * dt;
        // 重力 (沿 -y)
        s.velocity.y -= G * dt;
        // 粒子衰减 (按 age/maxAge 线性减少)
        const lifeRatio = Math.max(0, 1 - s.age / s.maxAge);
        s.particles = Math.floor(s.particles * lifeRatio);
        if (s.age >= s.maxAge || s.particles <= 0) {
          this.splashes.splice(i, 1);
        }
      }
    }
    return this;
  }

  // ── 查询 ──────────────────────────────────────────────

  /** 获取所有涟漪 (引用, 修改需谨慎)。 */
  getRipples(): Ripple[] {
    return this.ripples;
  }

  /** 获取所有飞溅 (引用)。 */
  getSplashes(): Splash[] {
    return this.splashes;
  }

  /** 当前涟漪数。 */
  getRippleCount(): number {
    return this.ripples.length;
  }

  /** 当前飞溅数。 */
  getSplashCount(): number {
    return this.splashes.length;
  }

  /** 清空所有涟漪与飞溅。 */
  clear(): this {
    this.ripples.length = 0;
    this.splashes.length = 0;
    return this;
  }

  /**
   * 采样水面高度 (叠加所有涟漪在 (x, z) 处的贡献)。
   *
   * @param x 世界 x。
   * @param z 世界 z。
   * @param time 模拟时间 (秒, 用于波动相位)。
   */
  sampleHeight(x: number, z: number, time: number): number {
    let h = 0;
    const ripples = this.ripples;
    for (let i = 0; i < ripples.length; i++) {
      h += this.computeRippleHeight(ripples[i], x, z, time);
    }
    return h;
  }

  /**
   * 采样水面法线 (中心差分, 归一化)。
   *
   * @param x 世界 x。
   * @param z 世界 z。
   * @param time 模拟时间。
   * @param eps 差分步长 (默认 0.1 米)。
   * @returns 归一化法线 {x, y, z}, y 朝上。
   */
  sampleNormal(
    x: number,
    z: number,
    time: number,
    eps: number = 0.1,
  ): { x: number; y: number; z: number } {
    const hL = this.sampleHeight(x - eps, z, time);
    const hR = this.sampleHeight(x + eps, z, time);
    const hD = this.sampleHeight(x, z - eps, time);
    const hU = this.sampleHeight(x, z + eps, time);
    // 法线 ∝ (-dh/dx, 1, -dh/dz)
    const nx = -(hR - hL) / (2 * eps);
    const nz = -(hU - hD) / (2 * eps);
    const ny = 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /**
   * 计算单个涟漪在 (x, z) 处的高度贡献。
   *
   * 模型:
   *   r = distance((x,z), ripple.position)
   *   wavefront = speed * age        — 波前半径
   *   envelope = exp(-((r - wavefront) / wavelength)²)   — 高斯包络
   *   lifeFactor = max(0, 1 - age/maxAge)
   *   ageDecay = exp(-damping * age)
   *   k = 2π / wavelength, ω = k * speed
   *   phase = k * r - ω * time
   *   height = amplitude * lifeFactor * ageDecay * envelope * sin(phase)
   *
   * 当 r 远超波前时 (envelope≈0), 贡献趋零, 不会扩散到无限远。
   *
   * @param ripple 单个涟漪。
   * @param x 世界 x。
   * @param z 世界 z。
   * @param time 模拟时间 (秒)。
   */
  computeRippleHeight(ripple: Ripple, x: number, z: number, time: number): number {
    const dx = x - ripple.position.x;
    const dz = z - ripple.position.z;
    const r = Math.hypot(dx, dz);
    const age = ripple.age;
    if (age >= ripple.maxAge) return 0;
    const lifeFactor = Math.max(0, 1 - age / ripple.maxAge);
    if (lifeFactor <= 0) return 0;
    const ageDecay = Math.exp(-ripple.damping * age);
    const wavefront = ripple.speed * age;
    // 包络只在波前附近有显著值, 远处贡献趋零
    const sigma = ripple.wavelength;
    const delta = r - wavefront;
    const envelope = Math.exp(-(delta * delta) / (sigma * sigma));
    if (envelope < 1e-6) return 0;
    const k = (2 * Math.PI) / ripple.wavelength;
    const omega = k * ripple.speed;
    const phase = k * r - omega * time;
    return ripple.amplitude * lifeFactor * ageDecay * envelope * Math.sin(phase);
  }

  /**
   * 计算飞溅对生成者施加的反作用力 (近似冲量反应)。
   *
   * 模型: 飞溅粒子带走的动量反向作用于物体。
   *   force = -splash.velocity * splash.particles * k
   * 其中 k 是与流体密度无关的简化系数 (0.01), 让结果量纲合理。
   *
   * @param splash 飞溅。
   * @returns 反作用力向量 (新 Vector3, 调用方负责释放)。
   */
  computeSplashForce(splash: Splash): Vector3 {
    const k = 0.01;
    const f = new Vector3(
      -splash.velocity.x * splash.particles * k,
      -splash.velocity.y * splash.particles * k,
      -splash.velocity.z * splash.particles * k,
    );
    return f;
  }

  // ── setter ───────────────────────────────────────────

  /** 设置交互半径 (米)。 */
  setInteractionRadius(radius: number): this {
    this.interactionRadius = Math.max(0, radius);
    return this;
  }

  /** 设置波阻尼 (1/秒)。 */
  setWaveDamping(damping: number): this {
    this.waveDamping = Math.max(0, damping);
    return this;
  }

  /** 设置飞溅阈值 (m/s)。 */
  setSplashThreshold(threshold: number): this {
    this.splashThreshold = Math.max(0, threshold);
    return this;
  }

  /** 设置泡沫衰减率 (1/秒)。 */
  setFoamDecay(decay: number): this {
    this.foamDecay = Math.max(0, decay);
    return this;
  }

  // ── 交互入口 ─────────────────────────────────────────

  /**
   * 由物体与水面交互时调用, 自动按动量生成涟漪 + 飞溅。
   *
   * 决策:
   *   * 速度模长 v = |velocity|
   *   * 涟漪振幅 = clamp(mass * v * 0.01, 0, maxAmplitude)
   *   * 若 v > splashThreshold: 生成飞溅, 粒子数 = floor(v * mass * 0.5)
   *   * 振幅过小 (< 1e-4) 或超出 interactionRadius 时跳过涟漪
   *
   * @param position 物体位置 (y 视为水面接触高度)。
   * @param velocity 物体速度。
   * @param mass 物体质量 (kg)。
   * @returns { rippleId, splashId } — -1 表示未生成。
   */
  interact(
    position: Vector3,
    velocity: Vector3,
    mass: number,
  ): { rippleId: number; splashId: number } {
    const result = { rippleId: -1, splashId: -1 };
    const speed = velocity.length();
    // 交互半径剔除 (基于 XZ 距离, 用相对原点)
    const dist2 = position.x * position.x + position.z * position.z;
    if (dist2 > this.interactionRadius * this.interactionRadius) {
      return result;
    }
    const m = Math.max(0, mass);
    // 涟漪振幅 ~ 动量 / 100
    const amplitude = Math.min(this.maxAmplitude, m * speed * 0.01);
    if (amplitude > 1e-4) {
      result.rippleId = this.addRipple(position, amplitude);
    }
    // 飞溅判定
    if (speed > this.splashThreshold) {
      const particleCount = Math.max(1, Math.floor(speed * m * 0.5));
      // 飞溅向上 + 沿速度方向偏置
      const splashVel = new Vector3(
        velocity.x * 0.3,
        Math.abs(velocity.y) + 2.0 + speed * 0.2,
        velocity.z * 0.3,
      );
      result.splashId = this.addSplash(position, splashVel, particleCount);
    }
    return result;
  }

  /** 获取统计信息。 */
  getStats(): WaterInteractionStats {
    return {
      rippleCount: this.ripples.length,
      splashCount: this.splashes.length,
      totalRipplesCreated: this._totalRipplesCreated,
      totalSplashesCreated: this._totalSplashesCreated,
      interactionRadius: this.interactionRadius,
      waveDamping: this.waveDamping,
      splashThreshold: this.splashThreshold,
      foamDecay: this.foamDecay,
      time: this._time,
    };
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 淘汰最旧涟漪 (age/maxAge 比例最大的, 平局按数组顺序)。 */
  private _evictOldestRipple(): void {
    if (this.ripples.length === 0) return;
    let worstIdx = 0;
    let worstRatio = -Infinity;
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i];
      const ratio = r.age / r.maxAge;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstIdx = i;
      }
    }
    this.ripples.splice(worstIdx, 1);
  }

  /** 淘汰最旧飞溅。 */
  private _evictOldestSplash(): void {
    if (this.splashes.length === 0) return;
    let worstIdx = 0;
    let worstRatio = -Infinity;
    for (let i = 0; i < this.splashes.length; i++) {
      const s = this.splashes[i];
      const ratio = s.age / s.maxAge;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstIdx = i;
      }
    }
    this.splashes.splice(worstIdx, 1);
  }
}

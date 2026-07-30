// FluidSimulation — SPH (Smoothed Particle Hydrodynamics) 流体模拟。
//
// 设计:
//   - 粒子数组(particles):每个粒子存 position / velocity / acceleration /
//     density / pressure / force / mass / color?
//   - SPH 三步:computeDensity → computePressure → computeForces → integrate
//     • 密度: 用 Poly6 核 W_poly6(r,h) = 315/(64πh^9) (h²-r²)³
//     • 压力: 状态方程 P = k(ρ - ρ₀)(线性;若 ρ<ρ₀ 则 P=0 防吸引)
//     • 压力力: -Σ m_j (P_i+P_j)/(2ρ_j) ∇W_spiky,∇W_spiky = -45/(πh^6) (h-r)² r̂
//     • 粘度力: μ Σ m_j (v_j-v_i)/ρ_j ∇²W_visc,∇²W_visc = 45/(πh^6) (h-r)
//   - 邻居搜索: 使用 SpatialGrid (2D XZ 平面) 加速,3D 距离过滤保证正确性
//     (对垂直堆叠场景会过度候选,但仍正确;水平分布场景接近最优)
//   - 边界碰撞: AABB 投影 + 速度反弹(恢复系数)
//
// 与引擎的集成:
//   - update(dt) 完成一步流体推进,粒子位置写回 particles[i].position
//   - getMeshData() 返回扁平 positions/velocities 用于渲染(点云或 instance)
//   - 调用方(如 CustomStage / 物理 demo)负责把数据同步到 Mesh
//
// 与 ClothSimulation / PhysicsSystems 的关系:
//   流体是大量粒子的连续介质模拟,与布料(约束 PBD)/ ECS 刚体(Rigidbody)形态差异大,
//   因此独立实现。后续若要接入 ECS,可包装为 FluidComponent + FluidSystem。

import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { SpatialGrid } from '../AI/SpatialGrid';

/** 流体粒子可选颜色(RGB,各分量 0..1,供渲染着色)。 */
export interface FluidParticleColor {
  r: number;
  g: number;
  b: number;
}

/** 流体粒子。 */
export interface FluidParticle {
  /** 当前位置(世界空间)。 */
  position: Vector3;
  /** 当前速度。 */
  velocity: Vector3;
  /** 当前加速度(a = F/m,由 computeForces 写入,integrate 消费)。 */
  acceleration: Vector3;
  /** 当前密度(由 computeDensity 写入)。 */
  density: number;
  /** 当前压力(由 computePressure 写入)。 */
  pressure: number;
  /** 当前累积力(由 computeForces 写入,integrate 后清零)。 */
  force: Vector3;
  /** 质量(kg),默认与 FluidSimulation.mass 一致。 */
  mass: number;
  /** 可选颜色(供渲染着色,如按密度/温度着色)。 */
  color?: FluidParticleColor;
}

export interface FluidOptions {
  /** 平滑半径 h(m);影响半径 = h。默认 0.5。 */
  smoothingRadius?: number;
  /** 静止密度 ρ₀(kg/m³);默认 1000(水)。 */
  restDensity?: number;
  /** 气体常数 k(刚度);默认 2000。 */
  gasConstant?: number;
  /** 粘度系数 μ;默认 0.1。 */
  viscosity?: number;
  /** 重力加速度(m/s²);默认 (0,-9.8,0)。 */
  gravity?: Vector3;
  /** 边界 AABB;默认 (-5..5)³ 立方体。 */
  bounds?: Box3;
  /** 边界碰撞恢复系数 [0,1];默认 0.5。 */
  restitution?: number;
  /** 单粒子质量(kg);默认 0.02。 */
  mass?: number;
  /** 邻居搜索最大粒子数(用于性能上限保护);默认 10000。 */
  maxParticles?: number;
}

/** FluidSimulation.getStats() 返回的统计信息。 */
export interface FluidStats {
  /** 当前粒子数。 */
  particleCount: number;
  /** 最大粒子数。 */
  maxParticles: number;
  /** 平滑半径 h。 */
  smoothingRadius: number;
  /** 静止密度 ρ₀。 */
  restDensity: number;
  /** 气体常数 k。 */
  gasConstant: number;
  /** 粘度系数 μ。 */
  viscosity: number;
  /** 重力加速度。 */
  gravity: Vector3;
  /** 边界 AABB。 */
  bounds: Box3;
  /** 平均密度(无粒子时为 0)。 */
  averageDensity: number;
  /** 最大密度。 */
  maxDensity: number;
  /** 平均压力。 */
  averagePressure: number;
  /** 最大压力。 */
  maxPressure: number;
  /** 当前空间网格格子数(诊断用)。 */
  gridCellCount: number;
}

// SPH 核函数常量预计算缓存(根据 smoothingRadius 重算)。
// 把核函数依赖 h 的部分预乘成系数,避免每对粒子重复计算。
class SphKernels {
  h: number;
  h2: number; // h²
  // Poly6: W = K_poly6 * (h² - r²)³
  kPoly6: number;
  // Spiky gradient magnitude: |∇W| = K_spikyGrad * (h - r)²
  kSpikyGrad: number;
  // Viscosity laplacian: ∇²W = K_viscLap * (h - r)
  kViscLap: number;

  constructor(h: number) {
    this.h = h;
    this.h2 = h * h;
    // 315 / (64 π h^9)
    this.kPoly6 = 315 / (64 * Math.PI * Math.pow(h, 9));
    // 45 / (π h^6)
    this.kSpikyGrad = 45 / (Math.PI * Math.pow(h, 6));
    // 45 / (π h^6) (与 spiky grad 同系数,因 laplacian of viscosity kernel 推导后是该值)
    this.kViscLap = 45 / (Math.PI * Math.pow(h, 6));
  }

  /** Poly6 核 W(r,h) = 315/(64πh^9) (h²-r²)³,r ∈ [0,h]。 */
  poly6(r2: number): number {
    if (r2 >= this.h2) return 0;
    const diff = this.h2 - r2;
    return this.kPoly6 * diff * diff * diff;
  }

  /** Spiky 核梯度模长 |∇W(r,h)| = 45/(πh^6) (h-r)²,r ∈ [0,h]。
   *  方向由调用方用 r̂ = (r_j - r_i)/|r| 提供(压力力指向远离邻居)。 */
  spikyGrad(r: number): number {
    if (r >= this.h || r <= 1e-9) return 0;
    const diff = this.h - r;
    return -this.kSpikyGrad * diff * diff;
  }

  /** Viscosity 核拉普拉斯 ∇²W(r,h) = 45/(πh^6) (h-r),r ∈ [0,h]。 */
  viscLap(r: number): number {
    if (r >= this.h || r <= 1e-9) return 0;
    return this.kViscLap * (this.h - r);
  }
}

export class FluidSimulation {
  particles: FluidParticle[] = [];
  /** 平滑半径 h(m)。 */
  smoothingRadius: number;
  /** 静止密度 ρ₀(kg/m³)。 */
  restDensity: number;
  /** 气体常数 k。 */
  gasConstant: number;
  /** 粘度系数 μ。 */
  viscosity: number;
  /** 重力加速度(m/s²)。 */
  gravity: Vector3;
  /** 边界 AABB(min/max 两个 Vector3)。 */
  bounds: Box3;
  /** 边界碰撞恢复系数 [0,1]。 */
  restitution: number;
  /** 单粒子质量(kg)。 */
  mass: number;
  /** 邻居搜索最大粒子数。 */
  maxParticles: number;

  /** 空间网格(2D XZ 平面)用于邻居搜索加速;cellSize = smoothingRadius。 */
  spatialGrid: SpatialGrid;
  /** 每粒子压力(并行数组,由 computePressure 与 particles[i].pressure 同步)。 */
  pressure: Float32Array = new Float32Array(0);
  /** 每粒子密度(并行数组,由 computeDensity 与 particles[i].density 同步)。 */
  density: Float32Array = new Float32Array(0);

  /** 核函数缓存(随 smoothingRadius 更新)。 */
  private _kernels: SphKernels;

  constructor(opts: FluidOptions = {}) {
    this.smoothingRadius = opts.smoothingRadius ?? 0.5;
    this.restDensity = opts.restDensity ?? 1000;
    this.gasConstant = opts.gasConstant ?? 2000;
    this.viscosity = opts.viscosity ?? 0.1;
    this.gravity = opts.gravity ?? new Vector3(0, -9.8, 0);
    this.bounds = opts.bounds ?? new Box3(
      new Vector3(-5, -5, -5),
      new Vector3(5, 5, 5),
    );
    this.restitution = opts.restitution ?? 0.5;
    this.mass = opts.mass ?? 0.02;
    this.maxParticles = opts.maxParticles ?? 10000;
    this._kernels = new SphKernels(this.smoothingRadius);
    this.spatialGrid = new SpatialGrid(this.smoothingRadius);
  }

  /** 设置新的平滑半径(自动更新核函数缓存与网格 cellSize)。 */
  setSmoothingRadius(h: number): this {
    if (h <= 0) throw new Error(`FluidSimulation.setSmoothingRadius: h must be > 0 (got ${h})`);
    this.smoothingRadius = h;
    this._kernels = new SphKernels(h);
    this.spatialGrid.cellSize = h;
    return this;
  }

  /** 设置粘度系数。 */
  setViscosity(v: number): this {
    if (v < 0) throw new Error(`FluidSimulation.setViscosity: v must be >= 0 (got ${v})`);
    this.viscosity = v;
    return this;
  }

  /** 设置重力加速度(拷贝到内部向量,避免外部引用耦合)。 */
  setGravity(g: Vector3): this {
    this.gravity.copy(g);
    return this;
  }

  /** 设置边界 AABB(拷贝 min/max 到内部 bounds)。 */
  setBounds(min: Vector3, max: Vector3): this {
    this.bounds.min.copy(min);
    this.bounds.max.copy(max);
    return this;
  }

  /** 添加粒子。返回新粒子索引,达到 maxParticles 时返回 -1。 */
  addParticle(position: Vector3, velocity: Vector3 = new Vector3()): number {
    if (this.particles.length >= this.maxParticles) return -1;
    const p: FluidParticle = {
      position: position.clone(),
      velocity: velocity.clone(),
      acceleration: new Vector3(),
      density: 0,
      pressure: 0,
      force: new Vector3(),
      mass: this.mass,
    };
    this.particles.push(p);
    return this.particles.length - 1;
  }

  /** 移除粒子(swap-with-tail O(1),不保证顺序)。 */
  removeParticle(index: number): this {
    if (index < 0 || index >= this.particles.length) {
      throw new Error(`FluidSimulation.removeParticle: index out of range (${index})`);
    }
    const last = this.particles.length - 1;
    if (index !== last) {
      this.particles[index] = this.particles[last];
    }
    this.particles.pop();
    return this;
  }

  /** 获取所有粒子(引用,调用方不应破坏数组结构)。 */
  getParticles(): FluidParticle[] {
    return this.particles;
  }

  /** 获取当前粒子数。 */
  getParticleCount(): number {
    return this.particles.length;
  }

  /** 获取指定索引粒子的密度(越界返回 0)。 */
  getDensity(index: number): number {
    if (index < 0 || index >= this.particles.length) return 0;
    return this.particles[index].density;
  }

  /** 获取指定索引粒子的压力(越界返回 0)。 */
  getPressure(index: number): number {
    if (index < 0 || index >= this.particles.length) return 0;
    return this.particles[index].pressure;
  }

  /** 推进一帧。流程:
   *  1) computeDensity — Poly6 核求密度
   *  2) computePressure — 状态方程
   *  3) computeForces — 压力 + 粘度 + 重力
   *  4) integrate — 半隐式 Euler(先力→加速度→速度→位置)
   *  5) handleBounds — AABB 反弹
   *  dt 上限 1/30(防止大步长爆炸)。 */
  update(dt: number): void {
    const step = Math.min(dt, 1 / 30);
    this.computeDensity();
    this.computePressure();
    this.computeForces();
    this.integrate(step);
    this.handleBounds();
  }

  /** 重建空间网格(每帧 computeDensity/computeForces 前调用)。 */
  private _rebuildGrid(): void {
    this.spatialGrid.clear();
    const parts = this.particles;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      this.spatialGrid.insert(i, { x: p.position.x, z: p.position.z });
    }
  }

  /** 计算每个粒子的密度: ρ_i = Σ_j m_j W_poly6(r_ij, h)。
   *  包含自贡献(i==j 时 r=0,W = K_poly6 * h^6)。
   *  使用 spatialGrid 加速邻居候选收集,3D 距离过滤保证正确性。 */
  computeDensity(): void {
    this._rebuildGrid();
    const n = this.particles.length;
    if (this.density.length !== n) this.density = new Float32Array(n);
    const k = this._kernels;
    const h2 = k.h2;
    const parts = this.particles;
    for (let i = 0; i < n; i++) {
      let dens = 0;
      const pi = parts[i];
      const candidates = this.spatialGrid.query(
        { x: pi.position.x, z: pi.position.z },
        k.h,
      );
      for (const j of candidates) {
        const pj = parts[j];
        const dx = pi.position.x - pj.position.x;
        const dy = pi.position.y - pj.position.y;
        const dz = pi.position.z - pj.position.z;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > h2) continue;
        dens += pj.mass * k.poly6(r2);
      }
      pi.density = dens;
      this.density[i] = dens;
    }
  }

  /** 计算每个粒子的压力: P_i = k (ρ_i - ρ₀)。
   *  若 ρ_i < ρ₀ 则 P = 0(避免产生吸引,模拟自由表面)。 */
  computePressure(): void {
    const n = this.particles.length;
    if (this.pressure.length !== n) this.pressure = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      const diff = p.density - this.restDensity;
      const pres = diff > 0 ? this.gasConstant * diff : 0;
      p.pressure = pres;
      this.pressure[i] = pres;
    }
  }

  /** 计算每个粒子的累积力:
   *  • 压力力: F_p = -Σ_j m_j (P_i+P_j)/(2ρ_j) ∇W_spiky
   *    方向沿 r̂_ij = (r_j - r_i)/|r_j - r_i|(正方向推 i 远离 j)
   *  • 粘度力: F_v = μ Σ_j m_j (v_j-v_i)/ρ_j ∇²W_visc
   *  • 重力: F_g = m_i * g
   *  density 为 0 的粒子跳过力计算(避免除零,自由表面外)。
   *  同时把 a = F/m 写入 particles[i].acceleration。 */
  computeForces(): void {
    this._rebuildGrid();
    const k = this._kernels;
    const h = k.h;
    const parts = this.particles;
    const grav = this.gravity;
    for (let i = 0; i < parts.length; i++) {
      const pi = parts[i];
      // 重力
      const fx = grav.x * pi.mass;
      const fy = grav.y * pi.mass;
      const fz = grav.z * pi.mass;
      let pfx = fx, pfy = fy, pfz = fz;
      // 压力 + 粘度(用 grid 收集邻居候选)
      const candidates = this.spatialGrid.query(
        { x: pi.position.x, z: pi.position.z },
        h,
      );
      for (const j of candidates) {
        if (i === j) continue;
        const pj = parts[j];
        if (pj.density < 1e-9) continue;
        const dx = pj.position.x - pi.position.x;
        const dy = pj.position.y - pi.position.y;
        const dz = pj.position.z - pi.position.z;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > h * h || r2 < 1e-12) continue;
        const r = Math.sqrt(r2);
        const invR = 1 / r;
        // r̂ = (r_j - r_i)/|r|
        const rx = dx * invR;
        const ry = dy * invR;
        const rz = dz * invR;
        // 压力力: -m_j (P_i+P_j)/(2ρ_j) * ∇W_spiky
        //  ∇W_spiky 模长 spikyGrad(r) 已含负号,因此最终为正系数 × r̂
        //  推 i 沿 r̂ 方向(远离 j)
        const pCoef = -pj.mass * (pi.pressure + pj.pressure) / (2 * pj.density) * k.spikyGrad(r);
        pfx += pCoef * rx;
        pfy += pCoef * ry;
        pfz += pCoef * rz;
        // 粘度力: μ m_j (v_j - v_i)/ρ_j * ∇²W_visc
        const vCoef = this.viscosity * pj.mass * k.viscLap(r) / pj.density;
        pfx += vCoef * (pj.velocity.x - pi.velocity.x);
        pfy += vCoef * (pj.velocity.y - pi.velocity.y);
        pfz += vCoef * (pj.velocity.z - pi.velocity.z);
      }
      pi.force.set(pfx, pfy, pfz);
      // 同步写入加速度 a = F/m
      const invM = pi.mass > 0 ? 1 / pi.mass : 0;
      pi.acceleration.set(pfx * invM, pfy * invM, pfz * invM);
    }
  }

  /** 半隐式 Euler 积分:
   *  a = F / m, v += a*dt, x += v*dt。
   *  force/acceleration 计算后清零(force)。 */
  integrate(dt: number): void {
    for (const p of this.particles) {
      const invM = p.mass > 0 ? 1 / p.mass : 0;
      // a = F/m
      const ax = p.force.x * invM;
      const ay = p.force.y * invM;
      const az = p.force.z * invM;
      p.acceleration.set(ax, ay, az);
      // v += a*dt
      p.velocity.x += ax * dt;
      p.velocity.y += ay * dt;
      p.velocity.z += az * dt;
      // x += v*dt
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;
      // 清零力
      p.force.set(0, 0, 0);
    }
  }

  /** 边界碰撞:粒子位置投影到 AABB 内,速度沿穿透轴反弹(乘恢复系数)。 */
  collideBounds(): void {
    const b = this.bounds;
    const r = this.restitution;
    for (const p of this.particles) {
      // X 轴
      if (p.position.x < b.min.x) {
        p.position.x = b.min.x;
        if (p.velocity.x < 0) p.velocity.x = -p.velocity.x * r;
      } else if (p.position.x > b.max.x) {
        p.position.x = b.max.x;
        if (p.velocity.x > 0) p.velocity.x = -p.velocity.x * r;
      }
      // Y 轴
      if (p.position.y < b.min.y) {
        p.position.y = b.min.y;
        if (p.velocity.y < 0) p.velocity.y = -p.velocity.y * r;
      } else if (p.position.y > b.max.y) {
        p.position.y = b.max.y;
        if (p.velocity.y > 0) p.velocity.y = -p.velocity.y * r;
      }
      // Z 轴
      if (p.position.z < b.min.z) {
        p.position.z = b.min.z;
        if (p.velocity.z < 0) p.velocity.z = -p.velocity.z * r;
      } else if (p.position.z > b.max.z) {
        p.position.z = b.max.z;
        if (p.velocity.z > 0) p.velocity.z = -p.velocity.z * r;
      }
    }
  }

  /** 边界处理(别名,等同 collideBounds)。 */
  handleBounds(): void {
    this.collideBounds();
  }

  /** 返回扁平化粒子位置 + 速度数据用于渲染(点云 / instanced mesh)。
   *  positions: Float32Array(n*3) [x,y,z,...]
   *  velocities: Float32Array(n*3) 同结构
   *  densities: Float32Array(n) */
  getMeshData(): {
    positions: Float32Array;
    velocities: Float32Array;
    densities: Float32Array;
    count: number;
  } {
    const n = this.particles.length;
    const positions = new Float32Array(n * 3);
    const velocities = new Float32Array(n * 3);
    const densities = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      positions[i * 3] = p.position.x;
      positions[i * 3 + 1] = p.position.y;
      positions[i * 3 + 2] = p.position.z;
      velocities[i * 3] = p.velocity.x;
      velocities[i * 3 + 1] = p.velocity.y;
      velocities[i * 3 + 2] = p.velocity.z;
      densities[i] = p.density;
    }
    return { positions, velocities, densities, count: n };
  }

  /** 清除所有粒子(并清空并行数组与网格)。 */
  clear(): this {
    this.particles = [];
    this.density = new Float32Array(0);
    this.pressure = new Float32Array(0);
    this.spatialGrid.clear();
    return this;
  }

  /** 在指定区域内填充均匀分布的粒子(用于初始化)。 */
  fillBox(min: Vector3, max: Vector3, spacing: number, jitter: number = 0): number {
    if (spacing <= 0) throw new Error(`FluidSimulation.fillBox: spacing must be > 0`);
    const sx = Math.floor((max.x - min.x) / spacing) + 1;
    const sy = Math.floor((max.y - min.y) / spacing) + 1;
    const sz = Math.floor((max.z - min.z) / spacing) + 1;
    let added = 0;
    for (let i = 0; i < sx; i++) {
      for (let j = 0; j < sy; j++) {
        for (let k = 0; k < sz; k++) {
          const x = min.x + i * spacing + (jitter ? (Math.random() - 0.5) * jitter : 0);
          const y = min.y + j * spacing + (jitter ? (Math.random() - 0.5) * jitter : 0);
          const z = min.z + k * spacing + (jitter ? (Math.random() - 0.5) * jitter : 0);
          if (this.addParticle(new Vector3(x, y, z)) >= 0) added++;
        }
      }
    }
    return added;
  }

  /** SPH Poly6 核函数 W(r, h) = 315/(64πh^9) (h²-r²)³,r ∈ [0,h]。
   *  纯函数,不依赖实例状态(可静态调用风格使用)。 */
  kernel(r: number, h: number): number {
    if (r >= h || r < 0) return 0;
    const h2 = h * h;
    const r2 = r * r;
    const diff = h2 - r2;
    const k = 315 / (64 * Math.PI * Math.pow(h, 9));
    return k * diff * diff * diff;
  }

  /** SPH Spiky 核梯度模长 |∇W(r, h)| = 45/(πh^6) (h-r)²,r ∈ (0,h)。
   *  返回值已含负号(指向邻居方向为负),与压力力公式 F = -coef * ∇W 配合使用。 */
  kernelGradient(r: number, h: number): number {
    if (r >= h || r <= 1e-9) return 0;
    const diff = h - r;
    const k = 45 / (Math.PI * Math.pow(h, 6));
    return -k * diff * diff;
  }

  /** SPH Viscosity 核拉普拉斯 ∇²W(r, h) = 45/(πh^6) (h-r),r ∈ (0,h)。 */
  kernelLaplacian(r: number, h: number): number {
    if (r >= h || r <= 1e-9) return 0;
    const k = 45 / (Math.PI * Math.pow(h, 6));
    return k * (h - r);
  }

  /** 返回统计信息(密度/压力聚合需在 computeDensity/computePressure 后才有意义)。 */
  getStats(): FluidStats {
    const n = this.particles.length;
    let sumDens = 0, maxDens = 0;
    let sumPres = 0, maxPres = 0;
    for (const p of this.particles) {
      sumDens += p.density;
      if (p.density > maxDens) maxDens = p.density;
      sumPres += p.pressure;
      if (p.pressure > maxPres) maxPres = p.pressure;
    }
    return {
      particleCount: n,
      maxParticles: this.maxParticles,
      smoothingRadius: this.smoothingRadius,
      restDensity: this.restDensity,
      gasConstant: this.gasConstant,
      viscosity: this.viscosity,
      gravity: this.gravity,
      bounds: this.bounds,
      averageDensity: n > 0 ? sumDens / n : 0,
      maxDensity: maxDens,
      averagePressure: n > 0 ? sumPres / n : 0,
      maxPressure: maxPres,
      gridCellCount: this.spatialGrid.getCellCount(),
    };
  }
}

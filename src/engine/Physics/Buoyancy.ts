// Buoyancy — 浮力物理系统 (阿基米德浮力 + 水阻力 + 稳定性恢复力矩)。
//
// 设计:
//   * BuoyantBody — 浮体描述符 (mass / volume / centerOfMass / density / 运动状态)。
//   * computeSubmergedVolume — 体素化采样求淹没体积 (旋转 AABB 内 N 个采样点,
//     变换到世界空间后统计 y < fluidHeight 的比例)。
//   * computeBuoyancy — 阿基米德浮力 F = ρ_fluid * V_sub * g (向上)。
//   * computeDrag — 水阻力 F = -linearDrag * v * submergedRatio (仅淹没部分受水阻力)。
//   * computeStability — 恢复力矩, 把倾覆的浮体拉回正立 (基于 body up 轴与世界 up
//     的夹角, 力矩 ∝ cross(bodyUp, worldUp) * submergedRatio)。
//   * update(dt) — 集成位置 / 速度 / 旋转 / 角速度 (半隐式 Euler)。
//
// 与 ECS PhysicsSystems / ConstraintSolver 解耦:
//   浮力是垂直方向的长程力, 与刚体碰撞冲量响应形态不同, 独立实现。
//   后续可包装为 BuoyancyComponent + BuoyancySystem 接入 ECS。
//
// 用法:
//   const b = new Buoyancy({ fluidLevel: 0 });
//   b.registerBody('boat', { mass: 100, volume: 0.5, halfExtents: new Vector3(1,0.5,2), ... });
//   b.update(dt);
//   const ratio = b.getSubmergedRatio('boat');

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 浮体描述符。 */
export interface BuoyantBody {
  /** 唯一 id (由调用方提供, registerBody 时使用)。 */
  id: string;
  /** 质量 (kg)。 */
  mass: number;
  /** 体积 (m³), 用于密度计算与淹没比例。 */
  volume: number;
  /** 质心 (局部坐标, 相对 position)。 */
  centerOfMass: Vector3;
  /** 密度 (kg/m³, = mass / volume)。 */
  density: number;
  /** 当前位置 (世界空间, 即质心位置)。 */
  position: Vector3;
  /** 当前线速度 (m/s)。 */
  velocity: Vector3;
  /** 当前角速度 (rad/s, 沿轴方向)。 */
  angularVelocity: Vector3;
  /** 当前朝向 (单位四元数)。 */
  rotation: Quaternion;
  /** 半尺寸 (米, 沿 local x/y/z)。用于体素化采样, 默认 (1,1,1)。
   *  注意: spec 列出的核心字段不含此字段, 此为 voxelize/computeSubmergedVolume
   *  必需的形状信息, 由调用方在 registerBody 时提供。 */
  halfExtents: Vector3;
  /** 当前淹没体积 (m³, 由 update 写回)。 */
  submergedVolume: number;
  /** 当前浮力 (N, 由 update 写回, 仅 y 分量非零)。 */
  buoyancyForce: Vector3;
}

/** Buoyancy 构造选项。 */
export interface BuoyancyOptions {
  /** 流体密度 (kg/m³, 默认 1000=水)。 */
  fluidDensity?: number;
  /** 液面高度 (世界 y 坐标, 默认 0)。 */
  fluidLevel?: number;
  /** 重力加速度向量 (m/s², 默认 (0,-9.81,0))。 */
  gravity?: Vector3;
  /** 线性阻力系数 (默认 0.5)。 */
  linearDrag?: number;
  /** 角阻力系数 (默认 0.5)。 */
  angularDrag?: number;
  /** 体素化采样数 (默认 256, 越大越精确但越慢)。 */
  voxelCount?: number;
  /** 体素大小 (米, 默认 0.1, 用于决定采样间距)。 */
  voxelSize?: number;
  /** 稳定性恢复系数 (默认 1.0, 越大越快回正)。 */
  stabilityCoefficient?: number;
}

/** Buoyancy.getStats() 返回的统计信息。 */
export interface BuoyancyStats {
  /** 当前浮体数。 */
  bodyCount: number;
  /** 流体密度。 */
  fluidDensity: number;
  /** 液面高度。 */
  fluidLevel: number;
  /** 重力加速度。 */
  gravity: { x: number; y: number; z: number };
  /** 线性阻力系数。 */
  linearDrag: number;
  /** 角阻力系数。 */
  angularDrag: number;
  /** 体素化采样数。 */
  voxelCount: number;
  /** 体素大小。 */
  voxelSize: number;
  /** 当前累计模拟时间 (秒)。 */
  time: number;
}

/** 浮体注册项 (内部, 持有 body 引用 + 体素缓存)。 */
interface BuoyantBodyEntry {
  body: BuoyantBody;
  /** 体素化采样的局部坐标 (相对 centerOfMass), 长度 = voxelCount。 */
  voxels: Vector3[];
}

/**
 * 浮力物理系统 — 阿基米德浮力 + 水阻力 + 稳定性恢复力矩。
 *
 * 体素化策略:
 *   在 halfExtents × 2 的 AABB 内 (以 centerOfMass 为原点) 均匀采样 voxelCount 个点,
 *   每个采样点用 rotation 变换到世界空间 + position 平移, 统计 y < fluidHeight 的比例。
 *   submergedVolume = ratio * body.volume。
 */
export class Buoyancy {
  /** 流体密度 (kg/m³)。 */
  fluidDensity: number;
  /** 液面高度 (世界 y)。 */
  fluidLevel: number;
  /** 重力加速度。 */
  gravity: Vector3;
  /** 线性阻力系数。 */
  linearDrag: number;
  /** 角阻力系数。 */
  angularDrag: number;
  /** 体素化采样数。 */
  voxelCount: number;
  /** 体素大小 (米)。 */
  voxelSize: number;
  /** 稳定性恢复系数。 */
  stabilityCoefficient: number;

  /** 注册的浮体表 (id → entry)。 */
  private _bodies: Map<string, BuoyantBodyEntry> = new Map();
  /** 累计模拟时间。 */
  private _time: number = 0;

  constructor(opts: BuoyancyOptions = {}) {
    this.fluidDensity = Math.max(0, opts.fluidDensity ?? 1000);
    this.fluidLevel = opts.fluidLevel ?? 0;
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -9.81, 0);
    this.linearDrag = Math.max(0, opts.linearDrag ?? 0.5);
    this.angularDrag = Math.max(0, opts.angularDrag ?? 0.5);
    this.voxelCount = Math.max(1, Math.floor(opts.voxelCount ?? 256));
    this.voxelSize = Math.max(0.001, opts.voxelSize ?? 0.1);
    this.stabilityCoefficient = Math.max(0, opts.stabilityCoefficient ?? 1.0);
  }

  // ── 注册 ──────────────────────────────────────────────

  /**
   * 注册一个浮体。
   *
   * @param id 唯一 id。
   * @param body 浮体描述符。若已存在同 id 则覆盖。
   * @returns this。
   */
  registerBody(id: string, body: BuoyantBody): this {
    const entry: BuoyantBodyEntry = {
      body,
      voxels: this.voxelize(body),
    };
    this._bodies.set(id, entry);
    return this;
  }

  /** 注销浮体。 */
  unregisterBody(id: string): this {
    this._bodies.delete(id);
    return this;
  }

  /** 获取浮体 (不存在返回 undefined)。 */
  getBody(id: string): BuoyantBody | undefined {
    return this._bodies.get(id)?.body;
  }

  /** 获取所有浮体 (新数组, 修改不影响内部)。 */
  getBodies(): BuoyantBody[] {
    const out: BuoyantBody[] = [];
    this._bodies.forEach((entry) => out.push(entry.body));
    return out;
  }

  // ── 更新 ──────────────────────────────────────────────

  /**
   * 推进一帧: 对每个浮体计算浮力 / 阻力 / 稳定性, 半隐式 Euler 积分。
   *
   * @param dt 流逝时间 (秒, 钳到非负)。
   */
  update(dt: number): this {
    if (dt < 0) dt = 0;
    this._time += dt;
    this._bodies.forEach((entry) => {
      const body = entry.body;
      // 1. 淹没体积 (用缓存的体素)
      body.submergedVolume = this.computeSubmergedVolume(body, this.fluidLevel);
      // 2. 浮力
      const buoyancy = this.computeBuoyancy(body, this.fluidLevel);
      body.buoyancyForce.copy(buoyancy);
      // 3. 阻力
      const drag = this.computeDrag(body);
      // 4. 稳定性恢复力矩
      const stability = this.computeStability(body);
      // 5. 积分
      // 重力 (质量 × g)
      const gravityForce = this.gravity.clone().multiplyScalar(body.mass);
      // 总力 = 重力 + 浮力 + 阻力
      const totalForce = gravityForce.add(buoyancy).add(drag);
      // 加速度 = F/m (mass > 0 时)
      if (body.mass > 0) {
        const accel = totalForce.divideScalar(body.mass);
        body.velocity.add(accel.multiplyScalar(dt));
      }
      // 位置积分
      body.position.addScaledVector(body.velocity, dt);
      // 角速度积分: angularVelocity += (stability - angularDrag * angularVelocity) * dt
      // 简化转动惯量 I = mass * (halfExtents² 之和) / 12 (立方体近似)
      const I = this._estimateInertia(body);
      if (I > 0) {
        // 角阻力: -angularDrag * angularVelocity
        const angDamp = body.angularVelocity.clone().multiplyScalar(-this.angularDrag * body.submergedVolume / Math.max(body.volume, 1e-9));
        const torque = stability.add(angDamp);
        body.angularVelocity.addScaledVector(torque, dt / I);
      }
      // 旋转积分: 四元数 omega * dt / 2
      this._integrateRotation(body.rotation, body.angularVelocity, dt);
    });
    return this;
  }

  /**
   * 计算浮力 (阿基米德): F = ρ_fluid * V_sub * g (向上, 即 -gravity 方向)。
   *
   * @param body 浮体。
   * @param fluidHeight 液面高度 (用于计算淹没体积, 若已计算可复用)。
   * @returns 浮力向量 (新 Vector3)。
   */
  computeBuoyancy(body: BuoyantBody, fluidHeight: number): Vector3 {
    const vSub = this.computeSubmergedVolume(body, fluidHeight);
    // F = ρ * V_sub * (-gravity) (向上, gravity 朝下, -gravity 朝上)
    return this.gravity.clone().multiplyScalar(-this.fluidDensity * vSub);
  }

  /**
   * 计算水阻力 (仅淹没部分受水阻力)。
   *   F = -linearDrag * velocity * submergedRatio
   *
   * @param body 浮体。
   * @returns 阻力向量 (新 Vector3)。
   */
  computeDrag(body: BuoyantBody): Vector3 {
    const ratio = body.volume > 0 ? body.submergedVolume / body.volume : 0;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    return body.velocity
      .clone()
      .multiplyScalar(-this.linearDrag * clampedRatio);
  }

  /**
   * 计算稳定性恢复力矩。
   *
   * 模型: 把浮体的局部 up 轴 (0,1,0) 用 rotation 变换到世界空间, 与世界 up 轴
   * (0,1,0) 做叉积, 得到力矩方向; 力矩大小 ∝ submergedRatio * stabilityCoefficient。
   * 力矩作用方向是把 body up 拉回 world up。
   *
   * @param body 浮体。
   * @returns 力矩向量 (新 Vector3)。
   */
  computeStability(body: BuoyantBody): Vector3 {
    const ratio = body.volume > 0 ? body.submergedVolume / body.volume : 0;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    // body up in world space
    const localUp = new Vector3(0, 1, 0);
    const bodyUp = localUp.applyQuaternion(body.rotation);
    // world up
    const worldUp = new Vector3(0, 1, 0);
    // torque = cross(bodyUp, worldUp) * coefficient * ratio
    // (cross(bodyUp, worldUp) 把 bodyUp 绕该轴转到 worldUp)
    const torque = bodyUp.clone().cross(worldUp);
    torque.multiplyScalar(this.stabilityCoefficient * clampedRatio);
    return torque;
  }

  /**
   * 计算淹没体积 (体素化采样)。
   *
   * 用缓存的体素局部坐标 + body.position + body.rotation 变换到世界空间,
   * 统计 y < fluidHeight 的体素比例, 乘以 body.volume。
   *
   * @param body 浮体。
   * @param fluidHeight 液面高度。
   * @returns 淹没体积 (m³, [0, volume])。
   */
  computeSubmergedVolume(body: BuoyantBody, fluidHeight: number): number {
    if (body.volume <= 0) return 0;
    const entry = this._findEntry(body.id);
    if (!entry) {
      // 未注册体 (理论上不会发生, update 走 entry), 退化用 AABB 估计
      return this._estimateSubmergedAABB(body, fluidHeight);
    }
    const voxels = entry.voxels;
    if (voxels.length === 0) return 0;
    let submerged = 0;
    const tmp = new Vector3();
    for (let i = 0; i < voxels.length; i++) {
      // 世界坐标 = position + rotation * (voxel + centerOfMass)
      tmp.copy(voxels[i]);
      tmp.add(body.centerOfMass);
      tmp.applyQuaternion(body.rotation);
      tmp.add(body.position);
      if (tmp.y < fluidHeight) submerged++;
    }
    const ratio = submerged / voxels.length;
    return ratio * body.volume;
  }

  /**
   * 体素化浮体 — 在 halfExtents×2 AABB 内均匀采样 voxelCount 个点 (相对 centerOfMass)。
   *
   * 采样策略: 立方根近似, 每轴等分 ceil(voxelCount^(1/3)), 取前 voxelCount 个。
   *
   * @param body 浮体。
   * @returns 局部坐标采样点数组 (相对 centerOfMass, 不含旋转)。
   */
  voxelize(body: BuoyantBody): Vector3[] {
    const count = Math.max(1, this.voxelCount);
    const out: Vector3[] = [];
    const hx = body.halfExtents.x;
    const hy = body.halfExtents.y;
    const hz = body.halfExtents.z;
    // 每轴分多少格
    const perAxis = Math.max(1, Math.ceil(Math.cbrt(count)));
    let added = 0;
    for (let ix = 0; ix < perAxis && added < count; ix++) {
      const fx = (ix + 0.5) / perAxis; // [0,1]
      const lx = (fx * 2 - 1) * hx;
      for (let iy = 0; iy < perAxis && added < count; iy++) {
        const fy = (iy + 0.5) / perAxis;
        const ly = (fy * 2 - 1) * hy;
        for (let iz = 0; iz < perAxis && added < count; iz++) {
          const fz = (iz + 0.5) / perAxis;
          const lz = (fz * 2 - 1) * hz;
          out.push(new Vector3(lx, ly, lz));
          added++;
        }
      }
    }
    return out;
  }

  // ── setter ───────────────────────────────────────────

  /** 设置流体密度 (kg/m³)。 */
  setFluidDensity(density: number): this {
    this.fluidDensity = Math.max(0, density);
    return this;
  }

  /** 设置液面高度 (世界 y)。 */
  setFluidLevel(level: number): this {
    this.fluidLevel = level;
    return this;
  }

  /** 设置重力加速度向量。 */
  setGravity(g: Vector3): this {
    this.gravity.copy(g);
    return this;
  }

  /** 设置线性阻力系数。 */
  setLinearDrag(drag: number): this {
    this.linearDrag = Math.max(0, drag);
    return this;
  }

  /** 设置角阻力系数。 */
  setAngularDrag(drag: number): this {
    this.angularDrag = Math.max(0, drag);
    return this;
  }

  /** 设置体素采样数 (重新体素化所有已注册浮体)。 */
  setVoxelCount(count: number): this {
    this.voxelCount = Math.max(1, Math.floor(count));
    // 重新体素化所有已注册浮体
    this._bodies.forEach((entry) => {
      entry.voxels = this.voxelize(entry.body);
    });
    return this;
  }

  // ── 查询 ──────────────────────────────────────────────

  /** 获取浮体数。 */
  getBodyCount(): number {
    return this._bodies.size;
  }

  /**
   * 获取浮体的淹没比例 (submergedVolume / volume)。
   * 不存在返回 0。
   */
  getSubmergedRatio(id: string): number {
    const body = this.getBody(id);
    if (!body || body.volume <= 0) return 0;
    return Math.max(0, Math.min(1, body.submergedVolume / body.volume));
  }

  /** 获取统计信息。 */
  getStats(): BuoyancyStats {
    return {
      bodyCount: this._bodies.size,
      fluidDensity: this.fluidDensity,
      fluidLevel: this.fluidLevel,
      gravity: { x: this.gravity.x, y: this.gravity.y, z: this.gravity.z },
      linearDrag: this.linearDrag,
      angularDrag: this.angularDrag,
      voxelCount: this.voxelCount,
      voxelSize: this.voxelSize,
      time: this._time,
    };
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 查找浮体注册项。 */
  private _findEntry(id: string): BuoyantBodyEntry | undefined {
    return this._bodies.get(id);
  }

  /** AABB 退化淹没估计 (未体素化时): 用 position.y 与 halfExtents.y 估算。 */
  private _estimateSubmergedAABB(body: BuoyantBody, fluidHeight: number): number {
    const top = body.position.y + body.halfExtents.y;
    const bot = body.position.y - body.halfExtents.y;
    if (top <= fluidHeight) return body.volume; // 完全淹没
    if (bot >= fluidHeight) return 0; // 完全出水
    const subHeight = fluidHeight - bot;
    const totalHeight = top - bot;
    const ratio = subHeight / totalHeight;
    return ratio * body.volume;
  }

  /** 估算浮体转动惯量 (立方体近似 I = m*(a²+b²+c²)/12, a/b/c=halfExtents*2)。 */
  private _estimateInertia(body: BuoyantBody): number {
    const a = body.halfExtents.x * 2;
    const b = body.halfExtents.y * 2;
    const c = body.halfExtents.z * 2;
    return (body.mass * (a * a + b * b + c * c)) / 12;
  }

  /**
   * 四元数旋转积分: q' = q + (omega * dt / 2) ⊗ q, 然后归一化。
   * 用增量形式避免每次构造临时四元数。
   */
  private _integrateRotation(q: Quaternion, omega: Vector3, dt: number): void {
    const halfDt = dt * 0.5;
    // dq/dt = 0.5 * omega(qua) ⊗ q
    // omega(qua) = (omega.x, omega.y, omega.z, 0)
    const wx = omega.x * halfDt;
    const wy = omega.y * halfDt;
    const wz = omega.z * halfDt;
    // dq = (wx, wy, wz, 0) ⊗ q  → 增量
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const dx = wx * qw + wy * qz - wz * qy;
    const dy = -wx * qz + wy * qw + wz * qx;
    const dz = wx * qy - wy * qx + wz * qw;
    const dw = -wx * qx - wy * qy - wz * qz;
    q.x = qx + dx;
    q.y = qy + dy;
    q.z = qz + dz;
    q.w = qw + dw;
    q.normalize();
  }
}

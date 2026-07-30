// ClothSimulation — Verlet 积分布料模拟(网格 + 约束 + 风力 + 碰撞)。
//
// 设计:
//   - 粒子网格(particles):每个粒子存当前 position + 上一帧 prevPosition +
//     累积 acceleration + mass + pinned 标志。
//     Verlet 积分:next = pos + (pos - prev) * (1 - damping) + accel * dt²
//   - 距离约束(constraints):连接两个粒子,记录静止长度 restLength + 类型
//     (structural 结构 / shear 剪切 / bend 弯曲)。PBD 风格位置修正,迭代多次收敛。
//   - 固定粒子(pinnedPoints):不参与积分,位置保持不变(挂点)。
//   - 风力(wind):作为连续加速度累加到非固定粒子。
//   - 自碰撞(selfCollision):O(n²) 距离检查,把过近粒子对推开到 selfCollisionDist。
//   - 碰撞:collideWithSphere / collideWithBox 把穿透粒子投影到表面外。
//
// 与引擎的集成:
//   - update(dt) 内部完成:重力累加 → 风力 → Verlet 积分 → 约束求解 → 自碰撞。
//     collideWithSphere/Box 由调用方按需在 update 后调用。
//   - getMeshData() 返回扁平化的 positions/indices/normals,可灌入 BufferGeometry。
//   - 与 ECS PhysicsSystems(刚体)解耦:布料是 soft body,形态差异大,独立实现。
//   - 后续若要接入 ECS,可包装为 ClothComponent + ClothSystem。

import { Vector3 } from '../Math/Vector3';

/** 布料粒子(Verlet 点)。 */
export interface ClothParticle {
  /** 当前位置(世界空间)。 */
  position: Vector3;
  /** 上一帧位置(Verlet 积分用)。 */
  prevPosition: Vector3;
  /** 累积加速度(本帧重力 / 风力累加,积分后清零)。 */
  acceleration: Vector3;
  /** 质量(kg)。 */
  mass: number;
  /** 是否固定(固定粒子不积分、不被约束移动)。 */
  pinned: boolean;
}

/** 约束类型。structural = 结构(相邻), shear = 剪切(对角), bend = 弯曲(隔点)。 */
export type ClothConstraintType = 'structural' | 'shear' | 'bend';

/** 距离约束(连接两个粒子,保持静止长度)。 */
export interface ClothConstraint {
  /** 粒子 A 索引(在 particles 数组中)。 */
  p1: number;
  /** 粒子 B 索引。 */
  p2: number;
  /** 静止长度(求解目标)。 */
  restLength: number;
  /** 刚度 [0,1](位置修正比例,越高越硬)。 */
  stiffness: number;
  /** 约束类型。 */
  type: ClothConstraintType;
}

/** ClothSimulation 构造选项。 */
export interface ClothOptions {
  /** 重力加速度(默认 (0,-9.8,0))。 */
  gravity?: Vector3;
  /** 风力加速度(默认 (0,0,0))。 */
  wind?: Vector3;
  /** 全局阻尼 [0,1](默认 0.01)。 */
  damping?: number;
  /** 默认刚度 [0,1](默认 1.0)。 */
  stiffness?: number;
  /** 约束求解迭代次数(默认 4)。 */
  iterations?: number;
  /** 是否启用自碰撞(默认 false)。 */
  selfCollision?: boolean;
  /** 自碰撞最小距离(默认 0.1)。 */
  selfCollisionDist?: number;
  /** 单粒子质量 kg(默认 1)。 */
  mass?: number;
}

/** ClothSimulation.getStats() 返回的统计信息。 */
export interface ClothStats {
  particleCount: number;
  constraintCount: number;
  pinnedCount: number;
  iterations: number;
  selfCollision: boolean;
  selfCollisionDist: number;
  gridCols: number;
  gridRows: number;
}

export class ClothSimulation {
  particles: ClothParticle[] = [];
  constraints: ClothConstraint[] = [];
  /** 网格物理宽度。 */
  width: number = 0;
  /** 网格物理高度。 */
  height: number = 0;
  /** 网格列数(顶点)。 */
  gridCols: number = 0;
  /** 网格行数(顶点)。 */
  gridRows: number = 0;
  /** 重力加速度(世界空间)。 */
  gravity: Vector3;
  /** 风力加速度(世界空间)。 */
  wind: Vector3;
  /** 全局阻尼。 */
  damping: number;
  /** 默认刚度(createGrid 创建的约束使用)。 */
  stiffness: number;
  /** 约束求解迭代次数。 */
  iterations: number;
  /** 是否启用自碰撞。 */
  selfCollision: boolean;
  /** 自碰撞最小距离。 */
  selfCollisionDist: number;
  /** 固定粒子索引集合(与 particle.pinned 同步)。 */
  pinnedPoints: Set<number>;
  /** 单粒子默认质量(创建网格时使用)。 */
  mass: number;

  constructor(opts: ClothOptions = {}) {
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -9.8, 0);
    this.wind = opts.wind ? opts.wind.clone() : new Vector3();
    this.damping = opts.damping ?? 0.01;
    this.stiffness = opts.stiffness ?? 1.0;
    this.iterations = opts.iterations ?? 4;
    this.selfCollision = opts.selfCollision ?? false;
    this.selfCollisionDist = opts.selfCollisionDist ?? 0.1;
    this.mass = opts.mass ?? 1;
    this.pinnedPoints = new Set<number>();
  }

  /** 创建 width × height 物理尺寸、cols × rows 顶点的布料网格。
   *  网格在 XY 平面上展开,中心在原点。
   *  自动生成约束:structural(水平/垂直相邻)、shear(对角)、bend(隔一格)。 */
  createGrid(width: number, height: number, cols: number, rows: number): this {
    if (width <= 0 || height <= 0) {
      throw new Error(`ClothSimulation.createGrid: width/height must be > 0 (got ${width}x${height})`);
    }
    if (cols < 2 || rows < 2) {
      throw new Error(`ClothSimulation.createGrid: cols/rows must be >= 2 (got ${cols}x${rows})`);
    }

    this.width = width;
    this.height = height;
    this.gridCols = cols;
    this.gridRows = rows;
    this.particles = [];
    this.constraints = [];
    this.pinnedPoints.clear();

    const stepX = width / (cols - 1);
    const stepY = height / (rows - 1);
    const offX = -width / 2;
    const offY = height / 2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const pos = new Vector3(offX + i * stepX, offY - j * stepY, 0);
        this.particles.push({
          position: pos.clone(),
          prevPosition: pos.clone(),
          acceleration: new Vector3(),
          mass: this.mass,
          pinned: false,
        });
      }
    }

    const idx = (x: number, y: number): number => y * cols + x;

    // structural:水平 + 垂直相邻
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols - 1; i++) {
        this.addConstraint(idx(i, j), idx(i + 1, j), 'structural');
      }
    }
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols; i++) {
        this.addConstraint(idx(i, j), idx(i, j + 1), 'structural');
      }
    }
    // shear:两个对角方向
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        this.addConstraint(idx(i, j), idx(i + 1, j + 1), 'shear');
        this.addConstraint(idx(i + 1, j), idx(i, j + 1), 'shear');
      }
    }
    // bend:隔一格的水平 / 垂直(抵抗折叠)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols - 2; i++) {
        this.addConstraint(idx(i, j), idx(i + 2, j), 'bend');
      }
    }
    for (let j = 0; j < rows - 2; j++) {
      for (let i = 0; i < cols; i++) {
        this.addConstraint(idx(i, j), idx(i, j + 2), 'bend');
      }
    }

    return this;
  }

  /** 添加约束。restLength 默认取当前两点距离,stiffness 默认取 this.stiffness。 */
  addConstraint(
    p1: number,
    p2: number,
    type: ClothConstraintType,
    stiffness?: number,
  ): this {
    if (p1 < 0 || p2 < 0 || p1 >= this.particles.length || p2 >= this.particles.length) {
      throw new Error(`ClothSimulation.addConstraint: particle index out of range (${p1}, ${p2})`);
    }
    if (p1 === p2) {
      throw new Error(`ClothSimulation.addConstraint: p1 === p2 (${p1})`);
    }
    const a = this.particles[p1].position;
    const b = this.particles[p2].position;
    this.constraints.push({
      p1,
      p2,
      restLength: a.distanceTo(b),
      stiffness: stiffness ?? this.stiffness,
      type,
    });
    return this;
  }

  /** 移除约束(按索引)。 */
  removeConstraint(index: number): this {
    if (index < 0 || index >= this.constraints.length) {
      throw new Error(`ClothSimulation.removeConstraint: index out of range (${index})`);
    }
    this.constraints.splice(index, 1);
    return this;
  }

  /** 固定粒子。 */
  pinParticle(index: number): this {
    if (index < 0 || index >= this.particles.length) {
      throw new Error(`ClothSimulation.pinParticle: index out of range (${index})`);
    }
    this.particles[index].pinned = true;
    this.pinnedPoints.add(index);
    return this;
  }

  /** 解除固定。 */
  unpinParticle(index: number): this {
    if (index < 0 || index >= this.particles.length) {
      throw new Error(`ClothSimulation.unpinParticle: index out of range (${index})`);
    }
    this.particles[index].pinned = false;
    this.pinnedPoints.delete(index);
    return this;
  }

  /** 设置重力。 */
  setGravity(gravity: Vector3): this {
    this.gravity.copy(gravity);
    return this;
  }

  /** 设置风力。 */
  setWind(wind: Vector3): this {
    this.wind.copy(wind);
    return this;
  }

  /** 设置阻尼。 */
  setDamping(damping: number): this {
    this.damping = damping;
    return this;
  }

  /** 设置默认刚度(不影响已创建的约束)。 */
  setStiffness(stiffness: number): this {
    this.stiffness = stiffness;
    return this;
  }

  /** 设置约束求解迭代次数。 */
  setIterations(iterations: number): this {
    this.iterations = iterations;
    return this;
  }

  /** 启用 / 禁用自碰撞,dist 可选。 */
  setSelfCollision(enabled: boolean, dist?: number): this {
    this.selfCollision = enabled;
    if (dist !== undefined) this.selfCollisionDist = dist;
    return this;
  }

  /** 推进一帧。流程:
   *   1) 累加重力到 acceleration
   *   2) applyWind(dt) 累加风力
   *   3) verletIntegrate(dt) Verlet 积分(并清零 acceleration)
   *   4) solveConstraints() 迭代求解距离约束
   *   5) 若启用自碰撞,applySelfCollision()
   *   dt 上限 1/30(防止大步长穿模)。 */
  update(dt: number): void {
    const step = Math.min(dt, 1 / 30);

    // 1) 重力
    for (const p of this.particles) {
      if (p.pinned) continue;
      p.acceleration.add(this.gravity);
    }

    // 2) 风力
    this.applyWind(step);

    // 3) Verlet 积分
    this.verletIntegrate(step);

    // 4) 约束求解
    this.solveConstraints();

    // 5) 自碰撞
    if (this.selfCollision) {
      this.applySelfCollision();
    }
  }

  /** Verlet 积分。消耗 acceleration 并清零。固定粒子跳过。 */
  verletIntegrate(dt: number): void {
    const dampingFactor = 1 - this.damping;
    const dt2 = dt * dt;
    for (const p of this.particles) {
      if (p.pinned) {
        p.acceleration.set(0, 0, 0);
        continue;
      }
      const vx = (p.position.x - p.prevPosition.x) * dampingFactor;
      const vy = (p.position.y - p.prevPosition.y) * dampingFactor;
      const vz = (p.position.z - p.prevPosition.z) * dampingFactor;
      p.prevPosition.copy(p.position);
      p.position.x += vx + p.acceleration.x * dt2;
      p.position.y += vy + p.acceleration.y * dt2;
      p.position.z += vz + p.acceleration.z * dt2;
      p.acceleration.set(0, 0, 0);
    }
  }

  /** 约束求解(PBD 风格位置修正)。迭代 this.iterations 次。 */
  solveConstraints(): void {
    for (let iter = 0; iter < this.iterations; iter++) {
      for (const c of this.constraints) {
        const a = this.particles[c.p1];
        const b = this.particles[c.p2];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 1e-9) continue;
        const w1 = a.pinned ? 0 : 1 / a.mass;
        const w2 = b.pinned ? 0 : 1 / b.mass;
        const wSum = w1 + w2;
        if (wSum === 0) continue;
        const diff = (dist - c.restLength) / dist;
        const k = c.stiffness * diff;
        const r1 = (w1 / wSum) * k;
        const r2 = (w2 / wSum) * k;
        if (!a.pinned) {
          a.position.x += dx * r1;
          a.position.y += dy * r1;
          a.position.z += dz * r1;
        }
        if (!b.pinned) {
          b.position.x -= dx * r2;
          b.position.y -= dy * r2;
          b.position.z -= dz * r2;
        }
      }
    }
  }

  /** 应用风力(作为连续加速度累加到非固定粒子)。
   *  dt 保留用于未来时变湍流;当前实现把 wind 视为单位质量加速度直接累加。 */
  applyWind(dt: number): void {
    void dt;
    if (this.wind.lengthSq() === 0) return;
    for (const p of this.particles) {
      if (p.pinned) continue;
      p.acceleration.add(this.wind);
    }
  }

  /** 自碰撞处理:O(n²) 距离检查,把过近粒子对推开到 selfCollisionDist。
   *  修正分配:两端自由 → 各承担一半;一端固定 → 自由端承担全部;两端固定 → 跳过。
   *  对小到中等网格(< 数百粒子)可用;大网格建议接入空间哈希。 */
  applySelfCollision(): void {
    const n = this.particles.length;
    const minDist = this.selfCollisionDist;
    const minDist2 = minDist * minDist;
    for (let i = 0; i < n; i++) {
      const pi = this.particles[i];
      for (let j = i + 1; j < n; j++) {
        const pj = this.particles[j];
        const dx = pj.position.x - pi.position.x;
        const dy = pj.position.y - pi.position.y;
        const dz = pj.position.z - pi.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= minDist2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const overlap = minDist - d;
        const invD = 1 / d;
        const dirX = dx * invD;
        const dirY = dy * invD;
        const dirZ = dz * invD;
        if (pi.pinned && pj.pinned) continue;
        if (pi.pinned) {
          // i 固定,j 承担全部
          pj.position.x += dirX * overlap;
          pj.position.y += dirY * overlap;
          pj.position.z += dirZ * overlap;
        } else if (pj.pinned) {
          // j 固定,i 承担全部
          pi.position.x -= dirX * overlap;
          pi.position.y -= dirY * overlap;
          pi.position.z -= dirZ * overlap;
        } else {
          // 两端自由,各承担一半
          const half = overlap * 0.5;
          pi.position.x -= dirX * half;
          pi.position.y -= dirY * half;
          pi.position.z -= dirZ * half;
          pj.position.x += dirX * half;
          pj.position.y += dirY * half;
          pj.position.z += dirZ * half;
        }
      }
    }
  }

  /** 与球碰撞:把陷入球内的粒子推到球面外。粒子恰在球心时沿 +Y 推出。 */
  collideWithSphere(center: Vector3, radius: number): this {
    const r2 = radius * radius;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const dx = p.position.x - center.x;
      const dy = p.position.y - center.y;
      const dz = p.position.z - center.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) {
        if (d2 < 1e-12) {
          // 粒子在球心,方向未定义,沿 +Y 推出
          p.position.x = center.x;
          p.position.y = center.y + radius;
          p.position.z = center.z;
        } else {
          const d = Math.sqrt(d2);
          const scale = radius / d;
          p.position.x = center.x + dx * scale;
          p.position.y = center.y + dy * scale;
          p.position.z = center.z + dz * scale;
        }
      }
    }
    return this;
  }

  /** 与轴对齐盒子碰撞:把盒子内部的粒子推到最近的面外(盒子视为实体障碍)。 */
  collideWithBox(min: Vector3, max: Vector3): this {
    for (const p of this.particles) {
      if (p.pinned) continue;
      const px = p.position.x;
      const py = p.position.y;
      const pz = p.position.z;
      // 是否在盒内(开区间)
      const inside =
        px > min.x && px < max.x &&
        py > min.y && py < max.y &&
        pz > min.z && pz < max.z;
      if (!inside) continue;
      // 到 6 个面的距离,取最小,推到该面外
      const dxMin = px - min.x;
      const dxMax = max.x - px;
      const dyMin = py - min.y;
      const dyMax = max.y - py;
      const dzMin = pz - min.z;
      const dzMax = max.z - pz;
      const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
      if (m === dxMin) p.position.x = min.x;
      else if (m === dxMax) p.position.x = max.x;
      else if (m === dyMin) p.position.y = min.y;
      else if (m === dyMax) p.position.y = max.y;
      else if (m === dzMin) p.position.z = min.z;
      else p.position.z = max.z;
    }
    return this;
  }

  /** 获取粒子数组。 */
  getParticles(): ClothParticle[] {
    return this.particles;
  }

  /** 获取约束数组。 */
  getConstraints(): ClothConstraint[] {
    return this.constraints;
  }

  /** 返回扁平化的顶点 / 索引 / 法线数据,用于灌入 BufferGeometry。
   *  顶点顺序:row-major (j=0..gridRows-1, i=0..gridCols-1)。
   *  索引:每个 grid cell 两个三角形,CCW(从 +Z 看)。
   *  法线:per-vertex,由相邻两轴 cross 估算。 */
  getMeshData(): {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array;
    normals: Float32Array;
    gridCols: number;
    gridRows: number;
  } {
    const n = this.particles.length;
    const cols = this.gridCols;
    const rows = this.gridRows;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = this.particles[i].position.x;
      positions[i * 3 + 1] = this.particles[i].position.y;
      positions[i * 3 + 2] = this.particles[i].position.z;
    }

    const cellCount = (cols - 1) * (rows - 1);
    const indexCount = cellCount * 6;
    const indices = indexCount < 65536
      ? new Uint16Array(indexCount)
      : new Uint32Array(indexCount);
    let p = 0;
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices[p++] = a; indices[p++] = c; indices[p++] = b;
        indices[p++] = b; indices[p++] = c; indices[p++] = d;
      }
    }

    const normals = new Float32Array(n * 3);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const cur = this.particles[idx].position;
        const right = this.particles[j * cols + Math.min(i + 1, cols - 1)].position;
        const down = this.particles[Math.min(j + 1, rows - 1) * cols + i].position;
        const tx = right.x - cur.x;
        const ty = right.y - cur.y;
        const tz = right.z - cur.z;
        const bx = down.x - cur.x;
        const by = down.y - cur.y;
        const bz = down.z - cur.z;
        let nx = by * tz - bz * ty;
        let ny = bz * tx - bx * tz;
        let nz = bx * ty - by * tx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len; ny /= len; nz /= len;
        normals[idx * 3] = nx;
        normals[idx * 3 + 1] = ny;
        normals[idx * 3 + 2] = nz;
      }
    }

    return { positions, indices, normals, gridCols: cols, gridRows: rows };
  }

  /** 获取统计信息。 */
  getStats(): ClothStats {
    return {
      particleCount: this.particles.length,
      constraintCount: this.constraints.length,
      pinnedCount: this.pinnedPoints.size,
      iterations: this.iterations,
      selfCollision: this.selfCollision,
      selfCollisionDist: this.selfCollisionDist,
      gridCols: this.gridCols,
      gridRows: this.gridRows,
    };
  }
}

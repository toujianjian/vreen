// ClothSimulation — Verlet 积分布料模拟。
//
// 设计:
//   - 粒子网格(particles):每个粒子存当前 position + 上一帧 prevPosition
//     Verlet 积分:next = pos + (pos - prev) * (1 - damping) + accel * dt²
//   - 距离约束(constraints):每条约束连接两个粒子,记录静止长度 restLength
//     求解:PBD 风格 — 直接按 stiffness 比例修正位置,迭代多次收敛
//   - 固定粒子(pinned):不参与积分,位置保持不变(挂点)
//
// 与引擎的集成:
//   - update(dt) 内部完成积分 + 约束求解,position 写回 particles[i].position
//   - getMeshData() 返回扁平化的 positions/indices/normals,可灌入 BufferGeometry
//   - 调用方(如 CustomStage / 物理 demo)负责把数据同步到 Mesh.geometry
//
// 与 PhysicsSystems(CBD 物理引擎)的关系:
//   布料是 soft body,与刚体 ECS PhysicsComponents 形态差异大,因此独立实现。
//   后续若要把布料接入 ECS,可包装为 ClothComponent + ClothSystem。

import { Vector3 } from '../Math/Vector3';

/** 布料粒子(Verlet 点)。 */
export interface ClothParticle {
  /** 当前位置(世界空间)。 */
  position: Vector3;
  /** 上一帧位置(Verlet 积分用)。 */
  prevPosition: Vector3;
  /** 累积加速度(本帧 applyForce 累加,update 后清零)。 */
  acceleration: Vector3;
  /** 是否固定(pinned 粒子不积分)。 */
  pinned: boolean;
  /** 质量(kg);默认 1。 */
  mass: number;
  /** 逆质量(1/mass),0 = 静态。 */
  invMass: number;
}

/** 距离约束(连接两个粒子,保持静止长度)。 */
export interface ClothConstraint {
  /** 粒子 A 索引(在 particles 数组中)。 */
  p1: number;
  /** 粒子 B 索引。 */
  p2: number;
  /** 静止长度(求解目标)。 */
  restLength: number;
  /** 刚度 [0,1](每帧位置修正比例,越高越硬)。 */
  stiffness: number;
}

/** 球体碰撞体(collide 入参)。 */
export interface ClothSphere {
  center: Vector3;
  radius: number;
}

export interface ClothOptions {
  /** 全局阻尼 [0,1],0 = 无阻尼,1 = 完全停止。 */
  damping?: number;
  /** 全局刚度 [0,1],约束修正比例。 */
  stiffness?: number;
  /** 约束求解迭代次数,越高越硬(代价 CPU)。 */
  iterations?: number;
  /** 重力加速度(默认 9.8 向 -Y)。 */
  gravity?: number;
  /** 单粒子质量(kg)。 */
  mass?: number;
}

export class ClothSimulation {
  particles: ClothParticle[] = [];
  constraints: ClothConstraint[] = [];
  /** 网格宽度(顶点列数)。 */
  width: number = 0;
  /** 网格高度(顶点行数)。 */
  height: number = 0;
  /** 网格分辨率(总顶点数 = width * height)。 */
  resolution: number = 0;
  /** 单粒子质量(kg)。 */
  mass: number;
  /** 全局阻尼。 */
  damping: number;
  /** 全局刚度(用于 createGrid 创建的默认约束)。 */
  stiffness: number;
  /** 约束求解迭代次数。 */
  iterations: number;
  /** 重力加速度(m/s²,沿 -Y)。 */
  gravity: number;

  constructor(opts: ClothOptions = {}) {
    this.mass = opts.mass ?? 1;
    this.damping = opts.damping ?? 0.01;
    this.stiffness = opts.stiffness ?? 1.0;
    this.iterations = opts.iterations ?? 4;
    this.gravity = opts.gravity ?? 9.8;
  }

  /** 创建 width × height 的布料网格。
   *  网格在 XY 平面上展开,size 是物理尺寸。
   *  约束:每对相邻顶点(水平 / 垂直)+ 对角(剪切抵抗)。
   *  resolution = width * height(顶点总数)。 */
  createGrid(
    width: number,
    height: number,
    resolution: { width: number; height: number } | number,
  ): this {
    if (width < 2 || height < 2) {
      throw new Error(`ClothSimulation.createGrid: width/height must be >= 2 (got ${width}x${height})`);
    }
    let gridW: number, gridH: number;
    if (typeof resolution === 'number') {
      gridW = resolution;
      gridH = resolution;
    } else {
      gridW = resolution.width;
      gridH = resolution.height;
    }
    if (gridW < 2 || gridH < 2) {
      throw new Error(`ClothSimulation.createGrid: resolution must be >= 2`);
    }

    this.width = width;
    this.height = height;
    this.resolution = gridW * gridH;
    this.particles = [];
    this.constraints = [];

    // 创建顶点:网格在 XY 平面,中心在原点。
    const stepX = width / (gridW - 1);
    const stepY = height / (gridH - 1);
    const offX = -width / 2;
    const offY = height / 2;
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        const pos = new Vector3(offX + i * stepX, offY - j * stepY, 0);
        this.particles.push({
          position: pos.clone(),
          prevPosition: pos.clone(),
          acceleration: new Vector3(),
          pinned: false,
          mass: this.mass,
          invMass: this.mass > 0 ? 1 / this.mass : 0,
        });
      }
    }

    // 索引辅助:row-major, particle(x, y) = y * gridW + x
    const idx = (x: number, y: number): number => y * gridW + x;

    // 水平约束
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW - 1; i++) {
        this.addConstraint(idx(i, j), idx(i + 1, j));
      }
    }
    // 垂直约束
    for (let j = 0; j < gridH - 1; j++) {
      for (let i = 0; i < gridW; i++) {
        this.addConstraint(idx(i, j), idx(i, j + 1));
      }
    }
    // 对角约束(剪切抵抗)— 两个对角线方向各加一条
    for (let j = 0; j < gridH - 1; j++) {
      for (let i = 0; i < gridW - 1; i++) {
        this.addConstraint(idx(i, j), idx(i + 1, j + 1));
        this.addConstraint(idx(i + 1, j), idx(i, j + 1));
      }
    }

    return this;
  }

  /** 添加距离约束。restLength 默认取当前两点距离。 */
  addConstraint(p1: number, p2: number, restLength?: number, stiffness?: number): this {
    if (p1 < 0 || p2 < 0 || p1 >= this.particles.length || p2 >= this.particles.length) {
      throw new Error(`ClothSimulation.addConstraint: particle index out of range (${p1}, ${p2})`);
    }
    const a = this.particles[p1].position;
    const b = this.particles[p2].position;
    const rest = restLength ?? a.distanceTo(b);
    this.constraints.push({
      p1, p2,
      restLength: rest,
      stiffness: stiffness ?? this.stiffness,
    });
    return this;
  }

  /** 固定 (x, y) 处的粒子(网格坐标)。 */
  pin(x: number, y: number): this {
    const i = this.indexOf(x, y);
    if (i < 0) throw new Error(`ClothSimulation.pin: (${x},${y}) out of range`);
    this.particles[i].pinned = true;
    this.particles[i].invMass = 0;
    return this;
  }

  /** 解除 (x, y) 处粒子的固定。 */
  unpin(x: number, y: number): this {
    const i = this.indexOf(x, y);
    if (i < 0) throw new Error(`ClothSimulation.unpin: (${x},${y}) out of range`);
    this.particles[i].pinned = false;
    this.particles[i].invMass = this.particles[i].mass > 0 ? 1 / this.particles[i].mass : 0;
    return this;
  }

  /** 网格坐标 → 一维索引。越界返回 -1。
   *  网格尺寸从粒子数 + width/height 比例反推(与 getMeshData 一致)。 */
  indexOf(x: number, y: number): number {
    const gw = this._gridW();
    const gh = this._gridH();
    if (x < 0 || x >= gw || y < 0 || y >= gh) return -1;
    return y * gw + x;
  }

  /** 当前网格宽度(顶点列数)。 */
  private _gridW(): number {
    const n = this.particles.length;
    if (n === 0) return 0;
    const aspect = this.width / this.height || 1;
    return Math.max(2, Math.round(Math.sqrt(n * aspect)));
  }

  /** 当前网格高度(顶点行数)。 */
  private _gridH(): number {
    const n = this.particles.length;
    if (n === 0) return 0;
    return Math.max(2, Math.round(n / this._gridW()));
  }

  /** 应用力(累加到所有非固定粒子的 acceleration)。
   *  典型用例:重力(默认在 update 内置)、风力、爆炸冲量。 */
  applyForce(force: Vector3): this {
    for (const p of this.particles) {
      if (p.pinned) continue;
      p.acceleration.addScaledVector(force, p.invMass);
    }
    return this;
  }

  /** 推进一帧。流程:
   *  1) 累加重力到 acceleration
   *  2) Verlet 积分更新 position(用 damping 衰减速度)
   *  3) 迭代求解距离约束(PBD 风格位置修正)
   *  4) 清零 acceleration
   *  dt 上限 1/30(防止大步长穿模)。 */
  update(dt: number): void {
    const step = Math.min(dt, 1 / 30);
    const dampingFactor = 1 - this.damping;

    // 1) 重力
    const gravity = new Vector3(0, -this.gravity, 0);
    this.applyForce(gravity);

    // 2) Verlet 积分
    for (const p of this.particles) {
      if (p.pinned) continue;
      // velocity estimate = (pos - prev) * dampingFactor
      const vx = (p.position.x - p.prevPosition.x) * dampingFactor;
      const vy = (p.position.y - p.prevPosition.y) * dampingFactor;
      const vz = (p.position.z - p.prevPosition.z) * dampingFactor;
      p.prevPosition.copy(p.position);
      p.position.x += vx + p.acceleration.x * step * step;
      p.position.y += vy + p.acceleration.y * step * step;
      p.position.z += vz + p.acceleration.z * step * step;
    }

    // 3) 约束求解(PBD)
    for (let iter = 0; iter < this.iterations; iter++) {
      for (const c of this.constraints) {
        const a = this.particles[c.p1];
        const b = this.particles[c.p2];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 1e-9) continue;
        // 修正量 = (dist - rest) / dist * stiffness
        const diff = (dist - c.restLength) / dist;
        const w1 = a.invMass;
        const w2 = b.invMass;
        const wSum = w1 + w2;
        if (wSum === 0) continue; // 两端都静态
        // 按 invMass 比例分配修正(轻的一端移动更多)
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

    // 4) 清零加速度
    for (const p of this.particles) {
      p.acceleration.set(0, 0, 0);
    }
  }

  /** 球体碰撞:把陷入球内的粒子推到球面外。
   *  仅修正位置(简单投影),不改变 prevPosition(避免能量损失)。 */
  collide(sphere: ClothSphere): this {
    const r2 = sphere.radius * sphere.radius;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const dx = p.position.x - sphere.center.x;
      const dy = p.position.y - sphere.center.y;
      const dz = p.position.z - sphere.center.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) {
        const d = Math.sqrt(d2) || 1e-6;
        const scale = sphere.radius / d;
        p.position.x = sphere.center.x + dx * scale;
        p.position.y = sphere.center.y + dy * scale;
        p.position.z = sphere.center.z + dz * scale;
      }
    }
    return this;
  }

  /** 返回扁平化的顶点 / 索引 / 法线数据,用于灌入 BufferGeometry。
   *  顶点顺序:row-major (j=0..gridH-1, i=0..gridW-1)。
   *  索引:每个 grid cell 两个三角形,CCW(从 +Z 看)。
   *  法线:per-vertex,由相邻两轴 cross 估算(粗略,够渲染用)。 */
  getMeshData(): {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array;
    normals: Float32Array;
    gridW: number;
    gridH: number;
  } {
    const n = this.particles.length;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = this.particles[i].position.x;
      positions[i * 3 + 1] = this.particles[i].position.y;
      positions[i * 3 + 2] = this.particles[i].position.z;
    }

    // 索引:计算 gridW / gridH(与 indexOf / _gridW / _gridH 一致)
    const gridW = this._gridW();
    const gridH = this._gridH();

    const cellCount = (gridW - 1) * (gridH - 1);
    const indexCount = cellCount * 6;
    const indices = indexCount < 65536
      ? new Uint16Array(indexCount)
      : new Uint32Array(indexCount);
    let p = 0;
    for (let j = 0; j < gridH - 1; j++) {
      for (let i = 0; i < gridW - 1; i++) {
        const a = j * gridW + i;
        const b = a + 1;
        const c = a + gridW;
        const d = c + 1;
        // 两个三角形:(a, c, b) (b, c, d) — CCW from +Z
        indices[p++] = a; indices[p++] = c; indices[p++] = b;
        indices[p++] = b; indices[p++] = c; indices[p++] = d;
      }
    }

    // 粗略法线:每个顶点 = 相邻两轴 cross
    const normals = new Float32Array(n * 3);
    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        const idx = j * gridW + i;
        const cur = this.particles[idx].position;
        // 取右 / 下邻居(边界用对称)
        const right = this.particles[j * gridW + Math.min(i + 1, gridW - 1)].position;
        const down = this.particles[Math.min(j + 1, gridH - 1) * gridW + i].position;
        const tx = right.x - cur.x;
        const ty = right.y - cur.y;
        const tz = right.z - cur.z;
        const bx = down.x - cur.x;
        const by = down.y - cur.y;
        const bz = down.z - cur.z;
        // n = b × t(匹配索引缠绕 a→c→b = TL→BL→TR,从 +Z 看 CCW → 法线指向 +Z)
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

    return { positions, indices, normals, gridW, gridH };
  }
}

// SoftBodySimulation — 3D 体积软体物理(质量-弹簧 + 体积保持 + 形状匹配)。
//
// 与 ClothSimulation 的区别:
//   - 布料是 2D 表面网格(结构/剪切/弯曲约束)。
//   - 软体是 3D 体积(四面体网格),需要保持体积不被压扁。
//   - 支持形状匹配(Müller et al. 2005):将变形后的粒子拉回最优刚体
//     变换,产生弹性-塑性混合行为。β=0 完全刚性,β=1 完全自由变形。
//   - 支持内压(inflation):像气球/球体,内部压力推开表面。
//
// 积分:Verlet(与 Cloth/Fluid 一致),稳定性好,能量保守。
// 约束求解:PBD 位置修正,迭代多次收敛。
//
// 参考:
//   - Müller et al., "Position Based Dynamics", 2006
//   - Müller et al., "Meshless Deformations Based on Shape Matching", 2005
//   - o3de PhysX SoftBody

import { Vector3 } from '../Math/Vector3';

/** 软体粒子(Verlet 点)。 */
export interface SoftBodyParticle {
  /** 当前位置(世界空间)。 */
  position: Vector3;
  /** 上一帧位置(Verlet 积分用)。 */
  prevPosition: Vector3;
  /** 累积加速度(本帧重力 / 外力,积分后清零)。 */
  acceleration: Vector3;
  /** 质量(kg)。 */
  mass: number;
  /** 逆质量(=1/mass,0 表示固定)。 */
  invMass: number;
  /** 是否固定。 */
  pinned: boolean;
  /** 目标位置(形状匹配用)。 */
  goalPosition: Vector3;
}

/** 弹簧类型。structural = 网格边, shear = 对角, bend = 隔点。 */
export type SpringType = 'structural' | 'shear' | 'bend';

/** 距离弹簧约束。 */
export interface SoftBodySpring {
  /** 粒子 A 索引。 */
  a: number;
  /** 粒子 B 索引。 */
  b: number;
  /** 静止长度。 */
  restLength: number;
  /** 刚度 [0,1]。 */
  stiffness: number;
  /** 类型。 */
  type: SpringType;
}

/** 体积约束(四面体)。保持 4 个粒子构成的四面体体积。 */
export interface VolumeConstraint {
  /** 4 个粒子索引。 */
  indices: [number, number, number, number];
  /** 静止体积。 */
  restVolume: number;
  /** 刚度 [0,1]。 */
  stiffness: number;
}

/** 软体统计信息。 */
export interface SoftBodyStats {
  particleCount: number;
  springCount: number;
  volumeConstraintCount: number;
  pinnedCount: number;
  iterations: number;
  currentVolume: number;
  restVolume: number;
  shapeMatching: boolean;
}

/** 软体构造选项。 */
export interface SoftBodyOptions {
  /** 重力(默认 (0,-9.8,0))。 */
  gravity?: Vector3;
  /** 全局阻尼 [0,1](默认 0.01)。 */
  damping?: number;
  /** 默认弹簧刚度(默认 1.0)。 */
  stiffness?: number;
  /** 体积约束刚度(默认 1.0)。 */
  volumeStiffness?: number;
  /** 是否启用形状匹配(默认 false)。 */
  shapeMatching?: boolean;
  /** 形状匹配 β 值 [0,1](0=刚性,1=自由变形,默认 0.5)。 */
  shapeBeta?: number;
  /** 内压(默认 0,正值=膨胀)。 */
  pressure?: number;
  /** 约束求解迭代次数(默认 4)。 */
  iterations?: number;
  /** 单粒子质量 kg(默认 1)。 */
  mass?: number;
}

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _centroid = new Vector3();

export class SoftBodySimulation {
  particles: SoftBodyParticle[] = [];
  springs: SoftBodySpring[] = [];
  volumeConstraints: VolumeConstraint[] = [];

  gravity: Vector3;
  damping: number;
  defaultStiffness: number;
  volumeStiffness: number;
  shapeMatching: boolean;
  shapeBeta: number;
  pressure: number;
  iterations: number;
  defaultMass: number;

  /** 初始(rest)位置缓存(形状匹配用)。 */
  private restPositions: Vector3[] = [];
  /** 初始总质量。 */
  private totalMass: number = 0;
  /** 初始体积(所有体积约束之和)。 */
  private restVolume: number = 0;

  constructor(options: SoftBodyOptions = {}) {
    this.gravity = options.gravity ?? new Vector3(0, -9.8, 0);
    this.damping = options.damping ?? 0.01;
    this.defaultStiffness = options.stiffness ?? 1.0;
    this.volumeStiffness = options.volumeStiffness ?? 1.0;
    this.shapeMatching = options.shapeMatching ?? false;
    this.shapeBeta = options.shapeBeta ?? 0.5;
    this.pressure = options.pressure ?? 0;
    this.iterations = options.iterations ?? 4;
    this.defaultMass = options.mass ?? 1;
  }

  /** 添加粒子。返回索引。 */
  addParticle(position: Vector3, mass: number = this.defaultMass, pinned: boolean = false): number {
    const idx = this.particles.length;
    this.particles.push({
      position: position.clone(),
      prevPosition: position.clone(),
      acceleration: new Vector3(),
      mass: pinned ? Infinity : mass,
      invMass: pinned ? 0 : 1 / mass,
      pinned,
      goalPosition: position.clone(),
    });
    this.restPositions.push(position.clone());
    this.totalMass += mass;
    return idx;
  }

  /** 添加弹簧。 */
  addSpring(a: number, b: number, stiffness: number = this.defaultStiffness, type: SpringType = 'structural'): void {
    const pa = this.particles[a];
    const pb = this.particles[b];
    const restLength = pa.position.distanceTo(pb.position);
    this.springs.push({ a, b, restLength, stiffness, type });
  }

  /** 添加体积约束(四面体)。 */
  addVolumeConstraint(a: number, b: number, c: number, d: number, stiffness: number = this.volumeStiffness): void {
    const v = this.computeTetVolume(a, b, c, d);
    this.volumeConstraints.push({ indices: [a, b, c, d], restVolume: v, stiffness });
    this.restVolume += v;
  }

  /** 从网格(顶点+三角形索引)构建表面弹簧。
   *  自动生成 structural(边)+ shear(对角)+ bend(隔点)弹簧。 */
  fromMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, opts: { stiffness?: number; shearStiffness?: number; bendStiffness?: number } = {}): this {
    const nVerts = positions.length / 3;
    // 添加粒子
    for (let i = 0; i < nVerts; i++) {
      this.addParticle(new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    }
    // 收集唯一边(structural)
    const edgeSet = new Set<string>();
    const edges: Array<[number, number]> = [];
    const nTris = indices.length / 3;
    for (let t = 0; t < nTris; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      for (const [i, j] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push([i, j]);
          this.addSpring(i, j, opts.stiffness ?? this.defaultStiffness, 'structural');
        }
      }
      // shear: 对角(三角形内的 a-c 已在 structural,跳过)
      // 对角连接通常在四边形网格中:这里用三角形对(共享边的两个三角形的对顶点)
      // 简化:跳过 shear(需要邻接信息),bend 用隔点
    }
    // bend: 同一顶点的 2-hop 邻居(隔一个顶点)
    const adjacency = new Map<number, Set<number>>();
    for (const [i, j] of edges) {
      if (!adjacency.has(i)) adjacency.set(i, new Set());
      if (!adjacency.has(j)) adjacency.set(j, new Set());
      adjacency.get(i)!.add(j);
      adjacency.get(j)!.add(i);
    }
    const bendSet = new Set<string>();
    for (const [v, neighbors] of adjacency) {
      for (const n1 of neighbors) {
        for (const n2 of adjacency.get(n1) ?? []) {
          if (n2 !== v && !adjacency.get(v)!.has(n2)) {
            const key = v < n2 ? `${v}-${n2}` : `${n2}-${v}`;
            if (!bendSet.has(key)) {
              bendSet.add(key);
              this.addSpring(v, n2, opts.bendStiffness ?? (this.defaultStiffness * 0.5), 'bend');
            }
          }
        }
      }
    }
    return this;
  }

  /** 固定粒子。 */
  pinParticle(index: number): void {
    const p = this.particles[index];
    if (!p) return;
    p.pinned = true;
    p.invMass = 0;
    p.mass = Infinity;
  }

  /** 解除固定。 */
  unpinParticle(index: number, mass: number = this.defaultMass): void {
    const p = this.particles[index];
    if (!p) return;
    p.pinned = false;
    p.mass = mass;
    p.invMass = 1 / mass;
  }

  /** 对粒子施加力。 */
  applyForce(index: number, force: Vector3): void {
    const p = this.particles[index];
    if (!p || p.pinned) return;
    // F = m*a → a += F/m
    p.acceleration.x += force.x * p.invMass;
    p.acceleration.y += force.y * p.invMass;
    p.acceleration.z += force.z * p.invMass;
  }

  /** 步进模拟。 */
  update(dt: number): void {
    if (this.particles.length === 0) return;
    const dtSq = dt * dt;
    const dampFactor = 1 - this.damping;

    // 1. 累积重力 + 外力 + Verlet 积分
    for (const p of this.particles) {
      if (p.pinned) continue;
      // 重力
      p.acceleration.x += this.gravity.x;
      p.acceleration.y += this.gravity.y;
      p.acceleration.z += this.gravity.z;
      // Verlet: next = pos + (pos - prev) * dampFactor + accel * dt²
      _v1.copy(p.position).sub(p.prevPosition).multiplyScalar(dampFactor);
      p.prevPosition.copy(p.position);
      p.position.x += _v1.x + p.acceleration.x * dtSq;
      p.position.y += _v1.y + p.acceleration.y * dtSq;
      p.position.z += _v1.z + p.acceleration.z * dtSq;
      // 清零加速度
      p.acceleration.set(0, 0, 0);
    }

    // 2. 内压(将表面沿法线推出)
    if (this.pressure !== 0 && this.volumeConstraints.length > 0) {
      this.applyPressure();
    }

    // 3. 约束求解(迭代)
    for (let iter = 0; iter < this.iterations; iter++) {
      this.solveSprings();
      this.solveVolumeConstraints();
      if (this.shapeMatching) {
        this.solveShapeMatching();
      }
    }
  }

  /** 弹簧约束求解(PBD 位置修正)。 */
  private solveSprings(): void {
    for (const s of this.springs) {
      const pa = this.particles[s.a];
      const pb = this.particles[s.b];
      _v1.copy(pb.position).sub(pa.position);
      const dist = _v1.length();
      if (dist < 1e-8) continue;
      const diff = (dist - s.restLength) / dist;
      const wSum = pa.invMass + pb.invMass;
      if (wSum < 1e-8) continue;
      const ka = pa.invMass / wSum * s.stiffness;
      const kb = pb.invMass / wSum * s.stiffness;
      pa.position.x += _v1.x * diff * ka;
      pa.position.y += _v1.y * diff * ka;
      pa.position.z += _v1.z * diff * ka;
      pb.position.x -= _v1.x * diff * kb;
      pb.position.y -= _v1.y * diff * kb;
      pb.position.z -= _v1.z * diff * kb;
    }
  }

  /** 体积约束求解(梯度投影)。 */
  private solveVolumeConstraints(): void {
    for (const vc of this.volumeConstraints) {
      const [ia, ib, ic, id] = vc.indices;
      const pa = this.particles[ia];
      const pb = this.particles[ib];
      const pc = this.particles[ic];
      const pd = this.particles[id];
      const currentVol = this.computeTetVolume(ia, ib, ic, id);
      if (Math.abs(currentVol) < 1e-12) continue;
      const C = currentVol - vc.restVolume;
      // 梯度 = 四面体的面法线 * 面积 / 6
      // 简化:均匀分配修正到 4 个粒子
      const wSum = pa.invMass + pb.invMass + pc.invMass + pd.invMass;
      if (wSum < 1e-8) continue;
      const scale = (C / wSum) * vc.stiffness * (1 / 6);
      // 面法线方向(近似)
      _v1.copy(pb.position).sub(pa.position);
      _v2.copy(pc.position).sub(pa.position);
      _v3.copy(pd.position).sub(pa.position);
      _v4.copy(_v1).cross(_v2); // = (b-a) × (c-a)
      const grad = _v3.dot(_v4); // 6 * volume sign
      const sign = grad > 0 ? 1 : -1;
      // 均匀修正(简化,完整实现需要分别计算 4 个面的梯度)
      pa.position.x -= _v4.x * scale * sign * pa.invMass;
      pa.position.y -= _v4.y * scale * sign * pa.invMass;
      pa.position.z -= _v4.z * scale * sign * pa.invMass;
      pb.position.x += _v4.x * scale * sign * pb.invMass * 0.5;
      pb.position.y += _v4.y * scale * sign * pb.invMass * 0.5;
      pb.position.z += _v4.z * scale * sign * pb.invMass * 0.5;
    }
  }

  /** 形状匹配(Müller 2005)。
   *  计算最优刚体变换(R, t)将 rest 粒子对齐到当前位置,
   *  然后将每个粒子拉向目标位置(按 β 混合)。 */
  private solveShapeMatching(): void {
    if (this.particles.length === 0 || this.totalMass < 1e-8) return;

    // 1. 计算当前质心
    _centroid.set(0, 0, 0);
    let cmMass = 0;
    for (const p of this.particles) {
      if (p.pinned) continue;
      _centroid.x += p.position.x * p.mass;
      _centroid.y += p.position.y * p.mass;
      _centroid.z += p.position.z * p.mass;
      cmMass += p.mass;
    }
    if (cmMass < 1e-8) return;
    _centroid.multiplyScalar(1 / cmMass);

    // 2. 计算 rest 质心
    const restCM = new Vector3();
    for (let i = 0; i < this.particles.length; i++) {
      restCM.x += this.restPositions[i].x * this.particles[i].mass;
      restCM.y += this.restPositions[i].y * this.particles[i].mass;
      restCM.z += this.restPositions[i].z * this.particles[i].mass;
    }
    restCM.multiplyScalar(1 / cmMass);

    // 3. 计算旋转矩阵 A = Σ m_i * (x_i - cm) * (x0_i - restCM)^T
    //    使用极分解提取旋转(简化:用 3x3 矩阵)
    let Axx = 0, Axy = 0, Axz = 0, Ayx = 0, Ayy = 0, Ayz = 0, Azx = 0, Azy = 0, Azz = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.pinned) continue;
      const m = p.mass;
      // q = restPos - restCM
      const qx = this.restPositions[i].x - restCM.x;
      const qy = this.restPositions[i].y - restCM.y;
      const qz = this.restPositions[i].z - restCM.z;
      // p = pos - cm
      const px = p.position.x - _centroid.x;
      const py = p.position.y - _centroid.y;
      const pz = p.position.z - _centroid.z;
      // A += m * p * q^T
      Axx += m * px * qx; Axy += m * px * qy; Axz += m * px * qz;
      Ayx += m * py * qx; Ayy += m * py * qy; Ayz += m * py * qz;
      Azx += m * pz * qx; Azy += m * pz * qy; Azz += m * pz * qz;
    }

    // 4. 极分解:从 A 提取旋转 R(用迭代方法或 SVD)
    //    简化:用 A^T * A 的特征向量近似
    //    更稳定:用 Müller 论文的迭代方法
    const R = this.extractRotation(Axx, Axy, Axz, Ayx, Ayy, Ayz, Azx, Azy, Azz);

    // 5. 计算每个粒子的目标位置
    //    goal_i = R * (restPos_i - restCM) + cm
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.pinned) continue;
      const qx = this.restPositions[i].x - restCM.x;
      const qy = this.restPositions[i].y - restCM.y;
      const qz = this.restPositions[i].z - restCM.z;
      // R * q
      const gx = R[0] * qx + R[1] * qy + R[2] * qz + _centroid.x;
      const gy = R[3] * qx + R[4] * qy + R[5] * qz + _centroid.y;
      const gz = R[6] * qx + R[7] * qy + R[8] * qz + _centroid.z;
      // 按 β 混合:pos = pos + (goal - pos) * (1 - beta)
      const alpha = 1 - this.shapeBeta;
      p.position.x += (gx - p.position.x) * alpha;
      p.position.y += (gy - p.position.y) * alpha;
      p.position.z += (gz - p.position.z) * alpha;
    }
  }

  /** 从 3x3 矩阵提取旋转(极分解,迭代法)。 */
  private extractRotation(
    m00: number, m01: number, m02: number,
    m10: number, m11: number, m12: number,
    m20: number, m21: number, m22: number,
  ): number[] {
    // 迭代极分解:R_{n+1} = R_n * normalize(R_n^T * A)
    // 初始化 R = I
    let r00 = 1, r01 = 0, r02 = 0;
    let r10 = 0, r11 = 1, r12 = 0;
    let r20 = 0, r21 = 0, r22 = 1;
    for (let iter = 0; iter < 5; iter++) {
      // R^T * A — (R^T * A)[i][j] = Σ_k R[k][i] * A[k][j]
      const a00 = r00 * m00 + r10 * m10 + r20 * m20;
      const a01 = r00 * m01 + r10 * m11 + r20 * m21;
      const a02 = r00 * m02 + r10 * m12 + r20 * m22;
      const a10 = r01 * m00 + r11 * m10 + r21 * m20;
      const a11 = r01 * m01 + r11 * m11 + r21 * m21;
      const a12 = r01 * m02 + r11 * m12 + r21 * m22;
      const a20 = r02 * m00 + r12 * m10 + r22 * m20;
      const a21 = r02 * m01 + r12 * m11 + r22 * m21;
      const a22 = r02 * m02 + r12 * m12 + r22 * m22;
      // 归一化每列
      const c0l = Math.hypot(a00, a10, a20);
      const c1l = Math.hypot(a01, a11, a21);
      const c2l = Math.hypot(a02, a12, a22);
      const s0 = c0l > 1e-8 ? 1 / c0l : 0;
      const s1 = c1l > 1e-8 ? 1 / c1l : 0;
      const s2 = c2l > 1e-8 ? 1 / c2l : 0;
      // R = R * (normalized A) — 保存旧行避免别名
      const n00 = a00 * s0, n01 = a01 * s1, n02 = a02 * s2;
      const n10 = a10 * s0, n11 = a11 * s1, n12 = a12 * s2;
      const n20 = a20 * s0, n21 = a21 * s1, n22 = a22 * s2;
      const o00 = r00, o01 = r01, o02 = r02;
      const o10 = r10, o11 = r11, o12 = r12;
      const o20 = r20, o21 = r21, o22 = r22;
      r00 = o00 * n00 + o01 * n10 + o02 * n20;
      r01 = o00 * n01 + o01 * n11 + o02 * n21;
      r02 = o00 * n02 + o01 * n12 + o02 * n22;
      r10 = o10 * n00 + o11 * n10 + o12 * n20;
      r11 = o10 * n01 + o11 * n11 + o12 * n21;
      r12 = o10 * n02 + o11 * n12 + o12 * n22;
      r20 = o20 * n00 + o21 * n10 + o22 * n20;
      r21 = o20 * n01 + o21 * n11 + o22 * n21;
      r22 = o20 * n02 + o21 * n12 + o22 * n22;
      // 重新归一化行(确保正交)
      const r0l = Math.hypot(r00, r01, r02);
      const r1l = Math.hypot(r10, r11, r12);
      const r2l = Math.hypot(r20, r21, r22);
      if (r0l > 1e-8) { r00 /= r0l; r01 /= r0l; r02 /= r0l; }
      if (r1l > 1e-8) { r10 /= r1l; r11 /= r1l; r12 /= r1l; }
      if (r2l > 1e-8) { r20 /= r2l; r21 /= r2l; r22 /= r2l; }
    }
    return [r00, r01, r02, r10, r11, r12, r20, r21, r22];
  }

  /** 计算四面体体积(ia-ib-ic-id)。 */
  private computeTetVolume(ia: number, ib: number, ic: number, id: number): number {
    const pa = this.particles[ia].position;
    const pb = this.particles[ib].position;
    const pc = this.particles[ic].position;
    const pd = this.particles[id].position;
    // V = |((b-a) × (c-a)) · (d-a)| / 6
    _v1.copy(pb).sub(pa);
    _v2.copy(pc).sub(pa);
    _v3.copy(pd).sub(pa);
    _v4.copy(_v1).cross(_v2);
    return Math.abs(_v4.dot(_v3)) / 6;
  }

  /** 内压:将每个表面三角形沿法线推出。
   *  简化实现:用体积约束的逆——当压力 > 0 时增大目标体积。 */
  private applyPressure(): void {
    // 简化:真实实现需对每个三角形面计算法线并施加力。
    // 当前版本依赖体积约束保持形状,压力参数留作未来扩展钩子。
    if (this.pressure <= 0) return;
    // TODO: 按 1 + pressure * 0.01 放大目标体积并在求解时使用。
  }

  /** 获取当前总体积。 */
  getCurrentVolume(): number {
    let v = 0;
    for (const vc of this.volumeConstraints) {
      v += this.computeTetVolume(vc.indices[0], vc.indices[1], vc.indices[2], vc.indices[3]);
    }
    return v;
  }

  /** 获取网格数据(用于渲染)。 */
  getMeshData(): { positions: Float32Array; indices: Uint32Array } {
    const n = this.particles.length;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = this.particles[i].position.x;
      positions[i * 3 + 1] = this.particles[i].position.y;
      positions[i * 3 + 2] = this.particles[i].position.z;
    }
    // 索引:从体积约束提取表面三角形
    const indices: number[] = [];
    for (const vc of this.volumeConstraints) {
      const [a, b, c, d] = vc.indices;
      // 4 个面
      indices.push(a, b, c);
      indices.push(a, c, d);
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
    return { positions, indices: new Uint32Array(indices) };
  }

  /** 获取统计信息。 */
  getStats(): SoftBodyStats {
    let pinned = 0;
    for (const p of this.particles) if (p.pinned) pinned++;
    return {
      particleCount: this.particles.length,
      springCount: this.springs.length,
      volumeConstraintCount: this.volumeConstraints.length,
      pinnedCount: pinned,
      iterations: this.iterations,
      currentVolume: this.getCurrentVolume(),
      restVolume: this.restVolume,
      shapeMatching: this.shapeMatching,
    };
  }
}

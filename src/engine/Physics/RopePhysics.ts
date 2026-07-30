// RopePhysics — Verlet 链绳索物理(距离约束 + 弯曲约束 + 风力 + 碰撞)。
//
// 设计:
//   - 段数组(segments):每段存当前 position + 上一帧 prevPosition + 累积 acceleration。
//     segments[i] 是绳索第 i 个节点(Verlet 点),segmentCount = segments.length。
//     相邻节点间用距离约束保持 segmentLength(PBD 风格位置修正,迭代收敛)。
//   - 弯曲约束:对每三个连续节点 (a, b, c),限制转向角 turn ≤ maxBendAngle。
//     turn = angle(d1, d2),d1 = b-a(入向),d2 = c-b(出向)。
//     0 = 直线,π = 折回。超出时把 d2 绕平面法线旋转向 d1 收紧。
//   - 固定段(pinnedSegments):不参与积分,位置保持不变(挂点);可指定固定位置。
//   - 风力(wind):作为连续加速度累加到非固定段。
//   - 碰撞:collideWithSphere 把穿透段推到球面外。
//
// 与引擎的集成:
//   - update(dt) 内部完成:重力 → 风力 → Verlet 积分 → 距离约束 → 弯曲约束。
//     collideWithSphere 由调用方按需在 update 后调用。
//   - getPoints() 返回节点位置数组(共享 Vector3 引用,供渲染管线取点)。
//   - 与 ClothSimulation 互补:布料是 2D 网格 soft body,绳索是 1D 链 soft body。
//   - 与 ECS PhysicsSystems(刚体)解耦,独立实现。

import { Vector3 } from '../Math/Vector3';

/** 绳索段(Verlet 点)。 */
export interface RopeSegment {
  /** 当前位置(世界空间)。 */
  position: Vector3;
  /** 上一帧位置(Verlet 积分用)。 */
  prevPosition: Vector3;
  /** 累积加速度(积分后清零)。 */
  acceleration: Vector3;
}

/** RopePhysics 构造选项。 */
export interface RopeOptions {
  /** 重力加速度(默认 (0,-9.8,0))。 */
  gravity?: Vector3;
  /** 风力加速度(默认 (0,0,0))。 */
  wind?: Vector3;
  /** 全局阻尼 [0,1](默认 0.01)。 */
  damping?: number;
  /** 距离约束刚度 [0,1](默认 1.0)。 */
  stiffness?: number;
  /** 求解迭代次数(默认 4)。 */
  iterations?: number;
  /** 绳索粗细(默认 0.05,供渲染 / 碰撞用)。 */
  thickness?: number;
  /** 最大弯曲角度(弧度,默认 π = 不限制)。 */
  maxBendAngle?: number;
}

/** RopePhysics.getStats() 返回的统计信息。 */
export interface RopeStats {
  segmentCount: number;
  segmentLength: number;
  length: number;
  pinnedCount: number;
  iterations: number;
  maxBendAngle: number;
  thickness: number;
}

const EPS = 1e-9;

export class RopePhysics {
  segments: RopeSegment[] = [];
  /** 相邻节点间的静止长度。 */
  segmentLength: number = 0;
  /** 节点数(= segments.length)。 */
  segmentCount: number = 0;
  /** 重力加速度。 */
  gravity: Vector3;
  /** 风力加速度。 */
  wind: Vector3;
  /** 全局阻尼。 */
  damping: number;
  /** 距离约束刚度。 */
  stiffness: number;
  /** 求解迭代次数。 */
  iterations: number;
  /** 绳索粗细(供渲染 / 碰撞)。 */
  thickness: number;
  /** 最大弯曲角度(弧度);π = 不限制。 */
  maxBendAngle: number;

  /** 固定段索引集合。 */
  private _pinnedSegments: Set<number> = new Set();
  /** 固定段的可选目标位置(未设置则保持当前位置不变)。 */
  private _pinnedPositions: Map<number, Vector3> = new Map();

  constructor(opts: RopeOptions = {}) {
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -9.8, 0);
    this.wind = opts.wind ? opts.wind.clone() : new Vector3();
    this.damping = opts.damping ?? 0.01;
    this.stiffness = opts.stiffness ?? 1.0;
    this.iterations = opts.iterations ?? 4;
    this.thickness = opts.thickness ?? 0.05;
    this.maxBendAngle = opts.maxBendAngle ?? Math.PI;
  }

  /** 起点是否固定。 */
  get startPin(): boolean {
    return this.segmentCount > 0 && this._pinnedSegments.has(0);
  }

  /** 终点是否固定。 */
  get endPin(): boolean {
    return this.segmentCount > 0 && this._pinnedSegments.has(this.segmentCount - 1);
  }

  /** 创建绳索:在 start 到 end 之间均匀分布 segmentCount 个节点。
   *  segmentLength = distance(start, end) / (segmentCount - 1)。 */
  create(start: Vector3, end: Vector3, segmentCount: number): this {
    if (segmentCount < 2) {
      throw new Error(`RopePhysics.create: segmentCount must be >= 2 (got ${segmentCount})`);
    }
    this.segmentCount = segmentCount;
    this.segmentLength = start.distanceTo(end) / (segmentCount - 1);
    this.segments = [];
    this._pinnedSegments.clear();
    this._pinnedPositions.clear();
    for (let i = 0; i < segmentCount; i++) {
      const t = i / (segmentCount - 1);
      const pos = new Vector3(
        start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t,
        start.z + (end.z - start.z) * t,
      );
      this.segments.push({
        position: pos.clone(),
        prevPosition: pos.clone(),
        acceleration: new Vector3(),
      });
    }
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

  /** 设置距离约束刚度。 */
  setStiffness(stiffness: number): this {
    this.stiffness = stiffness;
    return this;
  }

  /** 设置求解迭代次数。 */
  setIterations(iterations: number): this {
    this.iterations = iterations;
    return this;
  }

  /** 设置绳索粗细。 */
  setThickness(thickness: number): this {
    this.thickness = thickness;
    return this;
  }

  /** 设置最大弯曲角度(弧度)。 */
  setMaxBendAngle(angle: number): this {
    this.maxBendAngle = angle;
    return this;
  }

  /** 固定 / 解除固定起点。 */
  pinStart(enabled: boolean): this {
    if (this.segmentCount === 0) return this;
    if (enabled) this._pinnedSegments.add(0);
    else {
      this._pinnedSegments.delete(0);
      this._pinnedPositions.delete(0);
    }
    return this;
  }

  /** 固定 / 解除固定终点。 */
  pinEnd(enabled: boolean): this {
    if (this.segmentCount === 0) return this;
    const last = this.segmentCount - 1;
    if (enabled) this._pinnedSegments.add(last);
    else {
      this._pinnedSegments.delete(last);
      this._pinnedPositions.delete(last);
    }
    return this;
  }

  /** 固定指定段。position 可选:若提供,每帧把该段拉到 position(挂点跟随)。 */
  pinSegment(index: number, position?: Vector3): this {
    if (index < 0 || index >= this.segmentCount) {
      throw new Error(`RopePhysics.pinSegment: index out of range (${index})`);
    }
    this._pinnedSegments.add(index);
    if (position) {
      this._pinnedPositions.set(index, position.clone());
      this.segments[index].position.copy(position);
      this.segments[index].prevPosition.copy(position);
    } else {
      this._pinnedPositions.delete(index);
    }
    return this;
  }

  /** 解除固定指定段。 */
  unpinSegment(index: number): this {
    if (index < 0 || index >= this.segmentCount) {
      throw new Error(`RopePhysics.unpinSegment: index out of range (${index})`);
    }
    this._pinnedSegments.delete(index);
    this._pinnedPositions.delete(index);
    return this;
  }

  /** 段是否固定。 */
  isPinned(index: number): boolean {
    return this._pinnedSegments.has(index);
  }

  /** 推进一帧。流程:
   *   1) 把固定段拉到目标位置(若有)
   *   2) 累加重力到 acceleration
   *   3) applyWind(dt) 累加风力
   *   4) verletIntegrate(dt) Verlet 积分(并清零 acceleration)
   *   5) solveDistanceConstraints() 距离约束
   *   6) solveBendConstraints() 弯曲约束
   *   dt 上限 1/30。 */
  update(dt: number): void {
    const step = Math.min(dt, 1 / 30);

    // 1) 固定段归位
    this._applyPinnedPositions();

    // 2) 重力
    for (let i = 0; i < this.segmentCount; i++) {
      if (this._pinnedSegments.has(i)) continue;
      this.segments[i].acceleration.add(this.gravity);
    }

    // 3) 风力
    this.applyWind(step);

    // 4) Verlet 积分
    this.verletIntegrate(step);

    // 5) 距离约束
    this.solveDistanceConstraints();

    // 6) 弯曲约束
    this.solveBendConstraints();
  }

  /** 把有目标位置的固定段拉回目标位置。 */
  private _applyPinnedPositions(): void {
    for (const [i, pos] of this._pinnedPositions) {
      if (i < this.segmentCount) {
        this.segments[i].position.copy(pos);
        this.segments[i].prevPosition.copy(pos);
      }
    }
  }

  /** Verlet 积分。消耗 acceleration 并清零。固定段跳过。 */
  verletIntegrate(dt: number): void {
    const dampingFactor = 1 - this.damping;
    const dt2 = dt * dt;
    for (let i = 0; i < this.segmentCount; i++) {
      const s = this.segments[i];
      if (this._pinnedSegments.has(i)) {
        s.acceleration.set(0, 0, 0);
        continue;
      }
      const vx = (s.position.x - s.prevPosition.x) * dampingFactor;
      const vy = (s.position.y - s.prevPosition.y) * dampingFactor;
      const vz = (s.position.z - s.prevPosition.z) * dampingFactor;
      s.prevPosition.copy(s.position);
      s.position.x += vx + s.acceleration.x * dt2;
      s.position.y += vy + s.acceleration.y * dt2;
      s.position.z += vz + s.acceleration.z * dt2;
      s.acceleration.set(0, 0, 0);
    }
  }

  /** 距离约束求解(PBD 风格)。迭代 this.iterations 次,保持相邻节点间距 = segmentLength。 */
  solveDistanceConstraints(): void {
    const rest = this.segmentLength;
    for (let iter = 0; iter < this.iterations; iter++) {
      for (let i = 0; i < this.segmentCount - 1; i++) {
        const a = this.segments[i];
        const b = this.segments[i + 1];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < EPS) continue;
        const aPin = this._pinnedSegments.has(i);
        const bPin = this._pinnedSegments.has(i + 1);
        const w1 = aPin ? 0 : 1;
        const w2 = bPin ? 0 : 1;
        const wSum = w1 + w2;
        if (wSum === 0) continue;
        const diff = (dist - rest) / dist;
        const k = this.stiffness * diff;
        const r1 = (w1 / wSum) * k;
        const r2 = (w2 / wSum) * k;
        if (!aPin) {
          a.position.x += dx * r1;
          a.position.y += dy * r1;
          a.position.z += dz * r1;
        }
        if (!bPin) {
          b.position.x -= dx * r2;
          b.position.y -= dy * r2;
          b.position.z -= dz * r2;
        }
      }
    }
  }

  /** 弯曲约束求解:对每三个连续节点 (a, b, c),若转向角 > maxBendAngle,
   *  把出向段绕平面法线旋转向入向段,使转向角收敛到 maxBendAngle。
   *  迭代 this.iterations 次。maxBendAngle >= π 时为无限制(跳过)。 */
  solveBendConstraints(): void {
    if (this.maxBendAngle >= Math.PI - EPS) return;
    for (let iter = 0; iter < this.iterations; iter++) {
      for (let i = 1; i < this.segmentCount - 1; i++) {
        const a = this.segments[i - 1];
        const b = this.segments[i];
        const c = this.segments[i + 1];
        const aPin = this._pinnedSegments.has(i - 1);
        const bPin = this._pinnedSegments.has(i);
        const cPin = this._pinnedSegments.has(i + 1);

        const d1x = b.position.x - a.position.x;
        const d1y = b.position.y - a.position.y;
        const d1z = b.position.z - a.position.z;
        const d2x = c.position.x - b.position.x;
        const d2y = c.position.y - b.position.y;
        const d2z = c.position.z - b.position.z;
        const len1 = Math.sqrt(d1x * d1x + d1y * d1y + d1z * d1z);
        const len2 = Math.sqrt(d2x * d2x + d2y * d2y + d2z * d2z);
        if (len1 < EPS || len2 < EPS) continue;

        let cosT = (d1x * d2x + d1y * d2y + d1z * d2z) / (len1 * len2);
        if (cosT > 1) cosT = 1;
        else if (cosT < -1) cosT = -1;
        const turn = Math.acos(cosT);
        if (turn <= this.maxBendAngle) continue;

        // 平面法线 n = d1 × d2
        let nx = d1y * d2z - d1z * d2y;
        let ny = d1z * d2x - d1x * d2z;
        let nz = d1x * d2y - d1y * d2x;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nLen < EPS) continue; // 共线,无法定义旋转平面
        nx /= nLen; ny /= nLen; nz /= nLen;

        // 把 d2 旋转向 d1:绕 n 旋转 -(turn - maxBendAngle)
        const delta = -(turn - this.maxBendAngle);
        const cosD = Math.cos(delta);
        const sinD = Math.sin(delta);
        // Rodrigues: v' = v*cosD + (n × v)*sinD + n*(n·v)*(1-cosD)
        const d2dotN = nx * d2x + ny * d2y + nz * d2z;
        const crossX = ny * d2z - nz * d2y;
        const crossY = nz * d2x - nx * d2z;
        const crossZ = nx * d2y - ny * d2x;
        const newD2x = d2x * cosD + crossX * sinD + nx * d2dotN * (1 - cosD);
        const newD2y = d2y * cosD + crossY * sinD + ny * d2dotN * (1 - cosD);
        const newD2z = d2z * cosD + crossZ * sinD + nz * d2dotN * (1 - cosD);

        if (!cPin) {
          // 移动 c:b + newD2
          c.position.x = b.position.x + newD2x;
          c.position.y = b.position.y + newD2y;
          c.position.z = b.position.z + newD2z;
        } else if (!aPin) {
          // c 固定,反向旋转 d1 移动 a:b - rotatedD1(绕 n 旋转 +delta)
          const cosD2 = Math.cos(-delta);
          const sinD2 = Math.sin(-delta);
          const d1dotN = nx * d1x + ny * d1y + nz * d1z;
          const cross2X = ny * d1z - nz * d1y;
          const cross2Y = nz * d1x - nx * d1z;
          const cross2Z = nx * d1y - ny * d1x;
          const newD1x = d1x * cosD2 + cross2X * sinD2 + nx * d1dotN * (1 - cosD2);
          const newD1y = d1y * cosD2 + cross2Y * sinD2 + ny * d1dotN * (1 - cosD2);
          const newD1z = d1z * cosD2 + cross2Z * sinD2 + nz * d1dotN * (1 - cosD2);
          a.position.x = b.position.x - newD1x;
          a.position.y = b.position.y - newD1y;
          a.position.z = b.position.z - newD1z;
        } else if (!bPin) {
          // a / c 都固定,把 b 向 a-c 直线投影(减少弯折)
          const acx = c.position.x - a.position.x;
          const acy = c.position.y - a.position.y;
          const acz = c.position.z - a.position.z;
          const abx = b.position.x - a.position.x;
          const aby = b.position.y - a.position.y;
          const abz = b.position.z - a.position.z;
          const acLen2 = acx * acx + acy * acy + acz * acz;
          if (acLen2 > EPS) {
            const t = (abx * acx + aby * acy + abz * acz) / acLen2;
            b.position.x = a.position.x + acx * t;
            b.position.y = a.position.y + acy * t;
            b.position.z = a.position.z + acz * t;
          }
        }
        // 三段都固定则跳过
      }
    }
  }

  /** 应用风力(作为连续加速度累加到非固定段)。
   *  dt 保留用于未来时变湍流;当前实现把 wind 视为单位质量加速度直接累加。 */
  applyWind(dt: number): void {
    void dt;
    if (this.wind.lengthSq() === 0) return;
    for (let i = 0; i < this.segmentCount; i++) {
      if (this._pinnedSegments.has(i)) continue;
      this.segments[i].acceleration.add(this.wind);
    }
  }

  /** 与球碰撞:把陷入球内的段推到球面外(考虑 thickness 膨胀)。
   *  段恰在球心时沿 +Y 推出。 */
  collideWithSphere(center: Vector3, radius: number): this {
    const effR = radius + this.thickness;
    const r2 = effR * effR;
    for (let i = 0; i < this.segmentCount; i++) {
      if (this._pinnedSegments.has(i)) continue;
      const p = this.segments[i].position;
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) {
        if (d2 < 1e-12) {
          // 段在球心,方向未定义,沿 +Y 推出
          p.x = center.x;
          p.y = center.y + effR;
          p.z = center.z;
        } else {
          const d = Math.sqrt(d2);
          const scale = effR / d;
          p.x = center.x + dx * scale;
          p.y = center.y + dy * scale;
          p.z = center.z + dz * scale;
        }
      }
    }
    return this;
  }

  /** 获取段数组。 */
  getSegments(): RopeSegment[] {
    return this.segments;
  }

  /** 获取节点数。 */
  getSegmentCount(): number {
    return this.segmentCount;
  }

  /** 获取绳索总长度(= (segmentCount - 1) * segmentLength)。 */
  getLength(): number {
    return this.segmentCount > 1 ? (this.segmentCount - 1) * this.segmentLength : 0;
  }

  /** 获取所有节点位置(共享 Vector3 引用,供渲染取点)。 */
  getPoints(): Vector3[] {
    const pts: Vector3[] = [];
    for (let i = 0; i < this.segmentCount; i++) {
      pts.push(this.segments[i].position);
    }
    return pts;
  }

  /** 获取节点 index 处的切线(指向 index+1,归一化)。
   *  末节点返回上一段的切线;越界抛错。 */
  getTangent(index: number): Vector3 {
    if (index < 0 || index >= this.segmentCount) {
      throw new Error(`RopePhysics.getTangent: index out of range (${index})`);
    }
    let a: Vector3, b: Vector3;
    if (index < this.segmentCount - 1) {
      a = this.segments[index].position;
      b = this.segments[index + 1].position;
    } else {
      // 末节点:用上一段方向
      a = this.segments[index - 1].position;
      b = this.segments[index].position;
    }
    const t = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = t.length();
    if (len < EPS) return new Vector3(1, 0, 0);
    return t.divideScalar(len);
  }

  /** 获取统计信息。 */
  getStats(): RopeStats {
    return {
      segmentCount: this.segmentCount,
      segmentLength: this.segmentLength,
      length: this.getLength(),
      pinnedCount: this._pinnedSegments.size,
      iterations: this.iterations,
      maxBendAngle: this.maxBendAngle,
      thickness: this.thickness,
    };
  }
}

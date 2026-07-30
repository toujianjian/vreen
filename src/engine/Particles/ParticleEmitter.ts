// ParticleEmitter — 高级粒子发射器 (多发射形状 + 曲线控制 + 子发射器 + 拖尾)。
//
// 双模式设计:
//   1. 自包含模式 (任务规格主路径): 持有 particles: EmitterParticle[], 自己积分。
//      - emit(count) / emitFromShape(shape, count) 生成粒子到 this.particles。
//      - update(dt) 推进所有粒子 (积分 + 曲线插值 + 拖尾 + 子发射器死亡触发)。
//      - 配置走 emissionRate / emissionShape / shapeParams / lifetime / startSpeed /
//        startSize / endSize / startColor{r,g,b,a} / endColor / gravity(Vector3) /
//        drag / sizeCurve / colorCurve / subEmitters / trails / trailLifetime。
//
//   2. ParticleSystem2 兼容模式 (向后兼容旧 API):
//      - update(dt, system) 按 rate 累积 + bursts 触发, 调 system.spawn 创建粒子。
//      - trigger(system, position, count) 一次性 burst (SubEmittersModifier 依赖)。
//      - 兼容字段: shape / rate / bursts / directionBias / burstCount。
//      - applyConfig 用新字段 (lifetime/startColor{r,g,b,a}/gravity Vector3 等) 写入 ParticleData,
//        内部把 {r,g,b,a} 映射到 Color (alpha 暂存于 customData[0])。
//
// 形状: point / sphere / box / cone / circle / hemisphere (mesh 仍兼容旧 shape 路径)。
// 曲线: sizeCurve / colorCurve 为关键帧数组, sampleCurve 按均匀分布线性插值。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { clamp, lerp } from '../Math/MathUtils';
import { ParticleData } from './ParticleData';
import type { ParticleSystem2 } from './ParticleSystem2';

// ── 自包含粒子类型 ──────────────────────────────────────────────

/** RGBA 颜色 (0..1)。 */
export interface EmitterColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 自包含发射器粒子 (独立于 ParticleSystem2 的 ParticleData)。 */
export interface EmitterParticle {
  position: Vector3;
  velocity: Vector3;
  /** 最大寿命 (s)。 */
  lifetime: number;
  /** 已存活时间 (s)。 */
  age: number;
  /** 当前大小。 */
  size: number;
  /** 当前颜色。 */
  color: EmitterColor;
  /** 绕发射法线的旋转 (rad)。 */
  rotation: number;
  /** 角速度 (rad/s)。 */
  angularVelocity: number;
  /** 拖尾位置历史 (trails 启用时维护; 最新在尾部)。 */
  trail?: Vector3[];
}

// ── 形状类型 ────────────────────────────────────────────────────

/** 旧 EmitterShapeType (兼容 ParticleSystem2 路径), 扩展 circle / hemisphere。 */
export type EmitterShapeType = 'point' | 'box' | 'sphere' | 'cone' | 'mesh' | 'circle' | 'hemisphere';

/** 旧 EmitterShape (兼容 ParticleSystem2 路径)。 */
export interface EmitterShape {
  type: EmitterShapeType;
  halfExtents?: [number, number, number];
  radius?: number;
  shellOnly?: boolean;
  height?: number;
  angle?: number;
  positions?: number[];
}

/** 新发射形状类型 (任务规格)。 */
export type EmissionShapeType = 'point' | 'sphere' | 'box' | 'cone' | 'circle' | 'hemisphere';

/** 新发射形状参数。各形状只读取对应字段。 */
export interface ShapeParams {
  /** sphere / cone / circle / hemisphere: 半径。 */
  radius?: number;
  /** box: 半尺寸 [hx, hy, hz]。 */
  extents?: [number, number, number];
  /** cone: 张角 (rad)。 */
  angle?: number;
  /** cone: 高度。 */
  height?: number;
  /** hemisphere: 法线方向 (朝向, 默认 +Y)。 */
  normal?: Vector3;
}

/** 突发发射配置 (兼容 ParticleSystem2 路径)。 */
export interface ParticleBurst {
  count: number;
  time: number;
  cycles: number;
  interval: number;
  fired: number;
}

/** 范围 [min, max] (兼容 ParticleSystem2 路径)。 */
export interface MinMaxRange {
  min: number;
  max: number;
}

// ── EmitterParticle 工厂 ────────────────────────────────────────

function makeEmitterParticle(): EmitterParticle {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    lifetime: 1,
    age: 0,
    size: 1,
    color: { r: 1, g: 1, b: 1, a: 1 },
    rotation: 0,
    angularVelocity: 0,
  };
}

export class ParticleEmitter {
  // ── 公共位置/朝向 ──────────────────────────────────────────────
  position: Vector3;
  rotation: Quaternion;

  // ── 自包含模式字段 (任务规格) ─────────────────────────────────
  /** 每秒发射数 (自包含模式)。 */
  emissionRate: number;
  /** 发射形状 (自包含模式)。 */
  emissionShape: EmissionShapeType;
  /** 发射形状参数。 */
  shapeParams: ShapeParams;
  /** 自包含粒子数组。 */
  particles: EmitterParticle[];
  /** 最大粒子数。 */
  maxParticles: number;
  /** 粒子寿命 (s, 单值)。 */
  lifetime: number;
  /** 初始速度大小 (m/s)。 */
  startSpeed: number;
  /** 起始大小。 */
  startSize: number;
  /** 结束大小。 */
  endSize: number;
  /** 起始颜色 (RGBA)。 */
  startColor: EmitterColor;
  /** 结束颜色 (RGBA)。 */
  endColor: EmitterColor;
  /** 重力加速度 (Vector3, m/s²)。 */
  gravity: Vector3;
  /** 阻力系数 (0..1/s)。 */
  drag: number;
  /** 大小曲线关键帧 (空则线性 startSize→endSize)。 */
  sizeCurve: number[];
  /** 颜色曲线关键帧 (空则线性)。 */
  colorCurve: number[];
  /** 子发射器 (粒子死亡时触发)。 */
  subEmitters: ParticleEmitter[];
  /** 是否启用拖尾。 */
  trails: boolean;
  /** 拖尾寿命 (保留的历史点数)。 */
  trailLifetime: number;

  // ── ParticleSystem2 兼容字段 ──────────────────────────────────
  /** 兼容: 旧 EmitterShape (ParticleSystem2 路径用)。 */
  shape: EmitterShape;
  /** 兼容: 每秒发射数 (ParticleSystem2 路径用)。 */
  rate: number;
  /** 兼容: 突发表。 */
  bursts: ParticleBurst[];
  /** 兼容: 速度方向偏移。 */
  directionBias: Vector3;
  /** 兼容: 子发射器一次性触发数量。 */
  burstCount: number;

  // ── 内部状态 ──────────────────────────────────────────────────
  private accumulator: number;
  private elapsed: number;

  constructor() {
    this.position = new Vector3();
    this.rotation = new Quaternion();

    // 自包含模式默认值
    this.emissionRate = 10;
    this.emissionShape = 'point';
    this.shapeParams = {};
    this.particles = [];
    this.maxParticles = 1000;
    this.lifetime = 2;
    this.startSpeed = 1;
    this.startSize = 0.1;
    this.endSize = 0;
    this.startColor = { r: 1, g: 1, b: 1, a: 1 };
    this.endColor = { r: 1, g: 1, b: 1, a: 0 };
    this.gravity = new Vector3();
    this.drag = 0;
    this.sizeCurve = [];
    this.colorCurve = [];
    this.subEmitters = [];
    this.trails = false;
    this.trailLifetime = 8;

    // 兼容字段默认值
    this.shape = { type: 'point' };
    this.rate = 10;
    this.bursts = [];
    this.directionBias = new Vector3();
    this.burstCount = 5;

    this.accumulator = 0;
    this.elapsed = 0;
  }

  // ════════════════════════════════════════════════════════════════
  // 自包含模式: 发射
  // ════════════════════════════════════════════════════════════════

  /** 发射 count 个粒子到 this.particles (受 maxParticles 限制)。 */
  emit(count: number): void {
    this._emitInternal(this.emissionShape, this.shapeParams, count);
  }

  /** 从指定形状发射 count 个粒子 (不改 emissionShape 配置)。 */
  emitFromShape(shape: EmissionShapeType, count: number): void {
    this._emitInternal(shape, this.shapeParams, count);
  }

  private _emitInternal(shape: EmissionShapeType, params: ShapeParams, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const p = makeEmitterParticle();
      const pos = this._samplePositionByShape(shape, params, this.position);
      const vel = this._sampleVelocityByShape(shape, params);
      p.position.copy(pos);
      p.velocity.copy(vel);
      p.lifetime = this.lifetime;
      p.age = 0;
      p.size = this.startSize;
      p.color.r = this.startColor.r;
      p.color.g = this.startColor.g;
      p.color.b = this.startColor.b;
      p.color.a = this.startColor.a;
      p.rotation = 0;
      p.angularVelocity = (Math.random() * 2 - 1) * Math.PI;
      if (this.trails) {
        p.trail = [p.position.clone()];
      }
      this.particles.push(p);
    }
  }

  /** 按自包含 emissionRate 累积发射 (供 update(dt) 调用)。 */
  private _accumulateEmit(dt: number): void {
    this.accumulator += dt * this.emissionRate;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      this.emit(1);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 自包含模式: 更新
  // ════════════════════════════════════════════════════════════════

  /** 更新重载: 无 system 时走自包含模式; 有 system 时走 ParticleSystem2 兼容模式。 */
  update(dt: number): void;
  update(dt: number, system: ParticleSystem2): void;
  update(dt: number, system?: ParticleSystem2): void {
    if (system) {
      this._updateCompat(dt, system);
      return;
    }
    this._updateSelf(dt);
  }

  /** 自包含模式更新: 累积发射 + 积分 + 曲线 + 拖尾 + 子发射器。 */
  private _updateSelf(dt: number): void {
    this.elapsed += dt;
    this._accumulateEmit(dt);

    // 拖尾追加 + 子发射器触发用: 先记录初始数量 (本帧新 spawn 的不处理)
    const initialCount = this.particles.length;
    for (let i = 0; i < initialCount; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.lifetime) {
        // 死亡: 触发子发射器
        this._triggerSubEmitters(p);
        continue;
      }
      const t = clamp(p.age / p.lifetime, 0, 1);

      // 积分: vel += gravity*dt; vel *= (1-drag*dt); pos += vel*dt; rot += angVel*dt
      p.velocity.x += this.gravity.x * dt;
      p.velocity.y += this.gravity.y * dt;
      p.velocity.z += this.gravity.z * dt;
      if (this.drag > 0) {
        const d = Math.max(0, 1 - this.drag * dt);
        p.velocity.multiplyScalar(d);
      }
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.position.z += p.velocity.z * dt;
      p.rotation += p.angularVelocity * dt;

      // 大小曲线
      const sizeT = this.sizeCurve.length > 0
        ? this.sampleCurve(this.sizeCurve, t)
        : t;
      p.size = lerp(this.startSize, this.endSize, sizeT);

      // 颜色曲线
      const colorT = this.colorCurve.length > 0
        ? this.sampleCurve(this.colorCurve, t)
        : t;
      p.color.r = lerp(this.startColor.r, this.endColor.r, colorT);
      p.color.g = lerp(this.startColor.g, this.endColor.g, colorT);
      p.color.b = lerp(this.startColor.b, this.endColor.b, colorT);
      p.color.a = lerp(this.startColor.a, this.endColor.a, colorT);

      // 拖尾
      if (this.trails && p.trail) {
        p.trail.push(p.position.clone());
        while (p.trail.length > this.trailLifetime) {
          p.trail.shift();
        }
      }
    }

    // 清理死亡粒子 (age >= lifetime)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (this.particles[i].age >= this.particles[i].lifetime) {
        this.particles.splice(i, 1);
      }
    }
  }

  /** 触发所有子发射器 (在父粒子死亡位置)。 */
  private _triggerSubEmitters(parent: EmitterParticle): void {
    for (const sub of this.subEmitters) {
      const savedPos = sub.position;
      sub.position = parent.position;
      sub.emit(sub.burstCount);
      sub.position = savedPos;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ParticleSystem2 兼容模式
  // ════════════════════════════════════════════════════════════════

  /** 兼容: 每帧推进, 按 rate 累积 + bursts 触发, 调 system.spawn。 */
  private _updateCompat(dt: number, system: ParticleSystem2): void {
    this.elapsed += dt;
    this.accumulator += dt * this.rate;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      this._emitOneCompat(system);
    }
    for (const b of this.bursts) {
      while (b.fired < b.cycles) {
        const triggerTime = b.time + b.fired * b.interval;
        if (this.elapsed < triggerTime) break;
        b.fired++;
        for (let i = 0; i < b.count; i++) {
          this._emitOneCompat(system);
        }
      }
    }
  }

  /** 兼容: 一次性在指定位置触发 burstCount 个粒子 (SubEmittersModifier 调用)。 */
  trigger(system: ParticleSystem2, position: Vector3, count?: number): void {
    const n = count ?? this.burstCount;
    const savedPos = this.position;
    this.position = position;
    for (let i = 0; i < n; i++) {
      this._emitOneCompat(system);
    }
    this.position = savedPos;
  }

  /** 兼容: 重置内部计时 (burst 已触发次数清零)。 */
  reset(): void {
    this.accumulator = 0;
    this.elapsed = 0;
    for (const b of this.bursts) b.fired = 0;
  }

  private _emitOneCompat(system: ParticleSystem2): void {
    const pos = this._samplePositionByLegacyShape();
    const vel = this._sampleVelocityLegacy(pos);
    const spawned = system.spawn(1, pos, vel);
    for (const p of spawned) {
      this._applyConfigCompat(p);
    }
  }

  /** 兼容: 把新字段 (lifetime/startColor{r,g,b,a}/gravity Vector3 等) 写入 ParticleData。 */
  private _applyConfigCompat(p: ParticleData): void {
    p.maxLife = this.lifetime;
    p.life = 0;
    p.alive = true;
    p.startColor.setRGB(this.startColor.r, this.startColor.g, this.startColor.b);
    p.endColor.setRGB(this.endColor.r, this.endColor.g, this.endColor.b);
    p.color.copy(p.startColor);
    p.startSize = this.startSize;
    p.endSize = this.endSize;
    p.size = this.startSize;
    p.acceleration.set(this.gravity.x, this.gravity.y, this.gravity.z);
    // alpha 暂存到 customData[0] (ParticleData 无 alpha 字段)
    p.customData[0] = this.startColor.a;
  }

  // ════════════════════════════════════════════════════════════════
  // 形状采样 (自包含 + 兼容共用)
  // ════════════════════════════════════════════════════════════════

  /** 按新 EmissionShapeType + ShapeParams 采样出生点。 */
  private _samplePositionByShape(shape: EmissionShapeType, params: ShapeParams, base: Vector3): Vector3 {
    switch (shape) {
      case 'point':
        return base.clone();
      case 'sphere': {
        const r = params.radius ?? 0.5;
        const radius = r * Math.cbrt(Math.random());
        const dir = randomUnitVector();
        return base.clone().addScaledVector(dir, radius);
      }
      case 'box': {
        const he = params.extents ?? [0.5, 0.5, 0.5];
        return new Vector3(
          base.x + (Math.random() * 2 - 1) * he[0],
          base.y + (Math.random() * 2 - 1) * he[1],
          base.z + (Math.random() * 2 - 1) * he[2],
        );
      }
      case 'cone': {
        const h = params.height ?? 1;
        const angle = params.angle ?? Math.PI / 6;
        const baseRadius = h * Math.tan(angle);
        const r = Math.sqrt(Math.random()) * baseRadius;
        const theta = Math.random() * Math.PI * 2;
        return new Vector3(
          base.x + Math.cos(theta) * r,
          base.y,
          base.z + Math.sin(theta) * r,
        );
      }
      case 'circle': {
        const r = params.radius ?? 0.5;
        const radius = Math.sqrt(Math.random()) * r;
        const theta = Math.random() * Math.PI * 2;
        return new Vector3(
          base.x + Math.cos(theta) * radius,
          base.y,
          base.z + Math.sin(theta) * radius,
        );
      }
      case 'hemisphere': {
        const r = params.radius ?? 0.5;
        const normal = params.normal ?? new Vector3(0, 1, 0);
        // 在半球面上采样 (沿 normal 方向的正半球)
        const dir = randomUnitVector();
        // 若 dir 与 normal 反向, 翻转
        if (dir.dot(normal) < 0) {
          dir.negate();
        }
        const radius = r * Math.cbrt(Math.random());
        return base.clone().addScaledVector(dir, radius);
      }
    }
  }

  /** 按新 EmissionShapeType 采样初速度方向, 大小取 startSpeed。 */
  private _sampleVelocityByShape(shape: EmissionShapeType, params: ShapeParams): Vector3 {
    const speed = this.startSpeed;
    let dir: Vector3;
    switch (shape) {
      case 'point':
        dir = randomUnitVector();
        break;
      case 'sphere':
        dir = randomUnitVector();
        break;
      case 'box':
        dir = randomUnitVector();
        break;
      case 'cone': {
        const angle = params.angle ?? Math.PI / 6;
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.random() * angle;
        dir = new Vector3(
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi),
        );
        break;
      }
      case 'circle': {
        // 沿 +Y 方向
        const phi = Math.random() * Math.PI * 2;
        const tilt = Math.random() * 0.3;
        dir = new Vector3(
          Math.sin(tilt) * Math.cos(phi),
          Math.cos(tilt),
          Math.sin(tilt) * Math.sin(phi),
        );
        break;
      }
      case 'hemisphere': {
        const normal = params.normal ?? new Vector3(0, 1, 0);
        dir = randomUnitVector();
        if (dir.dot(normal) < 0) dir.negate();
        break;
      }
    }
    return dir.multiplyScalar(speed);
  }

  /** 兼容: 按旧 EmitterShape 采样出生点 (支持 mesh + 新 circle/hemisphere)。 */
  private _samplePositionByLegacyShape(): Vector3 {
    const s = this.shape;
    const base = this.position;
    switch (s.type) {
      case 'point':
        return base.clone();
      case 'box': {
        const he = s.halfExtents ?? [0.5, 0.5, 0.5];
        return new Vector3(
          base.x + (Math.random() * 2 - 1) * he[0],
          base.y + (Math.random() * 2 - 1) * he[1],
          base.z + (Math.random() * 2 - 1) * he[2],
        );
      }
      case 'sphere': {
        const r = s.radius ?? 0.5;
        const shell = s.shellOnly ?? false;
        const radius = shell ? r : r * Math.cbrt(Math.random());
        const dir = randomUnitVector();
        return base.clone().addScaledVector(dir, radius);
      }
      case 'cone': {
        const h = s.height ?? 1;
        const angle = s.angle ?? Math.PI / 6;
        const baseRadius = h * Math.tan(angle);
        const r = Math.sqrt(Math.random()) * baseRadius;
        const theta = Math.random() * Math.PI * 2;
        return new Vector3(
          base.x + Math.cos(theta) * r,
          base.y,
          base.z + Math.sin(theta) * r,
        );
      }
      case 'circle': {
        const r = s.radius ?? 0.5;
        const radius = Math.sqrt(Math.random()) * r;
        const theta = Math.random() * Math.PI * 2;
        return new Vector3(
          base.x + Math.cos(theta) * radius,
          base.y,
          base.z + Math.sin(theta) * radius,
        );
      }
      case 'hemisphere': {
        const r = s.radius ?? 0.5;
        const dir = randomUnitVector();
        if (dir.y < 0) dir.negate();
        const radius = r * Math.cbrt(Math.random());
        return base.clone().addScaledVector(dir, radius);
      }
      case 'mesh': {
        const positions = s.positions;
        if (!positions || positions.length < 9) return base.clone();
        const triCount = Math.floor(positions.length / 9);
        const areas: number[] = [];
        let total = 0;
        for (let i = 0; i < triCount; i++) {
          const ax = positions[i * 9 + 0];
          const ay = positions[i * 9 + 1];
          const az = positions[i * 9 + 2];
          const bx = positions[i * 9 + 3];
          const by = positions[i * 9 + 4];
          const bz = positions[i * 9 + 5];
          const cx = positions[i * 9 + 6];
          const cy = positions[i * 9 + 7];
          const cz = positions[i * 9 + 8];
          const area = 0.5 * Math.hypot(
            (by - ay) * (cz - az) - (bz - az) * (cy - ay),
            (bz - az) * (cx - ax) - (bx - ax) * (cz - az),
            (bx - ax) * (cy - ay) - (by - ay) * (cx - ax),
          );
          areas.push(area);
          total += area;
        }
        let pick = Math.random() * total;
        let idx = 0;
        for (let i = 0; i < triCount; i++) {
          pick -= areas[i];
          if (pick <= 0) { idx = i; break; }
        }
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w = 1 - u - v;
        const o = idx * 9;
        return new Vector3(
          base.x + u * positions[o + 0] + v * positions[o + 3] + w * positions[o + 6],
          base.y + u * positions[o + 1] + v * positions[o + 4] + w * positions[o + 7],
          base.z + u * positions[o + 2] + v * positions[o + 5] + w * positions[o + 8],
        );
      }
    }
  }

  /** 兼容: 按旧 EmitterShape 采样初速度 (大小用 startSpeed)。 */
  private _sampleVelocityLegacy(_pos: Vector3): Vector3 {
    const s = this.shape;
    const speed = this.startSpeed;
    let dir: Vector3;
    switch (s.type) {
      case 'point':
        dir = randomUnitVector();
        break;
      case 'box':
        dir = randomUnitVector();
        break;
      case 'sphere':
        dir = randomUnitVector();
        break;
      case 'cone': {
        const angle = s.angle ?? Math.PI / 6;
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.random() * angle;
        dir = new Vector3(
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi),
        );
        break;
      }
      case 'circle':
        dir = new Vector3(0, 1, 0);
        break;
      case 'hemisphere': {
        dir = randomUnitVector();
        if (dir.y < 0) dir.negate();
        break;
      }
      case 'mesh':
        dir = new Vector3(0, 1, 0);
        break;
    }
    const vel = dir.multiplyScalar(speed);
    vel.add(this.directionBias);
    return vel;
  }

  // ════════════════════════════════════════════════════════════════
  // 配置 setter (任务规格)
  // ════════════════════════════════════════════════════════════════

  setEmissionShape(shape: EmissionShapeType): void {
    this.emissionShape = shape;
  }

  setEmissionRate(rate: number): void {
    this.emissionRate = Math.max(0, rate);
  }

  setLifetime(lifetime: number): void {
    this.lifetime = Math.max(0, lifetime);
  }

  setStartSpeed(speed: number): void {
    this.startSpeed = speed;
  }

  setColors(start: EmitterColor, end: EmitterColor): void {
    this.startColor = { ...start };
    this.endColor = { ...end };
  }

  setSizes(start: number, end: number): void {
    this.startSize = start;
    this.endSize = end;
  }

  setGravity(gravity: Vector3): void {
    this.gravity.copy(gravity);
  }

  setDrag(drag: number): void {
    this.drag = Math.max(0, drag);
  }

  setSizeCurve(curve: number[]): void {
    this.sizeCurve = curve.slice();
  }

  setColorCurve(curve: number[]): void {
    this.colorCurve = curve.slice();
  }

  addSubEmitter(emitter: ParticleEmitter): void {
    this.subEmitters.push(emitter);
  }

  setTrails(enabled: boolean, lifetime: number): void {
    this.trails = enabled;
    this.trailLifetime = Math.max(1, Math.floor(lifetime));
  }

  // ════════════════════════════════════════════════════════════════
  // 查询
  // ════════════════════════════════════════════════════════════════

  getParticles(): EmitterParticle[] {
    return this.particles;
  }

  getParticleCount(): number {
    return this.particles.length;
  }

  getMaxParticles(): number {
    return this.maxParticles;
  }

  clear(): void {
    this.particles.length = 0;
  }

  // ════════════════════════════════════════════════════════════════
  // 曲线采样
  // ════════════════════════════════════════════════════════════════

  /** 采样关键帧曲线。curve 为关键帧值数组 (均匀分布在 t∈[0,1])。
   *  - 空数组返回 t (线性)
   *  - 单元素返回 curve[0] (常数)
   *  - 多元素: t 映射到索引 f = t*(n-1), 线性插值
   *  t 自动 clamp 到 [0,1]。 */
  sampleCurve(curve: number[], t: number): number {
    const ct = clamp(t, 0, 1);
    const n = curve.length;
    if (n === 0) return ct;
    if (n === 1) return curve[0];
    const f = ct * (n - 1);
    const i = Math.floor(f);
    if (i >= n - 1) return curve[n - 1];
    const frac = f - i;
    return lerp(curve[i], curve[i + 1], frac);
  }
}

/** 在单位球面上均匀采样一个单位向量。 */
function randomUnitVector(): Vector3 {
  // Marsaglia 方法: 拒绝采样
  let x: number, y: number, s: number;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    s = x * x + y * y;
  } while (s >= 1);
  const factor = 2 * Math.sqrt(1 - s);
  return new Vector3(x * factor, y * factor, 1 - 2 * s);
}

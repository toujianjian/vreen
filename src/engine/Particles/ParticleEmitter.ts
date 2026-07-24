// ParticleEmitter — 粒子发射器。
//
// 设计:
// - 5 种 EmitterShape:point / box / sphere / cone / mesh
// - rate (每秒发射数) 与 bursts (突发:在某时刻一次性发射 N 个,可循环)
// - lifetime / speed / startColor / endColor / startSize / endSize /
//   gravity / drag 控制生成粒子的初始属性
// - update(dt, system) 按速率累积,达到 1 个就调 system.spawn(1, pos, vel)
//   然后用 emitter 自己的属性覆盖刚 spawn 出来的 ParticleData
// - trigger(system, position, count?) 提供给 SubEmittersModifier 一次性触发
//
// 注意:本类与 ECS/PhysicsComponents.ts 中的同名 ParticleEmitter 是不同
// 的实现——那个是 ECS 组件版的简陋发射器;本类是 Particles 模块的高
// 级发射器,在 engine/index.ts 里以 AdvancedParticleEmitter 别名导出避免冲突。

import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { lerp } from '../Math/MathUtils';
import { ParticleData } from './ParticleData';
import type { ParticleSystem2 } from './ParticleSystem2';

/** 发射器形状类型。 */
export type EmitterShapeType = 'point' | 'box' | 'sphere' | 'cone' | 'mesh';

/** 发射器形状描述。各形状只读取对应字段,其它忽略。 */
export interface EmitterShape {
  type: EmitterShapeType;
  /** box:半尺寸 [hx, hy, hz]。 */
  halfExtents?: [number, number, number];
  /** sphere:半径。 */
  radius?: number;
  /** sphere:仅在球壳上采样(默认 false,实心球)。 */
  shellOnly?: boolean;
  /** cone:高度。 */
  height?: number;
  /** cone:张角 (rad),0 = 圆柱,π/2 = 半球。 */
  angle?: number;
  /** mesh:三角形顶点扁平数组 [x,y,z, x,y,z, ...],按面积加权随机选三角形。 */
  positions?: number[];
}

/** 突发发射配置:在 time(s) 时刻一次性发射 count 个,cycles 次循环,间隔 interval。 */
export interface ParticleBurst {
  count: number;
  time: number;
  cycles: number;
  interval: number;
  /** 已触发次数(内部维护)。 */
  fired: number;
}

/** 范围 [min, max]。 */
export interface MinMaxRange {
  min: number;
  max: number;
}

export class ParticleEmitter {
  /** 发射形状。 */
  shape: EmitterShape;
  /** 每秒发射数。 */
  rate: number;
  /** 突发表。 */
  bursts: ParticleBurst[];
  /** 粒子寿命范围 (s)。 */
  lifetime: MinMaxRange;
  /** 初速度大小范围 (m/s)。 */
  speed: MinMaxRange;
  /** 起始颜色。 */
  startColor: Color;
  /** 结束颜色。 */
  endColor: Color;
  /** 起始大小范围。 */
  startSize: MinMaxRange;
  /** 结束大小范围。 */
  endSize: MinMaxRange;
  /** 重力加速度 (m/s²),施加到生成粒子的 acceleration.y。 */
  gravity: number;
  /** 阻尼 (0..1/s)。 */
  drag: number;
  /** 发射器世界位置 (shape 采样以此为原点)。 */
  position: Vector3;
  /** 速度方向偏移 (叠加在 shape 采样方向上),常用于让所有粒子整体往某方向走。 */
  directionBias: Vector3;
  /** 子发射器一次性触发时的默认数量(SubEmittersModifier 使用)。 */
  burstCount: number;

  private accumulator: number;
  private elapsed: number;

  constructor() {
    this.shape = { type: 'point' };
    this.rate = 10;
    this.bursts = [];
    this.lifetime = { min: 1, max: 2 };
    this.speed = { min: 1, max: 2 };
    this.startColor = new Color(1, 1, 1);
    this.endColor = new Color(1, 1, 1);
    this.startSize = { min: 0.05, max: 0.1 };
    this.endSize = { min: 0, max: 0 };
    this.gravity = 0;
    this.drag = 0;
    this.position = new Vector3();
    this.directionBias = new Vector3();
    this.burstCount = 5;
    this.accumulator = 0;
    this.elapsed = 0;
  }

  /** 每帧推进:按 rate 累积生成粒子;按 bursts 时间表触发突发。 */
  update(dt: number, system: ParticleSystem2): void {
    this.elapsed += dt;
    this.accumulator += dt * this.rate;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      this.emitOne(system);
    }
    // bursts
    for (const b of this.bursts) {
      while (b.fired < b.cycles) {
        const triggerTime = b.time + b.fired * b.interval;
        if (this.elapsed < triggerTime) break;
        b.fired++;
        for (let i = 0; i < b.count; i++) {
          this.emitOne(system);
        }
      }
    }
  }

  /** 一次性在指定位置触发 burstCount 个粒子(供 SubEmittersModifier 调用)。 */
  trigger(system: ParticleSystem2, position: Vector3, count?: number): void {
    const n = count ?? this.burstCount;
    const savedPos = this.position;
    this.position = position;
    for (let i = 0; i < n; i++) {
      this.emitOne(system);
    }
    this.position = savedPos;
  }

  /** 重置内部计时(burst 已触发次数也清零)。 */
  reset(): void {
    this.accumulator = 0;
    this.elapsed = 0;
    for (const b of this.bursts) b.fired = 0;
  }

  private emitOne(system: ParticleSystem2): void {
    const pos = this.samplePosition();
    const vel = this.sampleVelocity(pos);
    const spawned = system.spawn(1, pos, vel);
    // 用 emitter 配置覆盖 spawn 时的默认属性
    for (const p of spawned) {
      this.applyConfig(p);
    }
  }

  /** 把 emitter 的颜色/大小/寿命/重力等写入粒子。 */
  private applyConfig(p: ParticleData): void {
    p.maxLife = lerp(this.lifetime.min, this.lifetime.max, Math.random());
    p.life = 0;
    p.alive = true;
    p.startColor.copy(this.startColor);
    p.endColor.copy(this.endColor);
    p.color.copy(this.startColor);
    p.startSize = lerp(this.startSize.min, this.startSize.max, Math.random());
    p.endSize = lerp(this.endSize.min, this.endSize.max, Math.random());
    p.size = p.startSize;
    p.acceleration.set(0, this.gravity, 0);
  }

  /** 按 shape 在 emitter.position 周围采样一个出生点。 */
  private samplePosition(): Vector3 {
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
        // 在底面圆盘上均匀采样
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
      case 'mesh': {
        const positions = s.positions;
        if (!positions || positions.length < 9) return base.clone();
        // 计算三角形面积,按面积加权随机选一个三角形
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
        // 在三角形内均匀采样
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

  /** 按 shape 采样初速度方向,大小取 speed 范围内随机。 */
  private sampleVelocity(_pos: Vector3): Vector3 {
    const s = this.shape;
    const speed = lerp(this.speed.min, this.speed.max, Math.random());
    let dir: Vector3;
    switch (s.type) {
      case 'point':
        dir = randomUnitVector();
        break;
      case 'box':
        // 沿各轴 outward 方向,简化为随机单位向量
        dir = randomUnitVector();
        break;
      case 'sphere':
        // 从球面向外
        dir = randomUnitVector();
        break;
      case 'cone': {
        // 沿 +Y 方向,在 angle 张角内
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
      case 'mesh':
        dir = new Vector3(0, 1, 0);
        break;
    }
    const vel = dir.multiplyScalar(speed);
    vel.add(this.directionBias);
    return vel;
  }
}

/** 在单位球面上均匀采样一个单位向量。 */
function randomUnitVector(): Vector3 {
  // Marsaglia 方法:拒绝采样
  let x: number, y: number, s: number;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    s = x * x + y * y;
  } while (s >= 1);
  const factor = 2 * Math.sqrt(1 - s);
  return new Vector3(x * factor, y * factor, 1 - 2 * s);
}

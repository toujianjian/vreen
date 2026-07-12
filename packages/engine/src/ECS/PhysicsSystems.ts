// PhysicsSystems — 物理系统集合。
//
// 提供:
//   - PhysicsSystem:      固定步长 Verlet/Semi-implicit Euler 积分
//   - CollisionSystem:    AABB + Sphere broadphase + narrowphase,带冲量响应
//   - ParticleSystem:     CPU 粒子推进 + emitter 计时
//   - PhysicsDebugSystem: 把 contact / collider 数据写入 PhysicsDebug 组件
//
// 所有 system 在 priority 150 段(MovementSystem=100 之后)运行。

import { System, World } from './World';
import { TransformC, Transform } from './Components';
import {
  RigidbodyC, ColliderC, PhysicsConfigC,
  ParticleC, ParticleEmitterC, PhysicsDebugC,
  Particle, Rigidbody, Collider, PhysicsConfig,
  type ParticleEmitter, type PhysicsDebug,
} from './PhysicsComponents';
import { createLogger } from '../logger';

const log = createLogger('ECS.Physics');

// ── 物理内部:Collider 派生 AABB ──────────────────────────────────

interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

function worldAABBFromCollider(t: Transform, c: Collider): AABB {
  const [px, py, pz] = t.position;
  let hx: number, hy: number, hz: number;
  if (c.shape === 'aabb') {
    hx = c.halfExtents[0];
    hy = c.halfExtents[1];
    hz = c.halfExtents[2];
  } else if (c.shape === 'sphere') {
    hx = hy = hz = c.radius;
  } else { // capsule
    const r = c.radius;
    const half = Math.max(c.height * 0.5, r);
    hx = hz = r;
    hy = half;
  }
  return {
    min: [px - hx, py - hy, pz - hz],
    max: [px + hx, py + hy, pz + hz],
  };
}

function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.max[0] >= b.min[0] && a.min[0] <= b.max[0]
      && a.max[1] >= b.min[1] && a.min[1] <= b.max[1]
      && a.max[2] >= b.min[2] && a.min[2] <= b.max[2];
}

function sphereOverlap(
  pa: [number, number, number], ra: number,
  pb: [number, number, number], rb: number,
): { overlap: boolean; normal?: [number, number, number]; depth?: number } {
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const dz = pb[2] - pa[2];
  const distSq = dx * dx + dy * dy + dz * dz;
  const rsum = ra + rb;
  if (distSq >= rsum * rsum) return { overlap: false };
  const dist = Math.sqrt(distSq) || 1e-6;
  return {
    overlap: true,
    normal: [dx / dist, dy / dist, dz / dist],
    depth: rsum - dist,
  };
}

// ── PhysicsSystem: 积分 ─────────────────────────────────────────

export class PhysicsSystem extends System {
  /** 累积时间,等 fixedDelta 触发子步。 */
  private accumulator: number = 0;
  constructor() { super('PhysicsSystem', 150); }
  override update(world: World, dt: number): void {
    const cfg = this.getConfig(world);
    this.accumulator += Math.min(dt, 0.1); // clamp huge dt (paused tab)
    let steps = 0;
    while (this.accumulator >= cfg.fixedDelta && steps < cfg.maxSubsteps) {
      this.step(world, cfg.fixedDelta, cfg);
      this.accumulator -= cfg.fixedDelta;
      steps++;
    }
    if (steps === cfg.maxSubsteps) this.accumulator = 0;
  }

  /** 暴露子步算法给 CollisionSystem(碰撞响应需要同 step 内)。 */
  step(world: World, dt: number, cfg: PhysicsConfig): void {
    const [gx, gy, gz] = cfg.gravity;
    world.queryWith2<Transform, Rigidbody>(TransformC, RigidbodyC, (id, t, rb) => {
      if (rb.mass <= 0) { rb.sleeping = true; return; }
      // 1) 累积力 → 加速度
      const ax = rb.force[0] / rb.mass + gx * rb.gravityScale;
      const ay = rb.force[1] / rb.mass + gy * rb.gravityScale;
      const az = rb.force[2] / rb.mass + gz * rb.gravityScale;
      // 2) Semi-implicit Euler
      rb.velocity[0] += ax * dt;
      rb.velocity[1] += ay * dt;
      rb.velocity[2] += az * dt;
      // 阻尼
      const lDamp = Math.max(0, 1 - rb.linearDamping * dt);
      rb.velocity[0] *= lDamp;
      rb.velocity[1] *= lDamp;
      rb.velocity[2] *= lDamp;
      const aDamp = Math.max(0, 1 - rb.angularDamping * dt);
      rb.angularVelocity[0] *= aDamp;
      rb.angularVelocity[1] *= aDamp;
      rb.angularVelocity[2] *= aDamp;
      // 3) 推进
      t.position[0] += rb.velocity[0] * dt;
      t.position[1] += rb.velocity[1] * dt;
      t.position[2] += rb.velocity[2] * dt;
      // 4) 旋转(简化为欧拉角积分)
      const [wx, wy, wz] = rb.angularVelocity;
      const [qx, qy, qz, qw] = t.rotation;
      const dq = quatFromEuler(wx * dt, wy * dt, wz * dt);
      const r = quatMul([qx, qy, qz, qw], dq);
      t.rotation = normalizeQuat(r);
      // 5) sleep 检测
      const speed = Math.hypot(rb.velocity[0], rb.velocity[1], rb.velocity[2]);
      if (speed < cfg.sleepSpeedThreshold) rb.sleeping = true;
      else rb.sleeping = false;
      // 6) 清力
      rb.force[0] = rb.force[1] = rb.force[2] = 0;
      rb.torque[0] = rb.torque[1] = rb.torque[2] = 0;
    });
  }

  private getConfig(world: World): PhysicsConfig {
    let cfg: PhysicsConfig | null = null;
    world.queryWith(PhysicsConfigC, (_id, c) => { cfg = c; });
    return cfg ?? new PhysicsConfig();
  }
}

// ── 辅助:四元数 ─────────────────────────────────────────────────

function quatFromEuler(x: number, y: number, z: number): [number, number, number, number] {
  const hx = x * 0.5, hy = y * 0.5, hz = z * 0.5;
  const sx = Math.sin(hx), cx = Math.cos(hx);
  const sy = Math.sin(hy), cy = Math.cos(hy);
  const sz = Math.sin(hz), cz = Math.cos(hz);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

function quatMul(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function normalizeQuat(q: [number, number, number, number]): [number, number, number, number] {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// ── CollisionSystem: 碰撞检测 + 响应 ────────────────────────────

export class CollisionSystem extends System {
  /** 复用容器,避免 GC。 */
  private bodyList: { id: number; t: Transform; rb: Rigidbody | null; c: Collider; aabb: AABB }[] = [];
  /** 全局 contact 队列(由 PhysicsDebugSystem 读出)。 */
  static contacts: { x: number; y: number; z: number; nx: number; ny: number; nz: number; depth: number }[] = [];

  constructor() { super('CollisionSystem', 160); }
  override update(world: World, dt: number): void {
    CollisionSystem.contacts.length = 0;
    this.bodyList.length = 0;
    // 1) 收集所有动态 + 静态 collider
    world.queryWith(ColliderC, (id, c) => {
      const t = world.getComponent(id, TransformC) as Transform | null;
      if (!t) return;
      const rb = world.getComponent(id, RigidbodyC) as Rigidbody | null;
      this.bodyList.push({ id, t, rb, c, aabb: worldAABBFromCollider(t, c) });
    });
    // 2) O(n^2) narrowphase(30 物体以下足够,后期可换 BVH/Octree)
    const n = this.bodyList.length;
    for (let i = 0; i < n; i++) {
      const A = this.bodyList[i];
      for (let j = i + 1; j < n; j++) {
        const B = this.bodyList[j];
        // 层级过滤
        if ((A.c.layerMask & B.c.layerMask) === 0) continue;
        if (A.c.isStatic && B.c.isStatic) continue;
        // Broadphase: AABB
        if (!aabbOverlap(A.aabb, B.aabb)) continue;
        // Narrowphase: sphere / AABB
        if (A.c.shape === 'sphere' && B.c.shape === 'sphere') {
          this.resolveSphereSphere(A, B, dt);
        } else if (A.c.shape === 'aabb' && B.c.shape === 'aabb') {
          this.resolveAABBAABB(A, B, dt);
        } else {
          // sphere vs aabb:简化 — 用 sphere 中心 + AABB 中心距离 + 半径
          this.resolveSphereAABB(A, B, dt);
        }
      }
    }
  }

  private resolveSphereSphere(
    A: { id: number; t: Transform; rb: Rigidbody | null; c: Collider; aabb: AABB },
    B: { id: number; t: Transform; rb: Rigidbody | null; c: Collider; aabb: AABB },
    dt: number,
  ): void {
    const r = sphereOverlap(A.t.position as [number, number, number], A.c.radius,
                            B.t.position as [number, number, number], B.c.radius);
    if (!r.overlap || !r.normal || r.depth === undefined) return;
    this.applyContact(A, B, r.normal, r.depth, dt,
      (A.t.position[0] + B.t.position[0]) * 0.5,
      (A.t.position[1] + B.t.position[1]) * 0.5,
      (A.t.position[2] + B.t.position[2]) * 0.5);
  }

  private resolveAABBAABB(
    A: { id: number; t: Transform; rb: Rigidbody | null; c: Collider; aabb: AABB },
    B: { id: number; t: Transform; rb: Rigidbody | null; c: Collider; aabb: AABB },
    dt: number,
  ): void {
    // MTV(minimum translation vector)
    const ax = (A.aabb.min[0] + A.aabb.max[0]) * 0.5;
    const ay = (A.aabb.min[1] + A.aabb.max[1]) * 0.5;
    const az = (A.aabb.min[2] + A.aabb.max[2]) * 0.5;
    const bx = (B.aabb.min[0] + B.aabb.max[0]) * 0.5;
    const by = (B.aabb.min[1] + B.aabb.max[1]) * 0.5;
    const bz = (B.aabb.min[2] + B.aabb.max[2]) * 0.5;
    const dxA = (A.aabb.max[0] - A.aabb.min[0]) * 0.5;
    const dyA = (A.aabb.max[1] - A.aabb.min[1]) * 0.5;
    const dzA = (A.aabb.max[2] - A.aabb.min[2]) * 0.5;
    const dxB = (B.aabb.max[0] - B.aabb.min[0]) * 0.5;
    const dyB = (B.aabb.max[1] - B.aabb.min[1]) * 0.5;
    const dzB = (B.aabb.max[2] - B.aabb.min[2]) * 0.5;
    const ox = dxA + dxB - Math.abs(bx - ax);
    const oy = dyA + dyB - Math.abs(by - ay);
    const oz = dzA + dzB - Math.abs(bz - az);
    if (ox <= 0 || oy <= 0 || oz <= 0) return;
    let nx = 0, ny = 0, nz = 0, depth = 0;
    if (ox < oy && ox < oz) {
      nx = bx > ax ? -1 : 1;
      depth = ox;
    } else if (oy < oz) {
      ny = by > ay ? -1 : 1;
      depth = oy;
    } else {
      nz = bz > az ? -1 : 1;
      depth = oz;
    }
    this.applyContact(A, B, [nx, ny, nz], depth, dt, (ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  }

  private resolveSphereAABB(
    A: { id: number; t: Transform; rb: Rigidbody | null; c: Collider; aabb: AABB },
    B: { id: number; t: Transform; rb: Rigidbody | null; c: Collider; aabb: AABB },
    dt: number,
  ): void {
    // assume A is sphere, B is AABB (swap if needed)
    const sphere = A.c.shape === 'sphere' ? A : B;
    const aabb = A.c.shape === 'aabb' ? A : B;
    const sp = sphere.t.position;
    const cx = Math.max(aabb.aabb.min[0], Math.min(sp[0], aabb.aabb.max[0]));
    const cy = Math.max(aabb.aabb.min[1], Math.min(sp[1], aabb.aabb.max[1]));
    const cz = Math.max(aabb.aabb.min[2], Math.min(sp[2], aabb.aabb.max[2]));
    const dx = sp[0] - cx, dy = sp[1] - cy, dz = sp[2] - cz;
    const distSq = dx * dx + dy * dy + dz * dz;
    const r = sphere.c.radius;
    if (distSq >= r * r) return;
    const dist = Math.sqrt(distSq) || 1e-6;
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    const nz = dist > 0 ? dz / dist : 0;
    this.applyContact(sphere, aabb, [nx, ny, nz], r - dist, dt, cx, cy, cz);
  }

  private applyContact(
    A: { id: number; t: Transform; rb: Rigidbody | null; c: Collider },
    B: { id: number; t: Transform; rb: Rigidbody | null; c: Collider },
    n: [number, number, number], depth: number, dt: number,
    cx: number, cy: number, cz: number,
  ): void {
    // 1) 位置修正(Baumgarte)
    const baumgarte = 0.4;
    const correction = (depth * baumgarte) / Math.max(1, (A.c.isStatic ? 0 : 1) + (B.c.isStatic ? 0 : 1));
    if (!A.c.isStatic) {
      A.t.position[0] -= n[0] * correction;
      A.t.position[1] -= n[1] * correction;
      A.t.position[2] -= n[2] * correction;
    }
    if (!B.c.isStatic) {
      B.t.position[0] += n[0] * correction;
      B.t.position[1] += n[1] * correction;
      B.t.position[2] += n[2] * correction;
    }
    // 2) 冲量响应
    if (A.rb && B.rb) {
      const va = A.rb.velocity, vb = B.rb.velocity;
      const rvx = vb[0] - va[0], rvy = vb[1] - va[1], rvz = vb[2] - va[2];
      const vn = rvx * n[0] + rvy * n[1] + rvz * n[2];
      if (vn > 0) {
        // 已经在分离方向
      } else {
        const e = Math.min(A.c.restitution, B.c.restitution);
        const invMA = A.c.isStatic ? 0 : 1 / Math.max(0.0001, A.rb.mass);
        const invMB = B.c.isStatic ? 0 : 1 / Math.max(0.0001, B.rb.mass);
        const j = -(1 + e) * vn / (invMA + invMB);
        if (!A.c.isStatic) {
          A.rb.velocity[0] -= j * invMA * n[0];
          A.rb.velocity[1] -= j * invMA * n[1];
          A.rb.velocity[2] -= j * invMA * n[2];
        }
        if (!B.c.isStatic) {
          B.rb.velocity[0] += j * invMB * n[0];
          B.rb.velocity[1] += j * invMB * n[1];
          B.rb.velocity[2] += j * invMB * n[2];
        }
      }
    }
    // 3) 记录 contact (仅保留前 64 个)
    const arr = CollisionSystem.contacts;
    if (arr.length < 64) {
      arr.push({ x: cx, y: cy, z: cz, nx: n[0], ny: n[1], nz: n[2], depth });
    }
  }
}

// ── ParticleSystem ──────────────────────────────────────────────

export class ParticleSystem extends System {
  constructor() { super('ParticleSystem', 180); }
  override update(world: World, dt: number): void {
    let g: [number, number, number] = [0, -9.81, 0];
    world.queryWith(PhysicsConfigC, (_id, c) => { g = c.gravity; });
    const [gx, gy, gz] = g;
    // 1) 已有粒子推进
    world.queryWith(ParticleC, (id, p) => {
      p.age += dt;
      if (p.age >= p.lifetime) {
        world.destroyEntity(id);
        return;
      }
      p.velocity[1] += gy * p.gravityScale * dt;
      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;
    });
    // 2) Emitter spawn
    world.queryWith(ParticleEmitterC, (id, em) => {
      const t = world.getComponent(id, TransformC) as Transform | null;
      if (!t) return;
      em.accumulator += dt;
      const interval = 1 / Math.max(0.0001, em.rate);
      while (em.accumulator >= interval && em.particleIds.length < em.maxParticles) {
        em.accumulator -= interval;
        this.spawnParticle(world, t.position, em);
      }
      // 清理已经销毁的粒子
      em.particleIds = em.particleIds.filter((pid) => world.getComponent(pid, ParticleC) != null);
    });
  }

  private spawnParticle(
    world: World, origin: [number, number, number], em: ParticleEmitter,
  ): void {
    const p = new Particle();
    const [ox, oy, oz] = origin;
    const r = em.spawnRadius;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * r;
    p.position = [ox + Math.cos(angle) * radius, oy, oz + Math.sin(angle) * radius];
    // 初速度:向上 + 随机水平
    const speed = em.speedMin + Math.random() * (em.speedMax - em.speedMin);
    const yaw = Math.random() * Math.PI * 2;
    p.velocity = [
      Math.cos(yaw) * speed * 0.5,
      speed,
      Math.sin(yaw) * speed * 0.5,
    ];
    p.lifetime = em.lifeMin + Math.random() * (em.lifeMax - em.lifeMin);
    p.age = 0;
    const lerp = Math.random();
    p.color = [
      em.colorA[0] * (1 - lerp) + em.colorB[0] * lerp,
      em.colorA[1] * (1 - lerp) + em.colorB[1] * lerp,
      em.colorA[2] * (1 - lerp) + em.colorB[2] * lerp,
    ];
    p.size = 0.05 + Math.random() * 0.05;
    const pid = world.createEntity();
    world.setComponent(pid, ParticleC, p);
    em.particleIds.push(pid);
  }
}

// ── PhysicsDebugSystem:把 contact 数据写入 PhysicsDebug 组件 ─────

export class PhysicsDebugSystem extends System {
  constructor() { super('PhysicsDebugSystem', 190); }
  override update(world: World, _dt: number): void {
    world.queryWith(PhysicsDebugC, (_id, dbg) => {
      const arr = CollisionSystem.contacts;
      dbg.contactCount = Math.min(arr.length, 64);
      for (let i = 0; i < dbg.contactCount; i++) {
        const c = arr[i];
        dbg.contactPoints[i * 7 + 0] = c.x;
        dbg.contactPoints[i * 7 + 1] = c.y;
        dbg.contactPoints[i * 7 + 2] = c.z;
        dbg.contactPoints[i * 7 + 3] = c.nx;
        dbg.contactPoints[i * 7 + 4] = c.ny;
        dbg.contactPoints[i * 7 + 5] = c.nz;
        dbg.contactPoints[i * 7 + 6] = c.depth;
      }
    });
  }
}

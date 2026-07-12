// PhysicsDebugRenderer — 把 ECS 物理状态可视化为线段。
//
// 读:World 的 Rigidbody / Collider / PhysicsDebug 组件(由 PhysicsSystem
// / CollisionSystem / PhysicsDebugSystem 写入),生成本帧的 collider 线框 +
// contact normal + velocity 矢量。每帧用 LineMesh.updateVertices 刷新。
//
// 可视化通道(通过 PhysicsDebug 组件的开关):
//   - showColliders: AABB / sphere 线框,青色,每 collider 12/24 段
//   - showContacts: contact 点 + 法线 + 切线,黄色
//   - showVelocities: 速度矢量,品红色,长度 = |v| * velocityScale
//
// 通道预算:collider 上限 256 个(每个 AABB 12 段 = 3072 段),contact 64,
// velocity 256。整合到 3 个 LineMesh,一次 draw call / channel。

import { Object3D } from '../Core/Object3D';
import { World } from '../ECS/World';
import { TransformC, Transform } from '../ECS/Components';
import {
  RigidbodyC, ColliderC, PhysicsDebugC,
  type Rigidbody, type Collider, type PhysicsDebug,
} from '../ECS/PhysicsComponents';
import { createLineMesh, LineMesh } from '../Helpers/LineHelper';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { createLogger } from '@/lib/logger';

const log = createLogger('PhysicsDebug');

const MAX_COLLIDERS = 256;
const MAX_CONTACTS = 64;
const MAX_VELOCITIES = 256;

// AABB 12 段(12 edges)
const SEG_PER_AABB = 12;
// sphere 24 段(3 圆 × 8 段)
const SEG_PER_SPHERE = 24;
const SEG_PER_CAPSULE = 32;

/** 把 Transform + Collider 展开成线段(写入 verts 的 [x1,y1,z1, x2,y2,z2, ...])。 */
function appendColliderSegments(
  t: Transform, c: Collider,
  segBudget: { left: number },
  verts: number[],
): void {
  if (segBudget.left <= 0) return;
  const [px, py, pz] = t.position;
  if (c.shape === 'aabb') {
    if (segBudget.left < SEG_PER_AABB) return;
    const [hx, hy, hz] = c.halfExtents;
    const x0 = px - hx, x1 = px + hx;
    const y0 = py - hy, y1 = py + hy;
    const z0 = pz - hz, z1 = pz + hz;
    // 底面 4 边
    verts.push(x0, y0, z0,  x1, y0, z0);
    verts.push(x1, y0, z0,  x1, y0, z1);
    verts.push(x1, y0, z1,  x0, y0, z1);
    verts.push(x0, y0, z1,  x0, y0, z0);
    // 顶面 4 边
    verts.push(x0, y1, z0,  x1, y1, z0);
    verts.push(x1, y1, z0,  x1, y1, z1);
    verts.push(x1, y1, z1,  x0, y1, z1);
    verts.push(x0, y1, z1,  x0, y1, z0);
    // 立柱 4 边
    verts.push(x0, y0, z0,  x0, y1, z0);
    verts.push(x1, y0, z0,  x1, y1, z0);
    verts.push(x1, y0, z1,  x1, y1, z1);
    verts.push(x0, y0, z1,  x0, y1, z1);
    segBudget.left -= SEG_PER_AABB;
  } else if (c.shape === 'sphere') {
    if (segBudget.left < SEG_PER_SPHERE) return;
    const r = c.radius;
    // 3 个正交圆环(每圆 8 段,实际用 8 段近似,够 debug 用)
    const STEPS = 8;
    // xy 平面
    for (let i = 0; i < STEPS; i++) {
      const a0 = (i / STEPS) * Math.PI * 2;
      const a1 = ((i + 1) / STEPS) * Math.PI * 2;
      verts.push(
        px + r * Math.cos(a0), py + r * Math.sin(a0), pz,
        px + r * Math.cos(a1), py + r * Math.sin(a1), pz,
      );
    }
    // xz 平面
    for (let i = 0; i < STEPS; i++) {
      const a0 = (i / STEPS) * Math.PI * 2;
      const a1 = ((i + 1) / STEPS) * Math.PI * 2;
      verts.push(
        px + r * Math.cos(a0), py, pz + r * Math.sin(a0),
        px + r * Math.cos(a1), py, pz + r * Math.sin(a1),
      );
    }
    // yz 平面
    for (let i = 0; i < STEPS; i++) {
      const a0 = (i / STEPS) * Math.PI * 2;
      const a1 = ((i + 1) / STEPS) * Math.PI * 2;
      verts.push(
        px, py + r * Math.cos(a0), pz + r * Math.sin(a0),
        px, py + r * Math.cos(a1), pz + r * Math.sin(a1),
      );
    }
    segBudget.left -= SEG_PER_SPHERE;
  } else { // capsule
    if (segBudget.left < SEG_PER_CAPSULE) return;
    const r = c.radius;
    const half = Math.max(c.height * 0.5, r);
    const y0 = py - half, y1 = py + half;
    // 中段长方体(8 边)
    const x0 = px - r, x1 = px + r;
    const z0 = pz - r, z1 = pz + r;
    verts.push(x0, y0, z0,  x1, y0, z0);
    verts.push(x1, y0, z0,  x1, y0, z1);
    verts.push(x1, y0, z1,  x0, y0, z1);
    verts.push(x0, y0, z1,  x0, y0, z0);
    verts.push(x0, y1, z0,  x1, y1, z0);
    verts.push(x1, y1, z0,  x1, y1, z1);
    verts.push(x1, y1, z1,  x0, y1, z1);
    verts.push(x0, y1, z1,  x0, y1, z0);
    verts.push(x0, y0, z0,  x0, y1, z0);
    verts.push(x1, y0, z0,  x1, y1, z0);
    verts.push(x1, y0, z1,  x1, y1, z1);
    verts.push(x0, y0, z1,  x0, y1, z1);
    // 顶/底圆环(8 段 × 2 = 16 段)
    const STEPS = 8;
    for (let i = 0; i < STEPS; i++) {
      const a0 = (i / STEPS) * Math.PI * 2;
      const a1 = ((i + 1) / STEPS) * Math.PI * 2;
      verts.push(px + r * Math.cos(a0), y0, pz + r * Math.sin(a0),
                 px + r * Math.cos(a1), y0, pz + r * Math.sin(a1));
      verts.push(px + r * Math.cos(a0), y1, pz + r * Math.sin(a0),
                 px + r * Math.cos(a1), y1, pz + r * Math.sin(a1));
    }
    segBudget.left -= SEG_PER_CAPSULE;
  }
}

export interface PhysicsDebugStats {
  colliderCount: number;
  contactCount: number;
  velocityCount: number;
  sleepingCount: number;
  totalBodies: number;
}

export class PhysicsDebugRenderer {
  readonly group: Object3D;
  readonly colliderLines: LineMesh;
  readonly contactLines: LineMesh;
  readonly velocityLines: LineMesh;
  /** 最新一帧统计(供 HUD 读)。 */
  stats: PhysicsDebugStats = {
    colliderCount: 0, contactCount: 0,
    velocityCount: 0, sleepingCount: 0, totalBodies: 0,
  };

  private _renderer: WebGL2Renderer;
  private _colliderBuf = new Float32Array(MAX_COLLIDERS * 24 * 6);
  private _contactBuf = new Float32Array(MAX_CONTACTS * 5 * 6);
  private _velocityBuf = new Float32Array(MAX_VELOCITIES * 1 * 6);

  constructor(renderer: WebGL2Renderer) {
    this._renderer = renderer;
    this.group = new Object3D();
    this.group.name = 'PhysicsDebug';

    // 青色 collider 框
    this.colliderLines = createLineMesh(renderer, MAX_COLLIDERS * 24, [0, 0.85, 1], 0.7);
    this.colliderLines.name = 'PhysicsDebug/Colliders';
    this.group.add(this.colliderLines);

    // 黄色 contact(点 + normal + tangent + bitangent = 5 段 / contact)
    this.contactLines = createLineMesh(renderer, MAX_CONTACTS * 5, [1, 0.85, 0.2], 0.95);
    this.contactLines.name = 'PhysicsDebug/Contacts';
    this.group.add(this.contactLines);

    // 品红 velocity(每刚体 1 段)
    this.velocityLines = createLineMesh(renderer, MAX_VELOCITIES, [1, 0.2, 0.85], 0.9);
    this.velocityLines.name = 'PhysicsDebug/Velocities';
    this.group.add(this.velocityLines);

    log.info(`init: collider budget ${MAX_COLLIDERS}, contact ${MAX_CONTACTS}, velocity ${MAX_VELOCITIES}`);
  }

  /** 每帧调一次,从 world 读 collider/contact/rigidbody 状态写入 LineMesh。 */
  update(world: World): void {
    // 1) 拿 PhysicsDebug 通道开关(若没有 PhysicsDebug 实体,默认全开)
    let showColliders = true;
    let showContacts = true;
    let showVelocities = true;
    let velocityScale = 0.5;
    let dbg: PhysicsDebug | null = null;
    const queryOne = <T>(t: { id: number; name: string }): T | null => {
      let out: T | null = null;
      // 绕过 queryWith 的泛型推断问题:这里知道回调收到的就是 T。
      (world.queryWith as (tt: typeof t, fn: (id: number, d: unknown) => void) => void)(t, (_id, d) => {
        out = d as T;
      });
      return out;
    };
    dbg = queryOne<PhysicsDebug>(PhysicsDebugC);
    if (dbg) {
      showColliders = dbg.showColliders;
      showContacts = dbg.showContacts;
      showVelocities = dbg.showVelocities;
      velocityScale = dbg.velocityScale;
    }

    // 2) colliders
    let colliderCount = 0;
    let sleepingCount = 0;
    let totalBodies = 0;
    if (showColliders) {
      const tmp: number[] = [];
      let usedSegs = 0;
      const segCap = MAX_COLLIDERS * 24;
      (world.queryWith as (t: typeof ColliderC, fn: (id: number, c: Collider) => void) => void)(
        ColliderC,
        (id, c: Collider) => {
          const t = world.getComponent(id, TransformC) as Transform | null;
          if (!t) return;
          const subBudget = { left: segCap - usedSegs };
          const before = tmp.length;
          appendColliderSegments(t, c, subBudget, tmp);
          usedSegs += (tmp.length - before) / 6;
          if (usedSegs >= segCap) {
            // 满了,但仍计数
          }
        },
      );
      this._colliderBuf.set(tmp);
      colliderCount = tmp.length / 6;
    }
    this.colliderLines.updateVertices(this._colliderBuf.subarray(0, colliderCount * 6));
    this.colliderLines.visible = showColliders;

    // 3) contacts (从 PhysicsDebug 组件读)
    let contactCount = 0;
    if (showContacts && dbg) {
      const v = this._contactBuf;
      const n = Math.min(dbg.contactCount, MAX_CONTACTS);
      for (let i = 0; i < n; i++) {
        const cx = dbg.contactPoints[i * 7 + 0];
        const cy = dbg.contactPoints[i * 7 + 1];
        const cz = dbg.contactPoints[i * 7 + 2];
        const nx = dbg.contactPoints[i * 7 + 3];
        const ny = dbg.contactPoints[i * 7 + 4];
        const nz = dbg.contactPoints[i * 7 + 5];
        const depth = dbg.contactPoints[i * 7 + 6];
        // 段 1: normal(原点 → +normal × 0.4)
        const nxLen = 0.4;
        v[i * 30 + 0] = cx;
        v[i * 30 + 1] = cy;
        v[i * 30 + 2] = cz;
        v[i * 30 + 3] = cx + nx * nxLen;
        v[i * 30 + 4] = cy + ny * nxLen;
        v[i * 30 + 5] = cz + nz * nxLen;
        // 段 2: 切线 1 (tangent via 世界 up × normal,再 normalize)
        let tx = 0, ty = 1, tz = 0;
        if (Math.abs(ny) > 0.9) { tx = 1; ty = 0; tz = 0; } // 平行 Y 退到 X
        // t = up × n
        const upX = tx, upY = ty, upZ = tz;
        let ttx = upY * nz - upZ * ny;
        let tty = upZ * nx - upX * nz;
        let ttz = upX * ny - upY * nx;
        const ttlen = Math.hypot(ttx, tty, ttz) || 1;
        ttx /= ttlen; tty /= ttlen; ttz /= ttlen;
        const tLen = 0.18;
        v[i * 30 + 6] = cx;
        v[i * 30 + 7] = cy;
        v[i * 30 + 8] = cz;
        v[i * 30 + 9] = cx + ttx * tLen;
        v[i * 30 + 10] = cy + tty * tLen;
        v[i * 30 + 11] = cz + ttz * tLen;
        // 段 3: bitangent (n × t)
        const bx = ny * ttz - nz * tty;
        const by = nz * ttx - nx * ttz;
        const bz = nx * tty - ny * ttx;
        v[i * 30 + 12] = cx;
        v[i * 30 + 13] = cy;
        v[i * 30 + 14] = cz;
        v[i * 30 + 15] = cx + bx * tLen;
        v[i * 30 + 16] = cy + by * tLen;
        v[i * 30 + 17] = cz + bz * tLen;
        // 段 4: depth 反向(原点 → -normal × depth,提示穿透量)
        v[i * 30 + 18] = cx;
        v[i * 30 + 19] = cy;
        v[i * 30 + 20] = cz;
        v[i * 30 + 21] = cx - nx * depth;
        v[i * 30 + 22] = cy - ny * depth;
        v[i * 30 + 23] = cz - nz * depth;
        // 段 5: 反向 normal(显示 -n 方向,提示分离方向)
        v[i * 30 + 24] = cx;
        v[i * 30 + 25] = cy;
        v[i * 30 + 26] = cz;
        v[i * 30 + 27] = cx - nx * nxLen;
        v[i * 30 + 28] = cy - ny * nxLen;
        v[i * 30 + 29] = cz - nz * nxLen;
      }
      contactCount = n;
    }
    this.contactLines.updateVertices(this._contactBuf.subarray(0, contactCount * 30));
    this.contactLines.visible = showContacts;

    // 4) velocities
    let velocityCount = 0;
    if (showVelocities) {
      const v = this._velocityBuf;
      let wi = 0;
      world.queryWith2<Transform, Rigidbody>(TransformC, RigidbodyC, (id, t, rb) => {
        if (rb.mass <= 0) return; // 静态不画
        totalBodies++;
        if (rb.sleeping) sleepingCount++;
        if (wi >= v.length) return;
        const speed = Math.hypot(rb.velocity[0], rb.velocity[1], rb.velocity[2]);
        if (speed < 1e-4) return; // 静止跳过
        const len = speed * velocityScale;
        v[wi + 0] = t.position[0];
        v[wi + 1] = t.position[1];
        v[wi + 2] = t.position[2];
        v[wi + 3] = t.position[0] + rb.velocity[0] / speed * len;
        v[wi + 4] = t.position[1] + rb.velocity[1] / speed * len;
        v[wi + 5] = t.position[2] + rb.velocity[2] / speed * len;
        wi += 6;
      });
      velocityCount = wi / 6;
    }
    this.velocityLines.updateVertices(this._velocityBuf.subarray(0, velocityCount * 6));
    this.velocityLines.visible = showVelocities;

    this.stats = { colliderCount, contactCount, velocityCount, sleepingCount, totalBodies };
  }

  dispose(): void {
    this.colliderLines.geometry.dispose();
    this.contactLines.geometry.dispose();
    this.velocityLines.geometry.dispose();
  }
}

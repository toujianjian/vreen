// DestructionSystem — 网格破碎系统(切割 / 碎裂 + 碎片物理)。
//
// 设计:
//   - shatter(geometry, position, impactForce, fragmentCount):
//     用 VoronoiFracture 把 geometry 破碎成 fragmentCount 块,每块获得初始速度
//     方向 = (站点 - 冲击点) 归一化,大小 ∝ impactForce
//   - slice(geometry, plane):用平面把 geometry 切成两半,返回 [inside, outside]
//     inside = 平面法线指向的负侧(dist<=0),outside = 正侧(dist>0)
//   - update(dt):每帧推进碎片物理(重力 + 线速度 + 角速度)+ lifetime 衰减
//   - applyForce(i, F):对碎片 i 累加力(下次 update 时转成加速度)
//
// 与引擎的集成:
//   - Fragment.mesh 是 BufferGeometry(仅 position,调用方可 computeVertexNormals)
//   - Fragment.position / rotation 是世界变换,调用方据此构造 Matrix4 渲染
//   - 系统不直接渲染,只产出几何 + 变换状态
//
// 与 ClothSimulation / FluidSimulation 的关系:
//   三者都是独立物理子系统(布料/流体/破碎),通过 BufferGeometry 接口与引擎解耦。
//   后续可包装为 DestructionComponent + DestructionSystem(ECS)接入主物理管线。

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { Plane } from '../Math/Plane';
import { VoronoiFracture } from './VoronoiFracture';

/** 单个碎片。 */
export interface Fragment {
  /** 碎片几何(非索引化,仅 position)。 */
  mesh: BufferGeometry;
  /** 当前世界位置(由 update 推进)。 */
  position: Vector3;
  /** 当前世界旋转(由 update 推进,基于角速度)。 */
  rotation: Quaternion;
  /** 线速度(m/s)。 */
  velocity: Vector3;
  /** 角速度(轴-角形式,rad/s;方向 = 旋转轴,模长 = 角速率)。 */
  angularVelocity: Vector3;
  /** 质量(kg)。 */
  mass: number;
  /** 剩余寿命(s);<= 0 表示过期。 */
  lifetime: number;
  /** 初始寿命(用于归一化)。 */
  maxLifetime: number;
  /** 初始位置(冲击点的相对偏移基准)。 */
  originalPosition: Vector3;
  /** 累积力(由 applyForce 写入,update 后清零)。 */
  force: Vector3;
  /** 是否活跃(false = 已过期或被移除,不再参与 update)。 */
  active: boolean;
}

export interface DestructionOptions {
  /** 最大碎片数(超过则丢弃多余的);默认 256。 */
  maxFragments?: number;
  /** 重力加速度(m/s²);默认 (0,-9.8,0)。 */
  gravity?: Vector3;
  /** 默认碎片寿命(s);默认 5。 */
  defaultLifetime?: number;
  /** 默认碎片质量(kg);默认 1。 */
  defaultMass?: number;
  /** VoronoiFracture 实例(可注入用于确定性测试)。 */
  fracture?: VoronoiFracture;
}

export interface DestructionStats {
  total: number;
  active: number;
  expired: number;
}

/** 切片结果:[内侧(法线负侧), 外侧(法线正侧)]。任一侧可能为 null(完全在一侧)。 */
export type SliceResult = [BufferGeometry | null, BufferGeometry | null];

/** 三角形顶点(仅位置)。 */
interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

export class DestructionSystem {
  fragments: Fragment[] = [];
  /** 最大碎片数。 */
  maxFragments: number;
  /** 重力加速度。 */
  gravity: Vector3;
  /** 默认寿命(s)。 */
  defaultLifetime: number;
  /** 默认质量(kg)。 */
  defaultMass: number;
  /** Voronoi 破碎器(懒构造)。 */
  private _fracture: VoronoiFracture | null;

  constructor(opts: DestructionOptions = {}) {
    this.maxFragments = opts.maxFragments ?? 256;
    this.gravity = opts.gravity ?? new Vector3(0, -9.8, 0);
    this.defaultLifetime = opts.defaultLifetime ?? 5;
    this.defaultMass = opts.defaultMass ?? 1;
    this._fracture = opts.fracture ?? null;
  }

  /** 获取 / 懒构造 VoronoiFracture 实例。 */
  private _getFracture(): VoronoiFracture {
    if (!this._fracture) this._fracture = new VoronoiFracture();
    return this._fracture;
  }

  /** 把 geometry 在 position 处以 impactForce 碎裂成 fragmentCount 块。
   *  每块初始速度方向 = (站点 - position) 归一化,大小 = impactForce。
   *  返回新增碎片数(若达到 maxFragments 可能小于 fragmentCount)。 */
  shatter(
    geometry: BufferGeometry,
    position: Vector3,
    impactForce: number,
    fragmentCount: number,
  ): number {
    if (fragmentCount <= 0) {
      throw new Error(`DestructionSystem.shatter: fragmentCount must be > 0 (got ${fragmentCount})`);
    }
    if (impactForce < 0) {
      throw new Error(`DestructionSystem.shatter: impactForce must be >= 0 (got ${impactForce})`);
    }
    const fracture = this._getFracture();
    const sites = fracture.generateSites(geometry, fragmentCount);
    const pieces = fracture.fracture(geometry, sites);
    let added = 0;
    for (let i = 0; i < pieces.length; i++) {
      if (this.fragments.length >= this.maxFragments) break;
      const piece = pieces[i];
      const site = sites[i];
      // 站点 → 初始速度方向
      const dir = new Vector3().subVectors(site.position, position);
      const len = dir.length();
      if (len > 1e-9) dir.divideScalar(len);
      else dir.set(0, 1, 0); // 站点正好在冲击点 → 默认向上
      const vel = dir.multiplyScalar(impactForce);
      // 加点随机角速度(围绕随机轴)
      const angVel = new Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
      ).multiplyScalar(impactForce * 0.5);
      const frag: Fragment = {
        mesh: piece,
        position: site.position.clone(),
        rotation: new Quaternion(),
        velocity: vel,
        angularVelocity: angVel,
        mass: this.defaultMass,
        lifetime: this.defaultLifetime,
        maxLifetime: this.defaultLifetime,
        originalPosition: site.position.clone(),
        force: new Vector3(),
        active: true,
      };
      this.fragments.push(frag);
      added++;
    }
    return added;
  }

  /** 用平面切割 geometry,返回 [内侧, 外侧]。
   *  内侧 = 平面 dist<=0 一侧(法线负侧),外侧 = dist>0 一侧。
   *  完全在一侧时,另一侧返回 null。 */
  slice(geometry: BufferGeometry, plane: Plane): SliceResult {
    const tris = this._extractTriangles(geometry);
    if (tris.length === 0) return [null, null];
    const inside: Tri[] = [];
    const outside: Tri[] = [];
    const nx = plane.normal.x;
    const ny = plane.normal.y;
    const nz = plane.normal.z;
    const d = plane.constant;
    for (const t of tris) {
      const da = nx * t.ax + ny * t.ay + nz * t.az + d;
      const db = nx * t.bx + ny * t.by + nz * t.bz + d;
      const dc = nx * t.cx + ny * t.cy + nz * t.cz + d;
      const insideA = da <= 0;
      const insideB = db <= 0;
      const insideC = dc <= 0;
      const insideCount = (insideA ? 1 : 0) + (insideB ? 1 : 0) + (insideC ? 1 : 0);
      const outsideCount = 3 - insideCount;
      if (insideCount === 3) {
        inside.push(t);
      } else if (outsideCount === 3) {
        outside.push(t);
      } else {
        // 跨平面:分裂成 inside / outside 两部分
        this._splitTriangleByPlane(t, da, db, dc, inside, outside);
      }
    }
    const insideGeo = inside.length > 0 ? this._buildGeometry(inside) : null;
    const outsideGeo = outside.length > 0 ? this._buildGeometry(outside) : null;
    return [insideGeo, outsideGeo];
  }

  /** 推进一帧:对每个活跃碎片执行物理积分 + 寿命衰减。
   *  • 加速度 = (force + gravity * mass) / mass
   *  • 半隐式 Euler: v += a*dt, x += v*dt
   *  • 角速度积分四元数:q *= quat(axis, |ω|*dt)
   *  • lifetime -= dt,<= 0 标记 active=false */
  update(dt: number): void {
    const step = Math.min(dt, 1 / 30);
    const g = this.gravity;
    for (const f of this.fragments) {
      if (!f.active) continue;
      // 加速度 = (force + m*g) / m = force/m + g
      const invM = f.mass > 0 ? 1 / f.mass : 0;
      const ax = f.force.x * invM + g.x;
      const ay = f.force.y * invM + g.y;
      const az = f.force.z * invM + g.z;
      // v += a*dt
      f.velocity.x += ax * step;
      f.velocity.y += ay * step;
      f.velocity.z += az * step;
      // x += v*dt
      f.position.x += f.velocity.x * step;
      f.position.y += f.velocity.y * step;
      f.position.z += f.velocity.z * step;
      // 角速度 → 四元数增量
      const angMag = f.angularVelocity.length();
      if (angMag > 1e-9) {
        const axis = new Vector3(
          f.angularVelocity.x / angMag,
          f.angularVelocity.y / angMag,
          f.angularVelocity.z / angMag,
        );
        const dq = new Quaternion().setFromAxisAngle(axis, angMag * step);
        f.rotation.premultiply(dq);
      }
      // 力清零
      f.force.set(0, 0, 0);
      // 寿命衰减
      f.lifetime -= step;
      if (f.lifetime <= 0) {
        f.lifetime = 0;
        f.active = false;
      }
    }
  }

  /** 对碎片 i 累加力(下次 update 时积分)。 */
  applyForce(fragmentIndex: number, force: Vector3): this {
    if (fragmentIndex < 0 || fragmentIndex >= this.fragments.length) {
      throw new Error(`DestructionSystem.applyForce: index out of range (${fragmentIndex})`);
    }
    const f = this.fragments[fragmentIndex];
    if (!f.active) return this;
    f.force.add(force);
    return this;
  }

  /** 移除碎片(swap-with-tail O(1),不保证顺序)。 */
  removeFragment(index: number): this {
    if (index < 0 || index >= this.fragments.length) {
      throw new Error(`DestructionSystem.removeFragment: index out of range (${index})`);
    }
    const last = this.fragments.length - 1;
    if (index !== last) {
      this.fragments[index] = this.fragments[last];
    }
    this.fragments.pop();
    return this;
  }

  /** 获取所有活跃碎片(过滤已过期/已移除)。 */
  getActiveFragments(): Fragment[] {
    return this.fragments.filter((f) => f.active);
  }

  /** 清除所有碎片。 */
  clear(): this {
    this.fragments = [];
    return this;
  }

  /** 返回统计:总数 / 活跃 / 过期。 */
  getStats(): DestructionStats {
    let active = 0;
    let expired = 0;
    for (const f of this.fragments) {
      if (f.active) active++;
      else expired++;
    }
    return { total: this.fragments.length, active, expired };
  }

  // ---------- 内部辅助:与 VoronoiFracture 平行的三角形裁剪 ----------

  /** 把 BufferGeometry 解码为三角形列表(展开索引)。 */
  private _extractTriangles(geometry: BufferGeometry): Tri[] {
    const pos = geometry.attributes.position;
    if (!pos) return [];
    const p = pos.array;
    const tris: Tri[] = [];
    const idx = geometry.index;
    if (idx) {
      const ia = idx.array as unknown as ArrayLike<number>;
      const triCount = Math.floor(ia.length / 3);
      for (let i = 0; i < triCount; i++) {
        const a = ia[i * 3] * 3;
        const b = ia[i * 3 + 1] * 3;
        const c = ia[i * 3 + 2] * 3;
        tris.push({
          ax: p[a], ay: p[a + 1], az: p[a + 2],
          bx: p[b], by: p[b + 1], bz: p[b + 2],
          cx: p[c], cy: p[c + 1], cz: p[c + 2],
        });
      }
    } else {
      const triCount = Math.floor(p.length / 9);
      for (let i = 0; i < triCount; i++) {
        const a = i * 9;
        tris.push({
          ax: p[a],     ay: p[a + 1], az: p[a + 2],
          bx: p[a + 3], by: p[a + 4], bz: p[a + 5],
          cx: p[a + 6], cy: p[a + 7], cz: p[a + 8],
        });
      }
    }
    return tris;
  }

  /** 把跨平面的三角形分裂成内侧 + 外侧两组三角形,追加到对应数组。
   *  da/db/dc 为三顶点到平面的有符号距离。 */
  private _splitTriangleByPlane(
    t: Tri,
    da: number, db: number, dc: number,
    insideOut: Tri[],
    outsideOut: Tri[],
  ): void {
    const insideA = da <= 0;
    const insideB = db <= 0;
    const insideC = dc <= 0;
    const insideCount = (insideA ? 1 : 0) + (insideB ? 1 : 0) + (insideC ? 1 : 0);

    const lerp = (ax: number, ay: number, az: number,
                  bx: number, by: number, bz: number,
                  da: number, db: number): [number, number, number] => {
      const t = da / (da - db);
      return [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
    };

    if (insideCount === 1) {
      // 1 内:内侧得 1 三角形,外侧得 2 三角形(quad)
      if (insideA) {
        const [px, py, pz] = lerp(t.ax, t.ay, t.az, t.bx, t.by, t.bz, da, db);
        const [qx, qy, qz] = lerp(t.ax, t.ay, t.az, t.cx, t.cy, t.cz, da, dc);
        // inside: (a, p, q)
        insideOut.push({ ax: t.ax, ay: t.ay, az: t.az, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
        // outside: (p, b, c) + (p, c, q)
        outsideOut.push({
          ax: px, ay: py, az: pz,
          bx: t.bx, by: t.by, bz: t.bz,
          cx: t.cx, cy: t.cy, cz: t.cz,
        });
        outsideOut.push({
          ax: px, ay: py, az: pz,
          bx: t.cx, by: t.cy, bz: t.cz,
          cx: qx, cy: qy, cz: qz,
        });
      } else if (insideB) {
        const [px, py, pz] = lerp(t.bx, t.by, t.bz, t.ax, t.ay, t.az, db, da);
        const [qx, qy, qz] = lerp(t.bx, t.by, t.bz, t.cx, t.cy, t.cz, db, dc);
        insideOut.push({ ax: t.bx, ay: t.by, az: t.bz, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
        outsideOut.push({
          ax: px, ay: py, az: pz,
          bx: t.ax, by: t.ay, bz: t.az,
          cx: t.cx, cy: t.cy, cz: t.cz,
        });
        outsideOut.push({
          ax: px, ay: py, az: pz,
          bx: t.cx, by: t.cy, bz: t.cz,
          cx: qx, cy: qy, cz: qz,
        });
      } else {
        const [px, py, pz] = lerp(t.cx, t.cy, t.cz, t.ax, t.ay, t.az, dc, da);
        const [qx, qy, qz] = lerp(t.cx, t.cy, t.cz, t.bx, t.by, t.bz, dc, db);
        insideOut.push({ ax: t.cx, ay: t.cy, az: t.cz, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
        outsideOut.push({
          ax: px, ay: py, az: pz,
          bx: t.ax, by: t.ay, bz: t.az,
          cx: t.bx, cy: t.by, cz: t.bz,
        });
        outsideOut.push({
          ax: px, ay: py, az: pz,
          bx: t.bx, by: t.by, bz: t.bz,
          cx: qx, cy: qy, cz: qz,
        });
      }
    } else {
      // 2 内:内侧得 2 三角形(quad),外侧得 1 三角形
      if (!insideA) {
        // b, c 内
        const [pbx, pby, pbz] = lerp(t.bx, t.by, t.bz, t.ax, t.ay, t.az, db, da);
        const [pcx, pcy, pcz] = lerp(t.cx, t.cy, t.cz, t.ax, t.ay, t.az, dc, da);
        // inside: (b, c, pc) + (b, pc, pb)
        insideOut.push({
          ax: t.bx, ay: t.by, az: t.bz,
          bx: t.cx, by: t.cy, bz: t.cz,
          cx: pcx, cy: pcy, cz: pcz,
        });
        insideOut.push({
          ax: t.bx, ay: t.by, az: t.bz,
          bx: pcx, by: pcy, bz: pcz,
          cx: pbx, cy: pby, cz: pbz,
        });
        // outside: (a, pb, pc)
        outsideOut.push({
          ax: t.ax, ay: t.ay, az: t.az,
          bx: pbx, by: pby, bz: pbz,
          cx: pcx, cy: pcy, cz: pcz,
        });
      } else if (!insideB) {
        // a, c 内
        const [pax, pay, paz] = lerp(t.ax, t.ay, t.az, t.bx, t.by, t.bz, da, db);
        const [pcx, pcy, pcz] = lerp(t.cx, t.cy, t.cz, t.bx, t.by, t.bz, dc, db);
        insideOut.push({
          ax: t.ax, ay: t.ay, az: t.az,
          bx: t.cx, by: t.cy, bz: t.cz,
          cx: pcx, cy: pcy, cz: pcz,
        });
        insideOut.push({
          ax: t.ax, ay: t.ay, az: t.az,
          bx: pcx, by: pcy, bz: pcz,
          cx: pax, cy: pay, cz: paz,
        });
        outsideOut.push({
          ax: t.bx, ay: t.by, az: t.bz,
          bx: pax, by: pay, bz: paz,
          cx: pcx, cy: pcy, cz: pcz,
        });
      } else {
        // !insideC: a, b 内
        const [pax, pay, paz] = lerp(t.ax, t.ay, t.az, t.cx, t.cy, t.cz, da, dc);
        const [pbx, pby, pbz] = lerp(t.bx, t.by, t.bz, t.cx, t.cy, t.cz, db, dc);
        insideOut.push({
          ax: t.ax, ay: t.ay, az: t.az,
          bx: t.bx, by: t.by, bz: t.bz,
          cx: pbx, cy: pby, cz: pbz,
        });
        insideOut.push({
          ax: t.ax, ay: t.ay, az: t.az,
          bx: pbx, by: pby, bz: pbz,
          cx: pax, cy: pay, cz: paz,
        });
        outsideOut.push({
          ax: t.cx, ay: t.cy, az: t.cz,
          bx: pax, by: pay, bz: paz,
          cx: pbx, cy: pby, cz: pbz,
        });
      }
    }
  }

  /** 把三角形列表组装为非索引化 BufferGeometry(仅 position 属性)。 */
  private _buildGeometry(tris: Tri[]): BufferGeometry {
    const positions = new Float32Array(tris.length * 9);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const o = i * 9;
      positions[o] = t.ax;     positions[o + 1] = t.ay; positions[o + 2] = t.az;
      positions[o + 3] = t.bx; positions[o + 4] = t.by; positions[o + 5] = t.bz;
      positions[o + 6] = t.cx; positions[o + 7] = t.cy; positions[o + 8] = t.cz;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

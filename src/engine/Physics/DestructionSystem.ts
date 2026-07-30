// DestructionSystem — 物体破坏系统(切片 / 碎裂 / 形变 + 碎片物理)。
//
// 设计:
//   * destructibles: Map<id, Destructible> 管理可破坏物体(血量 / 破坏阈值 / 几何)
//   * applyDamage / applyForce 累积伤害或冲击,达到阈值时自动 breakObject
//   * breakObject / shatter 用 VoronoiFracture 把 mesh 破碎成碎片,每片获得
//     初始速度(方向 = 站点 - 冲击点,大小 = 冲击力)
//   * slice 用平面把 mesh 切成内侧 / 外侧两块,各自成为碎片
//   * deform 就地推移 mesh 顶点(不破碎),模拟凹陷
//   * update(dt) 推进碎片物理(重力 + 线速度 + 角速度积分四元数)+ 寿命衰减
//
// 与引擎的集成:
//   * Destructible.mesh / Fragment.mesh 是 BufferGeometry(仅 position)
//   * 系统不直接渲染,只产出几何 + 变换状态,调用方据此构造 Matrix4 渲染
//   * 与 ClothSimulation / FluidSimulation 互补,三者都是独立物理子系统
//
// 与 VoronoiFracture 的关系:
//   DestructionSystem 内部委托 VoronoiFracture 做几何碎裂,自身负责
//   物体注册 / 伤害判定 / 碎片物理积分 / 生命周期管理。

import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { VoronoiFracture } from './VoronoiFracture';

/** 切片平面:normal · point + distance <= 0 为内侧。 */
export interface SlicePlane {
  /** 平面法线(建议归一化)。 */
  normal: Vector3;
  /** 平面到原点的有符号距离。 */
  distance: number;
}

/** 单个碎片。
 *  注:rotation 为物理积分所需字段(角速度积分目标),虽不在最小字段清单中但为
 *  update(dt) 角动量推进所必需。 */
export interface Fragment {
  /** 碎片唯一 id。 */
  id: number;
  /** 当前世界位置(由 update 推进)。 */
  position: Vector3;
  /** 当前世界旋转(由 update 推进,基于角速度)。 */
  rotation: Quaternion;
  /** 线速度(m/s)。 */
  velocity: Vector3;
  /** 角速度(轴-角形式,rad/s;方向 = 旋转轴,模长 = 角速率)。 */
  angularVelocity: Vector3;
  /** 均匀缩放。 */
  scale: number;
  /** 剩余寿命(s);<= 0 表示过期。 */
  lifetime: number;
  /** 碎片几何(非索引化,仅 position)。 */
  mesh: BufferGeometry;
  /** 质量(kg)。 */
  mass: number;
}

/** 可破坏物体。 */
export interface Destructible {
  /** 物体 id(由调用方指定)。 */
  id: number;
  /** 原始几何。 */
  mesh: BufferGeometry;
  /** 世界位置。 */
  position: Vector3;
  /** 当前血量。 */
  health: number;
  /** 最大血量。 */
  maxHealth: number;
  /** 破坏所需冲击力阈值(与系统 breakThreshold 取较大值生效)。 */
  breakForce: number;
  /** 材质标识(由调用方解释,系统不消费)。 */
  material: string;
  /** 是否已破碎。 */
  isBroken: boolean;
  /** 该物体破碎后产生的碎片(历史记录,不过滤过期)。 */
  fragments: Fragment[];
}

/** 破坏系统统计。 */
export interface DestructionStats {
  /** 已注册可破坏物体数。 */
  destructibles: number;
  /** 已破碎物体数。 */
  broken: number;
  /** 系统当前碎片总数(含过期未清理)。 */
  fragments: number;
  /** 活跃碎片数(lifetime > 0)。 */
  activeFragments: number;
}

/** 切片结果:[内侧(法线负侧), 外侧(法线正侧)]。任一侧可能为 null。 */
export type SliceResult = [BufferGeometry | null, BufferGeometry | null];

/** 三角形顶点(仅位置)。 */
interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

/** 默认破碎碎片数。 */
const DEFAULT_FRAGMENT_COUNT = 4;
/** 默认碎片寿命(s)。 */
const DEFAULT_FRAGMENT_LIFETIME = 5;
/** 默认碎片质量(kg)。 */
const DEFAULT_FRAGMENT_MASS = 1;
/** 默认破坏力阈值。 */
const DEFAULT_BREAK_THRESHOLD = 10;
/** 默认最大碎片数。 */
const DEFAULT_MAX_FRAGMENTS = 256;

export class DestructionSystem {
  /** 已注册的可破坏物体(id → Destructible)。 */
  destructibles: Map<number, Destructible> = new Map();
  /** 系统级活跃碎片列表(由 update 推进,过期后移除)。 */
  fragments: Fragment[] = [];
  /** 最大碎片数(超过则丢弃新增)。 */
  maxFragments: number;
  /** 当前切片平面(可被 slice 复用,null 表示无)。 */
  slicePlane: SlicePlane | null = null;
  /** 系统级破坏力阈值(applyForce 冲击力 >= max(breakThreshold, breakForce) 时破碎)。 */
  breakThreshold: number;
  /** 重力加速度(m/s²)。 */
  gravity: Vector3;
  /** Voronoi 破碎器(懒构造)。 */
  private _fracture: VoronoiFracture | null = null;
  /** 碎片 id 自增计数器。 */
  private _fragmentId = 0;

  constructor() {
    this.maxFragments = DEFAULT_MAX_FRAGMENTS;
    this.breakThreshold = DEFAULT_BREAK_THRESHOLD;
    this.gravity = new Vector3(0, -9.8, 0);
  }

  /** 注册可破坏物体。若 id 已存在则覆盖。 */
  registerDestructible(id: number, destructible: Destructible): this {
    this.destructibles.set(id, destructible);
    return this;
  }

  /** 注销可破坏物体(不清理其产生的碎片)。 */
  unregisterDestructible(id: number): this {
    this.destructibles.delete(id);
    return this;
  }

  /** 施加伤害:health -= damage,血量归零时自动破碎。
   *  point: 冲击点(世界坐标)。 */
  applyDamage(id: number, damage: number, point: Vector3): this {
    const d = this.destructibles.get(id);
    if (!d || d.isBroken || damage <= 0) return this;
    d.health -= damage;
    if (d.health <= 0) {
      d.health = 0;
      this.breakObject(id, point, new Vector3(0, 0, 0));
    }
    return this;
  }

  /** 施加力:冲击力 >= max(breakThreshold, breakForce) 时自动破碎。
   *  point: 冲击点(世界坐标)。 */
  applyForce(id: number, force: Vector3, point: Vector3): this {
    const d = this.destructibles.get(id);
    if (!d || d.isBroken) return this;
    const mag = force.length();
    const threshold = Math.max(this.breakThreshold, d.breakForce);
    if (mag >= threshold) {
      this.breakObject(id, point, force);
    }
    return this;
  }

  /** 破碎物体(生成 Voronoi 碎片)。force 决定碎片初始速度大小。
   *  已破碎或未注册的物体调用此方法为空操作。 */
  breakObject(id: number, point: Vector3, force: Vector3): this {
    const d = this.destructibles.get(id);
    if (!d || d.isBroken) return this;
    d.isBroken = true;
    this._shatterInternal(d, point, force.length(), DEFAULT_FRAGMENT_COUNT);
    return this;
  }

  /** 切片破坏:用平面把 mesh 切成内侧 / 外侧两块,各自成为碎片。
   *  plane: 切片平面。 */
  slice(id: number, plane: SlicePlane): this {
    const d = this.destructibles.get(id);
    if (!d || d.isBroken) return this;
    d.isBroken = true;
    const [inside, outside] = this._sliceGeometry(d.mesh, plane);
    const forceMag = 2; // 切片时给碎片一个小的分离速度
    const normal = plane.normal.clone();
    if (normal.lengthSq() > 0) normal.normalize();
    if (inside) {
      this._addFragment(d, inside, d.position.clone(), normal.clone().multiplyScalar(-forceMag));
    }
    if (outside) {
      this._addFragment(d, outside, d.position.clone(), normal.clone().multiplyScalar(forceMag));
    }
    return this;
  }

  /** 碎裂:把物体破碎成 fragmentCount 块。force 决定碎片初始速度大小。
   *  已破碎或未注册的物体调用此方法为空操作。 */
  shatter(id: number, point: Vector3, fragmentCount: number): this {
    const d = this.destructibles.get(id);
    if (!d || d.isBroken) return this;
    if (fragmentCount <= 0) {
      throw new Error(`DestructionSystem.shatter: fragmentCount must be > 0 (got ${fragmentCount})`);
    }
    d.isBroken = true;
    this._shatterInternal(d, point, 0, fragmentCount);
    return this;
  }

  /** 形变:就地推移 mesh 顶点(不破碎)。force 决定形变范围与深度。 */
  deform(id: number, point: Vector3, force: Vector3): this {
    const d = this.destructibles.get(id);
    if (!d || d.isBroken) return this;
    const pos = d.mesh.attributes.position;
    if (!pos) return this;
    const arr = pos.array;
    const forceMag = force.length();
    if (forceMag <= 0) return this;
    const radius = 0.5 + forceMag * 0.1;
    const strength = forceMag * 0.05;
    // 把冲击点转换到几何局部坐标(几何默认在原点,position 为世界偏移)
    const px = point.x - d.position.x;
    const py = point.y - d.position.y;
    const pz = point.z - d.position.z;
    for (let i = 0; i < arr.length; i += 3) {
      const dx = arr[i] - px;
      const dy = arr[i + 1] - py;
      const dz = arr[i + 2] - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < radius && dist > 1e-6) {
        const factor = (1 - dist / radius) * strength;
        arr[i] += (dx / dist) * factor;
        arr[i + 1] += (dy / dist) * factor;
        arr[i + 2] += (dz / dist) * factor;
      }
    }
    pos.needsUpdate = true;
    d.mesh.computeBoundingBox();
    d.mesh.computeBoundingSphere();
    return this;
  }

  /** 更新:推进碎片物理(重力 + 速度积分 + 角速度积分)+ 寿命衰减,移除过期碎片。 */
  update(dt: number): void {
    if (dt < 0) dt = 0;
    const step = Math.min(dt, 1 / 30);
    const g = this.gravity;
    const alive: Fragment[] = [];
    for (const f of this.fragments) {
      // 加速度 = g(质量统一,重力加速度与质量无关)
      f.velocity.x += g.x * step;
      f.velocity.y += g.y * step;
      f.velocity.z += g.z * step;
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
      // 寿命衰减
      f.lifetime -= step;
      if (f.lifetime > 0) {
        alive.push(f);
      }
    }
    this.fragments = alive;
  }

  /** 获取可破坏物体(未注册返回 undefined)。 */
  getDestructible(id: number): Destructible | undefined {
    return this.destructibles.get(id);
  }

  /** 获取系统当前所有活跃碎片。 */
  getFragments(): Fragment[] {
    return this.fragments;
  }

  /** 获取系统当前碎片数。 */
  getFragmentCount(): number {
    return this.fragments.length;
  }

  /** 清除系统所有碎片,并清空各可破坏物体的碎片记录。 */
  clearFragments(): this {
    this.fragments = [];
    for (const d of this.destructibles.values()) {
      d.fragments = [];
    }
    return this;
  }

  /** 设置系统级破坏力阈值。 */
  setBreakThreshold(threshold: number): this {
    this.breakThreshold = Math.max(0, threshold);
    return this;
  }

  /** 设置最大碎片数。 */
  setMaxFragments(max: number): this {
    this.maxFragments = Math.max(0, Math.floor(max));
    return this;
  }

  /** 获取统计。 */
  getStats(): DestructionStats {
    let broken = 0;
    let activeFragments = 0;
    for (const f of this.fragments) {
      if (f.lifetime > 0) activeFragments++;
    }
    for (const d of this.destructibles.values()) {
      if (d.isBroken) broken++;
    }
    return {
      destructibles: this.destructibles.size,
      broken,
      fragments: this.fragments.length,
      activeFragments,
    };
  }

  // ---------- 内部辅助 ----------

  /** 获取 / 懒构造 VoronoiFracture 实例。 */
  private _getFracture(): VoronoiFracture {
    if (!this._fracture) this._fracture = new VoronoiFracture();
    return this._fracture;
  }

  /** 内部碎裂:用 VoronoiFracture 把 destructible.mesh 破碎成 count 块。 */
  private _shatterInternal(
    d: Destructible,
    point: Vector3,
    impactForce: number,
    count: number,
  ): void {
    const fracture = this._getFracture();
    const sites = fracture.generateSites(d.mesh, count);
    const pieces = fracture.fracture(d.mesh, sites);
    for (let i = 0; i < pieces.length; i++) {
      if (this.fragments.length >= this.maxFragments) break;
      const piece = pieces[i];
      const site = sites[i];
      // 站点 → 初始速度方向(站点相对于冲击点的世界偏移)
      const worldSite = new Vector3(
        site.position.x + d.position.x,
        site.position.y + d.position.y,
        site.position.z + d.position.z,
      );
      const dir = new Vector3().subVectors(worldSite, point);
      const len = dir.length();
      if (len > 1e-9) dir.divideScalar(len);
      else dir.set(0, 1, 0);
      const vel = dir.multiplyScalar(impactForce);
      // 随机角速度
      const angVel = new Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
      ).multiplyScalar(impactForce * 0.5 + 1);
      this._addFragment(d, piece, worldSite, vel, angVel);
    }
  }

  /** 创建并添加一个碎片到系统 + destructible。 */
  private _addFragment(
    d: Destructible,
    mesh: BufferGeometry,
    worldPos: Vector3,
    velocity: Vector3,
    angularVelocity: Vector3 = new Vector3(),
  ): Fragment | null {
    if (this.fragments.length >= this.maxFragments) return null;
    const frag: Fragment = {
      id: ++this._fragmentId,
      position: worldPos.clone(),
      rotation: new Quaternion(),
      velocity: velocity.clone(),
      angularVelocity: angularVelocity.clone(),
      scale: 1,
      lifetime: DEFAULT_FRAGMENT_LIFETIME,
      mesh,
      mass: DEFAULT_FRAGMENT_MASS,
    };
    this.fragments.push(frag);
    d.fragments.push(frag);
    return frag;
  }

  /** 用平面切割 geometry,返回 [内侧, 外侧]。 */
  private _sliceGeometry(geometry: BufferGeometry, plane: SlicePlane): SliceResult {
    const tris = this._extractTriangles(geometry);
    if (tris.length === 0) return [null, null];
    const inside: Tri[] = [];
    const outside: Tri[] = [];
    const nx = plane.normal.x;
    const ny = plane.normal.y;
    const nz = plane.normal.z;
    const dist = plane.distance;
    for (const t of tris) {
      const da = nx * t.ax + ny * t.ay + nz * t.az + dist;
      const db = nx * t.bx + ny * t.by + nz * t.bz + dist;
      const dc = nx * t.cx + ny * t.cy + nz * t.cz + dist;
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
        this._splitTriangleByPlane(t, da, db, dc, inside, outside);
      }
    }
    const insideGeo = inside.length > 0 ? this._buildGeometry(inside) : null;
    const outsideGeo = outside.length > 0 ? this._buildGeometry(outside) : null;
    return [insideGeo, outsideGeo];
  }

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

  /** 把跨平面的三角形分裂成内侧 + 外侧两组三角形,追加到对应数组。 */
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
      const tt = da / (da - db);
      return [ax + tt * (bx - ax), ay + tt * (by - ay), az + tt * (bz - az)];
    };

    if (insideCount === 1) {
      // 1 内:内侧得 1 三角形,外侧得 2 三角形(quad)
      if (insideA) {
        const [px, py, pz] = lerp(t.ax, t.ay, t.az, t.bx, t.by, t.bz, da, db);
        const [qx, qy, qz] = lerp(t.ax, t.ay, t.az, t.cx, t.cy, t.cz, da, dc);
        insideOut.push({ ax: t.ax, ay: t.ay, az: t.az, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
        outsideOut.push({ ax: px, ay: py, az: pz, bx: t.bx, by: t.by, bz: t.bz, cx: t.cx, cy: t.cy, cz: t.cz });
        outsideOut.push({ ax: px, ay: py, az: pz, bx: t.cx, by: t.cy, bz: t.cz, cx: qx, cy: qy, cz: qz });
      } else if (insideB) {
        const [px, py, pz] = lerp(t.bx, t.by, t.bz, t.ax, t.ay, t.az, db, da);
        const [qx, qy, qz] = lerp(t.bx, t.by, t.bz, t.cx, t.cy, t.cz, db, dc);
        insideOut.push({ ax: t.bx, ay: t.by, az: t.bz, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
        outsideOut.push({ ax: px, ay: py, az: pz, bx: t.ax, by: t.ay, bz: t.az, cx: t.cx, cy: t.cy, cz: t.cz });
        outsideOut.push({ ax: px, ay: py, az: pz, bx: t.cx, by: t.cy, bz: t.cz, cx: qx, cy: qy, cz: qz });
      } else {
        const [px, py, pz] = lerp(t.cx, t.cy, t.cz, t.ax, t.ay, t.az, dc, da);
        const [qx, qy, qz] = lerp(t.cx, t.cy, t.cz, t.bx, t.by, t.bz, dc, db);
        insideOut.push({ ax: t.cx, ay: t.cy, az: t.cz, bx: px, by: py, bz: pz, cx: qx, cy: qy, cz: qz });
        outsideOut.push({ ax: px, ay: py, az: pz, bx: t.ax, by: t.ay, bz: t.az, cx: t.bx, cy: t.by, cz: t.bz });
        outsideOut.push({ ax: px, ay: py, az: pz, bx: t.bx, by: t.by, bz: t.bz, cx: qx, cy: qy, cz: qz });
      }
    } else {
      // 2 内:内侧得 2 三角形(quad),外侧得 1 三角形
      if (!insideA) {
        const [pbx, pby, pbz] = lerp(t.bx, t.by, t.bz, t.ax, t.ay, t.az, db, da);
        const [pcx, pcy, pcz] = lerp(t.cx, t.cy, t.cz, t.ax, t.ay, t.az, dc, da);
        insideOut.push({ ax: t.bx, ay: t.by, az: t.bz, bx: t.cx, by: t.cy, bz: t.cz, cx: pcx, cy: pcy, cz: pcz });
        insideOut.push({ ax: t.bx, ay: t.by, az: t.bz, bx: pcx, by: pcy, bz: pcz, cx: pbx, cy: pby, cz: pbz });
        outsideOut.push({ ax: t.ax, ay: t.ay, az: t.az, bx: pbx, by: pby, bz: pbz, cx: pcx, cy: pcy, cz: pcz });
      } else if (!insideB) {
        const [pax, pay, paz] = lerp(t.ax, t.ay, t.az, t.bx, t.by, t.bz, da, db);
        const [pcx, pcy, pcz] = lerp(t.cx, t.cy, t.cz, t.bx, t.by, t.bz, dc, db);
        insideOut.push({ ax: t.ax, ay: t.ay, az: t.az, bx: t.cx, by: t.cy, bz: t.cz, cx: pcx, cy: pcy, cz: pcz });
        insideOut.push({ ax: t.ax, ay: t.ay, az: t.az, bx: pcx, by: pcy, bz: pcz, cx: pax, cy: pay, cz: paz });
        outsideOut.push({ ax: t.bx, ay: t.by, az: t.bz, bx: pax, by: pay, bz: paz, cx: pcx, cy: pcy, cz: pcz });
      } else {
        const [pax, pay, paz] = lerp(t.ax, t.ay, t.az, t.cx, t.cy, t.cz, da, dc);
        const [pbx, pby, pbz] = lerp(t.bx, t.by, t.bz, t.cx, t.cy, t.cz, db, dc);
        insideOut.push({ ax: t.ax, ay: t.ay, az: t.az, bx: t.bx, by: t.by, bz: t.bz, cx: pbx, cy: pby, cz: pbz });
        insideOut.push({ ax: t.ax, ay: t.ay, az: t.az, bx: pbx, by: pby, bz: pbz, cx: pax, cy: pay, cz: paz });
        outsideOut.push({ ax: t.cx, ay: t.cy, az: t.cz, bx: pax, by: pay, bz: paz, cx: pbx, cy: pby, cz: pbz });
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

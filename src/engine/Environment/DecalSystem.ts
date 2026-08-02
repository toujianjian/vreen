// DecalSystem — 贴花管理系统 (子弹孔 / 血迹 / 弹痕 / 涂鸦 / 车辙)。
//
// 设计:
//   * 每个 DecalRecord 持有一个 Mesh (由 DecalGeometry + 共享/独立材质构成)
//   * FIFO 上限:maxDecals 超过时淘汰最旧 (类似 o3de DecalComponent 的 lifetime + count 双约束)
//   * 寿命约束:每个 decal 携带 age/maxAge,update(dt) 推进 age,过期自动 dispose
//   * 渐隐:fadeStartRatio 之前不透明,之后透明度按 (1 - t) 线性渐隐 (要求材质 transparent=true)
//   * 法线对齐:提供 orientFromNormal() 辅助,把 +Z 朝向贴到目标表面法线方向
//
// 与 three.js / o3de 的对比:
//   * three.js 仅提供 DecalGeometry (一次性生成),没有运行时管理;VREEN 把几何 + 寿命 +
//     FIFO + 渐隐 + 法线对齐整合为完整系统,对标 o3de AtomLyIntegration 的 DecalComponent。
//   * o3de Decal 使用 GPU instancing + 索引图集,需要配套的 Decal Asset Builder;
//     VREEN 选择 CPU 端管理 (适合中小型 < 1024 贴花),API 简单且无 render pass 依赖,
//     未来可平滑升级到 instancing 路径 (只需替换 getMeshes() → getInstancedMesh())。
//
// 用法:
//   const sys = new DecalSystem({ maxDecals: 128, defaultLifetime: 12 });
//   sys.attach(scene);                                 // 把 group 挂到场景
//   sys.spawnFromHit(wallMesh, hitPoint, hitNormal,
//                    new Vector3(0.4, 0.4, 0.4),
//                    { texture: bulletHoleTex });     // 投射贴花
//   sys.update(dt);                                    // 每帧推进寿命与渐隐
//   sys.getStats();                                    // { count, peakCount, evicted }

import { DecalGeometry } from '../Geometries/DecalGeometry';
import { Mesh } from '../Core/Mesh';
import { Group } from '../Core/Group';
import type { Object3D } from '../Core/Object3D';
import type { Texture } from '../Core/Texture';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import { Quaternion, Vector3 } from '../Math';
import { createLogger } from '@/lib/logger';

const log = createLogger('DecalSystem');

/** 单个贴花实例的运行时数据。 */
export interface DecalRecord {
  /** 唯一 id (自增分配)。 */
  id: number;
  /** 渲染用 Mesh (持有 DecalGeometry + 材质)。挂在 DecalSystem.group 下。 */
  mesh: Mesh;
  /** 贴花中心 (世界空间,用于剔除/查询)。 */
  position: Vector3;
  /** 贴花朝向 (单位四元数)。 */
  orientation: Quaternion;
  /** 贴花盒尺寸 (sx, sy, sz)。 */
  size: Vector3;
  /** 当前年龄 (秒)。 */
  age: number;
  /** 最大寿命 (秒,超过则移除)。 */
  maxAge: number;
  /** 渐隐起点比例 (0..1,1=不渐隐;0.75 表示最后 25% 寿命渐隐)。 */
  fadeStartRatio: number;
  /** 创建时被投影的目标 Object3D (用于追溯;不被强引用 hold)。 */
  targetId: string | undefined;
  /** 是否已被标记为待移除 (在 update 末尾统一清理)。 */
  dead: boolean;
}

/** DecalSystem 构造选项。 */
export interface DecalSystemOptions {
  /** 最大同时存在的贴花数 (超过则淘汰最旧)。默认 64。 */
  maxDecals?: number;
  /** 默认寿命 (秒)。默认 10。 */
  defaultLifetime?: number;
  /** 默认渐隐起点比例 (0..1)。默认 0.75。 */
  defaultFadeStartRatio?: number;
  /** 默认贴花尺寸 (sx=sy=sz)。默认 0.5 (50cm)。 */
  defaultSize?: number;
  /** 默认贴图 (所有 spawn 共享,除非 spawn 时覆盖)。 */
  defaultTexture?: Texture | null;
  /** 默认颜色 (RGB 0..1)。默认白。 */
  defaultColor?: { r: number; g: number; b: number };
  /** 渲染顺序 (越小越先绘制;贴花一般 >0,在透明物体之前)。默认 1。 */
  renderOrder?: number;
}

/** DecalSystem.getStats() 返回的统计信息。 */
export interface DecalSystemStats {
  /** 当前活跃贴花数。 */
  count: number;
  /** 历史峰值 (maxDecals 上限内)。 */
  peakCount: number;
  /** 累计被 FIFO 淘汰的数量。 */
  evicted: number;
  /** 累计被寿命过期淘汰的数量。 */
  expired: number;
  /** 累计成功 spawn 的数量。 */
  spawned: number;
}

/** 默认贴花朝向 (identity)。 */
const ID_QUAT = new Quaternion(0, 0, 0, 1);
/** 用于 orientFromNormal:从 +Z 转到目标法线的临时四元数。 */
const _q = new Quaternion();
/** 用于 orientFromNormal 的参考向量 (避免与 normal 平行时退化)。 */
const UP = new Vector3(0, 0, 1);

/**
 * 贴花管理系统。
 *
 * 生命周期:
 *   1. spawn() / spawnFromHit()  → 生成 DecalGeometry + Mesh,加入 pool
 *   2. update(dt)                → 推进 age,计算 fade,标记 dead,统一清理
 *   3. clear()                   → 立即释放所有
 *
 * 渲染集成:
 *   - attach(scene) 把内部 group 挂到场景;detach() 移除
 *   - getMeshes() 返回当前所有 Mesh (供渲染器遍历)
 *   - 或者直接用 group.children (二者等价)
 *
 * 线程模型:同步,主线程调用。无 GL 资源持有 (Mesh/Geometry/Material 由 renderer 上传)。
 */
export class DecalSystem {
  /** 渲染容器;所有贴花 Mesh 挂在 group 下。 */
  readonly group: Group = new Group();
  /** 所有活跃贴花记录 (按 spawn 顺序)。 */
  decals: DecalRecord[] = [];
  /** 共享材质模板 (spawn 时克隆,以支持独立 fade)。 */
  materialTemplate: MeshBasicMaterial;
  /** 默认贴图。 */
  defaultTexture: Texture | null = null;

  /** 配置参数 (可运行时修改)。 */
  maxDecals: number;
  defaultLifetime: number;
  defaultFadeStartRatio: number;
  defaultSize: number;
  defaultColor: { r: number; g: number; b: number };
  renderOrder: number;

  private _nextId: number = 1;
  private _peakCount: number = 0;
  private _evicted: number = 0;
  private _expired: number = 0;
  private _spawned: number = 0;

  constructor(opts: DecalSystemOptions = {}) {
    this.maxDecals = opts.maxDecals ?? 64;
    this.defaultLifetime = opts.defaultLifetime ?? 10;
    this.defaultFadeStartRatio = opts.defaultFadeStartRatio ?? 0.75;
    this.defaultSize = opts.defaultSize ?? 0.5;
    this.defaultColor = opts.defaultColor ?? { r: 1, g: 1, b: 1 };
    this.defaultTexture = opts.defaultTexture ?? null;
    this.renderOrder = opts.renderOrder ?? 1;

    this.materialTemplate = new MeshBasicMaterial({
      color: this.defaultColor,
      map: this.defaultTexture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

    this.group.name = 'DecalSystem.group';
    this.group.renderOrder = this.renderOrder;
  }

  /**
   * 把内部 group 挂到场景/父节点。
   * @param parent 目标父节点 (Scene 或任意 Object3D)
   */
  attach(parent: Object3D): this {
    parent.add(this.group);
    return this;
  }

  /** 从父节点分离。 */
  detach(): this {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    return this;
  }

  /**
   * 投射一个贴花。
   *
   * @param target      被投影的目标物体 (需有 geometry.attributes.position)
   * @param position    贴花中心 (世界空间)
   * @param orientation 贴花朝向 (单位四元数;identity 表示 +Z 朝外)
   * @param size        贴花盒尺寸 (sx, sy, sz);省略用 defaultSize
   * @param opts        覆盖默认寿命/贴图/颜色
   * @returns DecalRecord 或 null (当几何体为空 / size 含 0)
   */
  spawn(
    target: Object3D,
    position: Vector3,
    orientation: Quaternion = ID_QUAT,
    size?: Vector3,
    opts: {
      lifetime?: number;
      fadeStartRatio?: number;
      texture?: Texture | null;
      color?: { r: number; g: number; b: number };
    } = {},
  ): DecalRecord | null {
    const sz = size ?? new Vector3(this.defaultSize, this.defaultSize, this.defaultSize);
    if (sz.x === 0 || sz.y === 0 || sz.z === 0) {
      log.warn('spawn: size 含 0 分量,跳过');
      return null;
    }

    // 生成贴花几何体 (Sutherland–Hodgman 裁剪后可能为空)。
    let geom: DecalGeometry;
    try {
      geom = DecalGeometry.create(target, position, orientation, sz);
    } catch (e) {
      log.error('spawn: DecalGeometry.create 抛错', e);
      return null;
    }
    if (geom.attributes.position.count === 0) {
      // 几何体未命中任何三角形,释放并返回 null。
      geom.dispose?.();
      return null;
    }

    // FIFO 淘汰:超过 maxDecals 时移除最旧。
    while (this.decals.length >= this.maxDecals) {
      const oldest = this.decals.shift();
      if (oldest) {
        this._removeRecord(oldest);
        this._evicted++;
      }
    }

    // 克隆材质 (每个贴花独立 opacity,支持独立 fade)。
    const mat = new MeshBasicMaterial({
      color: opts.color ?? this.defaultColor,
      map: opts.texture ?? this.defaultTexture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mesh = new Mesh(geom, mat);
    mesh.renderOrder = this.renderOrder;
    mesh.name = `Decal#${this._nextId}`;
    mesh.frustumCulled = true;
    this.group.add(mesh);

    const record: DecalRecord = {
      id: this._nextId++,
      mesh,
      position: position.clone(),
      orientation: orientation.clone(),
      size: sz.clone(),
      age: 0,
      maxAge: opts.lifetime ?? this.defaultLifetime,
      fadeStartRatio: opts.fadeStartRatio ?? this.defaultFadeStartRatio,
      targetId: target.uuid,
      dead: false,
    };
    this.decals.push(record);
    this._spawned++;
    if (this.decals.length > this._peakCount) {
      this._peakCount = this.decals.length;
    }
    log.debug(`spawn #${record.id} at (${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}) size=${sz.x.toFixed(2)}`);
    return record;
  }

  /**
   * 便捷重载:从命中点 + 法线投射贴花。
   *
   * 内部用 setFromUnitVectors(+Z, normal) 计算朝向,使贴花 +Z 轴对齐表面法线。
   * 如果 normal 接近退化 (长度 < 1e-6),回退到 identity。
   *
   * @param target  被投影目标
   * @param hitPoint 命中点 (世界空间)
   * @param normal  表面法线 (世界空间,会被归一化)
   * @param size    贴花盒尺寸 (省略用 defaultSize)
   * @param opts    同 spawn()
   */
  spawnFromHit(
    target: Object3D,
    hitPoint: Vector3,
    normal: Vector3,
    size?: Vector3,
    opts?: {
      lifetime?: number;
      fadeStartRatio?: number;
      texture?: Texture | null;
      color?: { r: number; g: number; b: number };
      /** 沿法线方向偏移 (避免 z-fighting),默认 0.01。 */
      normalBias?: number;
    },
  ): DecalRecord | null {
    const nLen = normal.length();
    if (nLen < 1e-6) {
      // 退化法线:回退到 +Z。
      _q.identity();
    } else {
      // 归一化 + 重新建方向。
      const n = normal.clone().multiplyScalar(1 / nLen);
      _q.setFromUnitVectors(UP, n);
    }

    // 沿法线偏移命中点,避免贴花与目标共面 z-fighting。
    const bias = opts?.normalBias ?? 0.01;
    const pos = hitPoint.clone();
    if (bias !== 0 && nLen >= 1e-6) {
      pos.x += (normal.x / nLen) * bias;
      pos.y += (normal.y / nLen) * bias;
      pos.z += (normal.z / nLen) * bias;
    }

    return this.spawn(target, pos, _q.clone(), size, opts);
  }

  /**
   * 推进所有贴花的寿命,处理渐隐与过期。
   *
   * @param dt 步长 (秒);< 0 视为 0
   */
  update(dt: number): this {
    if (dt < 0) dt = 0;

    if (this.decals.length === 0) return this;

    // 第一遍:推进年龄 + 计算 fade opacity + 标记 dead。
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      d.age += dt;

      if (d.age >= d.maxAge) {
        d.dead = true;
        this._expired++;
        continue;
      }

      // 渐隐:fadeStartRatio..1 之间线性降到 0。
      const t = d.age / d.maxAge;
      const opacity = t < d.fadeStartRatio
        ? 1
        : Math.max(0, 1 - (t - d.fadeStartRatio) / (1 - d.fadeStartRatio));
      const mat = d.mesh.material as MeshBasicMaterial | MeshBasicMaterial[];
      if (Array.isArray(mat)) {
        for (let j = 0; j < mat.length; j++) mat[j].opacity = opacity;
      } else {
        mat.opacity = opacity;
      }
    }

    // 第二遍:统一清理 dead 记录 (倒序 splice)。
    for (let i = this.decals.length - 1; i >= 0; i--) {
      if (this.decals[i].dead) {
        const d = this.decals.splice(i, 1)[0];
        this._removeRecord(d);
      }
    }

    return this;
  }

  /**
   * 立即移除指定 id 的贴花。
   * @returns 是否找到并移除
   */
  removeById(id: number): boolean {
    for (let i = 0; i < this.decals.length; i++) {
      if (this.decals[i].id === id) {
        const d = this.decals.splice(i, 1)[0];
        this._removeRecord(d);
        return true;
      }
    }
    return false;
  }

  /** 清除所有贴花 (不重置统计计数器)。 */
  clear(): this {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this._removeRecord(this.decals[i]);
    }
    this.decals.length = 0;
    return this;
  }

  /** 返回当前所有贴花 Mesh (供渲染器遍历;等价于 group.children)。 */
  getMeshes(): Mesh[] {
    return this.decals.map((d) => d.mesh);
  }

  /** 按 id 查找贴花记录。 */
  getById(id: number): DecalRecord | undefined {
    return this.decals.find((d) => d.id === id);
  }

  /** 统计信息。 */
  getStats(): DecalSystemStats {
    return {
      count: this.decals.length,
      peakCount: this._peakCount,
      evicted: this._evicted,
      expired: this._expired,
      spawned: this._spawned,
    };
  }

  /** 重置统计计数器 (不影响当前贴花)。 */
  resetStats(): this {
    this._peakCount = this.decals.length;
    this._evicted = 0;
    this._expired = 0;
    this._spawned = 0;
    return this;
  }

  /** 释放一个 record 持有的 GL/几何/材质资源,并从 group 摘除。 */
  private _removeRecord(d: DecalRecord): void {
    if (d.mesh.parent) {
      d.mesh.parent.remove(d.mesh);
    }
    d.mesh.geometry.dispose?.();
    // Material 接口未声明 dispose (具体子类如 ShaderMaterial 才有),
    // 用 cast-through-unknown 安全调用可选 dispose。
    const mat = d.mesh.material as unknown as
      | { dispose?: () => void }
      | { dispose?: () => void }[];
    if (Array.isArray(mat)) {
      for (let i = 0; i < mat.length; i++) mat[i].dispose?.();
    } else {
      mat?.dispose?.();
    }
  }
}

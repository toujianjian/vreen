// LODManager — Level-of-Detail 管理系统。
//
// 设计目标:
//   - 统一管理场景中多个 LODGroup(每个 Group 对应一个 Object3D + 多精度级别)。
//   - 支持两种切换策略:
//       1) 距离 LOD:按相机到 Group 世界位置的距离切换(lodDistances 阈值)。
//       2) 屏幕占比 LOD:按 Group 包围盒在屏幕上的投影占比切换(screenSpaceThreshold)。
//   - HLOD(Hierarchical LOD):超过 hlodDistance 时,把整个 Group 隐藏(由调用
//     方替换为合并后的代理 mesh),减少远距离 draw call。
//   - 与 Core/LOD 互补:Core/LOD 是单节点 LOD(子 mesh 列表 + 自动切换),
//     LODManager 是场景级管理器(多 Group + 全局策略 + 统计)。
//
// 用法:
//   const mgr = new LODManager();
//   mgr.setCamera(camera);
//   mgr.registerGroup(1, { id: 1, object, lods: [...], currentLOD: 0, ... });
//   mgr.update(dt); // 每帧调用,内部按距离/屏幕占比切换 LOD
//   const stats = mgr.getLODStats();
//
// 线程模型:纯同步,无锁;update 在主循环里调用。

import { createLogger } from '@/lib/logger';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math/Vector3';
import type { Camera } from '../Cameras/Camera';

const log = createLogger('LODManager');

/** 单个 LOD 级别。level=0 为最高精度。 */
export interface LODLevel {
  /** 级别序号(0 = 最高精度,递增=精度递减)。 */
  level: number;
  /** 该级别使用的几何体(BufferGeometry 或兼容结构)。 */
  geometry: unknown;
  /** 该级别使用的材质。 */
  material: unknown;
  /** 屏幕占比阈值:当 Group 屏幕占比 >= 此值时使用本级(0..1)。 */
  screenRatio: number;
  /** 距离阈值:当相机距离 <= 此值时使用本级(世界单位)。 */
  distance: number;
  /** 该级别的估算 draw call 数(用于 getTotalDrawCalls 汇总)。 */
  drawCalls: number;
}

/** LOD 组:一个 Object3D + 多个 LOD 级别。 */
export interface LODGroup {
  /** 组 id(由调用方提供,需在管理器内唯一)。 */
  id: number;
  /** 关联的场景对象。LOD 切换时调用方据此替换 geometry/material。 */
  object: Object3D;
  /** LOD 级别列表,按 level 升序(level 0 在前)。 */
  lods: LODLevel[];
  /** 当前激活的 LOD 级别 index(lods 数组下标)。-1 表示隐藏(HLOD 或无级别)。 */
  currentLOD: number;
  /** 是否使用屏幕占比策略(true)或距离策略(false)。 */
  useScreenSpace: boolean;
  /** 轴对齐包围盒(世界空间,min/max)。用于屏幕占比计算与 HLOD 合并判定。 */
  bounds: { min: Vector3; max: Vector3 };
}

/** LOD 统计信息。 */
export interface LODStats {
  /** 已注册 Group 总数。 */
  groupCount: number;
  /** 当前每级别 Group 数量(index = LOD 级别)。 */
  groupsPerLevel: number[];
  /** 当前隐藏(HLOD 或无级别)的 Group 数。 */
  hiddenCount: number;
  /** 估算总 draw call 数(所有可见 Group 的 currentLOD.drawCalls 之和)。 */
  totalDrawCalls: number;
  /** 启用屏幕占比策略的 Group 数。 */
  screenSpaceGroups: number;
  /** HLOD 是否启用。 */
  hlodEnabled: boolean;
  /** 当前进入 HLOD 状态的 Group 数。 */
  hlodActiveCount: number;
}

/** 默认 LOD 距离阈值(4 级):0..10 / 10..25 / 25..50 / 50..∞。 */
const DEFAULT_LOD_DISTANCES = [10, 25, 50, 100];

export class LODManager {
  /** 已注册的 LOD 组(id → group)。 */
  lodGroups: Map<number, LODGroup> = new Map();
  /** 默认距离阈值(升序)。Group 自身的 LODLevel.distance 优先级高于此全局值。 */
  lodDistances: number[];
  /** 屏幕占比阈值(0..1)。Group 在屏幕的投影占比 < 此值时切到更低精度或隐藏。 */
  screenSpaceThreshold: number;
  /**
   * 是否启用 HLOD。
   * 注意:此处用 `hlodEnabled` 而非 `enableHLOD` 是因为 TS 不允许同名属性与方法
   * (`enableHLOD(enabled)` 是方法)。`enableHLOD(enabled)` 方法用于设置此标志。
   */
  hlodEnabled: boolean;
  /** HLOD 触发距离(超过此距离的 Group 进入 HLOD 状态,隐藏原始 mesh)。 */
  hlodDistance: number;
  /** 当前关联的相机(用于距离/屏幕占比计算)。 */
  camera: Camera | null = null;

  /** 本帧进入 HLOD 状态的 Group 数(由 update 维护,供 getLODStats 读取)。 */
  private _hlodActiveCount: number = 0;

  constructor(opts: {
    lodDistances?: number[];
    screenSpaceThreshold?: number;
    enableHLOD?: boolean;
    hlodDistance?: number;
    camera?: Camera | null;
  } = {}) {
    this.lodDistances = opts.lodDistances
      ? [...opts.lodDistances].sort((a, b) => a - b)
      : [...DEFAULT_LOD_DISTANCES];
    this.screenSpaceThreshold = opts.screenSpaceThreshold ?? 0.05;
    this.hlodEnabled = opts.enableHLOD ?? false;
    this.hlodDistance = opts.hlodDistance ?? 200;
    this.camera = opts.camera ?? null;
  }

  /** 注册一个 LOD 组。若 id 已存在则覆盖。 */
  registerGroup(id: number, group: LODGroup): void {
    if (this.lodGroups.has(id)) {
      log.warn(`registerGroup(${id}) — overriding existing group`);
    }
    // 确保 lods 按 level 升序,便于 selectLOD 二分查找与边界判定。
    group.lods.sort((a, b) => a.level - b.level);
    group.id = id;
    group.currentLOD = group.currentLOD ?? 0;
    this.lodGroups.set(id, group);
    log.debug(`registerGroup(${id}) — ${group.lods.length} levels`);
  }

  /** 注销指定 LOD 组。返回是否删除成功。 */
  unregisterGroup(id: number): boolean {
    const ok = this.lodGroups.delete(id);
    if (ok) log.debug(`unregisterGroup(${id})`);
    return ok;
  }

  /** 为指定 Group 添加 LOD 级别(按 level 升序插入)。 */
  addLOD(groupId: number, lod: LODLevel): boolean {
    const g = this.lodGroups.get(groupId);
    if (!g) {
      log.warn(`addLOD(${groupId}) — group not found`);
      return false;
    }
    g.lods.push(lod);
    g.lods.sort((a, b) => a.level - b.level);
    return true;
  }

  /** 移除指定 Group 中给定 level 的 LOD 级别。返回是否删除成功。 */
  removeLOD(groupId: number, level: number): boolean {
    const g = this.lodGroups.get(groupId);
    if (!g) return false;
    const i = g.lods.findIndex((l) => l.level === level);
    if (i < 0) return false;
    g.lods.splice(i, 1);
    // 收缩 currentLOD 到合法范围。
    if (g.currentLOD >= g.lods.length) g.currentLOD = g.lods.length - 1;
    return true;
  }

  /** 设置当前相机。后续 update 会用其计算距离/屏幕占比。 */
  setCamera(camera: Camera | null): void {
    this.camera = camera;
  }

  /** 设置全局 LOD 距离阈值(升序排序)。 */
  setLODDistances(distances: number[]): void {
    this.lodDistances = [...distances].sort((a, b) => a - b);
  }

  /** 设置屏幕占比阈值(0..1)。 */
  setScreenSpaceThreshold(threshold: number): void {
    this.screenSpaceThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * 启用/禁用 HLOD。
   * 注:任务规范同时要求 `属性 enableHLOD: boolean` 与 `方法 enableHLOD(enabled)`,
   * 但 TS 不允许同名属性与方法共存,故属性命名为 `hlodEnabled`,方法名按规范保留。
   */
  enableHLOD(enabled: boolean): void {
    this.hlodEnabled = enabled;
  }

  /** 设置 HLOD 触发距离。 */
  setHLODDistance(distance: number): void {
    this.hlodDistance = Math.max(0, distance);
  }

  /**
   * 每帧更新:遍历所有 Group,根据相机距离/屏幕占比选择 LOD 级别,
   * 并处理 HLOD 隐藏逻辑。`dt` 当前未参与滞后量计算(留作未来扩展)。
   */
  update(_dt: number): void {
    if (!this.camera) return;
    this._hlodActiveCount = 0;
    for (const group of this.lodGroups.values()) {
      // HLOD 优先:超过 hlodDistance 直接隐藏。
      if (this.hlodEnabled) {
        const dist = this._distanceToGroup(group);
        if (dist > this.hlodDistance) {
          group.currentLOD = -1;
          this._hlodActiveCount++;
          continue;
        }
      }
      const idx = this.selectLOD(group);
      group.currentLOD = idx;
    }
  }

  /**
   * 为指定 Group 选择 LOD 级别 index。
   * - useScreenSpace=true:按屏幕占比选择(computeScreenRatio)。
   * - useScreenSpace=false:按距离选择(距离 >= lodDistances[i] 时切到 i+1 级)。
   * 返回 lods 数组下标;无级别时返回 -1。
   */
  selectLOD(group: LODGroup): number {
    if (group.lods.length === 0) return -1;
    if (group.useScreenSpace) {
      const ratio = this.computeScreenRatio(group);
      // lods 按 level 升序(level 0 = 高精度 = screenRatio 大)。
      // 找第一个(最高精度)screenRatio <= ratio 的级别:ratio 越大,可见精度越高。
      // 若所有级别都不满足(ratio 太小),退到最低精度。
      let target = group.lods.length - 1;
      for (let i = 0; i < group.lods.length; i++) {
        if (ratio >= group.lods[i].screenRatio) {
          target = i;
          break;
        }
      }
      // 全局阈值兜底:低于 screenSpaceThreshold 时强制最低精度。
      if (ratio < this.screenSpaceThreshold && group.lods.length > 1) {
        target = group.lods.length - 1;
      }
      return target;
    }
    // 距离策略:用 LODLevel.distance 优先,否则回退到全局 lodDistances。
    const dist = this._distanceToGroup(group);
    let target = 0;
    for (let i = 0; i < group.lods.length; i++) {
      const threshold = group.lods[i].distance > 0
        ? group.lods[i].distance
        : (this.lodDistances[i] ?? Infinity);
      if (dist >= threshold) {
        target = i;
      } else {
        break;
      }
    }
    return target;
  }

  /**
   * 计算 Group 包围盒在屏幕上的投影占比(0..1)。
   * 估算:取包围盒中心距离 d 与包围盒对角线长 size,按相机 fov 投影到屏幕高度占比。
   * 这是简化估算(假设轴对齐、视锥中心),用于 LOD 决策足够。
   */
  computeScreenRatio(group: LODGroup): number {
    if (!this.camera) return 1;
    const center = this._groupCenter(group);
    const camPos = this._cameraPosition();
    const dx = center.x - camPos.x;
    const dy = center.y - camPos.y;
    const dz = center.z - camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= 1e-6) return 1;
    // 包围盒对角线长。
    const sz = group.bounds.max.clone().sub(group.bounds.min);
    const size = sz.length();
    if (size <= 1e-6) return 0;
    // 透视投影:屏幕高度占比 ≈ (size / dist) / (2 * tan(fov/2))。
    const fov = (this.camera as { fov?: number }).fov ?? 50;
    const tanHalf = Math.tan((fov * Math.PI) / 360);
    if (tanHalf <= 1e-6) return 1;
    const ratio = size / (2 * dist * tanHalf);
    return Math.max(0, Math.min(1, ratio));
  }

  /** 获取指定 LOD 组。 */
  getGroup(id: number): LODGroup | undefined {
    return this.lodGroups.get(id);
  }

  /** 获取所有 LOD 组(数组形式,顺序不保证)。 */
  getGroups(): LODGroup[] {
    return Array.from(this.lodGroups.values());
  }

  /** 获取指定 Group 的当前 LOD 级别 index。未注册返回 -1。 */
  getCurrentLOD(id: number): number {
    return this.lodGroups.get(id)?.currentLOD ?? -1;
  }

  /** 设置指定 Group 是否使用屏幕占比策略。 */
  setUseScreenSpace(id: number, use: boolean): boolean {
    const g = this.lodGroups.get(id);
    if (!g) return false;
    g.useScreenSpace = use;
    return true;
  }

  /** 获取 LOD 统计信息。 */
  getLODStats(): LODStats {
    const groupsPerLevel: number[] = [];
    let hidden = 0;
    let totalDraw = 0;
    let ssCount = 0;
    for (const g of this.lodGroups.values()) {
      if (g.useScreenSpace) ssCount++;
      if (g.currentLOD < 0 || g.lods.length === 0) {
        hidden++;
        continue;
      }
      const lod = g.lods[g.currentLOD];
      if (lod) {
        groupsPerLevel[g.currentLOD] = (groupsPerLevel[g.currentLOD] ?? 0) + 1;
        totalDraw += lod.drawCalls;
      }
    }
    return {
      groupCount: this.lodGroups.size,
      groupsPerLevel,
      hiddenCount: hidden,
      totalDrawCalls: totalDraw,
      screenSpaceGroups: ssCount,
      hlodEnabled: this.hlodEnabled,
      hlodActiveCount: this._hlodActiveCount,
    };
  }

  /** 估算所有可见 Group 的总 draw call 数。 */
  getTotalDrawCalls(): number {
    let total = 0;
    for (const g of this.lodGroups.values()) {
      if (g.currentLOD < 0 || g.lods.length === 0) continue;
      const lod = g.lods[g.currentLOD];
      if (lod) total += lod.drawCalls;
    }
    return total;
  }

  // ── private ───────────────────────────────────────────────────

  /** 计算相机到 Group 中心的距离。 */
  private _distanceToGroup(group: LODGroup): number {
    const center = this._groupCenter(group);
    const camPos = this._cameraPosition();
    return center.distanceTo(camPos);
  }

  /** Group 包围盒中心(世界空间)。 */
  private _groupCenter(group: LODGroup): Vector3 {
    return group.bounds.min.clone().add(group.bounds.max).multiplyScalar(0.5);
  }

  /** 相机世界位置(从 matrixWorld 平移列读取,兼容父节点)。 */
  private _cameraPosition(): Vector3 {
    if (!this.camera) return new Vector3();
    const e = this.camera.matrixWorld.elements;
    return new Vector3(e[12], e[13], e[14]);
  }
}

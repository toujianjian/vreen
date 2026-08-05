// XRPlaneTracker —— AR 平面检测跟踪 (世界理解)。
//
// 适配自 W3C WebXR Plane Detection Module 与 three.js `XRPlanes`
// (examples/jsm/webxr/XRPlanes.js)。three.js 用 Mesh + 半透明材质可视化平面;
// VREEN 改为纯数据 `XRPlane` + 查询 API,由渲染层/碰撞层消费。
//
// 平面检测让 AR 应用理解现实世界表面 (地板/桌面/墙面),用于:
//   * 物体放置 (把虚拟物体放在真实桌面)。
//   * 碰撞 (虚拟角色站在真实地板)。
//   * 遮挡 (虚拟物体被真实墙面遮挡)。
//
// WebXR 每帧派发 detectedPlanes (added/changed/removed id 集合),
// XRPlaneTracker 维护平面注册表 + 边界框 + 事件回调。

import { Vector3 } from '../Math';
import type { XRPlaneData } from './WebXRTypes';

/** 平面边界框 (AABB)。 */
export interface PlaneBounds {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  size: { x: number; y: number; z: number };
}

/** 平面增量事件。 */
export interface PlaneDeltaEvent {
  added: XRPlaneData[];
  changed: XRPlaneData[];
  removed: string[];
}

/** 平面事件监听器。 */
export type PlaneTrackerListener = (event: PlaneDeltaEvent) => void;

/**
 * XRPlaneTracker —— 跟踪 AR 检测到的平面。
 *
 * ```ts
 * const tracker = new XRPlaneTracker();
 * manager.addEventListener('planesdetected', (e) => {
 *   if (e.planes) tracker.applyDelta(e.planes);
 * });
 * // 查询水平平面 (地板/桌面)
 * const floors = tracker.getByOrientation('horizontal');
 * ```
 */
export class XRPlaneTracker {
  /** 平面注册表 (id → data)。 */
  private planes: Map<string, XRPlaneData> = new Map();
  /** 边界框缓存 (id → bounds)。 */
  private boundsCache: Map<string, PlaneBounds> = new Map();
  /** 事件监听器。 */
  private listeners: Set<PlaneTrackerListener> = new Set();

  /** 添加事件监听。 */
  addEventListener(listener: PlaneTrackerListener): void {
    this.listeners.add(listener);
  }

  /** 移除事件监听。 */
  removeEventListener(listener: PlaneTrackerListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 应用一帧的平面增量。
   * @returns 本次增量事件
   */
  applyDelta(delta: { added: XRPlaneData[]; changed: XRPlaneData[]; removed: string[] }): PlaneDeltaEvent {
    const event: PlaneDeltaEvent = { added: [], changed: [], removed: [] };

    for (const p of delta.added) {
      this.planes.set(p.id, p);
      this.boundsCache.delete(p.id);
      event.added.push(p);
    }
    for (const p of delta.changed) {
      this.planes.set(p.id, p);
      this.boundsCache.delete(p.id); // 失效缓存
      event.changed.push(p);
    }
    for (const id of delta.removed) {
      if (this.planes.delete(id)) {
        this.boundsCache.delete(id);
        event.removed.push(id);
      }
    }

    if (event.added.length || event.changed.length || event.removed.length) {
      this.listeners.forEach((fn) => fn(event));
    }

    return event;
  }

  /** 同步全部平面 (会话开始时用已知平面初始化)。 */
  sync(all: ReadonlyMap<string, XRPlaneData>): void {
    this.planes.clear();
    this.boundsCache.clear();
    for (const [id, p] of all) {
      this.planes.set(id, p);
    }
  }

  /** 获取平面。 */
  get(id: string): XRPlaneData | undefined {
    return this.planes.get(id);
  }

  /** 全部平面。 */
  getAll(): XRPlaneData[] {
    return [...this.planes.values()];
  }

  /** 按朝向过滤。 */
  getByOrientation(orientation: 'horizontal' | 'vertical'): XRPlaneData[] {
    return this.getAll().filter((p) => p.orientation === orientation);
  }

  /** 平面数量。 */
  get count(): number {
    return this.planes.size;
  }

  /** 计算平面边界框 (AABB,缓存)。 */
  getBounds(id: string): PlaneBounds | null {
    const cached = this.boundsCache.get(id);
    if (cached) return cached;

    const plane = this.planes.get(id);
    if (!plane || plane.polygon.length === 0) return null;

    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);

    for (const v of plane.polygon) {
      min.x = Math.min(min.x, v.x); min.y = Math.min(min.y, v.y); min.z = Math.min(min.z, v.z);
      max.x = Math.max(max.x, v.x); max.y = Math.max(max.y, v.y); max.z = Math.max(max.z, v.z);
    }

    const center = new Vector3(
      (min.x + max.x) / 2,
      (min.y + max.y) / 2,
      (min.z + max.z) / 2,
    );
    const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };

    const bounds: PlaneBounds = { min, max, center, size };
    this.boundsCache.set(id, bounds);
    return bounds;
  }

  /**
   * 在水平平面上找最近的有效放置点。
   * @param point 查询点 (世界空间)
   * @param maxDistance 最大距离 (米)
   * @returns 平面 id 与表面投影点,或 null
   */
  findNearestHorizontalSurface(point: Vector3, maxDistance: number = 5): { planeId: string; surfacePoint: Vector3 } | null {
    let best: { planeId: string; surfacePoint: Vector3; dist: number } | null = null;

    for (const plane of this.getByOrientation('horizontal')) {
      const bounds = this.getBounds(plane.id);
      if (!bounds) continue;

      // 投影到平面 (假设水平面 Y 固定)。
      const surfaceY = bounds.center.y;
      const surfacePoint = new Vector3(point.x, surfaceY, point.z);

      // 检查投影是否在 AABB 内。
      if (surfacePoint.x < bounds.min.x || surfacePoint.x > bounds.max.x) continue;
      if (surfacePoint.z < bounds.min.z || surfacePoint.z > bounds.max.z) continue;

      // 距离 (考虑 Y 差)。
      const dist = Math.hypot(point.x - surfacePoint.x, point.y - surfaceY, point.z - surfacePoint.z);
      if (dist > maxDistance) continue;

      if (!best || dist < best.dist) {
        best = { planeId: plane.id, surfacePoint, dist };
      }
    }

    return best ? { planeId: best.planeId, surfacePoint: best.surfacePoint } : null;
  }

  /** 清空 (会话结束)。 */
  clear(): void {
    this.planes.clear();
    this.boundsCache.clear();
  }
}

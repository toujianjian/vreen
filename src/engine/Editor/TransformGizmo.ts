// TransformGizmo — 编辑器变换 Gizmo(移动/旋转/缩放 + 轴向锁定 + 吸附)。
// 在选中对象位置渲染 3 轴手柄,鼠标拖拽沿单轴或多轴变换目标。
//
// 设计:
//   * Gizmo 本身不绘制 WebGL(避免与 Renderer 耦合),而是经 `render()` 产出
//     渲染数据,由调用方(UI 层 / debug overlay)绘制。这样测试无需 WebGL context。
//   * 手柄由 3 条轴向线段(X/Y/Z)构成,长度 = size。轴端点为小球(命中检测用球)。
//   * 中心球对应 'xyz'(整体操作)。
//   * 交互流程(调用方编排):
//       1. hitTest(rayOrigin, rayDirection) → 命中轴('x'|'y'|'z'|'xyz'|null)
//       2. startDrag(axis, rayOrigin, rayDirection) → 记录起始快照与基准参数
//       3. updateDrag(rayOrigin, rayDirection) → 计算增量写回 target 变换
//       4. endDrag() / cancelDrag()
//   * 拖拽过程中的目标变换写回 target.position/rotation/scale,调用方负责记录
//     历史命令(UndoRedoSystem)。
//   * 吸附由 snapEnabled + translateSnap/rotateSnap(度)/scaleSnap 控制,
//     applyTranslation/applyRotation/applyScale 与 updateDrag 均消费吸附。

import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { Matrix4 } from '../Math/Matrix4';

/** Gizmo 模式。 */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** 当前活动(悬停或拖拽)的轴;`'xyz'` 表示整体(中心球)。 */
export type GizmoAxis = 'x' | 'y' | 'z' | 'xyz' | null;

/** RGB 颜色(分量 0..1),供调用方着色手柄。 */
export interface GizmoColor {
  r: number;
  g: number;
  b: number;
}

/** 拖拽起始快照:记录 target 的 position/rotation/scale,用于增量计算与取消。 */
export interface GizmoDragStart {
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}

/** `render()` 产出的渲染数据:供调用方转换为可绘制 geometry。 */
export interface GizmoRenderData {
  /** 三条轴的起点(均为 target 世界位置)。 */
  origin: Vector3;
  /** 三条轴的方向(世界空间单位向量)。 */
  axes: {
    x: Vector3;
    y: Vector3;
    z: Vector3;
  };
  /** 三条轴的长度(= size,活动轴会略放大)。 */
  size: number;
  /** 当前模式,供调用方选择不同的 mesh(箭头/圆环/方块)。 */
  mode: GizmoMode;
  /** 活动(悬停/拖拽)的轴,调用方可高亮该轴颜色。 */
  activeAxis: GizmoAxis;
  /** 是否正在拖拽。 */
  isDragging: boolean;
  /** 各轴颜色 + 悬停颜色。 */
  colors: {
    x: GizmoColor;
    y: GizmoColor;
    z: GizmoColor;
    hover: GizmoColor;
  };
}

// 内部复用的临时向量/四元数,避免每帧分配
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q1 = new Quaternion();

/** 默认轴颜色:R/G/B。 */
const DEFAULT_X_COLOR: GizmoColor = { r: 1, g: 0.2, b: 0.2 };
const DEFAULT_Y_COLOR: GizmoColor = { r: 0.2, g: 1, b: 0.2 };
const DEFAULT_Z_COLOR: GizmoColor = { r: 0.2, g: 0.4, b: 1 };
const DEFAULT_HOVER_COLOR: GizmoColor = { r: 1, g: 1, b: 0 };

export class TransformGizmo {
  /** 当前模式。 */
  mode: GizmoMode = 'translate';
  /** 当前操作的目标对象(null 时 Gizmo 不显示)。 */
  target: Object3D | null = null;
  /** 当前活动(悬停或拖拽)的轴。 */
  activeAxis: GizmoAxis = null;
  /** 是否启用吸附。 */
  snapEnabled: boolean = false;
  /** 平移吸附步长(世界单位)。 */
  translateSnap: number = 0.25;
  /** 旋转吸附步长(度)。 */
  rotateSnap: number = 15;
  /** 缩放吸附步长。 */
  scaleSnap: number = 0.25;
  /** Gizmo 整体大小(世界单位)。 */
  size: number = 1;
  /** 悬停色。 */
  hoverColor: GizmoColor = { ...DEFAULT_HOVER_COLOR };
  /** X 轴颜色。 */
  xColor: GizmoColor = { ...DEFAULT_X_COLOR };
  /** Y 轴颜色。 */
  yColor: GizmoColor = { ...DEFAULT_Y_COLOR };
  /** Z 轴颜色。 */
  zColor: GizmoColor = { ...DEFAULT_Z_COLOR };
  /** 是否正在拖拽。 */
  isDragging: boolean = false;
  /** 拖拽起始快照(拖拽中非 null)。 */
  dragStart: GizmoDragStart | null = null;

  /** 轴端球的命中半径(相对 size 的比例)。 */
  private handleRadius: number = 0.15;
  /** 中心球('xyz')的命中半径(相对 size 的比例)。 */
  private centerRadius: number = 0.18;
  /** 拖拽起始时鼠标射线投影到轴上的参数 t,作为增量基准(translate/scale/xyz-rotate)。 */
  private dragStartT: number = 0;
  /** 拖拽起始时鼠标射线在垂直于轴的平面上的角度(单轴 rotate 增量基准)。 */
  private dragStartAngle: number = 0;

  /** 设置模式。相同模式不触发副作用。 */
  setMode(mode: GizmoMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    // 切换模式时取消任何进行中的悬停/拖拽
    this.activeAxis = null;
    this.isDragging = false;
    this.dragStart = null;
  }

  /** 设置目标对象。null 表示隐藏 Gizmo。 */
  setTarget(object: Object3D | null): void {
    this.target = object;
    this.activeAxis = null;
    this.isDragging = false;
    this.dragStart = null;
  }

  /** 获取目标对象。 */
  getTarget(): Object3D | null {
    return this.target;
  }

  /**
   * 配置吸附。
   * @param enabled       是否启用
   * @param translateSnap 平移步长(>0 才更新)
   * @param rotateSnap    旋转步长(度,>0 才更新)
   * @param scaleSnap     缩放步长(>0 才更新)
   */
  setSnap(
    enabled: boolean,
    translateSnap?: number,
    rotateSnap?: number,
    scaleSnap?: number,
  ): void {
    this.snapEnabled = enabled;
    if (translateSnap !== undefined && translateSnap > 0) this.translateSnap = translateSnap;
    if (rotateSnap !== undefined && rotateSnap > 0) this.rotateSnap = rotateSnap;
    if (scaleSnap !== undefined && scaleSnap > 0) this.scaleSnap = scaleSnap;
  }

  /** 设置 Gizmo 大小。size<=0 时回退到 1。 */
  setSize(size: number): void {
    this.size = size > 0 ? size : 1;
  }

  /** 获取模式。 */
  getMode(): GizmoMode {
    return this.mode;
  }

  /** 获取活动轴。 */
  getActiveAxis(): GizmoAxis {
    return this.activeAxis;
  }

  /** 是否正在拖拽。 */
  isDraggingActive(): boolean {
    return this.isDragging;
  }

  /**
   * 开始拖拽:记录起始快照与基准射线投影参数。
   * @param axis         锁定的轴('x'|'y'|'z'|'xyz')
   * @param rayOrigin    鼠标射线起点
   * @param rayDirection 鼠标射线方向(无需归一化,内部处理)
   * @returns 是否成功开始(有 target 且 axis 非 null)
   */
  startDrag(
    axis: Exclude<GizmoAxis, null>,
    rayOrigin: Vector3,
    rayDirection: Vector3,
  ): boolean {
    if (!this.target || axis === null) return false;
    this.activeAxis = axis;
    this.isDragging = true;
    this.dragStart = {
      position: this.target.position.clone(),
      rotation: this.target.rotation.clone(),
      scale: this.target.scale.clone(),
    };
    this.dragStartT = this.projectRayToAxis(rayOrigin, rayDirection, axis);
    this.dragStartAngle = this.projectRayToAxisAngle(rayOrigin, rayDirection, axis);
    return true;
  }

  /**
   * 更新拖拽:根据射线投影到轴的增量修改 target 变换。
   * @param rayOrigin    当前鼠标射线起点
   * @param rayDirection 当前鼠标射线方向
   * @returns 是否实际修改了 target(未在拖拽/无 target 返回 false)
   */
  updateDrag(rayOrigin: Vector3, rayDirection: Vector3): boolean {
    if (!this.target || !this.isDragging || !this.dragStart) return false;
    const axis = this.activeAxis;
    if (axis === null) return false;
    const currentT = this.projectRayToAxis(rayOrigin, rayDirection, axis);
    const delta = currentT - this.dragStartT;

    switch (this.mode) {
      case 'translate': {
        if (axis === 'xyz') {
          // 整体平移:沿射线方向移动 delta
          _v1.copy(rayDirection);
          const len = _v1.length();
          if (len > 0) _v1.divideScalar(len);
          const moved = _v1.multiplyScalar(delta);
          this.target.position.copy(this.dragStart.position).add(moved);
        } else {
          const dir = axisDir(axis);
          this.target.position.copy(this.dragStart.position).addScaledVector(dir, delta);
        }
        if (this.snapEnabled) this.snapPositionInPlace(this.target.position);
        return true;
      }
      case 'rotate': {
        let angle: number;
        if (axis === 'xyz') {
          // 整体旋转:沿射线方向参数增量作为角度(放大灵敏度)
          angle = delta * 2;
          if (this.snapEnabled) {
            const snapRad = (this.rotateSnap * Math.PI) / 180;
            angle = snapValue(angle, snapRad);
          }
          _v1.copy(rayDirection);
          const len = _v1.length();
          if (len > 0) _v1.divideScalar(len);
          _q1.setFromAxisAngle(_v1, angle);
        } else {
          // 单轴旋转:在垂直于轴的平面上测量角度增量(绕轴公转)
          const currentAngle = this.projectRayToAxisAngle(rayOrigin, rayDirection, axis);
          angle = currentAngle - this.dragStartAngle;
          if (this.snapEnabled) {
            const snapRad = (this.rotateSnap * Math.PI) / 180;
            angle = snapValue(angle, snapRad);
          }
          _q1.setFromAxisAngle(axisDir(axis), angle);
        }
        // 在起始旋转基础上左乘增量旋转(世界空间旋转)
        this.target.rotation.copy(this.dragStart.rotation).multiply(_q1);
        return true;
      }
      case 'scale': {
        const newScale = this.dragStart.scale.clone();
        if (axis === 'xyz') {
          const s = Math.max(0.01, 1 + delta);
          newScale.x = Math.max(0.01, this.dragStart.scale.x * s);
          newScale.y = Math.max(0.01, this.dragStart.scale.y * s);
          newScale.z = Math.max(0.01, this.dragStart.scale.z * s);
        } else {
          const s = Math.max(0.01, 1 + delta);
          if (axis === 'x') newScale.x = Math.max(0.01, this.dragStart.scale.x * s);
          else if (axis === 'y') newScale.y = Math.max(0.01, this.dragStart.scale.y * s);
          else newScale.z = Math.max(0.01, this.dragStart.scale.z * s);
        }
        if (this.snapEnabled) {
          newScale.x = snapValue(newScale.x, this.scaleSnap);
          newScale.y = snapValue(newScale.y, this.scaleSnap);
          newScale.z = snapValue(newScale.z, this.scaleSnap);
          // 缩放吸附可能产生 0,保底 0.01
          newScale.x = Math.max(0.01, newScale.x);
          newScale.y = Math.max(0.01, newScale.y);
          newScale.z = Math.max(0.01, newScale.z);
        }
        this.target.scale.copy(newScale);
        return true;
      }
      default:
        return false;
    }
  }

  /** 结束拖拽:保留改动,清空拖拽状态。 */
  endDrag(): void {
    this.isDragging = false;
    this.dragStart = null;
    this.activeAxis = null;
  }

  /** 取消拖拽:把 target 恢复到 dragStart 快照,清空拖拽状态。 */
  cancelDrag(): void {
    if (this.dragStart && this.target) {
      this.target.position.copy(this.dragStart.position);
      this.target.rotation.copy(this.dragStart.rotation);
      this.target.scale.copy(this.dragStart.scale);
    }
    this.isDragging = false;
    this.dragStart = null;
    this.activeAxis = null;
  }

  /**
   * 射线命中测试:对 3 个轴端球 + 中心球做射线-球求交。
   * 不开始拖拽,仅返回命中的轴;调用方据此调用 startDrag。
   * @returns 命中的轴;未命中返回 null
   */
  hitTest(rayOrigin: Vector3, rayDirection: Vector3): GizmoAxis {
    if (!this.target) return null;
    const dir = rayDirection.length() > 0 ? rayDirection.clone().normalize() : new Vector3(0, 0, -1);
    const origin = this.target.position;
    const half = this.size;

    // 候选命中点列表:中心 + 3 轴端
    const candidates: Array<{ axis: Exclude<GizmoAxis, null>; center: Vector3; radius: number }> = [
      { axis: 'xyz', center: origin.clone(), radius: this.centerRadius * this.size },
      { axis: 'x', center: origin.clone().addScaledVector(_v1.set(1, 0, 0), half), radius: this.handleRadius * this.size },
      { axis: 'y', center: origin.clone().addScaledVector(_v2.set(0, 1, 0), half), radius: this.handleRadius * this.size },
      { axis: 'z', center: origin.clone().addScaledVector(_v3.set(0, 0, 1), half), radius: this.handleRadius * this.size },
    ];

    let closestAxis: GizmoAxis = null;
    let closestDist = Infinity;
    for (const c of candidates) {
      const hit = raySphere(rayOrigin, dir, c.center, c.radius);
      if (hit !== null) {
        if (hit < closestDist) {
          closestDist = hit;
          closestAxis = c.axis;
        }
      }
    }
    return closestAxis;
  }

  /**
   * 获取 Gizmo 变换矩阵:位于 target 世界位置,无旋转/缩放。
   * target 为 null 时返回单位矩阵。
   */
  getGizmoTransform(): Matrix4 {
    const m = new Matrix4();
    if (!this.target) return m;
    m.compose(this.target.position, new Quaternion(0, 0, 0, 1), new Vector3(1, 1, 1));
    return m;
  }

  /**
   * 应用平移增量(受 snapEnabled 影响)。
   * @param delta 平移增量(世界空间)
   */
  applyTranslation(delta: Vector3): void {
    if (!this.target) return;
    this.target.position.add(delta);
    if (this.snapEnabled) this.snapPositionInPlace(this.target.position);
  }

  /**
   * 应用旋转增量(受 snapEnabled 影响)。
   * 吸附:把 delta 的轴角角度吸附到 rotateSnap(度)整数倍。
   * @param delta 旋转增量四元数
   */
  applyRotation(delta: Quaternion): void {
    if (!this.target) return;
    let q = delta;
    if (this.snapEnabled) {
      _v1.set(0, 0, 0); // 复用为轴输出
      const angle = delta.toAxisAngle(_v1);
      const snapRad = (this.rotateSnap * Math.PI) / 180;
      const snappedAngle = snapValue(angle, snapRad);
      q = new Quaternion().setFromAxisAngle(_v1, snappedAngle);
    }
    this.target.rotation.multiply(q);
  }

  /**
   * 应用缩放增量(受 snapEnabled 影响)。
   * @param delta 缩放增量(分量乘数)
   */
  applyScale(delta: Vector3): void {
    if (!this.target) return;
    this.target.scale.x = Math.max(0.01, this.target.scale.x * delta.x);
    this.target.scale.y = Math.max(0.01, this.target.scale.y * delta.y);
    this.target.scale.z = Math.max(0.01, this.target.scale.z * delta.z);
    if (this.snapEnabled) {
      this.target.scale.x = Math.max(0.01, snapValue(this.target.scale.x, this.scaleSnap));
      this.target.scale.y = Math.max(0.01, snapValue(this.target.scale.y, this.scaleSnap));
      this.target.scale.z = Math.max(0.01, snapValue(this.target.scale.z, this.scaleSnap));
    }
  }

  /**
   * 把 value 吸附到 step 的整数倍。step<=0 时原样返回。
   * 用 Math.round:对负数也能正确吸附到最近格点。
   */
  snapValue(value: number, snap: number): number {
    if (snap <= 0) return value;
    return Math.round(value / snap) * snap;
  }

  /**
   * 获取渲染数据。target 为 null 时返回 null(调用方不渲染)。
   */
  render(): GizmoRenderData | null {
    if (!this.target) return null;
    return {
      origin: this.target.position.clone(),
      axes: {
        x: new Vector3(1, 0, 0),
        y: new Vector3(0, 1, 0),
        z: new Vector3(0, 0, 1),
      },
      size: this.size,
      mode: this.mode,
      activeAxis: this.activeAxis,
      isDragging: this.isDragging,
      colors: {
        x: { ...this.xColor },
        y: { ...this.yColor },
        z: { ...this.zColor },
        hover: { ...this.hoverColor },
      },
    };
  }

  // ── 内部工具 ──────────────────────────────────────────────────────

  /** 平移吸附:原地修改 position 三分量。 */
  private snapPositionInPlace(position: Vector3): void {
    position.x = snapValue(position.x, this.translateSnap);
    position.y = snapValue(position.y, this.translateSnap);
    position.z = snapValue(position.z, this.translateSnap);
  }

  /**
   * 把射线投影到指定轴所在直线上,返回轴参数 t(origin + dir * t)。
   * 'xyz' 模式:返回射线方向上离 target 最近的参数(沿射线方向)。
   * 单轴:取射线离 axisOrigin 最近的点,再投影到轴方向。
   */
  private projectRayToAxis(
    rayOrigin: Vector3,
    rayDirection: Vector3,
    axis: Exclude<GizmoAxis, null>,
  ): number {
    if (!this.target) return 0;
    const axisOrigin = this.target.position;
    if (axis === 'xyz') {
      // 射线方向上离 axisOrigin 最近的参数 t
      const dir = rayDirection.length() > 0 ? rayDirection.clone().normalize() : new Vector3(0, 0, -1);
      _v1.subVectors(axisOrigin, rayOrigin);
      return _v1.dot(dir);
    }
    const dir = axisDir(axis);
    // 射线上离 axisOrigin 最近的点
    const rayDirN = rayDirection.length() > 0 ? rayDirection.clone().normalize() : new Vector3(0, 0, -1);
    _v1.subVectors(axisOrigin, rayOrigin);
    const tRay = _v1.dot(rayDirN);
    _v2.copy(rayOrigin).addScaledVector(rayDirN, tRay); // 射线上最近点
    // 投影到轴方向:(closestOnRay - axisOrigin) · dir
    return _v3.subVectors(_v2, axisOrigin).dot(dir);
  }

  /**
   * 把射线投影到"垂直于轴、过 target 位置"的平面上,返回绕轴的方位角(弧度)。
   * 用于单轴 rotate:角度增量 = 当前方位角 - 起始方位角。
   * 平面内基 (u,v) 满足 u×v = axisDir,保证角度方向与右手定则一致:
   *   X 轴:u=Y, v=Z → angle = atan2(rel.z, rel.y)
   *   Y 轴:u=Z, v=X → angle = atan2(rel.x, rel.z)
   *   Z 轴:u=X, v=Y → angle = atan2(rel.y, rel.x)
   * 'xyz' 不使用此方法。射线与平面平行时返回 dragStartAngle(无增量)。
   */
  private projectRayToAxisAngle(
    rayOrigin: Vector3,
    rayDirection: Vector3,
    axis: Exclude<GizmoAxis, null>,
  ): number {
    if (!this.target) return 0;
    if (axis === 'xyz') return 0;
    const axisOrigin = this.target.position;
    const normal = axisDir(axis);
    const rayDirN = rayDirection.length() > 0 ? rayDirection.clone().normalize() : new Vector3(0, 0, -1);
    const denom = rayDirN.dot(normal);
    if (Math.abs(denom) < 1e-6) return this.dragStartAngle; // 射线平行于平面,无角度变化
    _v1.subVectors(axisOrigin, rayOrigin);
    const t = _v1.dot(normal) / denom;
    _v2.copy(rayOrigin).addScaledVector(rayDirN, t); // 射线与平面交点
    _v3.subVectors(_v2, axisOrigin); // 相对轴心的平面内向量
    if (axis === 'x') return Math.atan2(_v3.z, _v3.y);
    if (axis === 'y') return Math.atan2(_v3.x, _v3.z);
    return Math.atan2(_v3.y, _v3.x); // z
  }
}

/** 轴字母 → 单位方向向量(新建实例,避免污染内部临时变量)。 */
function axisDir(axis: 'x' | 'y' | 'z'): Vector3 {
  switch (axis) {
    case 'x': return new Vector3(1, 0, 0);
    case 'y': return new Vector3(0, 1, 0);
    case 'z': return new Vector3(0, 0, 1);
  }
}

/**
 * 把 value 吸附到 step 的整数倍。step<=0 时原样返回。
 * (模块级函数,与 TransformGizmo.snapValue 行为一致。)
 */
function snapValue(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * 射线-球求交:返回离 rayOrigin 最近的正向交点距离,无交点返回 null。
 * rayDirection 必须归一化。
 */
function raySphere(
  rayOrigin: Vector3,
  rayDirection: Vector3,
  center: Vector3,
  radius: number,
): number | null {
  _v1.subVectors(center, rayOrigin);
  const tca = _v1.dot(rayDirection);
  const d2 = _v1.dot(_v1) - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return null;
  const thc = Math.sqrt(Math.max(0, r2 - d2));
  const t0 = tca - thc;
  const t1 = tca + thc;
  if (t1 < 0) return null; // 整个球在射线后方
  if (t0 < 0) return t1; // origin 在球内,返回出口距离
  return t0;
}

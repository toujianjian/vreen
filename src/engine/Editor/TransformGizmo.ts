// TransformGizmo — 变换 Gizmo(移动/旋转/缩放)。
// 在选中对象位置渲染 3 轴手柄,鼠标拖拽沿单轴或多轴变换目标。
//
// 设计:
//   * Gizmo 本身不绘制 WebGL(避免与 Renderer 耦合),而是产出 `getMeshData()`
//     由调用方(UI 层 / debug overlay)渲染。这样测试无需 WebGL context。
//   * 手柄由 3 条轴向线段(X/Y/Z)构成,长度 = size。轴端点为小球(命中检测用球)。
//   * 拖拽逻辑:
//       1. handleMouseDown(ray) → 对 3 个轴端球做射线-球求交,命中则开始拖拽并记录 hoveredAxis
//       2. handleMouseMove(ray, camera) → 把射线投影到轴所在直线/平面,计算 delta
//       3. handleMouseUp() → 结束拖拽
//   * `update(camera)` 让 Gizmo 始终面向相机(screen-aligned),便于从任意视角操作。
//   * 拖拽过程中的目标变换写回 target.position/rotation/scale,调用方负责记录历史命令。

import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { Ray } from '../Math/Ray';
import { Sphere } from '../Math/Sphere';
import type { Matrix4 } from '../Math/Matrix4';

/** Gizmo 模式。 */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** 当前悬停或拖拽的轴。 */
export type GizmoAxis = 'x' | 'y' | 'z' | null;

/** 渲染数据:供调用方转换为可绘制 geometry。 */
export interface GizmoMeshData {
  /** 三条轴的起点(均为 target 世界位置)。 */
  origin: Vector3;
  /** 三条轴的方向(世界空间,已做 screen-aligned 调整)。 */
  axes: {
    x: Vector3;
    y: Vector3;
    z: Vector3;
  };
  /** 三条轴的长度(= size,悬停轴会略放大)。 */
  size: number;
  /** 当前模式,供调用方选择不同的 mesh(箭头/圆环/方块)。 */
  mode: GizmoMode;
  /** 悬停/拖拽中的轴,调用方可高亮该轴颜色。 */
  hoveredAxis: GizmoAxis;
  /** 是否正在拖拽。 */
  dragging: boolean;
}

// 内部复用的临时向量,避免每帧分配
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q1 = new Quaternion();
const _sphere = new Sphere(new Vector3(), 0);

export class TransformGizmo {
  /** 当前模式。 */
  mode: GizmoMode = 'translate';
  /** 当前操作的目标对象(null 时 Gizmo 不显示)。 */
  target: Object3D | null = null;
  /** Gizmo 整体大小(世界单位)。 */
  size: number = 1;
  /** 当前悬停的轴(null 表示无)。 */
  hoveredAxis: GizmoAxis = null;
  /** 是否正在拖拽。 */
  dragging: boolean = false;

  /** 拖拽起始时 target 的位置/旋转/缩放快照,用于计算增量。 */
  private dragStartPos: Vector3 = new Vector3();
  private dragStartRot: Quaternion = new Quaternion();
  private dragStartScale: Vector3 = new Vector3(1, 1, 1);
  /** 拖拽起始时鼠标射线投影到轴上的参数 t,作为增量基准。 */
  private dragStartT: number = 0;
  /** 轴端球的命中半径(世界单位的相对比例)。 */
  private handleRadius: number = 0.15;

  /** 设置模式。相同模式不触发副作用。 */
  setMode(mode: GizmoMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    // 切换模式时取消任何进行中的悬停/拖拽
    this.hoveredAxis = null;
    this.dragging = false;
  }

  /** 设置目标对象。null 表示隐藏 Gizmo。 */
  setTarget(object: Object3D | null): void {
    this.target = object;
    this.hoveredAxis = null;
    this.dragging = false;
  }

  /** 设置 Gizmo 大小。 */
  setSize(size: number): void {
    this.size = size > 0 ? size : 1;
  }

  /**
   * 每帧更新:让 Gizmo 与 target 世界位置对齐。
   * 当前实现不做 screen-aligned 旋转(轴始终是世界 X/Y/Z),保持简单与可预测;
   * 调用方可在 UI 层基于 camera 调整 size 实现屏幕恒定大小。
   * @param _camera 预留:供未来实现 screen-aligned 旋转使用
   */
  update(_camera?: { matrixWorld: Matrix4 } | null): void {
    if (!this.target) return;
    // 当前实现:Gizmo 跟随 target 世界位置即可。
    // 世界位置 = target.matrixWorld 的平移列;但为了避免依赖矩阵更新时机,
    // 这里直接用 position(适用于无父节点或父节点未变换的常见情况)。
    // 严格场景下调用方应先 target.updateMatrixWorld(true)。
  }

  /**
   * 鼠标按下:对 3 个轴端球做射线-球求交。命中则开始拖拽并记录 hoveredAxis。
   * @returns 命中的轴('x'|'y'|'z');未命中返回 null
   */
  handleMouseDown(ray: Ray): GizmoAxis {
    if (!this.target) return null;
    const origin = this.target.position;
    const half = this.size;
    _sphere.center.copy(origin);
    _sphere.radius = this.handleRadius * this.size;

    // 3 个轴端球位置
    const axes: Array<{ axis: Exclude<GizmoAxis, null>; dir: Vector3 }> = [
      { axis: 'x', dir: _v1.set(1, 0, 0) },
      { axis: 'y', dir: _v2.set(0, 1, 0) },
      { axis: 'z', dir: _v3.set(0, 0, 1) },
    ];

    let closestAxis: GizmoAxis = null;
    let closestDist = Infinity;
    for (const a of axes) {
      // 轴端球中心 = origin + dir * half
      _sphere.center.copy(origin).addScaledVector(a.dir, half);
      const hit = ray.intersectSphere(_sphere, new Vector3());
      if (hit !== null) {
        const d = ray.origin.distanceTo(hit);
        if (d < closestDist) {
          closestDist = d;
          closestAxis = a.axis;
        }
      }
    }

    if (closestAxis !== null) {
      this.hoveredAxis = closestAxis;
      this.dragging = true;
      // 记录起始快照
      this.dragStartPos.copy(this.target.position);
      this.dragStartRot.copy(this.target.rotation);
      this.dragStartScale.copy(this.target.scale);
      // 记录射线投影到轴上的起始参数
      this.dragStartT = this.projectRayToAxis(ray, closestAxis);
    }
    return closestAxis;
  }

  /**
   * 鼠标移动:若正在拖拽,根据射线投影到轴的增量修改 target 变换。
   * @param ray     当前鼠标射线
   * @param _camera 预留
   * @returns 是否实际修改了 target
   */
  handleMouseMove(ray: Ray, _camera?: { matrixWorld: Matrix4 } | null): boolean {
    if (!this.target || !this.dragging) return false;
    const axis = this.hoveredAxis;
    // 在本地变量上做 null 收窄(class 属性不会被 TS 在 guard 后自动收窄)
    if (axis === null) return false;
    const currentT = this.projectRayToAxis(ray, axis);
    const delta = currentT - this.dragStartT;

    switch (this.mode) {
      case 'translate': {
        // 沿轴方向平移 delta 个单位
        const dir = axisDir(axis);
        this.target.position.copy(this.dragStartPos).addScaledVector(dir, delta);
        return true;
      }
      case 'rotate': {
        // 旋转:把 delta 当作角度(弧度)绕轴旋转
        const angle = delta * 2; // 放大灵敏度
        const axisV = axisDir(axis);
        _q1.setFromAxisAngle(axisV, angle);
        // 在起始旋转基础上左乘增量旋转(世界空间旋转)
        this.target.rotation.copy(this.dragStartRot).multiply(_q1);
        return true;
      }
      case 'scale': {
        // 缩放:单轴缩放,只修改对应分量,保留其他轴原始值
        const s = Math.max(0.01, 1 + delta);
        const newScale = this.dragStartScale.clone();
        if (axis === 'x') newScale.x = Math.max(0.01, this.dragStartScale.x * s);
        else if (axis === 'y') newScale.y = Math.max(0.01, this.dragStartScale.y * s);
        else newScale.z = Math.max(0.01, this.dragStartScale.z * s);
        this.target.scale.copy(newScale);
        return true;
      }
      default:
        return false;
    }
  }

  /** 鼠标释放:结束拖拽。 */
  handleMouseUp(): void {
    this.dragging = false;
    // 保留 hoveredAxis 让调用方在释放后仍可高亮;下一次 mouseDown 会重新判定
  }

  /** 获取当前悬停轴。 */
  getHoveredAxis(): GizmoAxis {
    return this.hoveredAxis;
  }

  /**
   * 获取渲染数据。target 为 null 时返回 null(调用方不渲染)。
   */
  getMeshData(): GizmoMeshData | null {
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
      hoveredAxis: this.hoveredAxis,
      dragging: this.dragging,
    };
  }

  /**
   * 把射线投影到指定轴所在直线上,返回轴参数 t(origin + dir * t)。
   * 用"射线最近点 → 轴最近点"投影:取射线与轴的公垂线在轴上的交点。
   * 简化实现:取射线上离 axis origin 最近的点,再投影到轴方向。
   */
  private projectRayToAxis(ray: Ray, axis: Exclude<GizmoAxis, null>): number {
    if (!this.target) return 0;
    const axisOrigin = this.target.position;
    const dir = axisDir(axis);
    // 射线上离 axisOrigin 最近的点
    const closestOnRay = ray.closestPointToPoint(axisOrigin, new Vector3());
    // 投影到轴方向:(closestOnRay - axisOrigin) · dir
    const t = _v1.subVectors(closestOnRay, axisOrigin).dot(dir);
    return t;
  }
}

/** 轴字母 → 单位方向向量(新建实例,避免污染内部临时变量)。 */
function axisDir(axis: Exclude<GizmoAxis, null>): Vector3 {
  switch (axis) {
    case 'x': return new Vector3(1, 0, 0);
    case 'y': return new Vector3(0, 1, 0);
    case 'z': return new Vector3(0, 0, 1);
  }
}

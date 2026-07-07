// OrbitControls — 自研相机轨道控制器，零 three 依赖。
//
// 设计目标：
//   - PointerEvent 一手接入（含触屏 / 触控笔），不再用 mouse event。
//   - 用球坐标 (radius, theta, phi) 表达相机相对 target 的位姿，便于
//     预设切换 (FREE/ISO/FRONT/...) 和 damping 插值。
//   - 每帧由渲染循环调用 update()；damping 衰减与事件触发都在
//     update() 里结算，事件回调只更新"目标值"，避免帧率耦合。
//   - 通过 setPointerCapture 把指针锁定到画布上，移动到浏览器外
//     也不会丢事件；pointerup / pointercancel 释放。
//
// 与 three.js OrbitControls 的语义对应：
//   左键拖拽   = rotate
//   右键拖拽   = pan
//   中键拖拽   = pan
//   滚轮 / 捏合 = dolly (缩放)
//   触控单指   = rotate
//   触控双指   = pan + dolly（简化：单指 rotate，双指 dolly）
//
// 注意：本类不调用 camera.updateMatrixWorld()，由 Renderer.render() 负责。

import { Vector3 } from '../Math/Vector3';
import { Camera } from '../Cameras/Camera';
import * as MathUtils from '../Math/MathUtils';

interface PointerEntry {
  /** PointerEvent.pointerId. */
  id: number;
  /** 该指针起始位置 (px). */
  startX: number;
  startY: number;
  /** 该指针当前位置 (px). */
  curX: number;
  curY: number;
  /** 触发时的鼠标按钮 (触屏为 0). */
  button: number;
}

interface Spherical {
  radius: number;
  /** azimuthal angle, around world Y, radians. */
  theta: number;
  /** polar angle from world Y axis, radians. 0 = +Y up, π = -Y down. */
  phi: number;
}

const TWO_PI = Math.PI * 2;

export interface OrbitControlsOptions {
  enableDamping?: boolean;
  dampingFactor?: number;
  enableRotate?: boolean;
  enablePan?: boolean;
  enableZoom?: boolean;
  rotateSpeed?: number;
  panSpeed?: number;
  zoomSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  minAzimuthAngle?: number;
  maxAzimuthAngle?: number;
  /** 是否阻止浏览器默认手势 (contextmenu / pinch-zoom 页面缩放). */
  preventDefaultGestures?: boolean;
}

export class OrbitControls {
  readonly camera: Camera;
  readonly domElement: HTMLElement;

  // ── 配置 ───────────────────────────────────────────────────────────
  enableDamping: boolean;
  dampingFactor: number;
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  minAzimuthAngle: number;
  maxAzimuthAngle: number;
  preventDefaultGestures: boolean;

  // ── 状态 ───────────────────────────────────────────────────────────
  /** 相机注视点（世界坐标）。 */
  target = new Vector3(0, 0, 0);
  /** 当前球坐标 (Damping 后生效的"显示值")。 */
  private _spherical: Spherical = { radius: 5, theta: 0, phi: Math.PI / 2 };
  /** 球坐标目标值 (用户输入希望到达的位置)。 */
  private _sphericalTarget: Spherical = { radius: 5, theta: 0, phi: Math.PI / 2 };
  /** target 偏移累计 (pan)。 */
  private _panOffset = new Vector3(0, 0, 0);
  private _panOffsetTarget = new Vector3(0, 0, 0);
  /** 当前缩放比，dolly 累积。1.0 = 初始. */
  private _scale = 1;
  private _scaleTarget = 1;

  /** 监听中的指针。 */
  private _pointers: Map<number, PointerEntry> = new Map();
  /** 多指 pinch 起始距离。 */
  private _pinchStartDist = 0;
  private _pinchStartScale = 1;

  private _enabled = true;
  private _disposed = false;

  // ── 事件 ───────────────────────────────────────────────────────────
  /** 'change' 在 update() 之后相机实际移动时触发。 */
  onChange: (() => void) | null = null;
  /** 'start' 在用户按下指针时触发一次。 */
  onStart: (() => void) | null = null;
  /** 'end' 在所有指针抬起时触发一次。 */
  onEnd: (() => void) | null = null;

  // ── 绑定 / 解绑用的句柄 ────────────────────────────────────────────
  private _onPointerDown = (e: PointerEvent) => this._handlePointerDown(e);
  private _onPointerMove = (e: PointerEvent) => this._handlePointerMove(e);
  private _onPointerUp = (e: PointerEvent) => this._handlePointerUp(e);
  private _onPointerCancel = (e: PointerEvent) => this._handlePointerUp(e);
  private _onWheel = (e: WheelEvent) => this._handleWheel(e);
  private _onContextMenu = (e: MouseEvent) => {
    if (this.preventDefaultGestures) e.preventDefault();
  };

  constructor(camera: Camera, domElement: HTMLElement, opts: OrbitControlsOptions = {}) {
    this.camera = camera;
    this.domElement = domElement;

    this.enableDamping = opts.enableDamping ?? true;
    this.dampingFactor = opts.dampingFactor ?? 0.08;
    this.enableRotate = opts.enableRotate ?? true;
    this.enablePan = opts.enablePan ?? true;
    this.enableZoom = opts.enableZoom ?? true;
    this.rotateSpeed = opts.rotateSpeed ?? 1.0;
    this.panSpeed = opts.panSpeed ?? 1.0;
    this.zoomSpeed = opts.zoomSpeed ?? 1.0;
    this.minDistance = opts.minDistance ?? 0;
    this.maxDistance = opts.maxDistance ?? Infinity;
    this.minPolarAngle = opts.minPolarAngle ?? 0;
    this.maxPolarAngle = opts.maxPolarAngle ?? Math.PI;
    this.minAzimuthAngle = opts.minAzimuthAngle ?? -Infinity;
    this.maxAzimuthAngle = opts.maxAzimuthAngle ?? Infinity;
    this.preventDefaultGestures = opts.preventDefaultGestures ?? true;

    // 同步初始球坐标 = 当前相机相对 target 的位姿
    this._syncFromCamera();
    this._sphericalTarget = { ...this._spherical };
    this._scaleTarget = this._scale;

    const el = this.domElement;
    el.style.touchAction = 'none'; // 禁用浏览器默认手势
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerCancel);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', this._onContextMenu);
  }

  // ── 公开 API ───────────────────────────────────────────────────────
  /** 设置是否启用。 */
  setEnabled(v: boolean): void {
    this._enabled = v;
  }

  /** 把球坐标的"目标值"瞬时同步到当前值（切断 damping 余韵）。 */
  stopDamping(): void {
    this._spherical = { ...this._sphericalTarget };
    this._panOffset.copy(this._panOffsetTarget);
    this._scale = this._scaleTarget;
  }

  /** 重置到相机初始位姿（基于当前 target 重新计算）。 */
  reset(): void {
    this._syncFromCamera();
    this._sphericalTarget = { ...this._spherical };
    this._panOffset.set(0, 0, 0);
    this._panOffsetTarget.set(0, 0, 0);
    this._scale = 1;
    this._scaleTarget = 1;
  }

  /** 销毁。务必在不再使用时调用，避免事件泄漏。 */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    const el = this.domElement;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerCancel);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('contextmenu', this._onContextMenu);
    this._pointers.clear();
  }

  /**
   * 每帧由渲染循环调用一次。返回是否"有变化"（用于决定要不要 render）。
   * damping 衰减 + 把 target 应用到 camera 上都在这里做。
   */
  update(): boolean {
    if (this._disposed) return false;

    let changed = false;
    const k = this.enableDamping ? this.dampingFactor : 1;

    // spherical: linear interpolate current -> target with damping.
    if (this.enableDamping) {
      const lerp = (cur: number, tgt: number) => cur + (tgt - cur) * k;
      // 球坐标插值要小心 theta 跨越 ±π 时的环绕：用目标值与当前差
      // 的最短路径 (modulo 2π) 来 lerp。
      const dTheta = MathUtils.angleDelta(this._spherical.theta, this._sphericalTarget.theta);
      this._spherical.theta += dTheta * k;
      this._spherical.phi = lerp(this._spherical.phi, this._sphericalTarget.phi);
      this._spherical.radius = lerp(this._spherical.radius, this._sphericalTarget.radius);
    } else {
      this._spherical = { ...this._sphericalTarget };
    }

    // pan: linear interpolate offset.
    if (this.enableDamping) {
      this._panOffset.x += (this._panOffsetTarget.x - this._panOffset.x) * k;
      this._panOffset.y += (this._panOffsetTarget.y - this._panOffset.y) * k;
      this._panOffset.z += (this._panOffsetTarget.z - this._panOffset.z) * k;
    } else {
      this._panOffset.copy(this._panOffsetTarget);
    }

    // scale: 1.0 = 无变化，> 1 = 拉近，< 1 = 拉远。
    if (this.enableDamping) {
      this._scale += (this._scaleTarget - this._scale) * k;
    } else {
      this._scale = this._scaleTarget;
    }

    // 应用到 camera：target + pan 偏移，然后从球坐标还原位置。
    this._applyToCamera();

    // 检测有无变化（用 epsilon 防止浮点抖动）
    if (
      Math.abs(this._spherical.theta - this._sphericalTarget.theta) > 1e-5 ||
      Math.abs(this._spherical.phi - this._sphericalTarget.phi) > 1e-5 ||
      Math.abs(this._spherical.radius - this._sphericalTarget.radius) > 1e-4 ||
      Math.abs(this._panOffset.x - this._panOffsetTarget.x) > 1e-5 ||
      Math.abs(this._panOffset.y - this._panOffsetTarget.y) > 1e-5 ||
      Math.abs(this._panOffset.z - this._panOffsetTarget.z) > 1e-5 ||
      Math.abs(this._scale - this._scaleTarget) > 1e-4
    ) {
      changed = true;
    }

    if (changed && this.onChange) this.onChange();
    return changed;
  }

  /** 从相机当前位置反向同步球坐标（用于 reset 或外部改变相机位姿后）。 */
  private _syncFromCamera(): void {
    const offset = new Vector3().copy(this.camera.position).sub(this.target);
    const r = offset.length();
    const theta = Math.atan2(offset.x, offset.z); // 方位角，绕 Y 轴
    // phi: 0 = +Y. 我们约定 phi = acos(y/r)。
    const phi = Math.acos(MathUtils.clamp(offset.y / Math.max(r, 1e-6), -1, 1));
    this._spherical = { radius: Math.max(r, 1e-4), theta, phi };
    this._panOffset.set(0, 0, 0);
    this._panOffsetTarget.set(0, 0, 0);
  }

  /** 把当前球坐标 + pan + scale 应用到 camera.position 与 target。 */
  private _applyToCamera(): void {
    const r = this._spherical.radius * this._scale;
    const sinPhi = Math.sin(this._spherical.phi);
    const offset = new Vector3(
      r * sinPhi * Math.sin(this._spherical.theta),
      r * Math.cos(this._spherical.phi),
      r * sinPhi * Math.cos(this._spherical.theta),
    );
    const tgt = new Vector3().copy(this.target).add(this._panOffset);
    this.camera.position.copy(tgt).add(offset);
    this.camera.lookAt(tgt.x, tgt.y, tgt.z);
  }

  // ── 事件处理 ───────────────────────────────────────────────────────
  private _handlePointerDown(e: PointerEvent): void {
    if (!this._enabled) return;
    if (this.preventDefaultGestures) e.preventDefault();

    const entry: PointerEntry = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      button: e.button,
    };
    this._pointers.set(e.pointerId, entry);
    try {
      this.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture may fail on detached elements; ignore. */
    }

    if (this._pointers.size === 1) {
      this.onStart?.();
    } else if (this._pointers.size === 2) {
      // 进入 pinch 模式
      const ids = [...this._pointers.keys()];
      const a = this._pointers.get(ids[0])!;
      const b = this._pointers.get(ids[1])!;
      this._pinchStartDist = Math.hypot(a.curX - b.curX, a.curY - b.curY);
      this._pinchStartScale = this._scaleTarget;
    }
  }

  private _handlePointerMove(e: PointerEvent): void {
    if (!this._enabled) return;
    const entry = this._pointers.get(e.pointerId);
    if (!entry) return;
    entry.curX = e.clientX;
    entry.curY = e.clientY;

    if (this._pointers.size === 1) {
      this._handleSinglePointerMove(entry);
    } else if (this._pointers.size === 2) {
      this._handlePinchMove();
    }
  }

  private _handleSinglePointerMove(e: PointerEntry): void {
    const dx = e.curX - e.startX;
    const dy = e.curY - e.startY;
    e.startX = e.curX;
    e.startY = e.curY;

    // 触屏单指 = rotate (button === 0 + pointerType === 'touch')
    const isTouch = e.button === 0 &&
      (this._pointers.get(e.id) as unknown as { pointerType?: string }) !== undefined;
    void isTouch; // 简化：单指都按 rotate

    if (e.button === 0 && this.enableRotate) {
      // 左键 = rotate
      this._rotateByPixels(dx, dy);
    } else if ((e.button === 1 || e.button === 2) && this.enablePan) {
      // 中键 / 右键 = pan
      this._panByPixels(dx, dy);
    }
  }

  private _handlePinchMove(): void {
    if (!this.enableZoom) return;
    const ids = [...this._pointers.keys()];
    const a = this._pointers.get(ids[0])!;
    const b = this._pointers.get(ids[1])!;
    const d = Math.hypot(a.curX - b.curX, a.curY - b.curY);
    if (this._pinchStartDist > 0) {
      const factor = this._pinchStartDist / Math.max(d, 1);
      this._scaleTarget = MathUtils.clamp(this._pinchStartScale * factor, 0.05, 50);
    }
  }

  private _handlePointerUp(e: PointerEvent): void {
    const entry = this._pointers.get(e.pointerId);
    if (!entry) return;
    this._pointers.delete(e.pointerId);
    try {
      this.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this._pointers.size === 0) {
      this.onEnd?.();
    } else if (this._pointers.size === 1) {
      // 回到单指：重置 pinch 起点
      const remain = [...this._pointers.values()][0];
      remain.startX = remain.curX;
      remain.startY = remain.curY;
    }
  }

  private _handleWheel(e: WheelEvent): void {
    if (!this._enabled || !this.enableZoom) return;
    if (this.preventDefaultGestures) e.preventDefault();

    // deltaY > 0 视为向下滚 = 拉远 (radius 增大); 反之拉近。
    // 用乘法让远近倍率恒定：scale *= (1 + deltaY * zoomSpeed * 0.001)
    const factor = 1 + e.deltaY * this.zoomSpeed * 0.0015;
    this._scaleTarget = MathUtils.clamp(this._scaleTarget * factor, 0.05, 50);
  }

  // ── 输入 → 球坐标 / pan ────────────────────────────────────────────
  private _rotateByPixels(dx: number, dy: number): void {
    const el = this.domElement;
    const h = Math.max(el.clientHeight, 1);
    // 与 three.js OrbitControls 同语义：azimuth 受宽度影响，polar 受高度影响。
    // 我们直接用像素 → 弧度转换，乘 rotateSpeed。
    const dTheta = (-2 * Math.PI * dx) / h;
    const dPhi = (-2 * Math.PI * dy) / h;
    this._sphericalTarget.theta -= dTheta * this.rotateSpeed;
    this._sphericalTarget.phi -= dPhi * this.rotateSpeed;
    this._sphericalTarget.phi = MathUtils.clamp(
      this._sphericalTarget.phi,
      this.minPolarAngle,
      this.maxPolarAngle,
    );
    if (this.minAzimuthAngle !== -Infinity || this.maxAzimuthAngle !== Infinity) {
      // Wrap into range first, then clamp
      this._sphericalTarget.theta = MathUtils.wrapAngle(this._sphericalTarget.theta);
      this._sphericalTarget.theta = MathUtils.clamp(
        this._sphericalTarget.theta,
        this.minAzimuthAngle,
        this.maxAzimuthAngle,
      );
    }
  }

  private _panByPixels(dx: number, dy: number): void {
    const el = this.domElement;
    const h = Math.max(el.clientHeight, 1);
    // 计算相机右向量和上向量（与 target 视线正交）。
    // 移动量按当前距离归一化，与 three.js OrbitControls 行为一致。
    const r = Math.max(this._spherical.radius * this._scale, 1e-4);
    const panX = (-2 * dx * r) / h;
    const panY = (2 * dy * r) / h;
    this.panByWorldDelta(panX * this.panSpeed, panY * this.panSpeed, 0);
  }

  /** 沿相机右 / 上方向平移 target。 */
  panByWorldDelta(x: number, y: number, z: number): void {
    // 先取相机的右向量和上向量
    const forward = new Vector3().copy(this.camera.position).sub(this.target).normalize();
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().copy(forward).cross(up).normalize();
    const camUp = new Vector3().copy(right).cross(forward).normalize();
    // move = right * x + camUp * y + forward * z
    const move = new Vector3(
      right.x * x + camUp.x * y + forward.x * z,
      right.y * x + camUp.y * y + forward.y * z,
      right.z * x + camUp.z * y + forward.z * z,
    );
    this._panOffsetTarget.add(move);
    this.target.add(move);
  }

  /** 重置 target 到指定位置。 */
  setTarget(t: Vector3): void {
    const delta = new Vector3().copy(t).sub(this.target);
    this._panOffsetTarget.add(delta);
    this._panOffset.add(delta);
    this.target.copy(t);
  }

  /** 顺时针 / 逆时针水平自转指定角度。 */
  rotateAzimuth(deltaRad: number): void {
    this._sphericalTarget.theta += deltaRad;
    this._sphericalTarget.theta = MathUtils.wrapAngle(this._sphericalTarget.theta);
  }

  /** 俯仰角调整。 */
  rotatePolar(deltaRad: number): void {
    this._sphericalTarget.phi = MathUtils.clamp(
      this._sphericalTarget.phi + deltaRad,
      this.minPolarAngle,
      this.maxPolarAngle,
    );
  }

  /** 缩放（> 1 拉近，< 1 拉远）。 */
  zoom(scale: number): void {
    this._scaleTarget = MathUtils.clamp(this._scaleTarget * scale, 0.05, 50);
  }
}

// PointerLockControls — 第一人称指针锁定控制器，零 three 依赖。
//
// 设计目标：
//   - 基于 Pointer Lock API：lock() 请求指针锁定，unlock() 释放。
//   - 鼠标移动只改变相机朝向（YXZ 欧拉角），不改变位置。
//   - 提供 moveForward / moveRight 在 xz 平面平移相机（假设 up=Y）。
//   - 支持 minPolarAngle / maxPolarAngle 限制俯仰。
//   - 事件挂载在 domElement.ownerDocument 上；dispose() 必须显式调用。
//
// 与 three.js PointerLockControls 的语义对应：
//   lock()        → 请求 pointerLock
//   unlock()      → 退出 pointerLock
//   isLocked      → 当前是否处于锁定状态
//   mousemove     → 修改 camera.quaternion（YXZ 顺序）
//   moveForward() → 沿 xz 平面前进（不改变 y）
//   moveRight()   → 沿 xz 平面右移（不改变 y）

import { Camera } from '../Cameras/Camera';
import { Vector3 } from '../Math/Vector3';
import { Euler } from '../Math/Euler';

export interface PointerLockControlsOptions {
  /** 俯仰下限（弧度，0 = +Y 朝上）。默认 0。 */
  minPolarAngle?: number;
  /** 俯仰上限（弧度，π = -Y 朝下）。默认 π。 */
  maxPolarAngle?: number;
  /** 鼠标灵敏度倍率。默认 1。 */
  pointerSpeed?: number;
}

const MOUSE_SENSITIVITY = 0.002;
const PI_2 = Math.PI / 2;

export class PointerLockControls {
  readonly camera: Camera;
  readonly domElement: HTMLElement;

  /** 是否处于指针锁定状态。 */
  isLocked = false;
  minPolarAngle: number;
  maxPolarAngle: number;
  pointerSpeed: number;

  private _enabled = true;
  private _disposed = false;
  private _euler = new Euler(0, 0, 0, 'YXZ');
  private _tmpVec = new Vector3();
  private _tmpVec2 = new Vector3();

  /** 相机朝向变化时触发。 */
  onChange: (() => void) | null = null;
  /** 进入指针锁定时触发。 */
  onLock: (() => void) | null = null;
  /** 退出指针锁定时触发。 */
  onUnlock: (() => void) | null = null;

  // ── 绑定 / 解绑用的句柄 ────────────────────────────────────────────
  private _onMouseMove = (e: MouseEvent) => this._handleMouseMove(e);
  private _onPointerLockChange = () => this._handlePointerLockChange();
  private _onPointerLockError = () => this._handlePointerLockError();

  constructor(camera: Camera, domElement: HTMLElement, opts: PointerLockControlsOptions = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.minPolarAngle = opts.minPolarAngle ?? 0;
    this.maxPolarAngle = opts.maxPolarAngle ?? Math.PI;
    this.pointerSpeed = opts.pointerSpeed ?? 1.0;

    this._attach();
  }

  // ── 公开 API ───────────────────────────────────────────────────────

  /** 启用/禁用输入处理（不影响已锁定状态）。 */
  setEnabled(v: boolean): void {
    this._enabled = v;
  }

  /** 是否启用。 */
  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * 请求指针锁定。
   * @param unadjustedMovement 是否禁用 OS 级鼠标加速（原始输入）。
   */
  lock(unadjustedMovement = false): void {
    const el = this.domElement as HTMLElement & {
      requestPointerLock?: (opts?: { unadjustedMovement?: boolean }) => void;
    };
    el.requestPointerLock?.({ unadjustedMovement });
  }

  /** 退出指针锁定。 */
  unlock(): void {
    this._getDocument()?.exitPointerLock?.();
  }

  /** 获取相机朝向（归一化 -Z 方向）。结果写入 v 并返回。 */
  getDirection(v: Vector3): Vector3 {
    v.set(0, 0, -1);
    applyQuaternion(v, this.camera.rotation);
    return v;
  }

  /**
   * 沿 xz 平面前进（不改变 y）。假设 up=Y。
   * @param distance 有符号距离（正=前进，负=后退）。
   */
  moveForward(distance: number): void {
    if (!this._enabled) return;
    const camera = this.camera;
    // right = 相机本地 X 轴在世界中的方向
    this._tmpVec.set(1, 0, 0);
    applyQuaternion(this._tmpVec, camera.rotation);
    // forward = up × right → (rz, 0, -rx)，自动落在 xz 平面上
    this._tmpVec2.set(0, 1, 0);
    this._tmpVec2.cross(this._tmpVec); // _tmpVec2 = up × right = forward
    camera.position.addScaledVector(this._tmpVec2, distance);
  }

  /**
   * 沿 xz 平面右移（不改变 y）。
   * @param distance 有符号距离（正=右移，负=左移）。
   */
  moveRight(distance: number): void {
    if (!this._enabled) return;
    const camera = this.camera;
    // 直接用相机本地 X 轴（右）。对于无滚转的 FPS 相机，X 轴始终水平。
    this._tmpVec.set(1, 0, 0);
    applyQuaternion(this._tmpVec, camera.rotation);
    camera.position.addScaledVector(this._tmpVec, distance);
  }

  /** 销毁，移除所有事件监听。 */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._detach();
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  private _getDocument(): Document | null {
    const el = this.domElement as HTMLElement & { ownerDocument?: Document | null };
    return el.ownerDocument ?? null;
  }

  private _handleMouseMove(e: MouseEvent): void {
    if (!this._enabled || !this.isLocked) return;
    const camera = this.camera;
    this._euler.setFromQuaternion(camera.rotation, 'YXZ');
    this._euler.y -= e.movementX * MOUSE_SENSITIVITY * this.pointerSpeed;
    this._euler.x -= e.movementY * MOUSE_SENSITIVITY * this.pointerSpeed;
    // 限制俯仰：x ∈ [PI/2 - maxPolar, PI/2 - minPolar]
    this._euler.x = Math.max(
      PI_2 - this.maxPolarAngle,
      Math.min(PI_2 - this.minPolarAngle, this._euler.x),
    );
    camera.rotation.setFromEuler(this._euler.x, this._euler.y, this._euler.z, 'YXZ');
    this.onChange?.();
  }

  private _handlePointerLockChange(): void {
    const doc = this._getDocument();
    const locked = doc?.pointerLockElement === this.domElement;
    if (locked) {
      this.isLocked = true;
      this.onLock?.();
    } else {
      this.isLocked = false;
      this.onUnlock?.();
    }
  }

  private _handlePointerLockError(): void {
    // 静默失败；调用方可通过 isLocked 检测
  }

  // ── 挂载 / 卸载 ────────────────────────────────────────────────────

  private _attach(): void {
    const doc = this._getDocument();
    if (doc) {
      doc.addEventListener('mousemove', this._onMouseMove);
      doc.addEventListener('pointerlockchange', this._onPointerLockChange);
      doc.addEventListener('pointerlockerror', this._onPointerLockError);
    }
  }

  private _detach(): void {
    const doc = this._getDocument();
    if (doc) {
      doc.removeEventListener('mousemove', this._onMouseMove);
      doc.removeEventListener('pointerlockchange', this._onPointerLockChange);
      doc.removeEventListener('pointerlockerror', this._onPointerLockError);
    }
  }
}

/** 用四元数旋转向量（内联实现，等价于 three.js Vector3.applyQuaternion）。 */
function applyQuaternion(v: Vector3, q: { x: number; y: number; z: number; w: number }): Vector3 {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const x = v.x, y = v.y, z = v.z;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  // v' = v + q.w * t + cross(q.xyz, t)
  v.x = x + qw * tx + (qy * tz - qz * ty);
  v.y = y + qw * ty + (qz * tx - qx * tz);
  v.z = z + qw * tz + (qx * ty - qy * tx);
  return v;
}

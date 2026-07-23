// FlyControls — 自研飞行相机控制器，零 three 依赖。
//
// 设计目标：
//   - 复刻 three.js FlyControls 的飞行漫游交互：WASD/RF 位移、方向键俯仰偏航、
//     QE 滚转，鼠标可选拖拽look 或常驻look。
//   - 用 delta-time 驱动，便于跨帧率一致。
//   - 与 OrbitControls 不同，本类不围绕 target 旋转，而是直接操控相机的
//     position + quaternion，适合无锚点的自由飞行场景。
//   - 事件挂载在 window (键盘) 与 domElement (指针) 上；dispose() 必须显式调用。
//
// 与 three.js FlyControls 的语义对应：
//   W/S = forward/back
//   A/D = left/right
//   R/F = up/down
//   方向键 = pitch / yaw
//   Q/E = roll left / roll right
//   Shift = 减速（movementSpeed × 0.1）
//   左键 = forward，右键 = back（dragToLook=false 时）
//   鼠标移动 = yaw / pitch（dragToLook=true 时需按住指针）

import { Camera } from '../Cameras/Camera';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

export interface FlyControlsOptions {
  movementSpeed?: number;
  rollSpeed?: number;
  dragToLook?: boolean;
  autoForward?: boolean;
}

interface MoveState {
  up: number;
  down: number;
  left: number;
  right: number;
  forward: number;
  back: number;
  pitchUp: number;
  pitchDown: number;
  yawLeft: number;
  yawRight: number;
  rollLeft: number;
  rollRight: number;
}

const EPS = 0.000001;

export class FlyControls {
  readonly camera: Camera;
  readonly domElement: HTMLElement;

  movementSpeed: number;
  rollSpeed: number;
  dragToLook: boolean;
  autoForward: boolean;
  /** Shift 按下时移动速度倍率（与 three.js 一致：0.1）。 */
  movementSpeedMultiplier = 1;

  private _moveState: MoveState = {
    up: 0, down: 0, left: 0, right: 0, forward: 0, back: 0,
    pitchUp: 0, pitchDown: 0, yawLeft: 0, yawRight: 0, rollLeft: 0, rollRight: 0,
  };
  private _moveVector = new Vector3(0, 0, 0);
  private _rotationVector = new Vector3(0, 0, 0);
  private _tmpQuaternion = new Quaternion();
  private _lastQuaternion = new Quaternion();
  private _lastPosition = new Vector3();
  private _status = 0;
  private _enabled = true;
  private _disposed = false;

  /** 相机位置/姿态实际变化时触发。 */
  onChange: (() => void) | null = null;

  // ── 绑定 / 解绑用的句柄 ────────────────────────────────────────────
  private _onKeyDown = (e: KeyboardEvent) => this._handleKeyDown(e);
  private _onKeyUp = (e: KeyboardEvent) => this._handleKeyUp(e);
  private _onPointerMove = (e: PointerEvent) => this._handlePointerMove(e);
  private _onPointerDown = (e: PointerEvent) => this._handlePointerDown(e);
  private _onPointerUp = (e: PointerEvent) => this._handlePointerUp(e);
  private _onPointerCancel = (e: PointerEvent) => this._handlePointerUp(e);
  private _onContextMenu = (e: MouseEvent) => e.preventDefault();

  constructor(camera: Camera, domElement: HTMLElement, opts: FlyControlsOptions = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.movementSpeed = opts.movementSpeed ?? 1.0;
    this.rollSpeed = opts.rollSpeed ?? 0.005;
    this.dragToLook = opts.dragToLook ?? false;
    this.autoForward = opts.autoForward ?? false;

    this._attach();
  }

  // ── 公开 API ───────────────────────────────────────────────────────

  /** 启用/禁用。禁用时忽略一切输入，但已挂载的事件保留。 */
  setEnabled(v: boolean): void {
    this._enabled = v;
  }

  /** 是否启用。 */
  isEnabled(): boolean {
    return this._enabled;
  }

  /** 销毁，移除所有事件监听。务必在不再使用时调用。 */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._detach();
  }

  /**
   * 每帧由渲染循环调用一次。
   * @param delta 时间增量（秒）。
   * @returns 是否实际改变了相机位姿。
   */
  update(delta: number): boolean {
    if (!this._enabled) return false;

    const moveMult = delta * this.movementSpeed * this.movementSpeedMultiplier;
    const rotMult = delta * this.rollSpeed;

    // 沿相机本地坐标系平移 (x=right, y=up, z=back)
    this._translateLocal(
      this._moveVector.x * moveMult,
      this._moveVector.y * moveMult,
      this._moveVector.z * moveMult,
    );

    // 增量旋转：构造一个小四元数并左乘到 camera.rotation
    this._tmpQuaternion.set(
      this._rotationVector.x * rotMult,
      this._rotationVector.y * rotMult,
      this._rotationVector.z * rotMult,
      1,
    ).normalize();
    this.camera.rotation.multiply(this._tmpQuaternion);

    // 检测是否实际变化（与 three.js 同样的阈值判定）
    const moved = this._lastPosition.distanceToSquared(this.camera.position) > EPS;
    const rotated = 8 * (1 - quatDot(this._lastQuaternion, this.camera.rotation)) > EPS;
    if (moved || rotated) {
      this._lastQuaternion.copy(this.camera.rotation);
      this._lastPosition.copy(this.camera.position);
      this.onChange?.();
      return true;
    }
    return false;
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  /** 沿相机本地坐标轴平移 (x=right, y=up, z=back)。 */
  private _translateLocal(x: number, y: number, z: number): void {
    const q = this.camera.rotation;
    if (x !== 0) {
      const axis = new Vector3(1, 0, 0);
      applyQuaternion(axis, q);
      this.camera.position.addScaledVector(axis, x);
    }
    if (y !== 0) {
      const axis = new Vector3(0, 1, 0);
      applyQuaternion(axis, q);
      this.camera.position.addScaledVector(axis, y);
    }
    if (z !== 0) {
      const axis = new Vector3(0, 0, 1);
      applyQuaternion(axis, q);
      this.camera.position.addScaledVector(axis, z);
    }
  }

  private _updateMovementVector(): void {
    const forward = (this._moveState.forward || (this.autoForward && !this._moveState.back)) ? 1 : 0;
    this._moveVector.x = -this._moveState.left + this._moveState.right;
    this._moveVector.y = -this._moveState.down + this._moveState.up;
    this._moveVector.z = -forward + this._moveState.back;
  }

  private _updateRotationVector(): void {
    this._rotationVector.x = -this._moveState.pitchDown + this._moveState.pitchUp;
    this._rotationVector.y = -this._moveState.yawRight + this._moveState.yawLeft;
    this._rotationVector.z = -this._moveState.rollRight + this._moveState.rollLeft;
  }

  // ── 事件处理 ───────────────────────────────────────────────────────

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.altKey || !this._enabled) return;
    switch (e.code) {
      case 'ShiftLeft':
      case 'ShiftRight': this.movementSpeedMultiplier = 0.1; break;
      case 'KeyW': this._moveState.forward = 1; break;
      case 'KeyS': this._moveState.back = 1; break;
      case 'KeyA': this._moveState.left = 1; break;
      case 'KeyD': this._moveState.right = 1; break;
      case 'KeyR': this._moveState.up = 1; break;
      case 'KeyF': this._moveState.down = 1; break;
      case 'ArrowUp': this._moveState.pitchUp = 1; break;
      case 'ArrowDown': this._moveState.pitchDown = 1; break;
      case 'ArrowLeft': this._moveState.yawLeft = 1; break;
      case 'ArrowRight': this._moveState.yawRight = 1; break;
      case 'KeyQ': this._moveState.rollLeft = 1; break;
      case 'KeyE': this._moveState.rollRight = 1; break;
      default:
        // 未处理的按键：仍触发（no-op）更新以匹配 three.js 行为
        this._updateMovementVector();
        this._updateRotationVector();
        return;
    }
    this._updateMovementVector();
    this._updateRotationVector();
  }

  private _handleKeyUp(e: KeyboardEvent): void {
    if (!this._enabled) return;
    switch (e.code) {
      case 'ShiftLeft':
      case 'ShiftRight': this.movementSpeedMultiplier = 1; break;
      case 'KeyW': this._moveState.forward = 0; break;
      case 'KeyS': this._moveState.back = 0; break;
      case 'KeyA': this._moveState.left = 0; break;
      case 'KeyD': this._moveState.right = 0; break;
      case 'KeyR': this._moveState.up = 0; break;
      case 'KeyF': this._moveState.down = 0; break;
      case 'ArrowUp': this._moveState.pitchUp = 0; break;
      case 'ArrowDown': this._moveState.pitchDown = 0; break;
      case 'ArrowLeft': this._moveState.yawLeft = 0; break;
      case 'ArrowRight': this._moveState.yawRight = 0; break;
      case 'KeyQ': this._moveState.rollLeft = 0; break;
      case 'KeyE': this._moveState.rollRight = 0; break;
      default:
        this._updateMovementVector();
        this._updateRotationVector();
        return;
    }
    this._updateMovementVector();
    this._updateRotationVector();
  }

  private _handlePointerDown(e: PointerEvent): void {
    if (!this._enabled) return;
    if (this.dragToLook) {
      this._status++;
    } else {
      switch (e.button) {
        case 0: this._moveState.forward = 1; break;
        case 2: this._moveState.back = 1; break;
        default: return;
      }
      this._updateMovementVector();
    }
  }

  private _handlePointerMove(e: PointerEvent): void {
    if (!this._enabled) return;
    if (!this.dragToLook || this._status > 0) {
      const el = this.domElement;
      const halfW = (el.offsetWidth || 0) / 2;
      const halfH = (el.offsetHeight || 0) / 2;
      const offX = el.offsetLeft || 0;
      const offY = el.offsetTop || 0;
      this._moveState.yawLeft = -((e.pageX - offX) - halfW) / Math.max(halfW, 1);
      this._moveState.pitchDown = ((e.pageY - offY) - halfH) / Math.max(halfH, 1);
      this._updateRotationVector();
    }
  }

  private _handlePointerUp(e: PointerEvent): void {
    if (!this._enabled) return;
    if (this.dragToLook) {
      this._status--;
      this._moveState.yawLeft = 0;
      this._moveState.pitchDown = 0;
    } else {
      switch (e.button) {
        case 0: this._moveState.forward = 0; break;
        case 2: this._moveState.back = 0; break;
        default: return;
      }
      this._updateMovementVector();
    }
    this._updateRotationVector();
  }

  // ── 挂载 / 卸载 ────────────────────────────────────────────────────

  private _attach(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
    }
    const el = this.domElement;
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerCancel);
    el.addEventListener('contextmenu', this._onContextMenu);
    el.style.touchAction = 'none';
  }

  private _detach(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
    }
    const el = this.domElement;
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerCancel);
    el.removeEventListener('contextmenu', this._onContextMenu);
    el.style.touchAction = '';
  }
}

/** 四元数点积（内联以避免给 Quaternion 加方法）。 */
function quatDot(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/** 用四元数旋转向量（内联实现，等价于 three.js Vector3.applyQuaternion）。 */
function applyQuaternion(v: Vector3, q: Quaternion): Vector3 {
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

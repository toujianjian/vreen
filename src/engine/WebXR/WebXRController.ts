// WebXRController —— XR 控制器状态机 (目标射线 / 握持 / 手部空间)。
//
// 适配自 three.js `WebXRController` (src/renderers/webxr/WebXRController.js)
// 与 W3C WebXR Gamepad/Hand Input Modules。three.js 用 `Group` (Object3D) 表示
// 各空间;VREEN 改用纯数据 `XRSpace` (position/quaternion/matrix + visible 标志),
// 避免依赖 3D 场景图,保持可测试。
//
// 三个空间 (W3C 规范):
//   * targetRay —— 目标射线空间,用于指向/拾取/UI 交互。
//   * grip      —— 握持空间,手柄模型挂载点。
//   * hand      —— 手部空间,25 个关节 (WebXR Hand Input) + 捏合检测。
//
// 手势检测:食指指尖与拇指指尖距离 < distanceToPinch 触发 pinchstart,
// 超过 distanceToPinch + threshold 触发 pinchend (滞后防抖,参考 three.js)。

import { Vector3, Quaternion, Matrix4 } from '../Math';
import type {
  XRHandJointName,
  XRInputSourceSnapshot,
  XRTransform,
  XRInputEventType,
  XRHandedness,
  XRTargetRayMode,
  XRButtonState,
  XRGamepadAxes,
} from './WebXRTypes';

/** 控制器空间 (纯数据,无场景图依赖)。 */
export class XRSpace {
  /** 位置 (世界空间)。 */
  readonly position: Vector3 = new Vector3();
  /** 方向 (世界空间)。 */
  readonly orientation: Quaternion = new Quaternion();
  /** 变换矩阵 (世界空间,由 pose matrix 解析)。 */
  readonly matrix: Matrix4 = new Matrix4();
  /** 缩放 (通常为 1)。 */
  readonly scale: Vector3 = new Vector3(1, 1, 1);
  /** 是否可见 (本帧有有效追踪)。 */
  visible: boolean = false;
  /** 线速度 (有则 hasLinearVelocity=true)。 */
  readonly linearVelocity: Vector3 = new Vector3();
  hasLinearVelocity: boolean = false;
  /** 角速度。 */
  readonly angularVelocity: Vector3 = new Vector3();
  hasAngularVelocity: boolean = false;

  /** 从 4x4 matrix 数组 (WebXR pose.transform.matrix) 更新空间。 */
  fromMatrixArray(m: ArrayLike<number>): void {
    this.matrix.elements.set(m as ArrayLike<number>);
    this.matrix.decompose(this.position, this.orientation, this.scale);
  }

  /** 从 XRTransform 更新 (含速度)。 */
  fromTransform(t: XRTransform): void {
    this.position.copy(t.position);
    this.orientation.copy(t.orientation);
    this.matrix.compose(this.position, this.orientation, this.scale);
    if (t.linearVelocity) {
      this.linearVelocity.copy(t.linearVelocity);
      this.hasLinearVelocity = true;
    } else {
      this.hasLinearVelocity = false;
    }
    if (t.angularVelocity) {
      this.angularVelocity.copy(t.angularVelocity);
      this.hasAngularVelocity = true;
    } else {
      this.hasAngularVelocity = false;
    }
  }

  /** 重置为隐藏。 */
  reset(): void {
    this.visible = false;
    this.hasLinearVelocity = false;
    this.hasAngularVelocity = false;
  }
}

/** 手部关节空间 (XRSpace + 关节半径)。 */
export class XRJointSpace extends XRSpace {
  /** 关节半径 (米)。 */
  radius: number = 0;
}

/** 手部状态。 */
export class XRHandState {
  /** 关节名 → 关节空间 (25 个)。 */
  readonly joints: Map<XRHandJointName, XRJointSpace> = new Map();
  /** 是否正在捏合。 */
  pinching: boolean = false;
  /** 是否可见 (本帧有手部追踪)。 */
  visible: boolean = false;

  /** 获取/创建关节。 */
  getJoint(name: XRHandJointName): XRJointSpace {
    let j = this.joints.get(name);
    if (!j) {
      j = new XRJointSpace();
      this.joints.set(name, j);
    }
    return j;
  }

  /** 重置。 */
  reset(): void {
    this.visible = false;
  }
}

/** 控制器事件监听器。 */
export type XRControllerListener = (event: { type: XRInputEventType; handedness?: XRHandedness }) => void;

/**
 * WebXRController —— 单个 XR 控制器的状态机。
 *
 * ```ts
 * const controller = manager.getController(0);
 * controller.addEventListener('selectstart', (e) => { ... });
 * const raySpace = controller.targetRay; // 每帧读取指向射线
 * ```
 */
export class WebXRController {
  /** 目标射线空间。 */
  readonly targetRay: XRSpace = new XRSpace();
  /** 握持空间。 */
  readonly grip: XRSpace = new XRSpace();
  /** 手部空间。 */
  readonly hand: XRHandState = new XRHandState();

  /** 当前输入源快照 (null=未连接)。 */
  inputSource: XRInputSourceSnapshot | null = null;

  /** 手性。 */
  handedness: XRHandedness = 'none';
  /** 目标射线模式。 */
  targetRayMode: XRTargetRayMode = 'gaze';
  /** 手柄配置文件 (模型加载用)。 */
  profiles: string[] = [];

  /** 按钮状态 (快照)。 */
  buttons: XRButtonState[] = [];
  /** 轴。 */
  axes: XRGamepadAxes = [];

  /** 事件监听器。 */
  private listeners: Map<XRInputEventType, Set<XRControllerListener>> = new Map();

  /** 捏合检测阈值 (米)。 */
  pinchDistance = 0.02;
  /** 捏合滞后阈值 (防抖)。 */
  pinchThreshold = 0.005;

  /** 上一帧按钮状态 (边沿检测)。 */
  private prevButtons: XRButtonState[] = [];

  /** 添加事件监听。 */
  addEventListener(type: XRInputEventType, listener: XRControllerListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  /** 移除事件监听。 */
  removeEventListener(type: XRInputEventType, listener: XRControllerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** 派发事件。 */
  dispatchEvent(event: { type: XRInputEventType; handedness?: XRHandedness }): void {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
  }

  /**
   * 连接输入源 (inputsourceschange added 时调用)。
   * 若是手部追踪,预创建 25 个关节。
   */
  connect(inputSource: XRInputSourceSnapshot): void {
    this.inputSource = inputSource;
    this.handedness = inputSource.handedness;
    this.targetRayMode = inputSource.targetRayMode;
    this.profiles = [...inputSource.profiles];

    if (inputSource.hand) {
      // 预创建关节。
      for (const jointName of inputSource.handJoints.keys()) {
        this.hand.getJoint(jointName);
      }
    }

    this.dispatchEvent({ type: 'connected', handedness: this.handedness });
  }

  /** 断开输入源。 */
  disconnect(): void {
    this.dispatchEvent({ type: 'disconnected', handedness: this.handedness });
    this.targetRay.reset();
    this.grip.reset();
    this.hand.reset();
    this.inputSource = null;
    this.buttons = [];
    this.axes = [];
    this.prevButtons = [];
  }

  /**
   * 每帧更新 (WebXRManager 在动画帧回调中调用)。
   * 从输入源快照更新各空间姿态 + 检测按钮边沿 + 捏合。
   *
   * @param input 输入源快照 (null=本帧无数据,隐藏空间)
   */
  update(input: XRInputSourceSnapshot | null): void {
    if (!input) {
      this.targetRay.reset();
      this.grip.reset();
      this.hand.reset();
      return;
    }

    // 手部追踪。
    if (input.hand) {
      this.updateHand(input);
    } else {
      // 握持空间。
      if (input.gripPose) {
        this.grip.fromTransform(input.gripPose);
        this.grip.visible = true;
      } else {
        this.grip.reset();
      }
    }

    // 目标射线空间。
    let rayPose = input.targetRayPose;
    // 某些运行时 (Vive Cosmos) 只有 grip 空间,射线 = 握持。
    if (!rayPose && input.gripPose) {
      rayPose = input.gripPose;
    }
    if (rayPose) {
      this.targetRay.fromTransform(rayPose);
      this.targetRay.visible = true;
      this.dispatchEvent({ type: 'move', handedness: this.handedness });
    } else {
      this.targetRay.reset();
    }

    // 按钮边沿检测 (select / squeeze)。
    this.updateButtons(input);

    // 同步快照。
    this.buttons = input.buttons.map((b) => ({ ...b }));
    this.axes = [...input.axes];
    this.prevButtons = input.buttons.map((b) => ({ ...b }));
  }

  /** 更新手部关节 + 捏合检测。 */
  private updateHand(input: XRInputSourceSnapshot): void {
    const hand = this.hand;
    hand.visible = true;

    for (const [jointName, jointPose] of input.handJoints) {
      const joint = hand.getJoint(jointName);
      joint.fromTransform(jointPose.transform);
      joint.radius = jointPose.radius;
      joint.visible = true;
    }

    // 捏合检测:食指指尖 ↔ 拇指指尖距离。
    const indexTip = hand.joints.get('index-finger-tip');
    const thumbTip = hand.joints.get('thumb-tip');
    if (indexTip && thumbTip && indexTip.visible && thumbTip.visible) {
      const distance = indexTip.position.distanceTo(thumbTip.position);
      const { pinchDistance, pinchThreshold } = this;

      if (hand.pinching && distance > pinchDistance + pinchThreshold) {
        hand.pinching = false;
        this.dispatchEvent({ type: 'pinchend', handedness: this.handedness });
      } else if (!hand.pinching && distance <= pinchDistance - pinchThreshold) {
        hand.pinching = true;
        this.dispatchEvent({ type: 'pinchstart', handedness: this.handedness });
      }
    }
  }

  /** 按钮边沿检测 (select = 按钮 0, squeeze = 按钮 1)。 */
  private updateButtons(input: XRInputSourceSnapshot): void {
    const btns = input.buttons;
    const prev = this.prevButtons;

    // select (按钮 0): pressed 边沿。
    const selIdx = 0;
    if (btns[selIdx]) {
      const wasPressed = prev[selIdx]?.pressed ?? false;
      if (btns[selIdx].pressed && !wasPressed) {
        this.dispatchEvent({ type: 'selectstart', handedness: this.handedness });
      } else if (!btns[selIdx].pressed && wasPressed) {
        this.dispatchEvent({ type: 'selectend', handedness: this.handedness });
        this.dispatchEvent({ type: 'select', handedness: this.handedness });
      }
    }

    // squeeze (按钮 1): pressed 边沿。
    const sqzIdx = 1;
    if (btns[sqzIdx]) {
      const wasPressed = prev[sqzIdx]?.pressed ?? false;
      if (btns[sqzIdx].pressed && !wasPressed) {
        this.dispatchEvent({ type: 'squeezestart', handedness: this.handedness });
      } else if (!btns[sqzIdx].pressed && wasPressed) {
        this.dispatchEvent({ type: 'squeezeend', handedness: this.handedness });
        this.dispatchEvent({ type: 'squeeze', handedness: this.handedness });
      }
    }
  }

  /** 触发手柄振动 (haptic feedback,需会话支持)。 */
  pulse(manager: { hapticPulse?(index: number, intensity: number, durationMs: number): void }, index: number, intensity: number, durationMs: number): void {
    manager.hapticPulse?.(index, intensity, durationMs);
  }
}

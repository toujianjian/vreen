// CameraRig — 摄像机摇臂/轨道系统(实时跟随目标)。
//
// 设计:
//   * 与 CinematicCamera 互补:Cinematic 关注「预定镜头序列叙事」,
//     CameraRig 关注「实时跟随 Object3D」(玩家/载具/角色)
//   * 四种运动模式:
//       - crane  : 摇臂,摄像机吊在 target 上方 height 处,可绕垂轴摆动
//       - dolly  : 轨道,摄像机沿 XZ 平面以 speed 匀速移动(模拟推车)
//       - orbit  : 轨道环绕,绕 target 在 radius 上以 speed 角速度旋转
//       - fixed  : 固定偏移,position = target.position + offset(无运动)
//   * damping 控制位置跟随的平滑度(0=瞬跟,1=几乎不动,典型 0.05~0.2)
//   * 摄像机始终 lookAt target.position + lookAtOffset(默认 0,即看目标脚底;
//     可上抬到 target 头部)
//
// 与 OrbitControls 的关系:
//   * OrbitControls 接收用户输入驱动相机(交互式)
//   * CameraRig 按预设规则自动驱动相机(电影/过场式)

import { Vector3 } from '../Math';
import type { Object3D } from '../Core/Object3D';
import type { Camera } from './Camera';

/** CameraRig 运动模式。 */
export type CameraRigType = 'crane' | 'dolly' | 'orbit' | 'fixed';

// 复用临时向量,避免每帧分配
const _desired = new Vector3();
const _targetPos = new Vector3();
const _currentLook = new Vector3();

/**
 * 摄像机摇臂/轨道系统 — 按运动模式驱动相机跟随目标。
 *
 * 用法:
 *   const rig = new CameraRig(camera);
 *   rig.follow(playerObject);
 *   rig.setType('orbit');
 *   // 每帧:
 *   rig.update(dt);
 *   renderer.render(scene, rig.camera);
 */
export class CameraRig {
  /** 被驱动的相机(可选;若 null 则只更新内部 position,调用方自行读取)。 */
  camera: Camera | null;
  /** 运动模式。 */
  type: CameraRigType = 'fixed';
  /** 跟随目标。 */
  target: Object3D | null = null;
  /** 相对目标的偏移(世界坐标)。 */
  offset: Vector3;
  /** 摇臂/相机高度(crane 模式相机 Y;orbit 也可以用作抬高量)。 */
  height: number;
  /** 轨道半径(orbit / crane 摆动半径)。 */
  radius: number;
  /** 运动速度(orbit 角速度 rad/s;dolly 线速度 单位/s)。 */
  speed: number;
  /** 位置阻尼系数(0=瞬跟,越大越平滑越慢)。 */
  damping: number;
  /** lookAt 目标相对 target 的偏移(典型 0=看脚底;1.5=看头部)。 */
  lookAtOffset: Vector3;

  /** 当前轨道角度(orbit / crane 累积,弧度)。 */
  private orbitAngle: number = 0;
  /** dolly 累积位移。 */
  private dollyDistance: number = 0;
  /** 当前相机位置(由 update 更新,可被外部读取)。 */
  position: Vector3;
  /** 当前 lookAt 点(由 update 更新)。 */
  lookAt: Vector3;

  constructor(camera: Camera | null = null) {
    this.camera = camera;
    this.offset = new Vector3(0, 0, 5);
    this.height = 5;
    this.radius = 10;
    this.speed = 0.5;
    this.damping = 0.1;
    this.lookAtOffset = new Vector3(0, 1, 0);
    this.position = new Vector3();
    this.lookAt = new Vector3();
  }

  /** 设置跟随目标。 */
  follow(target: Object3D): this {
    this.target = target;
    // 立即对齐位置以避免大跳变
    if (target) {
      this.position.copy(target.position).add(this.offset);
      this.lookAt.copy(target.position).add(this.lookAtOffset);
    }
    return this;
  }

  /** 设置运动模式。 */
  setType(type: CameraRigType): this {
    this.type = type;
    return this;
  }

  /** 设置相对偏移。 */
  setOffset(offset: Vector3): this {
    this.offset.copy(offset);
    return this;
  }

  /** 设置 lookAt 偏移(相对 target)。 */
  setLookAtOffset(offset: Vector3): this {
    this.lookAtOffset.copy(offset);
    return this;
  }

  /** 设置轨道角度(orbit/crane 模式直接覆盖累积角度)。 */
  orbit(angle: number): this {
    this.orbitAngle = angle;
    return this;
  }

  /** 增量旋转轨道角度。 */
  orbitBy(delta: number): this {
    this.orbitAngle += delta;
    return this;
  }

  /**
   * 每帧更新 — 按 type 计算期望位置,经 damping 平滑后写入 camera。
   *  dt: 帧时间(秒)。
   */
  update(dt: number): this {
    if (!this.target) return this;
    _targetPos.copy(this.target.position);

    // 期望 lookAt 点(始终跟随 target + lookAtOffset)
    _currentLook.copy(_targetPos).add(this.lookAtOffset);

    // 按类型计算期望位置
    switch (this.type) {
      case 'fixed':
        _desired.copy(_targetPos).add(this.offset);
        break;
      case 'crane': {
        // 摇臂:摄像机吊在 target 上方 height,绕垂轴以 speed 摆动
        this.orbitAngle += this.speed * dt;
        _desired.set(
          _targetPos.x + Math.sin(this.orbitAngle) * this.radius,
          _targetPos.y + this.height,
          _targetPos.z + Math.cos(this.orbitAngle) * this.radius,
        );
        break;
      }
      case 'orbit': {
        // 环绕:绕 target 在 radius 圆上以 speed 角速度旋转
        this.orbitAngle += this.speed * dt;
        _desired.set(
          _targetPos.x + Math.sin(this.orbitAngle) * this.radius,
          _targetPos.y + this.offset.y,
          _targetPos.z + Math.cos(this.orbitAngle) * this.radius,
        );
        break;
      }
      case 'dolly': {
        // 轨道:沿 target 切线方向匀速移动(模拟推车),保持高度与偏移
        this.dollyDistance += this.speed * dt;
        const dir = Math.sin(this.dollyDistance * 0.5); // 简化往复运动
        _desired.set(
          _targetPos.x + this.offset.x,
          _targetPos.y + this.height * 0.5 + this.offset.y,
          _targetPos.z + this.offset.z + dir * this.radius,
        );
        break;
      }
      default:
        _desired.copy(_targetPos).add(this.offset);
    }

    // damping 平滑位置:position = lerp(position, desired, 1 - damping)
    // damping=0 → 瞬跟;damping 越大越平滑越慢
    const alpha = Math.max(0, Math.min(1, 1 - this.damping));
    this.position.lerp(_desired, alpha);
    this.lookAt.lerp(_currentLook, alpha);

    // 应用到相机
    if (this.camera) {
      this.camera.position.copy(this.position);
      this.camera.lookAt(this.lookAt.x, this.lookAt.y, this.lookAt.z);
    }
    return this;
  }

  /** 设置绑定的相机(可在运行时切换)。 */
  attachCamera(camera: Camera): this {
    this.camera = camera;
    return this;
  }

  /** 解绑相机。 */
  detachCamera(): this {
    this.camera = null;
    return this;
  }
}

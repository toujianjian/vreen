// SpringArm — 碰撞感知的弹簧摇臂(第三人称相机防穿墙)。
//
// 设计来源:
//   * UE SpringArmComponent —— 标准第三人称相机摇臂(碰撞回缩 + 弹簧平滑)
//   * Unity Cinemachine Collider / 3rdPersonFollow —— 同类概念
//   * o3de AtomCamera —— 碰撞探针 + 阻尼跟随
//
// 与 CameraRig 的关系:
//   * CameraRig 关注「运动模式」(crane/dolly/orbit/fixed),不处理碰撞。
//   * SpringArm 关注「碰撞回缩 + 弹簧平滑」—— 解决第三人称相机穿墙问题。
//   * 二者可组合:SpringArm 处理碰撞回缩,CameraRig 决定相机环绕方式;
//     典型用法是 SpringArm 持有相机,CameraRig 驱动 SpringArm.target。
//
// 算法:
//   1. 每帧从 target + targetOffset 发射探针(probe)到期望相机位置
//      (target + targetOffset + armOffset)
//   2. 探针类型:
//        - ray   : 单射线,快速但可能穿过薄几何
//        - sphere : 球面探针,用 hit 距离 - 探针半径近似球面扫描
//   3. 若命中,回缩到 hitDistance - collisionMargin - probeRadius
//   4. 当前臂长用「临界阻尼弹簧」平滑到目标臂长(避免抖动)
//   5. lookAt 点同样平滑跟随,避免目标抖动时相机朝向跳变
//
// 探针抽象:
//   probe: (origin, direction, maxDist) => hitDist | null
//   默认实现用 Raycaster 检测一组碰撞物体;
//   用户可注入自定义探针(体素世界、简化碰撞代理、NavMesh 边界等)。

import { Vector3 } from '../Math';
import type { Object3D } from '../Core/Object3D';
import type { Camera } from './Camera';
import { Raycaster } from '../Core/Raycaster';

/** 探针函数:从 origin 沿 direction(已归一化)发射,最大距离 maxDist。
 *  返回命中距离(世界单位),或 null 表示未命中。 */
export type ProbeFn = (
  origin: Vector3,
  direction: Vector3,
  maxDist: number,
) => number | null;

/** 探针类型。 */
export type ProbeType = 'ray' | 'sphere';

/** SpringArm 序列化结构。 */
export interface SpringArmJSON {
  armOffset: [number, number, number];
  targetOffset: [number, number, number];
  maxDistance: number;
  probeRadius: number;
  collisionMargin: number;
  probeType: ProbeType;
  springStiffness: number;
  springDamping: number;
  lookAtStiffness: number;
  lookAtDamping: number;
  positionStiffness: number;
  positionDamping: number;
  currentLength: number;
}

// 复用临时向量,避免每帧分配
const _desiredPos = new Vector3();
const _targetPos = new Vector3();
const _lookTarget = new Vector3();
const _armDir = new Vector3();
const _rayDir = new Vector3();
const _rayOrigin = new Vector3();

/**
 * 碰撞感知弹簧摇臂。
 *
 * 用法:
 *   const arm = new SpringArm(camera);
 *   arm.target = playerEntity;
 *   arm.armOffset.set(0, 2, -5);    // 相机在玩家后上方 5 米
 *   arm.targetOffset.set(0, 1.5, 0); // 注视玩家头部
 *   arm.probeType = 'sphere';
 *   arm.probeRadius = 0.3;
 *   // 可选:注入自定义探针(默认用 Raycaster 检测 collisionObjects)
 *   // arm.probe = (origin, dir, max) => voxelWorld.raycast(origin, dir, max);
 *
 *   // 每帧:
 *   arm.update(dt);
 *   renderer.render(scene, arm.camera);
 *
 * 碰撞回缩行为:
 *   - 当探针命中时,相机回缩到 hitDistance - collisionMargin - probeRadius
 *   - 当探针未命中时,相机恢复到 maxDistance
 *   - 臂长变化通过临界阻尼弹簧平滑,避免抖动
 */
export class SpringArm {
  /** 被驱动的相机(可选;若 null 则只更新内部 position,调用方自行读取)。 */
  camera: Camera | null;
  /** 跟随目标(Object3D)。若 null,update 为 no-op。 */
  target: Object3D | null = null;
  /** 期望的相机偏移(相对 target + targetOffset)。典型 (0, 2, -5)。 */
  armOffset: Vector3;
  /** lookAt 目标相对 target 的偏移。典型 (0, 1.5, 0) 看头部。 */
  targetOffset: Vector3;
  /** 最大臂长(= armOffset.length(),自动派生,可手动覆盖)。 */
  maxDistance: number;
  /** 探针半径(0 = 射线,>0 = 球面探针近似)。默认 0.3。 */
  probeRadius: number = 0.3;
  /** 碰撞回缩余量(相机停在 hitPoint - margin 处)。默认 0.2。 */
  collisionMargin: number = 0.2;
  /** 探针类型。默认 'sphere'。 */
  probeType: ProbeType = 'sphere';

  // ── 弹簧参数 ────────────────────────────────────────────────────────
  /** 臂长弹簧刚度(0..1,越高越灵敏)。默认 0.35。 */
  springStiffness: number = 0.35;
  /** 臂长弹簧阻尼(0..1,越高越滞后)。默认 0.65。 */
  springDamping: number = 0.65;
  /** lookAt 点弹簧刚度。默认 0.4。 */
  lookAtStiffness: number = 0.4;
  /** lookAt 点弹簧阻尼。默认 0.6。 */
  lookAtDamping: number = 0.6;
  /** 目标位置弹簧刚度(若启用,平滑 target.position 本身)。默认 0.5。 */
  positionStiffness: number = 0.5;
  /** 目标位置弹簧阻尼。默认 0.5。 */
  positionDamping: number = 0.5;

  // ── 运行时状态 ──────────────────────────────────────────────────────
  /** 当前臂长(指数平滑后的实际值)。 */
  currentLength: number;
  /** 平滑后的目标位置(由 positionSpring 驱动)。 */
  private smoothedTargetPos: Vector3;
  /** 平滑后的 lookAt 点(由 lookAtSpring 驱动)。 */
  private smoothedLookAt: Vector3;

  // ── 碰撞探针 ────────────────────────────────────────────────────────
  /** 自定义探针函数。若设置,优先于 Raycaster。 */
  probe: ProbeFn | null = null;
  /** Raycaster 使用的碰撞物体列表(当 probe 为 null 时使用)。 */
  collisionObjects: Object3D[] = [];
  /** 内部 Raycaster 实例(复用)。 */
  private raycaster: Raycaster;

  constructor(camera: Camera | null = null) {
    this.camera = camera;
    this.armOffset = new Vector3(0, 2, -5);
    this.targetOffset = new Vector3(0, 1.5, 0);
    this.maxDistance = this.armOffset.length();
    this.currentLength = this.maxDistance;
    this.smoothedTargetPos = new Vector3();
    this.smoothedLookAt = new Vector3();
    this.raycaster = new Raycaster();
  }

  /** 设置跟随目标(立即同步平滑状态以避免初始跳变)。 */
  follow(target: Object3D): this {
    this.target = target;
    // 立即对齐平滑状态,避免从 0 开始平滑
    _targetPos.copy(target.position);
    this.smoothedTargetPos.copy(_targetPos);
    _lookTarget.copy(_targetPos).add(this.targetOffset);
    this.smoothedLookAt.copy(_lookTarget);
    this.currentLength = this.maxDistance;
    return this;
  }

  /** 设置臂偏移(自动重算 maxDistance)。 */
  setArmOffset(offset: Vector3): this {
    this.armOffset.copy(offset);
    this.maxDistance = offset.length();
    return this;
  }

  /** 设置碰撞物体(当 probe 为 null 时由 Raycaster 使用)。 */
  setCollisionObjects(objects: Object3D[]): this {
    this.collisionObjects = objects;
    return this;
  }

  /** 注入自定义探针。 */
  setProbe(probe: ProbeFn | null): this {
    this.probe = probe;
    return this;
  }

  /**
   * 每帧更新 — 执行碰撞探针 + 指数平滑,写入 camera。
   *  dt: 帧时间(秒)。
   */
  update(dt: number): this {
    if (!this.target) return this;

    // ── 1. 平滑目标位置(指数平滑,帧率无关)─────────────────────────
    _targetPos.copy(this.target.position);
    const posAlpha = this.smoothAlpha(this.positionStiffness, this.positionDamping, dt);
    this.smoothedTargetPos.lerp(_targetPos, posAlpha);

    // ── 2. 计算期望相机位置 ──────────────────────────────────────────
    // 臂方向(从 target 看,相机在 armOffset 方向上)
    _armDir.copy(this.armOffset).normalize();
    // 探针起点 = 平滑后的目标位置 + targetOffset
    _rayOrigin.copy(this.smoothedTargetPos).add(this.targetOffset);
    // 期望臂长 = maxDistance(若碰撞则回缩)
    let targetLength = this.maxDistance;

    // ── 3. 碰撞探针 ──────────────────────────────────────────────────
    if (this.maxDistance > 0) {
      const hitDist = this.runProbe(_rayOrigin, _armDir, this.maxDistance);
      if (hitDist !== null && hitDist < this.maxDistance) {
        // 命中:回缩到 hitDist - margin - probeRadius(球面探针预留半径)
        const retract = hitDist - this.collisionMargin - this.probeRadius;
        targetLength = Math.max(0, Math.min(this.maxDistance, retract));
      }
    }

    // ── 4. 臂长指数平滑(无超调,适合相机距离)──────────────────────
    const lenAlpha = this.smoothAlpha(this.springStiffness, this.springDamping, dt);
    this.currentLength += (targetLength - this.currentLength) * lenAlpha;
    // 钳制臂长到 [0, maxDistance]
    if (this.currentLength < 0) this.currentLength = 0;
    else if (this.currentLength > this.maxDistance) this.currentLength = this.maxDistance;

    // ── 5. 计算最终相机位置 ──────────────────────────────────────────
    _desiredPos.copy(_rayOrigin).addScaledVector(_armDir, this.currentLength);

    // ── 6. 平滑 lookAt 点(指数平滑)────────────────────────────────
    _lookTarget.copy(this.smoothedTargetPos).add(this.targetOffset);
    const lookAlpha = this.smoothAlpha(this.lookAtStiffness, this.lookAtDamping, dt);
    this.smoothedLookAt.lerp(_lookTarget, lookAlpha);

    // ── 7. 应用到相机 ────────────────────────────────────────────────
    if (this.camera) {
      this.camera.position.copy(_desiredPos);
      this.camera.lookAt(
        this.smoothedLookAt.x,
        this.smoothedLookAt.y,
        this.smoothedLookAt.z,
      );
    }
    return this;
  }

  /** 导出为 JSON(不含 target/camera 引用)。 */
  exportJSON(): SpringArmJSON {
    return {
      armOffset: this.armOffset.toArray(),
      targetOffset: this.targetOffset.toArray(),
      maxDistance: this.maxDistance,
      probeRadius: this.probeRadius,
      collisionMargin: this.collisionMargin,
      probeType: this.probeType,
      springStiffness: this.springStiffness,
      springDamping: this.springDamping,
      lookAtStiffness: this.lookAtStiffness,
      lookAtDamping: this.lookAtDamping,
      positionStiffness: this.positionStiffness,
      positionDamping: this.positionDamping,
      currentLength: this.currentLength,
    };
  }

  /** 从 JSON 导入。 */
  importJSON(data: SpringArmJSON): this {
    this.armOffset.set(data.armOffset[0], data.armOffset[1], data.armOffset[2]);
    this.targetOffset.set(data.targetOffset[0], data.targetOffset[1], data.targetOffset[2]);
    this.maxDistance = data.maxDistance;
    this.probeRadius = data.probeRadius;
    this.collisionMargin = data.collisionMargin;
    this.probeType = data.probeType;
    this.springStiffness = data.springStiffness;
    this.springDamping = data.springDamping;
    this.lookAtStiffness = data.lookAtStiffness;
    this.lookAtDamping = data.lookAtDamping;
    this.positionStiffness = data.positionStiffness;
    this.positionDamping = data.positionDamping;
    this.currentLength = data.currentLength;
    return this;
  }

  // ── 内部实现 ────────────────────────────────────────────────────────

  /** 执行碰撞探针。返回命中距离或 null。 */
  private runProbe(origin: Vector3, direction: Vector3, maxDist: number): number | null {
    if (this.probe) {
      return this.probe(origin, direction, maxDist);
    }
    if (this.collisionObjects.length === 0) {
      return null;
    }
    // 默认:Raycaster
    _rayDir.copy(direction);
    this.raycaster.set(origin, _rayDir);
    this.raycaster.near = 0;
    this.raycaster.far = maxDist;
    const hits = this.raycaster.intersectObjects(this.collisionObjects, true);
    if (hits.length === 0) return null;
    return hits[0].distance;
  }

  /**
   * 计算指数平滑系数 alpha(帧率无关,无超调)。
   *
   * 数学:`alpha = 1 - exp(-rate * dt * 60)`
   *  - `rate = stiffness * (1 - damping * 0.5)` —— damping 越高,有效速率越低(更滞后)
   *  - 在 60fps、stiffness=0.35、damping=0.65 时,alpha ≈ 0.21,~0.5s 收敛 95%
   *  - dt=0 时 alpha=0(不积分);dt 极大时 alpha→1(瞬切)
   *
   * 这与 UE SpringArm 的「bEnableCameraLag」+ LagSpeed 行为一致,
   * 比 velocity-based 弹簧更稳定(无振荡、无超调),适合相机距离平滑。
   */
  private smoothAlpha(stiffness: number, damping: number, dt: number): number {
    if (dt <= 0) return 0;
    const rate = stiffness * (1 - damping * 0.5);
    return 1 - Math.exp(-rate * dt * 60);
  }
}

/**
 * 便捷工厂:创建常见第三人称相机配置。
 */
export const SpringArmPresets = {
  /** 经典第三人称跟随(肩后上方,球面探针)。 */
  thirdPerson(): SpringArm {
    const arm = new SpringArm();
    arm.armOffset.set(0, 2.5, -6);
    arm.targetOffset.set(0, 1.6, 0);
    arm.maxDistance = arm.armOffset.length();
    arm.probeType = 'sphere';
    arm.probeRadius = 0.35;
    arm.collisionMargin = 0.25;
    arm.springStiffness = 0.4;
    arm.springDamping = 0.6;
    return arm;
  },

  /** 越肩视角(偏右后,更近)。 */
  overShoulder(): SpringArm {
    const arm = new SpringArm();
    arm.armOffset.set(1.2, 1.8, -3.5);
    arm.targetOffset.set(0, 1.5, 0);
    arm.maxDistance = arm.armOffset.length();
    arm.probeType = 'sphere';
    arm.probeRadius = 0.3;
    arm.collisionMargin = 0.2;
    arm.springStiffness = 0.5;
    arm.springDamping = 0.5;
    return arm;
  },

  /** 远景跟随(适合载具/坐骑)。 */
  farFollow(): SpringArm {
    const arm = new SpringArm();
    arm.armOffset.set(0, 5, -12);
    arm.targetOffset.set(0, 1.5, 0);
    arm.maxDistance = arm.armOffset.length();
    arm.probeType = 'sphere';
    arm.probeRadius = 0.5;
    arm.collisionMargin = 0.4;
    arm.springStiffness = 0.25;
    arm.springDamping = 0.75;
    return arm;
  },

  /** 第一人称(无臂长,仅 lookAt 平滑)。 */
  firstPerson(): SpringArm {
    const arm = new SpringArm();
    arm.armOffset.set(0, 0, 0);
    arm.targetOffset.set(0, 1.6, 0);
    arm.maxDistance = 0;
    arm.probeRadius = 0;
    arm.collisionMargin = 0;
    arm.probeType = 'ray';
    arm.springStiffness = 1.0;
    arm.springDamping = 0.0;
    return arm;
  },
} as const;

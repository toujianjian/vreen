// CharacterController — 自研角色控制器，零 three 依赖。
//
// 设计目标：
//   - 第三/第一人称通用：position + Y 轴 rotation 表达角色位姿，
//     相机层在外部用 getForward/getRight 自由决定视角。
//   - 胶囊碰撞体（height + radius），与 ECS Collider/Physics 兼容但解耦：
//     不强依赖 World，传入"地面高度采样"回调即可工作，便于在体素地形 /
//     网格地形 / ECS 场景统一使用。
//   - 半隐式 Euler 积分 + 固定 stepHeight 台阶抬升 + slopeLimit 坡度限制。
//   - 状态机由 getState() 根据 velocity / isGrounded 推导，便于上层驱动
//     AnimationStateMachine (idle/walking/running/jumping/falling)。
//
// 与 ECS Rigidbody 的关系：本类是" kinematic character controller"，自身
// 维护 velocity 但不受冲量影响；如需被外力推动，可读取本类 velocity 写
// 回 Rigidbody，反之亦然。这种解耦参考了 Unity KinematicCharacterMotor
// 与 Unreal UCharacterMovementComponent 的分层。

import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import * as MathUtils from '../Math/MathUtils';

/** 角色状态枚举（与 AnimationStateMachine 节点同名约定）。 */
export type CharacterState = 'idle' | 'walking' | 'running' | 'jumping' | 'falling';

/**
 * 地面采样回调：给定水平位置 (x, z)，返回该处的"地面高度"（world Y）。
 * 返回 null 表示此处无地面（角色将下落）。
 *
 * 用于在体素世界 / 高度图 / ECS 场景中统一采样地面，避免本类耦合具体物理引擎。
 */
export type GroundSampleFn = (x: number, z: number) => number | null;

export interface CharacterControllerOptions {
  height?: number;
  radius?: number;
  stepHeight?: number;
  /** 坡度限制（度），大于此角度的地面视为墙。 */
  slopeLimit?: number;
  moveSpeed?: number;
  runSpeed?: number;
  jumpForce?: number;
  /** 重力加速度向量，默认 (0, -9.81, 0)。 */
  gravity?: Vector3;
  /** 地面吸附距离：落地后脚下留出的容差（m）。 */
  groundTolerance?: number;
  /** 空气控制比例 0..1（0 = 完全无法空中变向，1 = 地面同等控制）。 */
  airControl?: number;
}

const EPS = 1e-5;

export class CharacterController {
  /** 角色脚下中心点（world）。 */
  position: Vector3;
  /** 当前速度 (m/s)。 */
  velocity: Vector3;
  /** Y 轴朝向（弧度），0 = +Z 方向。 */
  rotation: number;
  /** 角色总高度（含头）。 */
  height: number;
  /** 胶囊半径。 */
  radius: number;
  /** 可跨越的最大台阶高度（m）。 */
  stepHeight: number;
  /** 坡度限制（度）。 */
  slopeLimit: number;
  /** 步行速度 (m/s)。 */
  moveSpeed: number;
  /** 奔跑速度 (m/s)。 */
  runSpeed: number;
  /** 跳跃初速度 (m/s)。 */
  jumpForce: number;
  /** 重力加速度向量。 */
  gravity: Vector3;
  /** 地面容差。 */
  groundTolerance: number;
  /** 空中操控比例。 */
  airControl: number;

  /** 是否着地。 */
  isGrounded: boolean = false;
  /** 是否在奔跑（由 move 方向的调用方控制）。 */
  isRunning: boolean = false;

  /** 上一帧的水平速度大小（用于状态判断）。 */
  private _lastHorizontalSpeed: number = 0;

  constructor(
    position: Vector3 = new Vector3(0, 0, 0),
    opts: CharacterControllerOptions = {},
  ) {
    this.position = position.clone();
    this.velocity = new Vector3(0, 0, 0);
    this.rotation = 0;
    this.height = opts.height ?? 1.8;
    this.radius = opts.radius ?? 0.4;
    this.stepHeight = opts.stepHeight ?? 0.3;
    this.slopeLimit = opts.slopeLimit ?? 45;
    this.moveSpeed = opts.moveSpeed ?? 4.0;
    this.runSpeed = opts.runSpeed ?? 8.0;
    this.jumpForce = opts.jumpForce ?? 6.0;
    this.gravity = opts.gravity ? opts.gravity.clone() : new Vector3(0, -9.81, 0);
    this.groundTolerance = opts.groundTolerance ?? 0.1;
    this.airControl = opts.airControl ?? 0.3;
  }

  // ── 公开 API ───────────────────────────────────────────────────────

  /**
   * 按 direction（世界空间，期望已归一化）方向移动。
   * @param direction 水平移动方向（Y 分量被忽略）。
   * @param dt        帧时间（秒）。
   * @param running   是否奔跑（影响速度）。
   */
  move(direction: Vector3, dt: number, running: boolean = false): void {
    this.isRunning = running;
    const speed = running ? this.runSpeed : this.moveSpeed;

    // 水平方向（忽略 Y）
    const dir = new Vector3(direction.x, 0, direction.z);
    const len = dir.length();
    if (len > EPS) dir.divideScalar(len);

    const desired = new Vector3(dir.x * speed, this.velocity.y, dir.z * speed);

    if (this.isGrounded) {
      // 地面：直接采用目标水平速度
      this.velocity.x = desired.x;
      this.velocity.z = desired.z;
    } else {
      // 空中：按 airControl 插值
      const k = MathUtils.clamp(this.airControl, 0, 1);
      this.velocity.x += (desired.x - this.velocity.x) * k;
      this.velocity.z += (desired.z - this.velocity.z) * k;
    }

    // 把朝向对齐到移动方向（仅当有显著移动）
    if (len > EPS) {
      // 0 = +Z，所以 atan2(x, z)
      this.rotation = Math.atan2(dir.x, dir.z);
    }

    void dt;
  }

  /** 跳跃。仅着地时有效。 */
  jump(): boolean {
    if (!this.isGrounded) return false;
    this.velocity.y = this.jumpForce;
    this.isGrounded = false;
    return true;
  }

  /**
   * 每帧更新：积分重力 → 采样地面 → 碰撞响应 → 台阶抬升 → 落地。
   *
   * @param dt            帧时间（秒）。
   * @param sampleGround  地面采样回调（返回该 (x,z) 处的地面 Y，或 null）。
   *                      在体素世界 / ECS 物理 / 高度图场景里由调用方提供。
   */
  update(dt: number, sampleGround: GroundSampleFn): void {
    // 1) 重力积分（semi-implicit Euler）
    this.velocity.x += this.gravity.x * dt;
    this.velocity.y += this.gravity.y * dt;
    this.velocity.z += this.gravity.z * dt;

    // 2) 水平位置积分
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // 3) 地面采样：在脚下中心采样
    const groundY = sampleGround(this.position.x, this.position.z);

    // 4) 垂直积分
    this.position.y += this.velocity.y * dt;

    // 5) 地面碰撞响应
    if (groundY !== null) {
      const feetY = this.position.y;
      const groundTop = groundY;

      if (feetY <= groundTop + this.groundTolerance) {
        // 落地 / 着地保持
        // 速度向下且贴近地面 → 重置
        if (this.velocity.y <= 0) {
          this.position.y = groundTop;
          this.velocity.y = 0;
          this.isGrounded = true;
        }
      } else if (feetY <= groundTop + this.stepHeight) {
        // 低台阶：抬上去
        this.position.y = groundTop;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.isGrounded = true;
      } else {
        // 高出地面较多：检查是否在斜坡上
        // 简化：当脚下距离 > stepHeight 且速度向下，标记为空中
        if (this.velocity.y <= 0) {
          this.isGrounded = false;
        }
      }

      // 坡度限制：若垂直速度被压成 0 但水平速度方向上"前方的地面"
      // 比当前位置高过 slopeLimit 对应的临界，则阻挡水平移动。
      if (this.isGrounded) {
        this._applySlopeLimit(sampleGround, dt);
      }
    } else {
      // 此处无地面：自由下落
      this.isGrounded = false;
    }

    // 记录水平速度供状态判断
    this._lastHorizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** 设置 Y 轴朝向（弧度）。 */
  setRotation(y: number): void {
    this.rotation = y;
  }

  /** 获取前进方向（单位向量，世界空间）。0 = +Z。 */
  getForward(target: Vector3 = new Vector3()): Vector3 {
    return target.set(Math.sin(this.rotation), 0, Math.cos(this.rotation));
  }

  /** 获取右方向（单位向量，世界空间）。 */
  getRight(target: Vector3 = new Vector3()): Vector3 {
    return target.set(Math.cos(this.rotation), 0, -Math.sin(this.rotation));
  }

  /** 瞬移到指定位置。 */
  teleport(position: Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.isGrounded = false;
  }

  /**
   * 推导当前角色状态。用于驱动 AnimationStateMachine。
   * 优先级：jumping / falling > running > walking > idle。
   */
  getState(): CharacterState {
    if (!this.isGrounded) {
      return this.velocity.y > 0 ? 'jumping' : 'falling';
    }
    if (this._lastHorizontalSpeed < 0.1) return 'idle';
    return this.isRunning ? 'running' : 'walking';
  }

  /** 计算角色 AABB（用于与 ECS Collider / 场景物体相交测试）。 */
  getAABB(target: Box3 = new Box3()): Box3 {
    const r = this.radius;
    const h = this.height;
    target.min.set(this.position.x - r, this.position.y, this.position.z - r);
    target.max.set(this.position.x + r, this.position.y + h, this.position.z + r);
    return target;
  }

  // ── 内部 ─────────────────────────────────────────────────────────

  /**
   * 坡度限制：检查角色前方一格采样点的高度差，若超过 slopeLimit 对应的
   * 临界高度则把水平速度归零（角色被墙挡住）。
   *
   * 这是简化版（只在脚下中心采样），完整实现需要多点多方向采样；本实现
   * 已足够覆盖体素地形 / 高度图地形的大部分用例。
   */
  private _applySlopeLimit(sampleGround: GroundSampleFn, dt: number): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < EPS) return;

    // 前方采样点：脚下中心 + 速度方向 * (radius + small)
    const dirX = this.velocity.x / speed;
    const dirZ = this.velocity.z / speed;
    const probeDist = this.radius + 0.05;
    const aheadX = this.position.x + dirX * probeDist;
    const aheadZ = this.position.z + dirZ * probeDist;
    const aheadY = sampleGround(aheadX, aheadZ);
    if (aheadY === null) return;

    const rise = aheadY - this.position.y;
    // slope = rise / run；run = probeDist
    const slopeRad = Math.atan2(rise, probeDist);
    const limitRad = (this.slopeLimit * Math.PI) / 180;
    if (slopeRad > limitRad && rise > this.stepHeight) {
      // 超过坡度限制：取消水平位移（让角色停在坡下）
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    void dt;
  }
}

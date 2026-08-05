// FootPlacementIK — 足部放置 IK:防止滑步 + 适配地形 + 法线对齐。
//
// 设计来源:
//   * UE AnimSetFootIKDriver —— 标准足部 IK 驱动器
//   * Unity Animation Rigging Foot IK —— 运行时足部 IK
//   * o3de EMotionFX FootIKLayerPass —— 足部 IK 层
//   * GDC 2004 "Adaptive Character Physics" —— 地形适配基础论文
//
// 问题:
//   行走动画在平地上制作,脚底与地面贴合。但在斜坡/楼梯/不平地形上:
//   - 脚穿入地面(地形高于脚)
//   - 脚悬空(地形低于脚,但动画已在"着地"帧)
//   - 脚的朝向不跟随地面法线(脚底与斜面有间隙)
//
// 解决:
//   1. 从脚部位置向下射线检测地面
//   2. 计算目标位置 = 命中点 + footOffset
//   3. 用 TwoBoneIKSolver 弯曲腿(hip→knee→foot)使脚到达目标
//   4. 对齐脚的朝向到地面法线(normalAlign 控制混合度)
//   5. 平滑混合 IK 权重(避免突然弹出)
//
// 与 TwoBoneIKSolver 的关系:
//   * TwoBoneIKSolver 是低层级求解器:给定 root/mid/end + target,返回旋转。
//   * FootPlacementIK 是高层级驱动器:射线检测 + 目标计算 + 混合 + 调用 TwoBoneIKSolver。
//   * 调用方也可以只用 computeTarget() 获取目标位置,自行调用其他 IK 求解器。
//
// 与 CameraBob 的关系:
//   * CameraBob 产生相机摆动,但如果没有 FootPlacementIK,角色在斜坡上
//     仍会滑步 —— 视觉上极不自然。
//   * 二者配合:CameraBob 提供行走节奏,FootPlacementIK 保证脚贴地。

import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { TwoBoneIKSolver, type TwoBoneIKInput, type TwoBoneIKOutput } from './TwoBoneIKSolver';

/** 射线命中结果(与 Raycaster.Intersection 子集兼容)。 */
export interface IKRayHit {
  /** 命中点世界坐标。 */
  point: Vector3;
  /** 命中点法线(世界坐标)。 */
  normal: Vector3;
  /** 射线起点到命中点的距离。 */
  distance: number;
}

/** 射线检测函数类型(注入式,可接 Raycaster / Voxel / Physics)。 */
export type IKRaycastFn = (
  origin: Vector3,
  direction: Vector3,
  maxDist: number,
) => IKRayHit | null;

/** 单脚的配置。 */
export interface FootConfig {
  /** 射线起点相对脚骨位置的偏移(通常向上偏移,默认 (0, 0.5, 0))。 */
  rayOriginOffset: Vector3;
  /** 射线方向(默认 (0, -1, 0) = 向下)。 */
  rayDirection: Vector3;
  /** 射线最大长度(默认 1.0 米)。 */
  rayLength: number;
  /** 脚底到命中点的高度偏移(默认 0.02,脚底离地 2cm)。 */
  footOffset: number;
  /** 法线对齐强度 [0, 1](0=不旋转脚,1=完全对齐法线,默认 0.5)。 */
  normalAlign: number;
  /** 最大台阶高度(超过此高度不调整,避免脚"跳"到高处,默认 0.3)。 */
  maxStepHeight: number;
}

/** 单脚的运行时状态。 */
export interface FootState {
  /** 当前目标位置(世界坐标)。 */
  targetPos: Vector3;
  /** 当前目标法线(世界坐标)。 */
  targetNormal: Vector3;
  /** 是否着地(射线命中且在 maxStepHeight 内)。 */
  grounded: boolean;
  /** 平滑后的 IK 混合权重 [0, 1]。 */
  blendWeight: number;
}

/** 序列化结构。 */
export interface FootPlacementIKJSON {
  blendSpeed: number;
  weight: number;
  leftFoot: FootConfig;
  rightFoot: FootConfig;
}

// 临时变量(避免每帧分配)
const _rayOrigin = new Vector3();
const _targetPos = new Vector3();
const _heightDiff = new Vector3();
const _defaultUp = new Vector3(0, 1, 0);
const _qAlign = new Quaternion();
const _qCurrent = new Quaternion();
const _qResult = new Quaternion();
const _ikSolver = new TwoBoneIKSolver();
const _ikInput: TwoBoneIKInput = {
  rootPos: new Vector3(),
  midPos: new Vector3(),
  endPos: new Vector3(),
  targetPos: new Vector3(),
  polePos: new Vector3(),
  softness: 0,
  weight: 1,
};
const _ikOutput: TwoBoneIKOutput = {
  rootQuat: new Quaternion(),
  midQuat: new Quaternion(),
  midPos: new Vector3(),
  endPos: new Vector3(),
};

/** 默认脚部配置。 */
function defaultFootConfig(): FootConfig {
  return {
    rayOriginOffset: new Vector3(0, 0.5, 0),
    rayDirection: new Vector3(0, -1, 0),
    rayLength: 1.0,
    footOffset: 0.02,
    normalAlign: 0.5,
    maxStepHeight: 0.3,
  };
}

/**
 * 足部放置 IK —— 防止滑步,适配地形,对齐法线。
 *
 * 用法:
 *   const footIK = new FootPlacementIK();
 *   footIK.raycast = (origin, dir, max) => {
 *     const hits = raycaster.intersectObjects(terrain);
 *     return hits.length > 0 ? { point: hits[0].point, normal: hits[0].face.normal, distance: hits[0].distance } : null;
 *   };
 *
 *   // 每帧(动画更新后):
 *   footIK.update(dt, leftFootPos, rightFootPos);
 *
 *   // 解算左腿:
 *   const result = footIK.solveLeft(hipPos, kneePos, leftFootPos, polePos);
 *   // result.rootQuat → hip 旋转
 *   // result.midQuat → knee 旋转
 *   // result.footQuat → 脚部额外旋转(法线对齐)
 *   // result.endPos → 脚的最终位置
 */
export class FootPlacementIK {
  /** 射线检测函数。必须设置,否则所有射线返回 null(无 IK 效果)。 */
  raycast: IKRaycastFn | null = null;

  /** 左脚配置。 */
  leftFoot: FootConfig = defaultFootConfig();
  /** 右脚配置。 */
  rightFoot: FootConfig = defaultFootConfig();

  /** 混合速度(越高越快到达目标权重,默认 8)。 */
  blendSpeed: number = 8;
  /** 全局 IK 权重 [0, 1](0=完全关闭,1=完全启用,默认 1)。 */
  weight: number = 1;

  /** 左脚运行时状态。 */
  leftState: FootState = {
    targetPos: new Vector3(),
    targetNormal: new Vector3(0, 1, 0),
    grounded: false,
    blendWeight: 0,
  };

  /** 右脚运行时状态。 */
  rightState: FootState = {
    targetPos: new Vector3(),
    targetNormal: new Vector3(0, 1, 0),
    grounded: false,
    blendWeight: 0,
  };

  /**
   * 每帧更新 — 射线检测 + 计算目标 + 平滑混合。
   *  dt: 帧时间(秒)
   *  leftFootPos: 左脚世界位置(来自动画)
   *  rightFootPos: 右脚世界位置(来自动画)
   */
  update(dt: number, leftFootPos: Vector3, rightFootPos: Vector3): this {
    this.updateFoot(dt, 'left', leftFootPos, this.leftFoot, this.leftState);
    this.updateFoot(dt, 'right', rightFootPos, this.rightFoot, this.rightState);
    return this;
  }

  /**
   * 解算左腿 IK。
   *  hipPos: 髋骨世界位置
   *  kneePos: 膝盖世界位置
   *  footPos: 脚世界位置(动画位置)
   *  polePos: 极向量位置(通常在膝盖前方)
   *  返回: IK 输出(rootQuat/midQuat/endPos) + footQuat(法线对齐旋转)
   */
  solveLeft(
    hipPos: Vector3,
    kneePos: Vector3,
    footPos: Vector3,
    polePos: Vector3,
  ): TwoBoneIKOutput & { footQuat: Quaternion } {
    return this.solveFoot(hipPos, kneePos, footPos, polePos, this.leftFoot, this.leftState);
  }

  /**
   * 解算右腿 IK。参数同 solveLeft。
   */
  solveRight(
    hipPos: Vector3,
    kneePos: Vector3,
    footPos: Vector3,
    polePos: Vector3,
  ): TwoBoneIKOutput & { footQuat: Quaternion } {
    return this.solveFoot(hipPos, kneePos, footPos, polePos, this.rightFoot, this.rightState);
  }

  /** 只计算目标位置,不解算 IK(调用方自行使用其他求解器)。 */
  computeTarget(footPos: Vector3, config: FootConfig): {
    targetPos: Vector3;
    targetNormal: Vector3;
    grounded: boolean;
  } {
    if (!this.raycast) {
      return {
        targetPos: footPos,
        targetNormal: _defaultUp,
        grounded: false,
      };
    }

    // 射线起点 = 脚位置 + 偏移
    _rayOrigin.copy(footPos).add(config.rayOriginOffset);

    const hit = this.raycast(_rayOrigin, config.rayDirection, config.rayLength);
    if (!hit) {
      return {
        targetPos: footPos,
        targetNormal: _defaultUp,
        grounded: false,
      };
    }

    // 检查台阶高度
    _heightDiff.copy(hit.point).sub(footPos);
    const heightDelta = Math.abs(_heightDiff.y);
    if (heightDelta > config.maxStepHeight) {
      return {
        targetPos: footPos,
        targetNormal: _defaultUp,
        grounded: false,
      };
    }

    // 目标位置 = 命中点 + footOffset(向上)
    _targetPos.copy(hit.point);
    _targetPos.y += config.footOffset;

    return {
      targetPos: _targetPos.clone(),
      targetNormal: hit.normal.clone(),
      grounded: true,
    };
  }

  /** 立即清零混合权重(用于传送/重生)。 */
  reset(): this {
    this.leftState.blendWeight = 0;
    this.rightState.blendWeight = 0;
    this.leftState.grounded = false;
    this.rightState.grounded = false;
    return this;
  }

  /** 导出为 JSON。 */
  exportJSON(): FootPlacementIKJSON {
    return {
      blendSpeed: this.blendSpeed,
      weight: this.weight,
      leftFoot: { ...this.leftFoot, rayOriginOffset: this.leftFoot.rayOriginOffset.clone(), rayDirection: this.leftFoot.rayDirection.clone() },
      rightFoot: { ...this.rightFoot, rayOriginOffset: this.rightFoot.rayOriginOffset.clone(), rayDirection: this.rightFoot.rayDirection.clone() },
    };
  }

  /** 从 JSON 导入。 */
  importJSON(data: FootPlacementIKJSON): this {
    this.blendSpeed = data.blendSpeed;
    this.weight = data.weight;
    this.leftFoot = {
      ...data.leftFoot,
      rayOriginOffset: new Vector3().copy(data.leftFoot.rayOriginOffset),
      rayDirection: new Vector3().copy(data.leftFoot.rayDirection),
    };
    this.rightFoot = {
      ...data.rightFoot,
      rayOriginOffset: new Vector3().copy(data.rightFoot.rayOriginOffset),
      rayDirection: new Vector3().copy(data.rightFoot.rayDirection),
    };
    return this;
  }

  // ── 内部实现 ────────────────────────────────────────────────────

  /** 更新单脚的状态(射线 + 目标 + 平滑)。 */
  private updateFoot(
    dt: number,
    _side: 'left' | 'right',
    footPos: Vector3,
    config: FootConfig,
    state: FootState,
  ): void {
    const target = this.computeTarget(footPos, config);

    // 平滑混合权重(帧率无关指数平滑)
    const targetWeight = target.grounded ? this.weight : 0;
    const alpha = dt > 0 ? 1 - Math.exp(-this.blendSpeed * dt) : 0;
    state.blendWeight += (targetWeight - state.blendWeight) * alpha;

    // 更新状态
    state.targetPos.copy(target.targetPos);
    state.targetNormal.copy(target.targetNormal);
    state.grounded = target.grounded;
  }

  /** 解算单脚 IK。 */
  private solveFoot(
    hipPos: Vector3,
    kneePos: Vector3,
    footPos: Vector3,
    polePos: Vector3,
    config: FootConfig,
    state: FootState,
  ): TwoBoneIKOutput & { footQuat: Quaternion } {
    // 如果混合权重极低,直接返回原始姿态
    if (state.blendWeight < 0.001) {
      const output: TwoBoneIKOutput & { footQuat: Quaternion } = {
        rootQuat: new Quaternion(0, 0, 0, 1),
        midQuat: new Quaternion(0, 0, 0, 1),
        midPos: kneePos.clone(),
        endPos: footPos.clone(),
        footQuat: new Quaternion(0, 0, 0, 1),
      };
      return output;
    }

    // 在动画位置和 IK 目标位置之间插值
    _ikInput.rootPos.copy(hipPos);
    _ikInput.midPos.copy(kneePos);
    _ikInput.endPos.copy(footPos);

    // 目标 = lerp(动画位置, IK目标, blendWeight)
    _ikInput.targetPos.copy(footPos).lerp(state.targetPos, state.blendWeight);
    _ikInput.polePos = polePos;
    _ikInput.softness = 0.05;
    _ikInput.weight = state.blendWeight;

    _ikSolver.solve(_ikInput, _ikOutput);

    // 计算法线对齐旋转
    // 从默认 up (0,1,0) 旋转到目标法线
    _qCurrent.set(0, 0, 0, 1); // 单位四元数
    quatFromToRotation(_defaultUp, state.targetNormal, _qAlign);

    // 按 normalAlign 混合
    const alignWeight = config.normalAlign * state.blendWeight;
    _qResult.copy(_qCurrent).slerp(_qAlign, alignWeight);

    return {
      rootQuat: _ikOutput.rootQuat.clone(),
      midQuat: _ikOutput.midQuat.clone(),
      midPos: _ikOutput.midPos.clone(),
      endPos: _ikOutput.endPos.clone(),
      footQuat: _qResult.clone(),
    };
  }
}

// ── 预设 ─────────────────────────────────────────────────────────

/**
 * 便捷工厂:创建常见场景的足部 IK 配置。
 */
export const FootPlacementIKPresets = {
  /** 人形角色标准配置(脚离地 2cm,中等法线对齐)。 */
  humanoid(): FootPlacementIK {
    const ik = new FootPlacementIK();
    ik.leftFoot = defaultFootConfig();
    ik.rightFoot = defaultFootConfig();
    ik.blendSpeed = 8;
    ik.weight = 1;
    return ik;
  },

  /** 潜行模式(脚离地 1cm,强法线对齐,慢混合)。 */
  stealth(): FootPlacementIK {
    const ik = new FootPlacementIK();
    ik.leftFoot.footOffset = 0.01;
    ik.leftFoot.normalAlign = 0.8;
    ik.rightFoot.footOffset = 0.01;
    ik.rightFoot.normalAlign = 0.8;
    ik.blendSpeed = 12; // 更快混合(潜行需要精确)
    ik.weight = 1;
    return ik;
  },

  /** 奔跑模式(脚离地 3cm,弱法线对齐,快混合)。 */
  running(): FootPlacementIK {
    const ik = new FootPlacementIK();
    ik.leftFoot.footOffset = 0.03;
    ik.leftFoot.normalAlign = 0.3; // 奔跑时脚对齐要求低
    ik.leftFoot.maxStepHeight = 0.5; // 允许更大的台阶
    ik.rightFoot.footOffset = 0.03;
    ik.rightFoot.normalAlign = 0.3;
    ik.rightFoot.maxStepHeight = 0.5;
    ik.blendSpeed = 15; // 快混合
    ik.weight = 1;
    return ik;
  },

  /** 禁用模式(weight=0,完全关闭 IK)。 */
  disabled(): FootPlacementIK {
    const ik = new FootPlacementIK();
    ik.weight = 0;
    return ik;
  },
} as const;

// ── 工具函数 ─────────────────────────────────────────────────────

/** 从 from 方向旋转到 to 方向的四元数(最短弧)。 */
function quatFromToRotation(from: Vector3, to: Vector3, out: Quaternion): Quaternion {
  const fx = from.x, fy = from.y, fz = from.z;
  const tx = to.x, ty = to.y, tz = to.z;
  const dot = fx * tx + fy * ty + fz * tz;

  // 平行(同向)→ 单位
  if (dot > 0.999999) {
    out.set(0, 0, 0, 1);
    return out;
  }

  // 反平行 → 180° 旋转
  if (dot < -0.999999) {
    let ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz);
    let rx = 1, ry = 0, rz = 0;
    if (ax < ay) { if (ax < az) { rx = 0; ry = 1; } else { rx = 0; rz = 1; } }
    else { if (ay < az) { rx = 0; ry = 1; } }
    out.x = fy * rz - fz * ry;
    out.y = fz * rx - fx * rz;
    out.z = fx * ry - fy * rx;
    out.w = 0;
    out.normalize();
    return out;
  }

  // Melax 公式
  out.x = fy * tz - fz * ty;
  out.y = fz * tx - fx * tz;
  out.z = fx * ty - fy * tx;
  out.w = 1 + dot;
  out.normalize();
  return out;
}

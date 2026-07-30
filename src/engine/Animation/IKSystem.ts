// IKSystem — 高层逆运动学系统,直接操作 Object3D 关节链。
//
// 提供两种求解器:
//   • FABRIK (Forward And Backward Reaching Inverse Kinematics)
//     位置空间求解:迭代执行 backward pass(末端→根)和 forward pass(根→末端),
//     每步把关节投影到线段上以保持骨段长度。收敛快,适合多骨链。
//     支持 poleTarget 控制弯曲方向。
//   • CCD (Cyclic Coordinate Descent)
//     旋转空间求解:从末端向根逐关节旋转,使末端朝向目标。
//     天然兼容旋转约束(hinge joint),适合硬约束场景。
//
// 与 Animation/IK/ 子模块的区别:
//   • IK/ 子模块(IKBone / IKChain / IKSolver / CCDSolver)使用自研 IKBone 类,
//     内部维护 parent 链与本地变换,独立于场景图。
//   • IKSystem 直接操作 Object3D[],读写场景图节点的 position / rotation,
//     适合集成到已有场景图层级中。二者互补:IK/ 适合纯计算场景,
//     IKSystem 适合直接驱动场景图节点。
//
// 用法:
//   const ik = new IKSystem();
//   ik.setSolver('fabrik');
//   ik.addChain({
//     name: 'arm',
//     joints: [shoulder, elbow, hand],
//     target: new Vector3(1, 1, 0),
//     poleTarget: new Vector3(0, 2, 0),
//   });
//   ik.update(0.016);

import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

// ── 类型定义 ────────────────────────────────────────────────────────

/** 关节旋转约束(hinge joint):绕指定轴旋转,角度限制在 [minAngle, maxAngle]。 */
export interface IKConstraint {
  /** 约束作用的关节索引(在 chain.joints 数组中的位置)。 */
  jointIndex: number;
  /** 最小旋转角(弧度)。 */
  minAngle: number;
  /** 最大旋转角(弧度)。 */
  maxAngle: number;
  /** 旋转轴(父节点本地坐标系)。无需归一化,内部会归一化。 */
  axis: Vector3;
}

/** IK 链:一条从根到末端的关节序列。 */
export interface IKChainConfig {
  /** 链名(唯一标识)。 */
  name: string;
  /** 关节数组,joints[0] = 根,joints[n-1] = 末端效应器。 */
  joints: Object3D[];
  /** 末端效应器的世界空间目标位置。 */
  target: Vector3;
  /** 可选极向目标:控制多骨链的弯曲方向(FABRIK 使用)。 */
  poleTarget?: Vector3;
  /** 可选关节约束列表(CCD 使用,FABRIK 后处理也可用)。 */
  constraints?: IKConstraint[];
}

// ── 临时变量(避免 GC) ─────────────────────────────────────────────

const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q0 = new Quaternion();
const _q1 = new Quaternion();
const _axisN = new Vector3();

// ── 辅助函数 ────────────────────────────────────────────────────────

/** 从场景根开始更新世界矩阵,确保 matrixWorld 是最新的。 */
function updateWorldMatrices(joints: Object3D[]): void {
  if (joints.length === 0) return;
  // 找到最顶层祖先,从上往下更新整棵子树
  let root = joints[0];
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
}

/** 从 matrixWorld 提取世界坐标位置。 */
function getWorldPosition(obj: Object3D, out: Vector3): Vector3 {
  const e = obj.matrixWorld.elements;
  return out.set(e[12], e[13], e[14]);
}

/** 从 matrixWorld 提取世界旋转四元数(假设无非均匀缩放)。 */
function getWorldRotation(obj: Object3D, out: Quaternion): Quaternion {
  const e = obj.matrixWorld.elements;
  // matrixWorld 是列主序;取 3x3 旋转部分(行主序参数)
  const m00 = e[0], m01 = e[4], m02 = e[8];
  const m10 = e[1], m11 = e[5], m12 = e[9];
  const m20 = e[2], m21 = e[6], m22 = e[10];
  setQuatFromRotationMatrix(out, m00, m01, m02, m10, m11, m12, m20, m21, m22);
  return out;
}

/** 将世界旋转写回 Object3D 的本地 rotation(考虑父节点世界变换)。 */
function setWorldRotation(obj: Object3D, worldRot: Quaternion): void {
  const parent = obj.parent;
  if (parent) {
    getWorldRotation(parent, _q0);
    // localRot = inverse(parentWorldRot) * worldRot
    _q1.copy(_q0).invert();
    _q1.multiply(worldRot);
    obj.rotation.copy(_q1);
  } else {
    obj.rotation.copy(worldRot);
  }
  obj.updateMatrix();
}

/** 从 3x3 旋转矩阵(行主序)设置四元数。与 Object3D.ts 中的实现一致。 */
function setQuatFromRotationMatrix(
  q: Quaternion,
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): void {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q.w = 0.25 / s;
    q.x = (m21 - m12) * s;
    q.y = (m02 - m20) * s;
    q.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q.w = (m21 - m12) / s;
    q.x = 0.25 * s;
    q.y = (m01 + m10) / s;
    q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q.w = (m02 - m20) / s;
    q.x = (m01 + m10) / s;
    q.y = 0.25 * s;
    q.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q.w = (m10 - m01) / s;
    q.x = (m02 + m20) / s;
    q.y = (m12 + m21) / s;
    q.z = 0.25 * s;
  }
  q.normalize();
}

/** 对 Object3D 的本地旋转应用铰链约束(hinge joint)。
 *  将旋转投影到指定轴上,角度限制在 [minAngle, maxAngle]。
 *  返回是否发生了修改(角度被钳制或存在非轴分量)。 */
function applyHingeConstraint(joint: Object3D, constraint: IKConstraint): boolean {
  _axisN.copy(constraint.axis).normalize();
  const rot = joint.rotation;

  // 提取绕轴的投影角:对于 q = (sin(θ/2)*axis, cos(θ/2)),
  // 有向角 θ = 2 * atan2(q.xyz · axis, q.w)
  const proj = rot.x * _axisN.x + rot.y * _axisN.y + rot.z * _axisN.z;
  let angle = 2 * Math.atan2(proj, rot.w);
  // 包装到 [-π, π]
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;

  const clamped = Math.max(constraint.minAngle, Math.min(constraint.maxAngle, angle));
  const half = clamped / 2;
  const s = Math.sin(half);
  const c = Math.cos(half);

  // 检测是否有修改
  const changed =
    Math.abs(rot.x - _axisN.x * s) > 1e-9 ||
    Math.abs(rot.y - _axisN.y * s) > 1e-9 ||
    Math.abs(rot.z - _axisN.z * s) > 1e-9 ||
    Math.abs(rot.w - c) > 1e-9;

  // 重建为纯轴旋转
  rot.set(_axisN.x * s, _axisN.y * s, _axisN.z * s, c);
  return changed;
}

// ── IKSystem ────────────────────────────────────────────────────────

/**
 * 逆运动学系统:管理多条 IK 链,统一用 FABRIK 或 CCD 求解。
 *
 * 每条链独立求解(链间不共享关节)。对共享关节的 rig,调用方应按依赖顺序
 * 求解(如先脊柱再手臂)。
 */
export class IKSystem {
  /** 全部 IK 链。 */
  chains: IKChainConfig[] = [];
  /** 当前求解器。 */
  solver: 'fabrik' | 'ccd' = 'fabrik';
  /** 每条链的迭代次数。 */
  iterations: number = 10;
  /** 收敛容差(末端到目标的距离,世界单位)。 */
  tolerance: number = 1e-4;

  /** 添加一条 IK 链。重名链会被替换。 */
  addChain(chain: IKChainConfig): this {
    const existing = this.chains.findIndex((c) => c.name === chain.name);
    if (existing >= 0) this.chains[existing] = chain;
    else this.chains.push(chain);
    return this;
  }

  /** 移除链。返回是否找到并移除。 */
  removeChain(name: string): boolean {
    const idx = this.chains.findIndex((c) => c.name === name);
    if (idx < 0) return false;
    this.chains.splice(idx, 1);
    return true;
  }

  /** 设置指定链的目标位置。 */
  setTarget(name: string, target: Vector3): void {
    const chain = this.getChain(name);
    if (chain) chain.target.copy(target);
  }

  /** 设置指定链的极向目标(FABRIK 弯曲方向控制)。 */
  setPoleTarget(name: string, poleTarget: Vector3): void {
    const chain = this.getChain(name);
    if (chain) {
      if (chain.poleTarget) chain.poleTarget.copy(poleTarget);
      else chain.poleTarget = poleTarget.clone();
    }
  }

  /** 切换求解器。 */
  setSolver(solver: 'fabrik' | 'ccd'): void {
    this.solver = solver;
  }

  /** 设置迭代次数。 */
  setIterations(iterations: number): void {
    this.iterations = Math.max(1, iterations | 0);
  }

  /** 设置收敛容差。 */
  setTolerance(tolerance: number): void {
    this.tolerance = Math.max(0, tolerance);
  }

  /** 每帧求解全部链。dt 保留用于未来扩展(当前求解是瞬时的)。 */
  update(_dt: number): void {
    for (const chain of this.chains) {
      if (this.solver === 'fabrik') this.solveFABRIK(chain);
      else this.solveCCD(chain);
    }
  }

  // ── FABRIK 求解 ───────────────────────────────────────────────────

  /** FABRIK 求解单条链(位置空间)。 */
  solveFABRIK(chain: IKChainConfig): void {
    const joints = chain.joints;
    const n = joints.length;
    if (n < 2) return;

    // 1) 刷新世界矩阵,读取世界坐标
    updateWorldMatrices(joints);
    const worldPos: Vector3[] = new Array(n);
    for (let i = 0; i < n; i++) {
      worldPos[i] = new Vector3();
      getWorldPosition(joints[i], worldPos[i]);
    }

    // 2) 计算骨段长度(rest lengths)
    const lengths = new Array(n - 1);
    let totalLen = 0;
    for (let i = 0; i < n - 1; i++) {
      lengths[i] = worldPos[i].distanceTo(worldPos[i + 1]);
      totalLen += lengths[i];
    }
    if (totalLen < 1e-12) return;

    const target = chain.target;
    const rootOrig = worldPos[0].clone();

    // 3) 不可达:朝目标伸直
    const rootToTarget = _v0.copy(target).sub(rootOrig);
    const dist = rootToTarget.length();
    if (dist > totalLen + 1e-9) {
      const dir = rootToTarget.multiplyScalar(1 / dist);
      for (let i = 0; i < n - 1; i++) {
        worldPos[i + 1].copy(worldPos[i]).addScaledVector(dir, lengths[i]);
      }
      this._commitFABRIKPositions(chain, worldPos);
      this._applyConstraints(chain);
      return;
    }

    // 4) 迭代 backward + forward
    let err = worldPos[n - 1].distanceTo(target);
    for (let iter = 0; iter < this.iterations && err > this.tolerance; iter++) {
      // Backward: 末端钉在目标,向根回推
      worldPos[n - 1].copy(target);
      for (let i = n - 2; i >= 0; i--) {
        const dir = _v1.copy(worldPos[i + 1]).sub(worldPos[i]).normalize();
        worldPos[i].copy(worldPos[i + 1]).addScaledVector(dir, -lengths[i]);
      }
      // Forward: 根钉在原位,向末端推进
      worldPos[0].copy(rootOrig);
      for (let i = 1; i < n; i++) {
        const dir = _v2.copy(worldPos[i]).sub(worldPos[i - 1]).normalize();
        worldPos[i].copy(worldPos[i - 1]).addScaledVector(dir, lengths[i - 1]);
      }

      // 极向处理:将中间关节朝极向目标弯曲
      if (chain.poleTarget && n >= 3) {
        this._applyPoleFABRIK(worldPos, lengths, rootOrig, chain.poleTarget);
      }

      err = worldPos[n - 1].distanceTo(target);
    }

    // 5) 写回本地坐标
    this._commitFABRIKPositions(chain, worldPos);

    // 6) 约束后处理(FABRIK 不保证旋转约束,仅做铰链投影)
    this._applyConstraints(chain);
  }

  /** FABRIK 极向处理:将中间关节朝极向目标弯曲,然后用 forward pass 恢复骨段长度。 */
  private _applyPoleFABRIK(
    worldPos: Vector3[],
    lengths: number[],
    rootOrig: Vector3,
    poleTarget: Vector3,
  ): void {
    const n = worldPos.length;
    if (n < 3) return;
    const end = worldPos[n - 1];

    // 链方向(根→末端),单位向量
    const chainDir = _v1.copy(end).sub(rootOrig);
    const chainLen = chainDir.length();
    if (chainLen < 1e-9) return;
    chainDir.multiplyScalar(1 / chainLen);

    // 极向向量(垂直于链方向,指向极向目标)
    const poleVec = _v2.copy(poleTarget).sub(rootOrig);
    const along = poleVec.dot(chainDir);
    poleVec.addScaledVector(chainDir, -along); // 移除沿链方向分量
    if (poleVec.lengthSq() < 1e-18) return; // 极向在链轴上,无弯曲
    poleVec.normalize();

    // 每个中间关节:保持沿链方向的投影,替换垂直分量为极向
    for (let i = 1; i < n - 1; i++) {
      const rj = _v3.copy(worldPos[i]).sub(rootOrig);
      const a = rj.dot(chainDir);
      const perp = _v0.copy(rj).addScaledVector(chainDir, -a);
      const perpLen = perp.length();
      worldPos[i].copy(rootOrig).addScaledVector(chainDir, a).addScaledVector(poleVec, perpLen);
    }

    // 重新建立骨段长度(forward pass,根固定)
    worldPos[0].copy(rootOrig);
    for (let i = 1; i < n; i++) {
      const dir = _v1.copy(worldPos[i]).sub(worldPos[i - 1]);
      const dl = dir.length();
      if (dl < 1e-12) continue;
      dir.multiplyScalar(1 / dl);
      worldPos[i].copy(worldPos[i - 1]).addScaledVector(dir, lengths[i - 1]);
    }
  }

  /** 将 FABRIK 求解的世界位置写回各关节的本地 position。 */
  private _commitFABRIKPositions(chain: IKChainConfig, worldPos: Vector3[]): void {
    const joints = chain.joints;
    const n = joints.length;

    // 先读所有关节的世界旋转(FABRIK 不改旋转)
    const worldRots: Quaternion[] = new Array(n);
    for (let i = 0; i < n; i++) {
      worldRots[i] = new Quaternion();
      getWorldRotation(joints[i], worldRots[i]);
    }

    for (let i = 0; i < n; i++) {
      const parent = joints[i].parent;
      let parentWorldPos: Vector3;
      let parentWorldRot: Quaternion;

      // 检查父节点是否是链中更早的关节
      const parentIdx = parent ? joints.indexOf(parent) : -1;
      if (parentIdx >= 0 && parentIdx < i) {
        // 父节点在链中:从已更新的 matrixWorld 读取
        parentWorldPos = getWorldPosition(joints[parentIdx], _v0.clone());
        parentWorldRot = worldRots[parentIdx];
      } else if (parent) {
        // 父节点在链外:从 matrixWorld 读取(求解前更新过)
        parentWorldPos = getWorldPosition(parent, _v0.clone());
        parentWorldRot = new Quaternion();
        getWorldRotation(parent, parentWorldRot);
      } else {
        parentWorldPos = new Vector3(0, 0, 0);
        parentWorldRot = new Quaternion(0, 0, 0, 1);
      }

      // localPos = inverse(parentWorldRot) * (worldPos[i] - parentWorldPos)
      _v1.copy(worldPos[i]).sub(parentWorldPos);
      _q0.copy(parentWorldRot).invert();
      _v1.applyQuaternion(_q0);
      joints[i].position.copy(_v1);
      joints[i].updateMatrix();

      // 更新 matrixWorld 供后续关节读取
      if (parent) {
        joints[i].matrixWorld.multiplyMatrices(parent.matrixWorld, joints[i].matrix);
      } else {
        joints[i].matrixWorld.copy(joints[i].matrix);
      }
    }
  }

  // ── CCD 求解 ──────────────────────────────────────────────────────

  /** CCD 求解单条链(旋转空间)。 */
  solveCCD(chain: IKChainConfig): void {
    const joints = chain.joints;
    const n = joints.length;
    if (n < 2) return;

    updateWorldMatrices(joints);
    const target = chain.target;

    // 初始误差
    let err = this._endEffectorDistance(joints, target);
    if (err <= this.tolerance) return;

    for (let iter = 0; iter < this.iterations && err > this.tolerance; iter++) {
      // 从末端前一关节向根遍历
      for (let i = n - 2; i >= 0; i--) {
        updateWorldMatrices(joints);

        const jointWorldPos = getWorldPosition(joints[i], _v0);
        const endWorldPos = getWorldPosition(joints[n - 1], _v1);

        // curDir = normalize(end - joint)
        _v2.copy(endWorldPos).sub(jointWorldPos);
        const curLen = _v2.length();
        if (curLen < 1e-12) continue;
        _v2.multiplyScalar(1 / curLen);

        // tarDir = normalize(target - joint)
        _v3.copy(target).sub(jointWorldPos);
        const tarLen = _v3.length();
        if (tarLen < 1e-12) continue;
        _v3.multiplyScalar(1 / tarLen);

        // delta = setFromUnitVectors(curDir, tarDir)
        _q0.setFromUnitVectors(_v2, _v3);
        // 跳过接近零旋转
        if (Math.abs(_q0.w) > 1 - 1e-12) continue;

        // newWorldRot = delta * currentWorldRot
        getWorldRotation(joints[i], _q1);
        _q1.premultiply(_q0);
        setWorldRotation(joints[i], _q1);

        // 立即应用约束
        if (chain.constraints) {
          for (const c of chain.constraints) {
            if (c.jointIndex === i) applyHingeConstraint(joints[i], c);
          }
        }
      }

      err = this._endEffectorDistance(joints, target);
    }
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  /** 按名获取链。 */
  getChain(name: string): IKChainConfig | undefined {
    return this.chains.find((c) => c.name === name);
  }

  /** 获取链数量。 */
  getChainCount(): number {
    return this.chains.length;
  }

  /** 获取指定链末端效应器的当前世界位置。 */
  getEndEffector(name: string): Vector3 | undefined {
    const chain = this.getChain(name);
    if (!chain || chain.joints.length === 0) return undefined;
    updateWorldMatrices(chain.joints);
    const out = new Vector3();
    return getWorldPosition(chain.joints[chain.joints.length - 1], out);
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  /** 计算末端效应器到目标的距离。 */
  private _endEffectorDistance(joints: Object3D[], target: Vector3): number {
    updateWorldMatrices(joints);
    const endPos = getWorldPosition(joints[joints.length - 1], _v0);
    return endPos.distanceTo(target);
  }

  /** 对链中有约束的关节应用铰链约束(FABRIK 后处理)。 */
  private _applyConstraints(chain: IKChainConfig): void {
    if (!chain.constraints) return;
    for (const c of chain.constraints) {
      if (c.jointIndex >= 0 && c.jointIndex < chain.joints.length) {
        applyHingeConstraint(chain.joints[c.jointIndex], c);
        chain.joints[c.jointIndex].updateMatrix();
      }
    }
  }
}

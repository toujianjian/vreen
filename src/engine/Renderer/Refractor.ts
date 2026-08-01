// Refractor — 平面折射 (planar refraction)。
//
// 适配 three.js `examples/jsm/objects/Refractor.js` 并重构为 CPU 侧折射数学库。
// 与 Reflector 互补:Reflector 做镜面反射(角度翻转),Refractor 做透射折射(角度弯折)。
//
// Snell 折射定律:
//   n1 * sin(θ1) = n2 * sin(θ2)
//   折射方向 D' = η * D + (η * cos(θi) - cos(θt)) * N
//   其中 η = n1 / n2,cos(θi) = -D·N,cos(θt) = √(1 - η² * (1 - cos²(θi)))
//   当 1 - η² * (1 - cos²(θi)) < 0 时发生全反射 (TIR),返回 null。
//
// 用途:
//   - 水面透过(看水底变形)
//   - 玻璃/透镜透过
//   - 热空气扭曲 (mirage)
//   - 冰块/晶体折射
//
// 不变量:
//   - 入射方向 D 和法线 N 必须归一化;
//   - 全反射时 refractDirection 返回 null;
//   - 折射率比 eta = n1/n2(空气→水 ≈ 1/1.33 ≈ 0.75);
//   - 原始向量不被修改。
//
// 参考:
//   - three.js examples/jsm/objects/Refractor.js
//   - GLSL refract() 函数规范
//   - o3de Atom WaterSystem

import { Plane } from '../Math/Plane';
import { Vector3 } from '../Math/Vector3';

/** Refractor 配置。 */
export interface RefractorOptions {
  /** 折射平面(默认 y=0,法线 (0,1,0),constant 0)。 */
  plane?: Plane;
  /** 折射率比 η = n1/n2(空气→水 ≈ 0.75)。默认 0.75。 */
  eta?: number;
  /** 折射纹理分辨率。默认 512。 */
  resolution?: number;
}

/**
 * 平面折射器。
 *
 * 提供 CPU 侧折射数学:Snell 折射方向、全反射判定、UV 位移估算。
 * 实际的 GPU 渲染由 WebGL2Renderer 完成,本类只负责数学计算。
 */
export class Refractor {
  private _plane: Plane;
  private _eta: number;
  private _resolution: number;

  constructor(opts: RefractorOptions = {}) {
    this._plane = opts.plane
      ? opts.plane.clone().normalize()
      : new Plane(new Vector3(0, 1, 0), 0);
    this._eta = opts.eta ?? 0.75;
    this._resolution = opts.resolution ?? 512;
  }

  // ── 属性 ──────────────────────────────────────────────────────────

  get plane(): Plane {
    return this._plane;
  }

  get eta(): number {
    return this._eta;
  }

  get resolution(): number {
    return this._resolution;
  }

  // ── 配置 ──────────────────────────────────────────────────────────

  setPlane(plane: Plane): this {
    this._plane.copy(plane).normalize();
    return this;
  }

  setEta(eta: number): this {
    this._eta = eta;
    return this;
  }

  setResolution(res: number): this {
    if (res < 1) res = 1;
    this._resolution = Math.floor(res);
    return this;
  }

  // ── 折射数学 ──────────────────────────────────────────────────────

  /**
   * 计算 Snell 折射方向。
   *
   * @param incidentDir 入射方向(归一化,指向表面)。
   * @param normal 表面法线(归一化,指向入射侧)。
   * @param target 写入目标(可选)。
   * @returns 折射方向,或 null(全反射)。
   */
  refractDirection(
    incidentDir: Vector3,
    normal: Vector3,
    target: Vector3 = new Vector3(),
  ): Vector3 | null {
    // cos(θi) = -D·N (D 指向表面,N 指向入射侧)
    const cosThetaI = -(normal.x * incidentDir.x + normal.y * incidentDir.y + normal.z * incidentDir.z);

    // sin²(θt) = eta² * (1 - cos²(θi))
    const sin2ThetaT = this._eta * this._eta * (1 - cosThetaI * cosThetaI);

    // 全反射判定
    if (sin2ThetaT > 1) {
      return null;
    }

    // cos(θt) = √(1 - sin²(θt))
    const cosThetaT = Math.sqrt(1 - sin2ThetaT);

    // D' = eta * D + (eta * cos(θi) - cos(θt)) * N
    const k = this._eta * cosThetaI - cosThetaT;
    target.set(
      this._eta * incidentDir.x + k * normal.x,
      this._eta * incidentDir.y + k * normal.y,
      this._eta * incidentDir.z + k * normal.z,
    );

    return target;
  }

  /**
   * 判断给定入射角是否发生全反射 (TIR)。
   * 临界角: sin(θc) = 1/eta → θc = arcsin(1/eta)
   * @param incidentDir 入射方向(归一化)。
   * @param normal 表面法线(归一化)。
   * @returns true 表示全反射。
   */
  isTotalInternalReflection(incidentDir: Vector3, normal: Vector3): boolean {
    const cosThetaI = -(normal.x * incidentDir.x + normal.y * incidentDir.y + normal.z * incidentDir.z);
    const sin2ThetaT = this._eta * this._eta * (1 - cosThetaI * cosThetaI);
    return sin2ThetaT > 1;
  }

  /**
   * 计算全反射临界角(弧度)。
   * 仅当 eta > 1(从密介质到疏介质)时存在临界角。
   * TIR 条件: sin(θi) > 1/eta → θc = arcsin(1/eta)
   * @returns 临界角弧度,或 null(eta <= 1 时无临界角)。
   */
  get criticalAngle(): number | null {
    if (this._eta <= 1) return null;
    return Math.asin(1 / this._eta);
  }

  /**
   * 估算折射 UV 位移量(用于着色器 UV 偏移)。
   *
   * 当视线接近垂直表面时,折射偏移小;接近掠射角时,偏移大。
   * 位移 ∝ tan(θt) * depth(近似)。
   *
   * @param viewDir 视线方向(归一化,从表面指向相机)。
   * @param depth 虚拟穿透深度(世界单位)。
   * @returns UV 位移量(世界单位)。
   */
  estimateUVOffset(viewDir: Vector3, depth: number): number {
    const n = this._plane.normal;
    // cos(θi) = viewDir · normal (viewDir 从表面指向相机)
    const cosThetaI = n.x * viewDir.x + n.y * viewDir.y + n.z * viewDir.z;
    const sin2ThetaT = this._eta * this._eta * (1 - cosThetaI * cosThetaI);
    // 全反射时位移为 0(无折射光)
    if (sin2ThetaT > 1) return 0;
    const cosThetaT = Math.sqrt(1 - sin2ThetaT);
    // tan(θt) = sin(θt) / cos(θt)
    const sinThetaT = Math.sqrt(sin2ThetaT);
    const tanThetaT = sinThetaT / Math.max(cosThetaT, 1e-6);
    // 位移 = depth * tan(θt)
    return depth * tanThetaT;
  }

  /**
   * 计算透过折射面看到的虚拟物体位置。
   *
   * 给定真实物体位置,计算通过折射平面后"看起来"在的位置。
   * 算法:把物体位置沿法线方向移动 depth * (1 - eta) 距离(近似)。
   *
   * @param realPos 真实物体位置。
   * @param depth 虚拟深度(折射面到物体的距离)。
   * @param target 写入目标(可选)。
   * @returns 虚拟位置。
   */
  computeVirtualPosition(
    realPos: Vector3,
    depth: number,
    target: Vector3 = new Vector3(),
  ): Vector3 {
    // 简化模型:沿法线方向压缩 eta 倍
    // 水底看起来比实际浅:apparent_depth = real_depth * eta (eta = n1/n2 < 1)
    const n = this._plane.normal;
    const apparentDepth = depth * this._eta;
    // 虚拟位置 = 真实位置 + (depth - apparentDepth) * N
    // apparentDepth < depth (eta < 1) → 向法线方向移动(看起来更靠近表面)
    target.set(
      realPos.x + (depth - apparentDepth) * n.x,
      realPos.y + (depth - apparentDepth) * n.y,
      realPos.z + (depth - apparentDepth) * n.z,
    );
    return target;
  }
}

/**
 * 独立的 Snell 折射方向计算(无需创建 Refractor 实例)。
 *
 * @param incidentDir 入射方向(归一化,指向表面)。
 * @param normal 表面法线(归一化,指向入射侧)。
 * @param eta 折射率比 n1/n2。
 * @param target 写入目标(可选)。
 * @returns 折射方向,或 null(全反射)。
 */
export function refract(
  incidentDir: Vector3,
  normal: Vector3,
  eta: number,
  target: Vector3 = new Vector3(),
): Vector3 | null {
  const cosThetaI = -(normal.x * incidentDir.x + normal.y * incidentDir.y + normal.z * incidentDir.z);
  const sin2ThetaT = eta * eta * (1 - cosThetaI * cosThetaI);
  if (sin2ThetaT > 1) return null;
  const cosThetaT = Math.sqrt(1 - sin2ThetaT);
  const k = eta * cosThetaI - cosThetaT;
  target.set(
    eta * incidentDir.x + k * normal.x,
    eta * incidentDir.y + k * normal.y,
    eta * incidentDir.z + k * normal.z,
  );
  return target;
}

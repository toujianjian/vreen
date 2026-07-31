// CascadedShadowMap — 级联阴影贴图 (CSM/PSSM)。
//
// 适配 three.js CSM 与 o3de Atom CascadedShadows。
//
// 设计目标:
//   - 大型户外场景中,单一阴影贴图无法同时覆盖近距离细节与远距离范围。
//     CSM 将相机视锥分割为 N 级(通常 2~4),每级独立渲染一张阴影贴图,
//     近处级分辨率高(细节),远处级覆盖范围大(距离)。
//   - 本模块负责:
//       a) 视锥分割(logarithmic / uniform / practical PSSM 混合)
//       b) 每级 tight 光源正交投影(最小化 wasted texel)
//       c) 提供 shadow matrices + split depths 给 shader
//   - 实际 GL 渲染交由 ShadowMapManager 或 WebGL2Renderer 逐级调用。
//
// 参考:
//   - Engel, "Cascaded Shadow Maps", ShaderX^6
//   - Zhang et al., "Parallel-Split Shadow Maps (PSSM)"
//   - three.js CSM.js by vaso
//   - o3de Atom CascadedShadowMapsPass

import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Matrix4, Vector3, Box3 } from '../Math';

/** 分割方案。 */
export type SplitScheme = 'logarithmic' | 'uniform' | 'practical';

/** 级联描述。 */
export interface Cascade {
  /** 级联索引 (0=最近)。 */
  index: number;
  /** 近裁面距离(相机空间)。 */
  near: number;
  /** 远裁面距离(相机空间)。 */
  far: number;
  /** 光源 viewProjection 矩阵。 */
  viewProjection: Matrix4;
  /** 该级阴影贴图分辨率。 */
  resolution: number;
  /** texel 世界空间尺寸(用于偏移消除 acne)。 */
  texelSize: number;
}

/** CSM 构造选项。 */
export interface CascadedShadowMapOptions {
  /** 级联数量,默认 4。 */
  cascades?: number;
  /** 分割方案,默认 'practical'(log+uniform 混合)。
   *  logarithmic: 近处级更多 texel(细节好,远处级覆盖不足)
   *  uniform:     均匀分割(远处好,近处差)
   *  practical:   λ 混合(默认 0.5,兼顾) */
  scheme?: SplitScheme;
  /** practical 方案的混合因子 0..1,0=log,1=uniform,默认 0.5。 */
  lambda?: number;
  /** 每级阴影贴图分辨率,默认 2048。 */
  resolution?: number;
  /** 阴影距离(最大覆盖距离),默认 200。超出此距离不渲染阴影。 */
  shadowDistance?: number;
  /** 光源方向(归一化,从光源指向场景)。 */
  lightDirection?: Vector3;
  /** 阴影偏移(沿光源方向),消除 acne,默认 0.005。 */
  shadowBias?: number;
  /** 法线偏移,默认 0.02。 */
  normalBias?: number;
  /** 是否自动稳定(每帧 snap 到 texel grid),默认 true。 */
  stabilize?: boolean;
}

// 临时变量
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _corners: Vector3[] = Array.from({ length: 8 }, () => new Vector3());
const _lightCorner: Vector3[] = Array.from({ length: 8 }, () => new Vector3());
const _invView = new Matrix4();
const _lightView = new Matrix4();
const _lightProj = new Matrix4();
const _center = new Vector3();

/**
 * 级联阴影贴图管理器。
 *
 * 用法:
 * ```ts
 * const csm = new CascadedShadowMap({ cascades: 4, lightDirection: sunDir });
 * // 每帧:
 * csm.update(camera, sceneBoundingBox);
 * // 逐级渲染:
 * for (const cascade of csm.cascades) {
 *   renderer.renderShadowMap(scene, cascade.viewProjection, cascade.resolution);
 * }
 * // shader uniform:
 *   u_cascadeVP[0..N], u_cascadeSplits[0..N]
 * ```
 */
export class CascadedShadowMap {
  /** 级联数量。 */
  readonly cascadeCount: number;
  /** 分割方案。 */
  readonly scheme: SplitScheme;
  /** practical 混合因子。 */
  readonly lambda: number;
  /** 每级分辨率。 */
  readonly resolution: number;
  /** 阴影最大距离。 */
  readonly shadowDistance: number;
  /** 光源方向(归一化)。 */
  lightDirection: Vector3;
  /** 阴影偏移。 */
  shadowBias: number;
  /** 法线偏移。 */
  normalBias: number;
  /** 是否稳定。 */
  stabilize: boolean;

  /** 当前级联数据(每帧 update 后更新)。 */
  cascades: Cascade[] = [];
  /** 分割深度(相机空间,供 shader 选择级联)。 */
  splitDepths: Float32Array;

  private _splitRatios: number[] = [];

  constructor(opts: CascadedShadowMapOptions = {}) {
    this.cascadeCount = Math.max(1, Math.min(8, opts.cascades ?? 4));
    this.scheme = opts.scheme ?? 'practical';
    this.lambda = opts.lambda ?? 0.5;
    this.resolution = opts.resolution ?? 2048;
    this.shadowDistance = opts.shadowDistance ?? 200;
    this.lightDirection = opts.lightDirection
      ? opts.lightDirection.clone().normalize()
      : new Vector3(-0.5, -1, -0.3).normalize();
    this.shadowBias = opts.shadowBias ?? 0.005;
    this.normalBias = opts.normalBias ?? 0.02;
    this.stabilize = opts.stabilize ?? true;
    this.splitDepths = new Float32Array(this.cascadeCount);

    this.cascades = Array.from({ length: this.cascadeCount }, (_, i) => ({
      index: i,
      near: 0,
      far: 0,
      viewProjection: new Matrix4(),
      resolution: this.resolution,
      texelSize: 0,
    }));

    this._computeSplitRatios();
  }

  /**
   * 计算级联分割比例(在 shadowDistance 内的归一化位置)。
   * 在 cascadeCount / scheme / lambda 变化时调用。
   */
  private _computeSplitRatios(): void {
    const N = this.cascadeCount;
    this._splitRatios = [];
    for (let i = 1; i <= N; i++) {
      const p = i / N;
      let logSplit: number, uniformSplit: number;
      if (this.scheme === 'logarithmic') {
        logSplit = this._logSplit(p);
        this._splitRatios.push(logSplit);
      } else if (this.scheme === 'uniform') {
        uniformSplit = p;
        this._splitRatios.push(uniformSplit);
      } else {
        // practical: (1-λ)*log + λ*uniform (λ=0 → log, λ=1 → uniform)
        logSplit = this._logSplit(p);
        uniformSplit = p;
        this._splitRatios.push((1 - this.lambda) * logSplit + this.lambda * uniformSplit);
      }
    }
  }

  /** 对数分割公式。 */
  private _logSplit(p: number): number {
    const near = 0.1; // 相机近裁面近似
    const far = this.shadowDistance;
    return (near * Math.pow(far / near, p) - near) / (far - near);
  }

  /**
   * 每帧更新级联数据。
   *
   * @param camera 场景相机
   * @param sceneBounds 场景包围盒(用于 tight fit;可选,不传则用 shadowDistance)
   */
  update(camera: PerspectiveCamera, sceneBounds?: Box3): void {
    const camNear = camera.near;
    const camFar = Math.min(camera.far, this.shadowDistance);

    // 计算每级 near/far
    for (let i = 0; i < this.cascadeCount; i++) {
      const ratio = this._splitRatios[i];
      const splitDist = camNear + (camFar - camNear) * ratio;
      const cascade = this.cascades[i];
      cascade.near = i === 0 ? camNear : this.cascades[i - 1].far;
      cascade.far = splitDist;
      this.splitDepths[i] = splitDist;
    }

    // 计算相机逆矩阵
    _invView.copy(camera.matrixWorld).invert();

    // 光源 view 矩阵(看向场景中心方向)
    for (let i = 0; i < this.cascadeCount; i++) {
      const cascade = this.cascades[i];
      this._computeCascadeVP(camera, _invView, cascade, sceneBounds);
    }
  }

  /**
   * 计算单级光源 viewProjection。
   * 1. 提取该级 sub-frustum 的 8 角点(世界空间)
   * 2. 变换到光源空间
   * 3. 计算 AABB → 正交投影
   */
  private _computeCascadeVP(
    camera: PerspectiveCamera,
    invView: Matrix4,
    cascade: Cascade,
    sceneBounds?: Box3,
  ): void {
    // 1. 计算 sub-frustum 8 角点(相机空间 → 世界空间)
    const tanHalfFov = Math.tan((camera.fov * Math.PI / 180) * 0.5);
    const aspect = camera.aspect;

    const cn = cascade.near;
    const cf = cascade.far;

    // 近/远平面的半宽半高
    const nh = cn * tanHalfFov;
    const nw = nh * aspect;
    const fh = cf * tanHalfFov;
    const fw = fh * aspect;

    // 8 角点(相机空间):近 4 + 远 4
    // 逆 view 变换到世界空间
    const camCorners = [
      // 近平面: 左下, 右下, 右上, 左上
      [-nw, -nh, -cn], [nw, -nh, -cn], [nw, nh, -cn], [-nw, nh, -cn],
      // 远平面
      [-fw, -fh, -cf], [fw, -fh, -cf], [fw, fh, -cf], [-fw, fh, -cf],
    ];

    for (let j = 0; j < 8; j++) {
      const c = camCorners[j];
      _v1.set(c[0], c[1], c[2]);
      // 变换到世界空间: world = invView * camSpace
      _v1.applyMatrix4(invView);
      _corners[j].copy(_v1);
    }

    // 2. 计算级联中心(世界空间)
    _center.set(0, 0, 0);
    for (let j = 0; j < 8; j++) {
      _center.add(_corners[j]);
    }
    _center.multiplyScalar(1 / 8);

    // 3. 构建光源 view 矩阵(从中心沿光源反方向看)
    const lightDir = this.lightDirection;
    _v1.copy(_center).add(lightDir); // 光源位置(中心 + 方向)
    _v2.copy(_center);               // 看向中心
    _v3.set(0, 1, 0);                // up 向量(假设光源不会完全垂直)

    // 如果光源方向接近垂直,改用 X 轴作为 up
    if (Math.abs(lightDir.y) > 0.99) {
      _v3.set(1, 0, 0);
    }

    _lightView.makeLookAt(_v1, _v2, _v3);

    // 4. 变换 8 角点到光源空间,计算 AABB
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let j = 0; j < 8; j++) {
      _v4.copy(_corners[j]).applyMatrix4(_lightView);
      _lightCorner[j].copy(_v4);
      if (_v4.x < minX) minX = _v4.x;
      if (_v4.x > maxX) maxX = _v4.x;
      if (_v4.y < minY) minY = _v4.y;
      if (_v4.y > maxY) maxY = _v4.y;
      if (_v4.z < minZ) minZ = _v4.z;
      if (_v4.z > maxZ) maxZ = _v4.z;
    }

    // 5. 可选:用场景包围盒扩展 Z 范围(确保场景内物体都在阴影范围内)
    if (sceneBounds) {
      // 变换场景 8 角点到光源空间,扩展 Z 范围
      const sb = [
        [sceneBounds.min.x, sceneBounds.min.y, sceneBounds.min.z],
        [sceneBounds.max.x, sceneBounds.min.y, sceneBounds.min.z],
        [sceneBounds.min.x, sceneBounds.max.y, sceneBounds.min.z],
        [sceneBounds.max.x, sceneBounds.max.y, sceneBounds.min.z],
        [sceneBounds.min.x, sceneBounds.min.y, sceneBounds.max.z],
        [sceneBounds.max.x, sceneBounds.min.y, sceneBounds.max.z],
        [sceneBounds.min.x, sceneBounds.max.y, sceneBounds.max.z],
        [sceneBounds.max.x, sceneBounds.max.y, sceneBounds.max.z],
      ];
      for (let j = 0; j < 8; j++) {
        _v4.set(sb[j][0], sb[j][1], sb[j][2]).applyMatrix4(_lightView);
        if (_v4.z < minZ) minZ = _v4.z;
        if (_v4.z > maxZ) maxZ = _v4.z;
      }
    }

    // 6. 稳定化:snap 到 texel grid(消除光源移动时的阴影抖动)
    let unitsPerTexel = 1;
    if (this.stabilize) {
      const texelsPerSide = this.resolution;
      const worldUnitsPerSide = Math.max(maxX - minX, maxY - minY);
      unitsPerTexel = worldUnitsPerSide / texelsPerSide;
      if (unitsPerTexel > 0) {
        minX = Math.floor(minX / unitsPerTexel) * unitsPerTexel;
        maxX = Math.ceil(maxX / unitsPerTexel) * unitsPerTexel;
        minY = Math.floor(minY / unitsPerTexel) * unitsPerTexel;
        maxY = Math.ceil(maxY / unitsPerTexel) * unitsPerTexel;
      }
      cascade.texelSize = unitsPerTexel;
    } else {
      cascade.texelSize = Math.max(maxX - minX, maxY - minY) / this.resolution;
    }

    // 7. 构建正交投影
    _lightProj.makeOrthographic(
      minX - this.shadowBias, maxX + this.shadowBias,
      maxY + this.shadowBias, minY - this.shadowBias,
      minZ - this.shadowBias, maxZ + this.shadowBias,
    );

    // 8. viewProjection = proj * view
    cascade.viewProjection.copy(_lightProj).multiply(_lightView);
  }

  /**
   * 获取所有级联的 viewProjection 矩阵(扁平数组,供 uniform 上传)。
   * 每个矩阵 16 个 float,共 cascadeCount * 16 个。
   */
  getCascadeVPArray(): Float32Array {
    const arr = new Float32Array(this.cascadeCount * 16);
    for (let i = 0; i < this.cascadeCount; i++) {
      const m = this.cascades[i].viewProjection.elements;
      arr.set(m, i * 16);
    }
    return arr;
  }

  /**
   * 获取级联分割深度(供 shader 选择级联)。
   * 返回 Float32Array,长度 = cascadeCount。
   */
  getSplitDepths(): Float32Array {
    return this.splitDepths.slice();
  }

  /**
   * 设置光源方向(自动归一化)。
   */
  setLightDirection(dir: Vector3): this {
    this.lightDirection.copy(dir).normalize();
    return this;
  }

  /**
   * 设置级联数量(重建级联数据)。
   */
  setCascadeCount(n: number): this {
    (this as { cascadeCount: number }).cascadeCount = Math.max(1, Math.min(8, n));
    this.splitDepths = new Float32Array(this.cascadeCount);
    this.cascades = Array.from({ length: this.cascadeCount }, (_, i) => ({
      index: i,
      near: 0,
      far: 0,
      viewProjection: new Matrix4(),
      resolution: this.resolution,
      texelSize: 0,
    }));
    this._computeSplitRatios();
    return this;
  }

  /** 设置分割方案。 */
  setScheme(scheme: SplitScheme): this {
    (this as { scheme: SplitScheme }).scheme = scheme;
    this._computeSplitRatios();
    return this;
  }

  /** 设置 practical 混合因子。 */
  setLambda(lambda: number): this {
    (this as { lambda: number }).lambda = Math.max(0, Math.min(1, lambda));
    if (this.scheme === 'practical') this._computeSplitRatios();
    return this;
  }
}

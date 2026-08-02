// CSMShadowMap — 级联阴影贴图 (Cascaded Shadow Maps) 管理器。
//
// 设计目标:
//   - 将相机视锥体分割为 N 个级联(默认 4),每个级联有独立的阴影贴图。
//   - 近处级联使用高分辨率阴影贴图(细节清晰),远处级联使用低分辨率
//     (节省显存),匹配人眼对近处细节更敏感的视觉特性。
//   - 使用 PSSM (Parallel Split Shadow Maps) 分割策略:对数+均匀混合,
//     兼顾近处精度和远处覆盖。
//   - 每个级联的阴影相机(正交)紧密包裹该级联的子视锥体,最大化纹素利用率。
//
// 与 ShadowMapManager 的关系:
//   - ShadowMapManager:单级阴影贴图,适用于小场景或室内。
//   - CSMShadowMap:多级级联阴影贴图,适用于大场景或户外。
//   - 两者可共存:CSM 用于方向光(大范围),ShadowMapManager 用于点/聚光(小范围)。
//
// 参考:
//   - Zhang et al. 2006 "Parallel-Split Shadow Maps on Programmable GPUs"
//   - Engel 2004 "Cascaded Shadow Maps"
//   - UE5 CascadedShadowMap
//   - o3de Atom Shadow

import { Camera } from '../Cameras/Camera';
import { DirectionalLight } from '../Lights';
import { Matrix4, Vector3 } from '../Math';
import { createLogger } from '@/lib/logger';

const log = createLogger('CSMShadowMap');

/** PSSM 分割策略。 */
export type SplitScheme = 'logarithmic' | 'uniform' | 'pssm';

export interface CSMShadowMapOptions {
  /** 级联数量(默认 4)。典型值:2/4/8。更多级联 = 更好质量但更慢。 */
  cascadeCount?: number;
  /** 每级阴影贴图分辨率(默认 1024)。所有级联使用相同分辨率。 */
  mapSize?: number;
  /** PSSM 混合因子(默认 0.5)。0=纯对数(近处精度最优),1=纯均匀(远处覆盖最优)。 */
  splitFactor?: number;
  /** 最大阴影距离(默认 100)。超出此距离的像素不投射阴影。 */
  shadowDistance?: number;
  /** 级联间过渡比例(默认 0.1)。在级联边界处混合,避免硬接缝。 */
  blendMargin?: number;
  /** 分割方案(默认 'pssm')。 */
  scheme?: SplitScheme;
}

/** 单个级联的元数据。 */
export interface CascadeInfo {
  /** 该级联覆盖的近裁面(相机空间)。 */
  near: number;
  /** 该级联覆盖的远裁面(相机空间)。 */
  far: number;
  /** 该级联的光源视图矩阵。 */
  viewMatrix: Matrix4;
  /** 该级联的光源投影矩阵(正交)。 */
  projectionMatrix: Matrix4;
  /** 该级联的视图投影矩阵(view × projection)。 */
  viewProjection: Matrix4;
  /** 该级联的 texel 世界尺寸(用于 bias 缩放)。 */
  texelSize: number;
}

/**
 * 级联阴影贴图管理器。
 *
 * 调用方(WebGL2Renderer)每帧:
 *   1. update(camera, light) 计算级联分割和阴影相机;
 *   2. 对每个级联渲染深度到对应的阴影贴图;
 *   3. 将级联矩阵和分割点上传到着色器;
 *   4. 着色器中根据片段深度选择级联并采样。
 */
export class CSMShadowMap {
  /** 级联数量。 */
  cascadeCount: number;
  /** 每级阴影贴图分辨率。 */
  mapSize: number;
  /** PSSM 混合因子(0=对数, 1=均匀)。 */
  splitFactor: number;
  /** 最大阴影距离。 */
  shadowDistance: number;
  /** 级联间过渡比例。 */
  blendMargin: number;
  /** 分割方案。 */
  scheme: SplitScheme;

  /** 当前帧的级联信息数组。 */
  cascades: CascadeInfo[] = [];
  /** 分割点数组(长度 = cascadeCount + 1,第一个=相机 near,最后一个=shadowDistance)。 */
  splits: number[] = [];

  constructor(opts: CSMShadowMapOptions = {}) {
    this.cascadeCount = opts.cascadeCount ?? 4;
    this.mapSize = opts.mapSize ?? 1024;
    this.splitFactor = opts.splitFactor ?? 0.5;
    this.shadowDistance = opts.shadowDistance ?? 100;
    this.blendMargin = opts.blendMargin ?? 0.1;
    this.scheme = opts.scheme ?? 'pssm';

    // 初始化级联数据
    for (let i = 0; i < this.cascadeCount; i++) {
      this.cascades.push({
        near: 0, far: 0,
        viewMatrix: new Matrix4(),
        projectionMatrix: new Matrix4(),
        viewProjection: new Matrix4(),
        texelSize: 0,
      });
    }
    this._computeSplits();
  }

  /**
   * 每帧更新:计算级联分割和每级阴影相机矩阵。
   *
   * @param camera 主相机(读取 near/far/projection/view)
   * @param light  方向光(读取 direction/position)
   */
  update(camera: Camera, light: DirectionalLight): void {
    // 1. 计算分割点
    this._computeSplits();

    // 2. 计算相机视锥角点(世界空间)
    const fov = (camera as any).fov ? (camera as any).fov * Math.PI / 180 : Math.PI / 4;
    const aspect = (camera as any).aspect ?? 1;

    // 3. 对每个级联计算紧密正交阴影相机
    const lightDir = new Vector3(light.direction.x, light.direction.y, light.direction.z);

    for (let i = 0; i < this.cascadeCount; i++) {
      const cascade = this.cascades[i];
      cascade.near = this.splits[i];
      cascade.far = this.splits[i + 1];

      // 计算该级联的子视锥体角点(世界空间)
      const nearDist = cascade.near;
      const farDist = cascade.far;

      const nearHalfH = Math.tan(fov * 0.5) * nearDist;
      const nearHalfW = nearHalfH * aspect;
      const farHalfH = Math.tan(fov * 0.5) * farDist;
      const farHalfW = farHalfH * aspect;

      // 相机的前/右/上向量(世界空间)
      const camForward = new Vector3(0, 0, -1).applyMatrix4(camera.matrixWorld).sub(camera.position).normalize();
      const camRight = new Vector3(1, 0, 0).applyMatrix4(camera.matrixWorld).sub(camera.position).normalize();
      const camUp = camRight.clone().cross(camForward).normalize();

      const camPos = camera.position;

      // 8 个角点(近面 4 + 远面 4)
      const nearCenter = camPos.clone().add(camForward.clone().multiplyScalar(nearDist));
      const farCenter = camPos.clone().add(camForward.clone().multiplyScalar(farDist));

      const corners: Vector3[] = [
        // 近面
        nearCenter.clone().add(camUp.clone().multiplyScalar( nearHalfH)).add(camRight.clone().multiplyScalar( nearHalfW)),
        nearCenter.clone().add(camUp.clone().multiplyScalar( nearHalfH)).add(camRight.clone().multiplyScalar(-nearHalfW)),
        nearCenter.clone().add(camUp.clone().multiplyScalar(-nearHalfH)).add(camRight.clone().multiplyScalar(-nearHalfW)),
        nearCenter.clone().add(camUp.clone().multiplyScalar(-nearHalfH)).add(camRight.clone().multiplyScalar( nearHalfW)),
        // 远面
        farCenter.clone().add(camUp.clone().multiplyScalar( farHalfH)).add(camRight.clone().multiplyScalar( farHalfW)),
        farCenter.clone().add(camUp.clone().multiplyScalar( farHalfH)).add(camRight.clone().multiplyScalar(-farHalfW)),
        farCenter.clone().add(camUp.clone().multiplyScalar(-farHalfH)).add(camRight.clone().multiplyScalar(-farHalfW)),
        farCenter.clone().add(camUp.clone().multiplyScalar(-farHalfH)).add(camRight.clone().multiplyScalar( farHalfW)),
      ];

      // 计算角点的中心(光源视图空间)
      const center = new Vector3();
      for (const c of corners) center.add(c);
      center.multiplyScalar(1 / 8);

      // 光源视图矩阵:从 center 沿 -lightDir 看向 center
      const lightViewTarget = center.clone();
      const lightViewPos = lightViewTarget.clone().sub(lightDir.clone().multiplyScalar(this.shadowDistance));
      cascade.viewMatrix = new Matrix4().makeLookAt(lightViewPos, lightViewTarget, new Vector3(0, 1, 0));

      // 将角点变换到光源视图空间,求 AABB
      const min = new Vector3( Infinity,  Infinity,  Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const c of corners) {
        const v = c.clone().applyMatrix4(cascade.viewMatrix);
        min.min(v);
        max.max(v);
      }

      // 正交投影包裹 AABB
      const orthoLeft = min.x;
      const orthoRight = max.x;
      const orthoBottom = min.y;
      const orthoTop = max.y;
      const orthoNear = -max.z - 10; // 加一点 padding 避免裁剪
      const orthoFar = -min.z + 10;

      cascade.projectionMatrix = new Matrix4().makeOrthographic(
        orthoLeft, orthoRight, orthoTop, orthoBottom, orthoNear, orthoFar,
      );

      cascade.viewProjection = new Matrix4().multiplyMatrices(cascade.projectionMatrix, cascade.viewMatrix);

      // texel 世界尺寸 = 正交宽度 / 贴图分辨率
      const orthoWidth = orthoRight - orthoLeft;
      cascade.texelSize = orthoWidth / this.mapSize;
    }

    log.debug(`updated: ${this.cascadeCount} cascades, splits=[${this.splits.map(s => s.toFixed(1)).join(', ')}]`);
  }

  /**
   * 获取所有级联的视图投影矩阵(用于上传到着色器 uniform array)。
   * 返回 Float32Array(长度 = cascadeCount × 16)。
   */
  getViewProjectionArray(): Float32Array {
    const result = new Float32Array(this.cascadeCount * 16);
    for (let i = 0; i < this.cascadeCount; i++) {
      const elements = this.cascades[i].viewProjection.elements;
      for (let j = 0; j < 16; j++) {
        result[i * 16 + j] = elements[j];
      }
    }
    return result;
  }

  /**
   * 获取分割点数组(用于上传到着色器 u_csmSplits)。
   * 返回 Float32Array(长度 = cascadeCount,每个值是该级联的远裁面)。
   */
  getSplitDistances(): Float32Array {
    const result = new Float32Array(this.cascadeCount);
    for (let i = 0; i < this.cascadeCount; i++) {
      result[i] = this.splits[i + 1];
    }
    return result;
  }

  /** 重新计算分割点(基于当前 scheme 和 splitFactor)。 */
  private _computeSplits(): void {
    const N = this.cascadeCount;
    const near = 0.1; // 相机近裁面(简化:使用固定值,实际应从 camera 读取)
    const far = this.shadowDistance;

    this.splits = new Array(N + 1);
    this.splits[0] = near;
    this.splits[N] = far;

    for (let i = 1; i < N; i++) {
      const ratio = i / N;
      let split: number;

      if (this.scheme === 'logarithmic') {
        // 纯对数:近处分割密集,远处稀疏
        split = near * Math.pow(far / near, ratio);
      } else if (this.scheme === 'uniform') {
        // 纯均匀:等距分割
        split = near + (far - near) * ratio;
      } else {
        // PSSM:对数 + 均匀混合
        const logSplit = near * Math.pow(far / near, ratio);
        const uniSplit = near + (far - near) * ratio;
        split = this.splitFactor * logSplit + (1 - this.splitFactor) * uniSplit;
      }

      this.splits[i] = split;
    }
  }

  /** 释放资源。CSMShadowMap 本身不持有 GPU 资源(FBO/纹理由 ShadowMapManager 管理)。 */
  dispose(): void {
    this.cascades = [];
    this.splits = [];
    log.debug('disposed');
  }
}

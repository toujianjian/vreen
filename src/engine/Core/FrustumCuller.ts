// FrustumCuller — 视锥裁剪器。从相机的 viewProjection 矩阵提取 6 平面
// 视锥体,对场景对象做可见性判定。用于 SceneGraphProcessor.collectVisible,
// 只把视锥内(或与视锥相交)的对象收集进渲染列表,减少 draw call。
//
// 裁剪策略:
// - 若对象暴露 worldBoundingSphere(鸭子类型,半径 > 0),用球-视锥相交测试
// - 否则回退到点测试:取对象 matrixWorld 的平移分量(世界位置)做 containsPoint
//   点测试是保守的(中心在视锥内即视为可见),不会错误剔除,但边缘对象可能误留。
//
// 注意:调用前需保证对象 matrixWorld 已更新(由 SceneGraphProcessor.updateWorldMatrices 负责)。

import { Frustum } from '../Math/Frustum';
import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import type { Camera } from '../Cameras/Camera';
import type { Object3D } from './Object3D';

/** 裁剪统计快照。 */
export interface FrustumCullStats {
  /** 累计测试的对象数(自上次 setFromCamera 起)。 */
  tested: number;
  /** 通过裁剪(可见)的对象数。 */
  passed: number;
  /** 被裁剪掉(不可见)的对象数。 */
  rejected: number;
}

/** 鸭子类型:对象若暴露世界空间包围球则用球测试。 */
interface WorldBoundedObject3D {
  worldBoundingSphere?: { radius: number } | null;
}

// 复用临时向量避免每次 cullSingle 分配。
const _worldPoint = new Vector3();

export class FrustumCuller {
  /** 6 平面视锥体(left/right/bottom/top/near/far)。 */
  readonly frustum: Frustum = new Frustum();

  protected _stats: FrustumCullStats = { tested: 0, passed: 0, rejected: 0 };
  protected _viewProjection = new Matrix4();
  protected _viewMatrix = new Matrix4();

  /**
   * 从相机设置视锥。viewProjection = projection * inverse(matrixWorld)。
   *
   * 内部从 camera.matrixWorld 求逆得到 view 矩阵(而非依赖 camera.matrixWorldInverse,
   * 该字段在 VREEN 引擎中不会由 updateMatrixWorld 自动同步),保证裁剪器自包含可用。
   * 调用前需保证相机 matrixWorld 已更新(调用 camera.updateMatrixWorld(true))。
   */
  setFromCamera(camera: Camera): this {
    this._viewMatrix.getInverse(camera.matrixWorld);
    this._viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      this._viewMatrix,
    );
    this.frustum.setFromViewProjectionMatrix(this._viewProjection);
    this._stats.tested = 0;
    this._stats.passed = 0;
    this._stats.rejected = 0;
    return this;
  }

  /**
   * 批量裁剪:对对象数组逐个调用 cullSingle,返回可见对象的新数组。
   * 不修改输入数组。
   */
  cull(objects: Object3D[]): Object3D[] {
    const visible: Object3D[] = [];
    for (let i = 0; i < objects.length; i++) {
      if (this.cullSingle(objects[i])) {
        visible.push(objects[i]);
      }
    }
    return visible;
  }

  /**
   * 判定单个对象是否在视锥内可见。
   *
   * - 取对象世界位置(matrixWorld 平移分量 e[12],e[13],e[14])
   * - 若对象暴露 worldBoundingSphere 且 radius > 0,用球-视锥相交测试
   * - 否则用点-视锥包含测试(保守策略)
   *
   * 返回 true 表示可见(在视锥内或与视锥相交),false 表示被剔除。
   */
  cullSingle(object: Object3D): boolean {
    this._stats.tested++;

    // 从 matrixWorld 提取世界位置(平移分量)。
    const e = object.matrixWorld.elements;
    _worldPoint.set(e[12], e[13], e[14]);

    // 鸭子类型:若对象有世界空间包围球,用球测试(更准确)。
    const bounded = object as Object3D & WorldBoundedObject3D;
    const wbs = bounded.worldBoundingSphere;
    if (wbs !== undefined && wbs !== null && wbs.radius > 0) {
      if (this.frustum.intersectsSphere(_worldPoint, wbs.radius)) {
        this._stats.passed++;
        return true;
      }
      this._stats.rejected++;
      return false;
    }

    // 回退:点包含测试。中心在视锥内即视为可见。
    if (this.frustum.containsPoint(_worldPoint)) {
      this._stats.passed++;
      return true;
    }
    this._stats.rejected++;
    return false;
  }

  /** 返回裁剪统计快照(自上次 setFromCamera 起)。 */
  getStats(): FrustumCullStats {
    return {
      tested: this._stats.tested,
      passed: this._stats.passed,
      rejected: this._stats.rejected,
    };
  }

  /** 重置裁剪统计。 */
  resetStats(): void {
    this._stats.tested = 0;
    this._stats.passed = 0;
    this._stats.rejected = 0;
  }
}

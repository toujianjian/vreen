// SceneGraphProcessor — 场景图处理器。批量更新脏对象的世界矩阵与包围盒,
// 提供带过滤的遍历、视锥剔除收集、按类型收集等能力。
//
// 核心思想:利用 Object3D 的脏标记系统(DirtyFlag),每帧只重算被标记的对象,
// 静态子树的 matrixWorld 保持缓存,避免 O(n) 的重复矩阵乘法。
//
// 典型每帧流程:
//   processor.updateWorldMatrices();       // 只重算脏对象
//   const visible = processor.collectVisible(camera);  // 视锥剔除
//   renderer.render(visible, camera);

import { Scene } from './Scene';
import { Object3D, DirtyFlag } from './Object3D';
import type { Camera } from '../Cameras/Camera';
import { FrustumCuller, type FrustumCullStats } from './FrustumCuller';
import { SceneStats, type SceneStatsData } from './SceneStats';

/** 场景图处理统计。 */
export interface SceneGraphStats {
  /** 场景中对象总数(含 root)。 */
  totalObjects: number;
  /** 被标记为脏(MATRIX_WORLD)的对象数(更新前统计)。 */
  dirtyObjects: number;
  /** 本次 updateWorldMatrices 实际重算世界矩阵的对象数。 */
  updatedObjects: number;
  /** 本次 collectVisible 收集到的可见对象数。 */
  visibleObjects: number;
}

/**
 * 场景图处理器:批量更新脏对象、收集可见对象、按类型查询。
 * 一个 Scene 对应一个 SceneGraphProcessor 实例。
 */
export class SceneGraphProcessor {
  /** 处理的场景根。 */
  root: Scene;
  /** 视锥裁剪器,collectVisible 时使用。 */
  readonly frustumCuller: FrustumCuller = new FrustumCuller();

  protected _stats: SceneGraphStats = {
    totalObjects: 0,
    dirtyObjects: 0,
    updatedObjects: 0,
    visibleObjects: 0,
  };
  protected _sceneStats: SceneStats = new SceneStats();
  protected _lastSceneStats: SceneStatsData = {
    totalObjects: 0,
    visibleObjects: 0,
    dirtyObjects: 0,
    meshCount: 0,
    lightCount: 0,
    cameraCount: 0,
  };

  constructor(root: Scene) {
    this.root = root;
  }

  /**
   * 批量更新世界矩阵:只重算被标记为脏(MATRIX_WORLD)的对象。
   *
   * 实现:先遍历统计脏数,再调用 root.updateMatrixWorld(force)。
   * Object3D.updateMatrixWorld 内部已实现脏检查:
   * - isDirty(MATRIX_WORLD) 为 false 且非 force 时跳过重算
   * - 本节点重算后 force=true 级联到后代(后代世界矩阵依赖本节点)
   *
   * @param force 为 true 时强制全量重算(忽略脏标记)
   */
  updateWorldMatrices(force: boolean = false): void {
    // 更新前统计:总数与脏数
    let total = 0;
    let dirty = 0;
    this.root.traverse((o: Object3D) => {
      total++;
      if (o.isDirty(DirtyFlag.MATRIX_WORLD)) dirty++;
    });

    // 执行更新(Object3D.updateMatrixWorld 内部做脏检查)
    this.root.updateMatrixWorld(force);

    this._stats.totalObjects = total;
    this._stats.dirtyObjects = dirty;
    // force 时全部重算;否则只有脏对象(及其因级联 force=true 的后代)被重算。
    // 注意:脏对象的祖先若本身不脏,其 matrixWorld 不变,不算"重算"。
    // 这里统计的 updatedObjects 是被实际重算世界矩阵的对象数。
    this._stats.updatedObjects = force ? total : dirty;
  }

  /**
   * 更新包围盒:只重算被标记为脏(BOUNDS)的对象。
   *
   * Object3D 基类无包围盒,此方法遍历清除 BOUNDS 脏位;
   * 子类(如 Mesh)可在覆盖 computeBoundingBox 时利用此标志做实际计算。
   * 调用后所有对象的 BOUNDS 标志被清除。
   */
  updateBounds(): void {
    let updated = 0;
    this.root.traverse((o: Object3D) => {
      if (o.isDirty(DirtyFlag.BOUNDS)) {
        // Object3D 基类无几何体,仅清除标志;Mesh 子类会覆盖语义。
        o.clearDirty(DirtyFlag.BOUNDS);
        updated++;
      }
    });
    // updated 不写入 _stats.updatedObjects(那是世界矩阵的统计),
    // 避免与 updateWorldMatrices 的语义混淆。
    void updated;
  }

  /**
   * 带过滤的深度优先遍历。
   * @param callback 对每个通过过滤的对象调用
   * @param filter 可选过滤函数,返回 true 才回调;省略则遍历全部
   */
  traverse(callback: (o: Object3D) => void, filter?: (o: Object3D) => boolean): void {
    const visit = (o: Object3D): void => {
      if (!filter || filter(o)) callback(o);
      const children = o.children;
      for (let i = 0; i < children.length; i++) {
        visit(children[i]);
      }
    };
    visit(this.root);
  }

  /**
   * 收集可见对象。先按 visible 标志过滤,再按视锥裁剪(若提供 camera)。
   * @param camera 可选相机;提供时启用视锥裁剪,否则只按 visible 标志收集
   * @returns 可见对象数组(不含被剔除的)
   */
  collectVisible(camera?: Camera): Object3D[] {
    const result: Object3D[] = [];
    if (camera !== undefined) {
      this.frustumCuller.setFromCamera(camera);
    }
    this.root.traverse((o: Object3D) => {
      if (!o.visible) return;
      if (camera !== undefined && o.frustumCulled) {
        if (this.frustumCuller.cullSingle(o)) {
          result.push(o);
        }
      } else {
        result.push(o);
      }
    });
    this._stats.visibleObjects = result.length;
    return result;
  }

  /**
   * 按 type 字符串收集对象(深度优先)。
   * @param type 对象的 type 属性值,如 'Mesh'/'Light'/'Camera'/'Group'
   * @returns 匹配的对象数组
   */
  collectByType(type: string): Object3D[] {
    const result: Object3D[] = [];
    this.root.traverse((o: Object3D) => {
      if (o.type === type) result.push(o);
    });
    return result;
  }

  /** 返回处理统计快照(世界矩阵更新相关)。 */
  getStats(): SceneGraphStats {
    return {
      totalObjects: this._stats.totalObjects,
      dirtyObjects: this._stats.dirtyObjects,
      updatedObjects: this._stats.updatedObjects,
      visibleObjects: this._stats.visibleObjects,
    };
  }

  /** 返回视锥裁剪统计快照(最近一次 collectVisible 后有效)。 */
  getCullStats(): FrustumCullStats {
    return this.frustumCuller.getStats();
  }

  /**
   * 收集场景统计(对象总数/可见数/脏数/Mesh/Light/Camera 计数)。
   * 遍历场景后返回快照,同时缓存到内部 _sceneStats。
   */
  collectSceneStats(): SceneStatsData {
    this._lastSceneStats = this._sceneStats.collect(this.root);
    return this._lastSceneStats;
  }
}

// SceneStats — 场景统计信息。遍历场景图收集对象总数、可见数、脏数、
// 各类节点(Mesh/Light/Camera)计数。供 SceneGraphProcessor 与 HUD 显示用。
//
// 设计说明:
// - 使用鸭子类型(isMesh/isLight/isCamera 运行时标志)而非 instanceof,
//   避免 Core → Cameras/Lights 的循环依赖。
// - dirtyObjects 统计被标记 MATRIX_WORLD 脏的对象数(等待重算)。

import type { Scene } from './Scene';
import { Object3D, DirtyFlag } from './Object3D';

/** 场景统计快照(不可变值对象,collect 后返回)。 */
export interface SceneStatsData {
  totalObjects: number;
  visibleObjects: number;
  dirtyObjects: number;
  meshCount: number;
  lightCount: number;
  cameraCount: number;
}

/** 运行时标志的鸭子类型(避免导入 Mesh/Light/Camera 造成循环依赖)。 */
interface FlaggedObject3D {
  isMesh?: boolean;
  isLight?: boolean;
  isCamera?: boolean;
}

export class SceneStats {
  totalObjects: number = 0;
  visibleObjects: number = 0;
  dirtyObjects: number = 0;
  meshCount: number = 0;
  lightCount: number = 0;
  cameraCount: number = 0;

  /**
   * 遍历场景收集统计。重置所有计数后深度优先遍历,
   * 对每个节点累加对应计数。返回当前统计的快照。
   */
  collect(scene: Scene): SceneStatsData {
    this.totalObjects = 0;
    this.visibleObjects = 0;
    this.dirtyObjects = 0;
    this.meshCount = 0;
    this.lightCount = 0;
    this.cameraCount = 0;

    scene.traverse((o: Object3D) => {
      this.totalObjects++;
      if (o.visible) this.visibleObjects++;
      if (o.isDirty(DirtyFlag.MATRIX_WORLD)) this.dirtyObjects++;

      // 鸭子类型判定:子类(Mesh/Light/Camera)在构造时设置对应 is* 标志。
      const flagged = o as Object3D & FlaggedObject3D;
      if (flagged.isMesh === true) this.meshCount++;
      if (flagged.isLight === true) this.lightCount++;
      if (flagged.isCamera === true) this.cameraCount++;
    });

    return this.snapshot();
  }

  /** 返回当前统计的不可变快照。 */
  snapshot(): SceneStatsData {
    return {
      totalObjects: this.totalObjects,
      visibleObjects: this.visibleObjects,
      dirtyObjects: this.dirtyObjects,
      meshCount: this.meshCount,
      lightCount: this.lightCount,
      cameraCount: this.cameraCount,
    };
  }

  /** 重置所有计数为 0。 */
  reset(): void {
    this.totalObjects = 0;
    this.visibleObjects = 0;
    this.dirtyObjects = 0;
    this.meshCount = 0;
    this.lightCount = 0;
    this.cameraCount = 0;
  }
}

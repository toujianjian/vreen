// LOD — Level-of-Detail 节点(Phase 2.2.3)。
//
// 持有多个子 Mesh(各精度级别),按相机到 LOD 世界位置的距离自动切换
// 可见级别。API 对标 three.js LOD(降低学习成本):
//   const lod = new LOD();
//   lod.addLevel(highMesh, 0);    // 0..20 用高模
//   lod.addLevel(midMesh, 20);    // 20..60 用中模
//   lod.addLevel(lowMesh, 60);    // 60+ 用低模
//   scene.add(lod);
//
// 工作原理:
//   - 各 level 作为 LOD 的子节点(addLevel 时 add 进来),继承 LOD 的 world transform。
//   - update(camera) 根据距离设置各 level 的 visible:只有"距离上界 >= 当前距离
//     的最近一级"可见,其余隐藏。
//   - 渲染器的 scene.traverse 天然尊重 mesh.visible,故只需 LOD.update() 切换
//     可见性,无需特殊渲染分支。
//   - hysteresis(滞后量)防止在阈值边界抖动:切换需要距离超过阈值 ±hysteresis。
//
// 集成:渲染器在 traverse 遇到 LOD 节点时自动调用 update(camera),无需应用层
// 手动驱动。应用层也可自行调用 update(例如离屏/自定义策略)。

import { Object3D } from './Object3D';
import type { Mesh } from './Mesh';
import type { Camera } from '../Cameras/Camera';

export interface LODLevel {
  object: Mesh;
  /** 切换到本级所需的最小距离(世界空间)。 */
  distance: number;
  /** 滞后量:从本级切走需距离 > distance + hysteresis。防边界抖动。 */
  hysteresis: number;
}

export class LOD extends Object3D {
  override readonly type: string = 'LOD';
  isLOD: boolean = true;

  /** 级别列表,按 distance 升序。 */
  levels: LODLevel[] = [];
  /** 当前可见级别 index(levels 数组下标)。-1 表示无级别(空 LOD)。 */
  currentLevel: number = 0;
  /** 全局默认滞后量(可在 addLevel 时覆盖)。 */
  hysteresis: number = 0;

  /** 添加一个精度级别。object 会作为子节点 add 进来(继承 world transform)。
   *  @param distance 切换到本级的最小距离(>=0)。 */
  addLevel(object: Mesh, distance: number = 0, hysteresis?: number): this {
    distance = Math.max(0, distance);
    const level: LODLevel = { object, distance, hysteresis: hysteresis ?? this.hysteresis };
    // 按 distance 升序插入。
    let i = 0;
    while (i < this.levels.length && this.levels[i].distance <= distance) i++;
    this.levels.splice(i, 0, level);
    this.add(object);
    // 初始可见性:只显示第 0 级。
    this._applyVisibility(0);
    return this;
  }

  /** 按相机距离更新可见级别。返回当前级别 index。 */
  update(camera: Camera): number {
    if (this.levels.length === 0) {
      this.currentLevel = -1;
      return -1;
    }
    // LOD 世界位置(matrixWorld 的平移列)。
    const e = this.matrixWorld.elements;
    const lx = e[12], ly = e[13], lz = e[14];
    // 相机世界位置(camera.matrixWorld,避免相机有父节点时 position 是 local)。
    const ce = camera.matrixWorld.elements;
    const cx = ce[12], cy = ce[13], cz = ce[14];
    const dx = cx - lx, dy = cy - ly, dz = cz - lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 找当前距离对应的"目标级别":最大的 distance <= dist 的级别。
    let target = 0;
    for (let i = this.levels.length - 1; i >= 0; i--) {
      if (this.levels[i].distance <= dist) {
        target = i;
        break;
      }
    }

    // 滞后:若当前级别 != target,只有当 dist 超过目标级别的 distance ± hysteresis
    // 边界时才切,避免在阈值附近反复抖动。
    if (target !== this.currentLevel) {
      const cur = this.levels[this.currentLevel];
      const tgt = this.levels[target];
      if (target > this.currentLevel) {
        // 切向更远(更粗)级别:需 dist > tgt.distance + tgt.hysteresis
        if (dist < tgt.distance + tgt.hysteresis) {
          // 还没超过滞后边界,保持当前级。
          return this.currentLevel;
        }
      } else {
        // 切向更近(更精)级别:需 dist < cur.distance - cur.hysteresis
        if (dist > cur.distance - cur.hysteresis) {
          return this.currentLevel;
        }
      }
      this.currentLevel = target;
      this._applyVisibility(target);
    }
    return this.currentLevel;
  }

  /** 设置指定级别可见,其余隐藏。 */
  private _applyVisibility(levelIdx: number): void {
    for (let i = 0; i < this.levels.length; i++) {
      this.levels[i].object.visible = (i === levelIdx);
    }
  }

  /** 取当前可见级别的 Mesh(无级别时返回 null)。 */
  getObject(): Mesh | null {
    if (this.currentLevel < 0 || this.currentLevel >= this.levels.length) return null;
    return this.levels[this.currentLevel].object;
  }

  /** 移除所有级别(同时从子节点移除)。 */
  clearLevels(): void {
    for (const lv of this.levels) {
      this.remove(lv.object);
    }
    this.levels = [];
    this.currentLevel = -1;
  }
}

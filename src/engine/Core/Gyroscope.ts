// Gyroscope — 陀螺仪对象 (维持世界朝向)。
//
// 适配 three.js `examples/jsm/misc/Gyroscope.js`。
// 继承 Object3D,但 override updateMatrixWorld 使其:
//   - 位置跟随父节点层级(正常世界位置)
//   - 朝向始终与世界坐标轴对齐(忽略父节点的旋转)
//
// 原理:
//   1. 正常计算 matrixWorld = parent.matrixWorld × this.matrix
//   2. 提取世界位置 (elements[12,13,14])
//   3. 用纯平移矩阵替换 matrixWorld(旋转部分 = 单位阵)
//   4. 子节点继续从 "被重置" 的 matrixWorld 继承
//
// 用途:
//   - Billboard / 精灵(始终面向相机,不受父节点旋转影响)
//   - HUD / UI 元素(固定屏幕朝向)
//   - 指南针 / 水平仪(保持世界对齐)
//   - 粒子广告牌(粒子系统父节点旋转时粒子仍面向相机)
//
// 不变量:
//   - matrixWorld 的旋转部分始终为单位阵(除非用户手动设置 worldUpOffset);
//   - matrixWorld 的平移部分 = 正常层级计算的世界位置;
//   - scale 始终为 1(陀螺仪不继承父节点的缩放)。
//
// 参考:
//   - three.js examples/jsm/misc/Gyroscope.js
//   - o3de Atom BillboardComponent

import { Object3D, DirtyFlag } from '../Core/Object3D';
import { Matrix4 } from '../Math/Matrix4';

/**
 * 陀螺仪对象:位置跟随父节点,朝向锁定世界坐标。
 *
 * 重写 updateMatrixWorld,在正常计算后用纯平移矩阵替换 matrixWorld,
 * 从而丢弃父节点累积的旋转和缩放。
 */
export class Gyroscope extends Object3D {
  /**
   * 可选的世界朝向偏移(四元数)。
   * 如果设置,matrixWorld 的旋转部分使用此偏移而非单位阵。
   * 用于需要固定但非默认朝向的 billboard(如始终偏转 30° 面向相机)。
   */
  worldOrientationOffset: Matrix4 | null = null;

  updateMatrixWorld(force: boolean = false): void {
    // 先正常更新本地 matrix(从 position/rotation/scale)
    if (this.matrixWorldAutoUpdate || force) {
      this.updateMatrix();
    }

    // 计算正常的世界矩阵:matrixWorld = parent.matrixWorld × this.matrix
    const forceRecompute = force || this.matrixWorldNeedsUpdate || this.isDirty(DirtyFlag.MATRIX_WORLD);
    if (forceRecompute) {
      if (this.parent === null) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }

      // ── 陀螺仪核心:提取世界位置,用纯平移替换 ──
      const e = this.matrixWorld.elements;
      const px = e[12];
      const py = e[13];
      const pz = e[14];

      if (this.worldOrientationOffset !== null) {
        // 有朝向偏移:用 offset 矩阵 + 平移
        this.matrixWorld.copy(this.worldOrientationOffset);
        this.matrixWorld.elements[12] = px;
        this.matrixWorld.elements[13] = py;
        this.matrixWorld.elements[14] = pz;
      } else {
        // 无偏移:纯平移矩阵(旋转 = 单位阵,scale = 1)
        this.matrixWorld.makeTranslation(px, py, pz);
      }

      // 更新 inverse
      this.matrixWorldInverse.getInverse(this.matrixWorld);

      // 清除脏标记
      this.clearDirty(DirtyFlag.MATRIX_WORLD);
      this.matrixWorldNeedsUpdate = false;
    }

    // 递归更新子节点(子节点从被重置的 matrixWorld 继承)
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) {
      const child = children[i];
      if (child.matrixWorldAutoUpdate || force) {
        child.updateMatrixWorld(force);
      }
    }
  }
}
